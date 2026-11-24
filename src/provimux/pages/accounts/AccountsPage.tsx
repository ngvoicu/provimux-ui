import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { AUTH_FILES_CHANGED_EVENT } from '@/features/authFiles/authFilesEvents';
import { OAuthFlowDialog } from '@/features/oauth/components/OAuthFlowDialog';
import { SiwcBindDialog } from '@/features/oauth/components/SiwcBindDialog';
import { VertexImportDialog } from '@/features/oauth/components/VertexImportDialog';
import { useOAuthFlows, usePluginOAuthProviders } from '@/features/oauth/hooks/useOAuthFlows';
import { useVertexImport } from '@/features/oauth/hooks/useVertexImport';
import iconVertex from '@/assets/icons/vertex.svg';
import {
  OAUTH_PROVIDERS,
  resolveThemedIcon,
  supportsManualCallback,
  type OAuthProviderCard,
} from '@/features/oauth/providers';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiClient } from '@/services/api/client';
import type { AuthFileFieldsPatch } from '@/services/api/authFiles';
import { providersApi } from '@/services/api/providers';
import { useAuthStore, useConfigStore, useNotificationStore, useThemeStore } from '@/stores';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import { provimuxApi } from '../../api/provimuxApi';
import { familyGroups } from '../aliases/rows';
import { useProvimuxPresence } from '../../presence';
import { useOpenInAuthFiles } from '../shared/authFilesLink';
import { useOpenInProviders } from '../shared/providersLink';
import { usePageClock } from '../shared/clocks';
import { useProvimuxResource } from '../shared/useProvimuxResource';
import { formatClock, formatExact, screenNow } from '../time';
import {
  EMPTY_ACCOUNTS_FILTER,
  accountFromParams,
  buildAccounts,
  type Account,
  type AccountsFilter,
  type KeyAccount,
} from './accounts';
import { accountsApi, type AccountsRead } from './accountsApi';
import { AccountSheet } from './AccountSheet';
import { AccountsBoard } from './AccountsBoard';
import { AddAccountSheet } from './AddAccountSheet';
import { firstStep } from './addSteps';
import {
  KeyWriteError,
  familyWithKeyAdded,
  familyWithKeyOn,
  familyWithKeyReplaced,
  familyWithPriority,
  familyWithoutKey,
  type NewKey,
} from './keyWrites';
import { accountName, serviceLabel } from './labels';
import { isChangedError, writeErrorMessage } from './writeErrors';
import { compatibleConfig, nativeSave, summaryOf, type KeyDraft } from './keySettings';
import { modelsAddressOf } from './links';
import { ReplaceKeyDialog } from './ReplaceKeyDialog';
import { serviceById } from './services';
import shared from '../shared/Shared.module.scss';
import styles from './AccountsPage.module.scss';

/** The routes' rhythm, as on Models: a key's cooldowns are read from them. */
const POLL_MS = 30_000;
/** The sign-in dialogs' focus mark for the Vertex import (not one of OAuth Login's flows). */
const VERTEX_FOCUS = '__vertex__';
const fetchRoutes = (client: Parameters<typeof provimuxApi.modelRoutes>[0]) =>
  provimuxApi.modelRoutes(client);

/**
 * Accounts (design accounts-page.md): every subscription and API key in one list, whether each works now,
 * its priority; adding, fixing, turning off, removing and prioritising them. It reads what Auth Files and
 * Models read and writes with the calls the original pages make (accountsApi.ts). AI Providers, Auth Files
 * and OAuth Login stay at their addresses for everything else; each account links to its page there.
 */
export function AccountsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const openInAuthFiles = useOpenInAuthFiles();
  const openInProviders = useOpenInProviders();

  // --- reading -------------------------------------------------------------------------------------------
  const [read, setRead] = useState<AccountsRead | null>(null);
  const [reading, setReading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestRef.current;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      id === requestRef.current && revision === apiClient.getConnectionRevision();
    setReading(true);
    try {
      const answer = await accountsApi.load(apiClient.captureConnection(isCurrent));
      if (!isCurrent()) return;
      setRead(answer);
      setReadError(null);
    } catch (error) {
      if (!isCurrent()) return;
      setReadError(getErrorMessage(error));
    } finally {
      if (isCurrent()) setReading(false);
    }
  }, []);

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [connectionStatus, load]);

  // A sign-in that ends while its dialog is closed (OAuth Login's flow announces it) adds a login.
  useEffect(() => {
    const reload = () => void load();
    window.addEventListener(AUTH_FILES_CHANGED_EVENT, reload);
    return () => window.removeEventListener(AUTH_FILES_CHANGED_EVENT, reload);
  }, [load]);

  const routes = useProvimuxResource('modelRoutes', fetchRoutes, POLL_MS, undefined, {
    headerRefresh: false,
  });
  const routesStatus = useProvimuxPresence((state) => state.modelRoutes.status);
  const routesKnown =
    routesStatus === 'unsupported' ? false : routes.data !== null ? true : null;
  const clock = usePageClock();
  const serverNowMs = screenNow(clock, routes.loadedAt, routes.offsetMs);

  const accounts = useMemo(
    () =>
      read
        ? buildAccounts({
            config: read.config,
            files: read.files,
            routes: routes.data,
            nowMs: Math.max(clock, read.receivedAtMs),
            serverNowMs,
          })
        : [],
    [read, routes.data, clock, serverNowMs]
  );

  const refresh = useCallback(async () => {
    await Promise.all([load(), routes.refresh()]);
  }, [load, routes]);
  useHeaderRefresh(refresh);

  // --- filter, panels ------------------------------------------------------------------------------------
  const [filter, setFilter] = useState<AccountsFilter>(EMPTY_ACCOUNTS_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lastOpen, setLastOpen] = useState<Account | null>(null);
  const openAccount = accounts.find((account) => account.id === openId) ?? null;
  useEffect(() => {
    if (openAccount) setLastOpen(openAccount);
  }, [openAccount]);
  const open = (account: Account) => {
    setOpenId(account.id);
    setSheetOpen(true);
  };
  const closeSheet = () => setSheetOpen(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addService, setAddService] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<KeyAccount | null>(null);

  // --- sign-in (OAuth Login's own flow and dialog) -------------------------------------------------------
  const pluginCards = usePluginOAuthProviders(apiBase);
  const providerCards = useMemo<OAuthProviderCard[]>(
    () => [...OAUTH_PROVIDERS, ...pluginCards],
    [pluginCards]
  );
  const focusedRef = useRef<string | null>(null);
  const flows = useOAuthFlows({
    providerCards,
    isFocused: (provider) => focusedRef.current === provider,
  });
  /** The sign-in shown: its flow, the service, and the account it signs in again (null: a new one). */
  const [signIn, setSignIn] = useState<{ flow: string; service: string; who: string | null } | null>(
    null
  );
  const [signInOpen, setSignInOpen] = useState(false);

  const startSignIn = (flow: string, service: string, who: string | null = null) => {
    focusedRef.current = flow;
    setSignIn({ flow, service, who });
    setSignInOpen(true);
    setAddOpen(false);
    setSheetOpen(false);
    if (!flows.states[flow]?.status) void flows.startAuth(flow);
  };
  const closeSignIn = useCallback(() => {
    if (signIn) flows.dismissSuccess(signIn.flow);
    focusedRef.current = null;
    setSignInOpen(false);
  }, [flows, signIn]);

  // A sign-in that succeeds while its dialog is open: the dialog closes and the list shows the account.
  const signInStatus = signIn ? flows.states[signIn.flow]?.status : undefined;
  useEffect(() => {
    if (!signIn || !signInOpen || signInStatus !== 'success') return;
    showNotification(
      t('provimux.accounts.signed_in', { service: serviceLabel(t, signIn.service) }),
      'success'
    );
    closeSignIn();
    void load();
  }, [signIn, signInOpen, signInStatus, closeSignIn, load, showNotification, t]);

  const signInCard = signIn ? providerCards.find((card) => card.id === signIn.flow) : undefined;

  // --- the other ways in: OAuth Login's Vertex service account import and Sign in with ChatGPT binding ------
  const vertexImport = useVertexImport({
    isFocused: () => focusedRef.current === VERTEX_FOCUS,
    onCredentialAdded: flows.recordCredentialAdded,
  });
  const [vertexOpen, setVertexOpen] = useState(false);
  const openVertex = () => {
    focusedRef.current = VERTEX_FOCUS;
    setAddOpen(false);
    setVertexOpen(true);
  };
  const closeVertex = () => {
    if (vertexImport.vertex.result) vertexImport.resetForAnother();
    focusedRef.current = null;
    setVertexOpen(false);
    void load();
  };
  // Mounted afresh for each binding (a new choice and session); kept mounted while it closes.
  const [siwcKey, setSiwcKey] = useState(0);
  const [siwcOpen, setSiwcOpen] = useState(false);
  const openSiwc = () => {
    setSiwcKey((key) => key + 1);
    setAddOpen(false);
    setSheetOpen(false);
    setSiwcOpen(true);
  };

  // --- links that open the page on an account, or on adding one --------------------------------------------
  const handledParams = useRef(false);
  useEffect(() => {
    if (handledParams.current || !read) return;
    handledParams.current = true;
    const target = accountFromParams(accounts, searchParams);
    const add = searchParams.get('add');
    if (target) open(target);
    else if (add) {
      setAddService(add === '1' ? null : add);
      setAddOpen(true);
    }
    if (searchParams.has('login') || searchParams.has('account') || add) {
      setSearchParams({}, { replace: true });
    }
  }, [read, accounts, searchParams, setSearchParams]);

  // --- writes --------------------------------------------------------------------------------------------
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const writing = useRef(false);
  const run = useCallback(
    async (id: string, write: () => Promise<void>, done?: string): Promise<boolean> => {
      // One write at a time: a key's write is conditional on the read before it.
      if (writing.current) return false;
      writing.current = true;
      setBusy((prev) => new Set(prev).add(id));
      try {
        await write();
        useConfigStore.getState().clearCache();
        if (done) showNotification(done, 'success');
        await Promise.all([load(), routes.load()]);
        return true;
      } catch (error) {
        const changed = isChangedError(error);
        showNotification(writeErrorMessage(t, error), changed ? 'warning' : 'error');
        if (changed) await load();
        return false;
      } finally {
        writing.current = false;
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [load, routes, showNotification, t]
  );

  const writeKey = (account: KeyAccount, groups: (document: unknown) => unknown[]) => async () => {
    if (!read) return;
    await accountsApi.writeFamily(
      account.entry.family,
      groups(read.config.document),
      read.config.etag
    );
  };

  const toggle = (account: Account, on: boolean) =>
    void run(
      account.id,
      account.kind === 'sub'
        ? async () => {
            await accountsApi.setLoginOn(
              { name: account.fileName, authIndex: account.authIndexes[0] },
              on
            );
          }
        : writeKey(account, (doc) => familyWithKeyOn(doc, account.entry, on))
    );

  const savePriority = (account: Account, value: number) =>
    run(
      account.id,
      account.kind === 'sub'
        ? async () => {
            await accountsApi.setLoginPriority(account.fileName, value);
          }
        : writeKey(account, (doc) => familyWithPriority(doc, account.entry, value)),
      t('provimux.accounts.priority_saved', { name: accountName(t, account), value })
    );

  const remove = (account: Account) => {
    const name = accountName(t, account);
    showConfirmation({
      title: t('provimux.accounts.remove_title', { name }),
      message:
        account.kind === 'sub'
          ? t('provimux.accounts.remove_login')
          : account.entry.keyIndex === null
            ? t('provimux.accounts.remove_entry', { name: account.entryName ?? account.who })
            : t('provimux.accounts.remove_key'),
      confirmText: t('provimux.accounts.remove_confirm'),
      cancelText: t('provimux.accounts.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        const removed = await run(
          account.id,
          account.kind === 'sub'
            ? () => accountsApi.removeLogin(account.fileName)
            : writeKey(account, (doc) => familyWithoutKey(doc, account.entry)),
          t('provimux.accounts.removed', { name })
        );
        if (removed) {
          setSheetOpen(false);
          setOpenId(null);
        }
      },
    });
  };

  const tryNow = (account: Account) => {
    const index = account.authIndexes[0];
    if (!index) return;
    void run(
      account.id,
      async () => {
        await accountsApi.tryLoginNow(index);
      },
      t('provimux.accounts.tried_now', { name: accountName(t, account) })
    );
  };

  const fix = (account: Account) => {
    if (account.kind === 'sub' && account.signIn) {
      startSignIn(account.signIn, account.service, account.who);
    }
    else if (account.kind === 'api') setReplacing(account);
  };

  const replaceKey = (account: KeyAccount, apiKey: string) =>
    run(
      account.id,
      writeKey(account, (doc) => familyWithKeyReplaced(doc, account.entry, apiKey)),
      t('provimux.accounts.replaced', { name: accountName(t, account) })
    );

  /** A key's settings, saved with AI Providers' own calls (its connection form, its OpenAI entry form). */
  const saveKeyDraft = async (draft: KeyDraft) => {
    if (draft.kind === 'native') {
      const { source, settings, members } = nativeSave(draft);
      await providersApi.saveNativeConnection(draft.family, source, settings, members);
      return;
    }
    const config = compatibleConfig(draft);
    if (draft.resource) {
      await providersApi.updateOpenAIProvider(config.name, draft.resource.originalIndex, config);
      return;
    }
    const taken = familyGroups(read?.config.document, 'openai-compatibility').some(
      (group) => isRecord(group) && String(group.name ?? '').trim() === config.name
    );
    if (taken) throw new KeyWriteError('duplicate-name');
    await providersApi.createOpenAIProvider(config);
  };

  const saveKeySettings = (account: Account, draft: KeyDraft) =>
    run(
      account.id,
      () => saveKeyDraft(draft),
      t('provimux.accounts.settings.saved', { name: accountName(t, account) })
    );

  const saveLoginSettings = (account: Account, patch: AuthFileFieldsPatch) =>
    account.kind !== 'sub'
      ? Promise.resolve(false)
      : run(
          account.id,
          async () => {
            await accountsApi.setLoginFields(account.fileName, patch);
          },
          t('provimux.accounts.settings.saved', { name: accountName(t, account) })
        );

  /** "Claude key added"; a key of a list-served service is told to pick its models, unless it listed some. */
  const addedMessage = (serviceId: string, input: NewKey, settings: KeyDraft | null) => {
    const service = serviceById(serviceId)?.key?.custom
      ? (input.name ?? '').trim() || serviceLabel(t, serviceId)
      : serviceLabel(t, serviceId);
    const listed = settings !== null && summaryOf(settings).models > 0;
    return (serviceId === 'openrouter' || serviceById(serviceId)?.key?.custom) && !listed
      ? t('provimux.accounts.key_added_listed', { service })
      : t('provimux.accounts.key_added', { service });
  };

  const addKey = async (serviceId: string, input: NewKey, settings: KeyDraft | null) => {
    const service = serviceById(serviceId);
    if (!service?.key || !read) return false;
    const target = service.key;
    const added = await run(
      '__add__',
      settings
        ? () => saveKeyDraft(settings)
        : async () => {
            const { family, groups } = familyWithKeyAdded(read.config.document, target, input);
            await accountsApi.writeFamily(family, groups, read.config.etag);
          },
      addedMessage(serviceId, input, settings)
    );
    if (added) setAddOpen(false);
    return added;
  };

  const startAdd = (service?: string) => {
    const known = service ? serviceById(service) : undefined;
    const step = known ? firstStep(known) : null;
    if (known && step?.kind === 'sign-in') {
      startSignIn(step.flow, known.id);
      return;
    }
    if (step?.kind === 'service-account') return openVertex();
    if (step?.kind === 'siwc') return openSiwc();
    setAddService(known ? known.id : null);
    setAddOpen(true);
  };

  const showModels = (account: Account) => navigate(modelsAddressOf(account, routesKnown === true));
  const moreSettings = (account: Account) => {
    if (account.kind === 'sub') openInAuthFiles(account.fileName);
    else openInProviders(account.entry.family, account.entry.groupName ?? account.who);
  };

  // --- render --------------------------------------------------------------------------------------------
  /** The dialog's heading in the page's words: the service, and the account to use when it is a fix. */
  const headingOf = (card: OAuthProviderCard) => {
    const service = signIn ? serviceLabel(t, signIn.service) : '';
    const method =
      card.kind === 'plugin'
        ? t('auth_login.method_plugin')
        : t(card.flow === 'device' ? 'auth_login.method_device' : 'auth_login.method_browser');
    const where = card.kind === 'builtin' && card.domain ? `${card.domain} · ${method}` : method;
    return {
      title: signIn?.who
        ? t('provimux.accounts.signin_again_title', { service })
        : t('provimux.accounts.signin_title', {
            service: card.kind === 'plugin' ? card.title : service,
          }),
      caption: signIn?.who
        ? `${t('provimux.accounts.signin_as', { who: signIn.who })} · ${where}`
        : where,
      icon: card.kind === 'plugin' ? card.icon : resolveThemedIcon(card.icon, resolvedTheme),
    };
  };

  return (
    <div className={`${shared.page} ${styles.page}`}>
      <header className={shared.header}>
        <div className={shared.headerText}>
          <h1 className={shared.title}>{t('provimux.accounts.title')}</h1>
          <p className={shared.lede}>{t('provimux.accounts.lede')}</p>
        </div>
        <div className={shared.headerActions}>
          {routes.loadedAt ? (
            <span
              className={shared.updated}
              title={formatExact(routes.loadedAt + routes.offsetMs, i18n.language)}
            >
              {t('provimux.common.updated', {
                time: formatClock(routes.loadedAt + routes.offsetMs, i18n.language, serverNowMs),
              })}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
            loading={reading && read !== null}
          >
            <IconRefreshCw size={14} />
            {t('provimux.common.reload')}
          </Button>
        </div>
      </header>

      {read === null ? (
        readError ? (
          <div className={shared.inlineError} role="alert">
            {t('provimux.accounts.load_failed', { message: readError })}{' '}
            <button type="button" className={styles.textButton} onClick={() => void load()}>
              {t('provimux.common.retry')}
            </button>
          </div>
        ) : (
          <p className={styles.reading}>
            <span className={styles.readingDot} aria-hidden="true" />
            {t('provimux.accounts.loading')}
          </p>
        )
      ) : (
        <AccountsBoard
          accounts={accounts}
          filter={filter}
          onFilter={setFilter}
          nowMs={Math.max(clock, read.receivedAtMs)}
          serverNowMs={serverNowMs}
          busy={busy}
          routesKnown={routesKnown}
          loginsFailed={read.files === null}
          onAdd={startAdd}
          onOpen={open}
          onToggle={toggle}
          onFix={fix}
        />
      )}

      <AccountSheet
        account={openAccount ?? lastOpen}
        open={sheetOpen && openAccount !== null}
        nowMs={read ? Math.max(clock, read.receivedAtMs) : clock}
        serverNowMs={serverNowMs}
        busy={openAccount ? busy.has(openAccount.id) : false}
        document={read?.config.document ?? null}
        file={
          (openAccount ?? lastOpen)?.kind === 'sub'
            ? (read?.files?.find(
                (file) => file.name === ((openAccount ?? lastOpen) as { fileName: string }).fileName
              ) ?? null)
            : null
        }
        onSaveKeySettings={saveKeySettings}
        onSaveLoginSettings={saveLoginSettings}
        onSiwc={openSiwc}
        onClose={closeSheet}
        onToggle={toggle}
        onFix={fix}
        onTryNow={tryNow}
        onSavePriority={savePriority}
        onRemove={remove}
        onShowModels={showModels}
        onMoreSettings={moreSettings}
      />

      <AddAccountSheet
        open={addOpen}
        initialService={addService}
        pluginFlows={pluginCards.map((card) => ({ id: card.id, title: card.title }))}
        document={read?.config.document ?? null}
        loginProxy={{
          value: flows.loginProxy,
          rejected: flows.loginProxyRejected,
          onChange: flows.setLoginProxy,
        }}
        onClose={() => setAddOpen(false)}
        onSignIn={startSignIn}
        onServiceAccount={openVertex}
        onSiwc={openSiwc}
        onAddKey={addKey}
      />

      <VertexImportDialog
        open={vertexOpen}
        heading={{
          title: t('provimux.accounts.vertex_title'),
          caption: t('vertex_import.file_label'),
          icon: iconVertex,
        }}
        vertex={vertexImport.vertex}
        onPickFile={vertexImport.pickFile}
        onLocationChange={vertexImport.setLocation}
        onImport={() => void vertexImport.importCredential()}
        onImportAnother={vertexImport.resetForAnother}
        onViewAuthFiles={closeVertex}
        onClose={closeVertex}
      />

      {siwcKey > 0 ? (
        <SiwcBindDialog
          key={siwcKey}
          open={siwcOpen}
          onClose={() => {
            setSiwcOpen(false);
            void load();
          }}
          onViewAuthFiles={() => setSiwcOpen(false)}
        />
      ) : null}

      <ReplaceKeyDialog
        account={replacing}
        open={replacing !== null}
        onClose={() => setReplacing(null)}
        onReplace={replaceKey}
      />

      {signInCard ? (
        <OAuthFlowDialog
          open={signInOpen}
          providerId={signInCard.id}
          heading={headingOf(signInCard)}
          state={flows.states[signInCard.id] ?? {}}
          text={(suffix) => flows.providerText(signInCard.id, suffix)}
          supportsCallback={supportsManualCallback(signInCard)}
          signInNote={
            signInCard.kind === 'builtin' && signInCard.signInNoteKey
              ? t(signInCard.signInNoteKey)
              : undefined
          }
          onStart={() => void flows.startAuth(signInCard.id)}
          onCancel={() => void flows.cancelAuth(signInCard.id)}
          onCallbackChange={(value) => flows.setCallbackInput(signInCard.id, value)}
          onCallbackSubmit={() => void flows.submitCallback(signInCard.id)}
          onViewAuthFiles={closeSignIn}
          onClose={closeSignIn}
        />
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconRefreshCw } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { FloatingSaveBar } from '@/features/config/components/FloatingSaveBar';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import {
  addKeyAlias,
  addLoginAlias,
  changeRow,
  discard,
  draftEntries,
  rebase,
  removeRow,
  rowIssues,
  startDraft,
} from './draft';
import { draftClientNames } from './collisions';
import { blockedEntries, planCommit } from './plan';
import { aliasesApi, createServedNamesSource, loadServedNames } from './aliasesApi';
import { blockingCount, changeCount, initialFilter, type AliasFilter } from './pageLogic';
import { AliasesBoard, type BoardActions, type Failure } from './AliasesBoard';
import type { AliasDraft, ServedNames } from './types';
import shared from '../shared/Shared.module.scss';
import styles from './AliasesPage.module.scss';

type Phase = 'loading' | 'ready' | 'error';

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * Aliases (design aliases-page.md, step U1): every alias of every API-key provider and login type, edited
 * as one draft and saved with one action. A save writes only what changed, each request guarded by the
 * configuration's ETag; what could not be saved keeps its edits and says why.
 */
export function AliasesPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [draft, setDraftState] = useState<AliasDraft | null>(null);
  const draftRef = useRef<AliasDraft | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [failures, setFailures] = useState<Record<string, Failure>>({});
  const [served, setServed] = useState<ServedNames | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<AliasFilter>(() => initialFilter(searchParams));
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const asked = useRef<Set<string>>(new Set());
  const requestRef = useRef(0);
  const askedNamesRef = useRef<string | null>(null);
  const sourceRef = useRef(createServedNamesSource((names) => loadServedNames(names)));

  /** Every draft change goes through here, so handlers in one tick see each other's result. */
  const setDraft = useCallback((next: AliasDraft | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const update = useCallback(
    (change: (current: AliasDraft) => AliasDraft) => {
      const current = draftRef.current;
      if (!current) return;
      const next = change(current);
      if (next !== current) setDraft(next);
    },
    [setDraft]
  );

  // Names served natively (design 4.4): asked at load and after a commit (forced), and, debounced, when
  // the draft's set of client names changes. An answer for an older ask comes back null and is dropped.
  const askServed = useCallback((current: AliasDraft, force: boolean) => {
    const names = draftClientNames(current);
    askedNamesRef.current = [...names].sort().join('\n');
    const revision = apiClient.getConnectionRevision();
    void sourceRef.current.ask(names, { force }).then((answer) => {
      if (answer && revision === apiClient.getConnectionRevision()) setServed(answer);
    });
  }, []);

  const namesKey = useMemo(
    () => (draft ? [...draftClientNames(draft)].sort().join('\n') : null),
    [draft]
  );
  useEffect(() => {
    if (namesKey === null || namesKey === askedNamesRef.current) return;
    const timer = window.setTimeout(() => {
      if (draftRef.current) askServed(draftRef.current, false);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [namesKey, askServed]);

  const load = useCallback(async () => {
    const id = ++requestRef.current;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      id === requestRef.current && revision === apiClient.getConnectionRevision();
    setReloading(true);
    try {
      const state = await aliasesApi.load(apiClient.captureConnection(isCurrent));
      if (!isCurrent()) return;
      const next = startDraft(state);
      setDraft(next);
      setTexts({});
      setFailures({});
      setLoadError(null);
      setPhase('ready');
      askServed(next, true);
    } catch (error) {
      if (!isCurrent()) return;
      setLoadError(getErrorMessage(error));
      setPhase((prev) => (prev === 'ready' ? 'ready' : 'error'));
    } finally {
      if (isCurrent()) setReloading(false);
    }
  }, [askServed, setDraft]);

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [connectionStatus, load]);

  const dirty = useMemo(() => (draft ? planCommit(draft).length > 0 : false), [draft]);
  const changes = useMemo(() => (draft ? changeCount(draft) : 0), [draft]);
  const blocked = useMemo(() => (draft ? blockedEntries(draft).length > 0 : false), [draft]);
  const toFix = useMemo(() => (draft ? blockingCount(rowIssues(draft)) : 0), [draft]);

  const refresh = useCallback(() => {
    if (!dirty) return load();
    showConfirmation({
      title: t('provimux.aliases.reload_title'),
      message: t('provimux.aliases.reload_message'),
      confirmText: t('provimux.aliases.reload_confirm'),
      cancelText: t('provimux.aliases.unsaved_cancel'),
      variant: 'danger',
      onConfirm: () => load(),
    });
  }, [dirty, load, showConfirmation, t]);
  useHeaderRefresh(refresh);

  useUnsavedChangesGuard({
    shouldBlock: dirty,
    dialog: {
      title: t('provimux.aliases.unsaved_title'),
      message: t('provimux.aliases.unsaved_message'),
      confirmText: t('provimux.aliases.unsaved_confirm'),
      cancelText: t('provimux.aliases.unsaved_cancel'),
      variant: 'danger',
    },
  });

  const forgetTexts = useCallback((keepEntries: ReadonlySet<string> | null) => {
    setTexts((prev) => {
      if (!keepEntries) return {};
      const next: Record<string, string> = {};
      for (const [rowId, text] of Object.entries(prev)) {
        if (keepEntries.has(rowId.slice(0, rowId.indexOf('#')))) next[rowId] = text;
      }
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    const current = draftRef.current;
    if (!current || saving) return;
    setSaving(true);
    const revision = apiClient.getConnectionRevision();
    try {
      const outcome = await aliasesApi.commit(current);
      // Other pages must not show the configuration as it was (design 3.4).
      useConfigStore.getState().clearCache();
      const state = await aliasesApi.load();
      if (revision !== apiClient.getConnectionRevision()) return;
      const failedIds = [...new Set(outcome.failed.map((failure) => failure.entryId))];
      const next = rebase(current, state, failedIds);
      setDraft(next);
      forgetTexts(new Set(failedIds));
      setFailures(Object.fromEntries(outcome.failed.map((failure) => [failure.entryId, failure])));
      askServed(next, true);
      if (outcome.failed.length === 0) {
        showNotification(t('provimux.aliases.saved'), 'success');
      } else if (outcome.done.length === 0) {
        showNotification(t('provimux.aliases.saved_none'), 'warning');
      } else {
        showNotification(
          t('provimux.aliases.saved_partly', {
            done: outcome.done.length,
            failed: failedIds.length,
          }),
          'warning'
        );
      }
    } catch (error) {
      if (isAbort(error) || revision !== apiClient.getConnectionRevision()) return;
      showNotification(
        t('provimux.aliases.failed_error', { message: getErrorMessage(error) }),
        'error'
      );
    } finally {
      setSaving(false);
    }
  }, [askServed, forgetTexts, saving, setDraft, showNotification, t]);

  const discardAll = useCallback(() => {
    update((current) => discard(current));
    forgetTexts(null);
    setFailures({});
  }, [forgetTexts, update]);

  // Handlers read the latest alias texts through a ref, so `actions` stays one object.
  const textsRef = useRef(texts);
  useEffect(() => {
    textsRef.current = texts;
  }, [texts]);

  /** A login type's built-in model names, offered when a model is typed; asked once per type. */
  const wantSuggestions = useCallback((channel: string) => {
    if (!channel || asked.current.has(channel)) return;
    asked.current.add(channel);
    authFilesApi
      .getModelDefinitions(channel)
      .then((models) =>
        setSuggestions((prev) => ({
          ...prev,
          [channel]: models.map((model) => model.id).filter(Boolean),
        }))
      )
      .catch(() => {
        // The list is a help: free text stays allowed.
      });
  }, []);

  const actions: BoardActions = useMemo(
    () => ({
      setAlias: (rowId, text) => {
        setTexts((prev) => ({ ...prev, [rowId]: text }));
        update((current) => changeRow(current, rowId, { alias: text }));
      },
      setUpstream: (rowId, text) => {
        update((current) => {
          const row = current.rows.find((r) => r.id === rowId);
          // The alias is set again from its own text: a name equal to the old model was dropped.
          const alias = textsRef.current[rowId] ?? row?.alias ?? '';
          return changeRow(current, rowId, { upstream: text, alias });
        });
      },
      setDisplayName: (rowId, text) =>
        update((current) => changeRow(current, rowId, { displayName: text })),
      setFork: (rowId, value) => update((current) => changeRow(current, rowId, { fork: value })),
      setForceMapping: (rowId, value) =>
        update((current) => changeRow(current, rowId, { forceMapping: value })),
      addKeyAlias: (entryId, upstream) => {
        const current = draftRef.current;
        if (!current) return;
        const next = addKeyAlias(current, entryId, upstream, '');
        if (next === current) return;
        setDraft(next);
        setFocusRowId(`${entryId}#new-${current.nextNew}`);
      },
      addLoginAlias: (channel) => {
        const current = draftRef.current;
        if (!current) return;
        const next = addLoginAlias(current, channel, { upstream: '', alias: '' });
        if (next === current) return;
        const added = next.rows.find((row) => row.id.endsWith(`#new-${current.nextNew}`));
        setDraft(next);
        if (added) {
          setFocusRowId(added.id);
          const entry = draftEntries(next).find((e) => e.id === added.entryId);
          if (entry?.store === 'login') wantSuggestions(entry.channel);
        }
      },
      removeRow: (rowId) => update((current) => removeRow(current, rowId)),
      undoEntry: (entryId) => {
        update((current) =>
          rebase(
            current,
            current.base,
            draftEntries(current)
              .map((entry) => entry.id)
              .filter((id) => id !== entryId)
          )
        );
        setTexts((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([id]) => !id.startsWith(`${entryId}#`)))
        );
        setFailures((prev) => {
          const next = { ...prev };
          delete next[entryId];
          return next;
        });
      },
      wantSuggestions,
    }),
    [setDraft, update, wantSuggestions]
  );

  const failedCount = Object.keys(failures).length;
  const statusText = saving
    ? t('provimux.aliases.saving')
    : blocked
      ? t('provimux.aliases.blocked', { count: toFix })
      : failedCount
        ? `${t('provimux.aliases.unsaved', { count: Math.max(changes, 1) })} · ${t(
            'provimux.aliases.not_saved',
            { count: failedCount }
          )}`
        : t('provimux.aliases.unsaved', { count: Math.max(changes, 1) });

  const firstLoad = phase === 'loading';
  const empty = draft !== null && draft.base.entries.length === 0 && draft.rows.length === 0;

  return (
    <div className={`${shared.page} ${styles.page}`}>
      <header className={shared.header}>
        <div className={shared.headerText}>
          <h1 className={shared.title}>{t('provimux.aliases.title')}</h1>
          <p className={shared.lede}>{t('provimux.aliases.lede')}</p>
        </div>
        <div className={shared.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
            loading={reloading && draft !== null}
            disabled={saving}
          >
            <IconRefreshCw size={14} />
            {t('provimux.common.reload')}
          </Button>
        </div>
      </header>

      {firstLoad ? (
        <div
          className={shared.skeletons}
          aria-busy="true"
          aria-label={t('provimux.common.loading')}
        >
          <Skeleton height={44} />
          <Skeleton height={120} />
          <Skeleton height={260} />
        </div>
      ) : phase === 'error' || draft === null ? (
        <EmptyState
          title={t('provimux.aliases.load_failed')}
          description={loadError ?? undefined}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              {t('provimux.common.retry')}
            </Button>
          }
        />
      ) : empty ? (
        <EmptyState
          title={t('provimux.aliases.empty_title')}
          description={t('provimux.aliases.empty_text')}
          action={
            <div className={styles.emptyLinks}>
              <Link to="/ai-providers" className={styles.link}>
                {t('provimux.aliases.empty_link_providers')}
              </Link>
              <Link to="/oauth" className={styles.link}>
                {t('provimux.aliases.empty_link_logins')}
              </Link>
            </div>
          }
        />
      ) : (
        <>
          {loadError ? (
            <p className={shared.inlineError} role="alert">
              {t('provimux.aliases.reload_failed', { message: loadError })}
            </p>
          ) : null}
          <fieldset className={styles.board} disabled={saving}>
            <AliasesBoard
              draft={draft}
              served={served}
              filter={filter}
              onFilter={setFilter}
              texts={texts}
              failures={failures}
              suggestions={suggestions}
              focusRowId={focusRowId}
              actions={actions}
            />
          </fieldset>
          <FloatingSaveBar
            visible={dirty}
            statusText={statusText}
            statusTone={saving ? 'busy' : blocked ? 'error' : 'warning'}
            saving={saving}
            saveDisabled={!dirty || blocked || saving}
            discardDisabled={saving}
            onSave={() => void save()}
            onDiscard={discardAll}
          />
        </>
      )}
    </div>
  );
}

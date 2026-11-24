import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { FloatingSaveBar } from '@/features/config/components/FloatingSaveBar';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { apiClient } from '@/services/api/client';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { provimuxApi } from '../../api/provimuxApi';
import { useProvimuxPresence } from '../../presence';
import { aliasesApi } from '../aliases/aliasesApi';
import { rowIssues } from '../aliases/draft';
import {
  INITIAL_PAGE,
  blockingCount,
  canEdit,
  changeCount,
  isDirty,
  leaveGuarded,
  pageStep,
  saveBarShown,
  type PageEvent,
  type PageState,
} from '../aliases/pageLogic';
import { blockedEntries, planCommit } from '../aliases/plan';
import type { AliasDraft, CommitOutcome } from '../aliases/types';
import { usePageClock } from '../shared/clocks';
import { useProvimuxResource } from '../shared/useProvimuxResource';
import { formatClock, formatExact, screenNow } from '../time';
import { useDevinCooling } from '../modelRoutes/useDevinCooling';
import { initialModelsFilter, usageByName, type ModelsFilter } from './catalog';
import { ModelsBody } from './ModelsBody';
import shared from '../shared/Shared.module.scss';
import styles from './ModelsPage.module.scss';

/** The routes' and the lists' rhythm: on open, on refresh, every 30 s while visible. */
const POLL_MS = 30_000;
const fetchRoutes = (client: Parameters<typeof provimuxApi.modelRoutes>[0]) =>
  provimuxApi.modelRoutes(client);
const fetchLists = (client: Parameters<typeof provimuxApi.modelLists>[0]) =>
  provimuxApi.modelLists(client);
const fetchUsage = (client: Parameters<typeof provimuxApi.modelUsage>[0]) =>
  provimuxApi.modelUsage(client);

/**
 * Models (design models-page.md): every name a client can send, with the routes that serve it in the order
 * they are tried; the owner's names first. Names, the models under them and API keys' priorities are edited
 * as one draft over one read of the configuration and saved with one action, exactly as the Aliases page
 * did (aliases-page.md 3.4, 3.6): the same requests, each with If-Match. The routes, lists and usage are
 * read from Provimux's endpoints; without them the page shows the configuration's names only.
 */
export function ModelsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [page, setPage] = useState<PageState>(INITIAL_PAGE);
  /** The state handlers act on: every event goes through `send`, so one tick's events compose. */
  const pageRef = useRef<PageState>(INITIAL_PAGE);
  const send = useCallback((event: PageEvent): PageState => {
    const next = pageStep(pageRef.current, event);
    if (next !== pageRef.current) {
      pageRef.current = next;
      setPage(next);
    }
    return next;
  }, []);
  const [filter, setFilter] = useState<ModelsFilter>(() => initialModelsFilter(searchParams));

  const devin = useDevinCooling();
  const routes = useProvimuxResource('modelRoutes', fetchRoutes, POLL_MS, devin.read, {
    headerRefresh: false,
  });
  const lists = useProvimuxResource('modelLists', fetchLists, POLL_MS, undefined, {
    headerRefresh: false,
  });
  const usage = useProvimuxResource('savings', fetchUsage, null, undefined, {
    headerRefresh: false,
  });
  const routesStatus = useProvimuxPresence((state) => state.modelRoutes.status);
  const { refresh: refreshRoutes, load: loadRoutes } = routes;
  const { load: loadLists } = lists;
  const { load: loadUsage } = usage;
  const now = screenNow(usePageClock(), routes.loadedAt, routes.offsetMs);
  const usageMap = useMemo(() => usageByName(usage.data), [usage.data]);

  const requestRef = useRef(0);
  /** The page's one read of the configuration (aliases-page.md 3.4). Nothing is editable until it answers. */
  const read = useCallback(async () => {
    const id = ++requestRef.current;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      id === requestRef.current && revision === apiClient.getConnectionRevision();
    send({ type: 'read-started' });
    try {
      const state = await aliasesApi.load(apiClient.captureConnection(isCurrent));
      if (!isCurrent()) return;
      send({ type: 'read-answered', state });
    } catch (error) {
      if (!isCurrent()) return;
      send({ type: 'read-failed', message: getErrorMessage(error) });
    }
  }, [send]);

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    void read();
    return () => {
      requestRef.current += 1;
    };
  }, [connectionStatus, read]);

  const { draft } = page;
  const dirty = isDirty(page);
  const editable = canEdit(page);
  const changes = useMemo(() => (draft ? changeCount(draft) : 0), [draft]);
  const blocked = useMemo(() => (draft ? blockedEntries(draft).length > 0 : false), [draft]);
  const toFix = useMemo(() => (draft ? blockingCount(rowIssues(draft)) : 0), [draft]);

  /** Everything the page shows, read again; the configuration only after asking, when it has edits. */
  const refresh = useCallback(async () => {
    const others = Promise.all([refreshRoutes(), loadLists(), loadUsage()]);
    const current = pageRef.current;
    if (current.saving || current.reading) return void (await others);
    if (!isDirty(current)) return void (await Promise.all([read(), others]));
    showConfirmation({
      title: t('provimux.aliases.reload_title'),
      message: t('provimux.aliases.reload_message'),
      confirmText: t('provimux.aliases.reload_confirm'),
      cancelText: t('provimux.aliases.unsaved_cancel'),
      variant: 'danger',
      onConfirm: () => {
        void read();
      },
    });
    await others;
  }, [loadLists, loadUsage, read, refreshRoutes, showConfirmation, t]);
  useHeaderRefresh(refresh);

  // The list of edits not saved is the only copy of what was typed: leaving asks first, as with edits.
  const guarded = leaveGuarded(page);
  useUnsavedChangesGuard({
    shouldBlock: guarded,
    dialog: dirty
      ? {
          title: t('provimux.aliases.unsaved_title'),
          message: t('provimux.aliases.unsaved_message'),
          confirmText: t('provimux.aliases.unsaved_confirm'),
          cancelText: t('provimux.aliases.unsaved_cancel'),
          variant: 'danger',
        }
      : {
          title: t('provimux.aliases.leave_lost_title'),
          message: t('provimux.aliases.leave_lost_message'),
          confirmText: t('provimux.aliases.unsaved_confirm'),
          cancelText: t('provimux.aliases.unsaved_cancel'),
          variant: 'danger',
        },
  });

  // The browser's own reload or tab close leaves without React Router: its own dialog asks then.
  useEffect(() => {
    if (!guarded) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [guarded]);

  const save = useCallback(async () => {
    const before = pageRef.current;
    if (!before.draft || !isDirty(before) || blockedEntries(before.draft).length) return;
    const started = send({ type: 'save-started' });
    if (started === before || !started.draft) return;
    const sent = started.draft;
    let outcome: CommitOutcome;
    try {
      outcome = await aliasesApi.commit(sent);
    } catch (error) {
      // A change of the management connection aborts the save before a write (aliases-page.md 3.4).
      outcome = {
        confirmed: [],
        unconfirmed: planCommit(sent).flatMap((unit) => unit.entryIds),
        failure: { reason: 'error', message: getErrorMessage(error) },
      };
    }
    send({ type: 'save-answered', outcome });
    useConfigStore.getState().clearCache();
    if (outcome.failure === null) showNotification(t('provimux.models.saved'), 'success');
    else showNotification(t('provimux.aliases.save_not_whole'), 'warning');
    await Promise.all([read(), loadRoutes()]);
  }, [loadRoutes, read, send, showNotification, t]);

  const edit = useCallback(
    (change: (current: AliasDraft) => AliasDraft) => send({ type: 'edited', change }),
    [send]
  );

  const statusText = page.saving
    ? t('provimux.aliases.saving')
    : blocked
      ? t('provimux.aliases.blocked', { count: toFix })
      : t('provimux.aliases.unsaved', { count: Math.max(changes, 1) });

  return (
    <div className={`${shared.page} ${styles.page}`}>
      <header className={shared.header}>
        <div className={shared.headerText}>
          <h1 className={shared.title}>{t('provimux.models.title')}</h1>
          <p className={shared.lede}>{t('provimux.models.lede')}</p>
        </div>
        <div className={shared.headerActions}>
          {routes.loadedAt ? (
            <span
              className={shared.updated}
              title={formatExact(routes.loadedAt + routes.offsetMs, i18n.language)}
            >
              {t('provimux.common.updated', {
                time: formatClock(routes.loadedAt + routes.offsetMs, i18n.language, now),
              })}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
            loading={(page.reading && draft !== null) || (routes.loading && routes.data !== null)}
            disabled={page.saving}
          >
            <IconRefreshCw size={14} />
            {t('provimux.common.reload')}
          </Button>
        </div>
      </header>

      <ModelsBody
        page={page}
        routes={routes.data}
        routesKnown={routesStatus === 'unsupported' ? false : routes.data !== null ? true : null}
        routesError={routes.error}
        routesOffsetMs={routes.offsetMs}
        lists={lists.data}
        usage={usageMap}
        nowMs={now}
        filter={filter}
        onFilter={setFilter}
        edit={edit}
        devin={devin}
        onRoutesChanged={() => void Promise.all([loadRoutes(), loadLists()])}
        onRetry={() => void read()}
        onDismiss={(key) => send({ type: 'dismissed', key })}
      />

      <FloatingSaveBar
        visible={saveBarShown(page)}
        statusText={statusText}
        statusTone={page.saving ? 'busy' : blocked ? 'error' : 'warning'}
        saving={page.saving}
        saveDisabled={!editable || !dirty || blocked}
        discardDisabled={!editable}
        onSave={() => void save()}
        onDiscard={() => send({ type: 'discarded' })}
      />
    </div>
  );
}

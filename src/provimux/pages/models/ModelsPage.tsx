import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { BlockerFunction } from 'react-router';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { FloatingSaveBar } from '@/features/config/components/FloatingSaveBar';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { apiClient } from '@/services/api/client';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { errorStatus, provimuxApi } from '../../api/provimuxApi';
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
import { EMPTY_EXCLUDED_FILTER, readExclusions, type ExcludedFilter } from '../excluded/exclusions';
import { exclusionsApi, ExclusionRequestError } from '../excluded/exclusionsApi';
import type { ExclusionWriteRequest } from '../excluded/ExcludedView';
import { ExclusionWriteError } from '../excluded/writes';
import type { ProvimuxModelListsResponse } from '../../api/types';
import { usePageClock } from '../shared/clocks';
import { useProvimuxResource } from '../shared/useProvimuxResource';
import { formatClock, formatExact, screenNow } from '../time';
import { useDevinCooling } from '../modelRoutes/useDevinCooling';
import { keyListsSupported } from '../keyLists/keyLists';
import {
  initialModelsFilter,
  detailsByLogin,
  loginsToDetail,
  type ModelDetail,
  usageByName,
  type ModelsFilter,
} from './catalog';
import { ModelsBody, type ModelsTab } from './ModelsBody';
import type { BoardNames } from './ModelsBoard';
import {
  droppedBySave,
  readSetting,
  setNamesOf,
  switchState,
  usageSinceOf,
  usageStateOf,
} from './namesSetting';
import {
  FALLBACK_READS_MS,
  appliedMatches,
  applyingOf,
  waitApplied,
  type PendingWrite,
} from './namesApplied';
import type { NamesWrite } from './OnlyMyNames';
import { NamesRequestError, onlyMyNamesApi } from './onlyMyNamesApi';
import { tabOf } from './address';
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
const fetchNames = (client: Parameters<typeof provimuxApi.names>[0]) => provimuxApi.names(client);

/**
 * Models (design models-page.md): every name a client can send, with the routes that serve it in the order
 * they are tried; the owner's names first. Names, the models under them and API keys' priorities are edited
 * as one draft over one read of the configuration and saved with one action, exactly as the Aliases page
 * did (aliases-page.md 3.4, 3.6): the same requests, each with If-Match. The routes, lists and usage are
 * read from Provimux's endpoints; without them the page shows the configuration's names only.
 */
export function ModelsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
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
  // The view shown: read from the address when the page opens (`?tab=excluded&model=…`, so a name's mark
  // is a link that works in a new tab), then kept here and written back to the address. The page keeps the
  // location it opened with while only its query changes (upstream's page transition), so a change of the
  // query alone never reaches it: switching is this state, not a navigation.
  const [tab, setTab] = useState<ModelsTab>(() => tabOf(searchParams));
  const [excludedFilter, setExcludedFilter] = useState<ExcludedFilter>(() => ({
    ...EMPTY_EXCLUDED_FILTER,
    query: searchParams.get('model') ?? '',
  }));
  const [writing, setWriting] = useState<string | null>(null);
  const showTab = useCallback(
    (next: ModelsTab, model?: string) => {
      setTab(next);
      if (model !== undefined) setExcludedFilter({ ...EMPTY_EXCLUDED_FILTER, query: model });
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          params.delete('model');
          if (next === 'excluded') params.set('tab', 'excluded');
          else params.delete('tab');
          if (next === 'excluded' && model) params.set('model', model);
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const showExcluded = useCallback((model: string) => showTab('excluded', model), [showTab]);

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
  // "Serve only my names" (models-page.md 8): read like the routes, so refused names show within 30 s.
  const names = useProvimuxResource('names', fetchNames, POLL_MS, undefined, {
    headerRefresh: false,
  });
  const namesStatus = useProvimuxPresence((state) => state.names.status);
  const routesStatus = useProvimuxPresence((state) => state.modelRoutes.status);
  const listsStatus = useProvimuxPresence((state) => state.modelLists.status);
  // OpenAI-compatible entries have exclusions of their own on a server with self-refreshing key lists.
  const compatibleExclusions = keyListsSupported(lists.data, listsStatus) === true;
  const { refresh: refreshRoutes, load: loadRoutes } = routes;
  const { load: loadLists } = lists;
  const { load: loadUsage } = usage;
  const { load: loadNames } = names;
  /**
   * After a write of the configuration (models-page.md 8.1): the gateway answers it before its accounts have
   * registered again, and its names describe the rule it applies now. The page reads them again until their
   * `applied` marker is the configuration the write left (`waitApplied`); until then, and past the limit, the
   * switch says the change is not applied yet. A gateway without the marker is read again at fixed delays.
   */
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const waitRef = useRef(0);
  const fallbackTimers = useRef<number[]>([]);
  const settle = useCallback(
    async (target: string | null, before: string | null = null) => {
      const id = ++waitRef.current;
      for (const timer of fallbackTimers.current) window.clearTimeout(timer);
      fallbackTimers.current = [];
      const fallback = () => {
        setPending(null);
        fallbackTimers.current = FALLBACK_READS_MS.map((delay) =>
          window.setTimeout(() => void Promise.all([loadRoutes(), loadNames()]), delay)
        );
      };
      if (!target) {
        fallback();
        await Promise.all([loadRoutes(), loadNames()]);
        return 'unsupported' as const;
      }
      // "Applying…" only once a read says the write is not in force yet: the gateway commits a write within
      // milliseconds of answering it, so the first read usually reflects it, and saying "it serves the names as
      // before" until that read would be untrue for those milliseconds.
      let first = true;
      const started = Date.now();
      const outcome = await waitApplied({
        target,
        read: async () => {
          const result = await loadNames();
          const marker =
            result === null
              ? undefined
              : result.ok
                ? result.data.applied
                : // A gateway without the endpoint cannot say; any other failure is tried again.
                  errorStatus(result.error) === 404
                  ? null
                  : undefined;
          if (first && id === waitRef.current) {
            first = false;
            if (marker !== null && !(marker && appliedMatches(marker, target)))
              setPending({ target, late: false });
          }
          return marker;
        },
        // The file as it is now, unless it is back at the tag the write was conditional on.
        current: async () => {
          const now = await onlyMyNamesApi.configTag();
          return now !== null && now !== before ? now : null;
        },
        sleepUntil: (ms) =>
          new Promise((resolve) =>
            window.setTimeout(resolve, Math.max(0, started + ms - Date.now()))
          ),
        cancelled: () => id !== waitRef.current,
      });
      if (outcome === 'cancelled') return outcome;
      if (outcome === 'unsupported') fallback();
      else if (outcome === 'late') setPending({ target, late: true });
      else setPending(null);
      await loadRoutes();
      return outcome;
    },
    [loadNames, loadRoutes]
  );
  useEffect(
    () => () => {
      waitRef.current += 1;
      for (const timer of fallbackTimers.current) window.clearTimeout(timer);
    },
    []
  );
  // Past the limit, the page's own 30 s reads still look: the line goes once an answer reflects the write.
  const namesApplied = names.data?.applied ?? null;
  useEffect(() => {
    if (!pending?.late || !namesApplied || !appliedMatches(namesApplied, pending.target)) return;
    setPending(null);
    void loadRoutes();
  }, [loadRoutes, namesApplied, pending]);
  const applying = applyingOf(namesApplied, pending);
  /**
   * The configuration's tag a write left: the page's read after it when that moved (it may hold a later write from
   * elsewhere, which the gateway then applies instead), else the write's own answer.
   */
  const tagAfter = useCallback((before: string | null, written: string | null) => {
    const read = pageRef.current.draft?.base.etag ?? null;
    return read !== null && read !== before ? read : written;
  }, []);
  const now = screenNow(usePageClock(), routes.loadedAt, routes.offsetMs);
  const usageMap = useMemo(() => usageByName(usage.data), [usage.data]);
  const details = useModelDetails(lists.data);

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
  const base = draft?.base ?? null;
  const excludedCount = useMemo(
    () =>
      base ? readExclusions(base, { compatible: compatibleExclusions }).exclusions.length : null,
    [base, compatibleExclusions]
  );
  const editable = canEdit(page);
  const changes = useMemo(() => (draft ? changeCount(draft) : 0), [draft]);
  const blocked = useMemo(() => (draft ? blockedEntries(draft).length > 0 : false), [draft]);
  const toFix = useMemo(() => (draft ? blockingCount(rowIssues(draft)) : 0), [draft]);

  /** Everything the page shows, read again; the configuration only after asking, when it has edits. */
  const refresh = useCallback(async () => {
    const others = Promise.all([refreshRoutes(), loadLists(), loadUsage(), loadNames()]);
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
  }, [loadLists, loadNames, loadUsage, read, refreshRoutes, showConfirmation, t]);
  useHeaderRefresh(refresh);

  // The list of edits not saved is the only copy of what was typed: leaving asks first, as with edits.
  const guarded = leaveGuarded(page);
  // Switching between names and excluded models keeps the draft: only leaving the page asks.
  const leaving = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      guarded && currentLocation.pathname !== nextLocation.pathname,
    [guarded]
  );
  useUnsavedChangesGuard({
    shouldBlock: leaving,
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
    // His names follow his alias rows: with the switch on, what is served changes with a save. The save bar is
    // free at once; the switch says while the gateway applies it.
    await read();
    if (outcome.confirmed.length) void settle(tagAfter(sent.base.etag, null), sent.base.etag);
    else await Promise.all([loadRoutes(), loadNames()]);
  }, [loadNames, loadRoutes, read, send, settle, showNotification, t, tagAfter]);

  const edit = useCallback(
    (change: (current: AliasDraft) => AliasDraft) => send({ type: 'edited', change }),
    [send]
  );

  /**
   * One exclusion added or removed (models-page.md 6): written at once, with If-Match on the page's read, and
   * only over a draft with no edits. The page then reads again, whatever the answer.
   */
  const writeExclusion = useCallback(
    async ({ change, model, place }: ExclusionWriteRequest, id: string): Promise<boolean> => {
      const before = pageRef.current;
      const base = before.draft?.base;
      if (!base) return false;
      const started = send({ type: 'write-started' });
      if (started === before) return false;
      setWriting(id);
      let done = false;
      let written: string | null = null;
      try {
        written = await exclusionsApi.write(base, change);
        done = true;
        showNotification(
          t(change.excluded ? 'provimux.excluded.added' : 'provimux.excluded.removed', {
            model,
            place,
          }),
          'success'
        );
      } catch (error) {
        const reason =
          error instanceof ExclusionRequestError
            ? error.reason
            : error instanceof ExclusionWriteError
              ? error.code === 'not-found'
                ? 'changed'
                : 'refused'
              : 'error';
        const message =
          reason === 'changed'
            ? t('provimux.excluded.write_changed')
            : reason === 'no-tag'
              ? t('provimux.excluded.write_no_tag')
              : reason === 'refused'
                ? t('provimux.excluded.write_refused', { message: getErrorMessage(error) })
                : t('provimux.excluded.write_failed', { message: getErrorMessage(error) });
        showNotification(message, reason === 'changed' ? 'warning' : 'error');
      } finally {
        setWriting(null);
        send({ type: 'write-ended' });
        useConfigStore.getState().clearCache();
      }
      await read();
      // What accounts register moves with an exclusion: the names wait on it as on their own writes.
      if (done) void settle(tagAfter(base.etag, written), base.etag);
      else await loadRoutes();
      return done;
    },
    [loadRoutes, read, send, settle, showNotification, t, tagAfter]
  );

  /**
   * "Serve only my names" written whole, at once (models-page.md 8.5): with If-Match on the page's read, and only
   * over a draft with no edits. The page then reads the configuration, the routes and the names again.
   */
  const namesOn = names.data !== null && switchState(names.data) === 'on';
  const writeNames = useCallback(
    async (write: NamesWrite): Promise<boolean> => {
      const before = pageRef.current;
      const base = before.draft?.base;
      if (!base) return false;
      const started = send({ type: 'write-started' });
      if (started === before) return false;
      setWriting(write.id);
      let written: string | null = null;
      let failure: string | null = null;
      try {
        written = await onlyMyNamesApi.write(base, write.body);
      } catch (error) {
        const reason = error instanceof NamesRequestError ? error.reason : 'error';
        failure =
          reason === 'changed'
            ? t('provimux.names.write_changed')
            : reason === 'no-tag'
              ? t('provimux.names.blocked_no_tag')
              : reason === 'unreadable'
                ? t('provimux.names.blocked_unreadable')
                : reason === 'refused'
                  ? t('provimux.names.write_refused', { message: getErrorMessage(error) })
                  : t('provimux.names.write_failed', { message: getErrorMessage(error) });
        showNotification(failure, reason === 'changed' ? 'warning' : 'error');
      } finally {
        send({ type: 'write-ended' });
        useConfigStore.getState().clearCache();
      }
      await read();
      if (failure !== null) {
        setWriting(null);
        await Promise.all([loadRoutes(), loadNames()]);
        return false;
      }
      // The button stays busy until the gateway serves the change: its notification says it is done only then.
      const outcome = await settle(tagAfter(base.etag, written), base.etag);
      setWriting(null);
      if (outcome === 'cancelled') return true;
      if (outcome === 'late') {
        showNotification(t('provimux.names.not_applied_notice'), 'warning');
        return true;
      }
      const [first] = write.names;
      const on = write.kind === 'on' || (write.kind !== 'off' && namesOn);
      const message =
        write.kind === 'on'
          ? t('provimux.names.turned_on')
          : write.kind === 'off'
            ? t('provimux.names.turned_off')
            : write.kind === 'drop-ignored'
              ? t('provimux.names.ignored_removed', { count: write.names.length })
              : write.kind === 'unkeep'
                ? t(on ? 'provimux.names.unkept_on' : 'provimux.names.unkept', { name: first })
                : write.names.length > 1
                  ? t('provimux.names.kept_many', { count: write.names.length })
                  : t(on ? 'provimux.names.kept_on' : 'provimux.names.kept', { name: first });
      showNotification(message, 'success');
      return true;
    },
    [loadNames, loadRoutes, namesOn, read, send, settle, showNotification, t, tagAfter]
  );
  const usageState = usageStateOf(usage.data, usage.error !== null && usage.data === null);
  const usageSince = usageSinceOf(usage.data);
  const boardNames = useMemo(
    (): BoardNames | undefined =>
      namesStatus === 'unsupported'
        ? undefined
        : {
            answer: names.data,
            error: names.data === null ? names.error : null,
            usage: usageState,
            usageSince,
            applying,
            write: writeNames,
            refreshUsage: () => void loadUsage(),
          },
    [applying, loadUsage, names.data, names.error, namesStatus, usageSince, usageState, writeNames]
  );
  // With the switch on, a save that takes a name's last alias away stops serving it: the bar says so.
  const dropped = useMemo(() => {
    if (!draft || !namesOn || !names.data) return [];
    return droppedBySave(draft, setNamesOf(names.data, readSetting(draft.base.document), 'config'));
  }, [draft, names.data, namesOn]);

  const baseStatus = page.saving
    ? t('provimux.aliases.saving')
    : blocked
      ? t('provimux.aliases.blocked', { count: toFix })
      : t('provimux.aliases.unsaved', { count: Math.max(changes, 1) });
  const statusText =
    dropped.length && !page.saving && !blocked
      ? `${baseStatus} · ${t('provimux.names.save_drops', {
          count: dropped.length,
          names: dropped.join(', '),
        })}`
      : baseStatus;

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

      <div className={styles.tabs} role="tablist" aria-label={t('provimux.models.tabs_label')}>
        <button
          type="button"
          role="tab"
          id="pmx-models-tab-names"
          aria-selected={tab === 'names'}
          aria-controls="pmx-models-panel"
          className={styles.tab}
          onClick={() => showTab('names')}
        >
          {t('provimux.models.tab_names')}
        </button>
        <button
          type="button"
          role="tab"
          id="pmx-models-tab-excluded"
          aria-selected={tab === 'excluded'}
          aria-controls="pmx-models-panel"
          className={styles.tab}
          onClick={() => showTab('excluded')}
        >
          {t('provimux.models.tab_excluded')}
          {excludedCount !== null ? <span className={styles.tabCount}>{excludedCount}</span> : null}
        </button>
      </div>

      <ModelsBody
        tab={tab}
        excludedFilter={excludedFilter}
        onExcludedFilter={setExcludedFilter}
        writing={writing}
        compatibleExclusions={compatibleExclusions}
        onWriteExclusion={writeExclusion}
        onShowExcluded={showExcluded}
        page={page}
        routes={routes.data}
        routesKnown={routesStatus === 'unsupported' ? false : routes.data !== null ? true : null}
        routesError={routes.error}
        routesOffsetMs={routes.offsetMs}
        lists={lists.data}
        usage={usageMap}
        details={details}
        nowMs={now}
        filter={filter}
        onFilter={setFilter}
        edit={edit}
        devin={devin}
        onRoutesChanged={() => void Promise.all([loadRoutes(), loadLists()])}
        onRetry={() => void read()}
        onDismiss={(key) => send({ type: 'dismissed', key })}
        names={boardNames}
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

/**
 * Each login's models with where their limits come from (Model lists asked per login, `?auth_index=`): asked
 * once per login, and again only when its list changed. A failed ask leaves the login out: its routes then
 * say nothing about where a limit comes from.
 */
function useModelDetails(
  lists: ProvimuxModelListsResponse | null
): Record<string, Record<string, ModelDetail>> {
  const [details, setDetails] = useState<Record<string, Record<string, ModelDetail>>>({});
  const asked = useRef(new Map<string, string>());
  const logins = useMemo(() => loginsToDetail(lists), [lists]);
  useEffect(() => {
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () => revision === apiClient.getConnectionRevision();
    for (const { authIndex, version } of logins) {
      if (asked.current.get(authIndex) === version) continue;
      asked.current.set(authIndex, version);
      provimuxApi
        .modelLists(apiClient.captureConnection(isCurrent), authIndex)
        .then((answer) => {
          if (!isCurrent()) return;
          const models = detailsByLogin([answer])[authIndex] ?? {};
          setDetails((prev) => ({ ...prev, [authIndex]: models }));
        })
        .catch(() => {
          // A detail only: without it the routes say nothing about where a limit comes from.
        });
    }
  }, [logins]);
  return details;
}

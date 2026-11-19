import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconInfo, IconLoader2, IconRefreshCw } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { getTypeLabel } from '@/features/authFiles/constants';
import { useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { provimuxApi } from '../../api/provimuxApi';
import type { ProvimuxLiveListLogin } from '../../api/types';
import { loginText } from '../modelRoutes/logic';
import { usePageClock } from '../shared/clocks';
import { ProviderPill } from '../shared/ProviderPill';
import { useProvimuxResource } from '../shared/useProvimuxResource';
import { formatClock, formatExact, formatRelative, screenNow, timeMs } from '../time';
import { failureHint, liveRowState, liveSummary, type LiveRowState } from './logic';
import { followRefresh, type FollowProgress } from './refreshFollower';
import shared from '../shared/Shared.module.scss';
import styles from './LiveListsPage.module.scss';

const fetchLists = (client: Parameters<typeof provimuxApi.liveLists>[0]) =>
  provimuxApi.liveLists(client);

/** A refresh of the lists, from the click to its end. Shown in the switch card; Refresh is off only while following. */
type RefreshState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | ({ phase: 'following'; catalogError: string | null } & FollowProgress)
  | { phase: 'done'; catalogError: string | null; done: number; total: number }
  | {
      phase: 'deadline';
      catalogError: string | null;
      done: number;
      total: number;
      readError: string | null;
    }
  | { phase: 'failed'; message: string };

/** Live model lists: the switch, a refresh, and per login where its model list comes from. */
export function LiveListsPage() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const resource = useProvimuxResource('liveLists', fetchLists, null);
  const now = screenNow(usePageClock(), resource.loadedAt, resource.offsetMs);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState<RefreshState>({ phase: 'idle' });
  const followerRef = useRef<{ cancel: () => void } | null>(null);

  const data = resource.data;
  const enabled = data?.enabled ?? null;
  const logins = useMemo(() => data?.logins ?? [], [data]);
  const summary = useMemo(() => liveSummary(logins), [logins]);
  const { load } = resource;
  const busy = refresh.phase === 'starting' || refresh.phase === 'following';

  useEffect(() => () => followerRef.current?.cancel(), []);

  const startRefresh = async () => {
    followerRef.current?.cancel();
    setRefresh({ phase: 'starting' });
    const sinceMs = Date.now() + resource.offsetMs;
    let catalogError: string | null;
    try {
      // A 502 from Provimux means the catalog could not be read, while the logins are being asked anyway.
      ({ catalogError } = await provimuxApi.refreshModels());
    } catch (error) {
      setRefresh({ phase: 'failed', message: getErrorMessage(error) });
      return;
    }
    const initial = data?.logins ?? [];
    const waitingFor = initial.filter((row) => !row.disabled).length;
    setRefresh({
      phase: 'following',
      catalogError,
      done: 0,
      total: waitingFor,
      readError: null,
      reads: 0,
    });
    followerRef.current = followRefresh({
      sinceMs,
      initial,
      read: async () => {
        const result = await load();
        if (result === null) return null;
        if (!result.ok) throw result.error;
        return result.data.logins;
      },
      onProgress: (progress) => setRefresh({ phase: 'following', catalogError, ...progress }),
      onEnd: (end) => {
        followerRef.current = null;
        if (end.kind === 'done') {
          setRefresh({ phase: 'done', catalogError, done: end.done, total: end.total });
          showNotification(
            catalogError
              ? t('provimux.live.refresh_done_catalog')
              : t('provimux.live.refresh_done'),
            catalogError ? 'warning' : 'success'
          );
        } else {
          setRefresh({
            phase: 'deadline',
            catalogError,
            done: end.done,
            total: end.total,
            readError: end.readError,
          });
          showNotification(t('provimux.live.refresh_stopped_short'), 'warning');
        }
      },
    });
  };

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      await provimuxApi.setLiveLists(next);
      useConfigStore.getState().clearCache();
      showNotification(
        next ? t('provimux.live.saved_on') : t('provimux.live.saved_off'),
        'success'
      );
      await load();
    } catch (error) {
      showNotification(
        t('provimux.common.save_failed', { message: getErrorMessage(error) }),
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const firstLoad = data === null && resource.loading;
  const providersText = (data?.providers ?? []).map((p) => getTypeLabel(t, p)).join(', ');

  return (
    <div className={shared.page}>
      <header className={shared.header}>
        <div className={shared.headerText}>
          <h1 className={shared.title}>{t('provimux.live.title')}</h1>
          <p className={shared.lede}>{t('provimux.live.lede')}</p>
        </div>
        <div className={shared.headerActions}>
          {resource.loadedAt ? (
            <span
              className={shared.updated}
              title={formatExact(resource.loadedAt + resource.offsetMs, i18n.language)}
            >
              {t('provimux.common.updated', {
                time: formatClock(resource.loadedAt + resource.offsetMs, i18n.language, now),
              })}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            loading={resource.loading && data !== null && !busy}
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
          <Skeleton height={140} />
          <Skeleton height={260} />
        </div>
      ) : data === null ? (
        <EmptyState
          title={t('provimux.live.load_failed')}
          description={resource.error ?? undefined}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              {t('provimux.common.retry')}
            </Button>
          }
        />
      ) : (
        <>
          {resource.error ? (
            <p className={shared.inlineError} role="alert">
              {t('provimux.common.refresh_failed', { message: resource.error })}
            </p>
          ) : null}

          <section
            className={`${shared.feature} ${styles.switchCard}`}
            aria-labelledby="pmx-live-switch"
          >
            <div className={shared.featureHead}>
              <div className={shared.featureTitles}>
                <h2 id="pmx-live-switch" className={shared.featureTitle}>
                  {t('provimux.live.switch_title')}
                </h2>
                <p className={shared.featureEyebrow}>
                  <code>models.live-lists</code>
                </p>
              </div>
              <div className={shared.featureControl}>
                <ToggleSwitch
                  checked={enabled === true}
                  onChange={(next) => void toggle(next)}
                  disabled={saving || enabled === null}
                  ariaLabel={t('provimux.live.switch_label')}
                  labelPosition="left"
                  label={
                    <span className={shared.switchState}>
                      {enabled === null
                        ? t('provimux.common.unknown')
                        : enabled
                          ? t('provimux.common.on')
                          : t('provimux.common.off')}
                    </span>
                  }
                />
              </div>
            </div>
            <p className={shared.featureText}>
              {enabled === null
                ? t('provimux.live.unknown_text')
                : enabled
                  ? t('provimux.live.on_text')
                  : t('provimux.live.off_text')}
            </p>
            <div className={styles.refreshRow}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void startRefresh()}
                disabled={enabled !== true || busy}
                loading={refresh.phase === 'starting'}
              >
                <IconRefreshCw size={14} />
                {t('provimux.live.refresh_now')}
              </Button>
              <RefreshStatus refresh={refresh} enabled={enabled} />
            </div>
            {'catalogError' in refresh && refresh.catalogError ? (
              <p className={styles.refreshNote} data-tone="warning" role="status">
                {t('provimux.live.catalog_failed', { message: refresh.catalogError })}
              </p>
            ) : null}
          </section>

          {logins.length > 0 ? (
            <div className={shared.chips} aria-label={t('provimux.live.summary_label')}>
              <span className={shared.chip} data-tone="brand">
                {t('provimux.live.count_live', { count: summary.live })}
              </span>
              <span className={shared.chip}>
                {t('provimux.live.count_catalog', { count: summary.catalog })}
              </span>
              {summary.unknown > 0 ? (
                <span className={shared.chip}>
                  {t('provimux.live.count_unknown', { count: summary.unknown })}
                </span>
              ) : null}
              {summary.failing > 0 ? (
                <span className={shared.chip} data-tone="cooling">
                  {t('provimux.live.count_failing', { count: summary.failing })}
                </span>
              ) : null}
              {summary.fetching > 0 ? (
                <span className={shared.chip}>
                  <IconLoader2 size={12} className={styles.spin} />
                  {t('provimux.live.count_fetching', { count: summary.fetching })}
                </span>
              ) : null}
            </div>
          ) : null}

          {logins.length === 0 ? (
            <EmptyState
              title={t('provimux.live.empty_title')}
              description={t('provimux.live.empty_text', { providers: providersText || '—' })}
            />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('provimux.live.col_login')}</th>
                    <th scope="col">{t('provimux.live.col_source')}</th>
                    <th scope="col">{t('provimux.live.col_fetched')}</th>
                    <th scope="col">{t('provimux.live.col_models')}</th>
                    <th scope="col">{t('provimux.live.col_failure')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logins.map((login, index) => (
                    <LoginRow
                      key={login.auth_index ?? `${login.provider}-${index}`}
                      login={login}
                      state={liveRowState(login, enabled)}
                      nowMs={now}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className={shared.note}>
            <IconInfo size={14} />
            <span>{t('provimux.live.note', { providers: providersText || '—' })}</span>
          </p>
        </>
      )}
    </div>
  );
}

/** The refresh's state, in words, in the switch card (a live region). */
function RefreshStatus({ refresh, enabled }: { refresh: RefreshState; enabled: boolean | null }) {
  const { t } = useTranslation();
  switch (refresh.phase) {
    case 'starting':
      return <span className={styles.refreshHint} aria-live="polite" />;
    case 'following':
      return (
        <span className={styles.refreshHint} aria-live="polite">
          <IconLoader2 size={13} className={styles.spin} />
          {t('provimux.live.refresh_waiting', { done: refresh.done, total: refresh.total })}
          {refresh.readError
            ? ` · ${t('provimux.live.refresh_read_failed', { message: refresh.readError })}`
            : ''}
        </span>
      );
    case 'done':
      return (
        <span className={styles.refreshHint} data-tone="ok" aria-live="polite">
          {t('provimux.live.refresh_done_line', { done: refresh.done, total: refresh.total })}
        </span>
      );
    case 'deadline':
      return (
        <span className={styles.refreshHint} data-tone="warning" aria-live="polite">
          {t('provimux.live.refresh_stopped', {
            done: refresh.done,
            total: refresh.total,
            count: refresh.total,
          })}
          {refresh.readError
            ? ` ${t('provimux.live.refresh_stopped_reads', { message: refresh.readError })}`
            : ''}
        </span>
      );
    case 'failed':
      return (
        <span className={styles.refreshHint} data-tone="error" role="alert">
          {t('provimux.live.refresh_failed', { message: refresh.message })}
        </span>
      );
    default:
      return (
        <span className={styles.refreshHint} aria-live="polite">
          {enabled === true ? t('provimux.live.refresh_hint') : t('provimux.live.refresh_off_hint')}
        </span>
      );
  }
}

function LoginRow({
  login,
  state,
  nowMs,
}: {
  login: ProvimuxLiveListLogin;
  state: LiveRowState;
  nowMs: number;
}) {
  const { t, i18n } = useTranslation();
  const name = loginText({ kind: 'oauth', host: null, login: login.login });
  const fetched = timeMs(login.fetched_at);
  const failure = login.last_failure;
  const failedAt = timeMs(failure?.at);
  const source =
    login.source === 'live' ? 'live' : login.source === 'catalog' ? 'catalog' : 'unknown';

  return (
    <tr className={styles.row} data-state={state}>
      <td data-label={t('provimux.live.col_login')}>
        <div className={styles.loginCell}>
          <ProviderPill provider={login.provider} />
          <span className={styles.loginName}>
            {name.primary ?? t('provimux.routes.runtime_login', { index: login.auth_index ?? '?' })}
          </span>
          {name.secondary ? <span className={styles.loginFile}>{name.secondary}</span> : null}
        </div>
      </td>
      <td data-label={t('provimux.live.col_source')}>
        <div className={styles.sourceCell}>
          <span className={styles.source} data-source={source}>
            {state === 'fetching' ? <IconLoader2 size={12} className={styles.spin} /> : null}
            {source === 'unknown'
              ? t('provimux.live.source_unknown', { source: login.source })
              : t(`provimux.live.source_${source}`)}
          </span>
          <span className={styles.stateNote}>{t(`provimux.live.state_${state}`)}</span>
        </div>
      </td>
      <td data-label={t('provimux.live.col_fetched')}>
        {fetched !== null ? (
          <span className={styles.when} title={formatExact(fetched, i18n.language)}>
            {formatRelative(fetched, nowMs, i18n.language)}
          </span>
        ) : (
          <span className={styles.none}>—</span>
        )}
      </td>
      <td data-label={t('provimux.live.col_models')}>
        <div className={styles.counts}>
          <span>
            {login.registered_models !== null ? (
              <b>{login.registered_models}</b>
            ) : (
              <span className={styles.none}>?</span>
            )}{' '}
            {t('provimux.live.served')}
          </span>
          <span className={styles.listed}>
            {login.listed_models !== null
              ? t('provimux.live.listed', { count: login.listed_models })
              : t('provimux.live.listed_none')}
          </span>
        </div>
      </td>
      <td data-label={t('provimux.live.col_failure')}>
        {failure && failedAt !== null ? (
          <div className={styles.failure}>
            <span className={styles.failureCode} title={formatExact(failedAt, i18n.language)}>
              {failure.category === 'http_status' && failure.http_status !== null
                ? `HTTP ${failure.http_status}`
                : t(`provimux.live.category.${failure.category}`, {
                    defaultValue: failure.category,
                  })}
              <span className={styles.failureWhen}>
                {formatRelative(failedAt, nowMs, i18n.language)}
              </span>
            </span>
            <span className={styles.failureHint}>
              {t(`provimux.live.hint.${failureHint(failure)}`)}
            </span>
          </div>
        ) : (
          <span className={styles.none}>—</span>
        )}
      </td>
    </tr>
  );
}

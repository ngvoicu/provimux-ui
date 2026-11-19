import { useEffect, useMemo, useState } from 'react';
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
import { formatClock, formatExact, formatRelative, serverNow, timeMs } from '../time';
import {
  failureHint,
  liveRowState,
  liveSummary,
  refreshProgress,
  type LiveRowState,
} from './logic';
import shared from '../shared/Shared.module.scss';
import styles from './LiveListsPage.module.scss';

/** After a refresh: ask every 2 s until each login reported back, for at most 60 s (the POST returns at once). */
const REFRESH_POLL_MS = 2_000;
const REFRESH_WAIT_MS = 60_000;
const fetchLists = (client: Parameters<typeof provimuxApi.liveLists>[0]) =>
  provimuxApi.liveLists(client);

interface PendingRefresh {
  /** The server's time of the click. */
  sinceMs: number;
  startedAt: number;
}

/** Live model lists: the switch, a refresh, and per login where its model list comes from. */
export function LiveListsPage() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const resource = useProvimuxResource('liveLists', fetchLists, null);
  const now = serverNow(usePageClock(), resource.offsetMs);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<PendingRefresh | null>(null);
  const [requesting, setRequesting] = useState(false);

  const data = resource.data;
  const enabled = data?.enabled ?? null;
  const logins = useMemo(() => data?.logins ?? [], [data]);
  const summary = useMemo(() => liveSummary(logins), [logins]);
  const progress = pending ? refreshProgress(logins, pending.sinceMs) : null;
  const { load } = resource;

  // While a refresh is pending, ask again every 2 s (not while the tab is hidden).
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [pending, load]);

  // Done when every login reported back after the click; give up waiting after 60 s.
  useEffect(() => {
    if (!pending || !data) return;
    const result = refreshProgress(data.logins, pending.sinceMs);
    if (result.settled) {
      setPending(null);
      showNotification(t('provimux.live.refresh_done'), 'success');
    } else if (Date.now() - pending.startedAt >= REFRESH_WAIT_MS) {
      setPending(null);
      showNotification(
        t('provimux.live.refresh_timeout', { count: result.total - result.done }),
        'info'
      );
    }
  }, [data, pending, showNotification, t]);

  const startRefresh = async () => {
    setRequesting(true);
    const sinceMs = Date.now() + resource.offsetMs;
    try {
      await provimuxApi.refreshModels();
      setPending({ sinceMs, startedAt: Date.now() });
      void load();
    } catch (error) {
      showNotification(
        t('provimux.live.refresh_failed', { message: getErrorMessage(error) }),
        'error'
      );
    } finally {
      setRequesting(false);
    }
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
            loading={resource.loading && data !== null && !pending}
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
              {enabled === false ? t('provimux.live.off_text') : t('provimux.live.on_text')}
            </p>
            <div className={styles.refreshRow}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void startRefresh()}
                disabled={enabled !== true || pending !== null}
                loading={requesting}
              >
                <IconRefreshCw size={14} />
                {t('provimux.live.refresh_now')}
              </Button>
              <span className={styles.refreshHint} aria-live="polite">
                {pending && progress ? (
                  <>
                    <IconLoader2 size={13} className={styles.spin} />
                    {t('provimux.live.refresh_waiting', {
                      done: progress.done,
                      total: progress.total,
                    })}
                  </>
                ) : enabled === true ? (
                  t('provimux.live.refresh_hint')
                ) : (
                  t('provimux.live.refresh_off_hint')
                )}
              </span>
            </div>
          </section>

          {logins.length > 0 ? (
            <div className={shared.chips} aria-label={t('provimux.live.summary_label')}>
              <span className={shared.chip} data-tone="brand">
                {t('provimux.live.count_live', { count: summary.live })}
              </span>
              <span className={shared.chip}>
                {t('provimux.live.count_catalog', { count: summary.catalog })}
              </span>
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

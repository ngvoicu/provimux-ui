import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconAlertTriangle, IconCopy, IconInfo, IconRefreshCw } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { Meter } from '@/features/dashboard/components/Meter';
import { Sparkline } from '@/features/dashboard/components/Sparkline';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { provimuxApi } from '../../api/provimuxApi';
import type {
  ProvimuxSavingsMetrics,
  ProvimuxSavingsModel,
  ProvimuxSavingsPeriod,
  ProvimuxSavingsResponse,
} from '../../api/types';
import { usePageClock } from '../shared/clocks';
import { ProviderPill } from '../shared/ProviderPill';
import { AccessBadge } from '../shared/AccessBadge';
import { useProvimuxResource } from '../shared/useProvimuxResource';
import { formatClock, formatExact, screenNow, timeMs } from '../time';
import {
  DEFAULT_PERIOD,
  SAVINGS_PERIODS,
  accessOfKind,
  apiKeyCostOf,
  byAccess,
  copyLine,
  coverageOf,
  isBaseRates,
  ratesKey,
  dayPoints,
  dayValue,
  findBreakdown,
  formatCompact,
  formatCount,
  formatMoney,
  formatPerMtok,
  formatRate,
  headlineOf,
  hitRateOf,
  hostName,
  isSavingsPeriod,
  keyLabel,
  recordedSinceInRange,
  savingsStates,
  unpricedModels,
  usesProvimuxTable,
  zoneLabel,
  type SavingsState,
} from './logic';
import shared from '../shared/Shared.module.scss';
import styles from './SavingsPage.module.scss';

/** On open, on a refresh, on a change of period, and every 60 s while the tab is visible. */
const POLL_MS = 60_000;
const PERIOD_STORAGE_KEY = 'provimux.savings.period';

/** The chosen period lasts for the session (this tab), across reloads. */
function storedPeriod(): ProvimuxSavingsPeriod {
  try {
    const value = window.sessionStorage.getItem(PERIOD_STORAGE_KEY);
    return isSavingsPeriod(value) ? value : DEFAULT_PERIOD;
  } catch {
    return DEFAULT_PERIOD;
  }
}

function storePeriod(period: ProvimuxSavingsPeriod) {
  try {
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, period);
  } catch {
    // Storage off: the choice lasts while the page is open.
  }
}

/** Savings: what caching saved, what each account kind served, what the API keys cost, and on what basis. */
export function SavingsPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<ProvimuxSavingsPeriod>(storedPeriod);
  const fetcher = useCallback(
    (client: Parameters<typeof provimuxApi.savings>[0]) => provimuxApi.savings(client, period),
    [period]
  );
  const resource = useProvimuxResource('savings', fetcher, POLL_MS);
  const { load } = resource;

  // An answer for an earlier choice is never shown as this one's (the hook drops it when it arrives late).
  const data =
    resource.data && (resource.data.range.period ?? period) === period ? resource.data : null;
  const waiting = data === null && (resource.loading || resource.data !== null);

  const choose = (next: ProvimuxSavingsPeriod) => {
    storePeriod(next);
    setPeriod(next);
  };

  return (
    <div className={shared.page}>
      <header className={shared.header}>
        <div className={shared.headerText}>
          <h1 className={shared.title}>{t('provimux.savings.title')}</h1>
          <p className={shared.lede}>{t('provimux.savings.lede')}</p>
        </div>
        <div className={shared.headerActions}>
          <UpdatedAt loadedAt={resource.loadedAt} offsetMs={resource.offsetMs} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            loading={resource.loading && data !== null}
          >
            <IconRefreshCw size={14} />
            {t('provimux.common.reload')}
          </Button>
        </div>
      </header>

      <div className={shared.toolbar}>
        <div
          className={`${shared.segmented} ${styles.periods}`}
          role="group"
          aria-label={t('provimux.savings.period_label')}
        >
          {SAVINGS_PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => choose(value)}
            >
              {t(`provimux.savings.period.${value}`)}
            </button>
          ))}
        </div>
      </div>

      {waiting ? (
        <div
          className={shared.skeletons}
          aria-busy="true"
          aria-label={t('provimux.common.loading')}
        >
          <Skeleton height={180} />
          <Skeleton height={140} />
          <Skeleton height={220} />
        </div>
      ) : data === null ? (
        <EmptyState
          title={t('provimux.savings.load_failed')}
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
          <SavingsView data={data} />
        </>
      )}
    </div>
  );
}

function UpdatedAt({ loadedAt, offsetMs }: { loadedAt: number | null; offsetMs: number }) {
  const { t, i18n } = useTranslation();
  const now = screenNow(usePageClock(), loadedAt, offsetMs);
  if (!loadedAt) return null;
  return (
    <span className={shared.updated} title={formatExact(loadedAt + offsetMs, i18n.language)}>
      {t('provimux.common.updated', {
        time: formatClock(loadedAt + offsetMs, i18n.language, now),
      })}
    </span>
  );
}

/** The page for one answer. Exported for static rendering in tests. */
export function SavingsView({ data }: { data: ProvimuxSavingsResponse }) {
  const { t } = useTranslation();
  const states = useMemo(() => savingsStates(data), [data]);

  if (states.includes('nothing_recorded')) {
    return (
      <>
        <Basis data={data} />
        <section className={`${shared.feature} ${styles.empty}`} aria-labelledby="pmx-sv-empty">
          <h2 id="pmx-sv-empty" className={shared.featureTitle}>
            {t('provimux.savings.state.nothing_recorded_title')}
          </h2>
          <p className={shared.featureText}>{t('provimux.savings.state.nothing_recorded')}</p>
        </section>
        <Notices data={data} states={states.filter((state) => state !== 'nothing_recorded')} />
      </>
    );
  }

  return (
    <>
      <Basis data={data} />
      <Notices data={data} states={states} />
      <Headline data={data} states={states} />
      <div className={styles.grid}>
        <AccessCard data={data} />
        <SubscriptionCard data={data} />
        <ApiKeyCard data={data} />
        <HitRateCard totals={data.totals} />
      </div>
      <KeysCard data={data} />
      <div className={styles.details}>
        <ModelsDetails data={data} />
        <DaysDetails data={data} />
        <HostsDetails data={data} />
        <TokensDetails totals={data.totals} />
      </div>
      <p className={shared.note}>
        <IconInfo size={14} />
        <span>
          {t('provimux.savings.attempts')} {t(ratesKey('provimux.savings.note', data))}
        </span>
      </p>
    </>
  );
}

/** A model's provider has no host in the answer; OpenRouter's own executor is named as OpenRouter. */
const hostOfProvider = (provider: string): string | undefined =>
  provider === 'openrouter' ? 'openrouter.ai' : undefined;

/* ---------- what the numbers cover: always visible ---------- */

function formatDay(day: string, language: string, withYear = true): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  try {
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(language, {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  } catch {
    return day;
  }
}

function formatDate(ms: number, language: string): string {
  try {
    return new Date(ms).toLocaleString(language, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

function Basis({ data }: { data: ProvimuxSavingsResponse }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const fetched = timeMs(data.prices.openrouter.fetched_at);
  const range =
    data.range.from === data.range.to
      ? t('provimux.savings.basis.range_one', { day: formatDay(data.range.from, lang) })
      : t('provimux.savings.basis.range', {
          from: formatDay(data.range.from, lang),
          to: formatDay(data.range.to, lang),
        });
  return (
    <p className={styles.basis} aria-label={t('provimux.savings.basis.label')}>
      <span className={styles.basisRange}>{range}</span>
      <span>{t('provimux.savings.basis.zone', { zone: zoneLabel(data) })}</span>
      {recordedSinceInRange(data) && data.recording.since ? (
        <span>
          {t('provimux.savings.basis.since', { day: formatDay(data.recording.since, lang) })}
        </span>
      ) : null}
      <span>
        {fetched !== null
          ? t('provimux.savings.basis.prices_openrouter', { date: formatDate(fetched, lang) }) +
            (isBaseRates(data) ? `, ${t('provimux.savings.basis.rates_base')}` : '')
          : t('provimux.savings.basis.prices_none')}
        {usesProvimuxTable(data) && data.prices.provimux.updated
          ? ` ${t('provimux.savings.basis.prices_table', {
              date: formatDay(data.prices.provimux.updated, lang),
            })}`
          : null}
      </span>
    </p>
  );
}

/* ---------- states ---------- */

const WARNING_STATES: ReadonlySet<SavingsState> = new Set([
  'not_persistent',
  'no_price_list',
  'no_price_list_local',
]);

function Notices({ data, states }: { data: ProvimuxSavingsResponse; states: SavingsState[] }) {
  const { t, i18n } = useTranslation();
  // Unpriced models and a negative saving are said at the headline, where they change its meaning.
  const shown = states.filter((state) => state !== 'unpriced' && state !== 'negative_saving');
  if (shown.length === 0) return null;
  const fetched = timeMs(data.prices.openrouter.fetched_at);
  const text = (state: SavingsState): string => {
    switch (state) {
      case 'nothing_in_period':
        return t('provimux.savings.state.nothing_in_period', {
          day: formatDay(data.recording.since ?? data.today, i18n.language),
        });
      case 'floating':
        return t('provimux.savings.state.floating', {
          count: data.totals.estimate.floating_requests,
        });
      case 'old_price_list':
        return t('provimux.savings.state.old_price_list', {
          date: fetched !== null ? formatDate(fetched, i18n.language) : '—',
        });
      case 'folded_days':
        return t('provimux.savings.state.folded_days', { count: data.recording.folded_days });
      default:
        return t(`provimux.savings.state.${state}`);
    }
  };
  return (
    <div className={styles.notices}>
      {shown.map((state) => (
        <p
          key={state}
          className={styles.notice}
          data-state={state}
          data-tone={WARNING_STATES.has(state) ? 'warning' : 'info'}
          role={WARNING_STATES.has(state) ? 'alert' : undefined}
        >
          {WARNING_STATES.has(state) ? <IconAlertTriangle size={14} /> : <IconInfo size={14} />}
          <span>{text(state)}</span>
        </p>
      ))}
    </div>
  );
}

/* ---------- 1. the headline ---------- */

function Estimate() {
  const { t } = useTranslation();
  return <span className={styles.estimate}>{t('provimux.savings.estimate')}</span>;
}

function Money({
  amount,
  estimate = false,
  valued = true,
}: {
  amount: number;
  estimate?: boolean;
  /** False when none of the requests behind it had a price: no amount, not $0.00. */
  valued?: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (!valued) return <span className={styles.muted}>{t('provimux.savings.not_valued')}</span>;
  return (
    <>
      <span className={styles.money} data-amount="" data-negative={amount < 0 ? 'true' : undefined}>
        {formatMoney(amount, i18n.language, t)}
      </span>
      {estimate ? (
        <>
          {' '}
          <Estimate />
        </>
      ) : null}
    </>
  );
}

function Headline({ data, states }: { data: ProvimuxSavingsResponse; states: SavingsState[] }) {
  const { t, i18n } = useTranslation();
  const headline = headlineOf(data);
  const unpriced = states.includes('unpriced');
  const valued = data.totals.estimate.priced_requests > 0;
  const coverage = coverageOf(data.totals);
  const days = dayPoints(data);
  // From the first recorded day: the days before it are not zeros, they were not recorded.
  const since = data.recording.since ?? '';
  const recorded = days?.filter((point) => point.label >= since.slice(0, point.label.length));
  const trend =
    valued && recorded && recorded.length > 1 ? recorded.map((point) => point.saved) : null;

  return (
    <section className={`${shared.feature} ${styles.hero}`} aria-labelledby="pmx-sv-headline">
      <div className={styles.heroMain}>
        <h2 id="pmx-sv-headline" className={styles.heroTitle}>
          {t('provimux.savings.headline.title')} <Estimate />
        </h2>
        {valued ? (
          <p className={styles.heroAmount} data-negative={headline.total < 0 ? 'true' : undefined}>
            {formatMoney(headline.total, i18n.language, t)}
          </p>
        ) : (
          <p className={styles.heroUnvalued}>{t('provimux.savings.headline.unvalued')}</p>
        )}
        <p className={shared.featureText}>{t(ratesKey('provimux.savings.headline.text', data))}</p>
        {valued && coverage.partial ? (
          <p className={styles.partial} data-partial="true">
            {t('provimux.savings.headline.partial', {
              priced: formatCount(coverage.priced, i18n.language),
              requests: formatCount(coverage.requests, i18n.language),
            })}
          </p>
        ) : null}
        {valued && headline.apikey !== null && headline.oauth !== null ? (
          <dl className={styles.parts}>
            <div className={styles.part} data-access="api">
              <dt>
                <AccessBadge access="api" kind="apikey" /> {t('provimux.savings.headline.apikey')}
              </dt>
              <dd>
                <Money amount={headline.apikey} estimate />
                <span className={styles.partText}>
                  {t('provimux.savings.headline.apikey_text')}
                </span>
              </dd>
            </div>
            <div className={styles.part} data-access="sub">
              <dt>
                <AccessBadge access="sub" kind="oauth" /> {t('provimux.savings.headline.oauth')}
              </dt>
              <dd>
                <Money amount={headline.oauth} estimate />
                <span className={styles.partText}>{t('provimux.savings.headline.oauth_text')}</span>
              </dd>
            </div>
            {headline.other !== 0 ? (
              <div className={styles.part}>
                <dt>{t('provimux.savings.headline.other')}</dt>
                <dd>
                  <Money amount={headline.other} estimate />
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {states.includes('negative_saving') ? (
          <p className={styles.heroWarn}>{t('provimux.savings.headline.negative')}</p>
        ) : null}
        {unpriced ? <UnpricedNote data={data} /> : null}
        <CopyLine data={data} />
      </div>
      {trend ? (
        <div className={styles.heroTrend}>
          <Sparkline
            points={trend}
            color="var(--pmx-sub)"
            ariaLabel={t('provimux.savings.days.chart_label', {
              from: data.range.from,
              to: data.range.to,
            })}
            className={styles.sparkline}
          />
        </div>
      ) : null}
    </section>
  );
}

function UnpricedNote({ data }: { data: ProvimuxSavingsResponse }) {
  const { t, i18n } = useTranslation();
  const models = unpricedModels(data);
  const { unpriced_requests: requests, unpriced_tokens: tokens } = data.totals.estimate;
  return (
    <div className={styles.unpriced} role="note">
      <p className={styles.unpricedTitle}>
        <IconAlertTriangle size={14} />
        {t('provimux.savings.unpriced.title')}
      </p>
      <p>
        {t('provimux.savings.unpriced.text', {
          count: requests,
          requests: formatCount(requests, i18n.language),
          tokens: formatCompact(tokens, i18n.language),
          models: models.map((model) => model.model).join(', ') || '—',
        })}
      </p>
      {models.length > 0 ? (
        <ul className={styles.unpricedList}>
          {models.map((model) => (
            <li key={`${model.provider}/${model.model}`}>
              <ProviderPill provider={model.provider} host={hostOfProvider(model.provider)} />
              <code>{model.model}</code>
              <span
                title={t('provimux.savings.tokens.exact', {
                  value: formatCount(model.tokens, i18n.language),
                })}
              >
                {formatCompact(model.tokens, i18n.language)}
              </span>
              <span className={styles.muted}>
                {data.prices.openrouter.fetched_at === null
                  ? t('provimux.savings.unpriced.reason_no_list')
                  : t('provimux.savings.unpriced.reason')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CopyLine({ data }: { data: ProvimuxSavingsResponse }) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  // The line is always English, whatever the page's language.
  const result = copyLine(data, i18n.getFixedT('en'));
  const copy = async () => {
    if (!result.line) return;
    const copied = await copyToClipboard(result.line);
    showNotification(
      copied ? t('provimux.savings.copy.copied') : t('provimux.savings.copy.failed'),
      copied ? 'success' : 'error'
    );
  };
  return (
    <div className={styles.copy}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void copy()}
        disabled={result.line === null}
        aria-describedby="pmx-sv-copy-text"
      >
        <IconCopy size={14} />
        {t('provimux.savings.copy.button')}
      </Button>
      <span id="pmx-sv-copy-text" className={styles.copyText}>
        {result.line !== null ? (
          <q aria-label={t('provimux.savings.copy.preview_label')}>{result.line}</q>
        ) : (
          t(`provimux.savings.copy.block.${result.block}`)
        )}
      </span>
    </div>
  );
}

/* ---------- 2–5 ---------- */

function Card({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return (
    <section className={`${shared.feature} ${styles.card}`} aria-labelledby={id}>
      <h2 id={id} className={shared.featureTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function AccessCard({ data }: { data: ProvimuxSavingsResponse }) {
  const { t, i18n } = useTranslation();
  const access = byAccess(data);
  const counts = access
    ? { oauth: access.oauth.requests, apikey: access.apikey.requests, other: access.other.requests }
    : null;
  const total = counts ? counts.oauth + counts.apikey + counts.other : 0;
  return (
    <Card id="pmx-sv-access" title={t('provimux.savings.access.title')}>
      {counts ? (
        <>
          <ul className={styles.accessList}>
            <li>
              <AccessBadge access="sub" kind="oauth" />
              <b>{formatCount(counts.oauth, i18n.language)}</b>
            </li>
            <li>
              <AccessBadge access="api" kind="apikey" />
              <b>{formatCount(counts.apikey, i18n.language)}</b>
            </li>
            {counts.other > 0 ? (
              <li>
                <span className={shared.access}>{t('provimux.savings.access.other')}</span>
                <b>{formatCount(counts.other, i18n.language)}</b>
              </li>
            ) : null}
          </ul>
          {total > 0 ? (
            <Meter
              value={(counts.oauth / total) * 100}
              tone="good"
              ariaLabel={t('provimux.savings.access.share_label')}
            />
          ) : null}
        </>
      ) : (
        <p className={styles.big}>
          {t('provimux.savings.access.requests', {
            count: data.totals.requests,
          })}
        </p>
      )}
      <p className={shared.featureNote}>
        {t('provimux.savings.access.text')} {t('provimux.savings.attempts')}
      </p>
    </Card>
  );
}

function SubscriptionCard({ data }: { data: ProvimuxSavingsResponse }) {
  const { t, i18n } = useTranslation();
  const access = byAccess(data);
  if (!access) return null;
  return (
    <Card id="pmx-sv-subscription" title={t('provimux.savings.subscription.title')}>
      {access.oauth.requests > 0 ? (
        <p className={styles.big}>
          <Money
            amount={access.oauth.estimate.cost_usd}
            estimate
            valued={access.oauth.estimate.priced_requests > 0}
          />
        </p>
      ) : (
        <p className={shared.featureText}>{t('provimux.savings.subscription.none')}</p>
      )}
      {coverageOf(access.oauth).partial ? (
        <p className={styles.partial} data-partial="true">
          {t('provimux.savings.subscription.partial', {
            priced: formatCount(access.oauth.estimate.priced_requests, i18n.language),
            requests: formatCount(access.oauth.requests, i18n.language),
          })}
        </p>
      ) : null}
      <p className={shared.featureNote}>{t('provimux.savings.subscription.text')}</p>
    </Card>
  );
}

function ApiKeyCard({ data }: { data: ProvimuxSavingsResponse }) {
  const { t, i18n } = useTranslation();
  const cost = apiKeyCostOf(data);
  if (!cost) return null;
  const hosts = data.reported_cost_hosts.map(hostName);
  const hostsText = [...new Set(hosts)].join(', ');
  return (
    <Card id="pmx-sv-apikeys" title={t('provimux.savings.apikeys.title')}>
      {cost.requests === 0 ? (
        <p className={shared.featureText}>{t('provimux.savings.apikeys.none')}</p>
      ) : (
        <>
          {cost.reportedRequests > 0 ? (
            <>
              <p className={styles.big}>
                <Money amount={cost.reportedUsd} />{' '}
                <span className={styles.reported}>{t('provimux.savings.reported')}</span>
              </p>
              <p className={shared.featureText}>
                {t('provimux.savings.apikeys.reported', {
                  hosts: hostsText || '—',
                  reported: formatCount(cost.reportedRequests, i18n.language),
                  requests: formatCount(cost.requests, i18n.language),
                })}
              </p>
            </>
          ) : (
            <p className={shared.featureText}>
              {t('provimux.savings.apikeys.reported_none', {
                requests: formatCount(cost.requests, i18n.language),
              })}
            </p>
          )}
          <dl className={styles.pairs}>
            <div>
              <dt>
                {cost.pricedRequests < cost.requests
                  ? t('provimux.savings.apikeys.estimate_partial', {
                      priced: formatCount(cost.pricedRequests, i18n.language),
                      requests: formatCount(cost.requests, i18n.language),
                    })
                  : t('provimux.savings.apikeys.estimate')}
              </dt>
              <dd>
                <Money amount={cost.estimateUsd} estimate valued={cost.pricedRequests > 0} />
              </dd>
            </div>
            {cost.unreported && cost.unreported.requests > 0 && cost.reportedRequests > 0 ? (
              <div>
                <dt>
                  {cost.unreported.pricedRequests < cost.unreported.requests
                    ? t('provimux.savings.apikeys.unreported_partial', {
                        count: cost.unreported.requests,
                        priced: formatCount(cost.unreported.pricedRequests, i18n.language),
                      })
                    : t('provimux.savings.apikeys.unreported', {
                        count: cost.unreported.requests,
                      })}
                </dt>
                <dd>
                  <Money
                    amount={cost.unreported.estimateUsd}
                    estimate
                    valued={cost.unreported.pricedRequests > 0}
                  />
                </dd>
              </div>
            ) : null}
          </dl>
        </>
      )}
    </Card>
  );
}

function HitRateCard({ totals }: { totals: ProvimuxSavingsMetrics }) {
  const { t, i18n } = useTranslation();
  const rate = hitRateOf(totals);
  return (
    <Card id="pmx-sv-hit" title={t('provimux.savings.hit_rate.title')}>
      <p className={styles.big}>
        {rate === null ? t('provimux.savings.hit_rate.none') : formatRate(rate, i18n.language)}
      </p>
      {rate !== null ? (
        <Meter
          value={rate * 100}
          tone="good"
          ariaLabel={t('provimux.savings.hit_rate.meter_label')}
        />
      ) : null}
      <p className={shared.featureNote}>{t('provimux.savings.hit_rate.text')}</p>
    </Card>
  );
}

/* ---------- 6. per client key ---------- */

function KeyName({ row }: { row: { key?: Parameters<typeof keyLabel>[0] } }) {
  const { t } = useTranslation();
  const label = keyLabel(row.key);
  switch (label.kind) {
    case 'name':
      return <span className={styles.keyName}>{label.text}</span>;
    case 'tail':
      return (
        <code className={styles.key}>{t('provimux.savings.keys.tail', { tail: label.text })}</code>
      );
    case 'id':
      return (
        <code className={styles.key} title={t('provimux.savings.keys.id_title')}>
          {t('provimux.savings.keys.id', { id: label.text })}
        </code>
      );
    case 'none':
      return <span className={styles.muted}>{t('provimux.savings.keys.none')}</span>;
    default:
      return <span className={styles.muted}>{t('provimux.savings.keys.other')}</span>;
  }
}

function KeysCard({ data }: { data: ProvimuxSavingsResponse }) {
  const { t, i18n } = useTranslation();
  const breakdown = findBreakdown(data, ['key']);
  if (!breakdown) return null;
  return (
    <section className={`${shared.feature} ${styles.card}`} aria-labelledby="pmx-sv-keys">
      <h2 id="pmx-sv-keys" className={shared.featureTitle}>
        {t('provimux.savings.keys.title')}
      </h2>
      <p className={shared.featureNote}>{t('provimux.savings.keys.text')}</p>
      {breakdown.rows.length === 0 ? (
        <p className={shared.featureText}>{t('provimux.savings.keys.empty')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('provimux.savings.keys.col_key')}</th>
                <th scope="col">{t('provimux.savings.keys.col_requests')}</th>
                <th scope="col">
                  {t('provimux.savings.keys.col_saved')} <Estimate />
                </th>
                <th scope="col">
                  {t('provimux.savings.keys.col_cost')} <Estimate />
                </th>
              </tr>
            </thead>
            <tbody>
              {breakdown.rows.map((row, index) => (
                <tr key={index}>
                  <td data-label={t('provimux.savings.keys.col_key')}>
                    <KeyName row={row} />
                  </td>
                  <td data-label={t('provimux.savings.keys.col_requests')}>
                    {formatCount(row.requests, i18n.language)}
                  </td>
                  <td data-label={t('provimux.savings.keys.col_saved')}>
                    <Money
                      amount={row.estimate.saved_by_caching_usd}
                      valued={row.estimate.priced_requests > 0}
                    />
                    {coverageOf(row).partial ? (
                      <span
                        className={styles.partialTag}
                        title={t('provimux.savings.days.partial_title')}
                      >
                        {' '}
                        {t('provimux.savings.days.partial', {
                          priced: formatCount(row.estimate.priced_requests, i18n.language),
                          requests: formatCount(row.requests, i18n.language),
                        })}
                      </span>
                    ) : null}
                  </td>
                  <td data-label={t('provimux.savings.keys.col_cost')}>
                    <Money
                      amount={row.estimate.cost_usd}
                      valued={row.estimate.priced_requests > 0}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {breakdown.truncated ? (
        <p className={shared.featureNote}>
          {t('provimux.savings.keys.truncated', { count: breakdown.rows.length })}
        </p>
      ) : null}
    </section>
  );
}

/* ---------- reachable in one step ---------- */

function Details({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className={styles.disclosure}>
      <summary>
        <span className={styles.disclosureTitle}>{title}</span>
        <span className={styles.disclosureSummary}>{summary}</span>
      </summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  );
}

function priceWords(
  model: ProvimuxSavingsModel,
  t: (key: string, o?: Record<string, unknown>) => string
) {
  const price = model.price;
  if (!price) return null;
  const known = (value: string, set: string[]) => (set.includes(value) ? value : 'other');
  return {
    source: t(`provimux.savings.models.source.${known(price.source, ['openrouter', 'provimux'])}`, {
      source: price.source,
    }),
    match: t(
      `provimux.savings.models.match.${known(price.match, ['exact', 'variant', 'normalized', 'table'])}`,
      { match: price.match }
    ),
    basis: t(
      `provimux.savings.models.basis.${known(price.basis, ['recorded', 'current', 'mixed'])}`,
      {
        basis: price.basis,
      }
    ),
  };
}

function ModelsDetails({ data }: { data: ProvimuxSavingsResponse }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  if (data.models.length === 0) return null;
  return (
    <Details
      title={t('provimux.savings.models.title')}
      summary={t('provimux.savings.models.summary', { count: data.models.length })}
    >
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('provimux.savings.models.col_model')}</th>
              <th scope="col">{t('provimux.savings.models.col_requests')}</th>
              <th scope="col">{t('provimux.savings.models.col_tokens')}</th>
              <th scope="col">{t('provimux.savings.models.col_price')}</th>
              <th scope="col">{t('provimux.savings.models.col_rates')}</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((model) => {
              const words = priceWords(model, t);
              const price = model.price;
              const rates = price
                ? [
                    price.input_per_mtok,
                    price.output_per_mtok,
                    price.cache_read_per_mtok,
                    price.cache_write_per_mtok,
                    price.cache_write_1h_per_mtok,
                  ].map(
                    (value) => formatPerMtok(value, lang) ?? t('provimux.savings.models.rate_none')
                  )
                : null;
              return (
                <tr
                  key={`${model.provider}/${model.model}`}
                  data-unpriced={price ? undefined : 'true'}
                >
                  <td data-label={t('provimux.savings.models.col_model')}>
                    <div className={styles.modelCell}>
                      <ProviderPill
                        provider={model.provider}
                        host={hostOfProvider(model.provider)}
                      />
                      <code>{model.model}</code>
                    </div>
                  </td>
                  <td data-label={t('provimux.savings.models.col_requests')}>
                    {formatCount(model.requests, lang)}
                  </td>
                  <td data-label={t('provimux.savings.models.col_tokens')}>
                    <span
                      title={t('provimux.savings.tokens.exact', {
                        value: formatCount(model.tokens, lang),
                      })}
                    >
                      {formatCompact(model.tokens, lang)}
                    </span>
                  </td>
                  <td data-label={t('provimux.savings.models.col_price')}>
                    {price && words ? (
                      <div className={styles.priceCell}>
                        <code>{price.id}</code>
                        <span className={styles.muted}>
                          {words.source} · {words.match} · {words.basis}
                        </span>
                      </div>
                    ) : (
                      <span className={styles.unpricedTag}>
                        {model.model === '~other'
                          ? t('provimux.savings.models.folded')
                          : t('provimux.savings.models.unpriced')}
                      </span>
                    )}
                  </td>
                  <td data-label={t('provimux.savings.models.col_rates')}>
                    {rates ? <span className={styles.rates}>{rates.join(' · ')}</span> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.models_truncated ? (
        <p className={shared.featureNote}>{t('provimux.savings.models.truncated')}</p>
      ) : null}
    </Details>
  );
}

function DaysDetails({ data }: { data: ProvimuxSavingsResponse }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const all = dayPoints(data);
  if (all === null) return null;
  // Days before recording began were not recorded: they are left out, not shown as zeros.
  const since = data.recording.since ?? '';
  const days = all.filter((point) => point.label >= since.slice(0, point.label.length));
  const months = days.length > 0 && days[0].label.length === 7;
  const max = Math.max(0, ...days.map((point) => Math.abs(point.saved)));
  return (
    <Details
      title={t('provimux.savings.days.title')}
      summary={
        months ? t('provimux.savings.days.summary_months') : t('provimux.savings.days.summary')
      }
    >
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.daysTable}`}>
          <thead>
            <tr>
              <th scope="col">
                {months ? t('provimux.savings.days.col_month') : t('provimux.savings.days.col_day')}
              </th>
              <th scope="col">{t('provimux.savings.days.col_saved')}</th>
              <th scope="col">{t('provimux.savings.days.col_requests')}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((point) => (
              <tr key={point.label} data-idle={point.requests === 0 ? 'true' : undefined}>
                <td data-label={t('provimux.savings.days.col_day')}>
                  {months ? point.label : formatDay(point.label, lang, false)}
                </td>
                <td data-label={t('provimux.savings.days.col_saved')}>
                  <div className={styles.barCell}>
                    <span
                      className={styles.bar}
                      data-negative={point.saved < 0 ? 'true' : undefined}
                      style={{ width: `${max > 0 ? (Math.abs(point.saved) / max) * 100 : 0}%` }}
                      aria-hidden="true"
                    />
                    <Money amount={point.saved} valued={dayValue(point) !== 'none'} />
                    {dayValue(point) === 'partial' ? (
                      <span
                        className={styles.partialTag}
                        title={t('provimux.savings.days.partial_title')}
                      >
                        {t('provimux.savings.days.partial', {
                          priced: formatCount(point.priced, lang),
                          requests: formatCount(point.requests, lang),
                        })}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td data-label={t('provimux.savings.days.col_requests')}>
                  {formatCount(point.requests, lang)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Details>
  );
}

function HostsDetails({ data }: { data: ProvimuxSavingsResponse }) {
  const { t, i18n } = useTranslation();
  const breakdown = findBreakdown(data, ['kind', 'provider', 'host']);
  if (!breakdown || breakdown.rows.length === 0) return null;
  return (
    <Details
      title={t('provimux.savings.hosts.title')}
      summary={t('provimux.savings.hosts.summary')}
    >
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('provimux.savings.hosts.col_kind')}</th>
              <th scope="col">{t('provimux.savings.hosts.col_provider')}</th>
              <th scope="col">{t('provimux.savings.hosts.col_host')}</th>
              <th scope="col">{t('provimux.savings.hosts.col_requests')}</th>
              <th scope="col">{t('provimux.savings.hosts.col_estimate')}</th>
              <th scope="col">{t('provimux.savings.hosts.col_reported')}</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.rows.map((row, index) => {
              const access = accessOfKind(row.kind);
              return (
                <tr key={index}>
                  <td data-label={t('provimux.savings.hosts.col_kind')}>
                    <AccessBadge
                      access={access === 'oauth' ? 'sub' : access === 'apikey' ? 'api' : 'other'}
                      kind={row.kind ?? null}
                    />
                  </td>
                  <td data-label={t('provimux.savings.hosts.col_provider')}>
                    <ProviderPill provider={row.provider ?? 'unknown'} host={row.host} />
                  </td>
                  <td data-label={t('provimux.savings.hosts.col_host')}>
                    {row.host ? (
                      <code>{row.host}</code>
                    ) : (
                      <span className={styles.muted}>{t('provimux.savings.hosts.host_own')}</span>
                    )}
                  </td>
                  <td data-label={t('provimux.savings.hosts.col_requests')}>
                    {formatCount(row.requests, i18n.language)}
                  </td>
                  <td data-label={t('provimux.savings.hosts.col_estimate')}>
                    <Money
                      amount={row.estimate.cost_usd}
                      estimate
                      valued={row.estimate.priced_requests > 0}
                    />
                  </td>
                  <td data-label={t('provimux.savings.hosts.col_reported')}>
                    {row.reported_cost.requests > 0 ? (
                      <Money amount={row.reported_cost.usd} />
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Details>
  );
}

function TokensDetails({ totals }: { totals: ProvimuxSavingsMetrics }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { input, output, unclassified } = totals.tokens;
  const split = input.cache_write_5m > 0 || input.cache_write_1h > 0;
  const rows: Array<[string, number, boolean]> = [
    ['uncached', input.uncached, false],
    ['cache_read', input.cache_read, false],
    ['cache_write', input.cache_write, false],
    ...(split
      ? ([
          ['cache_write_5m', input.cache_write_5m, true],
          ['cache_write_1h', input.cache_write_1h, true],
        ] as Array<[string, number, boolean]>)
      : []),
    ['output', output.total, false],
    ['reasoning', output.reasoning, true],
    ...(unclassified > 0
      ? ([['unclassified', unclassified, false]] as Array<[string, number, boolean]>)
      : []),
  ];
  return (
    <Details
      title={t('provimux.savings.tokens.title')}
      summary={t('provimux.savings.tokens.summary')}
    >
      <dl className={styles.tokens}>
        {rows.map(([key, value, sub]) => (
          <div key={key} data-sub={sub ? 'true' : undefined}>
            <dt>{t(`provimux.savings.tokens.${key}`)}</dt>
            <dd title={t('provimux.savings.tokens.exact', { value: formatCount(value, lang) })}>
              {formatCompact(value, lang)}
            </dd>
          </div>
        ))}
      </dl>
    </Details>
  );
}

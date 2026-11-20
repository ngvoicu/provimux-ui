import type {
  ProvimuxSavingsBreakdown,
  ProvimuxSavingsDimension,
  ProvimuxSavingsKey,
  ProvimuxSavingsMetrics,
  ProvimuxSavingsModel,
  ProvimuxSavingsPeriod,
  ProvimuxSavingsResponse,
  ProvimuxSavingsRow,
} from '../../api/types';
import { timeMs } from '../time';

/**
 * What the Savings page derives from one answer, as pure functions (design: Provimux
 * `.github/provimux/design/savings/04-console-page.md`). The page never computes a date range itself: the period
 * goes to the server as it is, and "today", the range and the zone come back in the answer.
 */

/** The periods the page offers, in this order; the endpoint's values, sent as they are. Default: this month. */
export const SAVINGS_PERIODS: readonly ProvimuxSavingsPeriod[] = [
  'today',
  '7d',
  '30d',
  'month',
  'last_month',
  'year',
  'all',
];
export const DEFAULT_PERIOD: ProvimuxSavingsPeriod = 'month';

export const isSavingsPeriod = (value: unknown): value is ProvimuxSavingsPeriod =>
  typeof value === 'string' && (SAVINGS_PERIODS as readonly string[]).includes(value);

/** A breakdown by its `by`, never by its position in the answer. */
export function findBreakdown(
  data: Pick<ProvimuxSavingsResponse, 'breakdowns'>,
  by: readonly ProvimuxSavingsDimension[]
): ProvimuxSavingsBreakdown | null {
  return (
    data.breakdowns.find(
      (breakdown) =>
        breakdown.by.length === by.length && breakdown.by.every((d, index) => d === by[index])
    ) ?? null
  );
}

/** A kind as the page shows it: a subscription, an API key, or "other" (`unknown` and any kind it does not know). */
export type SavingsAccess = 'oauth' | 'apikey' | 'other';
export const accessOfKind = (kind: string | undefined): SavingsAccess =>
  kind === 'oauth' ? 'oauth' : kind === 'apikey' ? 'apikey' : 'other';

const ZERO_METRICS = (): ProvimuxSavingsMetrics => ({
  requests: 0,
  failures: 0,
  tokens: {
    input: {
      uncached: 0,
      cache_read: 0,
      cache_write: 0,
      cache_write_5m: 0,
      cache_write_1h: 0,
      total: 0,
    },
    output: { total: 0, reasoning: 0 },
    unclassified: 0,
  },
  cache_hit_rate: null,
  estimate: {
    cost_usd: 0,
    cost_without_cache_usd: 0,
    saved_by_caching_usd: 0,
    priced_requests: 0,
    unpriced_requests: 0,
    unpriced_tokens: 0,
    floating_requests: 0,
  },
  reported_cost: { usd: 0, byok_upstream_usd: 0, requests: 0 },
});

/** Sums of the counters and amounts of rows (the hit rate is recomputed from the sums). */
function sumMetrics(rows: readonly ProvimuxSavingsMetrics[]): ProvimuxSavingsMetrics {
  const sum = ZERO_METRICS();
  for (const row of rows) {
    sum.requests += row.requests;
    sum.failures += row.failures;
    const input = sum.tokens.input;
    input.uncached += row.tokens.input.uncached;
    input.cache_read += row.tokens.input.cache_read;
    input.cache_write += row.tokens.input.cache_write;
    input.cache_write_5m += row.tokens.input.cache_write_5m;
    input.cache_write_1h += row.tokens.input.cache_write_1h;
    input.total += row.tokens.input.total;
    sum.tokens.output.total += row.tokens.output.total;
    sum.tokens.output.reasoning += row.tokens.output.reasoning;
    sum.tokens.unclassified += row.tokens.unclassified;
    for (const key of Object.keys(sum.estimate) as Array<keyof typeof sum.estimate>) {
      sum.estimate[key] += row.estimate[key];
    }
    sum.reported_cost.usd += row.reported_cost.usd;
    sum.reported_cost.byok_upstream_usd += row.reported_cost.byok_upstream_usd;
    sum.reported_cost.requests += row.reported_cost.requests;
  }
  sum.cache_hit_rate =
    sum.tokens.input.total > 0 ? sum.tokens.input.cache_read / sum.tokens.input.total : null;
  return sum;
}

/** The `group=kind` rows, as subscription, API key and other (unknown kinds summed). Null without that breakdown. */
export function byAccess(
  data: Pick<ProvimuxSavingsResponse, 'breakdowns'>
): Record<SavingsAccess, ProvimuxSavingsMetrics> | null {
  const breakdown = findBreakdown(data, ['kind']);
  if (!breakdown) return null;
  const groups: Record<SavingsAccess, ProvimuxSavingsRow[]> = { oauth: [], apikey: [], other: [] };
  for (const row of breakdown.rows) groups[accessOfKind(row.kind)].push(row);
  return {
    oauth: sumMetrics(groups.oauth),
    apikey: sumMetrics(groups.apikey),
    other: sumMetrics(groups.other),
  };
}

export interface Headline {
  /** totals.estimate.saved_by_caching_usd */
  total: number;
  /** The part on API-key requests (money that would have been paid); null without the kind breakdown. */
  apikey: number | null;
  /** The part on subscription requests (quota, valued at list price); null without the kind breakdown. */
  oauth: number | null;
  /** The part on requests of another kind; 0 when there is none. */
  other: number;
}

/** Item 1: money saved by caching, and its two parts from the `kind` rows. A missing breakdown shows the total alone. */
export function headlineOf(data: ProvimuxSavingsResponse): Headline {
  const access = byAccess(data);
  return {
    total: data.totals.estimate.saved_by_caching_usd,
    apikey: access ? access.apikey.estimate.saved_by_caching_usd : null,
    oauth: access ? access.oauth.estimate.saved_by_caching_usd : null,
    other: access ? access.other.estimate.saved_by_caching_usd : 0,
  };
}

export interface ApiKeyCost {
  /** API-key requests in the period. */
  requests: number;
  /** What the providers reported, in dollars; not an estimate. */
  reportedUsd: number;
  /** API-key requests whose answer carried a cost. */
  reportedRequests: number;
  /** The estimate of the API-key requests that have a price, at list prices. */
  estimateUsd: number;
  /** API-key requests with a price: the estimate covers these only. */
  pricedRequests: number;
  /** The estimate for the API-key requests on hosts that reported no cost at all; null without that breakdown. */
  unreported: { requests: number; pricedRequests: number; estimateUsd: number } | null;
}

/** Item 4: what the API keys really cost, and the estimate for what no provider reported. */
export function apiKeyCostOf(data: ProvimuxSavingsResponse): ApiKeyCost | null {
  const access = byAccess(data);
  if (!access) return null;
  const apikey = access.apikey;
  const hosts = findBreakdown(data, ['kind', 'provider', 'host']);
  let unreported: ApiKeyCost['unreported'] = null;
  if (hosts) {
    const rows = hosts.rows.filter(
      (row) => accessOfKind(row.kind) === 'apikey' && row.reported_cost.requests === 0
    );
    unreported = {
      requests: rows.reduce((sum, row) => sum + row.requests, 0),
      pricedRequests: rows.reduce((sum, row) => sum + row.estimate.priced_requests, 0),
      estimateUsd: rows.reduce((sum, row) => sum + row.estimate.cost_usd, 0),
    };
  }
  return {
    requests: apikey.requests,
    reportedUsd: apikey.reported_cost.usd,
    reportedRequests: apikey.reported_cost.requests,
    estimateUsd: apikey.estimate.cost_usd,
    pricedRequests: apikey.estimate.priced_requests,
    unreported,
  };
}

/** A host as people know it: openrouter.ai is OpenRouter. */
export const hostName = (host: string): string =>
  host === 'openrouter.ai' || host.endsWith('.openrouter.ai') ? 'OpenRouter' : host;

export type KeyLabel =
  | { kind: 'name'; text: string }
  | { kind: 'tail'; text: string }
  | { kind: 'id'; text: string }
  | { kind: 'none' }
  | { kind: 'other' };

/**
 * A client key, never more than 4 characters of it: its name when the server sends one, its last 4 characters,
 * the first 4 of its id when it has no tail, "no key", or "other keys" for the rows folded at the row limit.
 */
export function keyLabel(key: ProvimuxSavingsKey | undefined): KeyLabel {
  if (!key || key.id === '') return { kind: 'none' };
  if (key.id === '~other') return { kind: 'other' };
  if (key.name) return { kind: 'name', text: key.name };
  if (key.tail) return { kind: 'tail', text: key.tail.slice(-4) };
  return { kind: 'id', text: key.id.slice(0, 4) };
}

/** Item 5: the hit rate, or null for "no input yet" (never 0%). */
export const hitRateOf = (metrics: ProvimuxSavingsMetrics): number | null =>
  metrics.tokens.input.total > 0 ? metrics.cache_hit_rate : null;

/* ---------- states (04-console-page.md section 4) ---------- */

export type SavingsState =
  | 'nothing_recorded'
  | 'nothing_in_period'
  | 'unpriced'
  | 'floating'
  | 'no_price_list'
  | 'no_price_list_local'
  | 'old_price_list'
  | 'negative_saving'
  | 'not_persistent'
  | 'folded_days';

const DAY_MS = 86_400_000;

/** The price list is more than a day older than the answer. */
export function isOldPriceList(data: ProvimuxSavingsResponse): boolean {
  const fetched = timeMs(data.prices.openrouter.fetched_at);
  const observed = timeMs(data.observed_at);
  return fetched !== null && observed !== null && observed - fetched > DAY_MS;
}

/** Every state of the answer the page has something to say about, in the order it says it. */
export function savingsStates(data: ProvimuxSavingsResponse): SavingsState[] {
  if (data.recording.since === null) {
    const states: SavingsState[] = ['nothing_recorded'];
    if (!data.recording.persistent) states.push('not_persistent');
    return states;
  }
  const states: SavingsState[] = [];
  const { totals } = data;
  if (totals.requests === 0) states.push('nothing_in_period');
  if (data.prices.openrouter.fetched_at === null) {
    states.push(data.prices.openrouter.remote ? 'no_price_list' : 'no_price_list_local');
  } else if (isOldPriceList(data)) {
    states.push('old_price_list');
  }
  if (totals.estimate.unpriced_requests > 0) states.push('unpriced');
  if (totals.estimate.floating_requests > 0) states.push('floating');
  if (totals.estimate.saved_by_caching_usd < 0) states.push('negative_saving');
  if (!data.recording.persistent) states.push('not_persistent');
  if (data.recording.folded_days > 0) states.push('folded_days');
  return states;
}

/** Models without a price, most tokens first. `~other` is the folded rows, not a model, and is left out. */
export function unpricedModels(data: ProvimuxSavingsResponse): ProvimuxSavingsModel[] {
  return data.models
    .filter((model) => model.price === null && model.model !== '~other')
    .sort((a, b) => b.tokens - a.tokens);
}

/** A model of the range is valued from Provimux's own table. */
export const usesProvimuxTable = (data: ProvimuxSavingsResponse): boolean =>
  data.models.some((model) => model.price?.source === 'provimux');

/** The server's zone: its name, or its offset when the name is `Local` (or missing). */
export function zoneLabel(data: Pick<ProvimuxSavingsResponse, 'timezone' | 'utc_offset_seconds'>) {
  if (data.timezone && data.timezone !== 'Local') return data.timezone;
  const total = Math.round(data.utc_offset_seconds / 60);
  const sign = total < 0 ? '-' : '+';
  const abs = Math.abs(total);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Recording began inside the range: the numbers cover only part of it. */
export const recordedSinceInRange = (data: ProvimuxSavingsResponse): boolean =>
  data.recording.since !== null && data.recording.since > data.range.from;

/**
 * How much of the period the amounts cover. With any request unpriced, an amount is the sum over the priced
 * requests only: not a lower bound, since an unpriced request can be worth less than nothing (a cache write costs
 * more than plain input). Review T-112, finding 3.
 */
export interface Coverage {
  priced: number;
  requests: number;
  /** Some requests have a price and some do not. */
  partial: boolean;
}

export const coverageOf = (metrics: ProvimuxSavingsMetrics): Coverage => ({
  priced: metrics.estimate.priced_requests,
  requests: metrics.requests,
  partial: metrics.estimate.priced_requests > 0 && metrics.estimate.unpriced_requests > 0,
});

/* ---------- the copy line (04-console-page.md section 5) ---------- */

/** Rounded down: whole dollars from $100, cents below. Never more than the page says. */
export function floorAmount(amount: number): number {
  if (amount >= 100) return Math.floor(amount + 1e-9);
  return Math.floor(amount * 100 + 1e-6) / 100;
}

/** "$1,429" from $100, "$42.18" below: always English, always rounded down. */
export function copyAmount(amount: number): string {
  const value = floorAmount(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

export type CopyBlock = 'nothing_priced' | 'negative' | 'under_cent';

/** Why there is no line to copy, or null when there is one. */
export function copyBlock(data: ProvimuxSavingsResponse): CopyBlock | null {
  const { estimate } = data.totals;
  if (estimate.priced_requests === 0) return 'nothing_priced';
  if (estimate.saved_by_caching_usd < 0) return 'negative';
  if (floorAmount(estimate.saved_by_caching_usd) < 0.01) return 'under_cent';
  return null;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const PERIOD_WORDS: ReadonlySet<string> = new Set([
  'today',
  'yesterday',
  '7d',
  '30d',
  'month',
  'last_month',
  'year',
  'all',
]);

/** The period's words in the line; a period the page does not know reads "so far". */
export const periodWordKey = (period: string | null): string =>
  `provimux.savings.copy.period.${period !== null && PERIOD_WORDS.has(period) ? period : 'all'}`;

/**
 * The line, in English (`t` is the English translator), or null with the reason. It names no key, host, model or
 * account: only the amount and the period. The amount includes subscription requests valued at list price, so the
 * line says what caching was worth, never what it saved (owner, 2026-11-20).
 */
export function copyLine(
  data: ProvimuxSavingsResponse,
  t: Translate
): { line: string; block: null } | { line: null; block: CopyBlock } {
  const block = copyBlock(data);
  if (block) return { line: null, block };
  const coverage = coverageOf(data.totals);
  const english = (value: number) => new Intl.NumberFormat('en-US').format(value);
  return {
    line: t(
      coverage.partial ? 'provimux.savings.copy.line_partial' : 'provimux.savings.copy.line',
      {
        amount: copyAmount(data.totals.estimate.saved_by_caching_usd),
        period: t(periodWordKey(data.range.period)),
        priced: english(coverage.priced),
        requests: english(coverage.requests),
        interpolation: { escapeValue: false },
      }
    ),
    block: null,
  };
}

/* ---------- days (group=day) ---------- */

export interface DayPoint {
  /** YYYY-MM-DD, or YYYY-MM when the range is long and days are summed by month. */
  label: string;
  requests: number;
  /** Requests with a price; `saved` covers these only. */
  priced: number;
  saved: number;
}

/** A day's value is known when every request has a price, partial when some do, unknown when none do. */
export const dayValue = (point: DayPoint): 'known' | 'partial' | 'none' =>
  point.requests === 0 || point.priced === point.requests
    ? 'known'
    : point.priced === 0
      ? 'none'
      : 'partial';

const dayToMs = (value: string): number => {
  const [y, m, d] = value.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const msToDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Beyond this many days, the chart sums days by month. */
export const MAX_DAY_BARS = 62;

/**
 * Every day of the answer's range, oldest first, with zeros where the answer has no row (days without requests
 * are missing in it). The range is the answer's `from` and `to`, never the browser's date. Null without `group=day`.
 */
export function dayPoints(data: ProvimuxSavingsResponse): DayPoint[] | null {
  const breakdown = findBreakdown(data, ['day']);
  if (!breakdown) return null;
  const byDay = new Map<string, ProvimuxSavingsRow>();
  for (const row of breakdown.rows) if (row.day) byDay.set(row.day, row);
  const from = dayToMs(data.range.from);
  const to = dayToMs(data.range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const days: DayPoint[] = [];
  // Calendar days in UTC arithmetic: no day of 23 or 25 hours, whatever the browser's zone.
  for (let ms = from; ms <= to; ms += DAY_MS) {
    const label = msToDay(ms);
    const row = byDay.get(label);
    days.push({
      label,
      requests: row?.requests ?? 0,
      priced: row ? row.estimate.priced_requests : 0,
      saved: row?.estimate.saved_by_caching_usd ?? 0,
    });
  }
  if (days.length <= MAX_DAY_BARS) return days;
  const months: DayPoint[] = [];
  for (const point of days) {
    const label = point.label.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.label === label) {
      last.requests += point.requests;
      last.priced += point.priced;
      last.saved += point.saved;
    } else {
      months.push({ ...point, label });
    }
  }
  return months;
}

/* ---------- numbers ---------- */

/** Money in the page's language; amounts under a cent are "under $0.01", never $0.00. */
export function formatMoney(amount: number, language: string, t: Translate): string {
  const format = (value: number) => {
    try {
      return new Intl.NumberFormat(language, { style: 'currency', currency: 'USD' }).format(value);
    } catch {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
    }
  };
  if (amount > 0 && amount < 0.01)
    return t('provimux.savings.under_cent', { amount: format(0.01) });
  if (amount < 0 && amount > -0.01)
    return t('provimux.savings.under_cent_negative', { amount: format(0.01) });
  return format(amount);
}

/** Token counts shortened for reading (1.2M); the exact number goes in a title. */
export function formatCompact(value: number, language: string): string {
  try {
    return new Intl.NumberFormat(language, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(value);
  }
}

export function formatCount(value: number, language: string): string {
  try {
    return new Intl.NumberFormat(language).format(value);
  } catch {
    return String(value);
  }
}

export function formatRate(rate: number, language: string): string {
  try {
    return new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 }).format(
      rate
    );
  } catch {
    return `${Math.round(rate * 1000) / 10}%`;
  }
}

/** Dollars per million tokens, as the price list publishes them. */
export function formatPerMtok(value: number | null, language: string): string | null {
  if (value === null) return null;
  try {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 4,
    }).format(value);
  } catch {
    return `$${value}`;
  }
}

import type {
  ProvimuxLimits,
  ProvimuxLiveListFailure,
  ProvimuxLiveListLogin,
  ProvimuxLiveListsResponse,
  ProvimuxLogin,
  ProvimuxModel,
  ProvimuxModelRoute,
  ProvimuxModelRoutesResponse,
  ProvimuxReasoning,
  ProvimuxRecordedCooldown,
  ProvimuxSavingsBreakdown,
  ProvimuxSavingsDimension,
  ProvimuxSavingsKey,
  ProvimuxSavingsMetrics,
  ProvimuxSavingsModel,
  ProvimuxSavingsPrice,
  ProvimuxSavingsResponse,
  ProvimuxSavingsRow,
} from './types';

/**
 * Reads the two endpoints' answers leniently (05-console-contract.md, section 4): unknown fields are dropped, a
 * missing or mistyped field becomes null (or an empty list), an unknown enum value is kept as it came. A row
 * without the one thing that identifies it (a model's id, a cooldown's time) is left out rather than invented.
 */

type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

/** A time the console can compare: a string Date.parse understands. */
const time = (value: unknown): string | null => {
  const text = str(value);
  return text !== null && Number.isFinite(Date.parse(text)) ? text : null;
};

const list = <T>(value: unknown, read: (item: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.map(read).filter((item): item is T => item !== null) : [];

export const readLogin = (value: unknown): ProvimuxLogin => {
  const rec = isRec(value) ? value : {};
  return { name: str(rec.name), email: str(rec.email), label: str(rec.label) };
};

export const readLimits = (value: unknown): ProvimuxLimits => {
  const rec = isRec(value) ? value : {};
  return { context: num(rec.context), output: num(rec.output) };
};

export const readReasoning = (value: unknown): ProvimuxReasoning | null => {
  if (!isRec(value)) return null;
  const levels = list(value.levels, str);
  let budget: ProvimuxReasoning['budget'] = null;
  if (isRec(value.budget)) {
    const min = num(value.budget.min);
    const max = num(value.budget.max);
    if (min !== null && max !== null) {
      budget = {
        min,
        max,
        zero_allowed: value.budget.zero_allowed === true,
        dynamic_allowed: value.budget.dynamic_allowed === true,
      };
    }
  }
  return { levels, budget };
};

export const readCooldown = (value: unknown): ProvimuxRecordedCooldown | null => {
  if (!isRec(value)) return null;
  const until = time(value.until);
  if (until === null) return null;
  return {
    scope: str(value.scope) ?? 'unknown',
    model: str(value.model),
    reason: str(value.reason) ?? 'unknown',
    until,
    http_status: num(value.http_status),
    backoff_level: num(value.backoff_level),
  };
};

export const readRoute = (value: unknown): ProvimuxModelRoute | null => {
  if (!isRec(value)) return null;
  return {
    auth_index: str(value.auth_index),
    provider: str(value.provider) ?? 'unknown',
    kind: str(value.kind),
    priority: num(value.priority),
    host: str(value.host),
    login: readLogin(value.login),
    limits: readLimits(value.limits),
    reasoning: readReasoning(value.reasoning),
    recorded_cooldown: readCooldown(value.recorded_cooldown),
  };
};

export const readModel = (value: unknown): ProvimuxModel | null => {
  if (!isRec(value)) return null;
  const id = str(value.id);
  if (id === null) return null;
  return {
    id,
    display_name: str(value.display_name),
    owned_by: str(value.owned_by),
    limits: readLimits(value.limits),
    routes: list(value.routes, readRoute),
  };
};

export const readModelRoutes = (value: unknown): ProvimuxModelRoutesResponse => {
  const rec = isRec(value) ? value : {};
  return { observed_at: time(rec.observed_at), models: list(rec.models, readModel) };
};

export const readFailure = (value: unknown): ProvimuxLiveListFailure | null => {
  if (!isRec(value)) return null;
  const at = time(value.at);
  if (at === null) return null;
  return { at, category: str(value.category) ?? 'other', http_status: num(value.http_status) };
};

export const readLiveLogin = (value: unknown): ProvimuxLiveListLogin | null => {
  if (!isRec(value)) return null;
  return {
    auth_index: str(value.auth_index),
    provider: str(value.provider) ?? 'unknown',
    login: readLogin(value.login),
    disabled: value.disabled === true,
    source: str(value.source) ?? 'unknown',
    fetching: value.fetching === true,
    fetched_at: time(value.fetched_at),
    listed_models: num(value.listed_models),
    registered_models: num(value.registered_models),
    last_failure: readFailure(value.last_failure),
  };
};

export const readLiveLists = (value: unknown): ProvimuxLiveListsResponse => {
  const rec = isRec(value) ? value : {};
  return {
    observed_at: time(rec.observed_at),
    enabled: bool(rec.enabled),
    providers: list(rec.providers, str),
    logins: list(rec.logins, readLiveLogin),
  };
};

/*
 * Savings (04-console-page.md section 6): a missing count or amount is 0 (the contract's "0 when"), a missing
 * rate, price or time is null, a missing list is empty, an unknown kind, source, match or basis stays as it came.
 */

const zero = (value: unknown): number => num(value) ?? 0;

/** A calendar day, YYYY-MM-DD, or null. */
const day = (value: unknown): string | null => {
  const text = str(value);
  return text !== null && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

export const readSavingsMetrics = (value: unknown): ProvimuxSavingsMetrics => {
  const rec = isRec(value) ? value : {};
  const tokens = isRec(rec.tokens) ? rec.tokens : {};
  const input = isRec(tokens.input) ? tokens.input : {};
  const output = isRec(tokens.output) ? tokens.output : {};
  const estimate = isRec(rec.estimate) ? rec.estimate : {};
  const reported = isRec(rec.reported_cost) ? rec.reported_cost : {};
  const uncached = zero(input.uncached);
  const cacheRead = zero(input.cache_read);
  const cacheWrite = zero(input.cache_write);
  return {
    requests: zero(rec.requests),
    failures: zero(rec.failures),
    tokens: {
      input: {
        uncached,
        cache_read: cacheRead,
        cache_write: cacheWrite,
        cache_write_5m: zero(input.cache_write_5m),
        cache_write_1h: zero(input.cache_write_1h),
        total: num(input.total) ?? uncached + cacheRead + cacheWrite,
      },
      output: { total: zero(output.total), reasoning: zero(output.reasoning) },
      unclassified: zero(tokens.unclassified),
    },
    cache_hit_rate: num(rec.cache_hit_rate),
    estimate: {
      cost_usd: zero(estimate.cost_usd),
      cost_without_cache_usd: zero(estimate.cost_without_cache_usd),
      saved_by_caching_usd: zero(estimate.saved_by_caching_usd),
      priced_requests: zero(estimate.priced_requests),
      unpriced_requests: zero(estimate.unpriced_requests),
      unpriced_tokens: zero(estimate.unpriced_tokens),
      floating_requests: zero(estimate.floating_requests),
    },
    reported_cost: {
      usd: zero(reported.usd),
      byok_upstream_usd: zero(reported.byok_upstream_usd),
      requests: zero(reported.requests),
    },
  };
};

export const readSavingsKey = (value: unknown): ProvimuxSavingsKey | null => {
  if (!isRec(value) || typeof value.id !== 'string') return null;
  return { id: value.id, tail: str(value.tail), name: str(value.name) };
};

const DIMENSIONS: ReadonlySet<string> = new Set([
  'day',
  'month',
  'kind',
  'provider',
  'host',
  'model',
  'key',
]);

export const readSavingsRow = (value: unknown): ProvimuxSavingsRow | null => {
  if (!isRec(value)) return null;
  const row: ProvimuxSavingsRow = readSavingsMetrics(value);
  const dayValue = day(value.day);
  if (dayValue !== null) row.day = dayValue;
  if (typeof value.month === 'string') row.month = value.month;
  if (typeof value.kind === 'string') row.kind = value.kind;
  if (typeof value.provider === 'string') row.provider = value.provider;
  if (typeof value.host === 'string') row.host = value.host;
  if (typeof value.model === 'string') row.model = value.model;
  const key = readSavingsKey(value.key);
  if (key !== null) row.key = key;
  return row;
};

export const readSavingsBreakdown = (value: unknown): ProvimuxSavingsBreakdown | null => {
  if (!isRec(value)) return null;
  const by = list(value.by, str).filter((dimension): dimension is ProvimuxSavingsDimension =>
    DIMENSIONS.has(dimension)
  );
  if (by.length === 0) return null;
  return { by, rows: list(value.rows, readSavingsRow), truncated: value.truncated === true };
};

export const readSavingsPrice = (value: unknown): ProvimuxSavingsPrice | null => {
  if (!isRec(value)) return null;
  const input = num(value.input_per_mtok);
  const output = num(value.output_per_mtok);
  if (input === null || output === null) return null;
  return {
    source: str(value.source) ?? 'unknown',
    id: str(value.id) ?? '',
    match: str(value.match) ?? 'unknown',
    basis: str(value.basis) ?? 'unknown',
    input_per_mtok: input,
    output_per_mtok: output,
    cache_read_per_mtok: num(value.cache_read_per_mtok),
    cache_write_per_mtok: num(value.cache_write_per_mtok),
    cache_write_1h_per_mtok: num(value.cache_write_1h_per_mtok),
  };
};

export const readSavingsModel = (value: unknown): ProvimuxSavingsModel | null => {
  if (!isRec(value)) return null;
  const model = str(value.model);
  if (model === null) return null;
  return {
    provider: str(value.provider) ?? 'unknown',
    model,
    requests: zero(value.requests),
    tokens: zero(value.tokens),
    price: readSavingsPrice(value.price),
  };
};

export const readSavings = (value: unknown): ProvimuxSavingsResponse => {
  const rec = isRec(value) ? value : {};
  const range = isRec(rec.range) ? rec.range : {};
  const recording = isRec(rec.recording) ? rec.recording : {};
  const prices = isRec(rec.prices) ? rec.prices : {};
  const openrouter = isRec(prices.openrouter) ? prices.openrouter : {};
  const table = isRec(prices.provimux) ? prices.provimux : {};
  const today = day(rec.today) ?? '';
  return {
    observed_at: time(rec.observed_at),
    timezone: str(rec.timezone) ?? '',
    utc_offset_seconds: zero(rec.utc_offset_seconds),
    today,
    range: {
      period: str(range.period),
      from: day(range.from) ?? today,
      to: day(range.to) ?? today,
    },
    recording: {
      since: day(recording.since),
      persistent: recording.persistent === true,
      saved_at: time(recording.saved_at),
      folded_days: zero(recording.folded_days),
    },
    prices: {
      currency: str(prices.currency) ?? 'USD',
      openrouter: {
        url: str(openrouter.url) ?? '',
        fetched_at: time(openrouter.fetched_at),
        models: zero(openrouter.models),
        remote: openrouter.remote !== false,
      },
      provimux: { updated: day(table.updated), models: zero(table.models) },
    },
    totals: readSavingsMetrics(rec.totals),
    breakdowns: list(rec.breakdowns, readSavingsBreakdown),
    models: list(rec.models, readSavingsModel),
    models_truncated: rec.models_truncated === true,
    reported_cost_hosts: list(rec.reported_cost_hosts, str),
  };
};

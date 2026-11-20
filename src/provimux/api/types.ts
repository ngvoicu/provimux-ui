/**
 * Provimux's two console endpoints (PUI-13/14), as the console reads them. Contract: Provimux
 * `.github/provimux/design/pui13/openapi.yaml` and `05-console-contract.md`, section 5.
 *
 * The server only adds fields. The console ignores fields it does not know, reads a missing field as null and keeps
 * an enum value it does not know as it came (the pages show it as unknown, never as an error).
 */

/** RFC 3339 in UTC, with the fraction of a second that was recorded. Compare as times, never as strings. */
export type Timestamp = string;

export interface ProvimuxLogin {
  /** Auth file name, only for a login the credentials page lists under a file. */
  name: string | null;
  /** Account email, under the same condition as name. */
  email: string | null;
  /** A login's label, or a configured key's: the OpenAI-compatible entry's name, or "<provider>-apikey". */
  label: string | null;
}

export interface ProvimuxLimits {
  /** Context window in tokens; null when not known. */
  context: number | null;
  /** Largest output in tokens; null when not known. */
  output: number | null;
}

export interface ProvimuxReasoning {
  /** Discrete effort levels; empty for a budget-only model. */
  levels: string[];
  budget: { min: number; max: number; zero_allowed: boolean; dynamic_allowed: boolean } | null;
}

export type ProvimuxCooldownReason =
  | 'quota'
  | 'credential_quota'
  | 'transient_rate_limit'
  | 'transient_error'
  | 'unauthorized'
  | 'payment_required'
  | 'not_found'
  | 'model_not_supported'
  | 'invalid_grant'
  | 'cloudflare_challenge'
  | 'unknown'
  | (string & {});

/** A cooldown as the auth manager recorded it: a timer with a reason code, not an availability verdict. */
export interface ProvimuxRecordedCooldown {
  scope: 'credential' | 'model' | (string & {});
  /** The model the cooldown is recorded under (scope "model"); null for "credential". */
  model: string | null;
  reason: ProvimuxCooldownReason;
  until: Timestamp;
  http_status: number | null;
  backoff_level: number | null;
}

export interface ProvimuxModelRoute {
  /** Joins with auth_index of GET /credentials and auth-index of GET /config. */
  auth_index: string | null;
  provider: string;
  /** "oauth" = subscription login (green), "apikey" = API key (amber). */
  kind: 'oauth' | 'apikey' | (string & {}) | null;
  /** null when the server did not say (never 0 by default). */
  priority: number | null;
  /** Host of an API key's base URL. */
  host: string | null;
  login: ProvimuxLogin;
  limits: ProvimuxLimits;
  reasoning: ProvimuxReasoning | null;
  recorded_cooldown: ProvimuxRecordedCooldown | null;
}

export interface ProvimuxModel {
  id: string;
  display_name: string | null;
  owned_by: string | null;
  /** What all routes agree on; null where they do not or none declares it. */
  limits: ProvimuxLimits;
  /** Highest priority first. Not a prediction of which route a request gets. */
  routes: ProvimuxModelRoute[];
}

export interface ProvimuxModelRoutesResponse {
  observed_at: Timestamp | null;
  models: ProvimuxModel[];
}

export interface ProvimuxLiveListFailure {
  at: Timestamp;
  /** http_status, credentials, invalid_response, network or other. */
  category: string;
  http_status: number | null;
}

export interface ProvimuxLiveListLogin {
  auth_index: string | null;
  provider: string;
  login: ProvimuxLogin;
  disabled: boolean;
  source: 'live' | 'catalog' | (string & {});
  fetching: boolean;
  fetched_at: Timestamp | null;
  /** Model ids the provider returned. */
  listed_models: number | null;
  /** Models the login serves now. */
  registered_models: number | null;
  last_failure: ProvimuxLiveListFailure | null;
}

export interface ProvimuxLiveListsResponse {
  observed_at: Timestamp | null;
  /** models.live-lists */
  enabled: boolean | null;
  providers: string[];
  logins: ProvimuxLiveListLogin[];
}

/*
 * Savings (T-108): GET /v8/management/provimux/savings. Contract: Provimux `.github/provimux/design/savings/`
 * (`openapi.yaml`, `04-console-page.md` section 6). Daily totals of the server's zone, valued at list prices.
 */

/** A calendar day of the server's zone, YYYY-MM-DD. */
export type ProvimuxDay = string;

/** The `period` values the endpoint takes; the page offers all but `yesterday`. */
export type ProvimuxSavingsPeriod =
  'today' | 'yesterday' | '7d' | '30d' | 'month' | 'last_month' | 'year' | 'all';

export interface ProvimuxSavingsMetrics {
  requests: number;
  failures: number;
  tokens: {
    input: {
      uncached: number;
      cache_read: number;
      cache_write: number;
      cache_write_5m: number;
      cache_write_1h: number;
      total: number;
    };
    output: { total: number; reasoning: number };
    unclassified: number;
  };
  /** 0..1; null when there are no input tokens. */
  cache_hit_rate: number | null;
  /** Estimates at list prices. Amounts can be negative. */
  estimate: {
    cost_usd: number;
    cost_without_cache_usd: number;
    saved_by_caching_usd: number;
    priced_requests: number;
    unpriced_requests: number;
    unpriced_tokens: number;
    /** Priced with today's list because their day recorded no price. */
    floating_requests: number;
  };
  /** Charges an upstream reported; not an estimate. */
  reported_cost: { usd: number; byok_upstream_usd: number; requests: number };
}

export interface ProvimuxSavingsKey {
  /** 16 hex characters; '' = no client key; '~other' = folded rows. */
  id: string;
  /** The key's last 4 characters, only for keys of 16 characters or more. */
  tail: string | null;
  /** Reserved; null in this version. */
  name: string | null;
}

export type ProvimuxSavingsDimension =
  'day' | 'month' | 'kind' | 'provider' | 'host' | 'model' | 'key';

/** The metrics of one combination; only the dimensions named in `by` are present. */
export interface ProvimuxSavingsRow extends ProvimuxSavingsMetrics {
  day?: ProvimuxDay;
  /** YYYY-MM */
  month?: string;
  kind?: 'oauth' | 'apikey' | 'unknown' | (string & {});
  provider?: string;
  /** '' for a login and for a key on its provider's own address. */
  host?: string;
  /** '~other' for folded rows. */
  model?: string;
  key?: ProvimuxSavingsKey;
}

export interface ProvimuxSavingsBreakdown {
  by: ProvimuxSavingsDimension[];
  rows: ProvimuxSavingsRow[];
  truncated: boolean;
}

export interface ProvimuxSavingsPrice {
  source: 'openrouter' | 'provimux' | (string & {});
  /** The price list entry, e.g. anthropic/claude-opus-5.5. */
  id: string;
  match: 'exact' | 'variant' | 'normalized' | 'table' | (string & {});
  basis: 'recorded' | 'current' | 'mixed' | (string & {});
  /** US dollars per million tokens. */
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number | null;
  cache_write_per_mtok: number | null;
  cache_write_1h_per_mtok: number | null;
}

export interface ProvimuxSavingsModel {
  provider: string;
  model: string;
  requests: number;
  tokens: number;
  /** null = unpriced. */
  price: ProvimuxSavingsPrice | null;
}

export interface ProvimuxSavingsResponse {
  /** The contract's Timestamp; null only when a server sent none (read leniently). */
  observed_at: Timestamp | null;
  timezone: string;
  utc_offset_seconds: number;
  today: ProvimuxDay;
  range: { period: string | null; from: ProvimuxDay; to: ProvimuxDay };
  recording: {
    since: ProvimuxDay | null;
    persistent: boolean;
    saved_at: Timestamp | null;
    folded_days: number;
  };
  prices: {
    currency: 'USD' | (string & {});
    openrouter: { url: string; fetched_at: Timestamp | null; models: number; remote: boolean };
    provimux: { updated: ProvimuxDay | null; models: number };
  };
  totals: ProvimuxSavingsMetrics;
  /** In the order of the request's `group` values. */
  breakdowns: ProvimuxSavingsBreakdown[];
  models: ProvimuxSavingsModel[];
  models_truncated: boolean;
  reported_cost_hosts: string[];
}

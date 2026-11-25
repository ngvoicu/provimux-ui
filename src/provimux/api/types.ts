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
  /** Which rule of models.only-my-names the answer reflects; null from a gateway without the marker. */
  applied?: ProvimuxNamesApplied | null;
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
 * Model lists: GET /v8/management/provimux/model-lists. Contract: Provimux
 * `.github/provimux/design/pui13/openapi.yaml` (ModelListsResponse) and `design/model-lists.md` section 5.5. Per
 * login, which source decides its models (its vendor's live list, the published list, the built-in list or none).
 * A Provimux without it answers 404, and the console shows the older live-lists page instead.
 */

/** Which source decides a login's models now; another value is unknown to this console. */
export type ProvimuxModelListSource = 'live' | 'published' | 'built-in' | 'none' | (string & {});

export interface ProvimuxModelListLive {
  /** The vendor has a list and this login is asked. */
  supported: boolean;
  /** A list of this account is held and not older than 7 days. */
  held: boolean;
  /** A list of this account is held but was not refreshed for 7 days, so the login no longer uses it. */
  expired: boolean;
  fetched_at: Timestamp | null;
  /** Read from the disk cache at start, not fetched again yet. */
  from_cache: boolean;
  fetching: boolean;
  listed_models: number | null;
  last_failure: ProvimuxLiveListFailure | null;
}

/** "live" (the vendor's list stated it), "built-in" (the catalog did), or null: no source states it. */
export type ProvimuxFieldSource = 'live' | 'built-in' | (string & {}) | null;

export interface ProvimuxModelListModel {
  id: string;
  display_name: string | null;
  /** live, built-in, provimux (added by Provimux itself), other (config, plugin, alias). */
  source: string;
  /** The vendor's list names it and the catalog lacks it. */
  learned: boolean;
  limits: ProvimuxLimits;
  modalities: { input: string[]; output: string[] };
  reasoning_levels: string[];
  sources: {
    display_name: ProvimuxFieldSource;
    context: ProvimuxFieldSource;
    output: ProvimuxFieldSource;
    input_modalities: ProvimuxFieldSource;
    output_modalities: ProvimuxFieldSource;
    reasoning_levels: ProvimuxFieldSource;
  };
}

export interface ProvimuxModelListLogin {
  auth_index: string | null;
  provider: string;
  login: ProvimuxLogin;
  disabled: boolean;
  source: ProvimuxModelListSource;
  live: ProvimuxModelListLive;
  registered_models: number | null;
  /** Models it serves that the catalog lacks. */
  learned_models: number | null;
  /** Filled only when asked for this login. */
  models: ProvimuxModelListModel[] | null;
}

export interface ProvimuxModelListsResponse {
  observed_at: Timestamp | null;
  options: { live_lists: boolean | null; published_lists: boolean | null };
  built_in: { dataset_version: string | null; generated_at: Timestamp | null };
  published: {
    /** held, none or off; another value is unknown. */
    state: string;
    dataset_version: string | null;
    generated_at: Timestamp | null;
    fetched_at: Timestamp | null;
    from_cache: boolean;
    last_failure: ProvimuxLiveListFailure | null;
  };
  login_types: string[];
  logins: ProvimuxModelListLogin[];
  /**
   * Config API keys whose model list refreshes itself or could (key-model-lists.md 7.1). null: the server sent
   * no `keys` (a Provimux before self-refreshing key lists): the console then hides the key lists' switch and
   * state, since such a server drops `fixed-models` on save.
   */
  keys: ProvimuxModelListKeyRow[] | null;
}

/*
 * Key model lists: the `keys` array of GET /v8/management/provimux/model-lists. Contract: Provimux
 * `.github/provimux/design/pui13/openapi.yaml` (ModelListKeyRow, ModelListKey, ModelListKeyModel) and
 * `design/key-model-lists.md` section 7.1. The console reads it in `normalize.ts` and interprets it in
 * `pages/keyLists/keyLists.ts`, nowhere else.
 */

/** Why a key's service is not asked for its list; another value is unknown to this console. */
export type ProvimuxKeyNotAsked = 'fixed' | 'live_lists_off' | 'no_list_endpoint' | (string & {});

export interface ProvimuxModelListKey {
  /** openai-compatibility, claude, codex, xai, meta, gemini, interactions or vertex; another is unknown. */
  type: string;
  /** An OpenAI-compatible entry's name (lower case), else the key type. */
  name: string;
  /** The key's entry says `fixed-models: true`. */
  fixed: boolean;
  /** null: its service is asked. */
  not_asked: ProvimuxKeyNotAsked | null;
  /** Rows of its `models` in config.yaml. */
  configured_models: number | null;
  /** Rows whose model the held list does not name; null without a list in use. */
  unlisted_models: number | null;
  /** Ids the key offers that no row names, as its service lists them (before the entry's prefix). */
  learned: string[];
  /** The rows counted by `unlisted_models`, by name as written; null with it. */
  unlisted: string[] | null;
}

export interface ProvimuxModelListKeyModel extends ProvimuxModelListModel {
  /** The held list names it; null without a held list. */
  listed: boolean | null;
}

/** A logins row's fields for one config API key, plus `key`. */
export interface ProvimuxModelListKeyRow extends Omit<ProvimuxModelListLogin, 'models'> {
  /** Filled only when asked for this key (`?auth_index=`). */
  models: ProvimuxModelListKeyModel[] | null;
  key: ProvimuxModelListKey;
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
    /** Which rates the estimates use: `base` = each model's base list rate, long-context tiers not applied
     * (T-116). null when the server does not say: the page then says nothing about tiers. */
    rates: 'base' | (string & {}) | null;
    openrouter: { url: string; fetched_at: Timestamp | null; models: number; remote: boolean };
    provimux: { updated: ProvimuxDay | null; models: number };
  };
  totals: ProvimuxSavingsMetrics;
  /** In the order of the request's `group` values. */
  breakdowns: ProvimuxSavingsBreakdown[];
  models: ProvimuxSavingsModel[];
  models_truncated: boolean;
  reported_cost_hosts: string[];
  /**
   * Requests by the name the client sent (`include=requested_models`, only-my-names round 2): an alias under the
   * alias, a prefixed name with its prefix, lower case. null when not asked for, or from a gateway without it.
   */
  requested_models: ProvimuxRequestedModels | null;
}

/** The Models page's 30 days of use: the savings answer, and the days before `requested_models.from` by model. */
export interface ProvimuxModelUsage extends ProvimuxSavingsResponse {
  /** The range's days before the requested names start, grouped by model; absent or null when not needed. */
  before?: ProvimuxSavingsBreakdown | null;
  /** Those days were needed and could not be read. */
  before_failed?: boolean;
}

export interface ProvimuxRequestedModels {
  /** The first day of the range that has requested names; the days before count only in the rows. null: none. */
  from: ProvimuxDay | null;
  /** Most requests first; `~other` holds the names folded past a day's limit. */
  models: Array<{ model: string; requests: number }>;
  /** More than 2000 names: the rest are left out. */
  truncated: boolean;
}

// --- GET /provimux/names (models.only-my-names; design only-my-names.md, section 6) ---------------------------

/** One account that offers a name, identified as a route of /provimux/model-routes is. */
export interface ProvimuxNameAccount {
  auth_index: string | null;
  provider: string;
  /** "oauth" = a subscription login, "apikey" = an API key. */
  kind: 'oauth' | 'apikey' | (string & {}) | null;
  priority: number | null;
  /** The host of an API key's base URL; null for a login. */
  host: string | null;
  login: ProvimuxLogin;
}

/** Who made a name the owner's: an alias row, the `keep` list, or an alias in a login's own file. */
export type ProvimuxNameSetBy = 'alias' | 'keep' | 'login-file' | (string & {});

export interface ProvimuxOwnName {
  /** As written where it was set, trimmed; compared exactly (`GPT-5.5` and `gpt-5.5` are two names). */
  name: string;
  /** `login-file` is no longer given (only-my-names.md 17.1 A); still read from an older gateway. */
  set_by: ProvimuxNameSetBy[];
  /** Enabled accounts that register it now; 0 when nothing answers it. */
  accounts: number;
  /**
   * The ids served through the name that are not the name itself: under an account's prefix ("team-a/opus"), or
   * with a thinking suffix an account registers as an id ("opus(high)"). Empty from a gateway without it.
   */
  copies: Array<{ id: string; accounts: number }>;
}

/**
 * Which rule of models.only-my-names the gateway serves now. A write's answer reflects it once `config_etag` is
 * the write's ETag and `applying` is false.
 */
export interface ProvimuxNamesApplied {
  generation: number;
  config_etag: string | null;
  applying: boolean;
}

export interface ProvimuxOtherName {
  /** As a client sends it, namespace and prefix included. */
  name: string;
  /** Highest priority first. */
  accounts: ProvimuxNameAccount[];
}

export interface ProvimuxRefusedName {
  name: string;
  requests: number;
  last_at: Timestamp;
}

export interface ProvimuxNamesResponse {
  observed_at: Timestamp | null;
  only_my_names: {
    enabled: boolean;
    /** false: the gateway does not decide names itself (Home); nothing is held back. */
    applies: boolean;
    /** Why it does not apply: 'home', or a reason this console does not know. */
    not_applied: 'home' | (string & {}) | null;
  };
  /**
   * The rule the answer describes: the one applied now, which after a write stays the one before it until every
   * account has registered again. null from a gateway without the marker.
   */
  applied: ProvimuxNamesApplied | null;
  /** Every name the owner set. Sorted by name. */
  names: ProvimuxOwnName[];
  /** `keep` entries the gateway ignores: a pattern, empty, or `auto` (`reserved`). The value as written. */
  keep_ignored: Array<{ value: string; reason: 'pattern' | 'empty' | 'reserved' | (string & {}) }>;
  /** Every other name an enabled account offers: held back while the switch is on, served otherwise. */
  others: ProvimuxOtherName[];
  /** Requests refused because the name is held back; null while the switch is off or does not apply. */
  refused: {
    since: Timestamp | null;
    /** Most recent first. */
    names: ProvimuxRefusedName[];
    /** More than 256 names were refused; the rest are not counted. */
    truncated: boolean;
  } | null;
}

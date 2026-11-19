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
  priority: number;
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

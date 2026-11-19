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

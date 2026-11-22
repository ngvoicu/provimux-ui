import type {
  ProvimuxFieldSource,
  ProvimuxModelListLogin,
  ProvimuxModelListModel,
  ProvimuxModelListsResponse,
} from '../../api/types';
import type { PresenceStatus } from '../../presence';

/**
 * The Model lists page reads recorded facts only (model-lists.md 5.5): which source decides a login's models, and
 * the state of its live list. Nothing here predicts the next fetch. The only rule the console applies itself is
 * the documented age limit, to mark a list that is getting old.
 */

/** A live list not refreshed for this long gives way to the published or built-in list (model-lists.md 5.3). */
export const LIVE_LIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Lists are fetched every 3 hours: a held list older than a day means its fetches have been failing for a while. */
export const LIVE_LIST_OLD_MS = 24 * 60 * 60 * 1000;

export type ModelSourceKind = 'live' | 'published' | 'built-in' | 'none' | 'unknown';

export function sourceKind(source: string): ModelSourceKind {
  return source === 'live' || source === 'published' || source === 'built-in' || source === 'none'
    ? source
    : 'unknown';
}

export type ModelRowState =
  /** the vendor's list for this account decides its models */
  | 'live'
  /** the list is held, but the newest fetch failed: the previous list is kept */
  | 'live_failing'
  /** the list is held and older than a day: its fetches have been failing for a while */
  | 'live_old'
  /** a fetch is running now */
  | 'fetching'
  /** models.live-lists is off */
  | 'off'
  /** the login is switched off */
  | 'disabled'
  /** the list was not refreshed for 7 days and no longer counts */
  | 'expired'
  /** no list held; the latest fetch failed */
  | 'failed'
  /** no list held yet, nothing failed */
  | 'waiting'
  /** the login type has no vendor list: it takes the published or built-in list */
  | 'no_vendor_list'
  /** a source this console does not know */
  | 'unknown';

export function modelRowState(
  login: ProvimuxModelListLogin,
  liveListsOn: boolean | null,
  nowMs: number
): ModelRowState {
  if (login.disabled) return 'disabled';
  const kind = sourceKind(login.source);
  if (kind === 'unknown') return 'unknown';
  if (!login.live.supported) return 'no_vendor_list';
  if (liveListsOn === false && kind !== 'live') return 'off';
  if (login.live.fetching) return 'fetching';
  if (kind === 'live') {
    if (login.live.last_failure) return 'live_failing';
    return listAge(login, nowMs) === 'old' ? 'live_old' : 'live';
  }
  if (login.live.expired) return 'expired';
  return login.live.last_failure ? 'failed' : 'waiting';
}

export type ListAge = 'fresh' | 'old' | 'expired' | 'none';

/** How old the account's newest list is: the mark for a list that is getting old. */
export function listAge(login: ProvimuxModelListLogin, nowMs: number): ListAge {
  if (login.live.expired) return 'expired';
  const fetched = login.live.fetched_at === null ? NaN : Date.parse(login.live.fetched_at);
  if (!Number.isFinite(fetched)) return 'none';
  return nowMs - fetched >= LIVE_LIST_OLD_MS ? 'old' : 'fresh';
}

export interface ModelListsSummary {
  live: number;
  published: number;
  builtIn: number;
  none: number;
  /** A source this console does not know: counted apart. */
  unknown: number;
  failing: number;
  fetching: number;
  /** Logins whose list is older than a day, or expired. */
  old: number;
  /** Models served that the catalog lacks, over every login. */
  learned: number;
}

export function modelListsSummary(
  logins: readonly ProvimuxModelListLogin[],
  nowMs: number
): ModelListsSummary {
  const summary: ModelListsSummary = {
    live: 0,
    published: 0,
    builtIn: 0,
    none: 0,
    unknown: 0,
    failing: 0,
    fetching: 0,
    old: 0,
    learned: 0,
  };
  for (const login of logins) {
    const kind = sourceKind(login.source);
    if (kind === 'live') summary.live += 1;
    else if (kind === 'published') summary.published += 1;
    else if (kind === 'built-in') summary.builtIn += 1;
    else if (kind === 'none') summary.none += 1;
    else summary.unknown += 1;
    if (login.live.last_failure && !login.disabled) summary.failing += 1;
    if (login.live.fetching) summary.fetching += 1;
    const age = listAge(login, nowMs);
    if (!login.disabled && (age === 'old' || age === 'expired')) summary.old += 1;
    summary.learned += login.learned_models ?? 0;
  }
  return summary;
}

export type PublishedLine = 'held' | 'held_failing' | 'none' | 'none_failing' | 'off' | 'unknown';

/** The line at the top: which providers.dev dataset is held, or that providers.dev was not reached and since when. */
export function publishedLine(data: Pick<ProvimuxModelListsResponse, 'published'>): PublishedLine {
  const { state, last_failure: failure } = data.published;
  if (state === 'held') return failure ? 'held_failing' : 'held';
  if (state === 'none') return failure ? 'none_failing' : 'none';
  if (state === 'off') return 'off';
  return 'unknown';
}

export type FieldSourceKind = 'live' | 'built-in' | 'unknown' | 'none';

export function fieldSourceKind(source: ProvimuxFieldSource): FieldSourceKind {
  if (source === null) return 'none';
  return source === 'live' ? 'live' : source === 'built-in' ? 'built-in' : 'unknown';
}

export type ModelOrigin = 'learned' | 'live' | 'built-in' | 'provimux' | 'other' | 'unknown';

/** Where a model of a login comes from, for its tag: learned before live (a learned model is listed live too). */
export function modelOrigin(model: ProvimuxModelListModel): ModelOrigin {
  if (model.learned) return 'learned';
  return model.source === 'live' ||
    model.source === 'built-in' ||
    model.source === 'provimux' ||
    model.source === 'other'
    ? model.source
    : 'unknown';
}

/** Learned models first, then by id: what is new is what the operator looks for. */
export function sortModels(models: readonly ProvimuxModelListModel[]): ProvimuxModelListModel[] {
  return [...models].sort((a, b) =>
    a.learned !== b.learned ? (a.learned ? -1 : 1) : a.id.localeCompare(b.id)
  );
}

/** Which page the route shows for the model-lists endpoint's presence. */
export function modelListsPageFor(status: PresenceStatus): 'model-lists' | 'live-lists' {
  return status === 'unsupported' ? 'live-lists' : 'model-lists';
}

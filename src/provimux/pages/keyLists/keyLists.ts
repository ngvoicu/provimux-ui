/**
 * Self-refreshing key lists, as the console reads them (design key-model-lists.md 7): every API key's model
 * list refreshes itself from its service unless the key is set to a fixed list. This is the one place that
 * interprets the `keys` rows of GET /provimux/model-lists (read leniently in `api/normalize.ts`): whether the
 * server has them at all, each key's state in plain categories, the models a key learned by itself, and where
 * a learned model is also served by a subscription. The proxy part is under review; a change to the contract
 * lands here and in the reader, nowhere else. Pure.
 */
import type {
  ProvimuxLiveListFailure,
  ProvimuxModelListKeyRow,
  ProvimuxModelListsResponse,
  ProvimuxModelRoute,
  ProvimuxModelRoutesResponse,
} from '../../api/types';
import type { PresenceStatus } from '../../presence';
import { LIVE_LIST_OLD_MS } from '../modelLists/logic';

/** A name as the console compares names: trimmed, lower case (aliases' `nameKey`). */
const key = (name: string): string => name.trim().toLowerCase();

/**
 * Whether the connected server has self-refreshing key lists: its model-lists answer carries `keys`. false
 * when it answers without them, or has no model-lists at all (404); null while that is not known (not read
 * yet, or the read failed). The console shows the fixed-list switch, a key's list state and OpenAI-compatible
 * exclusions only on true: a server without the change drops `fixed-models` on save.
 */
export function keyListsSupported(
  lists: Pick<ProvimuxModelListsResponse, 'keys'> | null,
  presence: PresenceStatus
): boolean | null {
  if (lists) return lists.keys !== null;
  return presence === 'unsupported' ? false : null;
}

/** The key rows by auth index. */
export function keyRowsByIndex(
  lists: Pick<ProvimuxModelListsResponse, 'keys'> | null
): Map<string, ProvimuxModelListKeyRow> {
  const rows = new Map<string, ProvimuxModelListKeyRow>();
  for (const row of lists?.keys ?? []) if (row.auth_index) rows.set(row.auth_index, row);
  return rows;
}

/** An account's key rows, in the order of its auth indexes (an OpenAI-compatible entry has one per key). */
export function keyRowsOf(
  rows: ReadonlyMap<string, ProvimuxModelListKeyRow>,
  authIndexes: readonly string[]
): ProvimuxModelListKeyRow[] {
  return authIndexes.flatMap((index) => {
    const row = rows.get(index);
    return row ? [row] : [];
  });
}

// --- a key's state ------------------------------------------------------------------------------------------

/**
 * A key's model list in the owner's categories:
 * - `live`: its service's list is held and added to its rows (refreshed when, how many it found and learned,
 *   which rows the service no longer lists, a newer fetch that failed);
 * - `waiting`: its service is asked, but no list is held yet (the first fetch has not finished, or failed):
 *   it offers its rows;
 * - `expired`: the list was not refreshed for 7 days and no longer counts: it offers its rows;
 * - `fixed`, `live-lists-off`, `no-list`: its service is not asked, and why; `not-asked` for a reason this
 *   console does not know.
 */
export type KeyListState =
  | {
      kind: 'live';
      fetchedAt: string | null;
      fromCache: boolean;
      fetching: boolean;
      /** Models its service listed. */
      listed: number | null;
      /** Models it offers that no row of its settings names. */
      learned: string[];
      /** Rows of its settings whose model the service no longer lists. */
      unlisted: string[];
      configured: number | null;
      /** A newer fetch that failed; the held list stays. */
      failure: ProvimuxLiveListFailure | null;
      /** Held for more than a day: its fetches have been failing for a while. */
      old: boolean;
    }
  | {
      kind: 'waiting';
      fetching: boolean;
      failure: ProvimuxLiveListFailure | null;
      configured: number | null;
    }
  | {
      kind: 'expired';
      fetchedAt: string | null;
      failure: ProvimuxLiveListFailure | null;
      configured: number | null;
    }
  | { kind: 'fixed'; configured: number | null }
  | { kind: 'live-lists-off'; configured: number | null }
  | { kind: 'no-list'; configured: number | null }
  | { kind: 'not-asked'; reason: string; configured: number | null };

export function keyListState(row: ProvimuxModelListKeyRow, nowMs: number): KeyListState {
  const configured = row.key.configured_models;
  const reason = row.key.not_asked;
  if (reason !== null) {
    if (reason === 'fixed') return { kind: 'fixed', configured };
    if (reason === 'live_lists_off') return { kind: 'live-lists-off', configured };
    if (reason === 'no_list_endpoint') return { kind: 'no-list', configured };
    return { kind: 'not-asked', reason, configured };
  }
  // A key that says it is fixed but is still asked cannot happen; the server's `not_asked` decides.
  const live = row.live;
  if (live.held && row.source === 'live') {
    const fetched = live.fetched_at === null ? NaN : Date.parse(live.fetched_at);
    const failure =
      live.last_failure && Number.isFinite(fetched) && Date.parse(live.last_failure.at) > fetched
        ? live.last_failure
        : null;
    return {
      kind: 'live',
      fetchedAt: live.fetched_at,
      fromCache: live.from_cache,
      fetching: live.fetching,
      listed: live.listed_models,
      learned: row.key.learned,
      unlisted: row.key.unlisted ?? [],
      configured,
      failure,
      old: Number.isFinite(fetched) && nowMs - fetched >= LIVE_LIST_OLD_MS,
    };
  }
  if (live.expired) {
    return { kind: 'expired', fetchedAt: live.fetched_at, failure: live.last_failure, configured };
  }
  return { kind: 'waiting', fetching: live.fetching, failure: live.last_failure, configured };
}

/** The models a key learned by itself, as its list says: none unless its list is in use. */
export const learnedOf = (row: ProvimuxModelListKeyRow): string[] =>
  row.source === 'live' ? row.key.learned : [];

// --- learned models, by the names clients send -----------------------------------------------------------------

/**
 * The names a key's learned models are served under: each id as its service lists it, and with the key's
 * prefix (`prefix/id`), since `learned` is given before the prefix. Compared as names are (trimmed, lower case).
 */
export function learnedNames(
  row: ProvimuxModelListKeyRow,
  prefix: string | null
): Map<string, string> {
  const names = new Map<string, string>();
  const p = prefix?.trim();
  for (const id of learnedOf(row)) {
    names.set(key(id), id);
    if (p) names.set(key(`${p}/${id}`), id);
  }
  return names;
}

/** Every key's learned names by its auth index, for the routes of a model page. */
export function learnedByIndex(
  lists: Pick<ProvimuxModelListsResponse, 'keys'> | null,
  prefixOf: (authIndex: string) => string | null
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const row of lists?.keys ?? []) {
    if (!row.auth_index) continue;
    const names = learnedNames(row, prefixOf(row.auth_index));
    if (names.size) out.set(row.auth_index, names);
  }
  return out;
}

// --- a learned model a subscription also serves --------------------------------------------------------------

/**
 * Who is tried first for a model a key learned and a subscription also serves (routes of higher priority are
 * tried first; equal priorities share the requests):
 * - `key-first`: the key, so its share is paid per token whenever it answers;
 * - `shared`: the key and a subscription at the same priority share the requests;
 * - `sub-first`: a subscription; the key only takes over when no subscription can answer;
 * - `unknown`: the server did not report a priority.
 */
export type OverlapOrder = 'key-first' | 'shared' | 'sub-first' | 'unknown';

export interface KeyOverlap {
  /** The name clients send (prefixed when the route is). */
  name: string;
  /** The model as the key's service lists it. */
  model: string;
  /** The subscriptions' routes for the name, highest priority first. */
  subscriptions: ProvimuxModelRoute[];
  keyPriority: number | null;
  /** The highest priority among the subscriptions. */
  subPriority: number | null;
  order: OverlapOrder;
}

/** Who goes first between a key's priority and the subscriptions' highest. */
export function overlapOrder(keyPriority: number | null, subPriority: number | null): OverlapOrder {
  if (keyPriority === null || subPriority === null) return 'unknown';
  return keyPriority > subPriority
    ? 'key-first'
    : keyPriority === subPriority
      ? 'shared'
      : 'sub-first';
}

/** Whether part of a model's requests is paid per token on the key while a subscription could serve it. */
export const paysPerToken = (order: OverlapOrder): boolean => order !== 'sub-first';

/**
 * The learned models of a key (its routes by `authIndexes`) that a subscription also serves now, from the
 * served routes. Risky ones first (`paysPerToken`), then by name.
 */
export function keyOverlaps(
  row: ProvimuxModelListKeyRow,
  prefix: string | null,
  authIndexes: readonly string[],
  routes: Pick<ProvimuxModelRoutesResponse, 'models'> | null
): KeyOverlap[] {
  const names = learnedNames(row, prefix);
  if (!names.size || !routes) return [];
  const own = new Set(authIndexes);
  const out: KeyOverlap[] = [];
  for (const model of routes.models) {
    const id = names.get(key(model.id));
    if (id === undefined) continue;
    const mine = model.routes.filter(
      (route) => route.kind === 'apikey' && route.auth_index !== null && own.has(route.auth_index)
    );
    const subs = model.routes.filter((route) => route.kind === 'oauth');
    if (!mine.length || !subs.length) continue;
    const priorities = subs.map((route) => route.priority);
    const subPriority = priorities.some((p) => p === null)
      ? null
      : Math.max(...(priorities as number[]));
    const keyPriority = mine[0].priority;
    out.push({
      name: model.id,
      model: id,
      subscriptions: [...subs].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)),
      keyPriority,
      subPriority,
      order: overlapOrder(keyPriority, subPriority),
    });
  }
  return out.sort(
    (a, b) =>
      Number(paysPerToken(b.order)) - Number(paysPerToken(a.order)) || a.name.localeCompare(b.name)
  );
}

/** The priority that puts a key below every subscription of its overlaps: one under the lowest needed. */
export function priorityBelow(overlaps: readonly KeyOverlap[]): number | null {
  const subs = overlaps
    .filter((overlap) => paysPerToken(overlap.order) && overlap.subPriority !== null)
    .map((overlap) => overlap.subPriority as number);
  return subs.length ? Math.min(...subs) - 1 : null;
}

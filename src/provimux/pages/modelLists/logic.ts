import type { ProvimuxModelListLogin } from '../../api/types';

/**
 * A login's model list, as the Models page shows it on the login's routes: recorded facts only (model-lists.md
 * 5.5), which source decides the login's models and the state of its live list. Nothing here predicts the next
 * fetch. The only rule the console applies itself is the documented age limit, to mark a list getting old.
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

export type ListAge = 'fresh' | 'old' | 'expired' | 'none';

/** How old the account's newest list is: the mark for a list that is getting old. */
export function listAge(login: ProvimuxModelListLogin, nowMs: number): ListAge {
  if (login.live.expired) return 'expired';
  const fetched = login.live.fetched_at === null ? NaN : Date.parse(login.live.fetched_at);
  if (!Number.isFinite(fetched)) return 'none';
  return nowMs - fetched >= LIVE_LIST_OLD_MS ? 'old' : 'fresh';
}

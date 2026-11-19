import type { ProvimuxLiveListLogin } from '../../api/types';
import { timeMs } from '../time';

/**
 * What a login's row says, from the recorded facts only (02-live-lists.md, section 2): `source` is "catalog" when
 * the option is off, the login is disabled, no list of this account is held yet, or its fetches fail; `enabled`,
 * `disabled`, `fetching` and `last_failure` tell those apart. Nothing here predicts the next fetch.
 */
export type LiveRowState =
  /** a list of this account is held and filters its models */
  | 'live'
  /** a list is held, but the newest fetch failed: the previous list is kept and is getting old */
  | 'live_failing'
  /** a fetch is running now */
  | 'fetching'
  /** models.live-lists is off: every login uses the catalog */
  | 'off'
  /** the login is switched off and never fetched */
  | 'disabled'
  /** no list held; the latest fetch failed */
  | 'failed'
  /** no list held yet, nothing failed: the first fetch has not run or not finished */
  | 'waiting'
  /** a source this console does not know */
  | 'unknown';

export function liveRowState(login: ProvimuxLiveListLogin, enabled: boolean | null): LiveRowState {
  if (login.disabled) return 'disabled';
  if (enabled === false) return 'off';
  if (login.fetching) return 'fetching';
  if (login.source === 'live') return login.last_failure ? 'live_failing' : 'live';
  if (login.source === 'catalog') return login.last_failure ? 'failed' : 'waiting';
  return 'unknown';
}

export interface LiveSummary {
  live: number;
  catalog: number;
  /** A source this console does not know: counted apart, never as catalog. */
  unknown: number;
  failing: number;
  fetching: number;
}

export function liveSummary(logins: readonly ProvimuxLiveListLogin[]): LiveSummary {
  const summary: LiveSummary = { live: 0, catalog: 0, unknown: 0, failing: 0, fetching: 0 };
  for (const login of logins) {
    if (login.source === 'live') summary.live += 1;
    else if (login.source === 'catalog') summary.catalog += 1;
    else summary.unknown += 1;
    if (login.last_failure && !login.disabled) summary.failing += 1;
    if (login.fetching) summary.fetching += 1;
  }
  return summary;
}

/** Whether a login reported back after a refresh asked at the server's `sinceMs`. */
export function settledSince(login: ProvimuxLiveListLogin, sinceMs: number): boolean {
  if (login.disabled) return true;
  if (login.fetching) return false;
  const fetched = timeMs(login.fetched_at);
  const failed = timeMs(login.last_failure?.at);
  return (fetched !== null && fetched > sinceMs) || (failed !== null && failed > sinceMs);
}

/**
 * Progress of a refresh (05-console-contract.md, section 3): it is done when each login has `fetching: false` and
 * a `fetched_at` or `last_failure.at` later than the click. Disabled logins are never fetched and do not count.
 */
export function refreshProgress(
  logins: readonly ProvimuxLiveListLogin[],
  sinceMs: number
): { done: number; total: number; settled: boolean } {
  const counted = logins.filter((login) => !login.disabled);
  const done = counted.filter((login) => settledSince(login, sinceMs)).length;
  return { done, total: counted.length, settled: done === counted.length };
}

export type FailureHint =
  | 'signin'
  | 'denied'
  | 'rate_limited'
  | 'provider_error'
  | 'http_other'
  | 'credentials'
  | 'network'
  | 'invalid_response'
  | 'other';

/**
 * A one-line reading of a failure's code; the reason in words stays in the server's log. Only a 401 asks to sign in
 * again: a 403 is the provider denying this account (policy, permissions), which a new sign-in does not change.
 */
export function failureHint(failure: {
  category: string;
  http_status: number | null;
}): FailureHint {
  switch (failure.category) {
    case 'http_status': {
      const status = failure.http_status ?? 0;
      if (status === 401) return 'signin';
      if (status === 403) return 'denied';
      if (status === 429) return 'rate_limited';
      if (status >= 500) return 'provider_error';
      return 'http_other';
    }
    case 'credentials':
    case 'network':
    case 'invalid_response':
      return failure.category;
    default:
      return 'other';
  }
}

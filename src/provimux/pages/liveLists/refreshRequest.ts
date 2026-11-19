import { getErrorMessage } from '@/utils/helpers';
import { errorStatus, provimuxApi } from '../../api/provimuxApi';
import type { RequestGuard } from '../shared/requestGuard';

/**
 * "Refresh lists now": one POST /models/refresh, and what its answer says, nothing more. The page does not follow
 * the logins afterwards; each row shows its login's state as of the latest status read.
 * - 2xx: the refresh was requested.
 * - Provimux's own 502 (a catalog it could not read): that failure. Whether logins were asked depends on the server
 *   (only with live lists on), so nothing is said about them.
 * - another HTTP error response: the server answered that it did not take the refresh.
 * - no HTTP response at all (network error, timeout, a dropped reply): unknown. The server may have accepted it and
 *   be refreshing, so the page must not say it was not requested (that invites a duplicate).
 */
export type RefreshOutcome =
  | { kind: 'requested'; atMs: number }
  | { kind: 'catalog_failed'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'unconfirmed' };

/**
 * Sends the refresh and applies its outcome, unless the page closed or the connection changed meanwhile: then a late
 * answer changes nothing (resolves false).
 */
export async function requestRefresh(
  guard: RequestGuard,
  apply: (outcome: RefreshOutcome) => void,
  now: () => number = Date.now
): Promise<boolean> {
  const { client, isCurrent } = guard.begin();
  let outcome: RefreshOutcome;
  try {
    const { catalogError } = await provimuxApi.refreshModels(client);
    outcome =
      catalogError === null
        ? { kind: 'requested', atMs: now() }
        : { kind: 'catalog_failed', message: catalogError };
  } catch (error) {
    outcome =
      errorStatus(error) === null
        ? { kind: 'unconfirmed' }
        : { kind: 'failed', message: getErrorMessage(error) };
  }
  if (!isCurrent()) return false;
  apply(outcome);
  return true;
}

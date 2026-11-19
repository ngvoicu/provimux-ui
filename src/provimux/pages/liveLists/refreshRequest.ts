import { getErrorMessage } from '@/utils/helpers';
import { provimuxApi } from '../../api/provimuxApi';
import type { RequestGuard } from '../shared/requestGuard';

/**
 * "Refresh lists now": one POST /models/refresh, and what its answer says, nothing more. The page does not follow
 * the logins afterwards; each row shows its login's state as of the latest status read.
 * - 2xx: the refresh was requested.
 * - Provimux's own 502 (a catalog it could not read): that failure. Whether logins were asked depends on the server
 *   (only with live lists on), so nothing is said about them.
 * - anything else: the error.
 */
export type RefreshOutcome =
  | { kind: 'requested'; atMs: number }
  | { kind: 'catalog_failed'; message: string }
  | { kind: 'failed'; message: string };

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
    outcome = { kind: 'failed', message: getErrorMessage(error) };
  }
  if (!isCurrent()) return false;
  apply(outcome);
  return true;
}

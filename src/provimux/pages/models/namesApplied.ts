/**
 * After a write of the configuration, whether the gateway serves it yet (design models-page.md 8.1; the gateway's
 * only-my-names.md 15). The gateway answers a write before its accounts have registered again under it, and
 * `GET /provimux/names` describes the rule it applies now: until then, the one before. Its `applied` block says
 * which: the answer reflects the write once `applied.config_etag` is the write's ETag and `applied.applying` is
 * false. The page reads the names again at a short interval until they match, and after a limit says plainly that
 * the change is not applied yet. A gateway without the block cannot say: the page then reads again at fixed
 * delays (`FALLBACK_READS_MS`). Pure, but for the loop's clock, which is handed in.
 */
import type { ProvimuxNamesApplied } from '../../api/types';

/** A write the page waits on: the configuration's ETag it left. `late` once the limit passed. */
export interface PendingWrite {
  target: string;
  late: boolean;
}

/**
 * Where the names stand against the page's last write: `applying` (not yet, within the limit), `late` (not yet,
 * past it), or null (nothing to wait for: no write, applied, or a gateway that does not say).
 */
export type NamesApplying = 'applying' | 'late' | null;

/** The marker reflects the write that left `target`. */
export const appliedMatches = (applied: ProvimuxNamesApplied | null, target: string): boolean =>
  applied !== null && !applied.applying && applied.config_etag === target;

export function applyingOf(
  applied: ProvimuxNamesApplied | null | undefined,
  pending: PendingWrite | null
): NamesApplying {
  if (!pending || !applied) return null;
  if (appliedMatches(applied, pending.target)) return null;
  return pending.late ? 'late' : 'applying';
}

/** The reads after a write, ms after it: often at first (it usually takes tens of ms), then once a second. */
export const APPLIED_READS_MS = [150, 300, 600, 1_000, 1_500, 2_000, 3_000, 4_000, 5_000];
/** Then every second until this long after the write: the page then says the change is not applied yet. */
export const APPLIED_LIMIT_MS = 15_000;
/** A gateway without `applied`: reads at these delays after the write, as before the marker. */
export const FALLBACK_READS_MS = [1_000, 4_000];

/** What one read of the names gave: its marker, null when the answer has none, undefined when it failed. */
export type MarkerRead = ProvimuxNamesApplied | null | undefined;

export interface WaitOptions {
  target: string;
  /** Reads the names (the page's own load, which also draws the answer). */
  read: () => Promise<MarkerRead>;
  /** Waits until `ms` after the write. */
  sleepUntil: (ms: number) => Promise<void>;
  /** A newer write, or the page closed: stop. */
  cancelled: () => boolean;
  reads?: readonly number[];
  limitMs?: number;
}

/**
 * Reads until the answer reflects the write: `applied`, `late` at the limit, `unsupported` when an answer carries no
 * marker (the caller falls back to fixed delays), `cancelled` when a newer write took over. The first read is at
 * once; a failed read is tried again at the next step.
 */
export async function waitApplied(
  options: WaitOptions
): Promise<'applied' | 'late' | 'unsupported' | 'cancelled'> {
  const reads = options.reads ?? APPLIED_READS_MS;
  const limit = options.limitMs ?? APPLIED_LIMIT_MS;
  const at = [0, ...reads.filter((ms) => ms < limit)];
  for (let next = (at[at.length - 1] ?? 0) + 1_000; next < limit; next += 1_000) at.push(next);
  at.push(limit);
  for (const ms of at) {
    if (ms > 0) await options.sleepUntil(ms);
    if (options.cancelled()) return 'cancelled';
    const marker = await options.read();
    if (options.cancelled()) return 'cancelled';
    if (marker === null) return 'unsupported';
    if (marker !== undefined && appliedMatches(marker, options.target)) return 'applied';
  }
  return 'late';
}

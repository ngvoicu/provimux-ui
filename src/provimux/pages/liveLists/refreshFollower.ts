import type { ProvimuxLiveListLogin } from '../../api/types';
import { refreshProgress } from './logic';

/**
 * Follows a live-list refresh until every login reported back (05-console-contract.md, section 3): POST
 * /models/refresh returns before the lists arrive, so the status is read again every 2 seconds, for at most 60.
 *
 * - The deadline is its own timer, started with the refresh: it ends the wait on time whatever the reads do (failing,
 *   slow, or not changing anything), so the page always gets Refresh back.
 * - One status read at a time: the next is scheduled 2 seconds after the previous one finished, so a read slower than
 *   2 seconds is never overtaken and thrown away.
 * - No read while the tab is hidden; the deadline still runs.
 * Framework-free and with injectable timers, so tests drive it with a fake clock.
 */

export interface FollowProgress {
  /** Logins (not disabled) that reported back after the click, of those counted. */
  done: number;
  total: number;
  /** The last status read failed with this; null once one succeeds. */
  readError: string | null;
  /** Status reads started so far. */
  reads: number;
}

export type FollowEnd =
  | { kind: 'done'; done: number; total: number }
  | {
      kind: 'deadline';
      done: number;
      total: number;
      readError: string | null;
      /** Whether any status read succeeded during the wait. */
      seen: boolean;
    };

export interface FollowOptions {
  /** One status read: the logins, null when its answer was superseded by another load. Rejects when it fails. */
  read: () => Promise<readonly ProvimuxLiveListLogin[] | null>;
  /** The server's time of the click. */
  sinceMs: number;
  /** The logins on screen at the click: the count until a status read succeeds. */
  initial?: readonly ProvimuxLiveListLogin[];
  onProgress: (progress: FollowProgress) => void;
  onEnd: (end: FollowEnd) => void;
  pollMs?: number;
  waitMs?: number;
  isVisible?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export const REFRESH_POLL_MS = 2_000;
export const REFRESH_WAIT_MS = 60_000;

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error ?? 'unknown error');

export function followRefresh(options: FollowOptions): { cancel: () => void } {
  const pollMs = options.pollMs ?? REFRESH_POLL_MS;
  const waitMs = options.waitMs ?? REFRESH_WAIT_MS;
  const isVisible =
    options.isVisible ??
    (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));

  let stopped = false;
  let pollTimer: unknown = null;
  let reads = 0;
  const start = refreshProgress(options.initial ?? [], options.sinceMs);
  let done = start.done;
  let total = start.total;
  let seen = false;
  let readError: string | null = null;

  const stop = () => {
    stopped = true;
    if (pollTimer !== null) clearTimer(pollTimer);
    clearTimer(deadline);
    pollTimer = null;
  };
  const end = (result: FollowEnd) => {
    if (stopped) return;
    stop();
    options.onEnd(result);
  };
  const schedule = () => {
    if (!stopped) pollTimer = setTimer(tick, pollMs);
  };

  function tick() {
    pollTimer = null;
    if (stopped) return;
    if (!isVisible()) {
      schedule();
      return;
    }
    reads += 1;
    options
      .read()
      .then(
        (logins) => {
          if (stopped || logins === null) return;
          const progress = refreshProgress(logins, options.sinceMs);
          done = progress.done;
          total = progress.total;
          seen = true;
          readError = null;
          options.onProgress({ done, total, readError, reads });
          if (progress.settled) end({ kind: 'done', done, total });
        },
        (error: unknown) => {
          if (stopped) return;
          readError = messageOf(error);
          options.onProgress({ done, total, readError, reads });
        }
      )
      .finally(schedule);
  }

  const deadline = setTimer(() => end({ kind: 'deadline', done, total, readError, seen }), waitMs);
  tick();
  return { cancel: stop };
}

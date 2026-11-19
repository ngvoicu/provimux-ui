// Following a live-list refresh (T-78, finding 1): its own 60-second deadline, one status read at a time, Refresh
// back at the deadline. Driven by a fake clock, as the reviewer's browser runs were: status reads that keep failing
// with 503, and successful reads slower than the 2-second rhythm.
import { describe, expect, test } from 'bun:test';
import type { ProvimuxLiveListLogin } from '../../src/provimux/api/types';
import {
  REFRESH_POLL_MS,
  REFRESH_WAIT_MS,
  followRefresh,
  type FollowEnd,
  type FollowProgress,
} from '../../src/provimux/pages/liveLists/refreshFollower';

const CLICK = Date.parse('2026-11-19T18:29:04.706Z');

const login = (patch: Partial<ProvimuxLiveListLogin> = {}): ProvimuxLiveListLogin => ({
  auth_index: 'a1',
  provider: 'claude',
  login: { name: 'review-cl.json', email: null, label: null },
  disabled: false,
  source: 'live',
  fetching: false,
  fetched_at: '2026-11-19T18:20:00.000Z',
  listed_models: 1,
  registered_models: 1,
  last_failure: null,
  ...patch,
});

/** A fake clock: timers fire in order as time advances; promises settle between them. */
function fakeClock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      next += 1;
      timers.set(next, { at: now + ms, fn });
      return next;
    },
    clearTimer: (id: unknown) => {
      timers.delete(id as number);
    },
    pending: () => timers.size,
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        await flush();
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
      await flush();
    },
  };
}

/** A status endpoint whose answers take `delayMs` on the fake clock; counts reads in flight. */
function statusEndpoint(
  clock: ReturnType<typeof fakeClock>,
  answer: (n: number) => { logins: ProvimuxLiveListLogin[] } | { error: Error },
  delayMs: number
) {
  const stats = { started: 0, inFlight: 0, maxInFlight: 0, startedAt: [] as number[] };
  const read = () =>
    new Promise<readonly ProvimuxLiveListLogin[] | null>((resolve, reject) => {
      stats.started += 1;
      stats.startedAt.push(clock.now());
      stats.inFlight += 1;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      const n = stats.started;
      clock.setTimer(() => {
        stats.inFlight -= 1;
        const result = answer(n);
        if ('error' in result) reject(result.error);
        else resolve(result.logins);
      }, delayMs);
    });
  return { read, stats };
}

function follow(
  clock: ReturnType<typeof fakeClock>,
  read: () => Promise<readonly ProvimuxLiveListLogin[] | null>,
  isVisible: () => boolean = () => true,
  initial: readonly ProvimuxLiveListLogin[] = []
) {
  const progress: FollowProgress[] = [];
  const ends: Array<FollowEnd & { at: number }> = [];
  const handle = followRefresh({
    read,
    sinceMs: CLICK,
    initial,
    isVisible,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onProgress: (p) => progress.push(p),
    onEnd: (end) => ends.push({ ...end, at: clock.now() }),
  });
  return { progress, ends, handle };
}

describe('the deadline is its own timer', () => {
  test('status reads that keep failing (503) end the wait at 60 s, with the error, and stop reading', async () => {
    const clock = fakeClock();
    const endpoint = statusEndpoint(
      clock,
      () => ({ error: new Error('Live status temporarily unavailable') }),
      40
    );
    const run = follow(clock, endpoint.read);
    await clock.advance(REFRESH_WAIT_MS + 30_000);
    expect(run.ends).toHaveLength(1);
    expect(run.ends[0]).toMatchObject({
      kind: 'deadline',
      at: REFRESH_WAIT_MS,
      readError: 'Live status temporarily unavailable',
      seen: false,
    });
    // After the deadline nothing is read or scheduled.
    const readsAtDeadline = endpoint.stats.startedAt.filter((at) => at <= REFRESH_WAIT_MS).length;
    expect(endpoint.stats.started).toBe(readsAtDeadline);
    expect(clock.pending()).toBe(0);
    expect(run.progress.at(-1)?.readError).toBe('Live status temporarily unavailable');
  });

  test('when no read succeeds, the count is the logins that were on screen, not 0 of 0', async () => {
    const clock = fakeClock();
    const endpoint = statusEndpoint(clock, () => ({ error: new Error('HTTP 503') }), 10);
    const onScreen = [
      login(),
      login({ auth_index: 'b' }),
      login({ auth_index: 'c', disabled: true }),
    ];
    const run = follow(clock, endpoint.read, () => true, onScreen);
    await clock.advance(REFRESH_WAIT_MS);
    expect(run.progress[0]).toMatchObject({ done: 0, total: 2 });
    expect(run.ends[0]).toMatchObject({ kind: 'deadline', done: 0, total: 2, seen: false });
  });

  test('reads that succeed without any login reporting back also end at 60 s', async () => {
    const clock = fakeClock();
    const endpoint = statusEndpoint(clock, () => ({ logins: [login({ fetching: true })] }), 30);
    const run = follow(clock, endpoint.read);
    await clock.advance(REFRESH_WAIT_MS * 2);
    expect(run.ends).toEqual([
      { kind: 'deadline', done: 0, total: 1, readError: null, seen: true, at: REFRESH_WAIT_MS },
    ]);
  });

  test('a hidden tab reads nothing, and the deadline still ends the wait', async () => {
    const clock = fakeClock();
    const endpoint = statusEndpoint(clock, () => ({ logins: [login()] }), 10);
    const run = follow(clock, endpoint.read, () => false);
    await clock.advance(REFRESH_WAIT_MS);
    expect(endpoint.stats.started).toBe(0);
    expect(run.ends[0]).toMatchObject({ kind: 'deadline', at: REFRESH_WAIT_MS });
  });
});

describe('one status read at a time', () => {
  test('reads slower than 2 s are never overtaken: the first one that reports back ends the wait', async () => {
    // Review: answers delayed 2.6 s; the first carried a fetch after the click, and the old page dropped it.
    const clock = fakeClock();
    const endpoint = statusEndpoint(
      clock,
      () => ({ logins: [login({ fetched_at: '2026-11-19T18:29:04.740Z' })] }),
      2_600
    );
    const run = follow(clock, endpoint.read);
    await clock.advance(10_000);
    expect(run.ends).toEqual([{ kind: 'done', done: 1, total: 1, at: 2_600 }]);
    expect(endpoint.stats.started).toBe(1);
    expect(endpoint.stats.maxInFlight).toBe(1);
  });

  test('the next read starts 2 s after the previous one finished', async () => {
    const clock = fakeClock();
    const endpoint = statusEndpoint(
      clock,
      (n) => ({
        logins: [
          n < 3
            ? login({ fetching: true })
            : login({ fetching: false, fetched_at: '2026-11-19T18:29:09.000Z' }),
        ],
      }),
      2_600
    );
    const run = follow(clock, endpoint.read);
    await clock.advance(30_000);
    expect(endpoint.stats.startedAt).toEqual([
      0,
      2_600 + REFRESH_POLL_MS,
      2 * (2_600 + REFRESH_POLL_MS),
    ]);
    expect(endpoint.stats.maxInFlight).toBe(1);
    expect(run.ends).toEqual([
      { kind: 'done', done: 1, total: 1, at: 3 * 2_600 + 2 * REFRESH_POLL_MS },
    ]);
    expect(run.progress.map((p) => p.done)).toEqual([0, 0, 1]);
  });

  test('a failed read is reported and the next one still comes; a later success clears the error', async () => {
    const clock = fakeClock();
    const endpoint = statusEndpoint(
      clock,
      (n) =>
        n === 1
          ? { error: new Error('HTTP 503') }
          : { logins: [login({ fetched_at: '2026-11-19T18:29:06.000Z' })] },
      100
    );
    const run = follow(clock, endpoint.read);
    await clock.advance(10_000);
    expect(run.progress.map((p) => p.readError)).toEqual(['HTTP 503', null]);
    expect(run.ends[0]).toMatchObject({ kind: 'done', at: 100 + REFRESH_POLL_MS + 100 });
  });

  test('an answer another load superseded (null) is skipped, not counted', async () => {
    const clock = fakeClock();
    const endpoint = statusEndpoint(
      clock,
      () => ({ logins: [login({ fetched_at: '2026-11-19T18:29:06.000Z' })] }),
      50
    );
    let calls = 0;
    const run = follow(clock, async () => (++calls === 1 ? null : endpoint.read()));
    await clock.advance(10_000);
    expect(run.progress).toHaveLength(1);
    expect(run.ends[0]).toMatchObject({ kind: 'done' });
  });

  test('cancel (the page closed) stops everything without an end', async () => {
    const clock = fakeClock();
    const endpoint = statusEndpoint(clock, () => ({ logins: [login({ fetching: true })] }), 50);
    const run = follow(clock, endpoint.read);
    await clock.advance(3_000);
    run.handle.cancel();
    const started = endpoint.stats.started;
    await clock.advance(REFRESH_WAIT_MS);
    expect(run.ends).toEqual([]);
    expect(endpoint.stats.started).toBe(started);
  });

  test('disabled logins are not waited for; with none to wait for the refresh is done at once', async () => {
    const clock = fakeClock();
    const endpoint = statusEndpoint(
      clock,
      () => ({ logins: [login({ disabled: true, fetched_at: null })] }),
      20
    );
    const run = follow(clock, endpoint.read);
    await clock.advance(1_000);
    expect(run.ends).toEqual([{ kind: 'done', done: 0, total: 0, at: 20 }]);
  });
});

import { useSyncExternalStore } from 'react';
import { createSharedClock } from '@/utils/time/sharedClock';

/** Countdowns tick every second; lists, summaries and "ago" every 15 seconds. One timer each, for all users. */
const secondClock = createSharedClock({ intervalMs: 1_000 });
const pageClock = createSharedClock({ intervalMs: 15_000 });

export const useSecondClock = (): number =>
  useSyncExternalStore(secondClock.subscribe, secondClock.getSnapshot, secondClock.getSnapshot);

export const usePageClock = (): number =>
  useSyncExternalStore(pageClock.subscribe, pageClock.getSnapshot, pageClock.getSnapshot);

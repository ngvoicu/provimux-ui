/**
 * "Back to the first account" on the Routing page: `routing.session-affinity-return.cold-after`, as
 * `GET /v8/management/provimux/session-return` reports it (the gateway's design/session-route.md, section 15). The
 * console keeps no copy of the gateway's rules: whether the rule runs, and why not, are the state path's `in_effect`
 * and `reason`; the configuration file is read only for its tag. A 404 is a gateway without the rule: nothing is shown.
 */
import { isRecord } from '@/utils/helpers';
import type { ConfigLoad } from '../pages/restarts/restartsLogic';

export const RETURN_REASONS = [
  'home-mode',
  'plugin-scheduler',
  'session-affinity-off',
  'not-set',
  'rebind-never',
  'not-below-ttl',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const isKnownReturnReason = (reason: string | null): reason is ReturnReason =>
  reason !== null && (RETURN_REASONS as readonly string[]).includes(reason);

export interface ReturnState {
  /** The operator's time in seconds, with its fraction where it has one; null when not set. */
  coldAfterS: number | null;
  /** Whether the rule runs now: the value in use. */
  inEffect: boolean;
  /** Why not, when not in effect (the first that applies, in the gateway's order). */
  reason: string | null;
  /** How long session affinity keeps an unused conversation on its account; null with session affinity off. */
  ttlS: number | null;
  /** Bindings dropped since the gateway started: one conversation can count more than once. */
  returned: number;
  lastReturnedAt: string | null;
  /** When the counting started: the gateway's start. */
  since: string | null;
}

export type ReturnLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; state: ReturnState }
  /** 404: a gateway without the rule. */
  | { kind: 'absent' }
  | { kind: 'error'; message: string };

/** What the card reads, together: the state, and the configuration for the tag a write is conditional on. */
export interface ReturnSnapshot {
  config: ConfigLoad;
  state: ReturnLoad;
  loadedAt: number;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;
const seconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

/** The state as the gateway sends it; null when the answer is not that object. */
export function normalizeReturn(raw: unknown): ReturnState | null {
  if (!isRecord(raw) || typeof raw.in_effect !== 'boolean' || !isRecord(raw.setting)) return null;
  const counts = isRecord(raw.counts) ? raw.counts : {};
  const returned = counts.returned;
  return {
    coldAfterS: seconds(raw.setting.cold_after_s),
    inEffect: raw.in_effect,
    reason: raw.in_effect ? null : text(raw.reason),
    ttlS: seconds(raw.ttl_s),
    returned:
      typeof returned === 'number' && Number.isFinite(returned) && returned > 0
        ? Math.floor(returned)
        : 0,
    lastReturnedAt: text(counts.last_returned_at),
    since: text(counts.since),
  };
}

/** The gateway still says what the controls were drawn from (it is read again before every write). */
export const sameReturn = (a: ReturnState, b: ReturnState): boolean =>
  a.coldAfterS === b.coldAfterS && a.inEffect === b.inEffect && a.reason === b.reason;

/** In effect; no time set; or a time set that does not run (the gateway's reason says why). */
export type ReturnMode = 'on' | 'off' | 'blocked';

export const returnMode = (state: ReturnState): ReturnMode =>
  state.inEffect ? 'on' : state.coldAfterS === null ? 'off' : 'blocked';

/** A time in whole hours, minutes and seconds; the seconds keep the fraction the operator wrote (`1m0.9s`). */
export function timeParts(totalSeconds: number): { h: number; m: number; s: number } {
  const whole = Math.floor(totalSeconds);
  const fraction = Math.round((totalSeconds - whole) * 1000) / 1000;
  return {
    h: Math.floor(whole / 3600),
    m: Math.floor((whole % 3600) / 60),
    s: Math.round(((whole % 60) + fraction) * 1000) / 1000,
  };
}

/** The field is in whole minutes: digits only. Whether a number is long enough is the gateway's to say. */
export const DRAFT = /^\d{1,5}$/;

export const draftMinutes = (draft: string): number | null =>
  DRAFT.test(draft.trim()) ? Number(draft.trim()) : null;

/** What the field starts from: the time in use where it is whole minutes, else empty (the line above says it). */
export const fieldValue = (state: ReturnState): string =>
  state.coldAfterS !== null && state.coldAfterS % 60 === 0 ? String(state.coldAfterS / 60) : '';

/** Minutes as the configuration file gets them: "6m", "1h", "1h5m". */
export function durationValue(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

/**
 * The two common lifetimes of a provider's prompt cache, each with a margin: what the field offers. A suggestion
 * only: the gateway knows no cache's lifetime, so the operator chooses.
 */
export const PRESETS = [
  { cache: 'five_minutes', minutes: 6 },
  { cache: 'one_hour', minutes: 65 },
] as const;

/**
 * A time the gateway would accept and not run: not shorter than session affinity's lifetime as the gateway reports
 * it. Said beside the field before a save; after one, the gateway's own reason is shown.
 */
export const reachesTtl = (minutes: number | null, state: ReturnState): boolean =>
  minutes !== null && state.ttlS !== null && minutes * 60 >= state.ttlS;

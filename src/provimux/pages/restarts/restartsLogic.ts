/**
 * What a restart does, read from the gateway (Restarts page). Two settings:
 *
 * - `server.restart-drain-seconds` (Provimux's README, "Restarts and upgrades"): on a stop the HTTP answers in
 *   flight get up to that many seconds to finish. A whole number from 0 to 30; 0 turns the wait off; a number out of
 *   range is used as its bound. Not set: 25, or `server.shutdown-timeout` when that is larger. The whole stop is
 *   bounded at 30 seconds by upstream, so no wait is longer. No endpoint says whether a gateway has the key: the
 *   generic config path writes any key, and an older gateway would keep it and ignore it. The version decides.
 * - `routing.session-affinity-persist` (README, "Conversations keep their account across a restart"): on whenever
 *   session affinity is on, unless set to false. `GET /v8/management/provimux/session-affinity-persist` says what is
 *   in use; the config path answers 404 when the file does not set it, which never means off.
 */
import { isRecord } from '@/utils/helpers';

export const DRAIN_KEY = 'restart-drain-seconds';
export const DRAIN_DEFAULT = 25;
export const DRAIN_MAX = 30;
/** Upstream's stop gives up after 30 seconds, whatever the wait. */
export const STOP_LIMIT = 30;
/** A Provimux release, as `X-CPA-Version` names it: the CLIProxyAPI base and the Provimux build on it. */
export interface Release {
  base: readonly [number, number, number];
  pmx: number;
  label: string;
}

/**
 * The first Provimux release with `server.restart-drain-seconds` (commits 1938cfb7e, 1b2c6ba7f and ec5d3a033 of the
 * gateway). Any release on a later CLIProxyAPI base has it too: Provimux's layer moves onto each base.
 */
export const DRAIN_SINCE: Release = { base: [8, 1, 7], pmx: 3, label: '8.1.7-pmx.3' };

/**
 * The first Provimux release with `routing.session-affinity-persist`: null until one is published. The page reads the
 * state path on every gateway; this only names the release on an older one that answers 404 there.
 */
export const PERSIST_SINCE: Release | null = null;

/** Whether the connected gateway has a setting, by its version (`X-CPA-Version`). */
export type DrainSupport =
  | { kind: 'yes' }
  /** A Provimux release before the first one with the setting. */
  | { kind: 'older'; version: string }
  /** CLIProxyAPI, or another build that is not Provimux. */
  | { kind: 'other'; version: string }
  /** A version that does not say ("dev", a build between two releases). */
  | { kind: 'unknown'; version: string };

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-pmx\.(\d+)(-\d+-g[0-9a-f]+)?)?(?:-dirty)?$/i;

const compare = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/**
 * Whether a gateway of this version has what came with `since`: that release or a later one does (a later base
 * included); an earlier release does not; a build some commits after an earlier release may, so it does not say.
 */
export function supportSince(rawVersion: string | null | undefined, since: Release): DrainSupport {
  const version = (rawVersion ?? '').trim();
  const match = VERSION.exec(version);
  if (!match) return { kind: 'unknown', version: version || '?' };
  if (match[4] === undefined) return { kind: 'other', version };
  const release = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  if (compare(release, [...since.base, since.pmx]) >= 0) return { kind: 'yes' };
  // Commits after the tag: a build between two releases.
  return match[5] !== undefined ? { kind: 'unknown', version } : { kind: 'older', version };
}

/** A version kept on one line: no break after its hyphens (a word joiner follows each). */
export const unbroken = (version: string) => version.replace(/-/g, '-\u2060');

export const drainSupport = (version: string | null | undefined): DrainSupport =>
  supportSince(version, DRAIN_SINCE);

/** Why a gateway answers 404 at the persist state path, as the page says it. */
export type PersistAbsence =
  | { kind: 'not-provimux'; version: string }
  /** A Provimux before PERSIST_SINCE (only once that release is known). */
  | { kind: 'older'; version: string; since: string }
  /** A Provimux without it, the release that brings it not known yet (or a version that does not say). */
  | { kind: 'not-yet' };

export function persistAbsence(
  version: string | null | undefined,
  since: Release | null = PERSIST_SINCE
): PersistAbsence {
  // Without a known release, only "not Provimux" can be told apart (any release serves for that).
  const support = supportSince(version, since ?? DRAIN_SINCE);
  if (support.kind === 'other') return { kind: 'not-provimux', version: support.version };
  if (since && support.kind === 'older') {
    return { kind: 'older', version: support.version, since: since.label };
  }
  return { kind: 'not-yet' };
}

const recordAt = (document: unknown, key: string): Record<string, unknown> | null => {
  if (!isRecord(document)) return null;
  const value = document[key];
  return isRecord(value) ? value : null;
};

const wholeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

export interface DrainReading {
  /** The file sets the key. */
  set: boolean;
  /** The value written, as the file has it (null: not set). */
  written: unknown;
  /** The file's value is not a whole number: the gateway refuses such a file, so it cannot be in use. */
  unreadable: boolean;
  /** The written number lies outside 0..30 and is used as its bound. */
  clamped: boolean;
  /** `server.shutdown-timeout` as a whole number (0 when not set or not a number). */
  shutdownTimeout: number;
  /** The seconds a stop waits now on a gateway with the setting. */
  inUse: number;
  /** The seconds a stop waits with the key removed (25, or shutdown-timeout when that is larger, at most 30). */
  byDefault: number;
}

/** The drain as the configuration document (`GET /config`) has it. */
export function readDrain(document: unknown): DrainReading {
  const server = recordAt(document, 'server');
  const set = server !== null && server[DRAIN_KEY] !== undefined && server[DRAIN_KEY] !== null;
  const written = set ? server![DRAIN_KEY] : null;
  const shutdownTimeout = Math.max(0, wholeNumber(server?.['shutdown-timeout']) ?? 0);
  const byDefault = Math.min(STOP_LIMIT, Math.max(DRAIN_DEFAULT, shutdownTimeout));
  const number = wholeNumber(written);
  const unreadable = set && number === null;
  const used = number === null ? null : Math.min(DRAIN_MAX, Math.max(0, number));
  return {
    set,
    written,
    unreadable,
    clamped: number !== null && used !== number,
    shutdownTimeout,
    inUse: used ?? byDefault,
    byDefault,
  };
}

/** The wait of a gateway without the setting: upstream's own `server.shutdown-timeout` (0 closes at once). */
export const upstreamWait = (reading: Pick<DrainReading, 'shutdownTimeout'>): number =>
  Math.min(STOP_LIMIT, reading.shutdownTimeout);

/** A number the slider and the save accept: a whole number of seconds from 0 to 30. */
export const clampSeconds = (value: number): number =>
  Number.isFinite(value) ? Math.min(DRAIN_MAX, Math.max(0, Math.round(value))) : DRAIN_DEFAULT;

/** `routing.session-affinity` as the file has it (off when not set). */
export const sessionAffinityOn = (document: unknown): boolean =>
  recordAt(document, 'routing')?.['session-affinity'] === true;

export const PERSIST_REASONS = [
  'session-affinity-off',
  'home-mode',
  'kv-store-off',
  'switch-off',
  'foreign-file',
  'key-not-private',
  'directory-not-writable',
  'path-unusable',
  'in-use',
] as const;
export type PersistReason = (typeof PERSIST_REASONS)[number];

export interface PersistRestored {
  sessions: number;
  expired: number;
  unknownAccounts: number;
  otherBuild: number;
}

/** `GET /v8/management/provimux/session-affinity-persist`, normalized. */
export interface PersistState {
  /** The value in use (on when the file does not set it). */
  setting: boolean;
  /** The file sets it. */
  set: boolean;
  inEffect: boolean;
  /** Why not in effect: a known reason, another string the gateway sent, or null. */
  reason: string | null;
  detail: string | null;
  snapshot: string | null;
  key: string | null;
  keyNote: string | null;
  lastWrittenAt: string | null;
  lastBindings: number;
  leftOut: number;
  lastError: string | null;
  restored: PersistRestored | null;
  startNote: string | null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** The state as the gateway sends it; null when it is not the expected object. */
export function normalizePersist(raw: unknown): PersistState | null {
  if (!isRecord(raw) || typeof raw.setting !== 'boolean' || typeof raw.in_effect !== 'boolean') {
    return null;
  }
  const restored = isRecord(raw.restored_at_start) ? raw.restored_at_start : null;
  return {
    setting: raw.setting,
    set: raw.set === true,
    inEffect: raw.in_effect,
    reason: raw.in_effect ? null : (text(raw.reason) ?? null),
    detail: text(raw.detail),
    snapshot: text(raw.snapshot),
    key: text(raw.key),
    keyNote: text(raw.key_note),
    lastWrittenAt: text(raw.last_written_at),
    lastBindings: count(raw.last_bindings),
    leftOut: count(raw.left_out_account_unverified),
    lastError: text(raw.last_error),
    restored: restored
      ? {
          sessions: count(restored.sessions),
          expired: count(restored.expired),
          unknownAccounts: count(restored.unknown_accounts),
          otherBuild: count(restored.other_build),
        }
      : null,
    startNote: text(raw.start_note),
  };
}

export const isKnownReason = (reason: string | null): reason is PersistReason =>
  reason !== null && (PERSIST_REASONS as readonly string[]).includes(reason);

/** What the last start did, in one of five words. */
export type StartOutcome =
  | { kind: 'restored'; restored: PersistRestored }
  /** Nothing had been kept: the normal first start after an upgrade, or after turning it on. */
  | { kind: 'no-snapshot' }
  /** Not in effect at the start, so nothing was read. */
  | { kind: 'not-in-effect' }
  /** The file was there but could not be read back. */
  | { kind: 'failed'; message: string }
  | { kind: 'unknown' };

export function startOutcome(state: PersistState): StartOutcome {
  const note = state.startNote;
  if (note === 'no snapshot') return { kind: 'no-snapshot' };
  if (note !== null && note.startsWith('nothing restored')) return { kind: 'not-in-effect' };
  if (note !== null) return { kind: 'failed', message: note };
  if (state.restored) return { kind: 'restored', restored: state.restored };
  return { kind: 'unknown' };
}

/** What the next restart does to the conversations, for the page's summary. */
export type ConversationsAfter =
  | 'back'
  | 'afresh'
  /** Session affinity is off: no conversation is tied to an account, before or after. */
  | 'no-affinity'
  | 'not-kept'
  | 'unknown';

export function conversationsAfter(persist: PersistLoad, affinityOn: boolean): ConversationsAfter {
  if (persist.kind === 'absent') return affinityOn ? 'not-kept' : 'no-affinity';
  if (persist.kind !== 'ready') return 'unknown';
  const { state } = persist;
  if (state.inEffect) return 'back';
  if (state.reason === 'session-affinity-off') return 'no-affinity';
  return 'afresh';
}

export type PersistLoad =
  | { kind: 'ready'; state: PersistState }
  /** 404: a gateway without the setting (an older Provimux, CLIProxyAPI). */
  | { kind: 'absent' }
  | { kind: 'error'; message: string };

/** The wait the next stop gives the answers in flight; null when the page cannot tell. */
export function nextWait(support: DrainSupport, reading: DrainReading | null): number | null {
  if (!reading) return null;
  if (support.kind === 'yes') return reading.unreadable ? null : reading.inUse;
  if (support.kind === 'unknown') return null;
  return upstreamWait(reading);
}

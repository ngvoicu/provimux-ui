/**
 * What a restart does, as the gateway reports it (Restarts page). The page keeps no copy of the gateway's rules: each
 * card shows what its state path says, and is a control only where that path exists.
 *
 * - `GET /v8/management/provimux/restart-drain` (the gateway's design/restart-drain-state.md): the wait a stop now
 *   uses (`seconds`, `waits_at_most`), what the configuration file writes and whether the gateway accepts it, the
 *   default and the bounds. The setting is written at `/v8/management/config/server/restart-drain-seconds`.
 * - `GET /v8/management/provimux/session-affinity-persist` (design/session-affinity-persist.md): whether conversations'
 *   accounts are kept across a restart, and if not why. The switch is written at
 *   `/v8/management/config/routing/session-affinity-persist`, whose read answers 404 when unset: never "off".
 */
import { isRecord } from '@/utils/helpers';

/** A Provimux release as `X-CPA-Version` names it: the CLIProxyAPI base and the Provimux build on it. */
export interface Release {
  base: readonly [number, number, number];
  pmx: number;
  label: string;
}

/**
 * The first Provimux release with both state paths (the console shows and changes the two settings from it). Null
 * until it is published: the page then says "a newer Provimux".
 */
export const STATE_SINCE: Release | null = null;

/** The first release with `server.restart-drain-seconds` in its configuration (without the state path). */
export const DRAIN_IN_FILE_SINCE: Release = { base: [8, 1, 7], pmx: 3, label: '8.1.7-pmx.3' };

export type Support =
  | { kind: 'yes' }
  | { kind: 'older'; version: string }
  /** A version without Provimux's suffix (CLIProxyAPI, or a Provimux built with its base version only). */
  | { kind: 'bare'; version: string }
  /** A version that does not say ("dev", a build some commits after a release before `since`). */
  | { kind: 'unknown'; version: string };

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-pmx\.(\d+)(-\d+-g[0-9a-f]+)?)?(?:-dirty)?$/i;

const compare = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/** Whether a gateway of this version holds what came with `since` (a later release or base does). */
export function supportSince(rawVersion: string | null | undefined, since: Release): Support {
  const version = (rawVersion ?? '').trim();
  const match = VERSION.exec(version);
  if (!match) return { kind: 'unknown', version: version || '?' };
  if (match[4] === undefined) return { kind: 'bare', version };
  const release = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  if (compare(release, [...since.base, since.pmx]) >= 0) return { kind: 'yes' };
  return match[5] !== undefined ? { kind: 'unknown', version } : { kind: 'older', version };
}

/** A version kept on one line: no break after its hyphens (a word joiner follows each). */
export const unbroken = (version: string) => version.replace(/-/g, '-⁠');

/**
 * Whether the gateway is Provimux: a state path or another Provimux endpoint answered, or its version carries
 * Provimux's suffix. "not-provimux" only when its version is bare and every Provimux endpoint answered 404; a bare
 * version with a Provimux endpoint answering is Provimux built with its base version only.
 */
export type GatewayKind = 'provimux' | 'not-provimux' | 'unknown';

export function gatewayKind(
  version: string | null | undefined,
  presence: 'ready' | 'unsupported' | 'unknown',
  pathAnswered: boolean
): GatewayKind {
  if (pathAnswered || presence === 'ready') return 'provimux';
  const support = supportSince(version, DRAIN_IN_FILE_SINCE);
  if (support.kind === 'yes' || support.kind === 'older') return 'provimux';
  if (support.kind === 'bare' && presence === 'unsupported') return 'not-provimux';
  return 'unknown';
}

// --- the configuration file (only its tag, and routing.session-affinity for the summary) -------------------------

export type ConfigLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; document: unknown; etag: string | null }
  | { kind: 'error'; message: string };

/** `routing.session-affinity` as the file has it: true, false (also when not set), or null when not read. */
export function sessionAffinityOn(config: ConfigLoad): boolean | null {
  if (config.kind !== 'ready') return null;
  const routing = isRecord(config.document) ? config.document.routing : null;
  return isRecord(routing) && routing['session-affinity'] === true;
}

// --- the drain -------------------------------------------------------------------------------------------------

export interface DrainState {
  /** The budget a stop now has, from the configuration the running process holds. */
  seconds: number;
  /** `seconds` within the stop's own bound: the most a stop waits. */
  waitsAtMost: number;
  set: boolean;
  /** The file's value as written (YAML: a quoted value keeps its quotes). */
  written: string | null;
  /** Null when not set. */
  writtenAccepted: boolean | null;
  writtenSeconds: number | null;
  writtenClamped: boolean;
  writtenError: string | null;
  default: number;
  shutdownTimeout: number;
  min: number;
  max: number;
  stopLimit: number;
  /** The gateway could not read its configuration file: `set` and `written` are unknown. */
  fileError: string | null;
}

export type DrainLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; state: DrainState }
  /** 404: a gateway without the path. */
  | { kind: 'absent' }
  | { kind: 'error'; message: string };

const int = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** The drain state as the gateway sends it; null when the answer is not that object. */
export function normalizeDrain(raw: unknown): DrainState | null {
  if (!isRecord(raw)) return null;
  const seconds = int(raw.seconds);
  const waitsAtMost = int(raw.waits_at_most);
  const min = int(raw.min);
  const max = int(raw.max);
  const fallback = int(raw.default);
  if (
    seconds === null ||
    waitsAtMost === null ||
    min === null ||
    max === null ||
    fallback === null
  ) {
    return null;
  }
  const set = raw.set === true;
  return {
    seconds,
    waitsAtMost,
    set,
    written: set && typeof raw.written === 'string' ? raw.written : null,
    writtenAccepted: set && typeof raw.written_accepted === 'boolean' ? raw.written_accepted : null,
    writtenSeconds: int(raw.written_seconds),
    writtenClamped: raw.written_clamped === true,
    writtenError: text(raw.written_error),
    default: fallback,
    shutdownTimeout: int(raw.shutdown_timeout) ?? 0,
    min,
    max,
    stopLimit: int(raw.stop_limit) ?? waitsAtMost,
    fileError: text(raw.file_error),
  };
}

/** The gateway still says what a control was drawn from (it is read again before every write). */
export function sameDrain(a: DrainState, b: DrainState): boolean {
  return (
    a.seconds === b.seconds &&
    a.set === b.set &&
    a.written === b.written &&
    a.writtenAccepted === b.writtenAccepted &&
    a.default === b.default &&
    a.min === b.min &&
    a.max === b.max &&
    a.fileError === b.fileError
  );
}

/** The running process uses what the file says (else it still runs on an earlier value, or the default). */
export const drainFileInUse = (state: DrainState): boolean =>
  !state.set ? state.seconds === state.default : state.writtenSeconds === state.seconds;

// --- conversations' accounts ------------------------------------------------------------------------------------

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

export const isKnownReason = (reason: string | null): reason is PersistReason =>
  reason !== null && (PERSIST_REASONS as readonly string[]).includes(reason);

export interface PersistRestored {
  sessions: number;
  expired: number;
  unknownAccounts: number;
  otherBuild: number;
}

export interface PersistState {
  /** The value in use (on when the file does not set it). */
  setting: boolean;
  set: boolean;
  inEffect: boolean;
  reason: string | null;
  detail: string | null;
  snapshot: string | null;
  key: string | null;
  keyNote: string | null;
  lastWrittenAt: string | null;
  lastBindings: number;
  /** Left out by the last write: the account was not seen to stay the same. */
  leftOut: number;
  /** Left out by the last write: the account has no identity Provimux recognises after a restart. */
  leftOutNoIdentity: number;
  lastError: string | null;
  restored: PersistRestored | null;
  startNote: string | null;
}

export type PersistLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; state: PersistState }
  | { kind: 'absent' }
  | { kind: 'error'; message: string };

export function normalizePersist(raw: unknown): PersistState | null {
  if (!isRecord(raw) || typeof raw.setting !== 'boolean' || typeof raw.in_effect !== 'boolean') {
    return null;
  }
  const restored = isRecord(raw.restored_at_start) ? raw.restored_at_start : null;
  return {
    setting: raw.setting,
    set: raw.set === true,
    inEffect: raw.in_effect,
    reason: raw.in_effect ? null : text(raw.reason),
    detail: text(raw.detail),
    snapshot: text(raw.snapshot),
    key: text(raw.key),
    keyNote: text(raw.key_note),
    lastWrittenAt: text(raw.last_written_at),
    lastBindings: count(raw.last_bindings),
    leftOut: count(raw.left_out_account_unverified),
    leftOutNoIdentity: count(raw.left_out_no_account_identity),
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

export const samePersist = (a: PersistState, b: PersistState): boolean =>
  a.setting === b.setting && a.set === b.set;

/** What the last start did. */
export type StartOutcome =
  | { kind: 'restored'; restored: PersistRestored }
  /** Nothing saved was found: the normal state before the first successful save. */
  | { kind: 'no-snapshot' }
  /** Not in effect at that start, so nothing was read. */
  | { kind: 'not-in-effect' }
  /** A snapshot was there and could not be restored, or the disk did not answer. */
  | { kind: 'failed'; message: string }
  | { kind: 'unknown' };

const NOTHING_RESTORED = 'nothing restored: ';

export function startOutcome(state: PersistState): StartOutcome {
  const note = state.startNote;
  if (note === 'no snapshot') return { kind: 'no-snapshot' };
  if (note !== null && note.startsWith(NOTHING_RESTORED)) {
    const why = note.slice(NOTHING_RESTORED.length);
    return isKnownReason(why) ? { kind: 'not-in-effect' } : { kind: 'failed', message: why };
  }
  if (note !== null) return { kind: 'failed', message: note };
  if (state.restored) return { kind: 'restored', restored: state.restored };
  return { kind: 'unknown' };
}

const NOT_REMOVED = 'files of an earlier run not removed: ';

/** The state's `last_error`: a snapshot that could not be saved, or earlier files that could not be removed. */
export function lastError(
  state: PersistState
): { kind: 'not-removed' | 'write'; message: string } | null {
  if (!state.lastError) return null;
  return state.lastError.startsWith(NOT_REMOVED)
    ? { kind: 'not-removed', message: state.lastError.slice(NOT_REMOVED.length) }
    : { kind: 'write', message: state.lastError };
}

// --- the next restart, from what the page could read ------------------------------------------------------------

export type Tone = 'neutral' | 'ok' | 'cut' | 'unknown';

export type AnswersStep =
  | { kind: 'wait'; seconds: number }
  | { kind: 'cut' }
  /** The gateway does not report its wait (no state path). */
  | { kind: 'unreported' }
  | { kind: 'unread' };

export function answersStep(drain: DrainLoad): AnswersStep {
  if (drain.kind === 'ready') {
    return drain.state.waitsAtMost > 0
      ? { kind: 'wait', seconds: drain.state.waitsAtMost }
      : { kind: 'cut' };
  }
  if (drain.kind === 'absent') return { kind: 'unreported' };
  return { kind: 'unread' };
}

export type ConversationsStep =
  | 'kept'
  /** Another Provimux holds the store's file: this one saves none, and restores what it can authenticate. */
  | 'in-use'
  /** Session affinity is off, as the gateway or the file says: nothing is tied to an account. */
  | 'no-affinity'
  /** Not kept: routing picks an account again. */
  | 'not-kept'
  /** The gateway does not report it (no state path), and session affinity is on in the file. */
  | 'unreported'
  | 'unread';

export function conversationsStep(persist: PersistLoad, config: ConfigLoad): ConversationsStep {
  if (persist.kind === 'ready') {
    const { state } = persist;
    if (state.inEffect) return 'kept';
    if (state.reason === 'in-use') return 'in-use';
    if (state.reason === 'session-affinity-off') return 'no-affinity';
    return 'not-kept';
  }
  if (persist.kind === 'absent') {
    const affinity = sessionAffinityOn(config);
    if (affinity === false) return 'no-affinity';
    if (affinity === true) return 'unreported';
  }
  return 'unread';
}

/** A step is green only on the gateway's word that nothing is lost; what the page cannot tell is never green. */
export const STEP_TONES: Record<AnswersStep['kind'] | ConversationsStep, Tone> = {
  wait: 'ok',
  cut: 'cut',
  unreported: 'unknown',
  unread: 'unknown',
  kept: 'ok',
  'in-use': 'unknown',
  'no-affinity': 'neutral',
  'not-kept': 'cut',
};

/**
 * Whether an account works now (design accounts-page.md, section 3), in one word the owner reads: working,
 * signed out, off, cooling down, or a problem. A login's comes from its entry in `GET /credentials` (the
 * proxy's own status, sign-in renewal and cooldown fields); an API key's from the configuration (on or off)
 * and the cooldowns Provimux recorded on its routes (`GET /provimux/model-routes`), the only live record the
 * proxy keeps for a key. Pure.
 */
import { summarizeCooldowns } from '@/features/authFiles/cooldowns';
import { getAuthFileStatusMessage, hasAuthFileStatusWarning } from '@/features/authFiles/constants';
import type { AuthFileItem } from '@/types';
import type { ProvimuxModelRoutesResponse, ProvimuxRecordedCooldown } from '../../api/types';
import { timeMs } from '../time';

export type AccountState = 'working' | 'signed-out' | 'off' | 'cooling' | 'problem';

export interface StateReading {
  state: AccountState;
  /** Cooling down: when Provimux tries it again (ms, the browser's clock for a login, the server's for a key). */
  until: number | null;
  /** Working: how many of its models are cooling down on their own. */
  modelsCooling: number;
  /** Problem or signed out: the proxy's reason, as it words it (never a token). */
  message: string | null;
  /** An API key the service refused (unauthorized, payment required): replacing it is the fix. */
  rejected: boolean;
  /** The reason code of the cooldown, when it is one. */
  reason: string | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Renewal states and recovery stages that mean the login must be signed in again (sdk auth types). */
const SIGN_IN_STATES = new Set(['sign_in_required', 'expired_sign_in_required']);
/** Cooldown reasons that mean the account itself was refused, not that it is busy. */
const REFUSED = new Set(['unauthorized', 'payment_required', 'invalid_grant']);

const reading = (state: AccountState, extra: Partial<StateReading> = {}): StateReading => ({
  state,
  until: null,
  modelsCooling: 0,
  message: null,
  rejected: false,
  reason: null,
  ...extra,
});

/**
 * A login file's state at `nowMs` (the browser's clock: a login's cooldowns count down from when the list
 * was received, as Auth Files counts them).
 */
export function loginState(file: AuthFileItem, nowMs: number): StateReading {
  const status = text(file.status).toLowerCase();
  if (file.disabled === true || status === 'disabled') return reading('off');

  const message = getAuthFileStatusMessage(file) || null;
  const signIn =
    file.requires_sign_in === true ||
    SIGN_IN_STATES.has(text(file.renewal_state)) ||
    text(file.recovery_stage) === 'sign_in_required' ||
    text(file.next_action) === 'sign_in';
  if (signIn) return reading('signed-out', { message });

  const snapshot = file.cooldownSnapshot;
  const summary = snapshot ? summarizeCooldowns(snapshot, nowMs) : null;
  const credentialRow = summary?.rows
    .filter((row) => row.record.scope === 'credential' && row.remainingSeconds > 0)
    .sort((a, b) => b.remainingSeconds - a.remainingSeconds)[0];
  if (credentialRow) {
    const reason = credentialRow.record.reason;
    if (reason === 'invalid_grant') return reading('signed-out', { message, reason });
    return reading('cooling', {
      until: nowMs + credentialRow.remainingSeconds * 1000,
      message,
      reason,
    });
  }
  // A server without cooldown snapshots: the next retry it reports, while the login is held.
  const retry = timeMs(text(file.next_retry_after) || null);
  if ((file.unavailable === true || file.quota_blocked === true) && retry !== null && retry > nowMs) {
    return reading('cooling', { until: retry, message });
  }
  if (status === 'error' || file.unavailable === true || hasAuthFileStatusWarning(file)) {
    return reading('problem', { message });
  }
  return reading('working', { modelsCooling: summary?.modelCount ?? 0 });
}

/** The cooldowns recorded on a key's routes, by its auth indexes; each model once, the latest kept. */
export function keyCooldowns(
  routes: ProvimuxModelRoutesResponse | null,
  authIndexes: readonly string[]
): ProvimuxRecordedCooldown[] {
  if (!routes || authIndexes.length === 0) return [];
  const wanted = new Set(authIndexes);
  const found = new Map<string, ProvimuxRecordedCooldown>();
  for (const model of routes.models) {
    for (const route of model.routes) {
      const cooldown = route.recorded_cooldown;
      if (!cooldown || !route.auth_index || !wanted.has(route.auth_index)) continue;
      const key = cooldown.scope === 'credential' ? 'credential' : `model:${cooldown.model ?? model.id}`;
      const before = found.get(key);
      if (!before || (timeMs(cooldown.until) ?? 0) > (timeMs(before.until) ?? 0)) {
        found.set(key, cooldown);
      }
    }
  }
  return [...found.values()];
}

/**
 * An API key's state at the server's `nowMs`: off when the configuration turns it off; refused or cooling
 * down when Provimux recorded a cooldown on the whole key; else working (with its models cooling down on
 * their own counted). Without the routes (a proxy that has no such endpoint), on or off only.
 */
export function keyState(
  disabled: boolean,
  cooldowns: readonly ProvimuxRecordedCooldown[],
  nowMs: number
): StateReading {
  if (disabled) return reading('off');
  const active = cooldowns.filter((cooldown) => (timeMs(cooldown.until) ?? 0) > nowMs);
  const whole = active
    .filter((cooldown) => cooldown.scope === 'credential')
    .sort((a, b) => (timeMs(b.until) ?? 0) - (timeMs(a.until) ?? 0))[0];
  if (whole) {
    const until = timeMs(whole.until);
    if (REFUSED.has(whole.reason)) {
      return reading('problem', { rejected: true, until, reason: whole.reason });
    }
    return reading('cooling', { until, reason: whole.reason });
  }
  const refusedModel = active.find((cooldown) => REFUSED.has(cooldown.reason));
  if (refusedModel) {
    return reading('problem', {
      rejected: true,
      until: timeMs(refusedModel.until),
      reason: refusedModel.reason,
    });
  }
  return reading('working', { modelsCooling: active.length });
}

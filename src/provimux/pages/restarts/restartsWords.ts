/**
 * The Restarts page's words that depend on what the gateway reports: the line under a card after a change, the
 * reasons, and what a card says for a gateway without its state path. Kept apart from the components.
 */
import type { TFunction } from 'i18next';
import { STATE_SINCE, isKnownReason, unbroken, type GatewayKind } from './restartsLogic';
import type { Snapshot, WriteResult, WriteSpec } from './restartsWrite';

/** A card's line under its controls: what a change did, or why nothing was sent. */
export interface CardMessage {
  tone: 'ok' | 'error' | 'pending' | 'warning';
  text: string;
}

export type Card = 'drain' | 'persist';
export type Messages = Record<Card, CardMessage | null>;
const NO_MESSAGES: Messages = { drain: null, persist: null };

/**
 * A card's line describes the read made with it, never a later one: any read of the gateway's state (a reload, or
 * another change's reads) takes every line away.
 */
export const messagesAfterRead = (): Messages => NO_MESSAGES;

/** A change's line, from the read after it, on its own card only: the other card's line described an earlier read. */
export const messagesAfterWrite = (card: Card, message: CardMessage): Messages => ({
  ...NO_MESSAGES,
  [card]: message,
});

/** Turns a write's result, and the read after it, into the card's line. */
export type Describe = (result: WriteResult, snapshot: Snapshot) => CardMessage;

/** Starts one change; the page runs one at a time and disables every control meanwhile. */
export type OnWrite = (spec: WriteSpec, describe: Describe) => void;

/** The lines every card shares for a write that sent nothing or was refused. */
export function commonMessage(t: TFunction, result: WriteResult): CardMessage | null {
  switch (result.kind) {
    case 'stale':
      return { tone: 'warning', text: t(`provimux.restarts.stale_${result.why}`) };
    case 'no-tag':
      return { tone: 'error', text: t('provimux.restarts.err_no_tag') };
    case 'changed':
      return {
        tone: 'warning',
        text: result.reread
          ? t('provimux.restarts.err_changed_reread')
          : t('provimux.restarts.err_changed_unread'),
      };
    case 'refused':
      return {
        tone: 'error',
        text: t('provimux.restarts.err_refused', { message: result.message }),
      };
    case 'failed':
      return {
        tone: 'error',
        text: t('provimux.restarts.save_failed', { message: result.message }),
      };
    default:
      return null;
  }
}

/** For a gateway without the card's state path: where the console shows and changes the setting. */
export function sinceLine(t: TFunction): string {
  return STATE_SINCE
    ? t('provimux.restarts.absent_since', { since: unbroken(STATE_SINCE.label) })
    : t('provimux.restarts.absent_since_newer');
}

/** For a gateway without the card's state path that is not known to be Provimux, or is not. */
export function absentLine(t: TFunction, kind: GatewayKind, version: string | null): string {
  return kind === 'not-provimux'
    ? t('provimux.restarts.absent_not_provimux', { version: unbroken(version ?? '?') })
    : t('provimux.restarts.absent_unknown');
}

const reasonKey = (reason: string) => `provimux.restarts.reason_${reason.replace(/-/g, '_')}`;

/** Why the gateway does not keep them now, in words (an unknown reason is shown as the gateway sent it). */
export const reasonText = (t: TFunction, reason: string | null): string =>
  isKnownReason(reason)
    ? t(reasonKey(reason))
    : t('provimux.restarts.reason_unlisted', { reason: reason ?? '?' });

/** The card's line after a change: what was saved, then what the gateway's state, read after it, reports. */
export function describePersistWrite(
  t: TFunction,
  result: WriteResult,
  snapshot: Snapshot
): CardMessage {
  const common = commonMessage(t, result);
  if (common) return common;
  const state = snapshot.persist.kind === 'ready' ? snapshot.persist.state : null;
  const now = !state
    ? null
    : state.inEffect
      ? 'in_effect'
      : state.setting
        ? 'not_in_effect'
        : 'off';
  if (result.kind === 'unconfirmed') {
    return now
      ? { tone: 'warning', text: t(`provimux.restarts.persist_unconfirmed_${now}`) }
      : { tone: 'warning', text: t('provimux.restarts.unconfirmed_unread') };
  }
  if (result.kind === 'saved' && result.shown && now) {
    return {
      tone: now === 'not_in_effect' ? 'warning' : 'ok',
      text: t(`provimux.restarts.persist_saved_${now}`),
    };
  }
  return now
    ? { tone: 'warning', text: t('provimux.restarts.persist_saved_not_shown') }
    : { tone: 'warning', text: t('provimux.restarts.saved_unread') };
}

/** The card's line after a change, from the gateway's drain state read after it. */
export function describeDrainWrite(
  t: TFunction,
  result: WriteResult,
  snapshot: Snapshot
): CardMessage {
  const common = commonMessage(t, result);
  if (common) return common;
  const state = snapshot.drain.kind === 'ready' ? snapshot.drain.state : null;
  const waits = state?.waitsAtMost ?? 0;
  if (result.kind === 'unconfirmed') {
    if (!state) return { tone: 'warning', text: t('provimux.restarts.unconfirmed_unread') };
    return {
      tone: 'warning',
      text:
        waits > 0
          ? t('provimux.restarts.drain_unconfirmed_wait', { count: waits })
          : t('provimux.restarts.drain_unconfirmed_none'),
    };
  }
  if (result.kind === 'saved' && result.shown && state) {
    return {
      tone: 'ok',
      text:
        waits > 0
          ? t('provimux.restarts.drain_saved_wait', { count: waits })
          : t('provimux.restarts.drain_saved_none'),
    };
  }
  if (!state) return { tone: 'warning', text: t('provimux.restarts.saved_unread') };
  return {
    tone: 'warning',
    text:
      waits > 0
        ? t('provimux.restarts.drain_saved_not_shown_wait', { count: waits })
        : t('provimux.restarts.drain_saved_not_shown_none'),
  };
}

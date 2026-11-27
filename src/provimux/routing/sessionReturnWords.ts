/**
 * The words of "Back to the first account" that depend on what the gateway reports: a time, the reason the rule
 * does not run, and the line after a change. Kept apart from the component.
 */
import type { TFunction } from 'i18next';
import { commonMessage, type CardMessage } from '../pages/restarts/restartsWords';
import type { WriteResult } from '../pages/restarts/restartsWrite';
import {
  isKnownReturnReason,
  returnMode,
  timeParts,
  type ReturnSnapshot,
  type ReturnState,
} from './sessionReturnLogic';

const K = 'provimux.session_return';

/** "6 min", "1 h 5 min", "1 min 30 s": the parts that are not zero. */
export function timeText(t: TFunction, totalSeconds: number): string {
  const { h, m, s } = timeParts(totalSeconds);
  const parts = [
    h > 0 ? t(`${K}.time_h`, { n: h }) : null,
    m > 0 ? t(`${K}.time_min`, { n: m }) : null,
    s > 0 || (h === 0 && m === 0) ? t(`${K}.time_s`, { n: s }) : null,
  ].filter((part): part is string => part !== null);
  return parts.join(' ');
}

/** Where a reason is fixed, when that is another page of the console. */
export const reasonLink = (reason: string | null): '/config' | '/plugins' | null =>
  reason === 'not-below-ttl' || reason === 'rebind-never'
    ? '/config'
    : reason === 'plugin-scheduler'
      ? '/plugins'
      : null;

/** Why the rule does not run, and what changes that (an unknown reason is shown as the gateway sent it). */
export function reasonText(t: TFunction, state: ReturnState): string {
  const { reason } = state;
  if (!isKnownReturnReason(reason) || reason === 'not-set') {
    return t(`${K}.reason_unlisted`, { reason: reason ?? '?' });
  }
  if (reason === 'not-below-ttl') {
    return state.coldAfterS !== null && state.ttlS !== null
      ? t(`${K}.reason_not_below_ttl`, {
          time: timeText(t, state.coldAfterS),
          ttl: timeText(t, state.ttlS),
        })
      : t(`${K}.reason_not_below_ttl_bare`);
  }
  return t(`${K}.reason_${reason.replace(/-/g, '_')}`);
}

/** The card's line after a change: what was saved, then what the gateway's state, read after it, reports. */
export function describeReturnWrite(
  t: TFunction,
  result: WriteResult,
  snapshot: ReturnSnapshot
): CardMessage {
  const common = commonMessage(t, result);
  if (common) return common;
  const state = snapshot.state.kind === 'ready' ? snapshot.state.state : null;
  const mode = state ? returnMode(state) : null;
  const time = state && state.coldAfterS !== null ? timeText(t, state.coldAfterS) : '';
  if (result.kind === 'unconfirmed') {
    return mode
      ? { tone: 'warning', text: t(`${K}.unconfirmed_${mode}`, { time }) }
      : { tone: 'warning', text: t(`${K}.unconfirmed_unread`) };
  }
  if (result.kind === 'saved' && result.shown && mode) {
    return {
      tone: mode === 'blocked' ? 'warning' : 'ok',
      text: t(`${K}.saved_${mode}`, { time }),
    };
  }
  return mode
    ? { tone: 'warning', text: t(`${K}.saved_not_shown`) }
    : { tone: 'warning', text: t('provimux.restarts.saved_unread') };
}

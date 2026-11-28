/**
 * The words of "Back to the first account" that depend on what the gateway reports: a time, and the reason the rule
 * does not run. Kept apart from the component.
 */
import type { TFunction } from 'i18next';
import { timeParts, type ReturnState } from './sessionReturnLogic';

const K = 'provimux.session_return';

/** "6 min", "1 h 5 min", "1 min 30 s": the parts that are not zero. */
export function timeText(t: TFunction, totalSeconds: number): string {
  const { h, m, s } = timeParts(totalSeconds);
  return [
    h > 0 ? t(`${K}.time_h`, { n: h }) : null,
    m > 0 ? t(`${K}.time_min`, { n: m }) : null,
    s > 0 ? t(`${K}.time_s`, { n: s }) : null,
  ]
    .filter((part) => part !== null)
    .join(' ');
}

/** The reasons the card has words for, and the page of the console where each is changed, if it is another page. */
const REASONS: Record<string, { key: string; link?: '/config' | '/plugins' }> = {
  'session-affinity-off': { key: 'reason_session_affinity_off' },
  'not-below-ttl': { key: 'reason_not_below_ttl', link: '/config' },
  'rebind-never': { key: 'reason_rebind_never', link: '/config' },
  'home-mode': { key: 'reason_home_mode' },
  'plugin-scheduler': { key: 'reason_plugin_scheduler', link: '/plugins' },
};

export const reasonLink = (reason: string | null): '/config' | '/plugins' | null =>
  REASONS[reason ?? '']?.link ?? null;

/** Why the saved time does not run (a reason of a later gateway is shown as it was sent). */
export function reasonText(t: TFunction, state: ReturnState): string {
  const known = REASONS[state.reason ?? ''];
  if (!known) return t(`${K}.reason_unlisted`, { reason: state.reason ?? '?' });
  return t(`${K}.${known.key}`, {
    time: timeText(t, state.coldAfterS ?? 0),
    ttl: timeText(t, state.ttlS ?? 0),
  });
}

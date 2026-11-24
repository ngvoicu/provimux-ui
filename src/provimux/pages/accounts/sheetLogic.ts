/**
 * The manage panel's logic (design accounts-page.md, section 4): the priority field's value, and what a state
 * means in a sentence. Pure.
 */
import { formatClock, formatDuration } from '../time';
import type { Account } from './accounts';
import { reasonLabel } from './labels';

const PRIORITY_PATTERN = /^[+-]?\d{1,10}$/;

/** The integer the field holds, or null when it is not one the proxy can hold. */
export function parsePriority(text: string): number | null {
  const value = text.trim();
  if (!PRIORITY_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && Math.abs(parsed) <= 2_147_483_647 ? parsed : null;
}

/** What the state means for the owner, and what to do about it, in one or two sentences. */
export function statusSentence(
  t: (key: string, options?: Record<string, unknown>) => string,
  account: Account,
  language: string,
  nowMs: number
): string {
  const { reading } = account;
  switch (reading.state) {
    case 'working': {
      const base =
        account.kind === 'sub'
          ? t('provimux.accounts.sheet.status_working_sub')
          : t('provimux.accounts.sheet.status_working_key');
      return reading.modelsCooling > 0
        ? `${base} ${t('provimux.accounts.sheet.status_models_cooling', { count: reading.modelsCooling })}`
        : base;
    }
    case 'signed-out':
      return account.kind === 'sub' && account.signIn
        ? t('provimux.accounts.sheet.status_signed_out')
        : t('provimux.accounts.sheet.status_signed_out_no_flow');
    case 'off':
      return t('provimux.accounts.sheet.status_off');
    case 'cooling': {
      if (reading.until === null) return t('provimux.accounts.sheet.status_cooling_unknown');
      const values = {
        time: formatClock(reading.until, language, nowMs),
        left: formatDuration(Math.max(0, reading.until - nowMs)),
      };
      return reading.reason
        ? t('provimux.accounts.sheet.status_cooling', {
            ...values,
            reason: reasonLabel(t as never, reading.reason),
          })
        : t('provimux.accounts.sheet.status_cooling_plain', values);
    }
    case 'problem':
      if (reading.rejected) {
        return t('provimux.accounts.sheet.status_refused', {
          reason: reasonLabel(t as never, reading.reason ?? 'unknown'),
        });
      }
      return reading.message
        ? t('provimux.accounts.sheet.status_problem', { message: reading.message })
        : t('provimux.accounts.sheet.status_problem_plain');
  }
}

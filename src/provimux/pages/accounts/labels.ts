/**
 * The words the page shows for a service, a state and an account (design accounts-page.md, section 6). The
 * owner does not know the proxy's internals: a service is the company's name, a state one word, a key its
 * address and its masked tail.
 */
import type { TFunction } from 'i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import { formatClock, formatDuration } from '../time';
import type { Account } from './accounts';
import { serviceById } from './services';

export function serviceLabel(t: TFunction, service: string): string {
  const known = serviceById(service);
  if (known) return known.labelKey ? t(known.labelKey) : known.label;
  if (service.startsWith('compatible:')) return service.slice('compatible:'.length);
  if (service.startsWith('login:')) return getTypeLabel(t, service.slice('login:'.length));
  return service;
}

/** Who issues a service's API keys (Anthropic for Claude); the service's own name otherwise. */
export const keyIssuerLabel = (t: TFunction, service: string): string =>
  serviceById(service)?.keyIssuer ?? serviceLabel(t, service);

/** "Claude · alex@example.com": the account in one line, for titles and messages. */
export const accountName = (t: TFunction, account: Account): string =>
  `${serviceLabel(t, account.service)} · ${account.who}`;

/** The state in one word or two. */
export function stateLabel(t: TFunction, account: Account): string {
  const { state, rejected } = account.reading;
  if (state === 'problem' && rejected) return t('provimux.accounts.state.refused');
  return t(`provimux.accounts.state.${state === 'signed-out' ? 'signed_out' : state}`);
}

/** The line under the state: when a cooldown ends, how many models cool down, what to do. */
export function stateHint(
  t: TFunction,
  account: Account,
  language: string,
  nowMs: number
): string | null {
  const { reading } = account;
  switch (reading.state) {
    case 'cooling':
      return reading.until !== null
        ? t('provimux.accounts.hint.until', {
            time: formatClock(reading.until, language, nowMs),
            left: formatDuration(Math.max(0, reading.until - nowMs)),
          })
        : null;
    case 'working':
      return reading.modelsCooling > 0
        ? t('provimux.accounts.hint.models_cooling', { count: reading.modelsCooling })
        : null;
    case 'signed-out':
      return account.kind === 'sub' && account.signIn
        ? t('provimux.accounts.hint.sign_in_again')
        : t('provimux.accounts.hint.signed_out_no_flow');
    case 'problem':
      if (reading.rejected && reading.reason) return reasonLabel(t, reading.reason);
      return reading.message;
    case 'off':
      return t('provimux.accounts.hint.off');
  }
}

/** A cooldown's reason code in words (Model routes' wording). */
export const reasonLabel = (t: TFunction, reason: string): string =>
  t(`provimux.cooldown.reason.${reason}`, {
    defaultValue: t('provimux.cooldown.reason.unknown', { code: reason }),
  });

/** What fixes the account from its row, if anything: sign in again, or replace the key. */
export type FixAction = 'sign-in' | 'replace' | null;

export function fixOf(account: Account): FixAction {
  const { state, rejected } = account.reading;
  if (account.kind === 'sub') {
    if ((state === 'signed-out' || state === 'problem') && account.signIn && !account.runtimeOnly) {
      return 'sign-in';
    }
    return null;
  }
  if (state === 'problem' && rejected && (account.entry.keyIndex !== null || account.entry.keyCount === 1)) {
    return 'replace';
  }
  return null;
}

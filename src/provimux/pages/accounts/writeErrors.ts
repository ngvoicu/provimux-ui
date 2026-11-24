import { getErrorMessage } from '@/utils/helpers';
import { AccountsWriteError } from './accountsApi';
import { KeyWriteError } from './keyWrites';

/** A write's failure, in the owner's words. */
export function writeErrorMessage(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown
): string {
  if (error instanceof AccountsWriteError) {
    if (error.reason === 'changed') return t('provimux.accounts.write_changed');
    if (error.reason === 'no-tag') return t('provimux.accounts.write_no_tag');
    if (error.reason === 'refused') {
      return t('provimux.accounts.write_refused', { message: error.message });
    }
  }
  if (error instanceof KeyWriteError) {
    if (error.code === 'several-keys') return t('provimux.accounts.several_keys');
    if (error.code === 'duplicate-name') return t('provimux.accounts.duplicate_name');
    if (error.code === 'not-found') return t('provimux.accounts.write_changed');
  }
  return t('provimux.accounts.write_failed', { message: getErrorMessage(error) });
}

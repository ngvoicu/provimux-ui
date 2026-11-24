import { getErrorMessage, isRecord } from '@/utils/helpers';
import { AccountsWriteError, ListSettingsWriteError } from './accountsApi';
import { KeyWriteError } from './keyWrites';

/** AI Providers' writes refuse a connection that changed since it was read (its own words, in English). */
const PROVIDERS_CONFLICT = /configuration changed or is ambiguous/i;
/** Errors of AI Providers' builders and writes that are i18n keys of the console. */
const CONSOLE_KEY = /^(providersPage|plugin_management|config_management|auth_files)\.[\w.]+$/;

/** True when the write was refused because what it changes moved since the read: read again. */
export function isChangedError(error: unknown): boolean {
  if (error instanceof ListSettingsWriteError) return isChangedError(error.failure);
  if (error instanceof AccountsWriteError) return error.reason === 'changed';
  if (error instanceof KeyWriteError) return error.code === 'not-found';
  if (isRecord(error) && error.status === 412) return true;
  return error instanceof Error && PROVIDERS_CONFLICT.test(error.message);
}

/** A write's failure, in the owner's words. */
export function writeErrorMessage(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown
): string {
  // The settings AI Providers writes were saved; only the list settings, written after them, were not.
  if (error instanceof ListSettingsWriteError) {
    return t('provimux.accounts.lists.not_saved', { reason: writeErrorMessage(t, error.failure) });
  }
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
  if (isChangedError(error)) return t('provimux.accounts.write_changed');
  if (error instanceof Error && CONSOLE_KEY.test(error.message)) return t(error.message);
  return t('provimux.accounts.write_failed', { message: getErrorMessage(error) });
}

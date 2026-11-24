/** A key's model list in words (design key-model-lists.md 7.2). Pure. */
import type { TFunction } from 'i18next';
import type { ProvimuxLiveListFailure } from '../../api/types';

type T = TFunction;

/** Why a refresh failed, in the owner's words: never the server's error text, which stays in its log. */
export function failureReason(t: T, failure: ProvimuxLiveListFailure, service: string): string {
  const status = failure.http_status;
  switch (failure.category) {
    case 'http_status':
      if (status === 404) return t('provimux.accounts.lists.reason_404', { service });
      if (status === 401 || status === 403) {
        return t('provimux.accounts.lists.reason_auth', { service, status });
      }
      if (status === 429) return t('provimux.accounts.lists.reason_rate', { service });
      return t('provimux.accounts.lists.reason_http', { service, status: status ?? '?' });
    case 'network':
      return t('provimux.accounts.lists.reason_network', { service });
    case 'invalid_response':
      return t('provimux.accounts.lists.reason_invalid', { service });
    case 'credentials':
      return t('provimux.accounts.lists.reason_credentials');
    default:
      return t('provimux.accounts.lists.reason_unknown');
  }
}

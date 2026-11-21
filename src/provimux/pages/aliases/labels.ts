/** How the Aliases page names providers, login types and services, with the console's own labels. */
import type { TFunction } from 'i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { ProviderFamily } from '@/services/api/providers';
import { isOpenRouterHost } from '../modelRoutes/logic';
import { brandOfFamily } from './pageLogic';
import { ALIAS_FAMILIES } from './rows';
import type { AliasEntry, KeyEntry, ServiceId } from './types';

/** "Claude", "OpenAI Compatible": the AI Providers page's names. */
export const familyLabel = (t: TFunction, family: ProviderFamily): string =>
  t(`providersPage.providerNames.${brandOfFamily(family)}`);

/** "Claude", "Antigravity": the Auth Files page's names. */
export const channelLabel = (t: TFunction, channel: string): string => getTypeLabel(t, channel);

export const providerLabelOf = (t: TFunction, entry: AliasEntry): string =>
  entry.store === 'login' ? channelLabel(t, entry.channel) : familyLabel(t, entry.family);

const isFamily = (value: string): value is ProviderFamily =>
  (ALIAS_FAMILIES as readonly string[]).includes(value);

/** A service as words: "Claude logins", "Claude API keys", "Claude · gw.example", "OpenRouter". */
export function serviceLabel(t: TFunction, service: ServiceId, entries: readonly AliasEntry[]) {
  if (service.startsWith('login:')) {
    return t('provimux.aliases.service_login', {
      name: channelLabel(t, service.slice('login:'.length)),
    });
  }
  const rest = service.slice('key:'.length);
  if (isOpenRouterHost(rest)) return 'OpenRouter';
  const entry = entries.find(
    (candidate): candidate is KeyEntry =>
      candidate.store === 'api-key' && candidate.service === service
  );
  if (entry && entry.host === null) {
    return t('provimux.aliases.service_key', { name: familyLabel(t, entry.family) });
  }
  if (entry) return `${familyLabel(t, entry.family)} · ${rest}`;
  if (isFamily(rest)) return t('provimux.aliases.service_key', { name: familyLabel(t, rest) });
  return rest;
}

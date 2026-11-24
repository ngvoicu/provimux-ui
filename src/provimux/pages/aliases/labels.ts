/** How the Aliases page names providers, login types and services, with the console's own labels. */
import type { TFunction } from 'i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { ProviderFamily } from '@/services/api/providers';
import { brandOfFamily } from './pageLogic';
import type { AliasEntry } from './types';

/** "Claude", "OpenAI Compatible": the AI Providers page's names. */
export const familyLabel = (t: TFunction, family: ProviderFamily): string =>
  t(`providersPage.providerNames.${brandOfFamily(family)}`);

/** "Claude", "Antigravity": the Auth Files page's names. */
export const channelLabel = (t: TFunction, channel: string): string => getTypeLabel(t, channel);

/** An entry as words: "Claude · team · sk-…0001", "Claude logins". */
export function entryLabelOf(t: TFunction, entry: AliasEntry): string {
  if (entry.store === 'login') {
    return t('provimux.aliases.service_login', { name: channelLabel(t, entry.channel) });
  }
  return [
    familyLabel(t, entry.family),
    entry.groupName,
    entry.keyPreview ?? t('provimux.aliases.entry_keys', { count: entry.keyCount }),
  ]
    .filter(Boolean)
    .join(' · ');
}

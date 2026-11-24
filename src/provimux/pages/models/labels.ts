/** How the Models page names providers and sources, with the console's own labels. */
import type { TFunction } from 'i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import { familyLabel } from '../aliases/labels';
import type { AliasEntry } from '../aliases/types';
import { compatibleEntryOf, isOpenRouterHost } from '../modelRoutes/logic';

/** "Claude", "OpenRouter", "lab": a provider as the routes carry it. */
export function providerName(t: TFunction, provider: string, host: string | null): string {
  if (isOpenRouterHost(host)) return 'OpenRouter';
  const entry = compatibleEntryOf(provider);
  if (entry !== null) return entry;
  return getTypeLabel(t, provider);
}

/** "Claude subscription", "Claude API key · api.example", "OpenRouter": where a model comes from. */
export function sourceName(t: TFunction, entry: AliasEntry): string {
  if (entry.store === 'login') {
    return t('provimux.models.source_login', { name: getTypeLabel(t, entry.channel) });
  }
  if (isOpenRouterHost(entry.host)) return 'OpenRouter';
  if (entry.family === 'openai-compatibility') return entry.groupName ?? entry.host ?? '?';
  const name = t('provimux.models.source_key', { name: familyLabel(t, entry.family) });
  const detail = entry.host ?? entry.keyPreview;
  return detail ? `${name} · ${detail}` : name;
}

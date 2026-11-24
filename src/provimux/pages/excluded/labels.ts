/**
 * How the excluded models name a place and an account that still serves a model, in the owner's words: the
 * service by its company name, a key by its address and masked tail, never the proxy's field names.
 */
import type { TFunction } from 'i18next';
import type { ProvimuxModelRoute } from '../../api/types';
import { serviceLabel } from '../accounts/labels';
import { providerName } from '../models/labels';
import type { KeyEntry } from '../aliases/types';
import type { Place } from './exclusions';

/** "Every Claude subscription", "Claude API key ••••a1b2". */
export function placeTitle(t: TFunction, place: Place): string {
  const service = serviceLabel(t, place.service);
  if (place.kind === 'logins') return t('provimux.excluded.place_logins', { service });
  return t('provimux.excluded.place_key', { service, key: place.entry.keyPreview ?? '' }).trim();
}

/** The same, inside a sentence: "every Claude subscription". */
export function placeInline(t: TFunction, place: Place): string {
  const service = serviceLabel(t, place.service);
  if (place.kind === 'logins') return t('provimux.excluded.place_logins_inline', { service });
  return t('provimux.excluded.place_key', { service, key: place.entry.keyPreview ?? '' }).trim();
}

/** The line under a place: how many logins; a key's address, connection and what it shares. */
export function placeDetail(t: TFunction, place: Place): string {
  if (place.kind === 'logins') {
    return place.loginCount === null
      ? t('provimux.excluded.place_logins_unknown')
      : place.loginCount === 0
        ? t('provimux.excluded.place_logins_none')
        : t('provimux.excluded.place_logins_count', { count: place.loginCount });
  }
  const parts = [place.entry.host, place.entry.groupName].filter(Boolean) as string[];
  const detail = [...new Set(parts)].join(' · ');
  const shared =
    place.storedOn === 'group' && place.sharing > 1 && place.entry.groupName
      ? t('provimux.excluded.place_key_shared', {
          name: place.entry.groupName,
          count: place.sharing,
        })
      : null;
  const off = place.off ? t('provimux.excluded.place_key_off') : null;
  return [detail, shared, off].filter(Boolean).join(' · ');
}

/**
 * "Claude · alex@example.com", "Claude API key st******b2": an account the proxy routes to. A key is named by
 * its masked tail when the configuration has it (by its auth index), else by its address; never by the
 * proxy's internal label ("claude-apikey").
 */
export function routeName(
  t: TFunction,
  route: ProvimuxModelRoute,
  keys: readonly KeyEntry[] = []
): string {
  const provider = providerName(t, route.provider, route.host);
  if (route.kind === 'apikey') {
    const entry = route.auth_index
      ? keys.find((key) => key.authIndexes.includes(route.auth_index as string))
      : undefined;
    const who = entry?.keyPreview ?? entry?.groupName ?? route.host ?? '';
    return t('provimux.excluded.route_key', { provider, who })
      .replace(/\s*·\s*$/, '')
      .trim();
  }
  const who = route.login.email ?? route.login.name ?? '';
  return who ? `${provider} · ${who}` : provider;
}

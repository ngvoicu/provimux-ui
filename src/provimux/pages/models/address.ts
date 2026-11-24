import { normalizeOAuthProviderKey } from '@/utils/providerKeys';

export const MODELS_PATH = '/provimux/models';

/**
 * Where an old page's address leads on the Models page, its filter kept: Aliases (`?store`, `?family`,
 * `?channel`), the old login alias editor (`?provider=<login type>`), Model routes (`?provider=<id>`), and
 * Live model lists / Model lists (no filter).
 */
export function modelsAddressFor(pathname: string, search: string): string {
  const from = new URLSearchParams(search);
  const to = new URLSearchParams();
  if (pathname === '/auth-files/oauth-model-alias') {
    const channel = normalizeOAuthProviderKey(from.get('provider') ?? '');
    if (channel) to.set('channel', channel);
    else to.set('store', 'login');
  } else if (pathname === '/provimux/aliases') {
    for (const key of ['store', 'family', 'channel']) {
      const value = from.get(key)?.trim();
      if (value) to.set(key, value);
    }
  } else if (pathname === '/provimux/model-routes') {
    const provider = from.get('provider')?.trim();
    if (provider) to.set('provider', provider);
  }
  const query = to.toString();
  return query ? `${MODELS_PATH}?${query}` : MODELS_PATH;
}

/** The view the Models page shows: its names, or the models accounts never serve (`?tab=excluded`). */
export const tabOf = (params: URLSearchParams): 'names' | 'excluded' =>
  params.get('tab') === 'excluded' ? 'excluded' : 'names';

/** Models' excluded models, searched for one model (its name, or a pattern that takes it out). */
export function excludedAddress(model?: string): string {
  const params = new URLSearchParams({ tab: 'excluded' });
  if (model?.trim()) params.set('model', model.trim());
  return `${MODELS_PATH}?${params.toString()}`;
}

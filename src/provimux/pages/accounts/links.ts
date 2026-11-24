import { MODELS_PATH } from '../models/address';
import { isOpenRouterHost } from '../modelRoutes/logic';
import type { Account } from './accounts';

/**
 * Models showing what one account serves (design accounts-page.md, section 4): filtered to the account by its
 * auth index when the proxy reports routes (`?account=`); without them, to its login type or key family.
 */
export function modelsAddressOf(account: Account, routesKnown: boolean, view?: 'learned'): string {
  const params = new URLSearchParams();
  if (routesKnown && account.authIndexes.length) params.set('account', account.authIndexes[0]);
  else if (account.kind === 'sub') params.set('channel', account.loginType);
  else if (isOpenRouterHost(account.entry.host)) params.set('provider', 'openrouter');
  else params.set('family', account.entry.family);
  // Only the models the key learned by itself from its service's list (key-model-lists.md 7.2).
  if (view) params.set('view', view);
  return `${MODELS_PATH}?${params.toString()}`;
}

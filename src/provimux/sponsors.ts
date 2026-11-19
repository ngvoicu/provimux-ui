/**
 * Sponsors and affiliate entries are hidden in Provimux's console (owner's decision, 2026-11-19); what an operator
 * has configured stays reachable.
 *
 * Seams, each one line:
 * - the "Quick Start" nav item (a reseller's page): `hideSponsorNav` in MainLayout, and its route redirects
 *   to AI Providers in MainRoutes;
 * - the sponsor row under the proxy URL field: `hideSponsor` in config/components/fields/sharedFields.tsx;
 * - the AI Providers page (T-45, T-49): `providerGroupsWithoutOffers` where ProvidersWorkbenchPage.tsx builds its
 *   groups, and `noQuickFill` in ProviderCategoryList.tsx. A sponsor group with nothing configured (an offer to add
 *   one) is not listed; one that holds configured keys (keys whose base URL is the sponsor's, APIKEY.FUN included,
 *   which upstream shows only on Quick Start) is listed with the other providers, as an ordinary row with its
 *   edit, disable and delete controls;
 * - no "New" on a sponsor group (T-54): `offersCreate` gates the page header's "New" in
 *   ProvidersWorkbenchPage.tsx and the empty search result's "New" in ProviderResourcePanel.tsx. Upstream created
 *   sponsor keys only through their prefilled Quick Fill / Quick Start forms; "New" on such a group opened a blank
 *   form whose save replaced the group's saved key. A key for one of those services is added as Codex or OpenAI
 *   Compatible with its URL;
 * - the OAuth page's Kimi card: it is also the console's only Kimi login, and it lives under src/features/oauth/,
 *   which the guard protects; its affiliate sign-up links are hidden by the theme.
 *
 * Every link to a referral URL, wherever it comes from (source, JSON, the server), is hidden by the theme
 * (theme/_sponsors.scss), with the line that only introduces one and the Kimi promotion text.
 * tests/provimux/sponsors.test.ts renders the pages that carry such links and fails when one stays visible, when
 * an affiliate URL in the source is not covered, or when configured sponsor keys stop being reachable.
 */

/** Paths of nav items that are sponsor pages. */
export const SPONSOR_NAV_PATHS: readonly string[] = ['/quick-start'];

const isSponsorNavItem = (item: object): boolean =>
  'path' in item && typeof item.path === 'string' && SPONSOR_NAV_PATHS.includes(item.path);

/** Removes sponsor items from the sidebar's nav groups, in place (the groups are rebuilt on every render). */
export function hideSponsorNav<G extends { items: object[] }>(groups: G[]): G[] {
  for (const group of groups) {
    group.items = group.items.filter((item) => !isSponsorNavItem(item)) as G['items'];
  }
  return groups;
}

/** A sponsor entry to show: none. */
export function hideSponsor<T>(sponsor: T | undefined): T | undefined {
  void sponsor;
  return undefined;
}

/** The reseller groups upstream offers on AI Providers ("Quick Fill") and on Quick Start (APIKEY.FUN). */
export const SPONSOR_GROUP_BRANDS: readonly string[] = ['apikeyFun', 'fennoAI', 'qiniuCloud', 'aiCodeMirror'];

/**
 * The AI Providers page's groups: a sponsor group only when it holds configured keys, never as an offer to add
 * one. Kimi stays as upstream lists it: a provider with an API of its own (its registration link is hidden).
 * A remembered selection that is no longer listed falls back to the first provider.
 */
export function providerGroupsWithoutOffers<
  G extends { id: string; resources: readonly unknown[] },
>(groups: readonly G[]): G[] {
  return groups.filter(
    (group) => !SPONSOR_GROUP_BRANDS.includes(group.id) || group.resources.length > 0
  );
}

/** No "Quick Fill" list: configured sponsor groups are listed with the other providers. */
export function noQuickFill<T>(brands: readonly T[]): T[] {
  void brands;
  return [];
}

/**
 * Whether a provider group offers "New": not a sponsor group. Upstream created sponsor keys only through their
 * prefilled forms (Quick Fill, Quick Start), which Provimux hides; on a listed sponsor group "New" opened a blank
 * form whose save replaced the group's saved key (T-54). Its configured keys keep view, edit, on/off and delete.
 */
export function offersCreate(brand: string): boolean {
  return !SPONSOR_GROUP_BRANDS.includes(brand);
}

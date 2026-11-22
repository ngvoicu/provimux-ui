/**
 * Sponsors and affiliate entries are hidden in Provimux's console (owner's decision, 2026-11-19); what an operator
 * has configured stays reachable.
 *
 * Seams, each one line:
 * - the "Quick Start" nav item (a reseller's page): `hideSponsorNav` in MainLayout, and its route redirects
 *   to AI Providers in MainRoutes;
 * - the sponsor row under the proxy URL field: `hideSponsor` in config/components/fields/sharedFields.tsx;
 * - the AI Providers page (T-45, T-49): `providerGroupsWithoutOffers` where ProvidersWorkbenchPage.tsx builds its
 *   groups, which the provider strip, the panel and the "Add provider" catalogue all draw from. A sponsor group with
 *   nothing configured (an offer to add one) is not listed, so the strip's quick-connect invitation and the
 *   catalogue's partner cards have nothing to show; one that holds configured keys (keys whose base URL is the
 *   sponsor's, APIKEY.FUN included, which upstream shows only on Quick Start) is listed with the other providers,
 *   with its cards' view, edit, on/off and delete controls. The theme hides the strip's "Quick Fill" divider
 *   (theme/_sponsors.scss). The "Add provider" catalogue (the sheet's and the first-run page) gets `groupsToAdd`:
 *   no sponsor, configured or not;
 * - no "New" on a sponsor group: `offersCreate` in ProvidersWorkbenchPage.tsx's `openConnectionForm`, the
 *   page's only way into a form for a group (the panel's button, the catalogue and its first-run page): a sponsor
 *   group never opens the blank create form, whose save replaced the group's saved key. Upstream 1.29.0 already
 *   opens a populated sponsor group's bundle to edit instead; the seam keeps the rule if that changes. A key for one
 *   of those services is added as Codex or OpenAI Compatible with its URL;
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
 * A remembered selection that is no longer listed falls back as upstream's page does (its first connected provider).
 */
export function providerGroupsWithoutOffers<
  G extends { id: string; resources: readonly unknown[] },
>(groups: readonly G[]): G[] {
  return groups.filter(
    (group) => !SPONSOR_GROUP_BRANDS.includes(group.id) || group.resources.length > 0
  );
}

/**
 * Whether a provider group offers "New" (the blank create form): not a sponsor group. Upstream created sponsor keys
 * only through their prefilled forms (Quick Fill, Quick Start), which Provimux hides; on a listed sponsor group
 * "New" opened a blank form whose save replaced the group's saved key. Its configured keys keep view, edit,
 * on/off and delete.
 */
export function offersCreate(brand: string): boolean {
  return !SPONSOR_GROUP_BRANDS.includes(brand);
}

/**
 * The groups the "Add provider" catalogue lists: those that offer "New". A configured sponsor group is reached from
 * its tab in the provider strip; the catalogue neither offers a sponsor nor features a configured one.
 */
export function groupsToAdd<G extends { id: string }>(groups: readonly G[]): G[] {
  return groups.filter((group) => offersCreate(group.id));
}

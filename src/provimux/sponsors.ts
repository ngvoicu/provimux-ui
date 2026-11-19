/**
 * Sponsors and affiliate entries are hidden in Provimux's console (owner's decision, 2026-11-19).
 *
 * Three places carry them as entries of their own, each hidden by a one-line seam:
 * - the "Quick Start" nav item (a reseller's page): `hideSponsorNav` in MainLayout, and its route redirects
 *   to AI Providers in MainRoutes;
 * - the sponsor row under the proxy URL field: `hideSponsor` in config/components/fields/sharedFields.tsx;
 * - the OAuth page's Kimi card: it is also the console's only Kimi login, and it lives under src/features/oauth/,
 *   which the guard protects; its affiliate sign-up links are hidden by the theme (theme/_sponsors.scss).
 *
 * Every other affiliate link (provider presets on the AI Providers page) is hidden by the same stylesheet rule,
 * and tests/provimux/sponsors.test.ts fails when upstream adds an affiliate URL that rule does not cover.
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

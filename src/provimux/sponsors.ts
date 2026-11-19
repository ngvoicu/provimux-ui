/**
 * Sponsors and affiliate entries are hidden in Provimux's console (owner's decision, 2026-11-19).
 *
 * Four places carry them as entries of their own, each hidden by a one-line seam:
 * - the "Quick Start" nav item (a reseller's page): `hideSponsorNav` in MainLayout, and its route redirects
 *   to AI Providers in MainRoutes;
 * - the sponsor row under the proxy URL field: `hideSponsor` in config/components/fields/sharedFields.tsx;
 * - the AI Providers page's "Quick Fill" list of sponsor presets (owner, 2026-11-19, T-45):
 *   `hideSponsorPresets` where ProvidersWorkbenchPage.tsx builds its groups;
 * - the OAuth page's Kimi card: it is also the console's only Kimi login, and it lives under src/features/oauth/,
 *   which the guard protects; its affiliate sign-up links are hidden by the theme (theme/_sponsors.scss).
 *
 * Every other affiliate link (the Kimi provider's registration link on AI Providers) is hidden by the same
 * stylesheet rule. tests/provimux/sponsors.test.ts fails when upstream adds an affiliate URL that rule does not
 * cover, or a sponsor preset the AI Providers page would still list.
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

/**
 * The sponsor presets of the AI Providers page's "Quick Fill" list. Kimi stays: it is a provider with an API of
 * its own (only its registration link is hidden); APIKEY.FUN never shows there (upstream keeps it for Quick Start).
 */
export const SPONSOR_PRESET_BRANDS: readonly string[] = ['fennoAI', 'qiniuCloud', 'aiCodeMirror'];

/**
 * The AI Providers page's groups without the sponsor presets: the "Quick Fill" list is not drawn, and a preset
 * remembered as the selected group falls back to the first provider.
 */
export function hideSponsorPresets<G extends { id: string }>(groups: readonly G[]): G[] {
  return groups.filter((group) => !SPONSOR_PRESET_BRANDS.includes(group.id));
}

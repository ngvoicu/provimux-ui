import type { ReactElement } from 'react';
import { IconAccounts, IconModelRoutes, IconSavings } from './components/ProvimuxIcons';
import { isListed, type PresenceEntry, type ProvimuxEndpoint } from './presence';
import { hideSponsorNav } from './sponsors';

/**
 * Provimux's pages in the sidebar. Accounts takes the place of upstream's AI Providers, Auth Files and OAuth
 * Login; those three move, with their icons and Auth Files' count, to a small group of their own right after
 * it, "All settings", named in the owner's words (API keys, Subscriptions, Ways to sign in), so every original
 * setting stays one click away. The others go in the Gateway group, after Routing. An item with an endpoint is listed only while that endpoint answers, or fails
 * for another reason than 404; an item without one (Accounts and Models read the configuration and the
 * credentials, and show Provimux's endpoints where the proxy has them) is always listed.
 */
export const PROVIMUX_PAGES: ReadonlyArray<{
  endpoint: ProvimuxEndpoint | null;
  path: string;
  labelKey: string;
  metaKey: string;
  icon: () => ReactElement;
  /** Upstream items this page takes the place of: it goes where the first of them was. */
  replaces?: readonly string[];
}> = [
  {
    endpoint: null,
    path: '/provimux/accounts',
    labelKey: 'provimux.nav.accounts',
    metaKey: 'provimux.nav_meta.accounts',
    icon: () => <IconAccounts size={18} />,
    replaces: ['/ai-providers', '/auth-files', '/oauth'],
  },
  {
    endpoint: null,
    path: '/provimux/models',
    labelKey: 'provimux.nav.models',
    metaKey: 'provimux.nav_meta.models',
    icon: () => <IconModelRoutes size={18} />,
  },
  {
    endpoint: 'savings',
    path: '/provimux/savings',
    labelKey: 'provimux.nav.savings',
    metaKey: 'provimux.nav_meta.savings',
    icon: () => <IconSavings size={18} />,
  },
];

const GROUP = 'gateway';
const AFTER = '/routing';

/** The group the pages Accounts replaces move to, and their names there. */
export const ALL_SETTINGS_GROUP = 'provimux-all-settings';
const ALL_SETTINGS_LABEL = 'provimux.nav_groups.all_settings';
const ALL_SETTINGS_NAMES: Readonly<Record<string, { labelKey: string; metaKey: string }>> = {
  '/ai-providers': { labelKey: 'provimux.nav.all_keys', metaKey: 'provimux.nav_meta.all_keys' },
  '/auth-files': { labelKey: 'provimux.nav.all_logins', metaKey: 'provimux.nav_meta.all_logins' },
  '/oauth': { labelKey: 'provimux.nav.all_sign_in', metaKey: 'provimux.nav_meta.all_sign_in' },
};

const pathOf = (item: object): string | null =>
  'path' in item && typeof item.path === 'string' ? item.path : null;

type NavItem = { path: string; labelKey: string; metaKey: string; icon: ReactElement };

/**
 * A page that replaces upstream items: those items leave every group, and the page takes the place of the
 * first one found. When upstream has none of them any more, it goes in the Gateway group before Routing (at
 * the end of the first group when there is no Gateway group or no Routing). Returns the items taken out, in
 * menu order, and the group the page went to.
 */
function replaceItems<G extends { id: string; items: object[] }>(
  groups: G[],
  item: NavItem,
  replaced: readonly string[]
): { removed: object[]; group: G | undefined } {
  let home: G | undefined;
  const removed: object[] = [];
  for (const group of groups) {
    const at = group.items.findIndex((candidate) => replaced.includes(pathOf(candidate) ?? ''));
    if (at === -1) continue;
    removed.push(...group.items.filter((candidate) => replaced.includes(pathOf(candidate) ?? '')));
    const kept = group.items.filter((candidate) => !replaced.includes(pathOf(candidate) ?? ''));
    if (!home) {
      kept.splice(at, 0, item);
      home = group;
    }
    group.items = kept as G['items'];
  }
  if (home) return { removed, group: home };
  const group = groups.find((candidate) => candidate.id === GROUP) ?? groups[0];
  if (!group) return { removed, group: undefined };
  const anchor = group.items.findIndex((candidate) => pathOf(candidate) === AFTER);
  const at = anchor === -1 ? group.items.length : anchor;
  group.items = [...group.items.slice(0, at), item, ...group.items.slice(at)] as G['items'];
  return { removed, group };
}

/**
 * The upstream items a page replaced, in a group of their own right after the page's group: the same items
 * (route, icon, badge), named in the owner's words. Nothing is added when none were there.
 */
function keepReachable<G extends { id: string; items: object[] }>(
  groups: G[],
  removed: object[],
  after: G | undefined
) {
  if (removed.length === 0) return;
  const items = removed.map((item) => {
    const names = ALL_SETTINGS_NAMES[pathOf(item) ?? ''];
    return names ? { ...item, ...names } : item;
  });
  const at = after ? groups.indexOf(after) + 1 : groups.length;
  const group = { ...(after ?? groups[0]), id: ALL_SETTINGS_GROUP, labelKey: ALL_SETTINGS_LABEL, items };
  groups.splice(at, 0, group as G);
}

/**
 * The sidebar's groups, in place (MainLayout rebuilds them on every render): sponsor items hidden, Accounts
 * in the place of the pages it replaces, Provimux's other pages added where their endpoints are present.
 */
export function provimuxNav<G extends { id: string; items: object[] }>(
  groups: G[],
  pages: Partial<Record<ProvimuxEndpoint, PresenceEntry>>
): G[] {
  hideSponsorNav(groups);
  // A caller that knows fewer endpoints (an older presence record) lists none of the others.
  const listed = (endpoint: ProvimuxEndpoint | null) => {
    if (endpoint === null) return true;
    const entry: PresenceEntry | undefined = pages[endpoint];
    return entry !== undefined && isListed(entry);
  };
  const itemOf = (page: (typeof PROVIMUX_PAGES)[number]): NavItem => ({
    path: page.path,
    labelKey: page.labelKey,
    metaKey: page.metaKey,
    icon: page.icon(),
  });
  for (const page of PROVIMUX_PAGES) {
    if (!page.replaces || !listed(page.endpoint)) continue;
    const { removed, group } = replaceItems(groups, itemOf(page), page.replaces);
    keepReachable(groups, removed, group);
  }
  const items = PROVIMUX_PAGES.filter((page) => !page.replaces && listed(page.endpoint)).map(itemOf);
  if (items.length === 0) return groups;
  const group = groups.find((candidate) => candidate.id === GROUP) ?? groups[0];
  if (!group) return groups;
  const anchor = group.items.findIndex((item) => pathOf(item) === AFTER);
  const at = anchor === -1 ? group.items.length : anchor + 1;
  group.items = [...group.items.slice(0, at), ...items, ...group.items.slice(at)] as G['items'];
  return groups;
}

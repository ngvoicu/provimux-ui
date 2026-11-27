import type { ReactElement } from 'react';
import i18next from 'i18next';
import { IconSlidersHorizontal } from '@/components/ui/icons';
import {
  IconAccounts,
  IconModelRoutes,
  IconRestarts,
  IconSavings,
} from './components/ProvimuxIcons';
import { ADVANCED_SETTINGS_DRAWER } from './navDrawer';
import { isListed, type NavGate, type PresenceEntry } from './presence';
import { hideSponsorNav } from './sponsors';

/**
 * Provimux's pages in the sidebar. Accounts takes the place of upstream's AI Providers, Auth Files and OAuth
 * Login; those three move, with their icons and Auth Files' count, into "Advanced settings", a drawer at the
 * end of Accounts' group, closed until opened (navDrawer.ts remembers it), named in the owner's words (API
 * keys, Subscriptions, Ways to sign in), so every original setting stays one click away. The others go in the
 * Gateway group, after Routing. An item with an endpoint is listed only while that endpoint answers, or fails
 * for another reason than 404; an item without one (Accounts and Models read the configuration and the
 * credentials, and show Provimux's endpoints where the proxy has them) is always listed. Restarts is listed
 * while the server is Provimux (`provimux`: by its version, or by an endpoint only Provimux has): its two
 * settings are Provimux's, and its cards say what a Provimux without them does.
 */
export const PROVIMUX_PAGES: ReadonlyArray<{
  endpoint: NavGate | null;
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
  {
    endpoint: 'provimux',
    path: '/provimux/restarts',
    labelKey: 'provimux.nav.restarts',
    metaKey: 'provimux.nav_meta.restarts',
    icon: () => <IconRestarts size={18} />,
  },
];

const GROUP = 'gateway';
const AFTER = '/routing';

/** The drawer the pages Accounts replaces move to (`ADVANCED_SETTINGS_DRAWER`), and their names there. */
const ADVANCED_SETTINGS_LABEL = 'provimux.nav.advanced_settings';
const ADVANCED_SETTINGS_META = 'provimux.nav_meta.advanced_settings';
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
 * The upstream items a page replaced, in a drawer at the end of the page's group, "Advanced settings": the
 * same items (route, icon, badge), named in the owner's words. The drawer is upstream's own kind of item (the
 * plugin pages' drawer); its label is read in the current language, since MainLayout shows a drawer's label as
 * given. Nothing is added when none were there.
 */
function keepReachable<G extends { id: string; items: object[] }>(
  groups: G[],
  removed: object[],
  after: G | undefined
) {
  if (removed.length === 0) return;
  const children = removed.map((item) => {
    const names = ALL_SETTINGS_NAMES[pathOf(item) ?? ''];
    return names ? { ...item, ...names } : item;
  });
  const home = after ?? groups[0];
  if (!home) return;
  const drawer = {
    kind: 'drawer' as const,
    id: ADVANCED_SETTINGS_DRAWER,
    label: i18next.t(ADVANCED_SETTINGS_LABEL),
    meta: i18next.t(ADVANCED_SETTINGS_META),
    icon: <IconSlidersHorizontal size={18} />,
    children,
  };
  home.items = [...home.items, drawer] as G['items'];
}

/**
 * The sidebar's groups, in place (MainLayout rebuilds them on every render): sponsor items hidden, Accounts
 * in the place of the pages it replaces, Provimux's other pages added where their endpoints are present.
 */
export function provimuxNav<G extends { id: string; items: object[] }>(
  groups: G[],
  pages: Partial<Record<NavGate, PresenceEntry>>
): G[] {
  hideSponsorNav(groups);
  // A caller that knows fewer endpoints (an older presence record) lists none of the others.
  const listed = (endpoint: NavGate | null) => {
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

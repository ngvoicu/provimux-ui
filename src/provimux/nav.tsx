import type { ReactElement } from 'react';
import { IconAccounts, IconModelRoutes, IconSavings } from './components/ProvimuxIcons';
import { isListed, type PresenceEntry, type ProvimuxEndpoint } from './presence';
import { hideSponsorNav } from './sponsors';

/**
 * Provimux's pages in the sidebar. Accounts takes the place of upstream's AI Providers, Auth Files and OAuth
 * Login (their items leave the menu; their routes stay, and Accounts links to them). The others go in the
 * Gateway group, after Routing. An item with an endpoint is listed only while that endpoint answers, or fails
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

const pathOf = (item: object): string | null =>
  'path' in item && typeof item.path === 'string' ? item.path : null;

type NavItem = { path: string; labelKey: string; metaKey: string; icon: ReactElement };

/**
 * A page that replaces upstream items: those items leave every group, and the page takes the place of the
 * first one found. When upstream has none of them any more, it goes in the Gateway group before Routing (at
 * the end of the first group when there is no Gateway group or no Routing).
 */
function replaceItems<G extends { id: string; items: object[] }>(
  groups: G[],
  item: NavItem,
  replaced: readonly string[]
) {
  let placed = false;
  for (const group of groups) {
    const at = group.items.findIndex((candidate) => replaced.includes(pathOf(candidate) ?? ''));
    if (at === -1) continue;
    const kept = group.items.filter((candidate) => !replaced.includes(pathOf(candidate) ?? ''));
    if (!placed) {
      kept.splice(at, 0, item);
      placed = true;
    }
    group.items = kept as G['items'];
  }
  if (placed) return;
  const group = groups.find((candidate) => candidate.id === GROUP) ?? groups[0];
  if (!group) return;
  const anchor = group.items.findIndex((candidate) => pathOf(candidate) === AFTER);
  const at = anchor === -1 ? group.items.length : anchor;
  group.items = [...group.items.slice(0, at), item, ...group.items.slice(at)] as G['items'];
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
    if (page.replaces && listed(page.endpoint)) replaceItems(groups, itemOf(page), page.replaces);
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

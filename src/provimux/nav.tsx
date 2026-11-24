import type { ReactElement } from 'react';
import { IconModelRoutes, IconSavings } from './components/ProvimuxIcons';
import { isListed, type PresenceEntry, type ProvimuxEndpoint } from './presence';
import { hideSponsorNav } from './sponsors';

/**
 * Provimux's pages in the sidebar: in the Gateway group, after Routing. An item with an endpoint is listed only
 * while that endpoint answers, or fails for another reason than 404; an item without one (Models, which reads the
 * configuration and shows Provimux's endpoints where the proxy has them) is always listed, first.
 */
export const PROVIMUX_PAGES: ReadonlyArray<{
  endpoint: ProvimuxEndpoint | null;
  path: string;
  labelKey: string;
  metaKey: string;
  icon: () => ReactElement;
}> = [
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

/**
 * The sidebar's groups, in place (MainLayout rebuilds them on every render): sponsor items hidden, Provimux's
 * pages added where their endpoints are present.
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
  const items = PROVIMUX_PAGES.filter((page) => listed(page.endpoint)).map((page) => ({
    path: page.path,
    labelKey: page.labelKey,
    metaKey: page.metaKey,
    icon: page.icon(),
  }));
  if (items.length === 0) return groups;
  const group = groups.find((candidate) => candidate.id === GROUP) ?? groups[0];
  if (!group) return groups;
  const anchor = group.items.findIndex((item) => pathOf(item) === AFTER);
  const at = anchor === -1 ? group.items.length : anchor + 1;
  group.items = [...group.items.slice(0, at), ...items, ...group.items.slice(at)] as G['items'];
  return groups;
}

import type { ReactElement } from 'react';
import { IconLiveLists, IconModelRoutes, IconSavings } from './components/ProvimuxIcons';
import { isListed, type PresenceEntry, type ProvimuxEndpoint } from './presence';
import { hideSponsorNav } from './sponsors';

/**
 * Provimux's pages in the sidebar: in the Gateway group, after Routing (model routes are the routing seen per
 * model). Each item is listed only while its endpoint answers, or fails for another reason than 404.
 */
export const PROVIMUX_PAGES: ReadonlyArray<{
  endpoint: ProvimuxEndpoint;
  path: string;
  labelKey: string;
  metaKey: string;
}> = [
  {
    endpoint: 'modelRoutes',
    path: '/provimux/model-routes',
    labelKey: 'provimux.nav.model_routes',
    metaKey: 'provimux.nav_meta.model_routes',
  },
  {
    endpoint: 'liveLists',
    path: '/provimux/live-lists',
    labelKey: 'provimux.nav.live_lists',
    metaKey: 'provimux.nav_meta.live_lists',
  },
  {
    endpoint: 'savings',
    path: '/provimux/savings',
    labelKey: 'provimux.nav.savings',
    metaKey: 'provimux.nav_meta.savings',
  },
];

const ICONS: Record<ProvimuxEndpoint, () => ReactElement> = {
  modelRoutes: () => <IconModelRoutes size={18} />,
  liveLists: () => <IconLiveLists size={18} />,
  savings: () => <IconSavings size={18} />,
};

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
  const listed = (endpoint: ProvimuxEndpoint) => {
    const entry: PresenceEntry | undefined = pages[endpoint];
    return entry !== undefined && isListed(entry);
  };
  const items = PROVIMUX_PAGES.filter((page) => listed(page.endpoint)).map((page) => ({
    path: page.path,
    labelKey: page.labelKey,
    metaKey: page.metaKey,
    icon: ICONS[page.endpoint](),
  }));
  if (items.length === 0) return groups;
  const group = groups.find((candidate) => candidate.id === GROUP) ?? groups[0];
  if (!group) return groups;
  const anchor = group.items.findIndex((item) => pathOf(item) === AFTER);
  const at = anchor === -1 ? group.items.length : anchor + 1;
  group.items = [...group.items.slice(0, at), ...items, ...group.items.slice(at)] as G['items'];
  return groups;
}

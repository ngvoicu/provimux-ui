import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { IconSidebarRouting } from '@/components/ui/icons';
import { IconAccounts, IconModelRoutes } from './components/ProvimuxIcons';

/** One of the Dashboard's "Where to go from here" cards, as upstream builds them (DashboardPage.tsx). */
export interface DashboardCard {
  to: string;
  icon: ReactNode;
  title: string;
}

/** Upstream's pages that Accounts took the place of: in the menu under Advanced settings, not offered here. */
const UNDER_ADVANCED_SETTINGS = new Set(['/ai-providers', '/auth-files', '/oauth']);

/**
 * The Dashboard's "Where to go from here" (owner, 2026-11-24): Provimux's pages first, Accounts, Models and
 * Routing, then the rest of upstream's cards in their order. AI Providers and Auth Files are left out: they are in
 * the menu under Advanced settings. Upstream's list is hard-coded, so this is its one seam (`ctaCards`); the
 * theme lays the first three out as a row of their own (theme/_dashboard.scss).
 */
export function provimuxDashboardLinks(cards: readonly DashboardCard[], t: TFunction): DashboardCard[] {
  const ours: DashboardCard[] = [
    {
      to: '/provimux/accounts',
      icon: <IconAccounts size={20} />,
      title: t('provimux.nav.accounts'),
    },
    {
      to: '/provimux/models',
      icon: <IconModelRoutes size={20} />,
      title: t('provimux.nav.models'),
    },
    { to: '/routing', icon: <IconSidebarRouting size={20} />, title: t('nav.routing') },
  ];
  const placed = new Set(ours.map((card) => card.to));
  return [
    ...ours,
    ...cards.filter((card) => !UNDER_ADVANCED_SETTINGS.has(card.to) && !placed.has(card.to)),
  ];
}

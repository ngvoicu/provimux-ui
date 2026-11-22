import { ProvimuxPageGate } from './components/ProvimuxPageGate';
import { AliasesPage } from './pages/aliases/AliasesPage';
import { AliasesRedirect } from './pages/aliases/AliasesRedirect';
import { LiveListsPage } from './pages/liveLists/LiveListsPage';
import { ModelListsRoute } from './pages/modelLists/ModelListsRoute';
import { ModelRoutesPage } from './pages/modelRoutes/ModelRoutesPage';
import { SavingsPage } from './pages/savings/SavingsPage';

/**
 * Spread first into upstream's route table (src/router/MainRoutes.tsx): among routes with one path the
 * earlier wins, so `/auth-files/oauth-model-alias` here takes over upstream's old login alias editor (U2).
 * Aliases reads and writes the configuration only, so neither route is gated by Provimux's endpoints.
 */
export const PROVIMUX_ROUTES = [
  { path: '/provimux/aliases', element: <AliasesPage /> },
  { path: '/auth-files/oauth-model-alias', element: <AliasesRedirect /> },
  {
    path: '/provimux/model-routes',
    element: (
      <ProvimuxPageGate endpoint="modelRoutes">
        <ModelRoutesPage />
      </ProvimuxPageGate>
    ),
  },
  {
    path: '/provimux/live-lists',
    element: <ModelListsRoute fallback={<LiveListsPage />} />,
  },
  {
    path: '/provimux/savings',
    element: (
      <ProvimuxPageGate endpoint="savings">
        <SavingsPage />
      </ProvimuxPageGate>
    ),
  },
];

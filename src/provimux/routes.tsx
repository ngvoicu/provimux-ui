import { ProvimuxPageGate } from './components/ProvimuxPageGate';
import { AliasesPage } from './pages/aliases/AliasesPage';
import { LiveListsPage } from './pages/liveLists/LiveListsPage';
import { ModelRoutesPage } from './pages/modelRoutes/ModelRoutesPage';
import { SavingsPage } from './pages/savings/SavingsPage';

/**
 * Spread into upstream's route table (src/router/MainRoutes.tsx). Aliases reads and writes the configuration
 * only, so it is not gated by Provimux's endpoints: it works on any v8 proxy.
 */
export const PROVIMUX_ROUTES = [
  { path: '/provimux/aliases', element: <AliasesPage /> },
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
    element: (
      <ProvimuxPageGate endpoint="liveLists">
        <LiveListsPage />
      </ProvimuxPageGate>
    ),
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

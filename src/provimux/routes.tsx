import { ProvimuxPageGate } from './components/ProvimuxPageGate';
import { LiveListsPage } from './pages/liveLists/LiveListsPage';
import { ModelRoutesPage } from './pages/modelRoutes/ModelRoutesPage';
import { SavingsPage } from './pages/savings/SavingsPage';

/** Spread into upstream's route table (src/router/MainRoutes.tsx). */
export const PROVIMUX_ROUTES = [
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

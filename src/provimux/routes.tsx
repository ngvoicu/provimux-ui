import { ProvimuxPageGate } from './components/ProvimuxPageGate';
import { ModelsPage } from './pages/models/ModelsPage';
import { ModelsRedirect } from './pages/models/ModelsRedirect';
import { SavingsPage } from './pages/savings/SavingsPage';

/**
 * Spread first into upstream's route table (src/router/MainRoutes.tsx): among routes with one path the
 * earlier wins, so `/auth-files/oauth-model-alias` here takes over upstream's old login alias editor.
 * Models reads and writes the configuration, and shows Provimux's endpoints where the proxy has them, so it
 * is not gated by them. The addresses of the pages it replaced (Aliases, Model routes, Live model lists and
 * Model lists, the old login alias editor) lead to it with their filter.
 */
export const PROVIMUX_ROUTES = [
  { path: '/provimux/models', element: <ModelsPage /> },
  { path: '/provimux/aliases', element: <ModelsRedirect /> },
  { path: '/provimux/model-routes', element: <ModelsRedirect /> },
  { path: '/provimux/live-lists', element: <ModelsRedirect /> },
  { path: '/auth-files/oauth-model-alias', element: <ModelsRedirect /> },
  {
    path: '/provimux/savings',
    element: (
      <ProvimuxPageGate endpoint="savings">
        <SavingsPage />
      </ProvimuxPageGate>
    ),
  },
];

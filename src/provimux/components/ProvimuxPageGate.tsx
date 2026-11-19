import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useProvimuxPresence, type ProvimuxEndpoint } from '../presence';

/**
 * A Provimux page's route: when its endpoint answers 404 (stock CLIProxyAPI, an older Provimux) the page does not
 * exist and the route goes to the dashboard. While the probe runs, and on any other error, the page renders and
 * shows its own loading or error state.
 */
export function ProvimuxPageGate({
  endpoint,
  children,
}: {
  endpoint: ProvimuxEndpoint;
  children: ReactNode;
}) {
  const status = useProvimuxPresence((state) => state[endpoint].status);
  if (status === 'unsupported') return <Navigate to="/" replace />;
  return <>{children}</>;
}

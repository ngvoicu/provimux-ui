import { useMemo } from 'react';
import { provimuxApi } from '../api/provimuxApi';
import { useProvimuxResource } from '../pages/shared/useProvimuxResource';
import { routingNameVerdict, type RoutingNameVerdict } from './nameVerdict';

/** As often as Models reads the names: a switch turned on elsewhere shows here within 30 s. */
const POLL_MS = 30_000;
const fetchNames = (client: Parameters<typeof provimuxApi.names>[0]) => provimuxApi.names(client);

/**
 * "Serve only my names" for the Routing page's typed model (models-page.md 8.9): read from the gateway's names
 * answer on open and every 30 s while visible. The page's own header refresh stays upstream's. null while the
 * switch is off, does not apply, or the endpoint is missing or has not answered: the page is then unchanged.
 */
export function useProvimuxRoutingNames(model: string | null): RoutingNameVerdict | null {
  const names = useProvimuxResource('names', fetchNames, POLL_MS, undefined, {
    headerRefresh: false,
  });
  return useMemo(() => routingNameVerdict(names.data, model), [names.data, model]);
}

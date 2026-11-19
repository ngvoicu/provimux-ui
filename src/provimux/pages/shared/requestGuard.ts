import { useEffect, useRef } from 'react';
import { apiClient } from '@/services/api/client';

/**
 * Binds an action's requests to the page and the connection it started on, the console's own stale-request guard
 * (as in useModelRulesData: a request id plus `apiClient.getConnectionRevision()`, and `captureConnection` so a late
 * answer emits no events). An answer that arrives after the page closed, after the connection changed (signed out,
 * another server) or after a newer action of the same kind started is not applied.
 */
export interface GuardedRequest {
  /** The client to send this action's requests with; its late answers raise no console events. */
  client: typeof apiClient;
  /** Whether the action still belongs to the page and connection it started on. */
  isCurrent: () => boolean;
}

export interface RequestGuard {
  begin: () => GuardedRequest;
  /** The page closed: nothing begun so far is current any more. */
  dispose: () => void;
}

export function createRequestGuard(client: typeof apiClient = apiClient): RequestGuard {
  let latest = 0;
  let alive = true;
  return {
    begin() {
      const id = ++latest;
      const connection = client.getConnectionRevision();
      const isCurrent = () =>
        alive && id === latest && connection === client.getConnectionRevision();
      return { client: client.captureConnection(isCurrent), isCurrent };
    },
    dispose() {
      alive = false;
    },
  };
}

/** A request guard that lives as long as the component. */
export function useRequestGuard(): RequestGuard {
  const guardRef = useRef<RequestGuard | null>(null);
  if (guardRef.current === null) guardRef.current = createRequestGuard();
  useEffect(() => {
    // StrictMode mounts twice: a fresh guard for the mount that stays.
    const guard = createRequestGuard();
    guardRef.current = guard;
    return () => guard.dispose();
  }, []);
  return {
    begin: () => guardRef.current!.begin(),
    dispose: () => guardRef.current!.dispose(),
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import type { ProvimuxEndpoint } from '../../presence';
import { useProvimuxPresence } from '../../presence';
import { errorStatus } from '../../api/provimuxApi';
import { clockOffset } from '../time';

export interface ResourceState<T> {
  data: T | null;
  /** The last load failed with this (a 404 hides the page instead). */
  error: string | null;
  loading: boolean;
  /** Server clock minus browser clock, from the last answer. */
  offsetMs: number;
  /** Browser time of the last answer. */
  loadedAt: number | null;
}

/**
 * One Provimux endpoint on its page: loaded on open, on the header's refresh and, with `pollMs`, while the tab is
 * visible (never while hidden). Every answer reports to the presence store, so a 404 hides the page. Answers that
 * arrive after the connection changed, or after a newer load, are dropped.
 */
export function useProvimuxResource<T extends { observed_at: string | null }>(
  endpoint: ProvimuxEndpoint,
  fetcher: (client: typeof apiClient) => Promise<T>,
  pollMs: number | null
) {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    error: null,
    loading: true,
    offsetMs: 0,
    loadedAt: null,
  });
  const requestRef = useRef(0);
  const loadedAtRef = useRef(0);

  const load = useCallback(async (): Promise<T | null> => {
    const requestId = ++requestRef.current;
    const client = apiClient.captureConnection(() => requestId === requestRef.current);
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await fetcher(client);
      if (requestId !== requestRef.current) return null;
      const receivedAt = Date.now();
      loadedAtRef.current = receivedAt;
      setState({
        data,
        error: null,
        loading: false,
        offsetMs: clockOffset(data.observed_at, receivedAt),
        loadedAt: receivedAt,
      });
      useProvimuxPresence.getState().report(endpoint, {});
      return data;
    } catch (error) {
      if (requestId !== requestRef.current) return null;
      useProvimuxPresence.getState().report(endpoint, { error });
      if (errorStatus(error) !== 404) {
        setState((prev) => ({ ...prev, loading: false, error: getErrorMessage(error) }));
      }
      return null;
    }
  }, [endpoint, fetcher]);

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [connectionStatus, load]);

  useEffect(() => {
    if (!pollMs) return;
    const visible = () => document.visibilityState === 'visible';
    const timer = window.setInterval(() => {
      if (visible()) void load();
    }, pollMs);
    const onVisibility = () => {
      if (visible() && Date.now() - loadedAtRef.current >= pollMs) void load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, pollMs]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);
  useHeaderRefresh(refresh);

  return { ...state, load };
}

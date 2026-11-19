import { useEffect } from 'react';
import { create } from 'zustand';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import { errorStatus, provimuxApi } from './api/provimuxApi';

/**
 * Whether the connected server has Provimux's endpoints (05-console-contract.md, section 2).
 *
 * | Answer               | The page                                                              |
 * | 200                  | shown                                                                 |
 * | 404                  | hidden: no nav item, its route redirects to the dashboard             |
 * | 401                  | the client's own logout                                               |
 * | anything else, none  | shown, with the error and a retry; a restarting server never hides it |
 *
 * Each endpoint is probed once per connection, after login and again when the server's version changes (an
 * upgrade under an open tab). A page's own loads report back, so a page that starts answering 404 hides itself.
 */

export type ProvimuxEndpoint = 'modelRoutes' | 'liveLists';
export type PresenceStatus = 'unknown' | 'probing' | 'ready' | 'unsupported' | 'error';

export interface PresenceEntry {
  status: PresenceStatus;
  /** The error a probe or a load ended with ('error' only). */
  message: string | null;
}

interface PresenceState {
  /** The connection the entries belong to; null when logged out. */
  key: string | null;
  modelRoutes: PresenceEntry;
  liveLists: PresenceEntry;
  /** Probes both endpoints for a connection, unless they were already probed for it. */
  probe: (key: string) => Promise<void>;
  /** A page's own load: success shows the page, a 404 hides it, anything else shows the error. */
  report: (endpoint: ProvimuxEndpoint, outcome: { error?: unknown }) => void;
  reset: () => void;
}

const UNKNOWN: PresenceEntry = { status: 'unknown', message: null };
const PROBING: PresenceEntry = { status: 'probing', message: null };

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error ?? '');

/** What an answer means for a page: absent on 404, failing on anything else. */
export function presenceOf(outcome: { error?: unknown }): PresenceEntry {
  if (!('error' in outcome) || outcome.error === undefined)
    return { status: 'ready', message: null };
  if (errorStatus(outcome.error) === 404) return { status: 'unsupported', message: null };
  return { status: 'error', message: messageOf(outcome.error) };
}

const PROBES: Record<ProvimuxEndpoint, (client: typeof apiClient) => Promise<unknown>> = {
  modelRoutes: (client) => provimuxApi.probeModelRoutes(client),
  liveLists: (client) => provimuxApi.liveLists(client),
};

export const useProvimuxPresence = create<PresenceState>((set, get) => ({
  key: null,
  modelRoutes: UNKNOWN,
  liveLists: UNKNOWN,

  probe: async (key) => {
    if (get().key === key) return;
    set({ key, modelRoutes: PROBING, liveLists: PROBING });
    const client = apiClient.captureConnection(() => get().key === key);
    await Promise.all(
      (Object.keys(PROBES) as ProvimuxEndpoint[]).map(async (endpoint) => {
        let outcome: { error?: unknown } = {};
        try {
          await PROBES[endpoint](client);
        } catch (error) {
          outcome = { error };
        }
        // A probe for an earlier connection must not land on this one; a page that loaded meanwhile wins.
        if (get().key === key && get()[endpoint].status === 'probing') {
          set({ [endpoint]: presenceOf(outcome) } as Partial<PresenceState>);
        }
      })
    );
  },

  report: (endpoint, outcome) => {
    if (get().key === null) return;
    const next = presenceOf(outcome);
    const current = get()[endpoint];
    if (current.status !== next.status || current.message !== next.message) {
      set({ [endpoint]: next } as Partial<PresenceState>);
    }
  },

  reset: () => set({ key: null, modelRoutes: UNKNOWN, liveLists: UNKNOWN }),
}));

/** A page is listed while it answers, or fails for another reason than absence. */
export const isListed = (entry: PresenceEntry): boolean =>
  entry.status === 'ready' || entry.status === 'error';

/** The server has Provimux's console endpoints (one answered 200). */
export const isProvimuxServer = (state: Pick<PresenceState, ProvimuxEndpoint>): boolean =>
  state.modelRoutes.status === 'ready' || state.liveLists.status === 'ready';

/**
 * Runs the probes for the current connection and returns the pages' presence. Called once, by the sidebar
 * (MainLayout), which lives as long as the signed-in session.
 */
export function useProvimuxPages(): Record<ProvimuxEndpoint, PresenceEntry> {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const modelRoutes = useProvimuxPresence((state) => state.modelRoutes);
  const liveLists = useProvimuxPresence((state) => state.liveLists);
  // Also when the entries were reset under a live connection: probe again rather than stay hidden.
  const probedKey = useProvimuxPresence((state) => state.key);

  useEffect(() => {
    const presence = useProvimuxPresence.getState();
    if (connectionStatus !== 'connected') {
      if (presence.key !== null) presence.reset();
      return;
    }
    const key = `${apiClient.getConnectionRevision()}|${apiBase}|${serverVersion ?? ''}`;
    void presence.probe(key);
  }, [connectionStatus, apiBase, serverVersion, probedKey]);

  return { modelRoutes, liveLists };
}

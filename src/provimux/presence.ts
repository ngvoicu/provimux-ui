import { useEffect } from 'react';
import { create } from 'zustand';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import { errorStatus, provimuxApi } from './api/provimuxApi';
import { describeServerVersion } from './version';

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

/** The endpoints probed at login: each decides whether a page is listed. */
export type ProbedEndpoint = 'modelRoutes' | 'liveLists' | 'modelLists' | 'savings';
/**
 * Every endpoint a page reports on. `names` (only-my-names.md 6) is a part of Models, not a page: it is never
 * probed; the Models page learns of it from its own load and hides the switch on a 404.
 */
export type ProvimuxEndpoint = ProbedEndpoint | 'names';
/** What a sidebar item waits for: an endpoint, or `provimux`, the server being Provimux at all. */
export type NavGate = ProvimuxEndpoint | 'provimux';
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
  /** The successor of liveLists (model-lists.md 5.5); a server without it keeps the live-lists page. */
  modelLists: PresenceEntry;
  savings: PresenceEntry;
  /** Models' "Serve only my names"; known from the page's own load only. */
  names: PresenceEntry;
  /** Probes every endpoint for a connection, unless they were already probed for it. */
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

const PROBES: Record<ProbedEndpoint, (client: typeof apiClient) => Promise<unknown>> = {
  modelRoutes: (client) => provimuxApi.probeModelRoutes(client),
  liveLists: (client) => provimuxApi.liveLists(client),
  modelLists: (client) => provimuxApi.modelLists(client),
  savings: (client) => provimuxApi.probeSavings(client),
};

export const useProvimuxPresence = create<PresenceState>((set, get) => ({
  key: null,
  modelRoutes: UNKNOWN,
  liveLists: UNKNOWN,
  modelLists: UNKNOWN,
  savings: UNKNOWN,
  names: UNKNOWN,

  probe: async (key) => {
    if (get().key === key) return;
    set({
      key,
      modelRoutes: PROBING,
      liveLists: PROBING,
      modelLists: PROBING,
      savings: PROBING,
      names: UNKNOWN,
    });
    const client = apiClient.captureConnection(() => get().key === key);
    await Promise.all(
      (Object.keys(PROBES) as ProbedEndpoint[]).map(async (endpoint) => {
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

  reset: () =>
    set({
      key: null,
      modelRoutes: UNKNOWN,
      liveLists: UNKNOWN,
      modelLists: UNKNOWN,
      savings: UNKNOWN,
      names: UNKNOWN,
    }),
}));

/** A page is listed while it answers, or fails for another reason than absence. */
export const isListed = (entry: PresenceEntry): boolean =>
  entry.status === 'ready' || entry.status === 'error';

/** The server has Provimux's console endpoints (one answered 200). */
export const isProvimuxServer = (state: Pick<PresenceState, ProbedEndpoint>): boolean =>
  state.modelRoutes.status === 'ready' ||
  state.liveLists.status === 'ready' ||
  state.modelLists.status === 'ready' ||
  state.savings.status === 'ready';

/**
 * The server is Provimux: its version says so (`8.1.7-pmx.3`), or one of Provimux's endpoints answered (a build whose
 * version does not carry the suffix). Unknown until either is known; not Provimux once both are.
 */
export function provimuxEntry(
  serverVersion: string | null | undefined,
  probes: Pick<PresenceState, ProbedEndpoint>
): PresenceEntry {
  if (describeServerVersion(serverVersion)?.kind === 'provimux' || isProvimuxServer(probes)) {
    return { status: 'ready', message: null };
  }
  const settled = Object.values(probes).every(
    (entry) => entry.status !== 'unknown' && entry.status !== 'probing'
  );
  return { status: settled ? 'unsupported' : 'unknown', message: null };
}

/**
 * Runs the probes for the current connection and returns the pages' presence. Called once, by the sidebar
 * (MainLayout), which lives as long as the signed-in session.
 */
export function useProvimuxPages(): Record<ProbedEndpoint | 'provimux', PresenceEntry> {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const modelRoutes = useProvimuxPresence((state) => state.modelRoutes);
  const liveLists = useProvimuxPresence((state) => state.liveLists);
  const modelLists = useProvimuxPresence((state) => state.modelLists);
  const savings = useProvimuxPresence((state) => state.savings);
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

  const probes = { modelRoutes, liveLists, modelLists, savings };
  return { ...probes, provimux: provimuxEntry(serverVersion, probes) };
}

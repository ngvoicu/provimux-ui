import { apiClient } from '@/services/api/client';
import { readLiveLists, readModelRoutes } from './normalize';
import type { ProvimuxLiveListsResponse, ProvimuxModelRoutesResponse } from './types';

/**
 * Provimux's management calls, through upstream's `apiClient` (prefix /v8/management, the key, 401 → logout,
 * the server-version events). Pass `apiClient.captureConnection(...)` as `client` to drop answers that arrive after
 * the connection changed.
 */

type Client = Pick<typeof apiClient, 'get' | 'post' | 'put'>;

export const PROVIMUX_PATHS = {
  modelRoutes: '/provimux/model-routes',
  liveLists: '/provimux/live-lists',
  /** Upstream's refresh: the catalogs and, with live lists on, every login's list (in the background). */
  modelsRefresh: '/models/refresh',
  /** Config paths mirror the v8 YAML tree. */
  liveListsSwitch: '/config/models/live-lists',
  devinModelLevelCooling: '/config/oauth/providers/devin/model-level-cooling',
  /** The management section: panel-github-repository, disable-auto-update-panel. */
  management: '/config/management',
} as const;

/** The HTTP status an `apiClient` error carries, if any. */
export const errorStatus = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
};

/** `?model=a&model=b`: the contract's repeatable parameter (axios would write `model[]=`). */
const modelQuery = (models: readonly string[]) =>
  models.map((model) => `model=${encodeURIComponent(model)}`).join('&');

/**
 * A config value by its v8 path, or `undefined` when the file does not set it: GET /config/<path> reads the saved
 * document and answers 404 for a key it does not hold (the server's default then applies).
 */
async function readConfigValue(path: string, client: Client): Promise<unknown> {
  try {
    return await client.get<unknown>(path);
  } catch (error) {
    if (errorStatus(error) === 404) return undefined;
    throw error;
  }
}

const readBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : null;

export const provimuxApi = {
  /** Per model, its routes in priority order. `models` narrows the answer to those ids. */
  async modelRoutes(
    client: Client = apiClient,
    models?: readonly string[]
  ): Promise<ProvimuxModelRoutesResponse> {
    const query = models && models.length > 0 ? `?${modelQuery(models)}` : '';
    return readModelRoutes(await client.get<unknown>(`${PROVIMUX_PATHS.modelRoutes}${query}`));
  },

  /**
   * The cheap presence check: an empty `model` answers `{"models": []}` without reading any state. Resolves when
   * the endpoint exists; rejects with the client's error otherwise (404 on stock CLIProxyAPI).
   */
  async probeModelRoutes(client: Client = apiClient): Promise<void> {
    await client.get<unknown>(`${PROVIMUX_PATHS.modelRoutes}?model=`);
  },

  /** Per Claude, Codex and Meta login, its live model list. Small: one row per login; it is its own probe. */
  async liveLists(client: Client = apiClient): Promise<ProvimuxLiveListsResponse> {
    return readLiveLists(await client.get<unknown>(PROVIMUX_PATHS.liveLists));
  },

  /** Wakes the fetcher; returns before the lists arrive. */
  async refreshModels(client: Client = apiClient): Promise<void> {
    await client.post<unknown>(PROVIMUX_PATHS.modelsRefresh);
  },

  /** models.live-lists. Applies at once in a running Provimux. */
  async setLiveLists(enabled: boolean, client: Client = apiClient): Promise<void> {
    await client.put<unknown>(PROVIMUX_PATHS.liveListsSwitch, enabled);
  },

  /** oauth.providers.devin.model-level-cooling; null when the config does not set it (off by default). */
  async devinModelLevelCooling(client: Client = apiClient): Promise<boolean | null> {
    return readBoolean(await readConfigValue(PROVIMUX_PATHS.devinModelLevelCooling, client));
  },

  async setDevinModelLevelCooling(enabled: boolean, client: Client = apiClient): Promise<void> {
    await client.put<unknown>(PROVIMUX_PATHS.devinModelLevelCooling, enabled);
  },

  /** Where the server downloads its console from: the configured repository (null: not set) and auto-update. */
  async consoleSource(
    client: Client = apiClient
  ): Promise<{ repository: string | null; autoUpdateOff: boolean | null }> {
    const section = await readConfigValue(PROVIMUX_PATHS.management, client);
    const management =
      typeof section === 'object' && section !== null ? (section as Record<string, unknown>) : {};
    const repository = management['panel-github-repository'];
    const autoUpdateOff = management['disable-auto-update-panel'];
    return {
      repository: typeof repository === 'string' && repository.trim() ? repository.trim() : null,
      autoUpdateOff: readBoolean(autoUpdateOff),
    };
  },
};

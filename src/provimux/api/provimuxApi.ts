import { apiClient } from '@/services/api/client';
import { readLiveLists, readModelLists, readModelRoutes, readSavings } from './normalize';
import type {
  ProvimuxLiveListsResponse,
  ProvimuxModelListsResponse,
  ProvimuxModelRoutesResponse,
  ProvimuxSavingsPeriod,
  ProvimuxSavingsResponse,
} from './types';

/**
 * Provimux's management calls, through upstream's `apiClient` (prefix /v8/management, the key, 401 → logout,
 * the server-version events). Pass `apiClient.captureConnection(...)` as `client` to drop answers that arrive after
 * the connection changed.
 */

type Client = Pick<typeof apiClient, 'get' | 'post' | 'put'>;

export const PROVIMUX_PATHS = {
  modelRoutes: '/provimux/model-routes',
  liveLists: '/provimux/live-lists',
  /** Its successor: every login type, the source that decides each login's models. 404 on older servers. */
  modelLists: '/provimux/model-lists',
  savings: '/provimux/savings',
  /** Upstream's refresh: the catalogs and, with live lists on, every login's list (in the background). */
  modelsRefresh: '/models/refresh',
  /** Config paths mirror the v8 YAML tree. */
  liveListsSwitch: '/config/models/live-lists',
  devinModelLevelCooling: '/config/oauth/providers/devin/model-level-cooling',
  /** The credentials list (Auth Files). */
  credentials: '/credentials',
  /** The management section: panel-github-repository, disable-auto-update-panel. */
  management: '/config/management',
} as const;

/** The HTTP status an `apiClient` error carries, if any. */
export const errorStatus = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
};

/** The catalog error of Provimux's own 502 from POST /models/refresh, or null for any other failure. */
export function serverCatalogFailure(error: unknown): string | null {
  if (errorStatus(error) !== 502 || typeof error !== 'object' || error === null) return null;
  const body = (error as { data?: unknown }).data;
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.ok !== false || !('catalogs' in record || 'sources' in record)) return null;
  return typeof record.error === 'string' && record.error ? record.error : 'catalog refresh failed';
}

/** `?model=a&model=b`: the contract's repeatable parameter (axios would write `model[]=`). */
const modelQuery = (models: readonly string[]) =>
  models.map((model) => `model=${encodeURIComponent(model)}`).join('&');

/** The breakdowns the Savings page shows, each its own repeated `group` (never `group[]`). */
export const SAVINGS_GROUPS = ['kind', 'key', 'day', 'kind,provider,host'] as const;

/** `?period=month&group=kind&group=key&group=day&group=kind,provider,host`, one call for the whole page. */
export const savingsQuery = (period: ProvimuxSavingsPeriod): string =>
  [
    `period=${encodeURIComponent(period)}`,
    ...SAVINGS_GROUPS.map((group) => `group=${encodeURIComponent(group).replace(/%2C/g, ',')}`),
  ].join('&');

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

  /**
   * Per login, the source that decides its models and its live list. Small: one row per login; it is its own
   * probe. With `authIndex`, only that login, with its models and the source of each value.
   */
  async modelLists(
    client: Client = apiClient,
    authIndex?: string
  ): Promise<ProvimuxModelListsResponse> {
    const query = authIndex ? `?auth_index=${encodeURIComponent(authIndex)}` : '';
    return readModelLists(await client.get<unknown>(`${PROVIMUX_PATHS.modelLists}${query}`));
  },

  /** Savings for a period, with every breakdown the page shows. "Today" is the server's day. */
  async savings(
    client: Client = apiClient,
    period: ProvimuxSavingsPeriod = 'month'
  ): Promise<ProvimuxSavingsResponse> {
    return readSavings(
      await client.get<unknown>(`${PROVIMUX_PATHS.savings}?${savingsQuery(period)}`)
    );
  },

  /**
   * Requests per model over the last 30 days (the Models page's "used" names): one grouping, small. Rejects
   * with the client's error (404 on stock CLIProxyAPI).
   */
  async modelUsage(client: Client = apiClient): Promise<ProvimuxSavingsResponse> {
    return readSavings(
      await client.get<unknown>(`${PROVIMUX_PATHS.savings}?period=30d&group=model`)
    );
  },

  /** The presence check: today's totals only, small. Rejects with the client's error (404 on stock CLIProxyAPI). */
  async probeSavings(client: Client = apiClient): Promise<void> {
    await client.get<unknown>(`${PROVIMUX_PATHS.savings}?period=today`);
  },

  /**
   * Refreshes the catalogs and wakes the live-list fetcher. Provimux wakes the fetcher before it reports a catalog
   * that could not be read (model_definitions.go, RefreshModelDefinitions): its 502 answer, `{"ok": false, "error":
   * …, "catalogs": …}`, means the logins are being asked anyway, so it resolves with that error as `catalogError`.
   * Any other HTTP error answer (400 invalid sources, 401, 404, a proxy's 502 without that body) rejects with that
   * status. A failure without an HTTP answer (network error, timeout, lost reply) rejects without a status: the
   * request may have reached the server and started the refresh, so the caller must not read it as "not requested".
   */
  async refreshModels(client: Client = apiClient): Promise<{ catalogError: string | null }> {
    try {
      await client.post<unknown>(PROVIMUX_PATHS.modelsRefresh);
      return { catalogError: null };
    } catch (error) {
      const catalogError = serverCatalogFailure(error);
      if (catalogError === null) throw error;
      return { catalogError };
    }
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

  /**
   * The Devin logins the credentials page lists (GET /credentials), counted by state: Model routes lists only the
   * routes a login registered, so a Devin login whose models are all excluded, or that is disabled, has none there.
   */
  async devinLogins(client: Client = apiClient): Promise<{ enabled: number; disabled: number }> {
    const answer = await client.get<unknown>(PROVIMUX_PATHS.credentials);
    const files =
      typeof answer === 'object' &&
      answer !== null &&
      Array.isArray((answer as { files?: unknown }).files)
        ? ((answer as { files: unknown[] }).files as unknown[])
        : [];
    const counts = { enabled: 0, disabled: 0 };
    for (const file of files) {
      if (typeof file !== 'object' || file === null) continue;
      const record = file as Record<string, unknown>;
      const provider = String(record.provider ?? record.type ?? '').toLowerCase();
      if (provider !== 'devin') continue;
      if (record.disabled === true) counts.disabled += 1;
      else counts.enabled += 1;
    }
    return counts;
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

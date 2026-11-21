/**
 * The Aliases page's requests (design aliases-page.md, 3.4). Every write carries `If-Match` with the
 * `ETag` of the read it was planned from, so it lands only on the exact file it read; a 412 runs the unit
 * once more from a fresh read. The page never downloads a login file.
 */
import { apiClient } from '@/services/api/client';
import { guardConfigConnection } from '@/services/api/configValue';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import { readProviderGroups } from '@/services/api/providers';
import type { AuthFilesResponse } from '@/types/authFile';
import { isRecord } from '@/utils/helpers';
import { provimuxApi } from '@/provimux/api/provimuxApi';
import { useProvimuxPresence } from '@/provimux/presence';
import { nameKey } from './collisions';
import { readAliasState } from './rows';
import {
  blockedEntries,
  locate,
  planCommit,
  replaceChannel,
  rowsForWrite,
  sameChannel,
  unitEntry,
  withModels,
  writtenRowsOf,
} from './plan';
import type {
  AliasDraft,
  AliasState,
  CommitOutcome,
  CommitUnit,
  KeyEntry,
  LoginEntry,
  ServedNames,
  ServedRoute,
} from './types';

type Client = Pick<typeof apiClient, 'get' | 'getRaw' | 'put'>;
type Failure = CommitOutcome['failed'][number];

export const ALIAS_PATHS = {
  config: '/config',
  credentials: '/credentials',
  loginAliases: '/config/oauth/model-alias',
  family: (family: string) => `/config/api-keys/${family}`,
} as const;

/** The HTTP status an `apiClient` error carries, if any. */
const statusOf = (error: unknown): number | null =>
  isRecord(error) && typeof error.status === 'number' ? error.status : null;

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error ?? 'Unknown error');

/** The `ETag` of a raw response; null when the browser could not read the header. */
export function etagOf(headers: unknown): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const getter = (headers as { get?: (name: string) => unknown }).get;
  if (typeof getter === 'function') {
    const value = getter.call(headers, 'etag');
    if (typeof value === 'string' && value) return value;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'etag' && typeof value === 'string' && value) return value;
  }
  return null;
}

const ifMatch = (etag: string | null) => (etag ? { headers: { 'If-Match': etag } } : undefined);

export const CONFLICT_MESSAGE =
  'The configuration changed since the page loaded it; reload and try again.';
export const BLOCKED_MESSAGE =
  'Some rows would be ignored by the proxy (no name or no alias, alias equal to the name, or a ' +
  'repeated alias); fix or remove them first.';

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** One unit's read and write. Resolves with the outcome, or `'retry'` after a first 412. */
async function runUnit(
  unit: CommitUnit,
  draft: AliasDraft,
  assertConnection: () => void,
  lastAttempt: boolean
): Promise<CommitOutcome | 'retry'> {
  const read = await apiClient.getRaw(ALIAS_PATHS.config);
  assertConnection();
  const etag = etagOf(read.headers);
  const document: unknown = read.data;
  const failed: Failure[] = [];
  const written: string[] = [];
  let path: string;
  let body: unknown;

  if (unit.store === 'api-key') {
    const groups = readProviderGroups(document, unit.family);
    const located = unit.entryIds.map((entryId) => {
      const entry = unitEntry(draft, entryId) as KeyEntry;
      return { entry, index: locate(groups, entry) };
    });
    for (const { entry, index } of located) {
      if (index < 0) {
        failed.push({ entryId: entry.id, reason: 'conflict', message: CONFLICT_MESSAGE });
        continue;
      }
      const { rows, base } = rowsForWrite(draft, entry.id);
      groups[index] = withModels(groups[index], entry, rows, base);
      written.push(entry.id);
    }
    path = ALIAS_PATHS.family(unit.family);
    body = groups;
  } else {
    const oauth = isRecord(document) ? document.oauth : undefined;
    let map: Record<string, unknown> = {
      ...(isRecord(oauth) && isRecord(oauth['model-alias']) ? oauth['model-alias'] : {}),
    };
    for (const entryId of unit.entryIds) {
      const entry = unitEntry(draft, entryId) as LoginEntry;
      if (!sameChannel(map, entry)) {
        failed.push({ entryId, reason: 'conflict', message: CONFLICT_MESSAGE });
        continue;
      }
      const { rows, base } = rowsForWrite(draft, entryId);
      map = replaceChannel(map, entry, writtenRowsOf(entry, rows, base));
      written.push(entryId);
    }
    path = ALIAS_PATHS.loginAliases;
    body = map;
  }

  if (!written.length) return { done: [], failed };
  assertConnection();
  try {
    await apiClient.put(path, body, ifMatch(etag));
  } catch (error) {
    if (isAbort(error)) throw error;
    const status = statusOf(error);
    if (status === 412) {
      if (!lastAttempt) return 'retry';
      return {
        done: [],
        failed: unit.entryIds.map((entryId) => ({
          entryId,
          reason: 'conflict' as const,
          message: CONFLICT_MESSAGE,
        })),
      };
    }
    const reason = status === 400 || status === 422 ? 'invalid' : 'error';
    for (const entryId of written) failed.push({ entryId, reason, message: messageOf(error) });
    return { done: [], failed };
  }
  return { done: written, failed };
}

export const aliasesApi = {
  /** `GET /config` (document and `ETag`) and the credentials list; without the list, counts are null. */
  async load(client: Client = apiClient): Promise<AliasState> {
    const [read, files] = await Promise.all([
      client.getRaw(ALIAS_PATHS.config),
      client
        .get<AuthFilesResponse>(ALIAS_PATHS.credentials)
        .then((answer) => normalizeAuthFilesResponse(answer).files)
        .catch(() => null),
    ]);
    return { ...readAliasState(read.data, files), etag: etagOf(read.headers) };
  },

  /**
   * The units one after another (3.4): a failed unit does not stop the next; each is atomic by itself.
   * A draft with a blocking issue in a changed entry is refused whole, before any request. A change of
   * the management connection aborts (rejects with an AbortError).
   */
  async commit(draft: AliasDraft): Promise<CommitOutcome> {
    const blocked = blockedEntries(draft);
    if (blocked.length) {
      return {
        done: [],
        failed: blocked.map((entryId) => ({
          entryId,
          reason: 'invalid' as const,
          message: BLOCKED_MESSAGE,
        })),
      };
    }
    const assertConnection = guardConfigConnection();
    const outcome: CommitOutcome = { done: [], failed: [] };
    for (const unit of planCommit(draft)) {
      assertConnection();
      let result: CommitOutcome | 'retry';
      try {
        result = await runUnit(unit, draft, assertConnection, false);
        if (result === 'retry') result = await runUnit(unit, draft, assertConnection, true);
      } catch (error) {
        if (isAbort(error)) throw error;
        result = {
          done: [],
          failed: unit.entryIds.map((entryId) => ({
            entryId,
            reason: 'error' as const,
            message: messageOf(error),
          })),
        };
      }
      if (result === 'retry') continue;
      outcome.done.push(...result.done);
      outcome.failed.push(...result.failed);
    }
    return outcome;
  },
};

/** Names served natively are unknown: the verdicts cover the configuration's rows only. */
export const UNKNOWN_SERVED: ServedNames = { known: false, byName: {} };

type RoutesClient = Pick<typeof apiClient, 'get' | 'post' | 'put'>;

const distinctNames = (names: readonly string[]) => [
  ...new Set(names.map((name) => name.trim()).filter(Boolean)),
];

/**
 * 4.4: per client name (by `nameKey`), the routes that serve it now, from Provimux's
 * `/provimux/model-routes`. No names: no request. When the presence store already says the endpoint is
 * absent, no request either; that, a 404 or any failure gives `UNKNOWN_SERVED`. The names are sent as
 * written: the endpoint matches model ids exactly.
 */
export async function loadServedNames(
  names: readonly string[],
  client: RoutesClient = apiClient
): Promise<ServedNames> {
  const wanted = distinctNames(names);
  if (!wanted.length) return { known: true, byName: {} };
  if (useProvimuxPresence.getState().modelRoutes.status === 'unsupported') return UNKNOWN_SERVED;
  try {
    const answer = await provimuxApi.modelRoutes(client, wanted);
    const byName: Record<string, ServedRoute[]> = {};
    for (const model of answer.models) {
      const key = nameKey(model.id);
      if (!key) continue;
      byName[key] = [
        ...(byName[key] ?? []),
        ...model.routes.map((route): ServedRoute => ({
          authIndex: route.auth_index,
          kind: route.kind === 'oauth' ? 'oauth' : route.kind === 'apikey' ? 'apikey' : null,
          provider: route.provider,
          host: route.host,
        })),
      ];
    }
    return { known: true, byName };
  } catch {
    return UNKNOWN_SERVED;
  }
}

/** A set of names, independent of order and repetition. */
const setKey = (names: readonly string[]) => distinctNames(names).sort().join('\n');

/**
 * The page's source of served names (4.4): asked at load, after each commit (`force`), and when the
 * draft's set of client names changes. The same set is not asked twice unless forced; an answer for an
 * older request resolves to null and is to be dropped. Debouncing the asks is the page's.
 */
export function createServedNamesSource(load: (names: readonly string[]) => Promise<ServedNames>) {
  let latest = 0;
  let lastKey: string | null = null;
  let last: ServedNames | null = null;
  return {
    async ask(
      names: readonly string[],
      options: { force?: boolean } = {}
    ): Promise<ServedNames | null> {
      const key = setKey(names);
      if (!options.force && key === lastKey && last) return last;
      const ticket = ++latest;
      lastKey = key;
      last = null;
      const answer = await load(names);
      if (ticket !== latest) return null;
      last = answer;
      return answer;
    },
  };
}

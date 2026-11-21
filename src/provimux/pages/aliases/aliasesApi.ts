/**
 * The Aliases page's requests (design aliases-page.md, 3.4). The page has one read, `load()`. A save reads
 * nothing more: it writes parts of that read back, changed, each `PUT` with `If-Match`: the first with the
 * read's tag, each next one with the tag the write before it answered. The first unit not confirmed ends
 * the save; nothing is sent twice and nothing is carried. The page never downloads a login file.
 */
import axios, { type AxiosResponseTransformer } from 'axios';
import { apiClient } from '@/services/api/client';
import { guardConfigConnection } from '@/services/api/configValue';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import type { AuthFilesResponse } from '@/types/authFile';
import { isRecord } from '@/utils/helpers';
import { provimuxApi } from '@/provimux/api/provimuxApi';
import { useProvimuxPresence } from '@/provimux/presence';
import { nameKey } from './collisions';
import { readAliasState } from './rows';
import { ALIAS_PATHS, blockedEntries, planWrites } from './plan';
import type {
  AliasDraft,
  AliasState,
  CommitOutcome,
  PlannedWrite,
  SaveFailure,
  ServedNames,
  ServedRoute,
} from './types';

export { ALIAS_PATHS } from './plan';

type Client = Pick<typeof apiClient, 'get' | 'getRaw' | 'put'>;

/** The HTTP status an `apiClient` error carries, if any. */
const statusOf = (error: unknown): number | null =>
  isRecord(error) && typeof error.status === 'number' ? error.status : null;

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error ?? 'Unknown error');

/** The `ETag` of a response's headers; null when the browser could not read the header. */
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

export const BLOCKED_MESSAGE =
  'Some rows would be ignored by the proxy (no name or no alias, alias equal to the name, or a ' +
  'repeated alias); fix or remove them first.';
export const NO_TAG_MESSAGE =
  'The proxy’s answer carried no ETag, so the page cannot make the next write conditional; it wrote ' +
  'nothing further.';

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** axios's own response transforms (JSON parsing), which a request's `transformResponse` replaces. */
const defaultTransforms = (): AxiosResponseTransformer[] =>
  [axios.defaults.transformResponse ?? []].flat() as AxiosResponseTransformer[];

/** A write answered with a success other than 200: not confirmed (3.4), and it may have landed. */
export const notConfirmedMessage = (status: number | null): string =>
  `The proxy answered the write with ${status ?? 'no status'}, not 200, so it is not confirmed; ` +
  'it may have landed.';

/**
 * `PUT path` with `If-Match: tag`; resolves with the `ETag` of the 200, or null when it has none.
 * `apiClient.put` returns the body alone, so the status and the tag are read in the request's own
 * `transformResponse`, placed after axios's defaults; only a 200's headers are read. Only a 200
 * confirms: any other success (a 202, a 204) rejects with its status, which the save takes as `error`.
 * Otherwise rejects as `apiClient.put` does.
 */
export async function putWithTag(path: string, body: unknown, tag: string): Promise<string | null> {
  const answer: { status: number | null; tag: string | null } = { status: null, tag: null };
  const takeTag: AxiosResponseTransformer = function (data, headers, status) {
    answer.status = typeof status === 'number' ? status : null;
    if (status === 200) answer.tag = etagOf(headers);
    return data;
  };
  await apiClient.put(path, body, {
    headers: { 'If-Match': tag },
    transformResponse: [...defaultTransforms(), takeTag],
  });
  if (answer.status !== 200) {
    throw Object.assign(new Error(notConfirmedMessage(answer.status)), { status: answer.status });
  }
  return answer.tag;
}

const reasonOf = (error: unknown): SaveFailure => {
  const status = statusOf(error);
  if (status === 412) return 'changed';
  if (status === 400 || status === 422) return 'refused';
  return 'error';
};

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
   * 3.4. The units one after another, each body from the page's own read, each `PUT` conditional on the
   * tag of the write before (the read's for the first). The first unit not confirmed ends the save: it is
   * not sent again, and no unit after it is sent. No `GET`, no write without a tag. A draft with a blocking
   * issue in a changed entry sends nothing. A change of the management connection aborts (rejects with an
   * AbortError) before the next write.
   */
  async commit(draft: AliasDraft): Promise<CommitOutcome> {
    const writes: PlannedWrite[] = planWrites(draft);
    const confirmed: string[] = [];
    const ended = (from: number, reason: SaveFailure, message: string): CommitOutcome => ({
      confirmed,
      unconfirmed: writes.slice(from).flatMap((write) => write.unit.entryIds),
      failure: { reason, message },
    });
    if (blockedEntries(draft).length) return ended(0, 'blocked', BLOCKED_MESSAGE);
    const assertConnection = guardConfigConnection();
    let tag = draft.base.etag;
    for (const [index, write] of writes.entries()) {
      if (!tag) return ended(index, 'no-tag', NO_TAG_MESSAGE);
      assertConnection();
      try {
        tag = await putWithTag(write.path, write.body, tag);
      } catch (error) {
        if (isAbort(error)) throw error;
        return ended(index, reasonOf(error), messageOf(error));
      }
      confirmed.push(...write.unit.entryIds);
    }
    return { confirmed, unconfirmed: [], failure: null };
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

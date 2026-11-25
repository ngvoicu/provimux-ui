/**
 * `fakeProxy(document)`: the contract of design 1.1 for the save's tests (3.4, 3.6), and nothing else.
 * One document and one tag that changes with every write. `getRaw('/config')` answers both; a `put` with
 * a tag that is not the current one is a 412 and changes nothing; otherwise it replaces the node at the
 * path (stripping `auth_index` and `auth-index` from groups and keys, as the proxy does), changes the tag,
 * and hands the new `ETag` to the request's `transformResponse` as axios does (a 412 hands its transforms
 * the current tag, as the proxy's answer carries it). Every request is recorded, and every `put` without
 * `If-Match` is counted: the save's tests end by checking that count is 0. No request leaves the process.
 */
import { AxiosHeaders } from 'axios';
import { apiClient } from '@/services/api/client';
import { fixture, httpError, type Doc } from '../../helpers/aliasesStore';
import { stripFamily } from './injected';

export interface Recorded {
  method: 'GET' | 'PUT';
  path: string;
  ifMatch?: string;
  body?: unknown;
  status: number;
  /** The tag the answer carried, as handed to `transformResponse` (PUT) or in the headers (GET). */
  tag?: string | null;
}

/**
 * How the n-th `put` is answered, instead of by the contract: an error status, a request that never
 * answers, or a success other than 200 (`accepted`), after which the write has landed or not (`lands`).
 */
export type PutFault =
  | { status: 400 | 422 | 500 | 503; message?: string }
  | { reject: string }
  | { accepted: 202 | 204; lands: boolean };

/** What a 200 to `PUT path` leaves in `doc`: the node replaced, as the proxy stores it. */
export function applyBody(doc: Doc, path: string, body: unknown): Doc {
  const next = structuredClone(doc);
  const family = path.match(/^\/config\/api-keys\/([^/]+)$/)?.[1];
  if (family) {
    next['api-keys'] = {
      ...((next['api-keys'] as Doc) ?? {}),
      [family]: stripFamily(structuredClone(body)),
    };
    return next;
  }
  if (path === '/config/oauth/model-alias') {
    next.oauth = { ...((next.oauth as Doc) ?? {}), 'model-alias': structuredClone(body) };
    return next;
  }
  if (path === '/config/oauth/excluded-models') {
    next.oauth = { ...((next.oauth as Doc) ?? {}), 'excluded-models': structuredClone(body) };
    return next;
  }
  if (path === '/config/models/only-my-names') {
    next.models = { ...((next.models as Doc) ?? {}), 'only-my-names': structuredClone(body) };
    return next;
  }
  throw new Error(`fakeProxy: unexpected PUT ${path}`);
}

const original = {
  get: apiClient.get,
  getRaw: apiClient.getRaw,
  put: apiClient.put,
  revision: apiClient.getConnectionRevision,
};
/** Puts the client's methods back; each test file calls it in `afterEach`. */
export function restoreProxy() {
  apiClient.get = original.get;
  apiClient.getRaw = original.getRaw;
  apiClient.put = original.put;
  apiClient.getConnectionRevision = original.revision;
}

type Transform = (this: unknown, data: unknown, headers: AxiosHeaders, status?: number) => unknown;

/** Runs a request's response transforms as axios does: the raw text, the headers, the status. */
function transform(
  config: { transformResponse?: unknown } | undefined,
  text: string,
  tag: string | null,
  status: number
) {
  const headers = new AxiosHeaders(tag ? { etag: tag } : {});
  let data: unknown = text;
  for (const fn of [config?.transformResponse ?? []].flat() as Transform[]) {
    data = fn.call(config ?? {}, data, headers, status);
  }
  return data;
}

export function fakeProxy(document: unknown) {
  let doc = structuredClone(document) as Doc;
  let version = 1;
  const tag = () => `"t${version}"`;
  const requests: Recorded[] = [];
  const hooks = new Map<number, (() => void)[]>();
  const faults = new Map<number, PutFault>();
  let puts = 0;
  const p = {
    /** The read's answer carries a tag. */
    readTag: true,
    /** Whether the 200 of the n-th put carries a tag (from 1). */
    answerTag: (_n: number) => true,
    requests,
    /** Puts sent without If-Match. */
    unconditional: 0,
    doc: () => doc,
    tag,
    /** A writer elsewhere: edits the document and changes the tag. */
    foreign(change: (doc: Doc) => void) {
      const next = structuredClone(doc);
      change(next);
      doc = next;
      version += 1;
    },
    /** Runs `fn` when the n-th put arrives, before it is checked (n from 1). */
    beforePut(n: number, fn: () => void) {
      hooks.set(n, [...(hooks.get(n) ?? []), fn]);
    },
    /** The n-th put is answered by `fault` and changes nothing. */
    failPut(n: number, fault: PutFault) {
      faults.set(n, fault);
    },
    puts: () => requests.filter((r) => r.method === 'PUT'),
    gets: () => requests.filter((r) => r.method === 'GET'),
  };

  apiClient.getRaw = (async (path: string) => {
    if (path !== '/config') throw new Error(`fakeProxy: unexpected read ${path}`);
    const answered = p.readTag ? tag() : null;
    requests.push({ method: 'GET', path, status: 200, tag: answered });
    return {
      data: structuredClone(doc),
      headers: new AxiosHeaders(answered ? { etag: answered } : {}),
      status: 200,
    };
  }) as typeof apiClient.getRaw;

  apiClient.get = (async (path: string) => {
    requests.push({ method: 'GET', path, status: 200 });
    if (path === '/credentials') return structuredClone(fixture('credentials.json'));
    throw new Error(`fakeProxy: unexpected GET ${path}`);
  }) as typeof apiClient.get;

  apiClient.put = (async (
    path: string,
    body: unknown,
    config?: { headers?: Doc; transformResponse?: unknown }
  ) => {
    const n = ++puts;
    const ifMatch = config?.headers?.['If-Match'] as string | undefined;
    const record: Recorded = {
      method: 'PUT',
      path,
      ifMatch,
      body: structuredClone(body),
      status: 0,
    };
    requests.push(record);
    if (ifMatch === undefined) p.unconditional += 1;
    await Promise.resolve();
    for (const fn of hooks.get(n) ?? []) fn();
    const fault = faults.get(n);
    if (fault && 'reject' in fault) {
      record.status = -1;
      throw Object.assign(new Error(fault.reject), { name: 'ApiError', code: 'ECONNRESET' });
    }
    if (fault && 'accepted' in fault) {
      // A success that is not a 200, as axios resolves it: with its status, a tag only if it landed.
      if (fault.lands) {
        doc = applyBody(doc, path, body);
        version += 1;
      }
      record.status = fault.accepted;
      record.tag = fault.lands ? tag() : null;
      const text = fault.accepted === 204 ? '' : JSON.stringify({ status: 'accepted' });
      return transform(config, text, record.tag, fault.accepted);
    }
    if (fault) {
      record.status = fault.status;
      const message = fault.message ?? `status ${fault.status}`;
      transform(config, JSON.stringify({ error: 'x', message }), tag(), fault.status);
      throw httpError(fault.status, message, fault.status === 503 ? undefined : 'invalid_config');
    }
    if (ifMatch !== undefined && ifMatch !== tag()) {
      record.status = 412;
      record.tag = tag();
      transform(config, JSON.stringify({ error: 'precondition_failed' }), tag(), 412);
      throw httpError(412, 'precondition_failed', 'precondition_failed');
    }
    doc = applyBody(doc, path, body);
    version += 1;
    record.status = 200;
    record.tag = p.answerTag(n) ? tag() : null;
    return transform(
      config,
      JSON.stringify({ status: 'ok', 'config-version': 8 }),
      record.tag,
      200
    );
  }) as typeof apiClient.put;

  return p;
}

export type FakeProxy = ReturnType<typeof fakeProxy>;

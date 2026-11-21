/**
 * The Aliases tests' canned management API (ALP-03): one document behind GET /config, GET /credentials and
 * the two PUTs the page sends, with an ETag that moves on every write and If-Match checked as the proxy does.
 * No request leaves the process.
 */
import { readFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { apiClient } from '@/services/api/client';

export type Doc = Record<string, unknown>;
export const clone = <T>(value: T): T => structuredClone(value);
export const fixture = (name: string): Doc =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/aliases/${name}`, 'utf8'));

const original = {
  get: apiClient.get,
  getRaw: apiClient.getRaw,
  put: apiClient.put,
  revision: apiClient.getConnectionRevision,
};
/** Puts the client's methods back; each test file calls it in `afterEach`. */
export function restoreClient() {
  apiClient.get = original.get;
  apiClient.getRaw = original.getRaw;
  apiClient.put = original.put;
  apiClient.getConnectionRevision = original.revision;
}

export const httpError = (status: number, message: string, apiCode?: string) =>
  Object.assign(new Error(message), { name: 'ApiError', status, apiCode });

export interface Put {
  path: string;
  body: unknown;
  ifMatch: string | undefined;
}

/**
 * A canned management API over one document: GET /config (and its paths), GET /credentials,
 * PUT /config/api-keys/<family> and /config/oauth/model-alias. Every write moves the ETag; a write
 * whose If-Match is not the current ETag is a 412 and writes nothing, as the proxy does.
 */
export function server(doc: Doc) {
  const stored = clone(doc);
  let version = 1;
  const log: string[] = [];
  const puts: Put[] = [];
  const s = {
    sendEtag: true,
    /** Called before each PUT is checked: a change made elsewhere in the meantime. */
    beforePut: null as null | ((put: Put) => void),
    /** Called before each PUT is checked: throw to fail it. */
    failPut: null as null | ((put: Put) => void),
    stored: () => stored,
    log,
    puts,
    etag: () => `"v${version}"`,
    edit(change: (doc: Doc) => void) {
      change(stored);
      version += 1;
    },
  };
  const at = (path: string): unknown =>
    path
      .split('/')
      .filter(Boolean)
      .reduce<unknown>(
        (value, key) => (value && typeof value === 'object' ? (value as Doc)[key] : undefined),
        stored
      );
  apiClient.getRaw = (async (path: string) => {
    log.push(`read ${path}`);
    expect(path).toBe('/config');
    return { data: clone(stored), headers: s.sendEtag ? { etag: s.etag() } : {} };
  }) as typeof apiClient.getRaw;
  apiClient.get = (async (path: string) => {
    log.push(`get ${path}`);
    if (path === '/credentials') return clone(fixture('credentials.json'));
    if (path === '/config') return clone(stored);
    const value = at(path.replace(/^\/config/, ''));
    if (value === undefined) throw httpError(404, 'not_found', 'not_found');
    return clone(value);
  }) as typeof apiClient.get;
  apiClient.put = (async (path: string, body: unknown, config?: { headers?: Doc }) => {
    const put: Put = {
      path,
      body: clone(body),
      ifMatch: config?.headers?.['If-Match'] as string | undefined,
    };
    log.push(`put ${path} start`);
    puts.push(put);
    await Promise.resolve();
    s.beforePut?.(put);
    s.failPut?.(put);
    if (put.ifMatch !== undefined && put.ifMatch !== s.etag()) {
      log.push(`put ${path} 412`);
      throw httpError(412, 'precondition_failed', 'precondition_failed');
    }
    if (path.startsWith('/config/api-keys/')) {
      const family = path.slice('/config/api-keys/'.length);
      stored['api-keys'] = { ...((stored['api-keys'] as Doc) ?? {}), [family]: clone(body) };
    } else if (path === '/config/oauth/model-alias') {
      stored.oauth = { ...((stored.oauth as Doc) ?? {}), 'model-alias': clone(body) };
    } else {
      throw new Error(`unexpected PUT ${path}`);
    }
    version += 1;
    log.push(`put ${path} end`);
    return { status: 'ok', 'config-version': 8 };
  }) as typeof apiClient.put;
  return s;
}

export const family = (doc: Doc, name: string) => (doc['api-keys'] as Doc)[name] as Doc[];
export const loginMap = (doc: Doc) => (doc.oauth as Doc)['model-alias'] as Record<string, Doc[]>;

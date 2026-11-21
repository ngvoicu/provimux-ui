import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AxiosResponseTransformer } from 'axios';
import { parse as parseYaml } from 'yaml';
import { apiClient } from '@/services/api/client';
import { aliasesApi, etagOf } from '@/provimux/pages/aliases/aliasesApi';
import { changeRow, editsOf, startDraft } from '@/provimux/pages/aliases/draft';
import { planCommit } from '@/provimux/pages/aliases/plan';
import { ALIAS_FAMILIES, familyGroups, loginMapIn } from '@/provimux/pages/aliases/rows';
import type { AliasDraft, AliasRow, AliasState, KeyEntry } from '@/provimux/pages/aliases/types';
import type { ProviderFamily } from '@/services/api/providers';
import { same, sameFamily } from './support/injected';

/*
 * ALP live test (rebuilt in W7 for design 3.4): the page's data layer and `apiClient` against a
 * real proxy built from source. Skipped unless ALIASES_LIVE_BASE (http://127.0.0.1:<port>) and
 * ALIASES_LIVE_KEY are set. It writes only to a proxy on 127.0.0.1 whose touched families each hold an
 * `alp-live-` group, and for a login write a file whose every group is `alp-live-`. Optional:
 *   ALIASES_LIVE_FILE      the proxy's config file, read for the checks on disk (else GET /config.yaml);
 *   ALIASES_LIVE_PRISTINE  a hand-written copy put back onto ALIASES_LIVE_FILE before each L-4 round,
 *                          so every round starts from a file never written through the API;
 *   ALIASES_LIVE_REPORT    a folder for the evidence of each check (requests, answers, file before/after).
 * L-4 runs first: its first commit lands on the file as written by hand.
 */

type Doc = Record<string, unknown>;
const BASE = process.env.ALIASES_LIVE_BASE ?? '';
const KEY = process.env.ALIASES_LIVE_KEY ?? '';
const FILE = process.env.ALIASES_LIVE_FILE ?? '';
const PRISTINE = process.env.ALIASES_LIVE_PRISTINE ?? '';
const REPORT = process.env.ALIASES_LIVE_REPORT ?? '';
const live = Boolean(BASE && KEY);
const TIMEOUT = 180_000;
const TAG = /^"[0-9a-f]{64}"$/;

const original = { getRaw: apiClient.getRaw, put: apiClient.put };
let foreign: typeof apiClient;
let addedWindow = false;

interface Logged {
  method: 'GET' | 'PUT';
  path: string;
  who: 'page' | 'other';
  ifMatch?: string;
  body?: unknown;
  status: number;
  /** GET: the read's tag. PUT: the tag the answer carried, as the page's transform saw it. */
  etag?: string | null;
  answer?: unknown;
}
let requests: Logged[] = [];

const statusOf = (error: unknown) =>
  error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : 0;

/** The file as on disk: ALIASES_LIVE_FILE, else the proxy's own YAML view of it. */
async function disk(): Promise<string> {
  if (FILE) return readFileSync(FILE, 'utf8');
  return String(await foreign.get('/config.yaml', { responseType: 'text' }));
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function evidence(name: string, data: Record<string, unknown>) {
  if (!REPORT) return;
  mkdirSync(REPORT, { recursive: true });
  writeFileSync(`${REPORT}/${name}.json`, JSON.stringify({ ...data, requests }, null, 2));
}

async function readDoc(): Promise<{ doc: Doc; etag: string | null }> {
  const read = await foreign.getRaw('/config');
  const etag = etagOf(read.headers);
  requests.push({ method: 'GET', path: '/config', who: 'other', status: read.status, etag });
  return { doc: read.data as Doc, etag };
}

const groupName = (group: unknown) =>
  group && typeof group === 'object' ? (group as Doc).name : undefined;
const isLiveGroup = (group: unknown) => String(groupName(group) ?? '').startsWith('alp-live-');

/** The guard: 127.0.0.1 only; a family write needs an alp-live group; a login write an all-alp-live file. */
function assertWritable(doc: unknown, path: string) {
  if (new URL(BASE).hostname !== '127.0.0.1') throw new Error(`refusing to write to ${BASE}`);
  const family = path.match(/^\/config\/api-keys\/([^/]+)$/)?.[1];
  if (family) {
    if (!familyGroups(doc, family as ProviderFamily).some(isLiveGroup)) {
      throw new Error(`refusing to write ${path}: no alp-live- group in that family`);
    }
    return;
  }
  if (path === '/config/oauth/model-alias') {
    const groups = ALIAS_FAMILIES.flatMap((f) => familyGroups(doc, f));
    if (!groups.length || !groups.every(isLiveGroup)) {
      throw new Error('refusing to write the login map of a file that is not all alp-live-');
    }
    return;
  }
  throw new Error(`refusing to write ${path}`);
}

/** Another client: read, change, write without If-Match. */
async function otherWrite(path: string, change: (doc: Doc) => unknown) {
  const { doc } = await readDoc();
  assertWritable(doc, path);
  const body = change(doc);
  try {
    const answer = await foreign.put(path, body);
    requests.push({ method: 'PUT', path, who: 'other', body, status: 200, answer });
  } catch (error) {
    requests.push({ method: 'PUT', path, who: 'other', body, status: statusOf(error) });
    throw error;
  }
}

/** A change elsewhere in the file: a counter in the display name of a Vertex row. */
let counter = 0;
const foreignVertexEdit = () =>
  otherWrite('/config/api-keys/vertex', (doc) => {
    const groups = structuredClone(familyGroups(doc, 'vertex')) as Doc[];
    const key = (groups.find(isLiveGroup)?.keys as Doc[])[0];
    const models = key.models as Doc[];
    models[0] = { ...models[0], 'display-name': `other-client-${Date.now()}-${++counter}` };
    return groups;
  });

interface Hooks {
  /** After the n-th page put has answered (200 or not), before commit goes on; `n` counts from 1. */
  afterPut?: (n: number) => Promise<void> | void;
}
let pageReads: Doc[] = [];
let pagePuts: Logged[] = [];

/** The page's own client, logged and guarded; a hook for the foreign writes. */
function watch(hooks: Hooks = {}) {
  pageReads = [];
  pagePuts = [];
  apiClient.getRaw = (async (...args: Parameters<typeof apiClient.getRaw>) => {
    const read = await original.getRaw.apply(apiClient, args);
    requests.push({
      method: 'GET',
      path: args[0],
      who: 'page',
      status: read.status,
      etag: etagOf(read.headers),
    });
    if (args[0] === '/config') pageReads.push(structuredClone(read.data as Doc));
    return read;
  }) as typeof apiClient.getRaw;
  apiClient.put = (async (...args: Parameters<typeof apiClient.put>) => {
    const [path, body, config] = args;
    assertWritable(pageReads.at(-1), path);
    const entry: Logged = {
      method: 'PUT',
      path,
      who: 'page',
      ifMatch: (config?.headers as Doc | undefined)?.['If-Match'] as string | undefined,
      body: structuredClone(body),
      status: 0,
      etag: null,
    };
    requests.push(entry);
    pagePuts.push(entry);
    const n = pagePuts.length;
    // Records the tag the answer carried, after the page's own transforms (which read it).
    const record: AxiosResponseTransformer = function (data, headers) {
      entry.etag = etagOf(headers);
      return data;
    };
    const transforms = [config?.transformResponse ?? []].flat() as AxiosResponseTransformer[];
    try {
      const answer = await original.put.call(apiClient, path, body, {
        ...config,
        transformResponse: [...transforms, record],
      });
      entry.status = 200;
      entry.answer = answer;
      return answer;
    } catch (error) {
      entry.status = statusOf(error);
      entry.answer = (error as { data?: unknown }).data;
      throw error;
    } finally {
      await hooks.afterPut?.(n);
    }
  }) as typeof apiClient.put;
}

function unwatch() {
  apiClient.getRaw = original.getRaw;
  apiClient.put = original.put;
}

const keyEntry = (state: AliasState, family: ProviderFamily, pick: (e: KeyEntry) => boolean) => {
  const entry = state.entries.find(
    (e): e is KeyEntry => e.store === 'api-key' && e.family === family && pick(e)
  );
  if (!entry) throw new Error(`no ${family} entry`);
  return entry;
};
const firstLiveKey = (state: AliasState, family: ProviderFamily) =>
  keyEntry(
    state,
    family,
    (e) => String(e.groupName).startsWith('alp-live-') && (e.keyIndex ?? 0) === 0
  );
const rowOf = (state: AliasState, entryId: string, upstream: string): AliasRow => {
  const row = state.rows.find((r) => r.entryId === entryId && r.upstream === upstream);
  if (!row) throw new Error(`no row ${upstream} in ${entryId}`);
  return row;
};
const loginRowOf = (state: AliasState, channel: string, upstream: string) =>
  rowOf(state, `login/${channel}`, upstream);

/** The page's puts: each carried the tag the one before answered (the first, the read's). */
function expectChained(readTag: string | null) {
  const tags = [readTag, ...pagePuts.map((p) => p.etag)];
  expect(pagePuts.map((p) => p.ifMatch)).toEqual(tags.slice(0, pagePuts.length) as string[]);
  for (const put of pagePuts) expect(put.ifMatch ?? '').toMatch(TAG);
}

beforeAll(() => {
  if (!live) return;
  if (new URL(BASE).hostname !== '127.0.0.1')
    throw new Error(`ALIASES_LIVE_BASE must be 127.0.0.1: ${BASE}`);
  // apiClient announces the server's version on `window`; bun has none.
  if (typeof globalThis.window === 'undefined') {
    (globalThis as { window?: unknown }).window = new EventTarget();
    addedWindow = true;
  }
  apiClient.setConfig({ apiBase: BASE, managementKey: KEY });
  foreign = apiClient.captureConnection();
});

afterEach(() => {
  unwatch();
  requests = [];
});

afterAll(() => {
  if (addedWindow) delete (globalThis as { window?: unknown }).window;
});

describe.skipIf(!live)('ALP live, against a proxy built from source', () => {
  test(
    'L-4 two families and a login channel from the never-written file, 20 times: all confirmed, no GET between the units',
    async () => {
      const rounds: unknown[] = [];
      const firstDisk = await disk();
      for (let round = 1; round <= 20; round += 1) {
        if (PRISTINE && FILE && round > 1) writeFileSync(FILE, readFileSync(PRISTINE));
        const before = await disk();
        watch();
        const state = await aliasesApi.load();
        const loadDoc = pageReads[0];
        const claude = firstLiveKey(state, 'claude');
        const oai = firstLiveKey(state, 'openai-compatibility');
        let draft: AliasDraft = startDraft(state);
        draft = changeRow(draft, rowOf(state, claude.id, 'claude-opus-x').id, {
          alias: `opus-l4-${round}`,
        });
        draft = changeRow(draft, rowOf(state, oai.id, 'vendor/model-one').id, {
          alias: `one-l4-${round}`,
        });
        draft = changeRow(draft, loginRowOf(state, 'codex', 'gpt-y').id, {
          alias: `gy-l4-${round}`,
        });
        expect(planCommit(draft).map((u) => (u.store === 'api-key' ? u.family : 'login'))).toEqual([
          'claude',
          'openai-compatibility',
          'login',
        ]);
        const readsBefore = requests.filter((r) => r.who === 'page' && r.method === 'GET').length;
        const outcome = await aliasesApi.commit(draft);
        const readsDuring =
          requests.filter((r) => r.who === 'page' && r.method === 'GET').length - readsBefore;
        const after = await readDoc();
        rounds.push({
          round,
          neverWritten: round === 1 ? before === firstDisk : Boolean(PRISTINE && FILE),
          loadEtag: state.etag,
          outcome,
          readsDuring,
          puts: pagePuts.map((p) => ({
            path: p.path,
            status: p.status,
            ifMatch: p.ifMatch,
            answered: p.etag,
          })),
          getAfter: after.etag,
        });
        if (outcome.failure) {
          evidence(`L-4-round-${round}-failed`, { before, after: await disk(), outcome });
        }
        expect(outcome).toEqual({
          confirmed: [claude.id, oai.id, 'login/codex'],
          unconfirmed: [],
          failure: null,
        });
        expect(readsDuring).toBe(0);
        expect(pagePuts.map((p) => p.status)).toEqual([200, 200, 200]);
        expectChained(state.etag);
        // What the commit did not touch reads back as loaded (L-5 on the first write of the file).
        for (const family of ['gemini', 'vertex'] as const) {
          expect(sameFamily(familyGroups(after.doc, family), familyGroups(loadDoc, family))).toBe(
            true
          );
        }
        const map = loginMapIn(after.doc) as Doc;
        expect(same(map.claude, (loginMapIn(loadDoc) as Doc).claude)).toBe(true);
        expect((map.codex as Doc[])[1].alias).toBe(`gy-l4-${round}`);
        // L-7 in passing: the GET after the commit carries the last write's tag.
        expect(after.etag).toBe(pagePuts[2].etag ?? '');
        unwatch();
      }
      evidence('L-4', { rounds });
    },
    TIMEOUT
  );

  test(
    'L-1 load gives a tag, and a commit with it lands',
    async () => {
      const before = await disk();
      watch();
      const state = await aliasesApi.load();
      expect(state.etag).toMatch(TAG);
      if (FILE) expect(state.etag).toBe(`"${sha256(before)}"`);
      const claude = firstLiveKey(state, 'claude');
      const alias = `sonnet-l1-${Date.now()}`;
      const draft = changeRow(startDraft(state), rowOf(state, claude.id, 'claude-sonnet-x').id, {
        alias,
      });
      const outcome = await aliasesApi.commit(draft);
      const fresh = await aliasesApi.load();
      const after = await disk();
      evidence('L-1', { loadEtag: state.etag, outcome, before, after });
      expect(outcome).toEqual({ confirmed: [claude.id], unconfirmed: [], failure: null });
      // The tag went through axios and apiClient unchanged: the PUT carried the read's tag, quotes and all.
      expect(pagePuts).toHaveLength(1);
      expect(pagePuts[0].ifMatch).toBe(state.etag ?? '');
      expect(pagePuts[0].status).toBe(200);
      expect(rowOf(fresh, firstLiveKey(fresh, 'claude').id, 'claude-sonnet-x').alias).toBe(alias);
      expect(fresh.etag).toMatch(TAG);
      expect(fresh.etag).not.toBe(state.etag);
      if (FILE) expect(fresh.etag).toBe(`"${sha256(after)}"`);
    },
    TIMEOUT
  );

  test(
    'L-2 a foreign write between the page’s read and its save: changed, nothing of the page in the file',
    async () => {
      watch();
      const state = await aliasesApi.load();
      const claude = firstLiveKey(state, 'claude');
      const alias = `sonnet-l2-never-${Date.now()}`;
      const draft = changeRow(startDraft(state), rowOf(state, claude.id, 'claude-sonnet-x').id, {
        alias,
      });
      await foreignVertexEdit();
      const before = await disk();
      const outcome = await aliasesApi.commit(draft);
      const after = await disk();
      evidence('L-2-before-save', { outcome, before, after });
      expect(outcome).toEqual({
        confirmed: [],
        unconfirmed: [claude.id],
        failure: { reason: 'changed', message: expect.any(String) as unknown as string },
      });
      expect(pagePuts.map((p) => [p.status, p.ifMatch])).toEqual([[412, state.etag]]);
      expect((pagePuts[0].answer as Doc).error).toBe('precondition_failed');
      // The file is exactly the other client's: not a byte of the page's.
      expect(after).toBe(before);
      expect(after).not.toContain(alias);
    },
    TIMEOUT
  );

  test(
    'L-2 a foreign write between the first and the second unit: the first unit in the file, nothing of the others',
    async () => {
      watch({ afterPut: (n) => (n === 1 ? foreignVertexEdit() : undefined) });
      const state = await aliasesApi.load();
      const claude = firstLiveKey(state, 'claude');
      const oai = firstLiveKey(state, 'openai-compatibility');
      const first = `sonnet-l2-first-${Date.now()}`;
      const second = `two-l2-second-${Date.now()}`;
      let draft = changeRow(startDraft(state), rowOf(state, claude.id, 'claude-sonnet-x').id, {
        alias: first,
      });
      draft = changeRow(draft, rowOf(state, oai.id, 'vendor/model-two').id, { alias: second });
      const outcome = await aliasesApi.commit(draft);
      const after = await disk();
      const read = await readDoc();
      evidence('L-2-between-units', { outcome, after });
      expect(outcome).toEqual({
        confirmed: [claude.id],
        unconfirmed: [oai.id],
        failure: { reason: 'changed', message: expect.any(String) as unknown as string },
      });
      expect(pagePuts.map((p) => p.status)).toEqual([200, 412]);
      expectChained(state.etag);
      expect(after).toContain(first);
      expect(after).not.toContain(second);
      // The other client's write is there too, and the OpenAI-compatible family is as loaded.
      const vertex = ((familyGroups(read.doc, 'vertex')[0] as Doc).keys as Doc[])[0]
        .models as Doc[];
      expect(String(vertex[0]['display-name'])).toStartWith('other-client-');
      expect(
        sameFamily(
          familyGroups(read.doc, 'openai-compatibility'),
          familyGroups(pageReads[0], 'openai-compatibility')
        )
      ).toBe(true);
    },
    TIMEOUT
  );

  test(
    'L-3 a row inserted at the head elsewhere: changed, the edit listed, the file’s list is the other’s',
    async () => {
      // Two rows of one key, a -> fast and b -> slow, as another client would set them.
      await otherWrite('/config/api-keys/gemini', (doc) => {
        const groups = structuredClone(familyGroups(doc, 'gemini')) as Doc[];
        const key = (groups.find(isLiveGroup)?.keys as Doc[])[0];
        key.models = [
          { name: 'a', alias: 'fast' },
          { name: 'b', alias: 'slow' },
        ];
        return groups;
      });
      watch();
      const state = await aliasesApi.load();
      const gemini = firstLiveKey(state, 'gemini');
      const draft = changeRow(startDraft(state), rowOf(state, gemini.id, 'a').id, {
        alias: 'fast2',
      });
      const theirs = [
        { name: 'h', alias: 'head' },
        { name: 'a', alias: 'fast' },
        { name: 'b', alias: 'slow' },
      ];
      await otherWrite('/config/api-keys/gemini', (doc) => {
        const groups = structuredClone(familyGroups(doc, 'gemini')) as Doc[];
        const key = (groups.find(isLiveGroup)?.keys as Doc[])[0];
        key.models = theirs;
        return groups;
      });
      const before = await disk();
      const outcome = await aliasesApi.commit(draft);
      const lost = outcome.unconfirmed.map((id) => ({ id, edits: editsOf(draft, id) }));
      // After the save the page reads again and shows the file as it is, with no edit on it.
      const next = startDraft(await aliasesApi.load());
      const after = await readDoc();
      evidence('L-3', { outcome, lost, before, after: await disk() });
      expect(outcome).toEqual({
        confirmed: [],
        unconfirmed: [gemini.id],
        failure: { reason: 'changed', message: expect.any(String) as unknown as string },
      });
      expect(pagePuts.map((p) => p.status)).toEqual([412]);
      expect(lost).toHaveLength(1);
      expect(lost[0].edits).toHaveLength(1);
      const edit = lost[0].edits[0];
      expect(edit.kind).toBe('changed');
      expect([edit.before?.upstream, edit.before?.alias]).toEqual(['a', 'fast']);
      expect([edit.after?.upstream, edit.after?.alias]).toEqual(['a', 'fast2']);
      expect(planCommit(next)).toEqual([]);
      expect(next.rows.some((r) => r.alias === 'fast2')).toBe(false);
      expect(await disk()).toBe(before);
      const key = ((familyGroups(after.doc, 'gemini').find(isLiveGroup) as Doc).keys as Doc[])[0];
      expect(same(key.models, theirs)).toBe(true);
    },
    TIMEOUT
  );

  test(
    'L-5 a commit in one family: every other family and channel reads back as loaded',
    async () => {
      const before = await disk();
      watch();
      const state = await aliasesApi.load();
      const loadDoc = pageReads[0];
      const oai = firstLiveKey(state, 'openai-compatibility');
      const draft = changeRow(startDraft(state), rowOf(state, oai.id, 'vendor/model-two').id, {
        alias: `two-l5-${Date.now()}`,
      });
      const outcome = await aliasesApi.commit(draft);
      const after = await readDoc();
      evidence('L-5', { outcome, before, after: await disk() });
      expect(outcome).toEqual({ confirmed: [oai.id], unconfirmed: [], failure: null });
      for (const family of ALIAS_FAMILIES) {
        if (family === 'openai-compatibility') continue;
        expect([
          family,
          sameFamily(familyGroups(after.doc, family), familyGroups(loadDoc, family)),
        ]).toEqual([family, true]);
      }
      const freshMap = loginMapIn(after.doc) as Doc;
      const loadMap = loginMapIn(loadDoc) as Doc;
      expect(Object.keys(freshMap).sort()).toEqual(Object.keys(loadMap).sort());
      for (const channel of Object.keys(loadMap)) {
        expect([channel, same(freshMap[channel], loadMap[channel])]).toEqual([channel, true]);
      }
      // The written family is the PUT body, the injected index on groups and keys aside.
      expect(pagePuts).toHaveLength(1);
      expect(sameFamily(familyGroups(after.doc, 'openai-compatibility'), pagePuts[0].body)).toBe(
        true
      );
      // And the rest of the document (every family is compared above) did not move either.
      const rest = (doc: Doc) => ({
        ...doc,
        'api-keys': Object.keys(doc['api-keys'] as Doc).sort(),
      });
      expect(same(rest(after.doc), rest(loadDoc))).toBe(true);
    },
    TIMEOUT
  );

  test(
    'L-6 the file on disk has no auth_index, while a read carries it',
    async () => {
      const text = await disk();
      const { doc } = await readDoc();
      const injected = JSON.stringify(doc).match(/"auth_index"/g)?.length ?? 0;
      console.log(`[alp-live] L-6 auth_index in GET /config: ${injected}; on disk: 0 expected`);
      evidence('L-6', { injected, disk: text });
      expect(injected).toBeGreaterThan(0);
      expect(text).not.toContain('auth_index');
      expect(text).not.toContain('auth-index');
      expect(JSON.stringify(parseYaml(text))).not.toContain('auth_index');
    },
    TIMEOUT
  );

  test(
    'L-7 the tag of a GET after a commit is the tag its last write answered, and still is three seconds later',
    async () => {
      watch();
      const state = await aliasesApi.load();
      const claude = firstLiveKey(state, 'claude');
      let draft = changeRow(startDraft(state), rowOf(state, claude.id, 'claude-haiku-x').id, {
        alias: `haiku-l7-${Date.now()}`,
      });
      draft = changeRow(draft, loginRowOf(state, 'claude', 'claude-opus-x').id, {
        alias: `login-opus-l7-${Date.now()}`,
      });
      const outcome = await aliasesApi.commit(draft);
      const now = await readDoc();
      await Bun.sleep(3_000);
      const later = await readDoc();
      const onDisk = await disk();
      evidence('L-7', {
        outcome,
        answered: pagePuts.map((p) => p.etag),
        getNow: now.etag,
        getLater: later.etag,
        diskSha: FILE ? `"${sha256(onDisk)}"` : null,
      });
      expect(outcome.failure).toBeNull();
      expect(pagePuts).toHaveLength(2);
      expectChained(state.etag);
      const last = pagePuts[1].etag;
      expect(last ?? '').toMatch(TAG);
      expect(now.etag).toBe(last);
      expect(later.etag).toBe(last);
      if (FILE) expect(`"${sha256(onDisk)}"`).toBe(last ?? '');
    },
    TIMEOUT
  );
});

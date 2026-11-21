import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { apiClient } from '@/services/api/client';
import { aliasesApi } from '@/provimux/pages/aliases/aliasesApi';
import { changeRow, startDraft } from '@/provimux/pages/aliases/draft';
import { planCommit, sameConfig } from '@/provimux/pages/aliases/plan';
import { rebase } from '@/provimux/pages/aliases/rebase';
import {
  ALIAS_FAMILIES,
  familyGroups,
  loginMapIn,
  readAliasState,
} from '@/provimux/pages/aliases/rows';
import type { AliasDraft, AliasRow, AliasState, KeyEntry } from '@/provimux/pages/aliases/types';
import type { ProviderFamily } from '@/services/api/providers';

/*
 * ALP live test (T-265): the page's data layer and `apiClient` against a real proxy built from source.
 * Skipped unless ALIASES_LIVE_BASE (http://127.0.0.1:<port>) and ALIASES_LIVE_KEY are set. It writes only
 * to a proxy on 127.0.0.1 whose touched families each hold an `alp-live-` group, and for a login write a
 * file whose every group is `alp-live-`. Optional:
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
  etag?: string | null;
  answer?: unknown;
}
let requests: Logged[] = [];

const statusOf = (error: unknown) =>
  error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : 0;
const etagIn = (headers: unknown): string | null => {
  const value = (headers as { get?: (n: string) => unknown } | undefined)?.get?.('etag');
  return typeof value === 'string' ? value : null;
};

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
  requests.push({
    method: 'GET',
    path: '/config',
    who: 'other',
    status: read.status,
    etag: etagIn(read.headers),
  });
  return { doc: read.data as Doc, etag: etagIn(read.headers) };
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
  /** After each page read of /config, before it is returned; `n` counts from 1. */
  afterRead?: (n: number, data: Doc) => Promise<void> | void;
}
let pageReads: Doc[] = [];
let pagePuts: Logged[] = [];

/** The page's own client, logged and guarded; hooks for the foreign writes. */
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
      etag: etagIn(read.headers),
    });
    if (args[0] === '/config') {
      pageReads.push(structuredClone(read.data as Doc));
      await hooks.afterRead?.(pageReads.length, read.data as Doc);
    }
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
    };
    requests.push(entry);
    pagePuts.push(entry);
    try {
      const answer = await original.put.apply(apiClient, args);
      entry.status = 200;
      entry.answer = answer;
      return answer;
    } catch (error) {
      entry.status = statusOf(error);
      entry.answer = (error as { data?: unknown }).data;
      throw error;
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

/** The index of every entry, by id, of one read. */
const indexesOf = (doc: unknown) =>
  Object.fromEntries(
    readAliasState(doc, null)
      .entries.filter((e): e is KeyEntry => e.store === 'api-key')
      .map((e) => [e.id, e.authIndexes.join(',')])
  );

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
    'L-4 two families and a login channel from the never-written file, 20 times: all done',
    async () => {
      const rounds: unknown[] = [];
      const differed: unknown[] = [];
      const firstDisk = await disk();
      for (let round = 1; round <= 20; round += 1) {
        if (PRISTINE && FILE && round > 1) writeFileSync(FILE, readFileSync(PRISTINE));
        const before = await disk();
        watch();
        const state = await aliasesApi.load();
        const loadDoc = pageReads[0];
        const loadIndexes = indexesOf(loadDoc);
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
        const outcome = await aliasesApi.commit(draft);
        const unitReads = pageReads.slice(1);
        for (const [n, read] of unitReads.entries()) {
          const now = indexesOf(read);
          for (const [id, index] of Object.entries(loadIndexes)) {
            if (now[id] !== index)
              differed.push({ round, unitRead: n + 1, id, load: index, read: now[id] });
          }
        }
        const after = await readDoc();
        rounds.push({
          round,
          neverWritten: round === 1 ? before === firstDisk : Boolean(PRISTINE && FILE),
          etag: state.etag,
          outcome,
          puts: pagePuts.map((p) => ({ path: p.path, status: p.status, ifMatch: p.ifMatch })),
        });
        if (outcome.failed.length)
          evidence(`L-4-round-${round}-failed`, { before, after: await disk(), outcome });
        expect(outcome.failed).toEqual([]);
        expect(outcome.done.sort()).toEqual([claude.id, oai.id, 'login/codex'].sort());
        expect(pagePuts.every((p) => p.status === 200 && p.ifMatch && TAG.test(p.ifMatch))).toBe(
          true
        );
        // What the commit did not touch reads back as loaded (L-5 on the first write of the file).
        for (const family of ['gemini', 'vertex'] as const) {
          expect(sameConfig(familyGroups(after.doc, family), familyGroups(loadDoc, family))).toBe(
            true
          );
        }
        const map = loginMapIn(after.doc) as Doc;
        expect(sameConfig(map.claude, (loginMapIn(loadDoc) as Doc).claude)).toBe(true);
        expect((map.codex as Doc[])[1].alias).toBe(`gy-l4-${round}`);
        unwatch();
      }
      console.log(
        `[alp-live] L-4 auth_index differences between load and unit read: ${differed.length}`
      );
      if (differed.length) console.log(JSON.stringify(differed, null, 2));
      evidence('L-4', { rounds, authIndexDifferences: differed });
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
      evidence('L-1', { loadEtag: state.etag, outcome, before, after: await disk() });
      expect(outcome).toEqual({ done: [claude.id], failed: [] });
      // The tag went through axios and apiClient unchanged: the PUT carried the read's tag, quotes and all.
      expect(pagePuts).toHaveLength(1);
      expect(pagePuts[0].ifMatch).toBe(state.etag ?? '');
      expect(pagePuts[0].status).toBe(200);
      expect(rowOf(fresh, firstLiveKey(fresh, 'claude').id, 'claude-sonnet-x').alias).toBe(alias);
      expect(fresh.etag).toMatch(TAG);
      expect(fresh.etag).not.toBe(state.etag);
    },
    TIMEOUT
  );

  test(
    'L-2 a foreign write after the unit read: 412, the unit runs again and lands',
    async () => {
      const before = await disk();
      // Read 1 is load(); read 2 is the unit's read: the other client writes right after it.
      watch({ afterRead: (n) => (n === 2 ? foreignVertexEdit() : undefined) });
      const state = await aliasesApi.load();
      const claude = firstLiveKey(state, 'claude');
      const alias = `sonnet-l2-${Date.now()}`;
      const draft = changeRow(startDraft(state), rowOf(state, claude.id, 'claude-sonnet-x').id, {
        alias,
      });
      const outcome = await aliasesApi.commit(draft);
      const after = await readDoc();
      evidence('L-2-retry', { outcome, before, after: await disk() });
      expect(pagePuts.map((p) => p.status)).toEqual([412, 200]);
      expect((pagePuts[0].answer as Doc).error).toBe('precondition_failed');
      expect(pagePuts[0].ifMatch).not.toBe(pagePuts[1].ifMatch);
      expect(outcome).toEqual({ done: [claude.id], failed: [] });
      const freshState = readAliasState(after.doc, null);
      expect(
        rowOf(freshState, firstLiveKey(freshState, 'claude').id, 'claude-sonnet-x').alias
      ).toBe(alias);
      // The other client's write is still there.
      const vertexName = ((familyGroups(after.doc, 'vertex')[0] as Doc).keys as Doc[])[0]
        .models as Doc[];
      expect(String(vertexName[0]['display-name'])).toStartWith('other-client-');
    },
    TIMEOUT
  );

  test(
    'L-2 a foreign write after every read: conflict, and nothing of the page in the file',
    async () => {
      const before = await disk();
      watch({ afterRead: (n) => (n >= 2 ? foreignVertexEdit() : undefined) });
      const state = await aliasesApi.load();
      const claude = firstLiveKey(state, 'claude');
      const alias = `sonnet-l2-never-${Date.now()}`;
      const draft = changeRow(startDraft(state), rowOf(state, claude.id, 'claude-sonnet-x').id, {
        alias,
      });
      const outcome = await aliasesApi.commit(draft);
      const after = await disk();
      evidence('L-2-conflict', { outcome, before, after });
      expect(pagePuts.map((p) => p.status)).toEqual([412, 412]);
      expect(outcome.done).toEqual([]);
      expect(outcome.failed.map((f) => [f.entryId, f.reason])).toEqual([[claude.id, 'conflict']]);
      expect(after).not.toContain(alias);
      expect(before).not.toContain(alias);
    },
    TIMEOUT
  );

  test(
    'L-3 a row inserted at the head elsewhere: conflict, rebase, second save; the file is the other’s',
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
      const before = await disk();
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
      const first = await aliasesApi.commit(draft);
      const fresh = await aliasesApi.load();
      const rebased = rebase(draft, fresh, first.done);
      const second = await aliasesApi.commit(rebased.draft);
      const after = await readDoc();
      evidence('L-3', { first, lost: rebased.lost, second, before, after: await disk() });
      expect(first.done).toEqual([]);
      expect(first.failed.map((f) => [f.entryId, f.reason])).toEqual([[gemini.id, 'conflict']]);
      expect(rebased.lost).toHaveLength(1);
      expect(rebased.lost[0].entry.id).toBe(gemini.id);
      expect(rebased.lost[0].edits).toHaveLength(1);
      const edit = rebased.lost[0].edits[0];
      expect(edit.kind).toBe('changed');
      expect([edit.before?.upstream, edit.before?.alias]).toEqual(['a', 'fast']);
      expect([edit.after?.upstream, edit.after?.alias]).toEqual(['a', 'fast2']);
      expect(planCommit(rebased.draft)).toEqual([]);
      expect(second).toEqual({ done: [], failed: [] });
      // No PUT of the page reached the proxy at all: the conflict was found by locate, the second save is empty.
      expect(pagePuts).toEqual([]);
      const key = ((familyGroups(after.doc, 'gemini').find(isLiveGroup) as Doc).keys as Doc[])[0];
      expect(sameConfig(key.models, theirs)).toBe(true);
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
      expect(outcome).toEqual({ done: [oai.id], failed: [] });
      for (const family of ALIAS_FAMILIES) {
        if (family === 'openai-compatibility') continue;
        expect([
          family,
          sameConfig(familyGroups(after.doc, family), familyGroups(loadDoc, family)),
        ]).toEqual([family, true]);
      }
      const freshMap = loginMapIn(after.doc) as Doc;
      const loadMap = loginMapIn(loadDoc) as Doc;
      expect(Object.keys(freshMap).sort()).toEqual(Object.keys(loadMap).sort());
      for (const channel of Object.keys(loadMap)) {
        expect([channel, sameConfig(freshMap[channel], loadMap[channel])]).toEqual([channel, true]);
      }
      // The written family is the PUT body, the injected auth_index aside.
      expect(pagePuts).toHaveLength(1);
      expect(sameConfig(familyGroups(after.doc, 'openai-compatibility'), pagePuts[0].body)).toBe(
        true
      );
      // And the rest of the document did not move either.
      const rest = (doc: Doc) => ({
        ...doc,
        'api-keys': { ...(doc['api-keys'] as Doc), 'openai-compatibility': null },
      });
      expect(sameConfig(rest(after.doc), rest(loadDoc))).toBe(true);
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
});

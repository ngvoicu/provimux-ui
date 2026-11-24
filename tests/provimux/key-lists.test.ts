/**
 * Self-refreshing key lists in the console (Provimux design key-model-lists.md 7.2): the `keys` rows of Model
 * lists read in one place, each key's list state, the models a key learned by itself, where a learned model is
 * also served by a subscription, the fixed-list switch and an OpenAI-compatible entry's own exclusions, and an
 * older server without any of it. Every request goes to a stand-in for the proxy in this process, with made-up
 * data (example.com, fixture keys); no request leaves it.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { apiClient } from '@/services/api/client';
import { readModelLists, readModelRoutes } from '@/provimux/api/normalize';
import type {
  ProvimuxModelListKeyRow,
  ProvimuxModelListsResponse,
  ProvimuxModelRoutesResponse,
} from '@/provimux/api/types';
import { provimuxDashboardTo } from '@/provimux/dashboard';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import { startDraft } from '@/provimux/pages/aliases/draft';
import type { KeyEntry } from '@/provimux/pages/aliases/types';
import {
  AccountsWriteError,
  ListSettingsWriteError,
  accountsApi,
} from '@/provimux/pages/accounts/accountsApi';
import { KeyListStatus } from '@/provimux/pages/accounts/KeyListStatus';
import { failureReason } from '@/provimux/pages/accounts/keyListWords';
import { KeySettingsFields } from '@/provimux/pages/accounts/KeySettingsFields';
import {
  familyAsked,
  familyWithListSettings,
  groupWithListSettings,
  listSettingsIn,
} from '@/provimux/pages/accounts/keyListSettings';
import { saveKeySettingsDraft } from '@/provimux/pages/accounts/keySave';
import {
  draftChanged,
  draftOf,
  formChanged,
  listsChanged,
  locateKey,
  newNativeDraft,
  settingsTouched,
  storedListTarget,
  summaryOf,
  withLists,
  withTyped,
  withValue,
  type CompatibleDraft,
  type KeyDraft,
  type NativeDraft,
} from '@/provimux/pages/accounts/keySettings';
import { KeyWriteError } from '@/provimux/pages/accounts/keyWrites';
import { modelsAddressOf } from '@/provimux/pages/accounts/links';
import { writeErrorMessage } from '@/provimux/pages/accounts/writeErrors';
import { readExclusions } from '@/provimux/pages/excluded/exclusions';
import {
  keyListState,
  keyListsSupported,
  keyOverlaps,
  keyRowsByIndex,
  keyRowsOf,
  learnedNames,
  overlapOrder,
  paysPerToken,
  priorityBelow,
} from '@/provimux/pages/keyLists/keyLists';
import {
  buildNames,
  initialModelsFilter,
  matches,
  summarizeNames,
  type NameItem,
} from '@/provimux/pages/models/catalog';
import { NameCard } from '@/provimux/pages/models/NameCard';
import { draftEntries } from '@/provimux/pages/aliases/draft';
import { accountsAddressOfKeyLists } from '@/provimux/pages/shared/accountsLink';

type Doc = Record<string, unknown>;

const read = (path: string) => readFileSync(path, 'utf8');
const json = (path: string) => JSON.parse(read(path));
/** Provimux's own examples of the contract (pui13/examples), as they are. */
const KEYS_EXAMPLE = () => json('tests/provimux/fixtures/model-lists-keys.json');
const KEY_EXAMPLE = () => json('tests/provimux/fixtures/model-lists-key.json');
const NOW = Date.parse('2026-11-24T18:04:11Z');

/** A configuration with a key of each kind this feature touches. */
const config = (): Doc => ({
  'config-version': 8,
  'api-keys': {
    claude: [
      {
        name: 'anthropic',
        'fixed-models': true,
        models: [{ name: 'claude-opus-5-5' }],
        keys: [{ 'api-key': 'fixture-anthropic-key-0000a1b2', auth_index: 'a90c3e1f04d2b7e5' }],
      },
    ],
    codex: [
      {
        name: 'openai',
        'base-url': 'https://api.openai.com/v1',
        models: [{ name: 'gpt-4.1' }],
        keys: [
          { 'api-key': 'fixture-openai-key-00000c3d4', auth_index: 'ak-openai-1' },
          {
            'api-key': 'fixture-openai-key-00000e5f6',
            auth_index: 'ak-openai-2',
            'fixed-models': false,
          },
          { 'api-key': 'fixture-openai-key-00000a7b8', auth_index: 'ak-openai-3' },
        ],
      },
    ],
    vertex: [
      { name: 'vertex', keys: [{ 'api-key': 'fixture-vertex-key-0000c1d2', auth_index: 'ak-vx' }] },
    ],
    'openai-compatibility': [
      {
        name: 'openrouter',
        'base-url': 'https://openrouter.ai/api/v1',
        'excluded-models': ['text-embedding-*'],
        keys: [{ 'api-key': 'fixture-openrouter-key-00g7h8', auth_index: 'c41d9a07b2e8f113' }],
        models: [
          { name: 'anthropic/claude-opus-5.5', alias: 'or-opus' },
          { name: 'acme/retired-model', alias: 'old' },
        ],
      },
    ],
  },
  oauth: { 'model-alias': {}, 'excluded-models': {} },
});

const entryOf = (doc: unknown, family: string, keyIndex: number | null): KeyEntry =>
  readAliasState(doc, null).entries.find(
    (entry): entry is KeyEntry =>
      entry.store === 'api-key' && entry.family === family && entry.keyIndex === keyIndex
  )!;

// --- a stand-in for the proxy's configuration: one document, one tag, If-Match enforced -------------------
const original = {
  get: apiClient.get,
  getRaw: apiClient.getRaw,
  put: apiClient.put,
  captureConnection: apiClient.captureConnection,
};
afterEach(() => Object.assign(apiClient, original));

/**
 * `older`: a Provimux before key lists, which drops `fixed-models` and an OpenAI-compatible entry's
 * `excluded-models` when it stores a family.
 */
function proxy(initial: Doc, options: { older?: boolean } = {}) {
  apiClient.captureConnection = () => apiClient;
  let doc = structuredClone(initial);
  let version = 1;
  const requests: Array<{ method: string; path: string; ifMatch?: unknown; body?: unknown }> = [];
  apiClient.get = (async (path: string) => {
    requests.push({ method: 'GET', path });
    return structuredClone(doc);
  }) as typeof apiClient.get;
  apiClient.getRaw = (async (path: string) => {
    requests.push({ method: 'GET', path });
    return { data: structuredClone(doc), headers: { etag: `"v${version}"` } };
  }) as typeof apiClient.getRaw;
  apiClient.put = (async (path: string, body: unknown, request?: Doc) => {
    const headers = (request?.headers ?? {}) as Doc;
    requests.push({ method: 'PUT', path, ifMatch: headers['If-Match'], body });
    const family = path.match(/^\/config\/api-keys\/(.+)$/)?.[1];
    if (!family) throw Object.assign(new Error('not found'), { status: 404 });
    if (headers['If-Match'] !== undefined && headers['If-Match'] !== `"v${version}"`) {
      throw Object.assign(new Error('precondition failed'), { status: 412 });
    }
    let stored = structuredClone(body) as Doc[];
    if (options.older) {
      stored = stored.map((group) => {
        const next = { ...group };
        delete next['fixed-models'];
        if (family === 'openai-compatibility') delete next['excluded-models'];
        next.keys = ((next.keys as Doc[]) ?? []).map((key) => {
          const k = { ...key };
          delete k['fixed-models'];
          return k;
        });
        return next;
      });
    }
    doc = { ...doc, 'api-keys': { ...(doc['api-keys'] as Doc), [family]: stored } };
    version += 1;
    // `putWithTag` reads the status in its own transform, as axios hands it over.
    const transforms = request?.transformResponse as Array<
      (data: unknown, headers: unknown, status: number) => unknown
    >;
    transforms?.forEach((transform) => transform('{}', { etag: `"v${version}"` }, 200));
    return {};
  }) as typeof apiClient.put;
  return { doc: () => doc, requests, puts: () => requests.filter((r) => r.method === 'PUT') };
}
const groupsOf = (doc: Doc, family: string) => (doc['api-keys'] as Doc)[family] as Doc[];

// --- reading ------------------------------------------------------------------------------------------------

describe('the keys rows, read in one place', () => {
  test("Provimux's example answers read whole: every key, its state and what it learned", () => {
    const lists = readModelLists(KEYS_EXAMPLE());
    expect(lists.keys).toHaveLength(3);
    const [claude, openrouter, gateway] = lists.keys!;
    expect(claude.key).toEqual({
      type: 'claude',
      name: 'claude',
      fixed: true,
      not_asked: 'fixed',
      configured_models: 2,
      unlisted_models: null,
      learned: [],
      unlisted: null,
    });
    expect(openrouter).toMatchObject({
      auth_index: 'c41d9a07b2e8f113',
      source: 'live',
      learned_models: 1,
      live: { held: true, fetched_at: '2026-11-24T16:10:44Z', listed_models: 3 },
      key: { learned: ['openai/gpt-5.5'], unlisted: ['acme/retired-model'], unlisted_models: 1 },
    });
    expect(gateway.live.last_failure).toEqual({
      at: '2026-11-24T17:58:02Z',
      category: 'http_status',
      http_status: 404,
    });
    // Asked for one key: its models, each with `listed` and `learned`.
    const one = readModelLists(KEY_EXAMPLE()).keys![0];
    expect(one.models?.map((m) => [m.id, m.learned, m.listed])).toEqual([
      ['old', false, false],
      ['openai/gpt-5.5', true, true],
      ['or-opus', false, true],
    ]);
  });

  test('an older server sends no keys: null, never an empty list; a row without its key object is left out', () => {
    const older = { ...KEYS_EXAMPLE() };
    delete older.keys;
    expect(readModelLists(older).keys).toBeNull();
    expect(readModelLists({ ...older, keys: [] }).keys).toEqual([]);
    const broken = { ...older, keys: [{ auth_index: 'x' }, ...KEYS_EXAMPLE().keys] };
    expect(readModelLists(broken).keys).toHaveLength(3);
  });

  test('whether the server has key lists: keys present, an answer without them, a 404, not known yet', () => {
    const lists = readModelLists(KEYS_EXAMPLE());
    expect(keyListsSupported(lists, 'ready')).toBe(true);
    expect(keyListsSupported({ keys: null }, 'ready')).toBe(false);
    expect(keyListsSupported(null, 'unsupported')).toBe(false);
    expect(keyListsSupported(null, 'probing')).toBeNull();
    expect(keyListsSupported(null, 'error')).toBeNull();
    const rows = keyRowsByIndex(lists);
    expect(keyRowsOf(rows, ['nope', 'c41d9a07b2e8f113']).map((r) => r.provider)).toEqual([
      'openrouter',
    ]);
  });
});

// --- a key's state -------------------------------------------------------------------------------------------

const row = (
  patch: Partial<ProvimuxModelListKeyRow> & { key?: Partial<ProvimuxModelListKeyRow['key']> }
) => {
  const base = readModelLists(KEYS_EXAMPLE()).keys![1];
  return {
    ...base,
    ...patch,
    live: { ...base.live, ...patch.live },
    key: { ...base.key, ...patch.key },
  };
};

describe("a key's list state, in the owner's categories", () => {
  test('refreshing: when, how many it found and learned, the rows its service no longer lists', () => {
    const state = keyListState(row({}), NOW);
    expect(state).toMatchObject({
      kind: 'live',
      fetchedAt: '2026-11-24T16:10:44Z',
      listed: 3,
      learned: ['openai/gpt-5.5'],
      unlisted: ['acme/retired-model'],
      failure: null,
      old: false,
    });
    // A day later, the held list is getting old: its fetches have been failing.
    expect(keyListState(row({}), NOW + 25 * 3600_000)).toMatchObject({ kind: 'live', old: true });
    // A newer failed fetch is shown with the held list; an older one is not.
    const failed = { at: '2026-11-24T17:00:00Z', category: 'network', http_status: null };
    expect(
      keyListState(row({ live: { ...row({}).live, last_failure: failed } }), NOW)
    ).toMatchObject({
      failure: failed,
    });
    const before = { ...failed, at: '2026-11-24T15:00:00Z' };
    expect(
      keyListState(row({ live: { ...row({}).live, last_failure: before } }), NOW)
    ).toMatchObject({
      failure: null,
    });
  });

  test('not asked, and why: fixed, live lists off, no list endpoint, a reason this console does not know', () => {
    const lists = readModelLists(KEYS_EXAMPLE());
    expect(keyListState(lists.keys![0], NOW)).toEqual({ kind: 'fixed', configured: 2 });
    expect(
      keyListState(row({ source: 'config', key: { not_asked: 'live_lists_off' } }), NOW).kind
    ).toBe('live-lists-off');
    expect(
      keyListState(row({ source: 'config', key: { not_asked: 'no_list_endpoint' } }), NOW).kind
    ).toBe('no-list');
    expect(keyListState(row({ source: 'config', key: { not_asked: 'home' } }), NOW)).toMatchObject({
      kind: 'not-asked',
      reason: 'home',
    });
  });

  test('asked but no list yet (a 404 from the gateway), and a list too old to count', () => {
    const gateway = readModelLists(KEYS_EXAMPLE()).keys![2];
    expect(keyListState(gateway, NOW)).toMatchObject({
      kind: 'waiting',
      failure: { category: 'http_status', http_status: 404 },
    });
    const expired = row({
      source: 'config',
      live: { ...row({}).live, held: false, expired: true },
    });
    expect(keyListState(expired, NOW)).toMatchObject({
      kind: 'expired',
      fetchedAt: '2026-11-24T16:10:44Z',
    });
  });

  test('a failure in words, never the server text', async () => {
    await i18n.changeLanguage('en');
    const reason = (category: string, status: number | null) =>
      failureReason(i18n.t, { at: '2026-11-24T17:00:00Z', category, http_status: status }, 'Acme');
    expect(reason('http_status', 404)).toBe('Acme has no model list at this address (HTTP 404)');
    expect(reason('http_status', 401)).toBe('Acme refused the key (HTTP 401)');
    expect(reason('http_status', 429)).toContain('slow down');
    expect(reason('http_status', 500)).toBe('Acme answered with an error (HTTP 500)');
    expect(reason('network', null)).toBe('Acme could not be reached');
    expect(reason('invalid_response', null)).toBe("Acme's answer was not a model list");
    expect(reason('something-new', null)).toContain("server's log");
  });
});

// --- learned models a subscription also serves ---------------------------------------------------------------

/** Served routes: per model, [auth index, kind, provider, priority]. */
const routes = (
  models: Record<string, Array<[string, 'oauth' | 'apikey', string, number | null]>>
) =>
  readModelRoutes({
    observed_at: '2026-11-24T18:04:11Z',
    models: Object.entries(models).map(([id, list]) => ({
      id,
      routes: list.map(([authIndex, kind, provider, priority]) => ({
        auth_index: authIndex,
        provider,
        kind,
        priority,
        host: kind === 'apikey' ? 'api.openai.com' : null,
        login:
          kind === 'oauth'
            ? { name: 'codex-alex@example.com.json', email: 'alex@example.com' }
            : {},
      })),
    })),
  });

describe('a model a key learned that a subscription also serves', () => {
  const openai = row({
    auth_index: 'ak-openai-1',
    provider: 'codex',
    key: { type: 'codex', learned: ['gpt-5.5', 'gpt-5.5-mini', 'o5-pro'], unlisted: [] },
  });

  test('who goes first: the key, both at one priority, the subscription; not known', () => {
    expect(overlapOrder(5, 0)).toBe('key-first');
    expect(overlapOrder(0, 0)).toBe('shared');
    expect(overlapOrder(-1, 0)).toBe('sub-first');
    expect(overlapOrder(null, 0)).toBe('unknown');
    expect(['key-first', 'shared', 'unknown'].every((o) => paysPerToken(o as never))).toBe(true);
    expect(paysPerToken('sub-first')).toBe(false);
  });

  test("the key's learned names, under its prefix too; the overlaps, the paid ones first", () => {
    expect([...learnedNames(openai, 'oa').keys()]).toEqual([
      'gpt-5.5',
      'oa/gpt-5.5',
      'gpt-5.5-mini',
      'oa/gpt-5.5-mini',
      'o5-pro',
      'oa/o5-pro',
    ]);
    const served = routes({
      'gpt-5.5': [
        ['li-codex-1', 'oauth', 'codex', 0],
        ['ak-openai-1', 'apikey', 'codex', 0],
      ],
      'gpt-5.5-mini': [
        ['li-codex-1', 'oauth', 'codex', 5],
        ['ak-openai-1', 'apikey', 'codex', 0],
      ],
      'o5-pro': [['ak-openai-1', 'apikey', 'codex', 0]],
      // A row of the key (not learned) is the owner's own word: not an overlap.
      'gpt-4.1': [
        ['li-codex-1', 'oauth', 'codex', 0],
        ['ak-openai-1', 'apikey', 'codex', 0],
      ],
    });
    const overlaps = keyOverlaps(openai, null, ['ak-openai-1'], served);
    expect(overlaps.map((o) => [o.name, o.order])).toEqual([
      ['gpt-5.5', 'shared'],
      ['gpt-5.5-mini', 'sub-first'],
    ]);
    expect(overlaps[0].subscriptions.map((r) => r.login.email)).toEqual(['alex@example.com']);
    // One under the subscription that shares: the key then only takes over.
    expect(priorityBelow(overlaps)).toBe(-1);
    // Another key's routes for the same model are not this key's.
    expect(keyOverlaps(openai, null, ['ak-other'], served)).toEqual([]);
    // Without its list in use (fixed, not fetched yet), it learned nothing.
    expect(keyOverlaps({ ...openai, source: 'config' }, null, ['ak-openai-1'], served)).toEqual([]);
  });
});

// --- the list settings: read, changed, written ------------------------------------------------------------------

describe('the list settings: fixed-models and an OpenAI-compatible entry’s exclusions', () => {
  test("read: a native key's own value, else its group's; an entry's on itself", () => {
    const doc = config();
    const codex = groupsOf(doc, 'codex')[0];
    expect(listSettingsIn('codex', codex, 0)).toEqual({ fixed: false, excluded: null });
    expect(listSettingsIn('claude', groupsOf(doc, 'claude')[0], 0)).toEqual({
      fixed: true,
      excluded: null,
    });
    const fixedGroup = { ...codex, 'fixed-models': true };
    expect(listSettingsIn('codex', fixedGroup, 0).fixed).toBe(true);
    expect(listSettingsIn('codex', fixedGroup, 1).fixed).toBe(false); // its own false wins
    expect(
      listSettingsIn('openai-compatibility', groupsOf(doc, 'openai-compatibility')[0], null)
    ).toEqual({
      fixed: false,
      excluded: ['text-embedding-*'],
    });
    // Vertex and Interactions keys are never asked: no switch for them.
    expect(familyAsked('vertex')).toBe(false);
    expect(familyAsked('interactions')).toBe(false);
    expect(familyAsked('codex')).toBe(true);
  });

  test('written: on an entry; on a lone key’s group; on one key of several, only where it differs', () => {
    const doc = config();
    const entry = groupWithListSettings(
      'openai-compatibility',
      groupsOf(doc, 'openai-compatibility')[0],
      null,
      {
        fixed: true,
        excluded: ['text-embedding-*', ' x-ai/* ', 'x-ai/*', ''],
      }
    );
    expect(entry['fixed-models']).toBe(true);
    expect(entry['excluded-models']).toEqual(['text-embedding-*', 'x-ai/*']);
    const cleared = groupWithListSettings('openai-compatibility', entry, null, {
      fixed: false,
      excluded: [],
    });
    expect('fixed-models' in cleared || 'excluded-models' in cleared).toBe(false);

    // A lone key: the group carries it (the proxy's own place), the key's own is dropped.
    const lone = { name: 'anthropic', keys: [{ 'api-key': 'k', 'fixed-models': false }] };
    const fixedLone = groupWithListSettings('claude', lone, 0, { fixed: true, excluded: null });
    expect(fixedLone['fixed-models']).toBe(true);
    expect((fixedLone.keys as Doc[])[0]).toEqual({ 'api-key': 'k' });
    expect(
      'fixed-models' in
        groupWithListSettings('claude', fixedLone, 0, { fixed: false, excluded: null })
    ).toBe(false);

    // Three keys, one with its own value: the first key's change is its own, the others keep theirs.
    const codex = groupsOf(doc, 'codex')[0];
    const first = groupWithListSettings('codex', codex, 0, { fixed: true, excluded: null });
    expect(first['fixed-models']).toBeUndefined();
    expect((first.keys as Doc[]).map((k) => k['fixed-models'])).toEqual([true, false, undefined]);
    const back = groupWithListSettings('codex', first, 0, { fixed: false, excluded: null });
    expect((back.keys as Doc[]).map((k) => k['fixed-models'])).toEqual([
      undefined,
      false,
      undefined,
    ]);
  });

  test('the family list: only the target group changes; a group that moved or was renamed writes nothing', () => {
    const doc = config();
    const target = {
      family: 'openai-compatibility' as const,
      groupIndex: 0,
      keyIndex: null,
      name: 'openrouter',
    };
    const groups = familyWithListSettings(doc, target, { fixed: true, excluded: [] }) as Doc[];
    expect(groups[0]).toMatchObject({
      name: 'openrouter',
      'fixed-models': true,
      models: groupsOf(doc, 'openai-compatibility')[0].models,
    });
    expect(() =>
      familyWithListSettings(doc, { ...target, name: 'renamed' }, { fixed: true, excluded: [] })
    ).toThrow(KeyWriteError);
    expect(() =>
      familyWithListSettings(doc, { ...target, groupIndex: 4 }, { fixed: true, excluded: [] })
    ).toThrow(KeyWriteError);
    // An entry just added: the last group of that name.
    const added = familyWithListSettings(
      doc,
      { ...target, groupIndex: null },
      { fixed: true, excluded: [] }
    ) as Doc[];
    expect(added[0]['fixed-models']).toBe(true);
  });

  test('the request: a fresh read, then PUT /config/api-keys/<family> with If-Match of that read', async () => {
    const stand = proxy(config());
    await accountsApi.writeListSettings(
      { family: 'claude', groupIndex: 0, keyIndex: 0, name: 'anthropic' },
      { fixed: false, excluded: null }
    );
    expect(stand.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /config',
      'PUT /config/api-keys/claude',
    ]);
    expect(stand.puts()[0].ifMatch).toBe('"v1"');
    expect('fixed-models' in groupsOf(stand.doc(), 'claude')[0]).toBe(false);
    // Everything else of the family stays as read.
    expect(groupsOf(stand.doc(), 'claude')[0].models).toEqual([{ name: 'claude-opus-5-5' }]);
  });

  test('a changed file is refused (412) and nothing is written; the message says so', async () => {
    const stand = proxy(config());
    const put = apiClient.put;
    apiClient.put = (async () => {
      throw Object.assign(new Error('precondition failed'), { status: 412 });
    }) as typeof apiClient.put;
    const write = accountsApi.writeListSettings(
      { family: 'claude', groupIndex: 0, keyIndex: 0, name: 'anthropic' },
      { fixed: false, excluded: null }
    );
    await expect(write).rejects.toBeInstanceOf(AccountsWriteError);
    apiClient.put = put;
    expect(stand.puts()).toHaveLength(0);
    await i18n.changeLanguage('en');
    const partial = writeErrorMessage(
      i18n.t,
      new ListSettingsWriteError(new AccountsWriteError('changed', 'x'))
    );
    expect(partial).toMatch(
      /^The other settings were saved, but not the model list's: Your keys changed elsewhere/
    );
  });
});

describe("a key's settings saved: AI Providers' own save, then the list settings", () => {
  const native = (doc: Doc, family = 'codex', keyIndex = 0) =>
    draftOf(locateKey(doc, entryOf(doc, family, keyIndex))!) as NativeDraft;
  const compatible = (doc: Doc) =>
    draftOf(locateKey(doc, entryOf(doc, 'openai-compatibility', null))!) as CompatibleDraft;

  test('a draft holds the list settings as stored; changing them changes nothing of the form', () => {
    const doc = config();
    const draft = native(doc, 'claude');
    expect(draft.lists).toEqual({ fixed: true, excluded: null });
    const off = withLists(draft, { fixed: false });
    expect(listsChanged(off)).toBe(true);
    expect(formChanged(off)).toBe(false);
    expect(draftChanged(off)).toBe(true);
    expect(storedListTarget(off)).toEqual({
      family: 'claude',
      groupIndex: 0,
      keyIndex: 0,
      name: 'anthropic',
    });
    const entry = compatible(doc);
    expect(entry.lists).toEqual({ fixed: false, excluded: ['text-embedding-*'] });
    expect(storedListTarget(entry)).toEqual({
      family: 'openai-compatibility',
      groupIndex: 0,
      keyIndex: null,
      name: 'openrouter',
    });
    // The panel's line names a fixed list and an entry's exclusions.
    expect(summaryOf(withLists(entry, { fixed: true }))).toMatchObject({
      fixed: true,
      excluded: 1,
    });
  });

  test('only the switch changed: one write, the list settings', async () => {
    const stand = proxy(config());
    const draft = withLists(native(config()), { fixed: true });
    await saveKeySettingsDraft(draft, { document: config(), listsShown: true });
    expect(stand.puts().map((p) => p.path)).toEqual(['/config/api-keys/codex']);
    expect(stand.puts()[0].ifMatch).toBe('"v1"');
    // Three keys: the first one's own value; the second keeps its own false.
    expect((groupsOf(stand.doc(), 'codex')[0].keys as Doc[]).map((k) => k['fixed-models'])).toEqual(
      [true, false, undefined]
    );
  });

  test("the form and the exclusions changed: AI Providers' save, then the entry's own fields, each with If-Match", async () => {
    const stand = proxy(config());
    let draft: KeyDraft = withValue(compatible(config()), 'prefix', 'or');
    draft = withLists(draft, { fixed: true, excluded: ['text-embedding-*', 'x-ai/*'] });
    await saveKeySettingsDraft(draft, { document: config(), listsShown: true });
    const writes = stand.puts();
    expect(writes.map((p) => p.path)).toEqual([
      '/config/api-keys/openai-compatibility',
      '/config/api-keys/openai-compatibility',
    ]);
    // AI Providers' own save sends no If-Match for an OpenAI entry (as it always has); the list write does,
    // with the tag of its own read, after the first write.
    expect(writes[1].ifMatch).toBe('"v2"');
    const [entry] = groupsOf(stand.doc(), 'openai-compatibility');
    expect(entry).toMatchObject({
      name: 'openrouter',
      prefix: 'or',
      'fixed-models': true,
      'excluded-models': ['text-embedding-*', 'x-ai/*'],
    });
  });

  test("an unrelated change keeps both fields: AI Providers' save leaves what it does not know", async () => {
    const doc = config();
    const groups = groupsOf(doc, 'openai-compatibility');
    groups[0] = { ...groups[0], 'fixed-models': true };
    const codex = groupsOf(doc, 'codex');
    codex[0] = { ...codex[0], 'fixed-models': true };
    const stand = proxy(doc);
    await saveKeySettingsDraft(withValue(compatible(doc), 'prefix', 'or'), {
      document: doc,
      listsShown: true,
    });
    await saveKeySettingsDraft(withValue(native(doc), 'proxyUrl', 'socks5://127.0.0.1:1080'), {
      document: doc,
      listsShown: true,
    });
    expect(stand.puts()).toHaveLength(2);
    expect(groupsOf(stand.doc(), 'openai-compatibility')[0]).toMatchObject({
      'fixed-models': true,
      'excluded-models': ['text-embedding-*'],
    });
    expect(groupsOf(stand.doc(), 'codex')[0]['fixed-models']).toBe(true);
  });

  test('a new key with the switch on: its connection is made, then the switch is set on it', async () => {
    const doc = config();
    const stand = proxy(doc);
    let draft: KeyDraft = newNativeDraft(doc, 'xai', 'https://api.x.ai/v1');
    expect(draft.lists).toEqual({ fixed: false, excluded: null });
    draft = withTyped(withLists(draft, { fixed: true }), { apiKey: 'fixture-xai-key-0000x1y2' });
    // The switch alone makes the add go through AI Providers' save, with the settings.
    expect(settingsTouched(draft)).toBe(true);
    await saveKeySettingsDraft(draft, { document: doc, listsShown: true });
    expect(stand.puts().map((p) => [p.path, p.ifMatch])).toEqual([
      ['/config/api-keys/xai', '"v1"'],
      ['/config/api-keys/xai', '"v2"'],
    ]);
    expect(groupsOf(stand.doc(), 'xai')[0]).toMatchObject({
      name: 'xai-1',
      'fixed-models': true,
      keys: [{ 'api-key': 'fixture-xai-key-0000x1y2' }],
    });
  });

  test("a list write that fails after the form's save says which part was saved", async () => {
    const doc = config();
    proxy(doc);
    let draft: KeyDraft = withValue(native(doc), 'proxyUrl', 'socks5://127.0.0.1:1080');
    draft = withLists(draft, { fixed: true });
    const getRaw = apiClient.getRaw;
    let reads = 0;
    apiClient.getRaw = (async (path: string) => {
      reads += 1;
      const answer = await getRaw(path);
      // The second read (the list write's) finds the group renamed elsewhere.
      if (reads === 2) {
        const data = answer.data as Doc;
        groupsOf(data, 'codex')[0] = { ...groupsOf(data, 'codex')[0], name: 'renamed' };
      }
      return answer;
    }) as typeof apiClient.getRaw;
    const save = saveKeySettingsDraft(draft, { document: doc, listsShown: true });
    await expect(save).rejects.toBeInstanceOf(ListSettingsWriteError);
  });

  test('an older server: the list settings are not shown, so nothing of them is ever written', async () => {
    const stand = proxy(config(), { older: true });
    const draft = withLists(native(config()), { fixed: true });
    await saveKeySettingsDraft(draft, { document: config(), listsShown: false });
    expect(stand.puts()).toHaveLength(0);
    // And such a server drops the fields on a save anyway (what the console must not rely on).
    await saveKeySettingsDraft(withValue(compatible(config()), 'prefix', 'or'), {
      document: config(),
      listsShown: false,
    });
    expect('excluded-models' in groupsOf(stand.doc(), 'openai-compatibility')[0]).toBe(false);
  });
});

// --- what the pages show ----------------------------------------------------------------------------------

const noop = () => undefined;
const renderFields = (draft: KeyDraft, listsShown: boolean) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(KeySettingsFields, {
        draft,
        onChange: noop,
        service: 'OpenRouter',
        mode: 'edit',
        disabled: false,
        listsShown,
      })
    )
  );

describe('the switch, the exclusions and the state: shown only by a server that has them', () => {
  test("a key's settings: the fixed-list switch with what each state does; an entry's own exclusions", async () => {
    await i18n.changeLanguage('en');
    const doc = config();
    const entry = draftOf(locateKey(doc, entryOf(doc, 'openai-compatibility', null))!);
    const html = renderFields(entry, true);
    expect(html).toContain('Fixed list');
    expect(html).toContain(
      'Off: the list keeps itself up to date. Provimux asks OpenRouter for its models'
    );
    expect(renderFields(withLists(entry, { fixed: true }), true)).toContain(
      'On: this key offers exactly the models above, and OpenRouter is never asked.'
    );
    expect(html).toContain('Models it never serves');
    expect(html).toContain('the ones its list learned included');
    // A Vertex key is never asked: no switch, the reason in one line; on an older server, not even that.
    const vertex = draftOf(locateKey(doc, entryOf(doc, 'vertex', 0))!);
    const never = renderFields(vertex, true);
    expect(never).not.toContain('Fixed list');
    expect(never).not.toContain('type="checkbox" aria-label="Fixed list"');
    expect(never).toContain(
      'No fixed list to set: Provimux can&#x27;t read a model list from OpenRouter'
    );
    expect(renderFields(vertex, false)).not.toContain('No fixed list to set');
  });

  test('an older server: no switch, and an OpenAI-compatible entry has no exclusions field', async () => {
    await i18n.changeLanguage('en');
    const doc = config();
    const entry = draftOf(locateKey(doc, entryOf(doc, 'openai-compatibility', null))!);
    const html = renderFields(entry, false);
    expect(html).not.toContain('Fixed list');
    expect(html).not.toContain('Models it never serves');
    // A built-in key keeps the field it always had.
    expect(renderFields(draftOf(locateKey(doc, entryOf(doc, 'codex', 0))!), false)).toContain(
      'Models it never serves'
    );
  });

  test("a key's panel: refreshed when, found, learned, unlisted, and the overlap with its three ways out", async () => {
    await i18n.changeLanguage('en');
    const lists = readModelLists(KEYS_EXAMPLE());
    const openrouter = lists.keys![1];
    const served: ProvimuxModelRoutesResponse = routes({
      'openai/gpt-5.5': [
        ['li-codex-1', 'oauth', 'codex', 0],
        ['c41d9a07b2e8f113', 'apikey', 'openai-compatible-openrouter', 0],
      ],
    });
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(KeyListStatus, {
          rows: [openrouter],
          prefix: null,
          routes: served,
          service: 'OpenRouter',
          nowMs: NOW,
          busy: false,
          learnedAddress: '/provimux/models?account=c41d9a07b2e8f113&view=learned',
          onLowerPriority: noop,
          onExclude: noop,
          onFix: noop,
        })
      )
    );
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, ' ');
    expect(text).toContain('Keeps itself up to date');
    expect(text).toContain('OpenRouter listed 3 models at the last refresh.');
    expect(text).toContain('This key offers 1 of them by itself');
    expect(text).toContain(
      "1 model in its settings is no longer in OpenRouter's list: acme/retired-model."
    );
    expect(text).toContain('Learned by itself · 1');
    expect(text).toContain('1 model it learned is also served by your subscriptions');
    expect(text).toContain('same priority: shared');
    expect(text).toContain("Set this key's priority to -1");
    expect(text).toContain('Exclude it on this key');
    expect(text).toContain('Use a fixed list');
    // Fixed, and the gateway's 404, in words.
    const fixed = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(KeyListStatus, {
          rows: [lists.keys![0], lists.keys![2]],
          prefix: null,
          routes: null,
          service: 'Acme',
          nowMs: NOW,
          busy: false,
          learnedAddress: '/',
          onLowerPriority: noop,
          onExclude: noop,
          onFix: noop,
        })
      )
    );
    expect(fixed).toContain('Fixed list');
    expect(fixed).toContain('Key 1');
    expect(fixed).toContain('Acme has no model list at this address (HTTP 404)');
  });

  test("Models' compatible entries: real exclusions on a server with key lists, the old line on an older one", () => {
    const state = readAliasState(config(), null);
    expect(readExclusions(state).withoutExclusions.map((e) => e.groupName)).toEqual(['openrouter']);
    const current = readExclusions(state, { compatible: true });
    expect(current.withoutExclusions).toEqual([]);
    expect(current.exclusions.map((e) => [e.place.id, e.rule])).toContainEqual([
      'openai-compatibility/0/g',
      'text-embedding-*',
    ]);
  });
});

// --- Models: learned names marked, the overlap shown -----------------------------------------------------------

describe('Models: a learned model is marked, and a subscription serving it too is said plainly', () => {
  const lists = (): ProvimuxModelListsResponse => {
    const answer = readModelLists(KEYS_EXAMPLE());
    const openai = row({
      auth_index: 'ak-openai-1',
      provider: 'codex',
      key: { type: 'codex', name: 'codex', learned: ['gpt-5.5', 'o5-pro'], unlisted: [] },
    });
    return { ...answer, keys: [...answer.keys!, openai] };
  };
  const served = () =>
    routes({
      'gpt-5.5': [
        ['li-codex-1', 'oauth', 'codex', 0],
        ['ak-openai-1', 'apikey', 'codex', 0],
      ],
      'o5-pro': [['ak-openai-1', 'apikey', 'codex', 0]],
      'gpt-4.1': [['ak-openai-1', 'apikey', 'codex', 0]],
    });
  const names = (
    draft = startDraft({ ...readAliasState(config(), null), etag: '"t"' }),
    withKeys = true
  ) =>
    buildNames({
      draft,
      routes: served(),
      lists: withKeys ? lists() : { ...lists(), keys: null },
      usage: null,
      nowMs: NOW,
    });
  const named = (items: NameItem[], key: string) => items.find((item) => item.key === key)!;

  test('lines of a learned model are marked; a row of the key is not; the overlap and who goes first', () => {
    const items = names();
    const gpt = named(items, 'gpt-5.5');
    expect(gpt.lines.find((l) => l.access === 'api')).toMatchObject({
      learned: true,
      upstream: 'gpt-5.5',
    });
    expect(gpt.learned).toBe(true);
    expect(gpt.paid).toBe('shared');
    expect(named(items, 'o5-pro')).toMatchObject({ learned: true, paid: null });
    expect(named(items, 'gpt-4.1')).toMatchObject({ learned: false, paid: null });
    expect(summarizeNames(items)).toMatchObject({ learned: 2, paid: 1 });
    // The views and the addresses that open them.
    expect(
      items
        .filter((i) => matches(i, { query: '', provider: 'all', view: 'learned' }, []))
        .map((i) => i.key)
        .sort()
    ).toEqual(['gpt-5.5', 'o5-pro']);
    expect(
      items
        .filter((i) => matches(i, { query: '', provider: 'all', view: 'paid' }, []))
        .map((i) => i.key)
    ).toEqual(['gpt-5.5']);
    expect(initialModelsFilter(new URLSearchParams('view=learned')).view).toBe('learned');
    expect(initialModelsFilter(new URLSearchParams('view=paid')).view).toBe('paid');
  });

  test("the key's priority set below the subscription's in the draft: no longer paid", () => {
    const base = startDraft({ ...readAliasState(config(), null), etag: '"t"' });
    const entry = draftEntries(base).find(
      (e) => e.store === 'api-key' && e.family === 'codex' && e.keyIndex === 0
    )!;
    const lowered = { ...base, priorities: { [entry.id]: -1 } };
    expect(named(names(lowered), 'gpt-5.5').paid).toBe('sub-first');
  });

  test('an older server: nothing is marked', () => {
    const items = names(undefined, false);
    expect(items.some((item) => item.learned || item.paid)).toBe(false);
  });

  test('the card: the mark on the line, and the warning with its three ways', async () => {
    await i18n.changeLanguage('en');
    const draft = startDraft({ ...readAliasState(config(), null), etag: '"t"' });
    const item = named(names(draft), 'gpt-5.5');
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(NameCard, {
          id: 'card',
          item,
          draft,
          entries: draftEntries(draft),
          routes: served(),
          routesKnown: true,
          offsetMs: 0,
          locked: false,
          open: false,
          onToggle: noop,
          onRenamed: noop,
          onNewName: noop,
          edit: noop,
          onExclude: noop,
          excludeBlocked: null,
        })
      )
    );
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, ' ');
    expect(text).toContain('learned');
    expect(text).toContain('also paid per token');
    expect(text).toContain(
      'Codex API key (api.openai.com) learned gpt-5.5 by itself, and your Codex subscription serves it too.'
    );
    expect(text).toContain(
      'Codex API key (api.openai.com) and your Codex subscription have the same priority'
    );
    expect(text).toContain("Set the key's priority to -1");
    expect(text).toContain('Exclude it on the key');
    expect(html).toContain(
      `href="${accountsAddressOfKeyLists('ak-openai-1').replace('&', '&amp;')}"`
    );
  });
});

describe('links', () => {
  test('a key on Models, only what it learned; Accounts at a key’s switch', () => {
    expect(accountsAddressOfKeyLists('ak 1')).toBe(
      '/provimux/accounts?account=ak%201&settings=lists'
    );
    const account = {
      kind: 'api',
      authIndexes: ['c41d9a07b2e8f113'],
      entry: { family: 'openai-compatibility', host: 'openrouter.ai' },
    } as never;
    expect(modelsAddressOf(account, true, 'learned')).toBe(
      '/provimux/models?account=c41d9a07b2e8f113&view=learned'
    );
  });

  test("the Dashboard's own links to AI Providers and Auth Files lead to Accounts", async () => {
    expect(provimuxDashboardTo('/ai-providers')).toBe('/provimux/accounts');
    expect(provimuxDashboardTo('/auth-files')).toBe('/provimux/accounts');
    expect(provimuxDashboardTo('/logs')).toBe('/logs');
    const page = read('src/features/dashboard/DashboardPage.tsx');
    expect(page).toContain(
      "<Link to={provimuxDashboardTo('/ai-providers')} className={styles.primaryAction}>"
    );
    expect(page).toContain(
      "<Link to={provimuxDashboardTo('/auth-files')} className={styles.panelLink}>"
    );
    // Their words say where they lead, in every language.
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      await i18n.changeLanguage(language);
      expect(i18n.t('dashboard.health_link')).not.toMatch(/auth files/i);
    }
    await i18n.changeLanguage('en');
    expect(i18n.t('dashboard.cta_manage_providers')).toBe('Manage accounts');
    expect(i18n.t('dashboard.health_link')).toBe('Open Accounts');
  });
});

describe('strings', () => {
  test('every key the new pieces ask for exists in English', () => {
    const en = json('src/provimux/locales/en.json');
    const get = (path: string): unknown =>
      path.split('.').reduce<unknown>((node, key) => (node as Doc | undefined)?.[key], en);
    for (const file of [
      'src/provimux/pages/accounts/KeyListStatus.tsx',
      'src/provimux/pages/accounts/keyListWords.ts',
      'src/provimux/pages/accounts/KeySettingsFields.tsx',
      'src/provimux/pages/models/NameCard.tsx',
      'src/provimux/pages/models/ModelsBoard.tsx',
      'src/provimux/pages/models/ModelsSettings.tsx',
    ]) {
      for (const match of read(file).matchAll(/'(provimux\.[a-z_.]+)'/g)) {
        const key = match[1];
        const known = get(key) !== undefined || get(`${key}_other`) !== undefined;
        expect({ key, known }).toEqual({ key, known: true });
      }
    }
  });
});

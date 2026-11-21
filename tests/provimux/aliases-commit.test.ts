import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clone,
  family,
  fixture,
  httpError,
  loginMap,
  restoreClient,
  server,
  type Doc,
} from '../helpers/aliasesStore';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import { providersApi, type ProviderFamily } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import { aliasesApi, BLOCKED_MESSAGE } from '@/provimux/pages/aliases/aliasesApi';
import {
  addKeyAlias,
  addLoginAlias,
  changeRow,
  removeRow,
  startDraft,
} from '@/provimux/pages/aliases/draft';
import { rebase } from '@/provimux/pages/aliases/rebase';
import { locate, planCommit, sameChannel } from '@/provimux/pages/aliases/plan';
import type { AliasDraft } from '@/provimux/pages/aliases/types';
import type {
  ModelAlias,
  OAuthModelAliasEntry,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';

/* ALP-03 W4: tests R-2, R-3, A-1, B-1, C-1, C-2 and the write side of O-2 and O-6. */

afterEach(restoreClient);

/** Without the fields the server adds (auth-index) and the old console-only field upstream removes. */
function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Doc)
        .filter(([key]) => !['auth-index', 'auth_index', 'test-model'].includes(key))
        .map(([key, v]) => [key, strip(v)])
    );
  }
  return value;
}

describe('R-2 nothing lost, store A', () => {
  test('a draft with no change plans no unit and requests nothing', async () => {
    const s = server(fixture('config-full.json'));
    const state = await aliasesApi.load();
    s.log.length = 0;
    const draft = startDraft(state);
    expect(planCommit(draft)).toEqual([]);
    expect(await aliasesApi.commit(draft)).toEqual({ done: [], failed: [] });
    expect(s.log).toEqual([]);
  });

  test('one alias change: every other row, key, group and field is as stored', async () => {
    const doc = fixture('config-full.json');
    const s = server(doc);
    const draft = changeRow(startDraft(await aliasesApi.load()), 'claude/0/0#2', {
      alias: 'haiku',
    });
    expect(await aliasesApi.commit(draft)).toEqual({ done: ['claude/0/0'], failed: [] });
    expect(s.puts).toHaveLength(1);
    expect(s.puts[0].path).toBe('/config/api-keys/claude');
    const body = s.puts[0].body as Doc[];
    const before = family(doc, 'claude');
    const group = before[0];
    const models = group.models as Doc[];
    // The key that inherited the group's list gets its own; the group, its list and its other key stay.
    expect(body).toEqual([
      {
        ...group,
        keys: [
          {
            ...(group.keys as Doc[])[0],
            models: [models[0], models[1], { name: 'claude-haiku-5', alias: 'haiku' }],
          },
          (group.keys as Doc[])[1],
        ],
      },
      before[1],
    ]);
    expect(JSON.stringify(body)).toContain('"x-unknown":"keep-me"');
    expect(JSON.stringify(body)).toContain('"test-model":true');
    for (const other of Object.keys(doc['api-keys'] as Doc)) {
      if (other !== 'claude') expect(family(s.stored(), other)).toEqual(family(doc, other));
    }
    expect(s.stored().oauth).toEqual(doc.oauth);
  });

  test('O-2 write side: clearing an alias removes the key, Vertex too; a same-name row stays as read', async () => {
    const doc = fixture('config-full.json');
    const s = server(doc);
    let draft = startDraft(await aliasesApi.load());
    draft = changeRow(draft, 'vertex/0/0#2', { alias: '' });
    draft = changeRow(draft, 'gemini/0/0#0', { alias: 'gemini-2.5-pro' });
    expect((await aliasesApi.commit(draft)).done).toEqual(['gemini/0/0', 'vertex/0/0']);
    const vertexModels = (family(s.stored(), 'vertex')[0].keys as Doc[])[0].models;
    expect(vertexModels).toEqual([
      { name: 'gemini-x' },
      { name: 'gemini-s', alias: 'gemini-s', openapi: true },
      { name: 'gemini-y' },
    ]);
    expect((family(s.stored(), 'gemini')[0].keys as Doc[])[0].models).toEqual([
      { name: 'gemini-2.5-pro' },
    ]);
  });
});

describe('R-3 nothing lost, store B', () => {
  test('one alias changed in one channel', async () => {
    const doc = fixture('config-full.json');
    const s = server(doc);
    const draft = changeRow(startDraft(await aliasesApi.load()), 'login/codex#1', {
      alias: 'g54-b',
    });
    expect(await aliasesApi.commit(draft)).toEqual({ done: ['login/codex'], failed: [] });
    expect(s.puts.map((p) => p.path)).toEqual(['/config/oauth/model-alias']);
    const body = s.puts[0].body as Record<string, unknown[]>;
    const before = loginMap(doc);
    expect(Object.keys(body).sort()).toEqual(['claude', 'codex']);
    expect(body.claude).toEqual(before.claude);
    expect(body.codex).toEqual([before.codex[0], { name: 'gpt-5.4', alias: 'g54-b', fork: true }]);
    expect(body.codex[0]).toEqual({
      name: 'gpt-5.5',
      alias: 'g55',
      'display-name': 'GPT 5.5 (login)',
      openapi: true,
      'x-unknown': 'keep-me',
    });
    // Everything else of the file is as it was.
    expect({ ...s.stored(), oauth: null }).toEqual({ ...doc, oauth: null });
    expect((s.stored().oauth as Doc)['excluded-models']).toEqual(
      (doc.oauth as Doc)['excluded-models']
    );
  });

  test('a changed row keeps its other keys; force-mapping, fork and display-name follow 2.4', async () => {
    const s = server(fixture('config-full.json'));
    const draft = changeRow(startDraft(await aliasesApi.load()), 'login/codex#0', {
      alias: ' g55-b ',
      fork: true,
      forceMapping: false,
      displayName: '',
    });
    await aliasesApi.commit(draft);
    expect(loginMap(s.stored()).codex[0]).toEqual({
      name: 'gpt-5.5',
      alias: 'g55-b',
      fork: true,
      openapi: true,
      'x-unknown': 'keep-me',
    });
  });

  test('O-6 write side: a channel’s last row removed takes its key; the last channel leaves {}', async () => {
    const s = server(fixture('config-full.json'));
    let draft = startDraft(await aliasesApi.load());
    draft = removeRow(removeRow(draft, 'login/codex#0'), 'login/codex#1');
    await aliasesApi.commit(draft);
    expect(Object.keys(loginMap(s.stored()))).toEqual(['claude']);

    const only = server({ oauth: { 'model-alias': { kimi: [{ name: 'k1', alias: 'ka' }] } } });
    await aliasesApi.commit(removeRow(startDraft(await aliasesApi.load()), 'login/kimi#0'));
    expect(only.puts.map((p) => p.body)).toEqual([{}]);
  });

  test('a new channel is written under its normalized key', async () => {
    const s = server(fixture('config-empty.json'));
    const draft = addLoginAlias(startDraft(await aliasesApi.load()), 'Gemini_CLI', {
      upstream: 'gemini-2.5-pro',
      alias: 'gp',
      displayName: 'GP',
    });
    expect(await aliasesApi.commit(draft)).toEqual({ done: ['login/gemini-cli'], failed: [] });
    expect(s.puts[0].body).toEqual({
      'gemini-cli': [{ name: 'gemini-2.5-pro', alias: 'gp', fork: true, 'display-name': 'GP' }],
    });
  });
});

// --- A-1 -----------------------------------------------------------------------------------

const FAMILIES: ProviderFamily[] = [
  'gemini',
  'interactions',
  'codex',
  'claude',
  'xai',
  'meta',
  'vertex',
  'openai-compatibility',
];
const UPDATE: Record<
  Exclude<ProviderFamily, 'openai-compatibility'>,
  (apiKey: string, baseUrl: string | undefined, config: ProviderKeyConfig) => Promise<void>
> = {
  gemini: providersApi.updateGeminiKey,
  interactions: providersApi.updateInteractionsKey,
  codex: providersApi.updateCodexConfig,
  claude: providersApi.updateClaudeConfig,
  xai: providersApi.updateXAIConfig,
  meta: providersApi.updateMetaConfig,
  vertex: providersApi.updateVertexConfig,
};

/** Index 0: an aliased row with force-mapping and options; 1: a plain row; 2: a second row of 0. */
const modelList = (p: string) => [
  {
    name: `${p}-1`,
    alias: `${p}-a`,
    'force-mapping': true,
    'display-name': `${p} one`,
    'x-unknown': 1,
    'test-model': true,
  },
  { name: `${p}-2` },
  { name: `${p}-1`, alias: `${p}-b` },
];

function familyGroups(name: ProviderFamily): Doc[] {
  if (name === 'openai-compatibility') {
    return [
      {
        name: 'oa',
        'base-url': 'https://oa.example.invalid/v1',
        'auth-index': 'ai-oa',
        'test-model': 'm-1',
        keys: [{ 'api-key': 'fixture-key-1', 'auth-index': 'ai-oa-1' }],
        models: modelList('m'),
      },
      {
        name: 'ob',
        'base-url': 'https://ob.example.invalid/v1',
        keys: [{ 'api-key': 'fixture-key-2' }],
        models: modelList('n'),
      },
      {
        name: 'oc',
        'base-url': 'https://oc.example.invalid/v1',
        keys: [{ 'api-key': 'fixture-key-3' }],
        models: [{ name: 'z', alias: 'zz', 'test-model': true }],
      },
    ];
  }
  return [
    {
      name: `${name}-1`,
      'x-group': 'kept',
      models: modelList('m'),
      keys: [
        { 'api-key': 'fixture-key-1', 'auth-index': 'ai-1' },
        { 'api-key': 'fixture-key-2', 'auth-index': 'ai-2', models: modelList('n') },
        { 'api-key': 'fixture-key-3', 'auth-index': 'ai-3' },
      ],
    },
    {
      name: `${name}-2`,
      keys: [
        { 'api-key': 'fixture-key-4', models: [{ name: 'z', alias: 'zz', 'test-model': true }] },
      ],
    },
  ];
}

/** The two changed entries: an inheriting key and a key with its own list; two OpenAI entries. */
const changedEntries = (name: ProviderFamily) =>
  name === 'openai-compatibility' ? [`${name}/0/g`, `${name}/1/g`] : [`${name}/0/0`, `${name}/0/1`];

interface Op {
  label: string;
  form: (models: ModelAlias[]) => ModelAlias[];
  page: (draft: AliasDraft, entryId: string) => AliasDraft;
}
const at = (i: number, change: (m: ModelAlias) => ModelAlias) => (models: ModelAlias[]) =>
  models.map((m, j) => (j === i ? change(m) : m));
const OPS: Op[] = [
  {
    label: 'set an alias',
    form: at(1, (m) => ({ ...m, alias: 'set' })),
    page: (d, e) => changeRow(d, `${e}#1`, { alias: 'set' }),
  },
  {
    label: 'change it',
    form: at(0, (m) => ({ ...m, alias: 'changed' })),
    page: (d, e) => changeRow(d, `${e}#0`, { alias: 'changed' }),
  },
  {
    label: 'clear it',
    form: at(0, (m) => ({ ...m, alias: undefined })),
    page: (d, e) => changeRow(d, `${e}#0`, { alias: '' }),
  },
  {
    label: 'set force-mapping',
    form: at(1, (m) => ({ ...m, forceMapping: true })),
    page: (d, e) => changeRow(d, `${e}#1`, { forceMapping: true }),
  },
  {
    label: 'unset force-mapping',
    form: at(0, (m) => ({ ...m, forceMapping: false })),
    page: (d, e) => changeRow(d, `${e}#0`, { forceMapping: false }),
  },
  {
    label: 'add a second row',
    form: (models) => [
      ...models.slice(0, 2),
      { sourceIndex: null, name: models[1].name, alias: 'second' },
      ...models.slice(2),
    ],
    page: (d, e) => addKeyAlias(d, e, d.rows.find((r) => r.id === `${e}#1`)!.upstream, 'second'),
  },
  {
    label: 'remove one',
    form: (models) => models.filter((m) => m.sourceIndex !== 2),
    page: (d, e) => removeRow(d, `${e}#2`),
  },
];

/** Upstream's writer as the provider form runs it: one update per entry, each from a fresh read. */
async function upstreamEdit(name: ProviderFamily, op: Op) {
  for (const entryId of changedEntries(name)) {
    const [, g, k] = entryId.split('/').slice(-3);
    const groups = family(await apiClient.get<Doc>('/config'), name);
    if (name === 'openai-compatibility') {
      const config = (normalizeProviderGroups(groups, true) as OpenAIProviderConfig[]).find(
        (c) => c.source?.groupIndex === Number(g)
      )!;
      await providersApi.updateOpenAIProvider(config.name, Number(g), {
        ...config,
        models: op.form(config.models ?? []),
      });
    } else {
      const config = (normalizeProviderGroups(groups) as ProviderKeyConfig[]).find(
        (c) => c.source?.groupIndex === Number(g) && c.source?.keyIndex === Number(k)
      )!;
      await UPDATE[name](config.apiKey, config.baseUrl, {
        ...config,
        models: op.form(config.models ?? []),
      });
    }
  }
}

describe('A-1 equality with the old editor, store A', () => {
  for (const name of FAMILIES) {
    describe(name, () => {
      test.each(OPS.map((op) => [op.label, op] as const))('%s', async (_label, op) => {
        const doc = { 'config-version': 8, 'api-keys': { [name]: familyGroups(name) } };

        const old = server(doc);
        await upstreamEdit(name, op);
        const upstreamFinal = family(old.stored(), name);

        const page = server(doc);
        let draft = startDraft(await aliasesApi.load());
        for (const entryId of changedEntries(name)) draft = op.page(draft, entryId);
        const outcome = await aliasesApi.commit(draft);
        expect(outcome).toEqual({ done: changedEntries(name), failed: [] });
        const pageFinal = family(page.stored(), name);

        // The same stored family, auth-index and test-model aside.
        expect(strip(pageFinal)).toEqual(strip(upstreamFinal));
        // Where the list lands: both give the inheriting key its own; the third key still inherits.
        if (name !== 'openai-compatibility') {
          expect((pageFinal[0].keys as Doc[])[2]).toEqual(familyGroups(name)[0].keys![2 as never]);
          expect(pageFinal[0].models).toEqual(familyGroups(name)[0].models);
        }
        // Difference 1: one request per family, with If-Match; upstream one per entry, without.
        expect(page.puts).toHaveLength(1);
        expect(page.puts[0].ifMatch).toBe('"v1"');
        expect(old.puts).toHaveLength(2);
        expect(old.puts.every((p) => p.ifMatch === undefined)).toBe(true);
        // Difference 2: the page leaves test-model; upstream removes it from the family.
        expect(pageFinal.at(-1)).toEqual(familyGroups(name).at(-1));
        expect(JSON.stringify(upstreamFinal)).not.toContain('test-model');
      });
    });
  }

  test('difference 3: the Vertex name-only row is kept by both', async () => {
    const groups = [
      {
        name: 'vertex-1',
        keys: [
          {
            'api-key': 'fixture-key-1',
            models: [{ name: 'gemini-x' }, { name: 'gemini-y', alias: 'why' }],
          },
        ],
      },
    ];
    const doc = { 'api-keys': { vertex: groups } };
    const old = server(doc);
    const config = (
      normalizeProviderGroups(
        family(await apiClient.get<Doc>('/config'), 'vertex')
      ) as ProviderKeyConfig[]
    )[0];
    await providersApi.updateVertexConfig(config.apiKey, undefined, {
      ...config,
      models: at(1, (m) => ({ ...m, alias: 'why-not' }))(config.models!),
    });
    const page = server(doc);
    await aliasesApi.commit(
      changeRow(startDraft(await aliasesApi.load()), 'vertex/0/0#1', { alias: 'why-not' })
    );
    const expected = [{ name: 'gemini-x' }, { name: 'gemini-y', alias: 'why-not' }];
    expect((family(old.stored(), 'vertex')[0].keys as Doc[])[0].models).toEqual(expected);
    expect((family(page.stored(), 'vertex')[0].keys as Doc[])[0].models).toEqual(expected);
  });
});

// --- B-1 -----------------------------------------------------------------------------------

const loginDoc = () => ({
  'config-version': 8,
  oauth: {
    'model-alias': {
      claude: [
        { name: 'c1', alias: 'ca', fork: true, 'display-name': 'C A', 'x-unknown': 1 },
        { name: 'c2', alias: 'cb', 'force-mapping': false, openapi: true },
        { name: 'c3', alias: 'cc' },
      ],
      codex: [{ name: 'g1', alias: 'ga', 'display-name': 'G A' }],
      CODEX: [{ name: 'g2', alias: 'gb', fork: true }],
      kimi: [{ name: 'k1', alias: 'ka' }],
    },
  },
});

interface LoginOp {
  label: string;
  /** channel -> the old editor's new list for it (null: the channel is deleted). */
  old: Record<string, (list: OAuthModelAliasEntry[]) => OAuthModelAliasEntry[] | null>;
  page: (draft: AliasDraft) => AliasDraft;
}
const LOGIN_OPS: LoginOp[] = [
  {
    label: 'change an alias',
    old: { claude: (l) => l.map((e, i) => (i === 1 ? { ...e, alias: 'cb2' } : e)) },
    page: (d) => changeRow(d, 'login/claude#1', { alias: 'cb2' }),
  },
  {
    label: 'add a row',
    old: { claude: (l) => [...l, { name: 'c4', alias: 'cd', fork: true }] },
    page: (d) => addLoginAlias(d, 'claude', { upstream: 'c4', alias: 'cd' }),
  },
  {
    label: 'remove a row',
    old: { claude: (l) => l.filter((_, i) => i !== 0) },
    page: (d) => removeRow(d, 'login/claude#0'),
  },
  {
    label: 'set and unset force-mapping, unset fork',
    old: {
      claude: (l) =>
        l.map((e, i) =>
          i === 2 ? { ...e, forceMapping: true } : i === 0 ? { ...e, fork: false } : e
        ),
    },
    page: (d) =>
      changeRow(changeRow(d, 'login/claude#2', { forceMapping: true }), 'login/claude#0', {
        fork: false,
      }),
  },
  {
    label: 'a channel in two spellings',
    old: { codex: (l) => l.map((e, i) => (i === 1 ? { ...e, alias: 'gb2' } : e)) },
    page: (d) => changeRow(d, 'login/codex#1', { alias: 'gb2' }),
  },
  {
    label: 'remove a channel’s last row',
    old: { kimi: () => null },
    page: (d) => removeRow(d, 'login/kimi#0'),
  },
  {
    label: 'two channels at once',
    old: {
      claude: (l) => l.map((e, i) => (i === 1 ? { ...e, alias: 'cb2' } : e)),
      kimi: (l) => [...l, { name: 'k2', alias: 'kb', fork: true }],
    },
    page: (d) =>
      addLoginAlias(changeRow(d, 'login/claude#1', { alias: 'cb2' }), 'kimi', {
        upstream: 'k2',
        alias: 'kb',
      }),
  },
];

/** Rows as the old editor knows them: name, alias, fork, force-mapping. */
const known = (map: Record<string, Doc[]>) =>
  Object.fromEntries(
    Object.entries(map).map(([channel, rows]) => [
      channel,
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) =>
            ['name', 'alias', 'fork', 'force-mapping'].includes(key)
          )
        )
      ),
    ])
  );

describe('B-1 equality with the old editor, store B', () => {
  test.each(LOGIN_OPS.map((op) => [op.label, op] as const))('%s', async (_label, op) => {
    const old = server(loginDoc());
    const current = await authFilesApi.getOauthModelAlias();
    for (const [channel, edit] of Object.entries(op.old)) {
      const next = edit(current[channel] ?? []);
      if (next === null) await authFilesApi.deleteOauthModelAlias(channel);
      else await authFilesApi.saveOauthModelAlias(channel, next);
    }
    const page = server(loginDoc());
    const outcome = await aliasesApi.commit(op.page(startDraft(await aliasesApi.load())));
    expect(outcome.failed).toEqual([]);

    const oldMap = loginMap(old.stored());
    const pageMap = loginMap(page.stored());
    expect(known(pageMap)).toEqual(known(oldMap));
    // Difference 3: one request for all channels, with If-Match; the old editor one per channel.
    expect(page.puts).toHaveLength(1);
    expect(page.puts[0].ifMatch).toBe('"v1"');
    expect(old.puts).toHaveLength(Object.keys(op.old).length);
    expect(old.puts.every((p) => p.ifMatch === undefined)).toBe(true);
  });

  test('difference 1: the page keeps display-name, openapi and unknown fields; the old editor drops them', async () => {
    const old = server(loginDoc());
    const current = await authFilesApi.getOauthModelAlias();
    await authFilesApi.saveOauthModelAlias('claude', [
      ...current.claude,
      { name: 'c4', alias: 'cd' },
    ]);
    const page = server(loginDoc());
    await aliasesApi.commit(
      addLoginAlias(startDraft(await aliasesApi.load()), 'claude', {
        upstream: 'c4',
        alias: 'cd',
        fork: false,
      })
    );
    const stored = loginDoc().oauth['model-alias'].claude;
    expect(loginMap(page.stored()).claude).toEqual([...stored, { name: 'c4', alias: 'cd' }]);
    expect(loginMap(old.stored()).claude).toEqual([
      { name: 'c1', alias: 'ca', fork: true },
      { name: 'c2', alias: 'cb', 'force-mapping': false },
      { name: 'c3', alias: 'cc' },
      { name: 'c4', alias: 'cd' },
    ]);
  });

  test('difference 2: rows the proxy ignores block the page; the old editor drops them silently', async () => {
    const doc = fixture('config-full.json');
    const page = server(doc);
    const draft = changeRow(startDraft(await aliasesApi.load()), 'login/claude#0', {
      alias: 'opus-l',
    });
    page.log.length = 0;
    expect(await aliasesApi.commit(draft)).toEqual({
      done: [],
      failed: [{ entryId: 'login/claude', reason: 'invalid', message: BLOCKED_MESSAGE }],
    });
    expect(page.log).toEqual([]);

    const old = server(doc);
    const current = await authFilesApi.getOauthModelAlias();
    await authFilesApi.saveOauthModelAlias(
      'claude',
      current.claude.map((e, i) => (i === 0 ? { ...e, alias: 'opus-l' } : e))
    );
    // It drops the incomplete row and the duplicate while reading, and writes the same-name row,
    // which the proxy then ignores.
    expect(loginMap(old.stored()).claude).toEqual([
      { name: 'claude-opus-5-5', alias: 'opus-l', fork: true, 'force-mapping': false },
      { name: 'claude-sonnet-5', alias: 'claude-sonnet-5' },
    ]);
  });
});

// --- C-1, C-2 ------------------------------------------------------------------------------

describe('C-1 commit', () => {
  const edits = (draft: AliasDraft) => {
    let next = changeRow(draft, 'gemini/0/0#0', { alias: 'gp' });
    next = changeRow(next, 'claude/0/0#2', { alias: 'haiku' });
    next = changeRow(next, 'claude/1/0#0', { alias: 'opus-own' });
    return changeRow(next, 'login/codex#0', { alias: 'g55-b' });
  };

  test('units in order, one after the other; a family’s entries in one put', async () => {
    const s = server(fixture('config-full.json'));
    const draft = edits(startDraft(await aliasesApi.load()));
    expect(planCommit(draft)).toEqual([
      { store: 'api-key', family: 'gemini', entryIds: ['gemini/0/0'] },
      { store: 'api-key', family: 'claude', entryIds: ['claude/0/0', 'claude/1/0'] },
      { store: 'login', entryIds: ['login/codex'] },
    ]);
    s.log.length = 0;
    expect(await aliasesApi.commit(draft)).toEqual({
      done: ['gemini/0/0', 'claude/0/0', 'claude/1/0', 'login/codex'],
      failed: [],
    });
    expect(s.log).toEqual([
      'read /config',
      'put /config/api-keys/gemini start',
      'put /config/api-keys/gemini end',
      'read /config',
      'put /config/api-keys/claude start',
      'put /config/api-keys/claude end',
      'read /config',
      'put /config/oauth/model-alias start',
      'put /config/oauth/model-alias end',
    ]);
  });

  test('a failing unit is reported, the next still runs; rebase carries the edits of entries not written', async () => {
    const s = server(fixture('config-full.json'));
    const draft = edits(startDraft(await aliasesApi.load()));
    s.failPut = (put) => {
      if (put.path.endsWith('/claude')) throw httpError(500, 'server exploded');
    };
    const outcome = await aliasesApi.commit(draft);
    expect(outcome).toEqual({
      done: ['gemini/0/0', 'login/codex'],
      failed: [
        { entryId: 'claude/0/0', reason: 'error', message: 'server exploded' },
        { entryId: 'claude/1/0', reason: 'error', message: 'server exploded' },
      ],
    });
    const fresh = await aliasesApi.load();
    const rebased = rebase(draft, fresh, outcome.done);
    expect(rebased.carried).toEqual({ 'claude/0/0': 'claude/0/0', 'claude/1/0': 'claude/1/0' });
    expect(rebased.lost).toEqual([]);
    const next = rebased.draft;
    const alias = (id: string) => next.rows.find((r) => r.id === id)!.alias;
    expect(alias('claude/0/0#2')).toBe('haiku');
    expect(alias('claude/1/0#0')).toBe('opus-own');
    expect(alias('gemini/0/0#0')).toBe('gp');
    expect(next.base.rows.find((r) => r.id === 'gemini/0/0#0')!.alias).toBe('gp');
    expect(planCommit(next).map((u) => u.entryIds)).toEqual([['claude/0/0', 'claude/1/0']]);
  });

  test('a 400 or 422 is invalid, with the server’s message', async () => {
    const s = server(fixture('config-full.json'));
    s.failPut = () => {
      throw httpError(422, 'invalid_config: bad row', 'invalid_config');
    };
    const draft = changeRow(startDraft(await aliasesApi.load()), 'xai/0/0#0', { alias: 'g' });
    expect(await aliasesApi.commit(draft)).toEqual({
      done: [],
      failed: [{ entryId: 'xai/0/0', reason: 'invalid', message: 'invalid_config: bad row' }],
    });
  });
});

describe('C-2 If-Match and conflicts', () => {
  let s: ReturnType<typeof server>;
  beforeEach(() => {
    s = server(fixture('config-full.json'));
  });
  const twoUnits = (draft: AliasDraft) =>
    changeRow(changeRow(draft, 'xai/0/0#0', { alias: 'g' }), 'login/codex#1', { alias: 'g54-b' });

  test('every put carries If-Match with the ETag of its unit’s read', async () => {
    await aliasesApi.commit(twoUnits(startDraft(await aliasesApi.load())));
    expect(s.puts.map((p) => [p.path, p.ifMatch])).toEqual([
      ['/config/api-keys/xai', '"v1"'],
      ['/config/oauth/model-alias', '"v2"'],
    ]);
  });

  test('none when the header is missing', async () => {
    s.sendEtag = false;
    const state = await aliasesApi.load();
    expect(state.etag).toBeNull();
    await aliasesApi.commit(twoUnits(startDraft(state)));
    expect(s.puts.map((p) => p.ifMatch)).toEqual([undefined, undefined]);
    expect(s.puts).toHaveLength(2);
  });

  test('a 412: the unit is read and written once more, and succeeds when its entries are unchanged', async () => {
    const draft = twoUnits(startDraft(await aliasesApi.load()));
    let once = true;
    s.beforePut = () => {
      if (!once) return;
      once = false;
      s.edit((doc) => {
        (doc.routing as Doc).strategy = 'fill-first';
      });
    };
    s.log.length = 0;
    expect(await aliasesApi.commit(draft)).toEqual({
      done: ['xai/0/0', 'login/codex'],
      failed: [],
    });
    expect(s.log.slice(0, 6)).toEqual([
      'read /config',
      'put /config/api-keys/xai start',
      'put /config/api-keys/xai 412',
      'read /config',
      'put /config/api-keys/xai start',
      'put /config/api-keys/xai end',
    ]);
    expect((s.stored().routing as Doc).strategy).toBe('fill-first');
  });

  test('a second 412 fails the unit’s entries as conflict; the next unit still runs', async () => {
    const draft = twoUnits(startDraft(await aliasesApi.load()));
    s.beforePut = (put) => {
      if (put.path.endsWith('/xai')) s.edit((doc) => ((doc.routing as Doc).strategy = 'x'));
    };
    const outcome = await aliasesApi.commit(draft);
    expect(outcome.done).toEqual(['login/codex']);
    expect(outcome.failed.map((f) => [f.entryId, f.reason])).toEqual([['xai/0/0', 'conflict']]);
    expect(s.puts.filter((p) => p.path.endsWith('/xai'))).toHaveLength(2);
  });

  test('a group changed since load: its entries conflict, the family’s others are written', async () => {
    let draft = startDraft(await aliasesApi.load());
    draft = changeRow(draft, 'claude/0/0#0', { alias: 'o1' });
    draft = changeRow(draft, 'claude/0/1#0', { alias: 'o2' });
    draft = changeRow(draft, 'claude/1/0#0', { alias: 'o3' });
    s.edit((doc) => {
      ((family(doc, 'claude')[0].keys as Doc[])[1] as Doc).weight = 5;
    });
    const outcome = await aliasesApi.commit(draft);
    expect(outcome.done).toEqual(['claude/1/0']);
    expect(outcome.failed.map((f) => [f.entryId, f.reason])).toEqual([
      ['claude/0/0', 'conflict'],
      ['claude/0/1', 'conflict'],
    ]);
    const claude = family(s.stored(), 'claude');
    expect(((claude[0].keys as Doc[])[1] as Doc).weight).toBe(5);
    expect(((claude[1].keys as Doc[])[0].models as Doc[])[0].alias).toBe('o3');
  });

  test('a group found at another index is written there', async () => {
    const draft = changeRow(startDraft(await aliasesApi.load()), 'claude/1/0#0', { alias: 'o3' });
    s.edit((doc) => {
      family(doc, 'claude').unshift({ name: 'new', keys: [{ 'api-key': 'fixture-key-new' }] });
    });
    expect((await aliasesApi.commit(draft)).done).toEqual(['claude/1/0']);
    expect(((family(s.stored(), 'claude')[2].keys as Doc[])[0].models as Doc[])[0].alias).toBe(
      'o3'
    );
  });

  test('locate and sameChannel ignore the auth indexes the proxy injects', async () => {
    const state = await aliasesApi.load();
    const entry = state.entries.find((e) => e.id === 'claude/0/1')!;
    if (entry.store !== 'api-key') throw new Error('not a key entry');
    const fresh = clone(family(s.stored(), 'claude'));
    const keys = fresh[0].keys as Doc[];
    keys[0].auth_index = 'ai-claude-1-after-reload';
    delete keys[1].auth_index;
    keys[1]['auth-index'] = 'ai-claude-2';
    expect(locate(fresh, entry)).toBe(0);
    (keys[0] as Doc).weight = 2;
    expect(locate(fresh, entry)).toBe(-1);
    const codex = state.entries.find((e) => e.id === 'login/codex')!;
    if (codex.store !== 'login') throw new Error('not a login entry');
    const map = clone(loginMap(s.stored())) as Record<string, Doc[]>;
    map.codex[0].auth_index = 'x';
    expect(sameChannel(map, codex)).toBe(true);
  });

  test('a changed auth_index alone since load: no conflict, the write lands', async () => {
    const draft = changeRow(startDraft(await aliasesApi.load()), 'claude/0/1#0', { alias: 'o2' });
    s.edit((doc) => {
      ((family(doc, 'claude')[0].keys as Doc[])[0] as Doc).auth_index = 'ai-claude-1-new';
      delete ((family(doc, 'claude')[1].keys as Doc[])[1] as Doc).auth_index;
    });
    expect(await aliasesApi.commit(draft)).toEqual({ done: ['claude/0/1'], failed: [] });
    expect(s.puts).toHaveLength(1);
  });

  test('every entry of a unit in conflict: no put', async () => {
    const draft = changeRow(startDraft(await aliasesApi.load()), 'gemini/0/0#0', { alias: 'gp' });
    s.edit((doc) => {
      family(doc, 'gemini')[0].name = 'renamed';
    });
    expect(await aliasesApi.commit(draft)).toEqual({
      done: [],
      failed: [
        {
          entryId: 'gemini/0/0',
          reason: 'conflict',
          message: expect.any(String) as unknown as string,
        },
      ],
    });
    expect(s.puts).toEqual([]);
  });

  test('a channel changed since load: conflict; other channels written', async () => {
    let draft = startDraft(await aliasesApi.load());
    draft = changeRow(draft, 'login/codex#1', { alias: 'g54-b' });
    draft = addLoginAlias(draft, 'kimi', { upstream: 'k1', alias: 'ka' });
    s.edit((doc) => {
      loginMap(doc).CODEX.push({ name: 'gpt-5.3', alias: 'g53' });
    });
    const outcome = await aliasesApi.commit(draft);
    expect(outcome.done).toEqual(['login/kimi']);
    expect(outcome.failed.map((f) => [f.entryId, f.reason])).toEqual([['login/codex', 'conflict']]);
    expect(loginMap(s.stored()).CODEX).toHaveLength(2);
    expect(loginMap(s.stored()).kimi).toEqual([{ name: 'k1', alias: 'ka', fork: true }]);
  });

  test('a connection change during the commit aborts it', async () => {
    let revision = 1;
    apiClient.getConnectionRevision = () => revision;
    const draft = twoUnits(startDraft(await aliasesApi.load()));
    s.beforePut = () => {
      revision += 1;
    };
    s.log.length = 0;
    await expect(aliasesApi.commit(draft)).rejects.toMatchObject({ name: 'AbortError' });
    // The first unit's put was already sent; nothing after it.
    expect(s.log).toEqual([
      'read /config',
      'put /config/api-keys/xai start',
      'put /config/api-keys/xai end',
    ]);
  });

  test('a connection change before a unit’s write: no write', async () => {
    let revision = 1;
    apiClient.getConnectionRevision = () => revision;
    const draft = twoUnits(startDraft(await aliasesApi.load()));
    const getRaw = apiClient.getRaw;
    apiClient.getRaw = (async (path: string) => {
      const answer = await getRaw(path);
      revision += 1;
      return answer;
    }) as typeof apiClient.getRaw;
    await expect(aliasesApi.commit(draft)).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.puts).toEqual([]);
  });

  test('a draft with a blocking issue: no request at all', async () => {
    const draft = addLoginAlias(
      changeRow(startDraft(await aliasesApi.load()), 'xai/0/0#0', { alias: 'g' }),
      'kimi',
      { upstream: 'k1', alias: '' }
    );
    s.log.length = 0;
    const outcome = await aliasesApi.commit(draft);
    expect(outcome.done).toEqual([]);
    expect(outcome.failed.map((f) => [f.entryId, f.reason])).toEqual([['login/kimi', 'invalid']]);
    expect(s.log).toEqual([]);
  });
});

describe('load', () => {
  test('reads /config and the credentials list, never a login file', async () => {
    const s = server(fixture('config-full.json'));
    const state = await aliasesApi.load();
    expect(state.etag).toBe('"v1"');
    expect(s.log.sort()).toEqual(['get /credentials', 'read /config']);
  });

  test('a failing credentials list leaves login counts null', async () => {
    server(fixture('config-full.json'));
    const get = apiClient.get;
    apiClient.get = (async (path: string) => {
      if (path === '/credentials') throw httpError(500, 'down');
      return get(path);
    }) as typeof apiClient.get;
    const state = await aliasesApi.load();
    expect(
      state.entries.flatMap((e) => (e.store === 'login' ? [[e.channel, e.loginCount]] : []))
    ).toEqual([
      ['claude', null],
      ['codex', null],
    ]);
  });
});

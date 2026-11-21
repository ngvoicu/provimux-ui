import { afterEach, describe, expect, test } from 'bun:test';
import {
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
import { planCommit } from '@/provimux/pages/aliases/plan';
import type { AliasDraft } from '@/provimux/pages/aliases/types';
import type {
  ModelAlias,
  OAuthModelAliasEntry,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';

/* ALP-03 W4, W7: tests R-2, R-3, A-1, B-1 and the write side of O-2 and O-6. The save itself (C-*, W-*):
 * aliases-save.test.ts. */

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
    expect(await aliasesApi.commit(draft)).toEqual({
      confirmed: [],
      unconfirmed: [],
      failure: null,
    });
    expect(s.log).toEqual([]);
  });

  test('one alias change: every other row, key, group and field is as stored', async () => {
    const doc = fixture('config-full.json');
    const s = server(doc);
    const draft = changeRow(startDraft(await aliasesApi.load()), 'claude/0/0#2', {
      alias: 'haiku',
    });
    expect(await aliasesApi.commit(draft)).toEqual({
      confirmed: ['claude/0/0'],
      unconfirmed: [],
      failure: null,
    });
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
    expect((await aliasesApi.commit(draft)).confirmed).toEqual(['gemini/0/0', 'vertex/0/0']);
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
    expect(await aliasesApi.commit(draft)).toEqual({
      confirmed: ['login/codex'],
      unconfirmed: [],
      failure: null,
    });
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
    expect(await aliasesApi.commit(draft)).toEqual({
      confirmed: ['login/gemini-cli'],
      unconfirmed: [],
      failure: null,
    });
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
        expect(outcome).toEqual({
          confirmed: changedEntries(name),
          unconfirmed: [],
          failure: null,
        });
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
    expect(outcome.failure).toBeNull();

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
      confirmed: [],
      unconfirmed: ['login/claude'],
      failure: { reason: 'blocked', message: BLOCKED_MESSAGE },
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

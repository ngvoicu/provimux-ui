import { afterEach, describe, expect, test } from 'bun:test';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import type { AuthFilesResponse } from '@/types/authFile';
import { aliasesApi } from '@/provimux/pages/aliases/aliasesApi';
import { nameGroups } from '@/provimux/pages/aliases/collisions';
import {
  addKeyAlias,
  addLoginAlias,
  changeRow,
  rowIssues,
  startDraft,
} from '@/provimux/pages/aliases/draft';
import { planCommit } from '@/provimux/pages/aliases/plan';
import { rebase } from '@/provimux/pages/aliases/rebase';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import type { AliasDraft, AliasEntry, AliasState } from '@/provimux/pages/aliases/types';
import {
  clone,
  family,
  fixture,
  loginMap,
  restoreClient,
  server,
  type Doc,
} from '../helpers/aliasesStore';

/* ALP-03, design aliases-page.md 2.5: what the page cannot read. Tests X-1 … X-6. */

afterEach(restoreClient);

const files = () =>
  normalizeAuthFilesResponse(fixture('credentials.json') as unknown as AuthFilesResponse).files;
const keys = (doc: Doc, name: string, group: number) => family(doc, name)[group].keys as Doc[];

interface Case {
  label: string;
  bad: (doc: Doc) => void;
  path: string;
  /** Entries the bad part takes away or changes; every other entry and row must be as before. */
  affected: (entry: AliasEntry) => boolean;
}

/** One case per line of the table of 2.5 (both stores where the line has both). */
const CASES: Case[] = [
  {
    label: 'a family present and not a list',
    bad: (d) => void ((d['api-keys'] as Doc).meta = { oops: 1 }),
    path: 'api-keys.meta',
    affected: (e) => e.store === 'api-key' && e.family === 'meta',
  },
  {
    label: 'a group that is not an object',
    bad: (d) => void family(d, 'claude').push('junk-group' as never),
    path: 'api-keys.claude[2]',
    affected: () => false,
  },
  {
    label: 'a group without a keys list',
    bad: (d) => void family(d, 'claude').push({ name: 'claude-no-keys' }),
    path: 'api-keys.claude[2]',
    affected: () => false,
  },
  {
    label: 'a key the normalizer gives nothing for',
    bad: (d) => void keys(d, 'claude', 1).push({ 'api-key': '' }),
    path: 'api-keys.claude[1].keys[2]',
    affected: (e) => e.store === 'api-key' && e.family === 'claude' && e.groupIndex === 1,
  },
  {
    label: 'an OpenAI-compatible entry the normalizer gives nothing for',
    bad: (d) =>
      void family(d, 'openai-compatibility').push({
        name: 'no-base',
        keys: [{ 'api-key': 'fixture-key-x' }],
      }),
    path: 'api-keys.openai-compatibility[3]',
    affected: () => false,
  },
  {
    label: 'a model list present and not a list',
    bad: (d) => void (keys(d, 'xai', 0)[0].models = 'grok-5'),
    path: 'api-keys.xai[0].keys[0].models',
    affected: (e) => e.id === 'xai/0/0',
  },
  {
    label: 'a channel’s list present and not a list',
    bad: (d) => void (loginMap(d).kimi = 'not-a-list' as never),
    path: 'oauth.model-alias.kimi',
    affected: (e) => e.id === 'login/kimi',
  },
  {
    label: 'an element of a model list that is not an object with a name',
    bad: (d) => void (keys(d, 'xai', 0)[0].models as unknown[]).push(7),
    path: 'api-keys.xai[0].keys[0].models[1]',
    affected: (e) => e.id === 'xai/0/0',
  },
  {
    label: 'an element of a channel’s list that is not an object',
    bad: (d) => void (loginMap(d).codex as unknown[]).push('x'),
    path: 'oauth.model-alias.codex[1]',
    affected: (e) => e.id === 'login/codex',
  },
  {
    label: 'oauth.model-alias present and not a map',
    bad: (d) => void ((d.oauth as Doc)['model-alias'] = 'x'),
    path: 'oauth.model-alias',
    affected: (e) => e.store === 'login',
  },
  {
    label: 'oauth present and not a map',
    bad: (d) => void (d.oauth = ['x']),
    path: 'oauth',
    affected: (e) => e.store === 'login',
  },
];

/** An entry without its stored content (which an appended bad part changes) for comparison. */
const shape = (entry: AliasEntry) => {
  const rest: Record<string, unknown> = { ...entry };
  delete rest.storedGroup;
  delete rest.storedList;
  return rest;
};

describe('X-1 the rule, one case per line', () => {
  const good = readAliasState(fixture('config-full.json'), files());
  test.each(CASES.map((c) => [c.label, c] as const))('%s', (_label, c) => {
    const doc = fixture('config-full.json');
    c.bad(doc);
    let state: AliasState | undefined;
    expect(() => (state = readAliasState(doc, files()))).not.toThrow();
    const bad = state!;
    expect(bad.unread.filter((path) => !good.unread.includes(path))).toEqual([c.path]);
    expect(good.unread.filter((path) => !bad.unread.includes(path))).toEqual(
      c.path === 'oauth.model-alias' || c.path === 'oauth' ? ['oauth.model-alias.claude[4]'] : []
    );
    const others = (s: AliasState) => s.entries.filter((e) => !c.affected(e));
    expect(others(bad).map(shape)).toEqual(others(good).map(shape));
    const otherIds = new Set(others(good).map((e) => e.id));
    expect(bad.rows.filter((r) => otherIds.has(r.entryId))).toEqual(
      good.rows.filter((r) => otherIds.has(r.entryId))
    );
  });

  test('what the affected entries become', () => {
    const read = (c: number) => {
      const doc = fixture('config-full.json');
      CASES[c].bad(doc);
      return readAliasState(doc, files());
    };
    expect(read(0).entries.some((e) => e.store === 'api-key' && e.family === 'meta')).toBe(false);
    const xai = read(5);
    expect(xai.entries.find((e) => e.id === 'xai/0/0')).toMatchObject({ listSource: 'none' });
    expect(xai.rows.filter((r) => r.entryId === 'xai/0/0')).toEqual([]);
    expect(read(6).entries.find((e) => e.id === 'login/kimi')).toMatchObject({ unread: true });
    for (const c of [9, 10]) {
      const s = read(c);
      const logins = s.entries.filter((e) => e.store === 'login');
      expect(logins.length).toBeGreaterThan(0);
      expect(logins.every((e) => e.store === 'login' && e.unread)).toBe(true);
      expect(s.rows.some((r) => r.store === 'login')).toBe(false);
    }
  });
});

describe('X-2 load', () => {
  test.each(CASES.map((c) => [c.label, c] as const))('%s: load() resolves', async (_l, c) => {
    const doc = fixture('config-full.json');
    c.bad(doc);
    server(doc);
    const state = await aliasesApi.load();
    expect(state.unread).toContain(c.path);
  });
  test('config-unreadable: every kind at once', async () => {
    server(fixture('config-unreadable.json'));
    const state = await aliasesApi.load();
    expect(state.unread).toEqual([
      'api-keys.claude[1].keys[2]',
      'api-keys.claude[2]',
      'api-keys.claude[3]',
      'api-keys.claude[1].keys[0].models[1]',
      'api-keys.claude[1].keys[0].models[2]',
      'api-keys.xai[0].keys[0].models',
      'api-keys.meta',
      'api-keys.openai-compatibility[3]',
      'oauth.model-alias.kimi',
      'oauth.model-alias.claude[4]',
    ]);
  });
});

describe('X-3 an unreadable part beside a write stays as it is, in its place', () => {
  test('groups, a key and elements of store A', async () => {
    const doc = fixture('config-unreadable.json');
    const s = server(doc);
    let draft = startDraft(await aliasesApi.load());
    draft = changeRow(draft, 'claude/0/0#0', { alias: 'o1' });
    draft = changeRow(draft, 'claude/1/0#0', { alias: 'o3' });
    expect(await aliasesApi.commit(draft)).toEqual({
      done: ['claude/0/0', 'claude/1/0'],
      failed: [],
    });
    const body = s.puts[0].body as unknown[];
    const before = family(doc, 'claude');
    expect(body).toHaveLength(4);
    expect(body[2]).toBe('junk-group');
    expect(body[3]).toEqual(before[3]);
    const group1 = body[1] as Doc;
    expect((group1.keys as Doc[])[2]).toEqual(keys(doc, 'claude', 1)[2]);
    expect((group1.keys as Doc[])[0].models).toEqual([
      { name: 'claude-opus-5-5', alias: 'o3' },
      'stray-string',
      { name: '  ', alias: 'no-name' },
      { name: 'claude-opus-5-5', alias: ' ' },
    ]);
    // Families the page cannot read are never written.
    expect(s.puts.map((p) => p.path)).toEqual(['/config/api-keys/claude']);
    expect((s.stored()['api-keys'] as Doc).meta).toEqual((doc['api-keys'] as Doc).meta);
  });

  test('a channel and elements of store B', async () => {
    const doc = fixture('config-unreadable.json');
    const s = server(doc);
    const draft = changeRow(startDraft(await aliasesApi.load()), 'login/codex#0', {
      alias: 'g55-b',
    });
    expect(await aliasesApi.commit(draft)).toEqual({ done: ['login/codex'], failed: [] });
    const body = s.puts[0].body as Doc;
    expect(body.kimi).toBe('not-a-list');
    expect(body.claude).toEqual(loginMap(doc).claude);
    expect((body.claude as unknown[])[4]).toBe('stray-string');
  });
});

describe('X-4 nothing can be added to what cannot be read', () => {
  test('an unreadable model list, an unreadable channel', async () => {
    server(fixture('config-unreadable.json'));
    const draft = startDraft(await aliasesApi.load());
    expect(addKeyAlias(draft, 'xai/0/0', 'grok-5', 'g')).toBe(draft);
    expect(addLoginAlias(draft, 'kimi', { upstream: 'k', alias: 'ka' })).toBe(draft);
    expect(addLoginAlias(draft, 'codex', { upstream: 'g', alias: 'ga' })).not.toBe(draft);
  });

  test('every channel when the map is unreadable', () => {
    for (const bad of [CASES[9], CASES[10]]) {
      const doc = fixture('config-full.json');
      bad.bad(doc);
      const draft = startDraft(readAliasState(doc, files()));
      for (const channel of ['claude', 'codex', 'kimi', 'qwen']) {
        expect(addLoginAlias(draft, channel, { upstream: 'm', alias: 'a' })).toBe(draft);
      }
    }
  });
});

describe('X-5 made unreadable between load and commit', () => {
  const change = (rowId: string) => (draft: AliasDraft) => changeRow(draft, rowId, { alias: 'zz' });
  const qwen = (draft: AliasDraft) => addLoginAlias(draft, 'qwen', { upstream: 'q', alias: 'qq' });
  const cases: [string, (d: AliasDraft) => AliasDraft, string, (d: Doc) => void][] = [
    [
      'a family',
      change('claude/1/0#0'),
      'claude/1/0',
      (d) => void ((d['api-keys'] as Doc).claude = { x: 1 }),
    ],
    ['api-keys itself', change('claude/1/0#0'), 'claude/1/0', (d) => void (d['api-keys'] = 'x')],
    [
      'the map',
      change('login/codex#0'),
      'login/codex',
      (d) => void ((d.oauth as Doc)['model-alias'] = 'x'),
    ],
    ['oauth itself', change('login/codex#0'), 'login/codex', (d) => void (d.oauth = 7)],
    [
      'a spelling of the channel',
      change('login/codex#0'),
      'login/codex',
      (d) => void (loginMap(d).CODEX = 'x' as never),
    ],
    // The stored list still matches here: only the readability check stops the write.
    [
      'a new junk spelling of the channel',
      change('login/codex#0'),
      'login/codex',
      (d) => void (loginMap(d).Codex = 'x' as never),
    ],
    [
      'the map, for a new channel',
      qwen,
      'login/qwen',
      (d) => void ((d.oauth as Doc)['model-alias'] = 'x'),
    ],
    ['oauth, for a new channel', qwen, 'login/qwen', (d) => void (d.oauth = 'x')],
  ];
  test.each(cases)('%s: conflict, no put, no throw', async (_l, page, entryId, bad) => {
    const s = server(fixture('config-full.json'));
    const draft = page(startDraft(await aliasesApi.load()));
    s.edit(bad);
    const before = clone(s.stored());
    const outcome = await aliasesApi.commit(draft);
    expect(outcome.done).toEqual([]);
    expect(outcome.failed.map((f) => [f.entryId, f.reason])).toEqual([[entryId, 'conflict']]);
    expect(s.puts).toEqual([]);
    expect(s.stored()).toEqual(before);
  });
});

describe('3.6 with 2.5: rebase carries only onto a readable channel', () => {
  test.each([
    ['a junk spelling beside the channel', (d: Doc) => void (loginMap(d).Codex = 'x' as never)],
    ['the map', (d: Doc) => void ((d.oauth as Doc)['model-alias'] = 'x')],
  ])('%s: lost', async (_l, bad) => {
    const s = server(fixture('config-full.json'));
    const draft = changeRow(startDraft(await aliasesApi.load()), 'login/codex#0', { alias: 'zz' });
    s.edit(bad);
    const rebased = rebase(draft, await aliasesApi.load(), []);
    expect(rebased.carried).toEqual({});
    expect(rebased.lost.map((l) => l.entry.id)).toEqual(['login/codex']);
  });
});

describe('X-6 junk at every level', () => {
  const JUNK: unknown[] = [null, 0, 'x', [], {}, [null]];
  const at = (d: Doc): Record<string, (v: unknown) => void> => ({
    'api-keys': (v) => void (d['api-keys'] = v),
    family: (v) => void ((d['api-keys'] as Doc).claude = v),
    group: (v) => void (family(d, 'claude')[0] = v as Doc),
    keys: (v) => void (family(d, 'claude')[0].keys = v),
    key: (v) => void (keys(d, 'claude', 0)[0] = v as Doc),
    models: (v) => void (family(d, 'claude')[0].models = v),
    row: (v) => void ((family(d, 'claude')[0].models as unknown[])[0] = v),
    oauth: (v) => void (d.oauth = v),
    'model-alias': (v) => void ((d.oauth as Doc)['model-alias'] = v),
    channel: (v) => void (loginMap(d).claude = v as never),
  });
  const LEVELS = ['document', ...Object.keys(at({}))];
  test.each(LEVELS)('%s', (level) => {
    for (const junk of JUNK) {
      const doc = fixture('config-full.json');
      const input = level === 'document' ? junk : (at(doc)[level](clone(junk)), doc);
      expect(() => {
        const state = readAliasState(input, files());
        const draft = startDraft(state);
        rowIssues(draft);
        nameGroups(draft);
        planCommit(draft);
      }).not.toThrow();
    }
  });
});

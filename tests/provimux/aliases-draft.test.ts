import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiClient } from '@/services/api/client';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import {
  addKeyAlias,
  addLoginAlias,
  changeRow,
  discard,
  draftEntries,
  removeRow,
  rowIssues,
  startDraft,
} from '@/provimux/pages/aliases/draft';
import { clientNames, groupOfRow, nameGroups } from '@/provimux/pages/aliases/collisions';
import type {
  AliasDraft,
  AliasEntry,
  AliasRow,
  AliasState,
  KeyEntry,
  LoginEntry,
} from '@/provimux/pages/aliases/types';

/* ALP-03 W3: tests O-1 … O-6 (draft side), I-1, N-1, N-2 (design aliases-page.md 3, 3.5, 4). */

// Pure: any request fails the test.
const methods = ['get', 'getRaw', 'put', 'patch', 'post', 'delete'] as const;
const saved = methods.map((method) => [method, apiClient[method]] as const);
beforeAll(() => {
  for (const method of methods) {
    (apiClient as unknown as Record<string, unknown>)[method] = () => {
      throw new Error(`request made: ${method}`);
    };
  }
});
afterAll(() => {
  for (const [method, fn] of saved) (apiClient as unknown as Record<string, unknown>)[method] = fn;
});

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/aliases/${name}`, 'utf8'));
const loaded = () => readAliasState(fixture('config-full.json'), [{ type: 'kimi' }]);
const rowsOf = (draft: AliasDraft, entryId: string) =>
  draft.rows
    .filter((row) => row.entryId === entryId)
    .map(({ id, upstream, alias }) => ({ id, upstream, alias }));
const row = (draft: AliasDraft, id: string) => draft.rows.find((r) => r.id === id)!;

describe('O operations', () => {
  test('O-1 change an alias; an API-key row changes alias and force-mapping only', () => {
    const draft = startDraft(loaded());
    const next = changeRow(draft, 'gemini/0/0#0', { alias: 'gemini-pro', forceMapping: true });
    expect(row(next, 'gemini/0/0#0')).toMatchObject({ alias: 'gemini-pro', forceMapping: true });
    expect(row(draft, 'gemini/0/0#0').alias).toBe('g-pro');
    expect(draft.base.rows.find((r) => r.id === 'gemini/0/0#0')!.alias).toBe('g-pro');
    const ignored = changeRow(draft, 'gemini/0/0#0', {
      upstream: 'other',
      fork: true,
      displayName: 'Other',
    });
    expect(row(ignored, 'gemini/0/0#0')).toEqual(row(draft, 'gemini/0/0#0'));
    // A login row: every field.
    const login = changeRow(draft, 'login/claude#0', {
      upstream: 'claude-opus-6',
      alias: 'opus-6',
      fork: false,
      displayName: 'Opus 6',
      forceMapping: true,
    });
    expect(row(login, 'login/claude#0')).toMatchObject({
      upstream: 'claude-opus-6',
      alias: 'opus-6',
      fork: false,
      displayName: 'Opus 6',
      forceMapping: true,
    });
    expect(changeRow(draft, 'no-such-row', { alias: 'x' })).toBe(draft);
  });

  test('O-2 clear an alias: empty or equal to the name is null, Vertex too', () => {
    const draft = startDraft(loaded());
    expect(row(changeRow(draft, 'vertex/0/0#2', { alias: '' }), 'vertex/0/0#2').alias).toBeNull();
    expect(
      row(changeRow(draft, 'vertex/0/0#2', { alias: ' gemini-y ' }), 'vertex/0/0#2').alias
    ).toBe(null);
    expect(row(changeRow(draft, 'claude/0/0#0', { alias: '  ' }), 'claude/0/0#0').alias).toBeNull();
  });

  test('O-3 addKeyAlias: after the model’s last row, no options copied; refusals', () => {
    const draft = startDraft(loaded());
    const next = addKeyAlias(draft, 'claude/1/0', 'claude-opus-5-5', 'opus-own');
    expect(rowsOf(next, 'claude/1/0')).toEqual([
      { id: 'claude/1/0#0', upstream: 'claude-opus-5-5', alias: 'opus' },
      { id: 'claude/1/0#3', upstream: 'claude-opus-5-5', alias: null },
      { id: 'claude/1/0#new-0', upstream: 'claude-opus-5-5', alias: 'opus-own' },
    ]);
    const added = addKeyAlias(draft, 'claude/0/0', 'claude-opus-5-5', 'opus-2');
    expect(rowsOf(added, 'claude/0/0').map((r) => r.id)).toEqual([
      'claude/0/0#0',
      'claude/0/0#new-0',
      'claude/0/0#1',
      'claude/0/0#2',
    ]);
    expect(row(added, 'claude/0/0#new-0')).toEqual({
      id: 'claude/0/0#new-0',
      entryId: 'claude/0/0',
      store: 'api-key',
      sourceIndex: null,
      upstream: 'claude-opus-5-5',
      alias: 'opus-2',
      fork: null,
      forceMapping: null,
      displayName: null,
    });
    expect(added.nextNew).toBe(1);
    // Refused: an upstream the entry does not list; an entry without a list; a login entry.
    expect(addKeyAlias(draft, 'claude/0/0', 'claude-unknown', 'x')).toBe(draft);
    expect(addKeyAlias(draft, 'interactions/0/0', 'gemini-2.5-pro', 'x')).toBe(draft);
    expect(addKeyAlias(draft, 'login/claude', 'claude-opus-5-5', 'x')).toBe(draft);
    // A new row's upstream can move to another model the entry lists, not to an unlisted one.
    const moved = changeRow(added, 'claude/0/0#new-0', { upstream: 'claude-haiku-5' });
    expect(row(moved, 'claude/0/0#new-0').upstream).toBe('claude-haiku-5');
    const unlisted = changeRow(added, 'claude/0/0#new-0', { upstream: 'claude-unknown' });
    expect(row(unlisted, 'claude/0/0#new-0').upstream).toBe('claude-opus-5-5');
  });

  test('O-4 removeRow: an extra row is deleted; a model’s only row keeps the model, loses the alias', () => {
    const draft = startDraft(loaded());
    const extra = removeRow(draft, 'claude/1/0#0');
    expect(rowsOf(extra, 'claude/1/0')).toEqual([
      { id: 'claude/1/0#3', upstream: 'claude-opus-5-5', alias: null },
    ]);
    const only = removeRow(draft, 'claude/0/0#0');
    expect(rowsOf(only, 'claude/0/0')[0]).toEqual({
      id: 'claude/0/0#0',
      upstream: 'claude-opus-5-5',
      alias: null,
    });
    expect(rowsOf(only, 'claude/0/0')).toHaveLength(3);
    const vertex = removeRow(draft, 'vertex/0/0#2');
    expect(rowsOf(vertex, 'vertex/0/0')[2]).toEqual({
      id: 'vertex/0/0#2',
      upstream: 'gemini-y',
      alias: null,
    });
  });

  test('O-5 addLoginAlias: fork true by default; a new channel', () => {
    const draft = startDraft(loaded());
    const next = addLoginAlias(draft, 'claude', { upstream: 'claude-haiku-5', alias: 'haiku' });
    expect(row(next, 'login/claude#new-0')).toEqual({
      id: 'login/claude#new-0',
      entryId: 'login/claude',
      store: 'login',
      sourceIndex: null,
      upstream: 'claude-haiku-5',
      alias: 'haiku',
      fork: true,
      forceMapping: null,
      displayName: null,
    });
    // After the channel's last row.
    const ids = next.rows.map((r) => r.id);
    expect(ids.indexOf('login/claude#new-0')).toBe(ids.indexOf('login/claude#3') + 1);
    expect(
      row(
        addLoginAlias(draft, 'claude', { upstream: 'a', alias: 'b', fork: false }),
        'login/claude#new-0'
      ).fork
    ).toBe(false);

    const fresh = addLoginAlias(draft, 'Gemini_CLI', { upstream: 'gemini-2.5-pro', alias: 'gp' });
    expect(row(fresh, 'login/gemini-cli#new-0').entryId).toBe('login/gemini-cli');
    const entries = draftEntries(fresh);
    expect(entries.map((e) => e.id)).toEqual([
      ...draft.base.entries.map((e) => e.id),
      'login/gemini-cli',
    ]);
    expect(entries.at(-1)).toEqual({
      store: 'login',
      id: 'login/gemini-cli',
      channel: 'gemini-cli',
      spellings: [],
      loginCount: null,
      service: 'login:gemini-cli',
      storedList: [],
    });
    expect(addLoginAlias(draft, '  ', { upstream: 'a', alias: 'b' })).toBe(draft);
  });

  test('O-6 remove a channel’s last row: the channel has no row left', () => {
    let draft = startDraft(loaded());
    for (const id of ['login/codex#0', 'login/codex#1']) draft = removeRow(draft, id);
    expect(rowsOf(draft, 'login/codex')).toEqual([]);
    expect(draftEntries(draft).some((e) => e.id === 'login/codex')).toBe(true);
  });

  test('discard', () => {
    const state = loaded();
    const edited = changeRow(
      changeRow(startDraft(state), 'gemini/0/0#0', { alias: 'gp' }),
      'xai/0/0#0',
      { alias: 'gk' }
    );
    const withNew = addLoginAlias(edited, 'qwen', { upstream: 'q', alias: 'qq' });
    const dropped = discard(withNew);
    expect(dropped.rows).toEqual(state.rows);
    expect(dropped.nextNew).toBe(1);
  });
});

describe('I-1 issues', () => {
  test('each issue, blocking or not; a blank new row has none', () => {
    let draft = startDraft(loaded());
    expect(rowIssues(draft)).toEqual({
      'login/claude#1': 'same-as-name',
      'login/claude#2': 'incomplete',
      'login/claude#3': 'duplicate',
    });
    draft = addLoginAlias(draft, 'codex', { upstream: '', alias: '' });
    draft = addLoginAlias(draft, 'codex', { upstream: 'gpt-5.5', alias: '' });
    draft = addLoginAlias(draft, 'codex', { upstream: 'GPT-5.5', alias: 'gpt-5.5 ' });
    draft = addLoginAlias(draft, 'codex', { upstream: 'gpt-5.3', alias: 'G55' });
    // Shadowed: an API-key row whose client name an earlier row of the entry already has.
    draft = addKeyAlias(draft, 'claude/1/0', 'claude-opus-5-5', 'OPUS');
    // Not shadowed: OpenAI-compatible pools its rows.
    const issues = rowIssues(draft);
    expect(issues['login/codex#new-0']).toBeUndefined();
    expect(issues['login/codex#new-1']).toBe('incomplete');
    expect(issues['login/codex#new-2']).toBe('same-as-name');
    expect(issues['login/codex#new-3']).toBe('duplicate');
    expect(issues['claude/1/0#new-4']).toBe('shadowed');
    expect(issues['openai-compatibility/0/g#1']).toBeUndefined();
    // A stored row with neither name nor alias is a row: incomplete.
    const blankStored = readAliasState({ oauth: { 'model-alias': { kimi: [{}] } } }, null);
    expect(rowIssues(startDraft(blankStored))).toEqual({ 'login/kimi#0': 'incomplete' });
  });
});

const keyEntry = (over: Partial<KeyEntry>): KeyEntry => ({
  store: 'api-key',
  id: 'claude/0/0',
  family: 'claude',
  groupIndex: 0,
  keyIndex: 0,
  groupName: null,
  keyPreview: null,
  keyCount: 1,
  authIndex: null,
  authIndexes: [],
  host: null,
  prefix: null,
  disabled: false,
  listSource: 'key',
  service: 'key:claude',
  storedGroup: {},
  ...over,
});
const loginEntry = (channel: string): LoginEntry => ({
  store: 'login',
  id: `login/${channel}`,
  channel,
  spellings: [channel],
  loginCount: 1,
  service: `login:${channel}`,
  storedList: [],
});

describe('N-1 client names', () => {
  const r = { upstream: 'claude-opus-5-5', alias: 'opus' };
  test.each([
    ['no prefix', null, false, ['opus']],
    ['prefix', 'team', false, ['opus', 'team/opus']],
    ['forced prefix', 'team', true, ['team/opus']],
    ['forced prefix equal to the name', 'opus', true, ['opus', 'opus/opus']],
    ['prefix equal to the name, not forced', 'opus', false, ['opus', 'opus/opus']],
  ] as const)('%s', (_label, prefix, force, expected) => {
    expect(clientNames(r, keyEntry({ prefix }), force)).toEqual([...expected]);
  });
  test('no alias: the upstream name; a login row has no prefix', () => {
    expect(clientNames({ upstream: ' m ', alias: null }, keyEntry({ prefix: 'p' }), true)).toEqual([
      'p/m',
    ]);
    expect(clientNames(r, loginEntry('claude'), true)).toEqual(['opus']);
  });
});

/** A state from entries and `[entryId, upstream, alias]` rows. */
function stateOf(
  entries: AliasEntry[],
  rows: [string, string, string | null][],
  forceModelPrefix = false
): AliasState {
  return {
    entries,
    rows: rows.map(([entryId, upstream, alias], index): AliasRow => {
      const entry = entries.find((e) => e.id === entryId)!;
      return {
        id: `${entryId}#${index}`,
        entryId,
        store: entry.store,
        sourceIndex: index,
        upstream,
        alias,
        fork: entry.store === 'login' ? true : null,
        forceMapping: null,
        displayName: null,
      };
    }),
    forceModelPrefix,
    etag: null,
  };
}

describe('N-2 the rule', () => {
  const k1 = keyEntry({ id: 'claude/0/0', host: 'h1.invalid', service: 'key:h1.invalid' });
  const k2 = keyEntry({ id: 'claude/0/1', host: 'h1.invalid', service: 'key:h1.invalid' });
  const k3 = keyEntry({ id: 'claude/1/0', host: 'h2.invalid', service: 'key:h2.invalid' });
  const plain = keyEntry({ id: 'claude/2/0' });
  const or = keyEntry({
    id: 'openai-compatibility/0/g',
    family: 'openai-compatibility',
    keyIndex: null,
    host: 'openrouter.ai',
    service: 'key:openrouter.ai',
  });
  const off = keyEntry({
    id: 'claude/3/0',
    host: 'h3.invalid',
    service: 'key:h3.invalid',
    disabled: true,
  });
  const pre = keyEntry({
    id: 'claude/4/0',
    host: 'h4.invalid',
    service: 'key:h4.invalid',
    prefix: 'p',
  });
  const login = loginEntry('claude');
  const cases: {
    label: string;
    entries: AliasEntry[];
    rows: [string, string, string | null][];
    verdict: string;
    pool?: boolean;
    groups?: number;
  }[] = [
    { label: 'single', entries: [k1], rows: [['claude/0/0', 'm1', 'a']], verdict: 'single' },
    {
      label: 'several-keys: two keys, one host',
      entries: [k1, k2],
      rows: [
        ['claude/0/0', 'm1', 'a'],
        ['claude/0/1', 'm1', 'a'],
      ],
      verdict: 'several-keys',
    },
    {
      label: 'several-models, two keys of one service',
      entries: [k1, k2],
      rows: [
        ['claude/0/0', 'm1', 'a'],
        ['claude/0/1', 'm2', 'a'],
      ],
      verdict: 'several-models',
      pool: false,
    },
    {
      label: 'several-models, a pool inside one OpenAI-compatible entry',
      entries: [or],
      rows: [
        ['openai-compatibility/0/g', 'm1', 'a'],
        ['openai-compatibility/0/g', 'm2', 'a'],
      ],
      verdict: 'several-models',
      pool: true,
    },
    {
      label: 'several-services: login and key',
      entries: [k1, login],
      rows: [
        ['claude/0/0', 'm1', 'a'],
        ['login/claude', 'm1', 'a'],
      ],
      verdict: 'several-services',
    },
    {
      label: 'several-services: two hosts',
      entries: [k1, k3],
      rows: [
        ['claude/0/0', 'm1', 'a'],
        ['claude/1/0', 'm1', 'a'],
      ],
      verdict: 'several-services',
    },
    {
      label: 'several-services: key with and without base URL',
      entries: [k1, plain],
      rows: [
        ['claude/0/0', 'm1', 'a'],
        ['claude/2/0', 'm1', 'a'],
      ],
      verdict: 'several-services',
    },
    {
      label: 'a disabled entry does not count',
      entries: [k1, off],
      rows: [
        ['claude/0/0', 'm1', 'a'],
        ['claude/3/0', 'm1', 'a'],
      ],
      verdict: 'single',
    },
    {
      label: 'a shadowed row does not count',
      entries: [k1, k3],
      rows: [
        ['claude/0/0', 'm1', 'a'],
        ['claude/1/0', 'm0', 'a'],
        ['claude/1/0', 'm1', 'a'],
      ],
      verdict: 'several-services',
    },
    {
      label: 'a blocked row does not count',
      entries: [k1, login],
      rows: [
        ['claude/0/0', 'm1', 'a'],
        ['login/claude', 'a', 'a'],
      ],
      verdict: 'single',
    },
    {
      label: 'case differs only: one group',
      entries: [k1, k2],
      rows: [
        ['claude/0/0', 'm1', 'Opus'],
        ['claude/0/1', 'M1', ' opus '],
      ],
      verdict: 'several-keys',
    },
    {
      label: 'an alias and its own <prefix>/ form: not a problem',
      entries: [pre],
      rows: [['claude/4/0', 'm1', 'a']],
      verdict: 'single',
      groups: 2,
    },
    {
      label: 'one alias repeated across the keys of one group: not a problem',
      entries: [k1, k2],
      rows: [
        ['claude/0/0', 'm1', 'a'],
        ['claude/0/1', 'm1', 'a'],
      ],
      verdict: 'several-keys',
    },
  ];
  test.each(cases.map((c) => [c.label, c] as const))('%s', (_label, c) => {
    const groups = nameGroups(startDraft(stateOf(c.entries, c.rows)));
    expect(groups).toHaveLength(c.groups ?? 1);
    for (const group of groups) {
      expect(group.verdict).toBe(c.verdict as never);
      if (c.pool !== undefined) expect(group.pool).toBe(c.pool);
      expect(group.nativeServices).toEqual([]);
    }
  });

  test('a shadowed row is left out of the group; the group lists services and upstreams', () => {
    const groups = nameGroups(
      startDraft(
        stateOf(
          [k1, k3, login],
          [
            ['claude/0/0', 'm1', 'a'],
            ['claude/1/0', 'm0', 'a'],
            ['claude/1/0', 'm1', 'a'],
            ['login/claude', 'M0', 'A'],
          ]
        )
      )
    );
    expect(groups).toEqual([
      {
        key: 'a',
        name: 'a',
        rowIds: ['claude/0/0#0', 'claude/1/0#1', 'login/claude#3'],
        services: ['key:h1.invalid', 'key:h2.invalid', 'login:claude'],
        upstreams: ['m0', 'm1'],
        pool: false,
        nativeServices: [],
        verdict: 'several-services',
      },
    ]);
  });

  test('on the draft: an edit changes the verdict before anything is written', () => {
    const draft = startDraft(
      stateOf(
        [k1, k3],
        [
          ['claude/0/0', 'm1', 'a'],
          ['claude/1/0', 'm1', 'b'],
        ]
      )
    );
    expect(nameGroups(draft).map((g) => g.verdict)).toEqual(['single', 'single']);
    const edited = changeRow(draft, 'claude/1/0#1', { alias: 'A' });
    expect(nameGroups(edited).map((g) => [g.key, g.verdict])).toEqual([['a', 'several-services']]);
  });

  test('groupOfRow: a prefixed row is marked by its stronger group', () => {
    const groups = nameGroups(
      startDraft(
        stateOf(
          [pre, k1],
          [
            ['claude/4/0', 'm1', 'a'],
            ['claude/0/0', 'm1', 'p/a'],
          ]
        )
      )
    );
    expect(groups.map((g) => [g.key, g.verdict])).toEqual([
      ['a', 'single'],
      ['p/a', 'several-services'],
    ]);
    expect(groupOfRow(groups)).toEqual({ 'claude/4/0#0': 'p/a', 'claude/0/0#1': 'p/a' });
  });

  test('the fixture: opus is served by several services; the disabled entry is left out', () => {
    const groups = nameGroups(startDraft(loaded()));
    const opus = groups.find((g) => g.key === 'opus')!;
    expect(opus.verdict).toBe('several-services');
    expect(opus.services).toEqual([
      'key:claude',
      'key:claude.example.invalid',
      'key:openrouter.ai',
    ]);
    expect(opus.rowIds).not.toContain('claude/1/1#0');
    expect(opus.rowIds).not.toContain('openai-compatibility/1/g#0');
    expect(groups.find((g) => g.key === 'or/opus')).toMatchObject({
      verdict: 'several-models',
      pool: true,
    });
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import {
  aliasesApi,
  BLOCKED_MESSAGE,
  NO_TAG_MESSAGE,
  putWithTag,
} from '@/provimux/pages/aliases/aliasesApi';
import {
  addKeyAlias,
  addLoginAlias,
  changeRow,
  discardEntry,
  editsOf,
  removeRow,
  startDraft,
} from '@/provimux/pages/aliases/draft';
import { planCommit, planWrites } from '@/provimux/pages/aliases/plan';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import type { AliasDraft, AliasRowPatch, CommitOutcome } from '@/provimux/pages/aliases/types';
import { family, fixture, loginMap, type Doc } from '../helpers/aliasesStore';
import { applyBody, fakeProxy, restoreProxy, type FakeProxy } from './support/fakeProxy';

/* W7, design aliases-page.md 3.4 and 3.6: the save. C-1 … C-4, W-1, W-2, X-7, and putWithTag through axios.
 * Every test that commits ends by checking that no put was sent without If-Match. */

afterEach(restoreProxy);

/** The read with the bodies of the given writes put at their paths, as the proxy stores them. */
const withBodies = (read: Doc, writes: { path: string; body: unknown }[]) =>
  writes.reduce((doc, write) => applyBody(doc, write.path, write.body), read);

const noUnconditional = (p: FakeProxy) => expect(p.unconditional).toBe(0);

const fourEdits = (draft: AliasDraft) => {
  let next = changeRow(draft, 'gemini/0/0#0', { alias: 'gp' });
  next = changeRow(next, 'claude/0/0#2', { alias: 'haiku' });
  next = changeRow(next, 'claude/1/0#0', { alias: 'opus-own' });
  return changeRow(next, 'login/codex#0', { alias: 'g55-b' });
};
const ALL = ['gemini/0/0', 'claude/0/0', 'claude/1/0', 'login/codex'];

async function loaded(doc: unknown = fixture('config-full.json')) {
  const p = fakeProxy(doc);
  const state = await aliasesApi.load();
  const read = structuredClone(p.doc());
  p.requests.length = 0;
  return { p, state, read };
}

describe('C-1 the writes', () => {
  test('units in order, one after the other; a family’s entries in one put; the tag chained', async () => {
    const { p, state, read } = await loaded();
    const draft = fourEdits(startDraft(state));
    expect(planCommit(draft)).toEqual([
      { store: 'api-key', family: 'gemini', entryIds: ['gemini/0/0'] },
      { store: 'api-key', family: 'claude', entryIds: ['claude/0/0', 'claude/1/0'] },
      { store: 'login', entryIds: ['login/codex'] },
    ]);
    const writes = planWrites(draft);
    expect(await aliasesApi.commit(draft)).toEqual({
      confirmed: ALL,
      unconfirmed: [],
      failure: null,
    });
    // No GET during the commit; the first put carries the read's tag, each next one the tag before it.
    expect(p.gets()).toEqual([]);
    expect(p.puts().map((r) => [r.path, r.ifMatch, r.status])).toEqual([
      ['/config/api-keys/gemini', '"t1"', 200],
      ['/config/api-keys/claude', '"t2"', 200],
      ['/config/oauth/model-alias', '"t3"', 200],
    ]);
    expect(p.puts().map((r) => r.body)).toEqual(writes.map((w) => w.body));
    // The file is the read with exactly the planned bodies in it.
    expect(p.doc()).toEqual(withBodies(read, writes));
    noUnconditional(p);
  });

  test('the bodies come from the read alone: both claude entries at their own positions', async () => {
    const { p, state } = await loaded();
    const draft = fourEdits(startDraft(state));
    const claude = planWrites(draft)[1].body as Doc[];
    const read = family(state.document as Doc, 'claude');
    expect(((claude[0].keys as Doc[])[0].models as Doc[])[2]).toEqual({
      name: 'claude-haiku-5',
      alias: 'haiku',
    });
    expect((claude[0].keys as Doc[])[1]).toEqual((read[0].keys as Doc[])[1]);
    expect(((claude[1].keys as Doc[])[0].models as Doc[])[0]).toEqual({
      name: 'claude-opus-5-5',
      alias: 'opus-own',
    });
    // The auth_index the proxy injected goes back as read; the proxy strips it.
    expect((claude[1].keys as Doc[])[0].auth_index).toBe('ai-claude-3');
    expect(p.requests).toEqual([]);
  });

  test('a draft with no change sends nothing', async () => {
    const { p, state } = await loaded();
    expect(await aliasesApi.commit(startDraft(state))).toEqual({
      confirmed: [],
      unconfirmed: [],
      failure: null,
    });
    expect(p.requests).toEqual([]);
  });
});

describe('C-2 the first unit not confirmed ends the save', () => {
  interface Case {
    label: string;
    arrange: (p: FakeProxy) => void;
    outcome: CommitOutcome;
    puts: number;
    /** The units (by index of planWrites) whose bodies are in the file. */
    written: number[];
    foreign?: (doc: Doc) => void;
  }
  const routing = (doc: Doc) => void ((doc.routing as Doc).strategy = 'fill-first');
  const CASES: Case[] = [
    {
      label: '412 on the second unit: changed; the 412’s tag is never sent',
      arrange: (p) => p.beforePut(2, () => p.foreign(routing)),
      foreign: routing,
      outcome: {
        confirmed: ['gemini/0/0'],
        unconfirmed: ['claude/0/0', 'claude/1/0', 'login/codex'],
        failure: { reason: 'changed', message: 'precondition_failed' },
      },
      puts: 2,
      written: [0],
    },
    {
      label: '412 on the first unit: changed, nothing written',
      arrange: (p) => p.beforePut(1, () => p.foreign(routing)),
      foreign: routing,
      outcome: {
        confirmed: [],
        unconfirmed: ALL,
        failure: { reason: 'changed', message: 'precondition_failed' },
      },
      puts: 1,
      written: [],
    },
    {
      label: '400: refused, with the proxy’s message',
      arrange: (p) => p.failPut(1, { status: 400, message: 'invalid_config: unknown field x' }),
      outcome: {
        confirmed: [],
        unconfirmed: ALL,
        failure: { reason: 'refused', message: 'invalid_config: unknown field x' },
      },
      puts: 1,
      written: [],
    },
    {
      label: '422 on the second unit: refused',
      arrange: (p) => p.failPut(2, { status: 422, message: 'invalid_config: bad row' }),
      outcome: {
        confirmed: ['gemini/0/0'],
        unconfirmed: ['claude/0/0', 'claude/1/0', 'login/codex'],
        failure: { reason: 'refused', message: 'invalid_config: bad row' },
      },
      puts: 2,
      written: [0],
    },
    {
      label: 'a request that never answers: error',
      arrange: (p) => p.failPut(1, { reject: 'socket hang up' }),
      outcome: {
        confirmed: [],
        unconfirmed: ALL,
        failure: { reason: 'error', message: 'socket hang up' },
      },
      puts: 1,
      written: [],
    },
    {
      label: 'a 500 on the third unit: error',
      arrange: (p) => p.failPut(3, { status: 500, message: 'server exploded' }),
      outcome: {
        confirmed: ['gemini/0/0', 'claude/0/0', 'claude/1/0'],
        unconfirmed: ['login/codex'],
        failure: { reason: 'error', message: 'server exploded' },
      },
      puts: 3,
      written: [0, 1],
    },
    {
      label: 'a 200 without a tag: that unit confirmed, the next not sent',
      arrange: (p) => (p.answerTag = (n) => n !== 1),
      outcome: {
        confirmed: ['gemini/0/0'],
        unconfirmed: ['claude/0/0', 'claude/1/0', 'login/codex'],
        failure: { reason: 'no-tag', message: NO_TAG_MESSAGE },
      },
      puts: 1,
      written: [0],
    },
    {
      label: 'a 200 without a tag on the last unit: everything confirmed',
      arrange: (p) => (p.answerTag = (n) => n !== 3),
      outcome: { confirmed: ALL, unconfirmed: [], failure: null },
      puts: 3,
      written: [0, 1, 2],
    },
  ];

  test.each(CASES.map((c) => [c.label, c] as const))('%s', async (_label, c) => {
    const { p, state, read } = await loaded();
    const draft = fourEdits(startDraft(state));
    const writes = planWrites(draft);
    c.arrange(p);
    expect(await aliasesApi.commit(draft)).toEqual(c.outcome);
    expect(p.puts()).toHaveLength(c.puts);
    expect(p.gets()).toEqual([]);
    // The tags sent: the read's, then each the one the write before answered; never a 412's.
    const sent = p.puts().map((r) => r.ifMatch);
    const answered = ['"t1"', ...p.puts().map((r) => (r.status === 200 ? r.tag : null))];
    expect(sent).toEqual(answered.slice(0, sent.length));
    const twelve = p.puts().find((r) => r.status === 412);
    if (twelve) expect(sent).not.toContain(twelve.tag);
    // The file: the read, the confirmed units' bodies, and the foreign change if any.
    const expected = withBodies(
      read,
      c.written.map((i) => writes[i])
    );
    if (c.foreign) c.foreign(expected);
    expect(p.doc()).toEqual(expected);
    noUnconditional(p);
  });

  test('a read without a tag: no request at all', async () => {
    const p = fakeProxy(fixture('config-full.json'));
    p.readTag = false;
    const state = await aliasesApi.load();
    expect(state.etag).toBeNull();
    p.requests.length = 0;
    expect(await aliasesApi.commit(fourEdits(startDraft(state)))).toEqual({
      confirmed: [],
      unconfirmed: ALL,
      failure: { reason: 'no-tag', message: NO_TAG_MESSAGE },
    });
    expect(p.requests).toEqual([]);
    noUnconditional(p);
  });

  test('a blocking issue: blocked, no request', async () => {
    const { p, state } = await loaded();
    const draft = addLoginAlias(changeRow(startDraft(state), 'xai/0/0#0', { alias: 'g' }), 'kimi', {
      upstream: 'k1',
      alias: '',
    });
    expect(await aliasesApi.commit(draft)).toEqual({
      confirmed: [],
      unconfirmed: ['xai/0/0', 'login/kimi'],
      failure: { reason: 'blocked', message: BLOCKED_MESSAGE },
    });
    expect(p.requests).toEqual([]);
  });

  test('a connection change before a write aborts; that write is not sent', async () => {
    const { p, state } = await loaded();
    let revision = 1;
    apiClient.getConnectionRevision = () => revision;
    const draft = fourEdits(startDraft(state));
    p.beforePut(1, () => (revision += 1));
    await expect(aliasesApi.commit(draft)).rejects.toMatchObject({ name: 'AbortError' });
    expect(p.puts().map((r) => r.path)).toEqual(['/config/api-keys/gemini']);
    noUnconditional(p);
  });

  test('a connection change before the first write: nothing sent', async () => {
    const { p, state } = await loaded();
    // The guard takes the revision when commit starts (first call); it has changed at the check.
    let calls = 0;
    apiClient.getConnectionRevision = () => (++calls > 1 ? 2 : 1);
    await expect(aliasesApi.commit(fourEdits(startDraft(state)))).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(p.puts()).toEqual([]);
  });
});

/** Two deep-equal claude groups, each one key with its own list. */
const twins = (): Doc => {
  const group = {
    name: 'twin',
    keys: [{ 'api-key': 'fixture-key-twin', models: [{ name: 'm', alias: 'a' }] }],
  };
  return {
    'config-version': 8,
    'api-keys': { claude: [structuredClone(group), structuredClone(group)] },
  };
};

describe('C-3 two alike (the review’s first case)', () => {
  const edit = (draft: AliasDraft) =>
    changeRow(changeRow(draft, 'claude/0/0#0', { alias: 'first' }), 'claude/1/0#0', {
      alias: 'second',
    });

  test('nothing changed elsewhere: each edit in its own group of the put', async () => {
    const { p, state } = await loaded(twins());
    expect(await aliasesApi.commit(edit(startDraft(state)))).toEqual({
      confirmed: ['claude/0/0', 'claude/1/0'],
      unconfirmed: [],
      failure: null,
    });
    const body = p.puts()[0].body as Doc[];
    expect(((body[0].keys as Doc[])[0].models as Doc[])[0].alias).toBe('first');
    expect(((body[1].keys as Doc[])[0].models as Doc[])[0].alias).toBe('second');
    noUnconditional(p);
  });

  test('one group removed elsewhere: 412, no write, both edits listed, nothing confirmed', async () => {
    const { p, state } = await loaded(twins());
    const draft = edit(startDraft(state));
    p.foreign((doc) => void family(doc, 'claude').splice(0, 1));
    const after = structuredClone(p.doc());
    const outcome = await aliasesApi.commit(draft);
    expect(outcome.confirmed).toEqual([]);
    expect(outcome.unconfirmed).toEqual(['claude/0/0', 'claude/1/0']);
    expect(outcome.failure?.reason).toBe('changed');
    expect(p.doc()).toEqual(after);
    const lost = outcome.unconfirmed.map((id) => editsOf(draft, id).map((e) => e.after?.alias));
    expect(lost).toEqual([['first'], ['second']]);
    expect(p.puts()).toHaveLength(1);
    noUnconditional(p);
  });
});

describe('C-4 keys that differ only below the top (the review’s second case)', () => {
  const doc = (): Doc => {
    const key = (side: string) => ({
      'api-key': 'fixture-key-same',
      headers: { 'auth-index': side },
      models: [{ name: 'm', alias: 'a' }],
    });
    return {
      'config-version': 8,
      'api-keys': {
        claude: [
          { name: 'g', keys: [key('left')] },
          { name: 'g', keys: [key('right')] },
        ],
      },
    };
  };

  test('the edit is in left’s list; after a 503 and a reorder it is listed and never written', async () => {
    const { p, state } = await loaded(doc());
    const draft = changeRow(startDraft(state), 'claude/0/0#0', { alias: 'left-edit' });
    const body = planWrites(draft)[0].body as Doc[];
    expect((body[0].keys as Doc[])[0]).toMatchObject({
      headers: { 'auth-index': 'left' },
      models: [{ name: 'm', alias: 'left-edit' }],
    });
    expect((body[1].keys as Doc[])[0]).toEqual(
      ((doc()['api-keys'] as Doc).claude as Doc[])[1].keys![0 as never]
    );

    p.failPut(1, { status: 503, message: 'unavailable' });
    const outcome = await aliasesApi.commit(draft);
    expect(outcome).toEqual({
      confirmed: [],
      unconfirmed: ['claude/0/0'],
      failure: { reason: 'error', message: 'unavailable' },
    });
    expect(editsOf(draft, 'claude/0/0').map((e) => [e.kind, e.after?.alias])).toEqual([
      ['changed', 'left-edit'],
    ]);
    p.foreign((d) => void family(d, 'claude').reverse());

    // The next draft is the fresh read, without the edit; a later save has nothing to write.
    const next = startDraft(await aliasesApi.load());
    expect(next.rows.some((r) => r.alias === 'left-edit')).toBe(false);
    expect(planCommit(next)).toEqual([]);
    p.requests.length = 0;
    await aliasesApi.commit(next);
    expect(p.puts()).toEqual([]);
    expect(JSON.stringify(p.doc())).not.toContain('left-edit');
    noUnconditional(p);
  });
});

// --- W-1, W-2 ------------------------------------------------------------------------------

const odd = (name: string, alias: string) => ({
  name,
  alias,
  'display-name': '  Padded  ',
  fork: false,
  'force-mapping': false,
  'x-unknown': { nested: [1, ' two '] },
});
/**
 * Store A: row 0 an alias equal to its name, row 1 a padded alias, both with every odd spelling. Store B:
 * kimi row 0 the padded one beside a plain row; qwen row 0 an alias equal to its name, alone in its channel
 * (the proxy ignores it, so it blocks every save of its channel until its alias changes, 3.5).
 */
const oddDoc = (): Doc => ({
  'config-version': 8,
  'api-keys': {
    codex: [
      {
        name: 'c',
        keys: [{ 'api-key': 'fixture-key-c', models: [odd('m0', 'm0'), odd('m1', '  a1  ')] }],
      },
    ],
  },
  oauth: {
    'model-alias': {
      kimi: [odd('k0', '  b0  '), { name: 'k1', alias: 'b1' }],
      qwen: [odd('q0', 'q0')],
    },
  },
});

/** The stored list a row id points into, in a document. */
const listOf = (doc: Doc, rowId: string): Doc[] => {
  if (rowId.startsWith('login/kimi')) return loginMap(doc).kimi;
  if (rowId.startsWith('login/qwen')) return loginMap(doc).qwen;
  return (family(doc, 'codex')[0].keys as Doc[])[0].models as Doc[];
};

describe('W-1 only the edited field changes', () => {
  interface Case {
    label: string;
    rowId: string;
    patch: AliasRowPatch;
    /** The written row: the stored one with this applied. */
    expect: (stored: Doc) => Doc;
  }
  const without = (stored: Doc, key: string) => {
    const next = { ...stored };
    delete next[key];
    return next;
  };
  const CASES: Case[] = [];
  for (const rowId of ['codex/0/0#0', 'codex/0/0#1']) {
    CASES.push(
      {
        label: `key ${rowId}: alias set`,
        rowId,
        patch: { alias: 'new' },
        expect: (s) => ({ ...s, alias: 'new' }),
      },
      {
        label: `key ${rowId}: force-mapping on`,
        rowId,
        patch: { forceMapping: true },
        expect: (s) => ({ ...s, 'force-mapping': true }),
      }
    );
  }
  CASES.push(
    {
      label: 'key codex/0/0#1: alias cleared, the key removed',
      rowId: 'codex/0/0#1',
      patch: { alias: '' },
      expect: (s) => without(s, 'alias'),
    },
    {
      label: 'login qwen#0 (alias equal to its name): alias',
      rowId: 'login/qwen#0',
      patch: { alias: 'new' },
      expect: (s) => ({ ...s, alias: 'new' }),
    }
  );
  const rowId = 'login/kimi#0';
  CASES.push(
    {
      label: 'login kimi#0: alias',
      rowId,
      patch: { alias: 'new' },
      expect: (s) => ({ ...s, alias: 'new' }),
    },
    {
      label: 'login kimi#0: model',
      rowId,
      patch: { upstream: ' m9 ' },
      expect: (s) => ({ ...s, name: 'm9' }),
    },
    {
      label: 'login kimi#0: fork on',
      rowId,
      patch: { fork: true },
      expect: (s) => ({ ...s, fork: true }),
    },
    {
      label: 'login kimi#0: force-mapping on',
      rowId,
      patch: { forceMapping: true },
      expect: (s) => ({ ...s, 'force-mapping': true }),
    },
    {
      label: 'login kimi#0: display name',
      rowId,
      patch: { displayName: ' Shown ' },
      expect: (s) => ({ ...s, 'display-name': 'Shown' }),
    },
    {
      label: 'login kimi#0: display name cleared',
      rowId,
      patch: { displayName: '' },
      expect: (s) => without(s, 'display-name'),
    }
  );

  test.each(CASES.map((c) => [c.label, c] as const))('%s', async (_label, c) => {
    const { p, state } = await loaded(oddDoc());
    const draft = changeRow(startDraft(state), c.rowId, c.patch);
    expect(planCommit(draft)).toHaveLength(1);
    expect((await aliasesApi.commit(draft)).failure).toBeNull();
    const index = Number(c.rowId.split('#')[1]);
    const stored = listOf(oddDoc(), c.rowId);
    const written = listOf(p.doc(), c.rowId);
    expect(written[index]).toEqual(c.expect(stored[index]));
    // Key order as stored, too (the spelling of the object).
    expect(Object.keys(written[index]).filter((k) => k in stored[index])).toEqual(
      Object.keys(stored[index]).filter((k) => k in written[index])
    );
    // Every other row of the list as stored.
    expect(written.filter((_, i) => i !== index)).toEqual(stored.filter((_, i) => i !== index));
    noUnconditional(p);
  });

  test('a change undone in the draft writes nothing', async () => {
    const { p, state } = await loaded(oddDoc());
    let draft = changeRow(startDraft(state), 'login/kimi#0', { displayName: 'X' });
    draft = changeRow(draft, 'login/kimi#0', { displayName: '  Padded  ' });
    expect(planCommit(draft)).toEqual([]);
    await aliasesApi.commit(draft);
    expect(p.puts()).toEqual([]);
  });
});

describe('W-2 elements the page cannot read stay', () => {
  test('a channel [null, row] with the row removed is written as [null]', async () => {
    const { p, state } = await loaded({
      oauth: {
        'model-alias': {
          codex: [null, { name: 'g', alias: 'ga' }],
          kimi: [{ name: 'k', alias: 'ka' }],
        },
      },
    });
    await aliasesApi.commit(removeRow(startDraft(state), 'login/codex#1'));
    expect(loginMap(p.doc())).toEqual({ kimi: [{ name: 'k', alias: 'ka' }], codex: [null] });
    noUnconditional(p);
  });

  test('a channel [row] with the row removed loses its key; the last one leaves {}', async () => {
    const { p, state } = await loaded({
      oauth: {
        'model-alias': { codex: [{ name: 'g', alias: 'ga' }], kimi: [{ name: 'k', alias: 'ka' }] },
      },
    });
    await aliasesApi.commit(removeRow(startDraft(state), 'login/codex#0'));
    expect(loginMap(p.doc())).toEqual({ kimi: [{ name: 'k', alias: 'ka' }] });
    const again = startDraft(await aliasesApi.load());
    await aliasesApi.commit(removeRow(again, 'login/kimi#0'));
    expect(loginMap(p.doc())).toEqual({});
    noUnconditional(p);
  });

  test('store A: a null, a string and a nameless object keep their places through an add and a remove', async () => {
    const models = [
      null,
      { name: 'm', alias: 'one' },
      'stray',
      { name: 'm', alias: 'two' },
      { alias: 'nameless' },
      { name: 'n' },
    ];
    const { p, state } = await loaded({
      'api-keys': { xai: [{ name: 'x', keys: [{ 'api-key': 'fixture-key-x', models }] }] },
    });
    let draft = removeRow(startDraft(state), 'xai/0/0#1');
    draft = addKeyAlias(draft, 'xai/0/0', 'm', 'three');
    await aliasesApi.commit(draft);
    expect((family(p.doc(), 'xai')[0].keys as Doc[])[0].models).toEqual([
      null,
      'stray',
      { name: 'm', alias: 'two' },
      { name: 'm', alias: 'three' },
      { alias: 'nameless' },
      { name: 'n' },
    ]);
    noUnconditional(p);
  });
});

// --- X-7 -----------------------------------------------------------------------------------

describe('X-7 numbers the browser cannot hold', () => {
  /** JSON text, parsed as the browser parses it. */
  const text = (claudeMax: string, loginExtra: string) =>
    JSON.parse(`{
      "config-version": 8,
      "api-keys": {
        "claude": [{ "name": "c", "keys": [{ "api-key": "fixture-key-c",
          "models": [{ "name": "c1", "alias": "ca" }, { "name": "c2", "max-context-length": ${claudeMax} }] }] }],
        "gemini": [{ "name": "g", "keys": [{ "api-key": "fixture-key-g", "models": [{ "name": "g1", "alias": "ga" }] }] }]
      },
      "oauth": { "model-alias": { "codex": [{ "name": "x", "alias": "xa", "x-size": ${loginExtra} }] } }
    }`) as Doc;

  test('a family holding 9007199254740993 gives no entries and is never written', async () => {
    const { p, state } = await loaded(text('9007199254740993', '1'));
    expect(state.entries.some((e) => e.store === 'api-key' && e.family === 'claude')).toBe(false);
    expect(state.unread).toEqual(['api-keys.claude[0].keys[0].models[1].max-context-length']);
    const draft = changeRow(startDraft(state), 'gemini/0/0#0', { alias: 'g-new' });
    expect(planWrites(draft).map((w) => w.path)).toEqual(['/config/api-keys/gemini']);
    expect(await aliasesApi.commit(draft)).toMatchObject({ failure: null });
    expect(p.puts().map((r) => r.path)).toEqual(['/config/api-keys/gemini']);
    expect(JSON.stringify(p.puts()[0].body)).not.toContain('9007199254740992');
    noUnconditional(p);
  });

  test('the login map holding one: every login entry unread, nothing to change, never written', async () => {
    const { p, state } = await loaded(text('1', '9007199254740993'));
    expect(state.unread).toEqual(['oauth.model-alias.codex[0].x-size']);
    const logins = state.entries.filter((e) => e.store === 'login');
    expect(logins.length).toBeGreaterThan(0);
    expect(logins.every((e) => e.store === 'login' && e.unread)).toBe(true);
    expect(state.rows.some((r) => r.store === 'login')).toBe(false);
    let draft = startDraft(state);
    expect(addLoginAlias(draft, 'codex', { upstream: 'y', alias: 'ya' })).toBe(draft);
    expect(addLoginAlias(draft, 'qwen', { upstream: 'q', alias: 'qa' })).toBe(draft);
    draft = changeRow(draft, 'claude/0/0#0', { alias: 'cb' });
    expect(planWrites(draft).map((w) => w.path)).toEqual(['/config/api-keys/claude']);
    await aliasesApi.commit(draft);
    expect(p.puts().map((r) => r.path)).toEqual(['/config/api-keys/claude']);
    noUnconditional(p);
  });

  test('9007199254740991 and a decimal are read as any number', () => {
    const state = readAliasState(text('9007199254740991', '0.5'), null);
    expect(state.unread).toEqual([]);
    expect(state.entries.some((e) => e.id === 'claude/0/0')).toBe(true);
    expect(state.rows.some((r) => r.id === 'login/codex#0')).toBe(true);
  });

  test('-9007199254740993 and 1e400 too', () => {
    const negative = readAliasState(text('-9007199254740993', '1e400'), null);
    expect(negative.unread).toEqual([
      'api-keys.claude[0].keys[0].models[1].max-context-length',
      'oauth.model-alias.codex[0].x-size',
    ]);
  });
});

// --- 3.6: what the page takes from the data layer ---------------------------------------------

describe('editsOf and discardEntry', () => {
  test('discardEntry: the entry’s rows are its base rows again, the others as they are, the same base', async () => {
    const { state } = await loaded();
    let draft = fourEdits(startDraft(state));
    draft = addKeyAlias(draft, 'claude/1/0', 'claude-opus-5-5', 'extra');
    draft = removeRow(draft, 'login/codex#1');
    const undone = discardEntry(draft, 'claude/1/0');
    expect(undone.base).toBe(draft.base);
    expect(undone.nextNew).toBe(draft.nextNew);
    expect(editsOf(undone, 'claude/1/0')).toEqual([]);
    expect(undone.rows.filter((r) => r.entryId === 'claude/1/0')).toEqual(
      state.rows.filter((r) => r.entryId === 'claude/1/0')
    );
    for (const id of ['gemini/0/0', 'claude/0/0', 'login/codex']) {
      expect(editsOf(undone, id)).toEqual(editsOf(draft, id));
    }
    // The entry's rows where they were: the entries come in the same order, each in one run.
    const runs = (ids: string[]) => ids.filter((id, i) => id !== ids[i - 1]);
    expect(runs(undone.rows.map((r) => r.entryId))).toEqual(runs(state.rows.map((r) => r.entryId)));
    // An entry the draft added (a new channel) has no base rows: undone, it is gone.
    const added = addLoginAlias(draft, 'qwen', { upstream: 'q', alias: 'qa' });
    expect(discardEntry(added, 'login/qwen').rows.some((r) => r.entryId === 'login/qwen')).toBe(
      false
    );
  });

  test('editsOf: changed, added, removed; a blank new row is not an edit', async () => {
    const { state } = await loaded();
    let draft = changeRow(startDraft(state), 'claude/1/0#0', { alias: 'x' });
    draft = addKeyAlias(draft, 'claude/1/0', 'claude-opus-5-5', 'y');
    draft = removeRow(draft, 'login/codex#1');
    draft = addLoginAlias(draft, 'codex', { upstream: '', alias: '' });
    expect(
      editsOf(draft, 'claude/1/0').map((e) => [
        e.kind,
        e.before?.alias ?? null,
        e.after?.alias ?? null,
      ])
    ).toEqual([
      ['changed', 'opus', 'x'],
      ['added', null, 'y'],
    ]);
    expect(editsOf(draft, 'login/codex').map((e) => [e.kind, e.before?.alias])).toEqual([
      ['removed', 'g54'],
    ]);
  });
});

// --- putWithTag through axios ------------------------------------------------------------------

describe('putWithTag through axios and apiClient', () => {
  test('a 200’s tag is read, a 200 without one gives null, a 412 rejects and gives no tag', async () => {
    const seen: { ifMatch: string | null; body: unknown }[] = [];
    let answer: 'tag' | 'none' | '412' = 'tag';
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        seen.push({ ifMatch: request.headers.get('if-match'), body: await request.json() });
        if (answer === '412') {
          return Response.json(
            { error: 'precondition_failed' },
            { status: 412, headers: { ETag: '"current"' } }
          );
        }
        return Response.json(
          { status: 'ok', 'config-version': 8 },
          answer === 'tag' ? { headers: { ETag: '"after"' } } : {}
        );
      },
    });
    const hadWindow = typeof globalThis.window !== 'undefined';
    if (!hadWindow) (globalThis as { window?: unknown }).window = new EventTarget();
    try {
      apiClient.setConfig({ apiBase: `http://127.0.0.1:${server.port}`, managementKey: 'made-up' });
      expect(await putWithTag('/config/api-keys/claude', [{ name: 'g' }], '"before"')).toBe(
        '"after"'
      );
      answer = 'none';
      expect(await putWithTag('/config/api-keys/claude', [], '"after"')).toBeNull();
      answer = '412';
      await expect(putWithTag('/config/api-keys/claude', [], '"stale"')).rejects.toMatchObject({
        status: 412,
        message: 'precondition_failed',
      });
      expect(seen.map((s) => s.ifMatch)).toEqual(['"before"', '"after"', '"stale"']);
      expect(seen[0].body).toEqual([{ name: 'g' }]);
    } finally {
      apiClient.setConfig({ apiBase: '', managementKey: '' });
      if (!hadWindow) delete (globalThis as { window?: unknown }).window;
      server.stop(true);
    }
  });
});

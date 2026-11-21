import { afterEach, describe, expect, test } from 'bun:test';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import type { AuthFilesResponse } from '@/types/authFile';
import { aliasesApi } from '@/provimux/pages/aliases/aliasesApi';
import {
  addKeyAlias,
  addLoginAlias,
  changeRow,
  draftEntries,
  isBlankNewRow,
  removeRow,
  startDraft,
} from '@/provimux/pages/aliases/draft';
import { entryChanged, planCommit, sameConfig } from '@/provimux/pages/aliases/plan';
import { rebase, type Rebased } from '@/provimux/pages/aliases/rebase';
import { effectiveModels, readAliasState } from '@/provimux/pages/aliases/rows';
import type { AliasDraft, AliasState, KeyEntry, LoginEntry } from '@/provimux/pages/aliases/types';
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

/* ALP-03, design aliases-page.md 3.6: tests RB-1 … RB-9. A row belongs to the read it came from. */

const credentialFiles = () =>
  normalizeAuthFilesResponse(fixture('credentials.json') as unknown as AuthFilesResponse).files;

afterEach(restoreClient);

const keysOf = (doc: Doc, name: string, group: number) => family(doc, name)[group].keys as Doc[];
const row = (draft: AliasDraft, id: string) => draft.rows.find((r) => r.id === id);

/** RB-8: every changed entry not in `written` is carried or lost. */
function nothingVanishes(draft: AliasDraft, written: string[], rebased: Rebased) {
  const lost = new Set(rebased.lost.map((l) => l.entry.id));
  for (const entry of draftEntries(draft)) {
    if (written.includes(entry.id) || !entryChanged(draft, entry.id)) continue;
    expect(entry.id in rebased.carried || lost.has(entry.id)).toBe(true);
    expect(entry.id in rebased.carried && lost.has(entry.id)).toBe(false);
  }
}

describe('RB-1 the reported sequence', () => {
  test('a conflict, then rebase: the edit is lost and listed, nothing more is written', async () => {
    const s = server(fixture('config-full.json'));
    const draft = changeRow(startDraft(await aliasesApi.load()), 'codex/0/0#0', { alias: 'fast2' });
    s.edit((doc) => {
      (keysOf(doc, 'codex', 0)[0].models as Doc[]).push({ name: 'gpt-5.4', alias: 'mini' });
    });
    const foreign = clone(family(s.stored(), 'codex'));
    const outcome = await aliasesApi.commit(draft);
    expect(outcome.failed.map((f) => [f.entryId, f.reason])).toEqual([['codex/0/0', 'conflict']]);
    const rebased = rebase(draft, await aliasesApi.load(), outcome.done);
    expect(rebased.carried).toEqual({});
    expect(rebased.lost).toHaveLength(1);
    expect(rebased.lost[0].entry.id).toBe('codex/0/0');
    expect(rebased.lost[0].edits.map((e) => [e.kind, e.before?.alias, e.after?.alias])).toEqual([
      ['changed', 'fast', 'fast2'],
    ]);
    expect(planCommit(rebased.draft)).toEqual([]);
    s.puts.length = 0;
    expect(await aliasesApi.commit(rebased.draft)).toEqual({ done: [], failed: [] });
    expect(s.puts).toEqual([]);
    expect(family(s.stored(), 'codex')).toEqual(foreign);
    expect(keysOf(s.stored(), 'codex', 0)[0].models).toEqual([
      { name: 'gpt-5.5', alias: 'fast', 'support-configuration-update': false },
      { name: 'gpt-5.4', alias: 'mini' },
    ]);
  });
});

describe('RB-2 moved', () => {
  test('a failed save, a group inserted at the head: carried as codex/1/0, written there', async () => {
    const s = server(fixture('config-full.json'));
    const draft = changeRow(startDraft(await aliasesApi.load()), 'codex/0/0#0', { alias: 'fast2' });
    const head = { name: 'codex-new', keys: [{ 'api-key': 'fixture-key-new' }] };
    s.failPut = () => {
      s.failPut = null;
      s.edit((doc) => family(doc, 'codex').unshift(clone(head)));
      throw httpError(422, 'invalid_config: x', 'invalid_config');
    };
    const outcome = await aliasesApi.commit(draft);
    expect(outcome.failed.map((f) => f.reason)).toEqual(['invalid']);
    const rebased = rebase(draft, await aliasesApi.load(), outcome.done);
    expect(rebased.carried).toEqual({ 'codex/0/0': 'codex/1/0' });
    expect(rebased.lost).toEqual([]);
    expect(row(rebased.draft, 'codex/1/0#0')?.alias).toBe('fast2');
    expect(row(rebased.draft, 'codex/0/0#0')).toBeUndefined();
    expect(await aliasesApi.commit(rebased.draft)).toEqual({ done: ['codex/1/0'], failed: [] });
    expect(family(s.stored(), 'codex')[0]).toEqual(head);
    expect((keysOf(s.stored(), 'codex', 1)[0].models as Doc[])[0].alias).toBe('fast2');
  });
});

interface Case {
  label: string;
  page: (draft: AliasDraft) => AliasDraft;
  entryId: string;
  foreign: (doc: Doc) => void;
}
const ownList = (doc: Doc) => keysOf(doc, 'claude', 1)[0].models as unknown[];
const editOwn = (draft: AliasDraft) => changeRow(draft, 'claude/1/0#0', { alias: 'o3' });

describe('RB-3 changed elsewhere', () => {
  const cases: Case[] = [
    {
      label: 'a row inserted at the head',
      page: editOwn,
      entryId: 'claude/1/0',
      foreign: (d) => void ownList(d).unshift({ name: 'x' }),
    },
    {
      label: 'a row appended at the end',
      page: editOwn,
      entryId: 'claude/1/0',
      foreign: (d) => void ownList(d).push({ name: 'x' }),
    },
    {
      label: 'a row removed',
      page: editOwn,
      entryId: 'claude/1/0',
      foreign: (d) => void ownList(d).splice(3, 1),
    },
    {
      label: 'rows reordered',
      page: editOwn,
      entryId: 'claude/1/0',
      foreign: (d) => {
        const list = ownList(d);
        [list[0], list[3]] = [list[3], list[0]];
      },
    },
    {
      label: 'another field of a row changed',
      page: editOwn,
      entryId: 'claude/1/0',
      foreign: (d) => void ((ownList(d)[3] as Doc)['x-new'] = 1),
    },
    {
      label: 'a field of the key changed',
      page: editOwn,
      entryId: 'claude/1/0',
      foreign: (d) => void (keysOf(d, 'claude', 1)[0].weight = 4),
    },
    {
      label: 'a field of the group changed',
      page: editOwn,
      entryId: 'claude/1/0',
      foreign: (d) => void (family(d, 'claude')[1]['x-group'] = 1),
    },
    {
      label: 'a key inserted before it in the group',
      page: editOwn,
      entryId: 'claude/1/0',
      foreign: (d) => void keysOf(d, 'claude', 1).unshift({ 'api-key': 'fixture-key-new' }),
    },
    {
      label: 'the group’s list changed under an inheriting key',
      page: (draft) => changeRow(draft, 'claude/0/1#0', { alias: 'o2' }),
      entryId: 'claude/0/1',
      foreign: (d) => void (family(d, 'claude')[0].models as Doc[]).push({ name: 'claude-new' }),
    },
    {
      label: 'a row inserted in a login channel',
      page: (draft) => changeRow(draft, 'login/codex#0', { alias: 'g55-b' }),
      entryId: 'login/codex',
      foreign: (d) => void loginMap(d).codex.unshift({ name: 'gpt-5.3', alias: 'g53' }),
    },
  ];
  test.each(cases.map((c) => [c.label, c] as const))('%s: lost, no later put', async (_l, c) => {
    const s = server(fixture('config-full.json'));
    const draft = c.page(startDraft(await aliasesApi.load()));
    s.edit(c.foreign);
    const rebased = rebase(draft, await aliasesApi.load(), []);
    expect(rebased.carried).toEqual({});
    expect(rebased.lost.map((l) => l.entry.id)).toEqual([c.entryId]);
    expect(rebased.lost[0].edits.map((e) => e.kind)).toEqual(['changed']);
    nothingVanishes(draft, [], rebased);
    const before = clone(s.stored());
    expect(await aliasesApi.commit(rebased.draft)).toEqual({ done: [], failed: [] });
    expect(s.puts).toEqual([]);
    expect(s.stored()).toEqual(before);
  });
});

describe('RB-4 still the same', () => {
  test('only auth_index changed: carried, same id, and written', async () => {
    const s = server(fixture('config-full.json'));
    const draft = editOwn(startDraft(await aliasesApi.load()));
    s.edit((doc) => {
      keysOf(doc, 'claude', 1)[0].auth_index = 'ai-claude-3-after-reload';
      delete keysOf(doc, 'claude', 1)[1].auth_index;
    });
    const rebased = rebase(draft, await aliasesApi.load(), []);
    expect(rebased.carried).toEqual({ 'claude/1/0': 'claude/1/0' });
    expect(rebased.lost).toEqual([]);
    expect((await aliasesApi.commit(rebased.draft)).done).toEqual(['claude/1/0']);
  });

  test('another channel changed: carried', async () => {
    const s = server(fixture('config-full.json'));
    const draft = changeRow(startDraft(await aliasesApi.load()), 'login/codex#0', {
      alias: 'g55-b',
    });
    s.edit((doc) => void loginMap(doc).claude.push({ name: 'claude-x', alias: 'cx' }));
    const rebased = rebase(draft, await aliasesApi.load(), []);
    expect(rebased.carried).toEqual({ 'login/codex': 'login/codex' });
  });

  test('a channel respelled with the same rows: carried, and written under the normalized key', async () => {
    const s = server(fixture('config-full.json'));
    const draft = changeRow(startDraft(await aliasesApi.load()), 'login/codex#1', {
      alias: 'g54-b',
    });
    s.edit((doc) => {
      const map = loginMap(doc);
      map.codex = [...map.codex, ...map.CODEX];
      delete map.CODEX;
    });
    const rebased = rebase(draft, await aliasesApi.load(), []);
    expect(rebased.carried).toEqual({ 'login/codex': 'login/codex' });
    expect((await aliasesApi.commit(rebased.draft)).done).toEqual(['login/codex']);
    expect(loginMap(s.stored()).codex[1]).toEqual({ name: 'gpt-5.4', alias: 'g54-b', fork: true });
  });
});

describe('RB-5 kinds of edit', () => {
  test('a carried entry keeps a changed, an added and a removed row, its ids and nextNew', async () => {
    const s = server(fixture('config-full.json'));
    let draft = editOwn(startDraft(await aliasesApi.load()));
    draft = addKeyAlias(draft, 'claude/1/0', 'claude-opus-5-5', 'o4');
    draft = removeRow(draft, 'claude/1/0#3');
    s.edit((doc) => family(doc, 'claude').unshift({ name: 'head', keys: [] }));
    const rebased = rebase(draft, await aliasesApi.load(), []);
    expect(rebased.carried).toEqual({ 'claude/1/0': 'claude/2/0' });
    const kept = rebased.draft.rows.filter((r) => r.entryId === 'claude/2/0');
    expect(kept.map((r) => [r.id, r.sourceIndex, r.alias])).toEqual([
      ['claude/2/0#0', 0, 'o3'],
      ['claude/2/0#new-0', null, 'o4'],
    ]);
    expect(rebased.draft.nextNew).toBe(draft.nextNew);
    // In the fresh entry's place: after the entries before it, before the ones after it.
    const ids = rebased.draft.rows.map((r) => r.entryId);
    expect(ids.indexOf('claude/2/0')).toBeGreaterThan(ids.lastIndexOf('claude/1/1'));
    expect(ids.lastIndexOf('claude/2/0')).toBeLessThan(ids.indexOf('claude/2/1'));
    expect((await aliasesApi.commit(rebased.draft)).done).toEqual(['claude/2/0']);
    expect(keysOf(s.stored(), 'claude', 2)[0].models).toEqual([
      { name: 'claude-opus-5-5', alias: 'o3' },
      { name: 'claude-opus-5-5', alias: 'o4' },
      'stray-string',
      { name: '  ', alias: 'no-name' },
    ]);
  });

  test('undo one entry: rebase onto the draft’s own base, the others carried as they are', async () => {
    server(fixture('config-full.json'));
    const state = await aliasesApi.load();
    let draft = editOwn(startDraft(state));
    draft = changeRow(draft, 'xai/0/0#0', { alias: 'g' });
    draft = addLoginAlias(draft, 'qwen', { upstream: 'q', alias: 'qq' });
    const undone = rebase(draft, draft.base, ['claude/1/0']);
    expect(undone.lost).toEqual([]);
    expect(undone.carried).toEqual({ 'xai/0/0': 'xai/0/0', 'login/qwen': 'login/qwen' });
    expect(row(undone.draft, 'claude/1/0#0')?.alias).toBe('opus');
    expect(row(undone.draft, 'xai/0/0#0')?.alias).toBe('g');
    expect(row(undone.draft, 'login/qwen#new-0')?.alias).toBe('qq');
    expect(planCommit(undone.draft).map((u) => u.entryIds)).toEqual([['xai/0/0'], ['login/qwen']]);
  });
});

describe('RB-6 a new channel', () => {
  test('carried while the fresh state has no rows for it; lost (added) when another client made it', async () => {
    const s = server(fixture('config-full.json'));
    const draft = addLoginAlias(startDraft(await aliasesApi.load()), 'qwen', {
      upstream: 'q',
      alias: 'qq',
    });
    const carried = rebase(draft, await aliasesApi.load(), []);
    expect(carried.carried).toEqual({ 'login/qwen': 'login/qwen' });
    expect(row(carried.draft, 'login/qwen#new-0')?.alias).toBe('qq');
    s.edit((doc) => void (loginMap(doc).qwen = [{ name: 'q2', alias: 'q2a' }]));
    const lost = rebase(draft, await aliasesApi.load(), []);
    expect(lost.carried).toEqual({});
    expect(
      lost.lost.map((l) => [l.entry.id, l.edits.map((e) => [e.kind, e.after?.alias])])
    ).toEqual([['login/qwen', [['added', 'qq']]]]);
    expect(row(lost.draft, 'login/qwen#new-0')).toBeUndefined();
  });
});

describe('RB-7 two alike', () => {
  const twin = () => ({
    name: 'xai-twin',
    keys: [{ 'api-key': 'fixture-key-t', models: [{ name: 'grok-5', alias: 'g' }] }],
  });
  test('two equal groups, neither at the old index: lost', async () => {
    const s = server({ 'api-keys': { xai: [twin(), twin()] } });
    const draft = changeRow(startDraft(await aliasesApi.load()), 'xai/0/0#0', { alias: 'g2' });
    s.edit((doc) => family(doc, 'xai').unshift({ name: 'head', keys: [] }));
    const rebased = rebase(draft, await aliasesApi.load(), []);
    expect(rebased.lost.map((l) => l.entry.id)).toEqual(['xai/0/0']);
    expect(rebased.carried).toEqual({});
  });
  test('two equal groups, the old index still equal: carried there', async () => {
    server({ 'api-keys': { xai: [twin(), twin()] } });
    const draft = changeRow(startDraft(await aliasesApi.load()), 'xai/1/0#0', { alias: 'g2' });
    const rebased = rebase(draft, await aliasesApi.load(), []);
    expect(rebased.carried).toEqual({ 'xai/1/0': 'xai/1/0' });
  });
});

// --- RB-9 ------------------------------------------------------------------------------------

/** mulberry32: a small seeded generator, so every run tries the same 300 cases. */
function random(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}
type Random = ReturnType<typeof random>;

/** config-full without the login rows the proxy ignores: a commit is then never refused. */
function startDoc(): Doc {
  const doc = fixture('config-full.json');
  loginMap(doc).claude = [loginMap(doc).claude[0]];
  return doc;
}

function pageOps(draft: AliasDraft, r: Random, tag: string): AliasDraft {
  let next = draft;
  const count = 1 + r.int(4);
  for (let i = 0; i < count; i++) {
    const alias = `p${tag}-${i}`;
    const rows = next.rows.filter((row) => !isBlankNewRow(row));
    const kind = r.int(4);
    if (kind === 0 && rows.length) {
      next = changeRow(next, r.pick(rows).id, { alias });
    } else if (kind === 1) {
      const keyRows = rows.filter((row) => row.store === 'api-key');
      if (keyRows.length) {
        const target = r.pick(keyRows);
        next = addKeyAlias(next, target.entryId, target.upstream, alias);
      }
    } else if (kind === 2 && rows.length) {
      next = removeRow(next, r.pick(rows).id);
    } else {
      next = addLoginAlias(next, r.pick(['claude', 'codex', 'qwen']), {
        upstream: `m${tag}-${i}`,
        alias,
      });
    }
  }
  return next;
}

/** Every stored model list and channel list of a document. */
function storedLists(doc: Doc): unknown[][] {
  const lists: unknown[][] = [];
  for (const groups of Object.values((doc['api-keys'] as Doc) ?? {})) {
    for (const group of groups as Doc[]) {
      if (Array.isArray(group.models)) lists.push(group.models);
      for (const key of (group.keys as Doc[]) ?? [])
        if (Array.isArray(key.models)) lists.push(key.models);
    }
  }
  return lists;
}

function foreignOps(doc: Doc, r: Random, tag: string) {
  const count = r.int(4);
  for (let i = 0; i < count; i++) {
    const name = `f${tag}-${i}`;
    const kind = r.int(6);
    const lists = storedLists(doc);
    if (kind <= 1 && lists.length) {
      const list = r.pick(lists);
      const rowsOf = list.filter((e) => e && typeof e === 'object') as Doc[];
      const op = r.int(5);
      if (op === 0 && rowsOf.length) r.pick(rowsOf).alias = name;
      else if (op === 1) list.push({ name });
      else if (op === 2 && rowsOf.length) list.push({ name: r.pick(rowsOf).name, alias: name });
      else if (op === 3 && list.length) list.splice(r.int(list.length), 1);
      else if (list.length > 1) {
        const [a, b] = [r.int(list.length), r.int(list.length)];
        [list[a], list[b]] = [list[b], list[a]];
      }
    } else if (kind === 2) {
      const f = r.pick(['codex', 'claude', 'xai', 'openai-compatibility']);
      family(doc, f).unshift(
        f === 'openai-compatibility'
          ? { name, 'base-url': 'https://f.example.invalid/v1', keys: [], models: [] }
          : { name, keys: [{ 'api-key': `fixture-key-${name}` }] }
      );
    } else if (kind === 3) {
      const keys = (family(doc, 'claude')[r.int(2)]?.keys as Doc[] | undefined) ?? [];
      if (keys.length) r.pick(keys).auth_index = name;
    } else if (kind === 4) {
      const map = loginMap(doc);
      const channel = r.pick(Object.keys(map));
      map[channel].push({ name, alias: `${name}-a` });
    } else {
      const map = loginMap(doc);
      const list = map[r.pick(Object.keys(map))];
      if (list.length) (list[r.int(list.length)] as Doc).alias = `${name}-b`;
    }
  }
}

const upstreamCount = (names: string[]) => {
  const counts: Record<string, number> = {};
  for (const n of names) counts[n] = (counts[n] ?? 0) + 1;
  return counts;
};

describe('RB-9 the proof', () => {
  test('300 seeded cases: no foreign row is lost or moved, no edit lands on another row', async () => {
    let carriedSeen = 0;
    let lostSeen = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = random(seed);
      const tag = String(seed);
      const s = server(startDoc());
      const state = await aliasesApi.load();
      const draft = pageOps(startDraft(state), r, tag);
      s.edit((doc) => foreignOps(doc, r, tag));
      const foreignDoc = clone(s.stored());
      const written = draftEntries(draft)
        .map((e) => e.id)
        .filter(() => r.next() < 0.3);
      const fresh: AliasState = await aliasesApi.load();
      const rebased = rebase(draft, fresh, written);
      nothingVanishes(draft, written, rebased);
      carriedSeen += Object.keys(rebased.carried).length;
      lostSeen += rebased.lost.length;

      const outcome = await aliasesApi.commit(rebased.draft);
      // Onto the very file it was rebased on, nothing conflicts.
      expect({ seed, failed: outcome.failed }).toEqual({ seed, failed: [] });
      const done = new Set(outcome.done);
      const final = readAliasState(s.stored(), credentialFiles());
      const finalById = new Map(final.entries.map((e) => [e.id, e]));

      for (const entry of fresh.entries) {
        const after = finalById.get(entry.id);
        expect({ seed, id: entry.id, present: !!after }).toEqual({
          seed,
          id: entry.id,
          present: true,
        });
        if (entry.store === 'api-key') {
          const k = after as KeyEntry;
          // Property 1: the same upstream names, in the same number, but for the page's own adds and removes.
          const expected = upstreamCount(
            fresh.rows.filter((x) => x.entryId === entry.id).map((x) => x.upstream)
          );
          if (done.has(entry.id)) {
            const mine = rebased.draft.rows.filter(
              (x) => x.entryId === entry.id && !isBlankNewRow(x)
            );
            const baseIds = new Set(
              fresh.rows.filter((x) => x.entryId === entry.id).map((x) => x.id)
            );
            const mineIds = new Set(mine.map((x) => x.id));
            for (const x of mine)
              if (!baseIds.has(x.id)) expected[x.upstream] = (expected[x.upstream] ?? 0) + 1;
            for (const x of fresh.rows.filter((y) => y.entryId === entry.id && !mineIds.has(y.id)))
              expected[x.upstream] -= 1;
            for (const n of Object.keys(expected)) if (expected[n] === 0) delete expected[n];
          }
          const got = upstreamCount(
            final.rows.filter((x) => x.entryId === entry.id).map((x) => x.upstream)
          );
          expect({ seed, id: entry.id, names: got }).toEqual({
            seed,
            id: entry.id,
            names: expected,
          });
          // Property 2: a list of an entry not written deep-equals the foreign document's.
          if (!done.has(entry.id)) {
            const was = effectiveModels(entry.storedGroup, entry.keyIndex).list;
            const now = effectiveModels(k.storedGroup, k.keyIndex).list;
            expect({ seed, id: entry.id, same: sameConfig(now, was) }).toEqual({
              seed,
              id: entry.id,
              same: true,
            });
          }
        } else if (!done.has(entry.id)) {
          const same = sameConfig((after as LoginEntry).storedList, entry.storedList);
          expect({ seed, id: entry.id, same }).toEqual({ seed, id: entry.id, same: true });
        }
      }
      // Outside the two stores the file is the foreign one.
      expect({ seed, rest: { ...s.stored(), 'api-keys': 0, oauth: 0 } }).toEqual({
        seed,
        rest: { ...foreignDoc, 'api-keys': 0, oauth: 0 },
      });
      restoreClient();
    }
    // The cases reach both outcomes.
    expect(carriedSeen).toBeGreaterThan(50);
    expect(lostSeen).toBeGreaterThan(20);
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import { aliasesApi } from '@/provimux/pages/aliases/aliasesApi';
import {
  addKeyAlias,
  addLoginAlias,
  changeRow,
  editsOf,
  removeRow,
  startDraft,
} from '@/provimux/pages/aliases/draft';
import { planWrites } from '@/provimux/pages/aliases/plan';
import { ALIAS_FAMILIES, readAliasState } from '@/provimux/pages/aliases/rows';
import type { AliasDraft, AliasRow, KeyEntry } from '@/provimux/pages/aliases/types';
import type { ProviderFamily } from '@/services/api/providers';
import type { Doc } from '../helpers/aliasesStore';
import { applyBody, fakeProxy, restoreProxy } from './support/fakeProxy';

/*
 * W7, design aliases-page.md section 7, "The properties": P-0 … P-3, seeded, 300 cases each, no library.
 * They replace RB-9. The documents are made so that nothing can be told apart by its content; the
 * operations go through draft.ts alone, each recorded by where the test found its target in the
 * document, from which the test writes the row id itself (section 2's scheme). Nothing here takes an id
 * or a `sourceIndex` from the state, and the oracle uses nothing of plan.ts.
 */

afterEach(restoreProxy);

const CASES = 300;
/** Seeds start here; a failure names its seed. */
const FIRST_SEED = 1;

// --- randomness ------------------------------------------------------------------------------------

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    next,
    int,
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[int(items.length)],
  };
}
type Rng = ReturnType<typeof rng>;

// --- the generator ---------------------------------------------------------------------------------

const KEY_FAMILIES: ProviderFamily[] = ['claude', 'codex', 'openai-compatibility'];
const NAMES = ['a', 'b', ' a '];

/** A model row of store A from a small pool: deep-equal rows and rows sharing a name are common. */
function keyRowElement(r: Rng): Doc {
  const name = r.pick(NAMES);
  const row: Doc = { name };
  const alias = r.pick([undefined, 'x', 'y', ' x ', name.trim(), '']);
  if (alias !== undefined) row.alias = alias;
  if (r.chance(0.3)) row['force-mapping'] = r.pick([true, false]);
  if (r.chance(0.3)) row['display-name'] = r.pick(['D', ' D ']);
  if (r.chance(0.15)) row.fork = false;
  if (r.chance(0.2)) row['x-unknown'] = r.pick([1, { deep: [' v '] }]);
  if (r.chance(0.1)) row.thinking = { levels: ['low'] };
  return row;
}
const NON_ROWS_A = [null, 'stray', 7, { alias: 'nameless' }, { name: '  ' }];

function keyList(r: Rng): unknown[] {
  const list: unknown[] = [];
  const n = 1 + r.int(4);
  for (let i = 0; i < n; i += 1) {
    list.push(r.chance(0.15) ? structuredClone(r.pick(NON_ROWS_A)) : keyRowElement(r));
  }
  return list;
}

function keyObject(r: Rng): Doc {
  const key: Doc = { 'api-key': 'fixture-key-same' };
  if (r.chance(0.4)) key.auth_index = 'ai-same';
  if (r.chance(0.3)) key.headers = { 'auth-index': r.pick(['left', 'right']) };
  if (r.chance(0.4)) key.models = keyList(r);
  else if (r.chance(0.15)) key.models = null;
  return key;
}

function group(r: Rng, family: ProviderFamily): unknown {
  if (r.chance(0.05)) return 'junk-group';
  const g: Doc = { name: 'g' };
  if (family === 'openai-compatibility') g['base-url'] = 'https://same.example.invalid/v1';
  if (r.chance(0.2)) g['x-group'] = 'kept';
  const keys = 1 + r.int(3);
  g.keys = Array.from({ length: keys }, () => keyObject(r));
  if (family === 'openai-compatibility') {
    g.keys = (g.keys as Doc[]).map((k) => {
      const plain = { ...k };
      delete plain.models;
      return plain;
    });
    g.models = keyList(r);
  } else if (r.chance(0.6)) g.models = keyList(r);
  // Deep-equal groups are common: sometimes the next group is this one again.
  return g;
}

let aliasCounter = 0;
const freshAlias = () => `l${++aliasCounter}`;

function loginRowElement(r: Rng): Doc {
  const row: Doc = {
    name: r.pick(['a', 'b']),
    alias: r.chance(0.2) ? ` ${freshAlias()} ` : freshAlias(),
  };
  if (r.chance(0.4)) row.fork = r.pick([true, false]);
  if (r.chance(0.3)) row['force-mapping'] = r.pick([true, false]);
  if (r.chance(0.3)) row['display-name'] = r.pick(['N', ' N ']);
  if (r.chance(0.2)) row.openapi = true;
  if (r.chance(0.2)) row['x-unknown'] = { deep: 1 };
  return row;
}

function loginMapOf(r: Rng): Doc {
  const map: Doc = {};
  for (const key of ['codex', 'CODEX', 'claude', 'kimi']) {
    if (!r.chance(0.6)) continue;
    const list: unknown[] = [];
    const n = r.int(4);
    for (let i = 0; i < n; i += 1) {
      list.push(r.chance(0.15) ? r.pick([null, 'stray']) : loginRowElement(r));
    }
    map[key] = list;
  }
  return map;
}

function documentOf(r: Rng): Doc {
  aliasCounter = 0; // so that a seed reproduces alone
  const apiKeys: Doc = {};
  const families = KEY_FAMILIES.filter(() => r.chance(0.7));
  if (!families.length) families.push(r.pick(KEY_FAMILIES));
  for (const family of families) {
    const groups: unknown[] = [];
    const n = 1 + r.int(3);
    for (let i = 0; i < n; i += 1) {
      groups.push(i > 0 && r.chance(0.4) ? structuredClone(groups[i - 1]) : group(r, family));
    }
    apiKeys[family] = groups;
  }
  const doc: Doc = {
    'config-version': 8,
    routing: { strategy: 'round-robin' },
    'api-keys': apiKeys,
  };
  if (r.chance(0.85)) doc.oauth = { 'model-alias': loginMapOf(r) };
  return doc;
}

// --- reading the document as the test knows it (2.2, 2.3) --------------------------------------

const isObj = (v: unknown): v is Doc => !!v && typeof v === 'object' && !Array.isArray(v);
const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isKeyRow = (v: unknown): v is Doc => isObj(v) && trim(v.name) !== '';

interface KeyPlace {
  family: ProviderFamily;
  g: number;
  /** null: an OpenAI-compatible entry. */
  k: number | null;
  id: string;
  /** Where its list is: the key's own, or the group's. */
  on: 'key' | 'group';
  list: unknown[];
}

/** Every key entry of the document, as 2.2 places it. */
function keyPlaces(doc: Doc): KeyPlace[] {
  const places: KeyPlace[] = [];
  const apiKeys = (doc['api-keys'] ?? {}) as Doc;
  for (const family of ALIAS_FAMILIES) {
    const groups = apiKeys[family];
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, g) => {
      if (!isObj(group) || !Array.isArray(group.keys)) return;
      const groupList = Array.isArray(group.models) ? (group.models as unknown[]) : [];
      if (family === 'openai-compatibility') {
        places.push({ family, g, k: null, id: `${family}/${g}/g`, on: 'group', list: groupList });
        return;
      }
      (group.keys as unknown[]).forEach((key, k) => {
        if (!isObj(key) || trim(key['api-key']) === '') return;
        const own = key.models !== undefined && key.models !== null;
        places.push({
          family,
          g,
          k,
          id: `${family}/${g}/${k}`,
          on: own ? 'key' : 'group',
          list: own ? (key.models as unknown[]) : groupList,
        });
      });
    });
  }
  return places;
}

interface LoginPlace {
  channel: string;
  id: string;
  spellings: string[];
  list: unknown[];
}

function loginPlaces(doc: Doc): LoginPlace[] {
  const map = isObj(doc.oauth) && isObj(doc.oauth['model-alias']) ? doc.oauth['model-alias'] : {};
  const byChannel = new Map<string, LoginPlace>();
  for (const [spelling, list] of Object.entries(map)) {
    const channel = normalizeOAuthProviderKey(spelling);
    const place = byChannel.get(channel) ?? {
      channel,
      id: `login/${channel}`,
      spellings: [],
      list: [],
    };
    place.spellings.push(spelling);
    if (Array.isArray(list)) place.list.push(...list);
    byChannel.set(channel, place);
  }
  return [...byChannel.values()];
}

// --- the operations and the oracle ---------------------------------------------------------------

/** A row as the reader gives its fields (2.2, 2.3): the base the draft starts from. */
interface Fields {
  upstream: string;
  alias: string | null;
  fm: boolean | null;
  fork: boolean | null;
  dn: string | null;
}
const keyFields = (el: Doc): Fields => {
  const upstream = trim(el.name);
  const alias = trim(el.alias);
  return {
    upstream,
    alias: alias && alias !== upstream ? alias : null,
    fm: typeof el['force-mapping'] === 'boolean' ? (el['force-mapping'] as boolean) : null,
    fork: null,
    dn: null,
  };
};
const loginFields = (el: Doc): Fields => ({
  upstream: trim(el.name),
  alias: trim(el.alias) || null,
  fm: typeof el['force-mapping'] === 'boolean' ? (el['force-mapping'] as boolean) : null,
  fork: el.fork === true,
  dn: trim(el['display-name']) || null,
});
/** 3.1: an empty alias, or one equal to the upstream name, is no alias (the draft keeps it untrimmed). */
const aliasOf = (alias: string, upstream: string) =>
  alias.trim() === '' || alias.trim() === upstream.trim() ? null : alias;

type Item =
  | { t: 'el'; el: unknown }
  | { t: 'row'; pos: number; el: Doc; base: Fields; cur: Fields; removed: boolean }
  | { t: 'new'; cur: Fields };

interface Model {
  store: 'A' | 'B';
  id: string;
  items: Item[];
  key?: KeyPlace;
  login?: LoginPlace;
}

const txt = (v: string | null) => (v ?? '').trim();
const differs = (store: 'A' | 'B', a: Fields, b: Fields) =>
  a.upstream.trim() !== b.upstream.trim() ||
  txt(a.alias) !== txt(b.alias) ||
  a.fm !== b.fm ||
  (store === 'B' && (a.fork !== b.fork || txt(a.dn) !== txt(b.dn)));

const changed = (m: Model) =>
  m.items.some(
    (item) =>
      item.t === 'new' ||
      (item.t === 'row' && (item.removed || differs(m.store, item.cur, item.base)))
  );

/** The table of 2.4, as the test reads it: only the fields that differ from the base are touched. */
function written(m: Model, item: Extract<Item, { t: 'row' }>): Doc {
  const { el, base, cur } = item;
  if (!differs(m.store, cur, base)) return el;
  const next: Doc = { ...el };
  if (m.store === 'B' && cur.upstream.trim() !== base.upstream.trim())
    next.name = cur.upstream.trim();
  if (txt(cur.alias) !== txt(base.alias)) {
    if (m.store === 'B') next.alias = txt(cur.alias);
    else if (cur.alias) next.alias = cur.alias.trim();
    else delete next.alias;
  }
  if (cur.fm !== base.fm) {
    if (cur.fm === true) next['force-mapping'] = true;
    else if (cur.fm === false && typeof el['force-mapping'] === 'boolean')
      next['force-mapping'] = false;
    else delete next['force-mapping'];
  }
  if (m.store === 'B' && cur.fork !== base.fork) {
    if (cur.fork) next.fork = true;
    else delete next.fork;
  }
  if (m.store === 'B' && txt(cur.dn) !== txt(base.dn)) {
    if (txt(cur.dn)) next['display-name'] = txt(cur.dn);
    else delete next['display-name'];
  }
  return next;
}

function newElement(m: Model, cur: Fields): Doc {
  if (m.store === 'A') {
    const next: Doc = { name: cur.upstream };
    if (cur.alias) next.alias = cur.alias.trim();
    return next;
  }
  return { name: cur.upstream.trim(), alias: txt(cur.alias), fork: true };
}

const listOut = (m: Model): unknown[] =>
  m.items.flatMap((item) => {
    if (item.t === 'el') return [item.el];
    if (item.t === 'new') return [newElement(m, item.cur)];
    return item.removed ? [] : [written(m, item)];
  });

/** The oracle: the recorded operations applied to a copy of the read, at their recorded places. */
function oracle(read: Doc, models: Model[]): Doc {
  const doc = structuredClone(read);
  for (const m of models) {
    if (!changed(m)) continue;
    if (m.key) {
      const { family, g, k } = m.key;
      const group = ((doc['api-keys'] as Doc)[family] as Doc[])[g];
      if (k === null) group.models = listOut(m);
      else {
        const keys = group.keys as Doc[];
        keys[k] = { ...keys[k], models: listOut(m) };
      }
    } else if (m.login) {
      const oauth = (doc.oauth ?? {}) as Doc;
      const map = { ...((oauth['model-alias'] ?? {}) as Doc) };
      for (const spelling of m.login.spellings) delete map[spelling];
      const list = listOut(m);
      if (list.length) map[m.login.channel] = list;
      doc.oauth = { ...oauth, 'model-alias': map };
    }
  }
  return doc;
}

function modelOfKey(place: KeyPlace): Model {
  return {
    store: 'A',
    id: place.id,
    key: place,
    items: place.list.map((el, pos): Item => {
      if (!isKeyRow(el)) return { t: 'el', el };
      const base = keyFields(el);
      return { t: 'row', pos, el, base, cur: { ...base }, removed: false };
    }),
  };
}

function modelOfLogin(place: LoginPlace): Model {
  return {
    store: 'B',
    id: place.id,
    login: place,
    items: place.list.map((el, pos): Item => {
      if (!isObj(el)) return { t: 'el', el };
      const base = loginFields(el);
      return { t: 'row', pos, el, base, cur: { ...base }, removed: false };
    }),
  };
}

const liveRows = (m: Model) =>
  m.items.filter(
    (i): i is Extract<Item, { t: 'row' }> | Extract<Item, { t: 'new' }> =>
      i.t === 'new' || (i.t === 'row' && !i.removed)
  );

/** A row operation recorded by its place: the model, and the position in its stored list. */
interface Recorded {
  model: string;
  pos: number | null;
  what: string;
}

/**
 * Random operations through draft.ts, mirrored on the models. Changes and removals first, then adds:
 * a new row goes after the last row of its model (store A: of its upstream name).
 */
function operate(r: Rng, read: Doc, draft: AliasDraft) {
  const models = [...keyPlaces(read).map(modelOfKey), ...loginPlaces(read).map(modelOfLogin)];
  const ops: Recorded[] = [];
  const n = 1 + r.int(6);
  for (let i = 0; i < n; i += 1) {
    const m = r.pick(models);
    const rows = m.items.filter(
      (it): it is Extract<Item, { t: 'row' }> => it.t === 'row' && !it.removed
    );
    if (!rows.length) continue;
    const row = r.pick(rows);
    const rowId = `${m.id}#${row.pos}`;
    const kind = r.int(m.store === 'A' ? 3 : 6);
    if (kind === 0) {
      const value =
        m.store === 'A' ? r.pick(['x', 'y', 'z', ' x ', '', row.cur.upstream]) : freshAlias();
      draft = changeRow(draft, rowId, { alias: value });
      row.cur.alias = aliasOf(value, row.cur.upstream);
      ops.push({ model: m.id, pos: row.pos, what: 'alias' });
    } else if (kind === 1) {
      const value = r.pick([true, false, null]);
      draft = changeRow(draft, rowId, { forceMapping: value });
      row.cur.fm = value;
      ops.push({ model: m.id, pos: row.pos, what: 'force-mapping' });
    } else if (kind === 2) {
      draft = removeRow(draft, rowId);
      if (m.store === 'B') row.removed = true;
      else {
        const another = liveRows(m).some(
          (other) => other !== row && other.cur.upstream.trim() === row.cur.upstream.trim()
        );
        if (another) row.removed = true;
        else row.cur.alias = null;
      }
      ops.push({ model: m.id, pos: row.pos, what: 'remove' });
    } else if (kind === 3) {
      draft = changeRow(draft, rowId, { fork: !row.cur.fork });
      row.cur.fork = !row.cur.fork;
      ops.push({ model: m.id, pos: row.pos, what: 'fork' });
    } else if (kind === 4) {
      const value = r.pick(['N', ' N ', '', 'M']);
      draft = changeRow(draft, rowId, { displayName: value });
      row.cur.dn = value;
      ops.push({ model: m.id, pos: row.pos, what: 'display-name' });
    } else {
      const value = r.pick(['a', 'b', ' b ']);
      draft = changeRow(draft, rowId, { upstream: value });
      row.cur.upstream = value;
      ops.push({ model: m.id, pos: row.pos, what: 'model' });
    }
  }
  const adds = r.int(3);
  for (let i = 0; i < adds; i += 1) {
    if (r.chance(0.5)) {
      const keyModels = models.filter((m) => m.store === 'A' && liveRows(m).length);
      if (!keyModels.length) continue;
      const m = r.pick(keyModels);
      const upstream = r.pick(liveRows(m)).cur.upstream.trim();
      const alias = r.pick(['x', 'w', ' w ']);
      draft = addKeyAlias(draft, m.id, upstream, alias);
      const cur: Fields = {
        upstream,
        alias: aliasOf(alias, upstream),
        fm: null,
        fork: null,
        dn: null,
      };
      let at = -1;
      m.items.forEach((it, idx) => {
        if (
          (it.t === 'new' || (it.t === 'row' && !it.removed)) &&
          it.cur.upstream.trim() === upstream
        )
          at = idx;
      });
      m.items.splice(at + 1, 0, { t: 'new', cur });
      ops.push({ model: m.id, pos: null, what: 'add' });
    } else {
      const channel = r.pick(['codex', 'claude', 'kimi', 'qwen']);
      const upstream = r.pick(['a', 'b']);
      const alias = freshAlias();
      draft = addLoginAlias(draft, channel, { upstream, alias });
      let m = models.find((x) => x.id === `login/${channel}`);
      if (!m) {
        m = modelOfLogin({ channel, id: `login/${channel}`, spellings: [], list: [] });
        models.push(m);
      }
      let at = -1;
      m.items.forEach((it, idx) => {
        if (it.t === 'new' || (it.t === 'row' && !it.removed)) at = idx;
      });
      m.items.splice(at + 1, 0, {
        t: 'new',
        cur: { upstream, alias, fm: null, fork: true, dn: null },
      });
      ops.push({ model: m.id, pos: null, what: 'add' });
    }
  }
  return { draft, models, ops };
}

/** Each planned body put at its path in a copy of the read, replaced whole, as a 200 would leave it. */
function planned(read: Doc, draft: AliasDraft): Doc {
  const doc = structuredClone(read);
  for (const write of planWrites(draft)) {
    const family = write.path.match(/^\/config\/api-keys\/(.+)$/)?.[1];
    if (family) (doc['api-keys'] as Doc)[family] = structuredClone(write.body);
    else doc.oauth = { ...((doc.oauth ?? {}) as Doc), 'model-alias': structuredClone(write.body) };
  }
  return doc;
}

/** Runs `check` for 300 seeds; a failure names its seed. */
async function forSeeds(check: (seed: number) => void | Promise<void>, wanted = CASES) {
  for (let seed = FIRST_SEED; seed < FIRST_SEED + wanted; seed += 1) {
    try {
      await check(seed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`first failing seed ${seed}:\n${message}`, { cause: error });
    }
  }
}

// --- P-0 ---------------------------------------------------------------------------------------------

describe('P-0 a row is the stored object at its position', () => {
  test('300 documents', async () => {
    await forSeeds((seed) => {
      const r = rng(seed);
      const doc = documentOf(r);
      const state = readAliasState(doc, null);
      const places = keyPlaces(doc);
      const keyEntries = state.entries.filter((e): e is KeyEntry => e.store === 'api-key');
      expect(keyEntries.map((e) => e.id)).toEqual(places.map((p) => p.id));
      for (const place of places) {
        const entry = keyEntries.find((e) => e.id === place.id)!;
        // The entry's id is its place, and its stored group is that very object of the document.
        expect([entry.family, entry.groupIndex, entry.keyIndex]).toEqual([
          place.family,
          place.g,
          place.k,
        ]);
        const groups = (doc['api-keys'] as Doc)[place.family] as unknown[];
        expect(entry.storedGroup === groups[place.g]).toBe(true);
        const expected: AliasRow[] = place.list.flatMap((el, pos) => {
          if (!isKeyRow(el)) return [];
          const f = keyFields(el);
          const dn = el['display-name'];
          return [
            {
              id: `${place.id}#${pos}`,
              entryId: place.id,
              store: 'api-key' as const,
              sourceIndex: pos,
              upstream: f.upstream,
              alias: f.alias,
              fork: null,
              forceMapping: f.fm,
              displayName: typeof dn === 'string' ? dn : null,
            },
          ];
        });
        expect(state.rows.filter((row) => row.entryId === place.id)).toEqual(expected);
        expect(entry.listSource).toBe(expected.length ? place.on : 'none');
      }
      for (const place of loginPlaces(doc)) {
        const expected: AliasRow[] = place.list.flatMap((el, pos) => {
          if (!isObj(el)) return [];
          const f = loginFields(el);
          return [
            {
              id: `${place.id}#${pos}`,
              entryId: place.id,
              store: 'login' as const,
              sourceIndex: pos,
              upstream: f.upstream,
              alias: f.alias,
              fork: f.fork,
              forceMapping: f.fm,
              displayName: f.dn,
            },
          ];
        });
        expect(state.rows.filter((row) => row.entryId === place.id)).toEqual(expected);
      }
    });
  });
});

// --- P-1 ---------------------------------------------------------------------------------------------

describe('P-1 an edit lands on the object the user edited, and nothing else changes', () => {
  test('300 documents and drafts', async () => {
    let edited = 0;
    await forSeeds((seed) => {
      const r = rng(seed);
      const doc = documentOf(r);
      const state = readAliasState(doc, null);
      const read = structuredClone(doc);
      const { draft, models } = operate(r, read, startDraft(state));
      edited += models.filter(changed).length;
      expect(planned(read, draft)).toEqual(oracle(read, models));
    });
    // The property is about edits: most cases must have some.
    expect(edited).toBeGreaterThan(CASES);
  });
});

// --- P-2 and P-3: through the save --------------------------------------------------------------------

/** A foreign change: a row, key or group inserted, removed, moved or edited, or a setting elsewhere. */
function foreignChange(r: Rng): (doc: Doc) => void {
  const kind = r.int(8);
  const family = r.pick([...KEY_FAMILIES, 'meta' as ProviderFamily]);
  const at = r.int(3);
  const value = r.int(1000);
  return (doc) => {
    const apiKeys = (doc['api-keys'] ?? (doc['api-keys'] = {})) as Doc;
    const groups = Array.isArray(apiKeys[family]) ? (apiKeys[family] as Doc[]) : null;
    switch (kind) {
      case 0:
        (doc.routing as Doc).strategy = `fill-first-${value}`;
        return;
      case 1:
        apiKeys[family] = [
          ...(groups ?? []).slice(0, at),
          { name: 'g', keys: [{ 'api-key': 'fixture-key-same' }] },
          ...(groups ?? []).slice(at),
        ];
        return;
      case 2:
        if (groups?.length) groups.splice(at % groups.length, 1);
        else (doc.routing as Doc).strategy = `x-${value}`;
        return;
      case 3:
        if (groups && groups.length > 1) groups.reverse();
        else (doc.routing as Doc).strategy = `y-${value}`;
        return;
      case 4: {
        const g = groups?.[at % (groups?.length || 1)];
        if (g && typeof g === 'object' && Array.isArray(g.keys)) {
          (g.keys as Doc[]).unshift({ 'api-key': 'fixture-key-same' });
        } else (doc.routing as Doc).strategy = `z-${value}`;
        return;
      }
      case 5: {
        const g = groups?.[at % (groups?.length || 1)];
        if (g && typeof g === 'object') (g as Doc)['x-foreign'] = value;
        else (doc.routing as Doc).strategy = `w-${value}`;
        return;
      }
      case 6: {
        const oauth = (doc.oauth ?? (doc.oauth = {})) as Doc;
        const map = (oauth['model-alias'] ?? (oauth['model-alias'] = {})) as Doc;
        map.codex = [{ name: 'a', alias: `foreign-${value}` }, ...((map.codex as unknown[]) ?? [])];
        return;
      }
      default: {
        const oauth = (doc.oauth ?? (doc.oauth = {})) as Doc;
        const map = (oauth['model-alias'] ?? (oauth['model-alias'] = {})) as Doc;
        delete map.claude;
        map.kimi = [];
        return;
      }
    }
  };
}

/** A draft with at least one unit, over a document the fake proxy serves; null when the seed gives none. */
async function savable(seed: number) {
  const r = rng(seed);
  const doc = documentOf(r);
  const p = fakeProxy(doc);
  const state = await aliasesApi.load();
  const read = structuredClone(p.doc());
  const { draft, models, ops } = operate(r, read, startDraft(state));
  const writes = planWrites(draft);
  p.requests.length = 0;
  return { r, p, read, draft, models, ops, writes };
}

const withBodies = (read: Doc, writes: { path: string; body: unknown }[]) =>
  writes.reduce((doc, write) => applyBody(doc, write.path, write.body), read);

/** Runs until `wanted` seeds gave a draft with units; a failure names its seed. */
async function forSavableSeeds(
  check: (c: Awaited<ReturnType<typeof savable>>, seed: number) => Promise<void>
) {
  let ran = 0;
  for (let seed = FIRST_SEED; ran < CASES; seed += 1) {
    if (seed > FIRST_SEED + CASES * 10)
      throw new Error('the generator gives too few savable drafts');
    const c = await savable(seed);
    if (!c.writes.length) {
      restoreProxy();
      continue;
    }
    ran += 1;
    try {
      await check(c, seed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`first failing seed ${seed}:\n${message}`, { cause: error });
    } finally {
      restoreProxy();
    }
  }
}

describe('P-2 after a change elsewhere, the page writes nothing', () => {
  test('300 saves, a foreign change at a random moment', async () => {
    let between = 0;
    await forSavableSeeds(async ({ r, p, read, draft, models, writes }) => {
      const change = foreignChange(r);
      const n = 1 + r.int(writes.length); // before the n-th put: the first, or between two units
      if (n > 1) between += 1;
      let before: Doc | null = null;
      let after: Doc | null = null;
      p.beforePut(n, () => {
        before = structuredClone(p.doc());
        p.foreign(change);
        after = structuredClone(p.doc());
      });
      const outcome = await aliasesApi.commit(draft);
      const sent = writes.slice(0, n - 1);
      // The file is the other writer's, untouched by the page after the change.
      expect(p.doc()).toEqual(after!);
      expect(before!).toEqual(withBodies(read, sent));
      expect(outcome.confirmed).toEqual(sent.flatMap((w) => w.unit.entryIds));
      expect(outcome.unconfirmed).toEqual(writes.slice(n - 1).flatMap((w) => w.unit.entryIds));
      expect(outcome.failure?.reason).toBe('changed');
      // Exactly one put after the change, refused; none before it unanswered.
      expect(p.puts()).toHaveLength(n);
      expect(p.puts().map((x) => x.status)).toEqual([...sent.map(() => 200), 412]);
      expect(p.gets()).toEqual([]);
      expect(p.unconditional).toBe(0);
      // Every operation of an unconfirmed entry is among its edits, to be typed again.
      for (const id of outcome.unconfirmed) {
        const m = models.find((x) => x.id === id)!;
        const edits = editsOf(draft, id);
        const ids = new Set(edits.flatMap((e) => [e.before?.id, e.after?.id]));
        for (const item of m.items) {
          if (item.t === 'row' && (item.removed || differs(m.store, item.cur, item.base))) {
            expect([id, item.pos, ids.has(`${id}#${item.pos}`)]).toEqual([id, item.pos, true]);
          }
        }
        expect(edits.filter((e) => e.kind === 'added')).toHaveLength(
          m.items.filter((i) => i.t === 'new').length
        );
      }
    });
    expect(between).toBeGreaterThan(0);
  });
});

describe('P-3 no write without the right tag', () => {
  test('300 saves: a read without a tag, one answer without a tag, or neither', async () => {
    const seen = { read: 0, answer: 0, neither: 0 };
    await forSavableSeeds(async ({ r, p, read, draft, writes }) => {
      const mode = r.pick(['read', 'answer', 'neither'] as const);
      seen[mode] += 1;
      const k = 1 + r.int(writes.length);
      let state = draft;
      if (mode === 'read') {
        // The same read, without its tag: what the page holds when the header was hidden.
        state = { ...draft, base: { ...draft.base, etag: null } };
      }
      if (mode === 'answer') p.answerTag = (n) => n !== k;
      const outcome = await aliasesApi.commit(state);
      const puts = p.puts();
      expect(p.gets()).toEqual([]);
      expect(p.unconditional).toBe(0);
      // Every put carries the tag the proxy last handed the page.
      const handed = [draft.base.etag, ...puts.map((x) => x.tag)];
      expect(puts.map((x) => x.ifMatch)).toEqual(handed.slice(0, puts.length));
      const sentUnits = mode === 'read' ? 0 : mode === 'answer' ? k : writes.length;
      expect(puts).toHaveLength(sentUnits);
      expect(p.doc()).toEqual(withBodies(read, writes.slice(0, sentUnits)));
      expect(outcome.confirmed).toEqual(writes.slice(0, sentUnits).flatMap((w) => w.unit.entryIds));
      expect(outcome.unconfirmed).toEqual(writes.slice(sentUnits).flatMap((w) => w.unit.entryIds));
      expect(outcome.failure?.reason ?? null).toBe(sentUnits < writes.length ? 'no-tag' : null);
    });
    expect(Math.min(seen.read, seen.answer, seen.neither)).toBeGreaterThan(0);
  });
});

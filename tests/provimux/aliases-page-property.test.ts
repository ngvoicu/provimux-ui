import { describe, expect, test } from 'bun:test';
import {
  addKeyAlias,
  addLoginAlias,
  changeRow,
  discard,
  discardEntry,
  removeRow,
  startDraft,
} from '@/provimux/pages/aliases/draft';
import {
  INITIAL_PAGE,
  canEdit,
  pageStep,
  type PageEvent,
  type PageState,
} from '@/provimux/pages/aliases/pageLogic';
import { planCommit } from '@/provimux/pages/aliases/plan';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import type {
  AliasDraft,
  AliasRow,
  AliasState,
  CommitOutcome,
  SaveFailure,
} from '@/provimux/pages/aliases/types';

/*
 * U4, design aliases-page.md section 7, P-4 "nothing is carried": `pageStep` is pure, so random sequences
 * of page events over random documents, reads and outcomes are run through it, 300 seeds, no library.
 *
 * The test keeps its own model of the draft and the texts, made with draft.ts alone (the data layer,
 * not under test here): the draft starts at each read the page takes, and an edit changes it only when
 * the board takes input by the design's definition (a read held, with a tag, nothing pending). After
 * every event the page must hold the model's draft and texts. After each save, each entry the dropped
 * draft changed is confirmed, or listed in `lost` once with exactly what is to be typed again: the test
 * works the edits out itself from the dropped draft (each kind, and the whole row before and after,
 * every value of it) and compares the listed ones with them. `lost` only grows, except by `dismissed`.
 *
 * Faults it must catch (each put into a scratch copy of pageLogic.ts and shown to fail; see the U4 and
 * T-277 reports): rows of an unconfirmed entry kept in the next draft, by id, by position or by
 * content; the texts kept across a read; an edit accepted while a read is pending, or while a save
 * runs; an unconfirmed entry missing from `lost` when the fresh read has no entry left; the edits of a
 * login type the draft added missing from `lost`; a read's answer replacing the draft of a running
 * save; the right row listed with another row's alias (the third review's mutation); an edit listed
 * with the typed alias as its alias before.
 */

const CASES = 300;
const FIRST_SEED = 1;
const EVENTS = 40;

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
    int,
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[int(items.length)],
  };
}
type Rng = ReturnType<typeof rng>;

// --- documents -------------------------------------------------------------------------------------

type Doc = Record<string, unknown>;

/** A small pool of names and aliases, so that rows equal in content are common. */
function keyList(r: Rng): unknown[] {
  return Array.from({ length: 1 + r.int(3) }, () => {
    const row: Doc = { name: r.pick(['a', 'b']) };
    const alias = r.pick([undefined, 'x', 'y']);
    if (alias) row.alias = alias;
    if (r.chance(0.2)) row['force-mapping'] = r.pick([true, false]);
    return row;
  });
}

function documentOf(r: Rng): Doc {
  // A file with no entry at all: the empty state.
  if (r.chance(0.15)) return { 'config-version': 8 };
  const apiKeys: Doc = {};
  for (const family of ['claude', 'codex', 'openai-compatibility']) {
    if (!r.chance(0.6)) continue;
    apiKeys[family] = Array.from({ length: 1 + r.int(2) }, () => {
      const group: Doc = { name: 'g', keys: [] };
      if (family === 'openai-compatibility') {
        group['base-url'] = 'https://same.example.invalid/v1';
        group.keys = [{ 'api-key': 'fixture-key-same' }];
        group.models = keyList(r);
        return group;
      }
      group.keys = Array.from({ length: 1 + r.int(2) }, () =>
        r.chance(0.6)
          ? { 'api-key': 'fixture-key-same', models: keyList(r) }
          : { 'api-key': 'fixture-key-same' }
      );
      if (r.chance(0.5)) group.models = keyList(r);
      return group;
    });
  }
  // A part the page cannot read (2.5) now and then.
  if (r.chance(0.1)) apiKeys.gemini = ['junk-group'];
  const doc: Doc = { 'config-version': 8, 'api-keys': apiKeys };
  if (r.chance(0.7)) {
    const map: Doc = {};
    for (const channel of ['codex', 'claude']) {
      if (!r.chance(0.6)) continue;
      map[channel] = Array.from({ length: r.int(3) }, (_, i) => ({
        name: r.pick(['a', 'b']),
        alias: `${channel}-${i}-${r.int(3)}`,
      }));
    }
    if (r.chance(0.08)) map.kimi = 'junk-channel';
    doc.oauth = { 'model-alias': map };
  }
  return doc;
}

/** The same file changed elsewhere: its groups in another order, a row more, or a setting. */
function changedElsewhere(r: Rng, doc: Doc): Doc {
  const next = structuredClone(doc);
  const apiKeys = (next['api-keys'] ?? {}) as Doc;
  const family = r.pick(Object.keys(apiKeys).filter((k) => Array.isArray(apiKeys[k])));
  const groups = family ? (apiKeys[family] as Doc[]) : null;
  const kind = r.int(3);
  if (kind === 0 && groups && groups.length > 1) groups.reverse();
  else if (kind === 1 && groups?.[0] && Array.isArray(groups[0].models)) {
    (groups[0].models as unknown[]).unshift({ name: 'a', alias: 'elsewhere' });
  } else next.routing = { strategy: `fill-first-${r.int(100)}` };
  return next;
}

let tags = 0;
function readOf(r: Rng, doc: Doc): AliasState {
  return { ...readAliasState(doc, null), etag: r.chance(0.1) ? null : `"t${++tags}"` };
}

// --- the test's own model of the page ---------------------------------------------------------------

/** The design's definition (3.6), from the state's fields. */
const takesInput = (page: PageState): boolean =>
  page.draft !== null && page.draft.base.etag !== null && !page.saving && !page.reading;

interface Model {
  draft: AliasDraft | null;
  texts: Record<string, string>;
}

const same = (a: AliasRow, b: AliasRow) =>
  a.upstream.trim() === b.upstream.trim() &&
  (a.alias ?? '').trim() === (b.alias ?? '').trim() &&
  a.forceMapping === b.forceMapping &&
  a.fork === b.fork &&
  (a.displayName ?? '').trim() === (b.displayName ?? '').trim();

/** One edit to type again, as the test works it out: its kind, and the whole rows before and after. */
interface Expected {
  kind: 'changed' | 'added' | 'removed';
  before: AliasRow | null;
  after: AliasRow | null;
}

/**
 * The oracle: per entry, the edits of the draft against its own base, as the test sees them. A changed
 * row is listed with its base row and its draft row, an added one with its draft row (a new row with
 * neither name nor alias is not a row yet), a removed one with its base row; every value is the row's.
 */
function expectedEdits(draft: AliasDraft): Map<string, Expected[]> {
  const result = new Map<string, Expected[]>();
  const add = (entryId: string, edit: Expected) =>
    result.set(entryId, [...(result.get(entryId) ?? []), edit]);
  const base = new Map(draft.base.rows.map((row) => [row.id, row]));
  const kept = new Set(draft.rows.map((row) => row.id));
  for (const row of draft.rows) {
    const before = base.get(row.id);
    if (!before) {
      if (row.upstream.trim() || (row.alias ?? '').trim()) {
        add(row.entryId, { kind: 'added', before: null, after: row });
      }
    } else if (!same(row, before)) add(row.entryId, { kind: 'changed', before, after: row });
  }
  for (const row of draft.base.rows) {
    if (!kept.has(row.id)) add(row.entryId, { kind: 'removed', before: row, after: null });
  }
  return result;
}

/** Edits in one order, whatever order they are listed in: by row id, then kind. */
const sorted = (edits: readonly Expected[]) =>
  [...edits].sort((a, b) => {
    const ka = `${(a.after ?? a.before)!.id}|${a.kind}`;
    const kb = `${(b.after ?? b.before)!.id}|${b.kind}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

// --- events ----------------------------------------------------------------------------------------

const REASONS: SaveFailure[] = ['changed', 'refused', 'error', 'no-tag'];

/** An outcome the commit could give for this draft: the units in order, the first k confirmed. */
function outcomeFor(r: Rng, draft: AliasDraft | null): CommitOutcome {
  const units = draft ? planCommit(draft) : [];
  const k = r.int(units.length + 1);
  const confirmed = units.slice(0, k).flatMap((unit) => unit.entryIds);
  const unconfirmed = units.slice(k).flatMap((unit) => unit.entryIds);
  const failure =
    k === units.length && r.chance(0.6)
      ? null
      : { reason: r.pick(REASONS), message: `message ${r.int(9)}` };
  return { confirmed, unconfirmed, failure };
}

interface Run {
  doc: Doc;
}

/** One random event, aimed where a user could aim it on the page as it is. */
function eventOf(r: Rng, page: PageState, run: Run): PageEvent {
  const rows = page.draft?.rows ?? [];
  const row = rows.length ? r.pick(rows) : null;
  const rowId = row?.id ?? 'claude/0/0#0';
  const roll = r.int(100);
  if (roll < 10) return { type: 'read-started' };
  if (roll < 20) {
    const which = r.int(10);
    if (which < 5) return { type: 'read-answered', state: readOf(r, run.doc) };
    if (which < 8) {
      run.doc = changedElsewhere(r, run.doc);
      return { type: 'read-answered', state: readOf(r, run.doc) };
    }
    run.doc = r.chance(0.5) ? { 'config-version': 8 } : documentOf(r);
    return { type: 'read-answered', state: readOf(r, run.doc) };
  }
  if (roll < 23) return { type: 'read-failed', message: `failed ${r.int(9)}` };
  if (roll < 40) return { type: 'alias-typed', rowId, text: r.pick(['x', 'z', 'new', '', ' w ']) };
  if (roll < 48) return { type: 'row-removed', rowId };
  if (roll < 62) {
    const kind = r.int(4);
    if (kind === 0) {
      const value = r.pick([true, false, null]);
      return { type: 'edited', change: (d) => changeRow(d, rowId, { forceMapping: value }) };
    }
    if (kind === 1 && row && row.store === 'api-key') {
      const { entryId, upstream } = row;
      const alias = r.pick(['w', 'x2']);
      return { type: 'edited', change: (d) => addKeyAlias(d, entryId, upstream, alias) };
    }
    // A login alias, on a loaded type or on one the draft adds (qwen is in no document).
    const channel = r.pick(['codex', 'claude', 'qwen']);
    const added = { upstream: r.pick(['a', 'b']), alias: `n${r.int(99)}` };
    return { type: 'edited', change: (d) => addLoginAlias(d, channel, added) };
  }
  if (roll < 65) return { type: 'entry-undone', entryId: row?.entryId ?? 'claude/0/0' };
  if (roll < 67) return { type: 'discarded' };
  if (roll < 78) return { type: 'save-started' };
  if (roll < 92) return { type: 'save-answered', outcome: outcomeFor(r, page.draft) };
  const keys = page.lost.map((notice) => notice.key);
  return { type: 'dismissed', key: keys.length && r.chance(0.8) ? r.pick(keys) : 999 };
}

/** What the model does with an event the board takes (`takesInput`). */
function modelEdit(model: Model, event: PageEvent): Model {
  const draft = model.draft!;
  switch (event.type) {
    case 'edited':
      return { ...model, draft: event.change(draft) };
    case 'alias-typed': {
      if (!draft.rows.some((row) => row.id === event.rowId)) return model;
      const next = changeRow(draft, event.rowId, { alias: event.text });
      if (next === draft) return model;
      return { draft: next, texts: { ...model.texts, [event.rowId]: event.text } };
    }
    case 'row-removed': {
      const next = removeRow(draft, event.rowId);
      if (next === draft) return model;
      const texts = { ...model.texts };
      delete texts[event.rowId];
      return { draft: next, texts };
    }
    case 'entry-undone':
      return {
        draft: discardEntry(draft, event.entryId),
        texts: Object.fromEntries(
          Object.entries(model.texts).filter(([id]) => !id.startsWith(`${event.entryId}#`))
        ),
      };
    case 'discarded':
      return { draft: discard(draft), texts: {} };
    default:
      return model;
  }
}

const EDITS = new Set(['edited', 'alias-typed', 'row-removed', 'entry-undone', 'discarded']);

// --- P-4 -------------------------------------------------------------------------------------------

describe('P-4 nothing is carried (pageStep, pure)', () => {
  test('300 sequences of page events over random documents, reads and outcomes', () => {
    const seen = {
      lostAfterSave: 0,
      lostOnEmptyRead: 0,
      editRefusedWhileReading: 0,
      editRefusedWhileSaving: 0,
      readDuringSave: 0,
      addedTypeLost: 0,
      changedValueListed: 0,
    };
    for (let seed = FIRST_SEED; seed < FIRST_SEED + CASES; seed += 1) {
      const r = rng(seed);
      const run: Run = { doc: documentOf(r) };
      const trail: string[] = [];
      // The page's first read.
      let page = pageStep(pageStep(INITIAL_PAGE, { type: 'read-started' }), {
        type: 'read-answered',
        state: readOf(r, run.doc),
      });
      let model: Model = { draft: startDraft(page.draft!.base), texts: {} };
      try {
        for (let i = 0; i < EVENTS; i += 1) {
          const event = eventOf(r, page, run);
          trail.push(event.type);
          const prev = page;
          const next = pageStep(prev, event);

          // canEdit is the design's definition.
          expect(canEdit(next)).toBe(takesInput(next));

          if (event.type === 'read-answered') {
            if (prev.saving) {
              // The answer is dropped: the running save's draft, which it lists from, stays.
              seen.readDuringSave += 1;
            } else {
              // A new draft of the read, and no text: nothing of an earlier draft is in it.
              model = { draft: startDraft(event.state), texts: {} };
              expect(next.draft).toEqual(startDraft(event.state));
              expect(next.texts).toEqual({});
              if (event.state.entries.length === 0 && prev.lost.length) seen.lostOnEmptyRead += 1;
            }
          } else if (EDITS.has(event.type)) {
            if (takesInput(prev)) model = modelEdit(model, event);
            else {
              // While a read or a save is pending, or on a read without a tag: nothing changes.
              expect(next).toEqual(prev);
              if (prev.reading && prev.draft) seen.editRefusedWhileReading += 1;
              if (prev.saving) seen.editRefusedWhileSaving += 1;
            }
          } else if (event.type === 'save-answered' && prev.saving) {
            const dropped = model.draft!;
            expect(next.draft).toBeNull();
            expect(next.texts).toEqual({});
            const added = next.lost.slice(prev.lost.length);
            const confirmed = new Set(event.outcome.confirmed);
            // Each entry the dropped draft changed is confirmed, or listed once, with what to type
            // again: every edit, its kind, and every value of the rows before and after.
            const expected = expectedEdits(dropped);
            for (const [entryId, edits] of expected) {
              if (confirmed.has(entryId)) continue;
              expect(event.outcome.unconfirmed).toContain(entryId);
              const items = added.filter((notice) => notice.entry.id === entryId);
              expect({ entryId, listed: items.length }).toEqual({ entryId, listed: 1 });
              expect({ entryId, edits: sorted(items[0].edits) }).toEqual({
                entryId,
                edits: sorted(edits),
              });
              expect(items[0].failure).toEqual(event.outcome.failure);
              // The entry as it was: the read's, or a login type the draft added.
              const read = dropped.base.entries.find((entry) => entry.id === entryId);
              if (read) expect(items[0].entry).toEqual(read);
              else {
                expect(items[0].entry).toMatchObject({
                  store: 'login',
                  id: entryId,
                  channel: entryId.slice('login/'.length),
                });
                seen.addedTypeLost += 1;
              }
              if (edits.some((edit) => edit.kind === 'changed')) seen.changedValueListed += 1;
            }
            // And nothing else: an entry listed is one the save did not confirm, with edits.
            for (const notice of added) {
              expect(confirmed.has(notice.entry.id)).toBe(false);
              expect(expected.has(notice.entry.id)).toBe(true);
            }
            if (added.length) seen.lostAfterSave += 1;
            model = { draft: null, texts: {} };
          }

          // The page holds the model's draft and texts, after every event.
          expect(next.draft).toEqual(model.draft);
          expect(next.texts).toEqual(model.texts);

          // `lost` only grows, except by `dismissed`; its keys are unique.
          if (event.type === 'dismissed') {
            expect(next.lost).toEqual(prev.lost.filter((notice) => notice.key !== event.key));
          } else {
            expect(next.lost.slice(0, prev.lost.length)).toEqual(prev.lost);
          }
          expect(new Set(next.lost.map((notice) => notice.key)).size).toBe(next.lost.length);
          page = next;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The check that failed, by its line here.
        const line = (error instanceof Error ? (error.stack ?? '') : '').match(
          /aliases-page-property\.test\.ts:(\d+)/
        )?.[1];
        throw new Error(
          `first failing seed ${seed}, check at line ${line ?? '?'}, after ${trail.join(' → ')}:\n${message}`,
          { cause: error }
        );
      }
    }
    // The cases the faults live in were reached.
    for (const [what, times] of Object.entries(seen)) {
      expect({ what, reached: times > 0 }).toEqual({ what, reached: true });
    }
  });
});

/**
 * The draft carried onto a fresh read (design aliases-page.md, 3.6). Entry ids, row ids and `sourceIndex`
 * are positions in one read of the file, so a row is never moved to another state by its id or its
 * position: an entry's edits move only through the entry's stored content, compared as `locate` and
 * `sameChannel` compare. An entry changed elsewhere takes the fresh rows, and its edits are returned as
 * lost, to be typed again; the page does not merge.
 */
import { draftEntries, isBlankNewRow, loginMapUnread, startDraft } from './draft';
import { entryChanged, rowChanged, sameConfig } from './plan';
import type { AliasDraft, AliasEntry, AliasRow, AliasState, KeyEntry, LoginEntry } from './types';

export interface LostEdit {
  kind: 'changed' | 'added' | 'removed';
  before: AliasRow | null;
  after: AliasRow | null;
}

export interface Rebased {
  draft: AliasDraft;
  /** Old entry id -> the same entry's id in the fresh state, for every entry carried. */
  carried: Record<string, string>;
  /** Entries with edits neither written nor carried: the old entry and its edits. */
  lost: { entry: AliasEntry; edits: LostEdit[] }[];
}

/**
 * 3.6, API key: a fresh entry of the same family and key position whose stored group equals the old one's:
 * the one at the old group index when that one does, otherwise the only one that does, otherwise none.
 */
function sameKeyEntry(old: KeyEntry, fresh: AliasState): KeyEntry | null {
  const alike = fresh.entries.filter(
    (entry): entry is KeyEntry =>
      entry.store === 'api-key' &&
      entry.family === old.family &&
      entry.keyIndex === old.keyIndex &&
      sameConfig(entry.storedGroup, old.storedGroup)
  );
  return (
    alike.find((entry) => entry.groupIndex === old.groupIndex) ??
    (alike.length === 1 ? alike[0] : null)
  );
}

/**
 * 3.6, login: the fresh entry of the same channel, readable (2.5), whose stored list equals the old one's. A channel without
 * an entry has an empty list, on either side.
 */
function sameLoginEntry(old: LoginEntry, fresh: AliasState): string | null {
  // 2.5: only a readable channel of a readable map.
  if (loginMapUnread(fresh)) return null;
  const found = fresh.entries.find(
    (entry): entry is LoginEntry => entry.store === 'login' && entry.channel === old.channel
  );
  if (found?.unread) return null;
  return sameConfig(found ? found.storedList : [], old.storedList) ? `login/${old.channel}` : null;
}

/** The edits of an entry: its draft rows against its base rows. A blank new row is not an edit. */
function editsOf(draft: AliasDraft, entryId: string): LostEdit[] {
  const rows = draft.rows.filter((row) => row.entryId === entryId && !isBlankNewRow(row));
  const base = draft.base.rows.filter((row) => row.entryId === entryId);
  const baseById = new Map(base.map((row) => [row.id, row]));
  const kept = new Set(rows.map((row) => row.id));
  const edits: LostEdit[] = [];
  for (const row of rows) {
    const before = baseById.get(row.id);
    if (!before) edits.push({ kind: 'added', before: null, after: row });
    else if (rowChanged(row, before)) edits.push({ kind: 'changed', before, after: row });
  }
  for (const row of base) {
    if (!kept.has(row.id)) edits.push({ kind: 'removed', before: row, after: null });
  }
  return edits;
}

const withEntryId = (row: AliasRow, entryId: string): AliasRow =>
  row.entryId === entryId
    ? row
    : { ...row, entryId, id: `${entryId}#${row.id.slice(row.id.indexOf('#') + 1)}` };

/**
 * After a commit (or to undo an entry): the fresh `state` under the draft. An entry with edits that is not
 * in `written` is carried when the fresh state holds the same entry (equal stored content), and is lost
 * otherwise; every other entry takes the fresh rows. Undoing one entry is `rebase(draft, draft.base,
 * [entryId])`.
 */
export function rebase(draft: AliasDraft, state: AliasState, written: string[]): Rebased {
  const done = new Set(written);
  const pending = draftEntries(draft).filter(
    (entry) => !done.has(entry.id) && entryChanged(draft, entry.id)
  );
  const target = new Map<string, string | null>();
  const claims = new Map<string, number>();
  for (const entry of pending) {
    const id =
      entry.store === 'api-key'
        ? (sameKeyEntry(entry, state)?.id ?? null)
        : sameLoginEntry(entry, state);
    target.set(entry.id, id);
    if (id) claims.set(id, (claims.get(id) ?? 0) + 1);
  }

  const carried: Record<string, string> = {};
  const lost: Rebased['lost'] = [];
  const carriedRows = new Map<string, AliasRow[]>();
  for (const entry of pending) {
    const id = target.get(entry.id) ?? null;
    // Two old entries alike onto one fresh entry: neither is the only one alike.
    if (id && claims.get(id) === 1) {
      carried[entry.id] = id;
      carriedRows.set(
        id,
        draft.rows.filter((row) => row.entryId === entry.id).map((row) => withEntryId(row, id))
      );
    } else {
      lost.push({ entry, edits: editsOf(draft, entry.id) });
    }
  }

  const fresh = startDraft(state);
  const rows: AliasRow[] = [];
  const placed = new Set<string>();
  for (const entry of state.entries) {
    const kept = carriedRows.get(entry.id);
    rows.push(...(kept ?? fresh.rows.filter((row) => row.entryId === entry.id)));
    if (kept) placed.add(entry.id);
  }
  // Carried entries the fresh state has no entry for (a channel the draft added), in draft order.
  for (const [id, kept] of carriedRows) if (!placed.has(id)) rows.push(...kept);

  return { draft: { base: state, rows, nextNew: draft.nextNew }, carried, lost };
}

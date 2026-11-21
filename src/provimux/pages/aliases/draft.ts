/**
 * The page's one draft over a loaded state (design aliases-page.md, section 3). Every operation is pure,
 * `(draft, …) => draft`; nothing is requested until the commit (aliasesApi.ts). An operation that is not
 * allowed returns the draft it was given, unchanged.
 */
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import { loginMapWritable } from './rows';
import type {
  AliasDraft,
  AliasEntry,
  AliasRow,
  AliasRowPatch,
  AliasState,
  KeyEntry,
  NewLoginAlias,
  RowIssue,
} from './types';

export function startDraft(state: AliasState): AliasDraft {
  return { base: state, rows: state.rows.map((row) => ({ ...row })), nextNew: 0 };
}

/** The entry of an id: the loaded one, or a login channel the draft added. */
export function entryOf(draft: AliasDraft, entryId: string): AliasEntry | null {
  const found = draft.base.entries.find((entry) => entry.id === entryId);
  if (found) return found;
  const channel = entryId.startsWith('login/') ? entryId.slice('login/'.length) : '';
  if (!channel || !draft.rows.some((row) => row.entryId === entryId)) return null;
  return {
    store: 'login',
    id: entryId,
    channel,
    spellings: [],
    loginCount: null,
    service: `login:${channel}`,
    storedList: [],
    unread: false,
  };
}

/**
 * Whether the state's login alias map cannot be written whole (2.5): not a map, or holding a number the
 * browser cannot hold. Then no channel takes an edit and the map is never written.
 */
export const loginMapUnread = (state: Pick<AliasState, 'document'>): boolean =>
  !loginMapWritable(state.document);

/** 2.5: whether a row belongs to something the page cannot write whole: it then takes no edit. */
const rowLocked = (draft: AliasDraft, row: AliasRow): boolean => {
  if (row.store !== 'login') return false;
  if (loginMapUnread(draft.base)) return true;
  const entry = entryOf(draft, row.entryId);
  return entry?.store === 'login' && entry.unread;
};

/**
 * The loaded entries, then the login channels the draft added (they have rows of the draft only).
 * The page lists these.
 */
export function draftEntries(draft: AliasDraft): AliasEntry[] {
  const known = new Set(draft.base.entries.map((entry) => entry.id));
  const added: AliasEntry[] = [];
  for (const row of draft.rows) {
    if (known.has(row.entryId)) continue;
    known.add(row.entryId);
    const entry = entryOf(draft, row.entryId);
    if (entry) added.push(entry);
  }
  return [...draft.base.entries, ...added];
}

/** As `nameKey` (collisions.ts), which imports this module. */
const nameKey = (name: string): string => name.trim().toLowerCase();

/** 3.1: an empty alias, or one equal to the row's upstream name, is no alias. */
const aliasOf = (alias: string | null | undefined, upstream: string): string | null => {
  const text = alias ?? '';
  return text.trim() === '' || text.trim() === upstream.trim() ? null : text;
};

/** A new row of the draft with neither name nor alias: not a row yet, no issue, not written. */
export const isBlankNewRow = (row: AliasRow): boolean =>
  row.sourceIndex === null && row.upstream.trim() === '' && (row.alias ?? '').trim() === '';

/**
 * 3.1. API-key rows: `alias` and `forceMapping`; the upstream name of a new API-key row may change to
 * another model the entry lists. Login rows: every field.
 */
export function changeRow(draft: AliasDraft, rowId: string, patch: AliasRowPatch): AliasDraft {
  const index = draft.rows.findIndex((row) => row.id === rowId);
  if (index < 0) return draft;
  const row = draft.rows[index];
  if (rowLocked(draft, row)) return draft;
  const next: AliasRow = { ...row };
  if (patch.forceMapping !== undefined) next.forceMapping = patch.forceMapping;
  if (row.store === 'login') {
    if (patch.upstream !== undefined) next.upstream = patch.upstream;
    if (patch.fork !== undefined) next.fork = patch.fork;
    if (patch.displayName !== undefined) next.displayName = patch.displayName;
  } else if (patch.upstream !== undefined && row.sourceIndex === null) {
    const listed = draft.rows.some(
      (other) =>
        other.entryId === row.entryId &&
        other.id !== row.id &&
        other.upstream.trim() === patch.upstream!.trim()
    );
    if (listed) next.upstream = patch.upstream.trim();
  }
  if (patch.alias !== undefined) next.alias = aliasOf(patch.alias, next.upstream);
  const rows = [...draft.rows];
  rows[index] = next;
  return { ...draft, rows };
}

const insertAfterLast = (rows: AliasRow[], row: AliasRow, isAnchor: (r: AliasRow) => boolean) => {
  let at = -1;
  rows.forEach((r, i) => {
    if (isAnchor(r)) at = i;
  });
  const next = [...rows];
  if (at < 0) next.push(row);
  else next.splice(at + 1, 0, row);
  return next;
};

/**
 * 3.2: a second client name for a model an API-key entry already lists, placed after the entry's last
 * row of that model. It copies no options. Refused for an entry without rows (`listSource: 'none'`)
 * and for an upstream name the entry does not list.
 */
export function addKeyAlias(
  draft: AliasDraft,
  entryId: string,
  upstream: string,
  alias: string
): AliasDraft {
  const entry = entryOf(draft, entryId);
  if (!entry || entry.store !== 'api-key' || (entry as KeyEntry).listSource === 'none') {
    return draft;
  }
  const model = upstream.trim();
  const sameModel = (row: AliasRow) => row.entryId === entryId && row.upstream.trim() === model;
  if (!model || !draft.rows.some(sameModel)) return draft;
  const row: AliasRow = {
    id: `${entryId}#new-${draft.nextNew}`,
    entryId,
    store: 'api-key',
    sourceIndex: null,
    upstream: model,
    alias: aliasOf(alias, model),
    fork: null,
    forceMapping: null,
    displayName: null,
  };
  return {
    ...draft,
    rows: insertAfterLast(draft.rows, row, sameModel),
    nextNew: draft.nextNew + 1,
  };
}

/**
 * 3.3: a login alias for a channel, loaded or new. `fork` defaults to true. Refused for a channel the page
 * cannot read, and for every channel when the alias map cannot be read (2.5).
 */
export function addLoginAlias(
  draft: AliasDraft,
  channel: string,
  alias: NewLoginAlias
): AliasDraft {
  const key = normalizeOAuthProviderKey(channel);
  if (!key || loginMapUnread(draft.base)) return draft;
  const entryId = `login/${key}`;
  const existing = entryOf(draft, entryId);
  // 2.5: nothing can be added to a channel the page cannot read.
  if (existing?.store === 'login' && existing.unread) return draft;
  const row: AliasRow = {
    id: `${entryId}#new-${draft.nextNew}`,
    entryId,
    store: 'login',
    sourceIndex: null,
    upstream: alias.upstream,
    alias: aliasOf(alias.alias, alias.upstream),
    fork: alias.fork ?? true,
    forceMapping: alias.forceMapping ?? null,
    displayName: alias.displayName ?? null,
  };
  return {
    ...draft,
    rows: insertAfterLast(draft.rows, row, (r) => r.entryId === entryId),
    nextNew: draft.nextNew + 1,
  };
}

/**
 * 3.2, 3.3. A login row is deleted. An API-key row is deleted when another row of the entry has the
 * same upstream name; otherwise it stays and loses its alias: the page never removes a model.
 */
export function removeRow(draft: AliasDraft, rowId: string): AliasDraft {
  const row = draft.rows.find((r) => r.id === rowId);
  if (!row || rowLocked(draft, row)) return draft;
  if (row.store === 'api-key') {
    const another = draft.rows.some(
      (r) =>
        r.id !== row.id && r.entryId === row.entryId && r.upstream.trim() === row.upstream.trim()
    );
    if (!another) {
      return {
        ...draft,
        rows: draft.rows.map((r) => (r.id === rowId ? { ...r, alias: null } : r)),
      };
    }
  }
  return { ...draft, rows: draft.rows.filter((r) => r.id !== rowId) };
}

/** Every edit dropped. New-row numbers go on, so ids stay unique within the page's life. */
export function discard(draft: AliasDraft): AliasDraft {
  return { ...startDraft(draft.base), nextNew: draft.nextNew };
}

/**
 * "Undo this entry" (3.6): the entry's rows are its base rows again, where its rows were; every other
 * entry as it is. The same base, so nothing moves to another read.
 */
export function discardEntry(draft: AliasDraft, entryId: string): AliasDraft {
  const baseRows = draft.base.rows.filter((row) => row.entryId === entryId).map((r) => ({ ...r }));
  const order = new Map(draft.base.entries.map((entry, index) => [entry.id, index]));
  const at = order.get(entryId) ?? Number.POSITIVE_INFINITY;
  const rows: AliasRow[] = [];
  let placed = false;
  for (const row of draft.rows) {
    if (!placed && (row.entryId === entryId || (order.get(row.entryId) ?? Infinity) > at)) {
      rows.push(...baseRows);
      placed = true;
    }
    if (row.entryId !== entryId) rows.push(row);
  }
  if (!placed) rows.push(...baseRows);
  return { ...draft, rows };
}

const text = (value: string | null): string => (value ?? '').trim();

/** Whether a draft row says something else than its base row (compared as they would be written). */
export function rowChanged(row: AliasRow, base: AliasRow | undefined): boolean {
  if (!base) return true;
  return (
    row.upstream.trim() !== base.upstream.trim() ||
    text(row.alias) !== text(base.alias) ||
    row.forceMapping !== base.forceMapping ||
    (row.store === 'login' &&
      (row.fork !== base.fork || text(row.displayName) !== text(base.displayName)))
  );
}

/** One edit of the draft, as the base row and the draft row (`changed`: both; `added`: the draft row;
 *  `removed`: the base row). */
export interface LostEdit {
  kind: 'changed' | 'added' | 'removed';
  before: AliasRow | null;
  after: AliasRow | null;
}

/** The edits of one entry: its draft rows against its base rows. A blank new row is not an edit. */
export function editsOf(draft: AliasDraft, entryId: string): LostEdit[] {
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

/** 3.5, by row id. The login rules are the old editor's (`getAliasRowIssues`), the proxy's drop rules. */
export function rowIssues(draft: AliasDraft): Record<string, RowIssue> {
  const issues: Record<string, RowIssue> = {};
  const seenByEntry = new Map<string, Set<string>>();
  for (const row of draft.rows) {
    if (isBlankNewRow(row)) continue;
    const seen = seenByEntry.get(row.entryId) ?? new Set<string>();
    seenByEntry.set(row.entryId, seen);
    if (row.store === 'login') {
      const name = nameKey(row.upstream);
      const alias = nameKey(row.alias ?? '');
      if (!name || !alias) issues[row.id] = 'incomplete';
      else if (name === alias) issues[row.id] = 'same-as-name';
      else if (seen.has(alias)) issues[row.id] = 'duplicate';
      else seen.add(alias);
      continue;
    }
    const entry = entryOf(draft, row.entryId);
    if (!entry || entry.store !== 'api-key' || entry.family === 'openai-compatibility') continue;
    const name = nameKey(row.alias ?? row.upstream);
    if (seen.has(name)) issues[row.id] = 'shadowed';
    else seen.add(name);
  }
  return issues;
}

export const BLOCKING_ISSUES: readonly RowIssue[] = ['incomplete', 'same-as-name', 'duplicate'];

export const isBlocking = (issue: RowIssue | undefined): boolean =>
  issue !== undefined && BLOCKING_ISSUES.includes(issue);

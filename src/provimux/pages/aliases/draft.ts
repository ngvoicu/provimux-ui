/**
 * The page's one draft over a loaded state (design aliases-page.md, section 3). Every operation is pure,
 * `(draft, …) => draft`; nothing is requested until the commit (aliasesApi.ts). An operation that is not
 * allowed returns the draft it was given, unchanged.
 */
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
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
  };
}

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

/** 3.3: a login alias for a channel, loaded or new. `fork` defaults to true. */
export function addLoginAlias(
  draft: AliasDraft,
  channel: string,
  alias: NewLoginAlias
): AliasDraft {
  const key = normalizeOAuthProviderKey(channel);
  if (!key) return draft;
  const entryId = `login/${key}`;
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
  if (!row) return draft;
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

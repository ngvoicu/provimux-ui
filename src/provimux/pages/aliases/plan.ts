/**
 * From the draft to the requests (design aliases-page.md, 2.4, 3.2, 3.3, 3.4). Pure. Every body is built
 * from the page's own read, `draft.base.document`: each entry is written at its own position in that
 * read, and nothing is looked up or compared by content (the proxy's `If-Match` check says whether the
 * file still is that read). The writers work on the stored objects as read: a row that did not change is
 * written exactly as it was read; in a changed row only the fields the user changed are touched (2.4).
 */
import { isRecord } from '@/utils/helpers';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import {
  draftEntries,
  entryOf,
  isBlankNewRow,
  isBlocking,
  loginMapUnread,
  rowChanged,
  rowIssues,
} from './draft';
import { ALIAS_FAMILIES, effectiveModels, familyGroups, isModelRow, loginMapIn } from './rows';
import type {
  AliasDraft,
  AliasEntry,
  AliasRow,
  CommitUnit,
  KeyEntry,
  LoginEntry,
  PlannedWrite,
} from './types';

export { rowChanged } from './draft';

export const ALIAS_PATHS = {
  config: '/config',
  credentials: '/credentials',
  loginAliases: '/config/oauth/model-alias',
  family: (family: string) => `/config/api-keys/${family}`,
} as const;

const text = (value: string | null): string => (value ?? '').trim();

/** The draft rows of an entry that are rows (a blank new row is not one yet). */
const draftRowsOf = (draft: AliasDraft, entryId: string) =>
  draft.rows.filter((row) => row.entryId === entryId && !isBlankNewRow(row));
const baseRowsOf = (draft: AliasDraft, entryId: string) =>
  draft.base.rows.filter((row) => row.entryId === entryId);

/** Whether an entry's draft rows differ from its base rows. */
export function entryChanged(draft: AliasDraft, entryId: string): boolean {
  const rows = draftRowsOf(draft, entryId);
  const base = baseRowsOf(draft, entryId);
  if (rows.length !== base.length) return true;
  return rows.some((row, i) => row.id !== base[i].id || rowChanged(row, base[i]));
}

/** The changed entries with a row that has a blocking issue (3.5): while any, nothing is committed. */
export function blockedEntries(draft: AliasDraft): string[] {
  const issues = rowIssues(draft);
  const blocked = new Set<string>();
  for (const row of draft.rows) {
    if (isBlocking(issues[row.id]) && entryChanged(draft, row.entryId)) blocked.add(row.entryId);
  }
  return [...blocked];
}

/** 2.5: an entry the page cannot write whole. The operations give it no edit; never planned. */
const unwritable = (draft: AliasDraft, entry: AliasEntry) =>
  entry.store === 'login' && (entry.unread || loginMapUnread(draft.base));

/**
 * 3.4: one unit per family with a changed entry, in the family order of 1.2, then one unit for the
 * logins when a channel changed.
 */
export function planCommit(draft: AliasDraft): CommitUnit[] {
  const changed = draftEntries(draft).filter(
    (entry) => entryChanged(draft, entry.id) && !unwritable(draft, entry)
  );
  const units: CommitUnit[] = [];
  for (const family of ALIAS_FAMILIES) {
    const entryIds = changed
      .filter((entry) => entry.store === 'api-key' && entry.family === family)
      .map((entry) => entry.id);
    if (entryIds.length) units.push({ store: 'api-key', family, entryIds });
  }
  const logins = changed.filter((entry) => entry.store === 'login').map((entry) => entry.id);
  if (logins.length) units.push({ store: 'login', entryIds: logins });
  return units;
}

/**
 * 2.4: `force-mapping` changed by the user: true is set; false is written when the row stored a value,
 * else the key is removed; null removes it.
 */
function setForceMapping(next: Record<string, unknown>, value: boolean | null) {
  if (value === true) next['force-mapping'] = true;
  else if (value === false && typeof next['force-mapping'] === 'boolean') {
    next['force-mapping'] = false;
  } else delete next['force-mapping'];
}

type RowWriter = (
  row: AliasRow,
  base: AliasRow | null,
  stored: Record<string, unknown> | null
) => Record<string, unknown>;

/**
 * 2.4, store A. A new row is `{ name, alias }` (and `force-mapping: true` when set). A changed row is its
 * stored object with only the fields that differ from its base row touched: `alias` set (trimmed) or
 * removed when the row now has no alias; `force-mapping` as `setForceMapping`.
 */
export const writeKeyRow: RowWriter = (row, base, stored) => {
  const upstream = row.upstream.trim();
  const alias = text(row.alias);
  if (!stored || !base) {
    const next: Record<string, unknown> = { name: upstream };
    if (alias && alias !== upstream) next.alias = alias;
    if (row.forceMapping === true) next['force-mapping'] = true;
    return next;
  }
  const next: Record<string, unknown> = { ...stored };
  if (alias !== text(base.alias)) {
    if (alias && alias !== upstream) next.alias = alias;
    else delete next.alias;
  }
  if (row.forceMapping !== base.forceMapping) setForceMapping(next, row.forceMapping);
  return next;
};

/**
 * 2.4, store B. A new row is `{ name, alias }` with the optional keys that are set. A changed row is its
 * stored object with only the fields that differ from its base row touched: `name`, `alias` (trimmed);
 * `fork: true` set, turned off removed; `force-mapping` as `setForceMapping`; `display-name` set
 * (trimmed) or removed when empty.
 */
export const writeLoginRow: RowWriter = (row, base, stored) => {
  const upstream = row.upstream.trim();
  const alias = text(row.alias);
  const displayName = text(row.displayName);
  if (!stored || !base) {
    const next: Record<string, unknown> = { name: upstream, alias };
    if (row.fork === true) next.fork = true;
    if (row.forceMapping === true) next['force-mapping'] = true;
    if (displayName) next['display-name'] = displayName;
    return next;
  }
  const next: Record<string, unknown> = { ...stored };
  if (upstream !== base.upstream.trim()) next.name = upstream;
  if (alias !== text(base.alias)) next.alias = alias;
  if (row.fork !== base.fork) {
    if (row.fork === true) next.fork = true;
    else delete next.fork;
  }
  if (row.forceMapping !== base.forceMapping) setForceMapping(next, row.forceMapping);
  if (displayName !== text(base.displayName)) {
    if (displayName) next['display-name'] = displayName;
    else delete next['display-name'];
  }
  return next;
};

/**
 * A stored list rewritten from the draft rows (2.4): elements that are not rows stay where they were; a
 * stored row the draft no longer has is taken out; an unchanged row is written as read; a changed row is
 * written over its own stored object, found by its position (`sourceIndex`); new rows follow the draft
 * row before them (or open the list when none is stored before them).
 */
function rewriteList(
  list: readonly unknown[],
  rows: readonly AliasRow[],
  base: readonly AliasRow[],
  isRow: (value: unknown) => boolean,
  write: RowWriter
): unknown[] {
  const baseById = new Map(base.map((row) => [row.id, row]));
  const bySource = new Map<number, AliasRow>();
  const after = new Map<number | 'start', AliasRow[]>();
  let anchor: number | 'start' = 'start';
  for (const row of rows) {
    if (row.sourceIndex !== null) {
      bySource.set(row.sourceIndex, row);
      anchor = row.sourceIndex;
    } else {
      after.set(anchor, [...(after.get(anchor) ?? []), row]);
    }
  }
  const out: unknown[] = (after.get('start') ?? []).map((row) => write(row, null, null));
  list.forEach((element, index) => {
    if (!isRow(element)) {
      out.push(element);
      return;
    }
    const row = bySource.get(index);
    if (row) {
      const stored = element as Record<string, unknown>;
      const before = baseById.get(row.id) ?? null;
      out.push(before && !rowChanged(row, before) ? stored : write(row, before, stored));
    }
    for (const added of after.get(index) ?? []) out.push(write(added, null, null));
  });
  return out;
}

/**
 * 3.2: the group with the entry's list rewritten from the draft rows. Stored on the key
 * (`keys[keyIndex].models`), on the group for OpenAI-compatible: a key that inherited its group's list
 * thereby gets its own, and the group's list stays for its other keys.
 */
export function withModels(
  group: Readonly<Record<string, unknown>>,
  entry: KeyEntry,
  rows: readonly AliasRow[],
  base: readonly AliasRow[]
): Record<string, unknown> {
  const { list } = effectiveModels(group, entry.keyIndex);
  const models = rewriteList(list, rows, base, isModelRow, writeKeyRow);
  if (entry.keyIndex === null) return { ...group, models };
  const keys = [...(group.keys as unknown[])];
  keys[entry.keyIndex] = { ...(keys[entry.keyIndex] as Record<string, unknown>), models };
  return { ...group, keys };
}

/** The draft rows and base rows of an entry, as `withModels` and `writtenRowsOf` take them. */
export function rowsForWrite(draft: AliasDraft, entryId: string) {
  return { rows: draftRowsOf(draft, entryId), base: baseRowsOf(draft, entryId) };
}

/** 3.3: the list written for a login channel. */
export function writtenRowsOf(
  entry: LoginEntry,
  rows: readonly AliasRow[],
  base: readonly AliasRow[]
): unknown[] {
  return rewriteList(entry.storedList, rows, base, isRecord, writeLoginRow);
}

/**
 * 3.3: every spelling of the channel removed and, when the written list is not empty, the list set under
 * the normalized key (the old editor's rule, `updateOauthProviderMap`, except that an element the page
 * cannot read counts and stays: `[null]` is kept). Every other key untouched.
 */
export function replaceChannel(
  map: Record<string, unknown>,
  entry: LoginEntry,
  list: readonly unknown[]
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    if (normalizeOAuthProviderKey(key) !== entry.channel) next[key] = value;
  }
  if (list.length) next[entry.channel] = [...list];
  return next;
}

/** The entry of a unit's id; throws when the draft has none (a programming error). */
export function unitEntry(draft: AliasDraft, entryId: string) {
  const entry = entryOf(draft, entryId);
  if (!entry) throw new Error(`Unknown alias entry ${entryId}`);
  return entry;
}

/**
 * 3.4: each unit with its request, built from the page's own read alone (3.2, 3.3). Each entry is written
 * at its own position in that read: two entries are two positions, never one key.
 */
export function planWrites(draft: AliasDraft): PlannedWrite[] {
  const document = draft.base.document;
  return planCommit(draft).map((unit): PlannedWrite => {
    if (unit.store === 'api-key') {
      const groups = [...familyGroups(document, unit.family)];
      for (const entryId of unit.entryIds) {
        const entry = unitEntry(draft, entryId) as KeyEntry;
        const { rows, base } = rowsForWrite(draft, entryId);
        groups[entry.groupIndex] = withModels(
          groups[entry.groupIndex] as Record<string, unknown>,
          entry,
          rows,
          base
        );
      }
      return { unit, path: ALIAS_PATHS.family(unit.family), body: groups };
    }
    const stored = loginMapIn(document);
    // planCommit plans no login unit unless the map is a map (2.5).
    let map: Record<string, unknown> = isRecord(stored) ? { ...stored } : {};
    for (const entryId of unit.entryIds) {
      const entry = unitEntry(draft, entryId) as LoginEntry;
      const { rows, base } = rowsForWrite(draft, entryId);
      map = replaceChannel(map, entry, writtenRowsOf(entry, rows, base));
    }
    return { unit, path: ALIAS_PATHS.loginAliases, body: map };
  });
}

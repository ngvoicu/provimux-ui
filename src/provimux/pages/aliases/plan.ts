/**
 * From the draft to the requests (design aliases-page.md, 2.4, 3.2, 3.3, 3.4). Pure. The writers work on
 * the stored objects as read: a row that did not change is written exactly as it was read; a changed row
 * is its stored object with only the keys of 2.4 touched; a new row is `{ name, alias }`.
 */
import { isRecord } from '@/utils/helpers';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import { draftEntries, entryOf, isBlankNewRow, isBlocking, rowIssues } from './draft';
import { ALIAS_FAMILIES, effectiveModels, isModelRow } from './rows';
import type { AliasDraft, AliasRow, CommitUnit, KeyEntry, LoginEntry } from './types';

/** Structural equality of JSON values; object keys in any order. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, i) => deepEqual(value, b[i]))
    );
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]))
    );
  }
  return false;
}

/** Fields the proxy injects at read time; never configuration, so never a conflict. */
const INJECTED = new Set(['auth_index', 'auth-index']);

/** A JSON value without the injected fields, at any depth. */
export function withoutInjected(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutInjected);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !INJECTED.has(key))
      .map(([key, v]) => [key, withoutInjected(v)])
  );
}

/** Equal as configuration: `deepEqual` with the injected fields stripped from both sides. */
export const sameConfig = (a: unknown, b: unknown): boolean =>
  deepEqual(withoutInjected(a), withoutInjected(b));

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

/**
 * 3.4: one unit per family with a changed entry, in the family order of 1.2, then one unit for the
 * logins when a channel changed.
 */
export function planCommit(draft: AliasDraft): CommitUnit[] {
  const changed = draftEntries(draft).filter((entry) => entryChanged(draft, entry.id));
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
 * 3.2: the index of the entry's group in a fresh read: `groupIndex` when the group there deep-equals
 * the stored group, otherwise the single index whose group does, otherwise -1 (a conflict). Compared
 * without the auth indexes the proxy injects at read time.
 */
export function locate(groups: readonly unknown[], entry: KeyEntry): number {
  if (sameConfig(groups[entry.groupIndex], entry.storedGroup)) return entry.groupIndex;
  const matches = groups.flatMap((group, index) =>
    sameConfig(group, entry.storedGroup) ? [index] : []
  );
  return matches.length === 1 ? matches[0] : -1;
}

/** 2.4: `force-mapping` true is set; false is written when the row stored a value; else removed. */
function setForceMapping(next: Record<string, unknown>, value: boolean | null, stored: boolean) {
  if (value === true) next['force-mapping'] = true;
  else if (value === false && stored) next['force-mapping'] = false;
  else delete next['force-mapping'];
}

/** 2.4, store A: a changed row is its stored object with `alias` and `force-mapping` touched. */
function writeKeyRow(
  row: AliasRow,
  stored: Record<string, unknown> | null
): Record<string, unknown> {
  const next: Record<string, unknown> = stored ? { ...stored } : { name: row.upstream.trim() };
  const alias = text(row.alias);
  if (alias && alias !== row.upstream.trim()) next.alias = alias;
  else delete next.alias;
  setForceMapping(
    next,
    row.forceMapping,
    stored !== null && typeof stored['force-mapping'] === 'boolean'
  );
  return next;
}

/** 2.4, store B: also `name`, `fork` and `display-name`. */
function writeLoginRow(
  row: AliasRow,
  stored: Record<string, unknown> | null
): Record<string, unknown> {
  const next: Record<string, unknown> = stored ? { ...stored } : {};
  next.name = row.upstream.trim();
  next.alias = text(row.alias);
  if (row.fork === true) next.fork = true;
  else delete next.fork;
  setForceMapping(
    next,
    row.forceMapping,
    stored !== null && typeof stored['force-mapping'] === 'boolean'
  );
  const displayName = text(row.displayName);
  if (displayName) next['display-name'] = displayName;
  else delete next['display-name'];
  return next;
}

/**
 * A stored list rewritten from the draft rows: elements that are not rows stay where they were; a
 * stored row the draft no longer has is taken out; an unchanged row is written as read; new rows follow
 * the draft row before them (or open the list when none is stored before them).
 */
function rewriteList(
  list: readonly unknown[],
  rows: readonly AliasRow[],
  base: readonly AliasRow[],
  isRow: (value: unknown) => boolean,
  write: (row: AliasRow, stored: Record<string, unknown> | null) => Record<string, unknown>
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
  const out: unknown[] = (after.get('start') ?? []).map((row) => write(row, null));
  list.forEach((element, index) => {
    if (!isRow(element)) {
      out.push(element);
      return;
    }
    const row = bySource.get(index);
    if (row) {
      const stored = element as Record<string, unknown>;
      out.push(rowChanged(row, baseById.get(row.id)) ? write(row, stored) : stored);
    }
    for (const added of after.get(index) ?? []) out.push(write(added, null));
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

/** The stored keys of a map that spell a channel, in file order. */
const spellingsOf = (map: Record<string, unknown>, channel: string) =>
  Object.keys(map).filter((key) => normalizeOAuthProviderKey(key) === channel);

/**
 * 3.3: the fresh lists of the channel's spellings, concatenated, deep-equal the stored list (without
 * injected auth indexes).
 */
export function sameChannel(map: Record<string, unknown>, entry: LoginEntry): boolean {
  const fresh = spellingsOf(map, entry.channel).flatMap((key) =>
    Array.isArray(map[key]) ? (map[key] as unknown[]) : []
  );
  return sameConfig(fresh, entry.storedList);
}

/**
 * 3.3: every spelling of the channel removed and, when rows remain, the list set under the normalized
 * key (the old editor's rule, `updateOauthProviderMap`). Every other key untouched.
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
  if (list.some(isRecord)) next[entry.channel] = [...list];
  return next;
}

/** The entry of a unit's id; throws when the draft has none (a programming error, not a conflict). */
export function unitEntry(draft: AliasDraft, entryId: string) {
  const entry = entryOf(draft, entryId);
  if (!entry) throw new Error(`Unknown alias entry ${entryId}`);
  return entry;
}

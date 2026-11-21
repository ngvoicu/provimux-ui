/**
 * The Aliases page's own logic (step U1): its filter, what it marks as changed, how it names a service.
 * Pure, over the data layer's draft; the data layer itself is not changed here.
 */
import type { ProviderFamily } from '@/services/api/providers';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import { draftEntries, isBlankNewRow, isBlocking } from './draft';
import { ALIAS_FAMILIES } from './rows';
import type { AliasDraft, AliasEntry, AliasRow, KeyEntry, NameGroup, RowIssue } from './types';

export type StoreFilter = 'all' | 'api-key' | 'login';
export type RowView = 'all' | 'aliased' | 'attention';

export interface AliasFilter {
  query: string;
  store: StoreFilter;
  /** 'all', `family:<family>` or `login:<channel>`. */
  provider: string;
  view: RowView;
  /** Only the rows of one client name (a `nameKey`), from the name check. */
  name: string | null;
}

export const EMPTY_FILTER: AliasFilter = {
  query: '',
  store: 'all',
  provider: 'all',
  view: 'all',
  name: null,
};

const isFamily = (value: string): value is ProviderFamily =>
  (ALIAS_FAMILIES as readonly string[]).includes(value);

/**
 * The filter the page opens with: `?store=login|api-key`, `?channel=<login type>` (the old login alias
 * address's `provider`), `?family=<API-key family>` (the provider form's link).
 */
export function initialFilter(params: URLSearchParams): AliasFilter {
  const filter: AliasFilter = { ...EMPTY_FILTER };
  const store = params.get('store');
  if (store === 'login' || store === 'api-key') filter.store = store;
  const family = params.get('family')?.trim() ?? '';
  const channel = normalizeOAuthProviderKey(params.get('channel') ?? '');
  if (channel) {
    filter.store = 'login';
    filter.provider = `login:${channel}`;
  } else if (isFamily(family)) {
    filter.store = 'api-key';
    filter.provider = `family:${family}`;
  }
  return filter;
}

export const providerKeyOf = (entry: AliasEntry): string =>
  entry.store === 'login' ? `login:${entry.channel}` : `family:${entry.family}`;

/** `openai-compatibility` is `openaiCompatibility` among the console's provider brands. */
export const brandOfFamily = (family: ProviderFamily): string =>
  family === 'openai-compatibility' ? 'openaiCompatibility' : family;

const fieldsDiffer = (row: AliasRow, base: AliasRow): boolean =>
  row.upstream.trim() !== base.upstream.trim() ||
  (row.alias ?? '').trim() !== (base.alias ?? '').trim() ||
  row.forceMapping !== base.forceMapping ||
  (row.store === 'login' &&
    (row.fork !== base.fork || (row.displayName ?? '').trim() !== (base.displayName ?? '').trim()));

export type RowMark = 'new' | 'changed' | null;

/** Per draft row: new (and not blank), changed from its base row, or neither. */
export function rowMarks(draft: AliasDraft): Record<string, RowMark> {
  const base = new Map(draft.base.rows.map((row) => [row.id, row]));
  const marks: Record<string, RowMark> = {};
  for (const row of draft.rows) {
    const before = base.get(row.id);
    marks[row.id] = before
      ? fieldsDiffer(row, before)
        ? 'changed'
        : null
      : isBlankNewRow(row)
        ? null
        : 'new';
  }
  return marks;
}

/** Base rows the draft no longer has, per entry id. */
export function removedCounts(draft: AliasDraft): Record<string, number> {
  const kept = new Set(draft.rows.map((row) => row.id));
  const counts: Record<string, number> = {};
  for (const row of draft.base.rows) {
    if (!kept.has(row.id)) counts[row.entryId] = (counts[row.entryId] ?? 0) + 1;
  }
  return counts;
}

/** What the save bar counts: rows new or changed, and rows removed. */
export function changeCount(draft: AliasDraft): number {
  const marks = Object.values(rowMarks(draft)).filter(Boolean).length;
  const removed = Object.values(removedCounts(draft)).reduce((sum, n) => sum + n, 0);
  return marks + removed;
}

/** Rows that answer under an alias (not their own name). */
export const aliasCount = (rows: readonly AliasRow[]): number =>
  rows.filter((row) => row.alias !== null && row.alias.trim() !== '').length;

/** Verdicts the page asks the user to look at. A pool the user configured is not one. */
export const isClash = (group: NameGroup): boolean =>
  group.verdict === 'several-services' || (group.verdict === 'several-models' && !group.pool);

/** Whether a row needs a look: an issue, a clash of its name, or a failed save of its entry. */
export function needsLook(
  issue: RowIssue | undefined,
  group: NameGroup | undefined,
  failed: boolean
): boolean {
  return issue !== undefined || (group !== undefined && isClash(group)) || failed;
}

const lower = (value: string | null | undefined) => (value ?? '').toLowerCase();

/** What the search matches on besides the rows: provider, group, key preview, host, channel. */
export function entryHaystack(entry: AliasEntry, providerLabel: string): string {
  if (entry.store === 'login') return lower(`${providerLabel} ${entry.channel}`);
  return lower(
    [providerLabel, entry.family, entry.groupName, entry.keyPreview, entry.host, entry.prefix]
      .filter(Boolean)
      .join(' ')
  );
}

export interface VisibleRows {
  /** Entry id -> its rows to show, in draft order. Entries without rows to show are absent. */
  rows: Map<string, AliasRow[]>;
  /** Entries to show, in draft order (an entry with no rows shows when nothing narrows the list). */
  entries: AliasEntry[];
  total: number;
  shown: number;
}

export interface VisibilityInput {
  draft: AliasDraft;
  filter: AliasFilter;
  issues: Record<string, RowIssue>;
  groups: NameGroup[];
  groupOfRow: Record<string, string>;
  marks: Record<string, RowMark>;
  failedEntries: ReadonlySet<string>;
  /** Entry id -> label text the search also matches. */
  haystacks: Record<string, string>;
  /** Alias input text per row id, where the page keeps it (the draft normalizes it). */
  texts: Record<string, string>;
}

/**
 * The rows and entries the filter keeps. A row the user changed stays visible under "With an alias"
 * and "Needs a look", so it never disappears while being edited.
 */
export function visibleRows(input: VisibilityInput): VisibleRows {
  const { draft, filter, issues, marks, failedEntries, haystacks, texts } = input;
  const groupsByKey = new Map(input.groups.map((group) => [group.key, group]));
  const nameRows = filter.name ? new Set(groupsByKey.get(filter.name)?.rowIds ?? []) : null;
  const query = filter.query.trim().toLowerCase();
  const baseAlias = new Map(draft.base.rows.map((row) => [row.id, row.alias]));
  const entries = draftEntries(draft).filter((entry) => {
    if (filter.store !== 'all' && entry.store !== filter.store) return false;
    return filter.provider === 'all' || providerKeyOf(entry) === filter.provider;
  });
  const narrowed = query !== '' || filter.view !== 'all' || nameRows !== null;
  const rows = new Map<string, AliasRow[]>();
  const shownEntries: AliasEntry[] = [];
  let total = 0;
  let shown = 0;
  for (const entry of entries) {
    const entryRows = draft.rows.filter((row) => row.entryId === entry.id);
    total += entryRows.length;
    const entryMatches = query !== '' && (haystacks[entry.id] ?? '').includes(query);
    const keep = entryRows.filter((row) => {
      const touched = marks[row.id] !== null && marks[row.id] !== undefined;
      if (nameRows && !nameRows.has(row.id)) return false;
      if (filter.view === 'aliased' && !touched && row.alias === null && !baseAlias.get(row.id)) {
        return false;
      }
      if (filter.view === 'attention' && !touched) {
        const group = groupsByKey.get(input.groupOfRow[row.id]);
        if (!needsLook(issues[row.id], group, failedEntries.has(entry.id))) return false;
      }
      if (query === '' || entryMatches || isBlankNewRow(row)) return true;
      const text = [row.upstream, row.alias, texts[row.id], row.displayName].map(lower).join(' ');
      return text.includes(query);
    });
    if (keep.length) {
      rows.set(entry.id, keep);
      shownEntries.push(entry);
      shown += keep.length;
    } else if (!narrowed) {
      // An entry without rows: a key without a model list, a login type without aliases.
      shownEntries.push(entry);
    } else if (entryMatches && entryRows.length === 0 && filter.view === 'all' && !nameRows) {
      shownEntries.push(entry);
    }
  }
  return { rows, entries: shownEntries, total, shown };
}

/** The keys of a group that share its model list (the entry's siblings in its stored group). */
export function siblingsOf(entry: KeyEntry, entries: readonly AliasEntry[]): number {
  return entries.filter(
    (other) =>
      other.store === 'api-key' &&
      other.family === entry.family &&
      other.groupIndex === entry.groupIndex &&
      other.id !== entry.id &&
      other.listSource === 'group'
  ).length;
}

/** Rows with a blocking issue in the draft, wherever they are. */
export const blockingCount = (issues: Record<string, RowIssue>): number =>
  Object.values(issues).filter((issue) => isBlocking(issue)).length;

/** Login types the page offers for a new channel, known to the console; free text stays allowed. */
export const LOGIN_CHANNELS = [
  'claude',
  'codex',
  'antigravity',
  'vertex',
  'aistudio',
  'kimi',
  'xai',
  'meta',
] as const;

/**
 * A record keyed by row id (`<entryId>#<rest>`) after a rebase (3.6): the rows of a carried entry move to
 * the fresh entry's id, the others are dropped (their entry took the fresh rows).
 */
export function rekeyRows<T>(
  record: Readonly<Record<string, T>>,
  carried: Readonly<Record<string, string>>
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [rowId, value] of Object.entries(record)) {
    const cut = rowId.indexOf('#');
    const to = carried[rowId.slice(0, cut)];
    if (to) next[`${to}${rowId.slice(cut)}`] = value;
  }
  return next;
}

/** A record keyed by entry id after a rebase (3.6): carried entries move, the others are dropped. */
export function rekeyEntries<T>(
  record: Readonly<Record<string, T>>,
  carried: Readonly<Record<string, string>>
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [entryId, value] of Object.entries(record)) {
    if (carried[entryId]) next[carried[entryId]] = value;
  }
  return next;
}

/** 2.5: whether a key entry's model list is the part that could not be read (it then has no rows). */
export function keyListUnread(entry: KeyEntry, unread: readonly string[]): boolean {
  const group = `api-keys.${entry.family}[${entry.groupIndex}]`;
  return (
    unread.includes(`${group}.models`) ||
    (entry.keyIndex !== null && unread.includes(`${group}.keys[${entry.keyIndex}].models`))
  );
}

/**
 * U2: where the old login alias address leads. `?provider=<p>` becomes `&channel=<p>`; the old editor's
 * other parameters (`view`) mean nothing here.
 */
export function aliasesAddressFor(search: string): string {
  const provider = new URLSearchParams(search).get('provider')?.trim() ?? '';
  const params = new URLSearchParams({ store: 'login' });
  if (provider) params.set('channel', provider);
  return `/provimux/aliases?${params.toString()}`;
}

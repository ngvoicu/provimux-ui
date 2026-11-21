/**
 * The Aliases page's own logic: its filter, what it marks as changed, how it names a service (U1), and
 * the page's state as one pure function, `pageStep`, with `canEdit` (U4, design 3.6). Pure, over the
 * data layer's draft; the data layer itself is not changed here.
 */
import type { ProviderFamily } from '@/services/api/providers';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import {
  changeRow,
  discard,
  discardEntry,
  draftEntries,
  editsOf,
  isBlankNewRow,
  isBlocking,
  removeRow,
  startDraft,
  type LostEdit,
} from './draft';
import { planCommit } from './plan';
import { ALIAS_FAMILIES } from './rows';
import type {
  AliasDraft,
  AliasEntry,
  AliasRow,
  AliasState,
  CommitOutcome,
  KeyEntry,
  NameGroup,
  RowIssue,
} from './types';

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

/** Whether a row needs a look: an issue, or a clash of its name. */
export function needsLook(issue: RowIssue | undefined, group: NameGroup | undefined): boolean {
  return issue !== undefined || (group !== undefined && isClash(group));
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
  const { draft, filter, issues, marks, haystacks, texts } = input;
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
        if (!needsLook(issues[row.id], group)) return false;
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

// --- The page's state (U4, design 3.6) -----------------------------------------------------------

/** One entry's edits that a save did not confirm: kept on screen, to be typed again, until dismissed. */
export interface LostNotice {
  /** Unique among the page's notices. */
  key: number;
  /** The save it came from: the notices of one save share this number, and its one reason. */
  save: number;
  /** The entry as it was in the dropped draft (its label is shown as it was). */
  entry: AliasEntry;
  edits: LostEdit[];
  failure: CommitOutcome['failure'];
}

export interface PageState {
  /** null: no read is held (before the first read, after a save, until a read answers). */
  draft: AliasDraft | null;
  /** The alias texts being typed, by row id; a row of `draft` only. */
  texts: Record<string, string>;
  saving: boolean;
  /** From the start of any read to its answer or failure, the Reload button's included. */
  reading: boolean;
  /** The message of the last read that failed; a read that answers clears it. */
  loadError: string | null;
  /** The edits not confirmed saved, until dismissed. */
  lost: LostNotice[];
}

export const INITIAL_PAGE: PageState = {
  draft: null,
  texts: {},
  saving: false,
  reading: false,
  loadError: null,
  lost: [],
};

export type PageEvent =
  | { type: 'read-started' }
  | { type: 'read-answered'; state: AliasState }
  | { type: 'read-failed'; message: string }
  | { type: 'edited'; change: (draft: AliasDraft) => AliasDraft }
  | { type: 'alias-typed'; rowId: string; text: string }
  | { type: 'row-removed'; rowId: string }
  /** "Undo changes here": the entry's rows are its base rows again (`discardEntry`), its texts dropped. */
  | { type: 'entry-undone'; entryId: string }
  /** "Discard changes": every edit dropped (`discard`), every text dropped. */
  | { type: 'discarded' }
  | { type: 'save-started' }
  | { type: 'save-answered'; outcome: CommitOutcome }
  | { type: 'dismissed'; key: number };

/** Whether the board takes input: a read is held, it has a tag, and nothing is pending. */
export function canEdit(page: PageState): boolean {
  return page.draft !== null && page.draft.base.etag !== null && !page.saving && !page.reading;
}

/** Whether the held draft has something to save. */
export const isDirty = (page: PageState): boolean =>
  page.draft !== null && planCommit(page.draft).length > 0;

/**
 * Whether the save bar is up: while the board takes input and the draft has edits. While a save runs it
 * stays, to say "Saving…", with nothing to click; while a read is pending, or without a tag, it is not up.
 */
export const saveBarShown = (page: PageState): boolean =>
  isDirty(page) && (canEdit(page) || page.saving);

/** Leaving asks first while the draft has edits or the list of edits not saved has an item (3.6). */
export const leaveGuarded = (page: PageState): boolean => isDirty(page) || page.lost.length > 0;

/** One item per entry of `outcome.unconfirmed` that has edits (`editsOf`), from the dropped draft. */
export function unconfirmedEdits(
  draft: AliasDraft,
  outcome: CommitOutcome
): Omit<LostNotice, 'key' | 'save'>[] {
  // The draft's entries, its new login channels included: the fresh read may have none of them.
  const entries = new Map(draftEntries(draft).map((entry) => [entry.id, entry]));
  const items: Omit<LostNotice, 'key' | 'save'>[] = [];
  for (const entryId of new Set(outcome.unconfirmed)) {
    const entry = entries.get(entryId);
    const edits = editsOf(draft, entryId);
    if (entry && edits.length) items.push({ entry, edits, failure: outcome.failure });
  }
  return items;
}

const nextAfter = (values: readonly number[]): number =>
  values.length ? Math.max(...values) + 1 : 1;

const withoutKey = (record: Record<string, string>, key: string): Record<string, string> => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

/** The texts of rows the draft still has. */
const textsOf = (texts: Record<string, string>, draft: AliasDraft): Record<string, string> => {
  const ids = new Set(draft.rows.map((row) => row.id));
  const kept = Object.entries(texts).filter(([id]) => ids.has(id));
  return kept.length === Object.keys(texts).length ? texts : Object.fromEntries(kept);
};

/**
 * The page's state after one event (3.6). Pure. Nothing is carried from one read to the next: a read's
 * answer starts a new draft with no text; a save's answer drops the draft and lists, from it, every edit
 * of every entry the save did not confirm. Nothing is editable while a read or a save is pending, nor on
 * a read without a tag: an edit then changes nothing.
 */
export function pageStep(page: PageState, event: PageEvent): PageState {
  switch (event.type) {
    case 'read-started':
      return page.reading ? page : { ...page, reading: true };
    case 'read-answered':
      // While a save runs, its draft is the one it sends, and the save is what lists its edits: an
      // answer that lands then is dropped. The page reads again when the save answers.
      if (page.saving) return { ...page, reading: false };
      return {
        ...page,
        draft: startDraft(event.state),
        texts: {},
        reading: false,
        loadError: null,
      };
    case 'read-failed':
      return { ...page, reading: false, loadError: event.message };
    case 'edited': {
      if (!canEdit(page)) return page;
      const draft = event.change(page.draft!);
      if (draft === page.draft) return page;
      return { ...page, draft, texts: textsOf(page.texts, draft) };
    }
    case 'alias-typed': {
      if (!canEdit(page)) return page;
      const current = page.draft!;
      if (!current.rows.some((row) => row.id === event.rowId)) return page;
      const draft = changeRow(current, event.rowId, { alias: event.text });
      // A row that takes no edit (2.5) keeps no text either.
      if (draft === current) return page;
      return { ...page, draft, texts: { ...page.texts, [event.rowId]: event.text } };
    }
    case 'row-removed': {
      if (!canEdit(page)) return page;
      const draft = removeRow(page.draft!, event.rowId);
      if (draft === page.draft) return page;
      // The box then shows what the draft holds: the alias being typed goes with the row (3.2).
      return { ...page, draft, texts: withoutKey(page.texts, event.rowId) };
    }
    case 'entry-undone': {
      if (!canEdit(page)) return page;
      const prefix = `${event.entryId}#`;
      const texts = Object.fromEntries(
        Object.entries(page.texts).filter(([rowId]) => !rowId.startsWith(prefix))
      );
      return { ...page, draft: discardEntry(page.draft!, event.entryId), texts };
    }
    case 'discarded':
      if (!canEdit(page)) return page;
      return { ...page, draft: discard(page.draft!), texts: {} };
    case 'save-started':
      if (!canEdit(page)) return page;
      return { ...page, saving: true };
    case 'save-answered': {
      if (!page.saving || page.draft === null) return page;
      const items = unconfirmedEdits(page.draft, event.outcome);
      const key = nextAfter(page.lost.map((notice) => notice.key));
      const save = nextAfter(page.lost.map((notice) => notice.save));
      return {
        ...page,
        draft: null,
        texts: {},
        saving: false,
        lost: [...page.lost, ...items.map((item, index) => ({ ...item, key: key + index, save }))],
      };
    }
    case 'dismissed':
      if (!page.lost.some((notice) => notice.key === event.key)) return page;
      return { ...page, lost: page.lost.filter((notice) => notice.key !== event.key) };
  }
}

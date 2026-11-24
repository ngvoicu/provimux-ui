/**
 * The page's state as one pure function, `pageStep`, with `canEdit` (design aliases-page.md 3.6), and what
 * the save bar counts. Pure, over the data layer's draft. The Models page (models-page.md) holds one
 * `PageState` and sends these events.
 */
import type { ProviderFamily } from '@/services/api/providers';
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
import { storedPriority } from './priority';
import type {
  AliasDraft,
  AliasEntry,
  AliasRow,
  AliasState,
  CommitOutcome,
  RowIssue,
} from './types';

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

/** What the save bar counts: rows new or changed, rows removed, and API-key priorities changed. */
export function changeCount(draft: AliasDraft): number {
  const marks = Object.values(rowMarks(draft)).filter(Boolean).length;
  const removed = Object.values(removedCounts(draft)).reduce((sum, n) => sum + n, 0);
  return marks + removed + Object.keys(draft.priorities ?? {}).length;
}

/** Rows with a blocking issue in the draft, wherever they are. */
export const blockingCount = (issues: Record<string, RowIssue>): number =>
  Object.values(issues).filter((issue) => isBlocking(issue)).length;

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
  /** An API key's priority the save did not confirm (section 10); absent when it was not changed. */
  priority?: { before: number; after: number };
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
    const after = draft.priorities?.[entryId];
    const priority =
      entry?.store === 'api-key' && after !== undefined
        ? { before: storedPriority(draft.base, entry).value, after }
        : undefined;
    if (entry && (edits.length || priority)) {
      items.push({ entry, edits, ...(priority ? { priority } : {}), failure: outcome.failure });
    }
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

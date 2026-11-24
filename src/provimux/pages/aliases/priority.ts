/**
 * An API key's routing priority (design aliases-page.md, section 10). The proxy reads it from the same
 * stored family the page already writes, `api-keys.<family>`: on a group, which its keys inherit, and on a
 * key, which overrides the group (`priority: null` inherits); an OpenAI-compatible entry has its own. A
 * login's priority lives in its login file, which this page never reads or writes. Pure.
 */
import { isRecord } from '@/utils/helpers';
import { familyGroups } from './rows';
import type { AliasDraft, AliasState, KeyEntry } from './types';

const numberOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

/** Where an entry's priority is stored, and its value as the proxy reads it (0 when nothing sets it). */
export interface StoredPriority {
  value: number;
  /** 'key': the key sets it; 'group': inherited from its group (an OpenAI-compatible entry's own is 'group'). */
  from: 'key' | 'group' | 'none';
}

export function storedPriority(
  state: Pick<AliasState, 'document'>,
  entry: KeyEntry
): StoredPriority {
  const group = familyGroups(state.document, entry.family)[entry.groupIndex];
  if (!isRecord(group)) return { value: 0, from: 'none' };
  const own = numberOf(group.priority);
  if (entry.keyIndex !== null) {
    const keys = Array.isArray(group.keys) ? group.keys : [];
    const key = keys[entry.keyIndex];
    const value = isRecord(key) ? numberOf(key.priority) : null;
    if (value !== null) return { value, from: 'key' };
  }
  return own !== null ? { value: own, from: 'group' } : { value: 0, from: 'none' };
}

/** The priority the draft gives an entry: the edit when there is one, else the stored one. */
export function draftPriority(draft: AliasDraft, entry: KeyEntry): number {
  return draft.priorities?.[entry.id] ?? storedPriority(draft.base, entry).value;
}

/** Whether the draft changes an entry's priority. */
export const priorityChanged = (draft: AliasDraft, entryId: string): boolean =>
  draft.priorities !== undefined && Object.prototype.hasOwnProperty.call(draft.priorities, entryId);

/**
 * Sets an API key's priority in the draft. Equal to the stored value: the edit is dropped. Refused (the
 * draft returned as it was) for an entry that is not an API key of the read, and for a value that is not
 * an integer the proxy can hold (int32 is enough for every real priority).
 */
export function setKeyPriority(draft: AliasDraft, entryId: string, value: number): AliasDraft {
  const entry = draft.base.entries.find((e) => e.id === entryId);
  if (!entry || entry.store !== 'api-key') return draft;
  if (!Number.isInteger(value) || Math.abs(value) > 2_147_483_647) return draft;
  const stored = storedPriority(draft.base, entry).value;
  const priorities = { ...(draft.priorities ?? {}) };
  if (value === stored) {
    if (!(entryId in priorities)) return draft;
    delete priorities[entryId];
  } else {
    if (priorities[entryId] === value) return draft;
    priorities[entryId] = value;
  }
  return { ...draft, priorities };
}

/**
 * The group with the entry's priority written: on the key (`keys[keyIndex].priority`), on the entry for
 * OpenAI-compatible. Nothing else of the group or key changes.
 */
export function withPriority(
  group: Readonly<Record<string, unknown>>,
  entry: KeyEntry,
  value: number
): Record<string, unknown> {
  if (entry.keyIndex === null) return { ...group, priority: value };
  const keys = [...(group.keys as unknown[])];
  keys[entry.keyIndex] = { ...(keys[entry.keyIndex] as Record<string, unknown>), priority: value };
  return { ...group, keys };
}

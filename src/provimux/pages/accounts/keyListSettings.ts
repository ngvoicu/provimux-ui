/**
 * A key's list settings (design key-model-lists.md 6): Provimux's own fields, which AI Providers' form model
 * does not know and its save leaves as they are.
 *
 * - `fixed-models: true`: the key offers exactly the models of its settings and its service is never asked.
 *   Absent means its list keeps itself up to date (the default). A native key reads its own value, else its
 *   connection's (the group's), as the proxy does.
 * - `excluded-models` on an OpenAI-compatible entry: the models it never serves, with wildcards, as the
 *   built-in keys have them (their own field is AI Providers'). One list for the entry's keys.
 *
 * They are written by one request of their own, after AI Providers' save when that runs: the family's list as
 * read again, with only these fields changed on the key's group (or the key), `PUT /config/api-keys/<family>`
 * with `If-Match` (accountsApi). Pure.
 */
import type { ProviderFamily } from '@/services/api/providers';
import { isRecord } from '@/utils/helpers';
import { familyGroups } from '../aliases/rows';
import { KeyWriteError } from './keyWrites';

export const FIXED_FIELD = 'fixed-models';
export const EXCLUDED_FIELD = 'excluded-models';

export interface ListSettings {
  /** The list is fixed: exactly the models of the key's settings, its service never asked. */
  fixed: boolean;
  /** An OpenAI-compatible entry's exclusions, as stored; null for other families. */
  excluded: string[] | null;
}

type Group = Record<string, unknown>;

const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];

/**
 * Whether a family's keys are ever asked for their service's list: Vertex and Interactions keys are not
 * (key-model-lists.md 4), so a fixed list would change nothing for them and the switch is not offered.
 */
export const familyAsked = (family: ProviderFamily): boolean =>
  family !== 'vertex' && family !== 'interactions';

/** The defaults: the list keeps itself up to date, nothing excluded. */
export const defaultListSettings = (family: ProviderFamily): ListSettings => ({
  fixed: false,
  excluded: family === 'openai-compatibility' ? [] : null,
});

/**
 * The settings of a stored group and key (`keyIndex` null: an OpenAI-compatible entry). A native key's own
 * `fixed-models` wins over its group's.
 */
export function listSettingsIn(
  family: ProviderFamily,
  group: unknown,
  keyIndex: number | null
): ListSettings {
  if (!isRecord(group)) return defaultListSettings(family);
  if (family === 'openai-compatibility') {
    return { fixed: group[FIXED_FIELD] === true, excluded: strings(group[EXCLUDED_FIELD]) };
  }
  const keys = Array.isArray(group.keys) ? group.keys : [];
  const key = keyIndex !== null ? keys[keyIndex] : undefined;
  const own = isRecord(key) ? flag(key[FIXED_FIELD]) : null;
  return { fixed: own ?? flag(group[FIXED_FIELD]) ?? false, excluded: null };
}

export const sameListSettings = (a: ListSettings, b: ListSettings): boolean =>
  a.fixed === b.fixed && JSON.stringify(a.excluded) === JSON.stringify(b.excluded);

/** Where to write: the key's group by its position and name (checked), and the key (null: the entry). */
export interface ListTarget {
  family: ProviderFamily;
  /** null: the last group of the family with this name (an entry just added). */
  groupIndex: number | null;
  keyIndex: number | null;
  name: string;
}

/**
 * The key's group with the settings applied. An OpenAI-compatible entry holds both on itself. A native key:
 * on its connection when no other key of it takes the connection's value (the key's own is dropped), else on
 * the key itself, and only where it differs from the connection's, so the other keys keep theirs.
 */
export function groupWithListSettings(
  family: ProviderFamily,
  group: Group,
  keyIndex: number | null,
  next: ListSettings
): Group {
  const out: Group = { ...group };
  if (family === 'openai-compatibility') {
    if (next.fixed) out[FIXED_FIELD] = true;
    else delete out[FIXED_FIELD];
    const excluded = [...new Set((next.excluded ?? []).map((rule) => rule.trim()).filter(Boolean))];
    if (excluded.length) out[EXCLUDED_FIELD] = excluded;
    else delete out[EXCLUDED_FIELD];
    return out;
  }
  const keys = Array.isArray(group.keys) ? [...group.keys] : [];
  if (keyIndex === null || !isRecord(keys[keyIndex])) throw new KeyWriteError('not-found');
  const key: Group = { ...(keys[keyIndex] as Group) };
  const inheriting = keys.filter(
    (other, index) => index !== keyIndex && isRecord(other) && flag(other[FIXED_FIELD]) === null
  ).length;
  if (inheriting === 0) {
    if (next.fixed) out[FIXED_FIELD] = true;
    else delete out[FIXED_FIELD];
    delete key[FIXED_FIELD];
  } else if (next.fixed === (flag(group[FIXED_FIELD]) ?? false)) {
    delete key[FIXED_FIELD];
  } else {
    key[FIXED_FIELD] = next.fixed;
  }
  keys[keyIndex] = key;
  out.keys = keys;
  return out;
}

/**
 * The family's list, as read, with the key's list settings changed and nothing else. The group must still be
 * where the target says, under its name: a list changed since in a way that moved it writes nothing.
 */
export function familyWithListSettings(
  document: unknown,
  target: ListTarget,
  next: ListSettings
): unknown[] {
  const groups = [...familyGroups(document, target.family)];
  const named = (group: unknown) =>
    isRecord(group) && String(group.name ?? '').trim() === target.name.trim();
  let index = target.groupIndex;
  if (index === null) {
    index = -1;
    groups.forEach((group, i) => {
      if (named(group)) index = i;
    });
  }
  const group = index !== null && index >= 0 ? groups[index] : undefined;
  if (!isRecord(group) || !named(group)) throw new KeyWriteError('not-found');
  groups[index!] = groupWithListSettings(target.family, group, target.keyIndex, next);
  return groups;
}

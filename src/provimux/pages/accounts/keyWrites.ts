/**
 * An API key's changes, as the family's list to write back (design accounts-page.md, section 5): the list as
 * read, with one key (or one OpenAI-compatible entry) changed at its own position and nothing else touched.
 * The same shapes AI Providers writes: off is `excluded-models: ["*"]` on a native key (`applyNativeDisabled`)
 * and `disabled: true` on an OpenAI-compatible entry; a new native key is a group of its own, as AI Providers'
 * "add" makes it. The request carries `If-Match` (accountsApi), so a list changed since the read is never
 * overwritten. Pure.
 */
import { applyNativeDisabled } from '@/services/api/nativeDisabled';
import type { ProviderFamily } from '@/services/api/providers';
import { isRecord } from '@/utils/helpers';
import { withPriority } from '../aliases/priority';
import { familyGroups, hostOf } from '../aliases/rows';
import type { KeyEntry } from '../aliases/types';
import type { KeyTarget } from './services';

type Group = Record<string, unknown>;

export class KeyWriteError extends Error {
  constructor(readonly code: 'not-found' | 'several-keys' | 'invalid' | 'duplicate-name') {
    super(code);
    this.name = 'KeyWriteError';
  }
}

/** The family's groups as read, and the entry's group, checked to still be where the entry says. */
function located(document: unknown, entry: KeyEntry): { groups: unknown[]; group: Group } {
  const groups = [...familyGroups(document, entry.family)];
  const group = groups[entry.groupIndex];
  if (!isRecord(group) || !Array.isArray(group.keys)) throw new KeyWriteError('not-found');
  if (entry.keyIndex !== null && !isRecord(group.keys[entry.keyIndex])) {
    throw new KeyWriteError('not-found');
  }
  return { groups, group };
}

const replaced = (groups: unknown[], index: number, group: Group | null): unknown[] =>
  group === null ? groups.filter((_, i) => i !== index) : groups.map((g, i) => (i === index ? group : g));

/** On or off. */
export function familyWithKeyOn(document: unknown, entry: KeyEntry, on: boolean): unknown[] {
  const { groups, group } = located(document, entry);
  if (entry.keyIndex === null) {
    const next: Group = { ...group };
    if (on) delete next.disabled;
    else next.disabled = true;
    return replaced(groups, entry.groupIndex, next);
  }
  const intents: Array<boolean | undefined> = [];
  intents[entry.keyIndex] = !on;
  return replaced(groups, entry.groupIndex, applyNativeDisabled(group, { keys: intents }));
}

/** The routing priority, set on the key itself (on the entry for OpenAI-compatible), as Models sets it. */
export function familyWithPriority(document: unknown, entry: KeyEntry, value: number): unknown[] {
  if (!Number.isInteger(value) || Math.abs(value) > 2_147_483_647) throw new KeyWriteError('invalid');
  const { groups, group } = located(document, entry);
  return replaced(groups, entry.groupIndex, withPriority(group, entry, value));
}

/**
 * Removed: a native key leaves its group (the group stays, as AI Providers leaves it); an OpenAI-compatible
 * entry is removed whole, with its keys.
 */
export function familyWithoutKey(document: unknown, entry: KeyEntry): unknown[] {
  const { groups, group } = located(document, entry);
  if (entry.keyIndex === null) return replaced(groups, entry.groupIndex, null);
  const keys = (group.keys as unknown[]).filter((_, i) => i !== entry.keyIndex);
  return replaced(groups, entry.groupIndex, { ...group, keys });
}

/** The key replaced by a new one; everything else of it (its models, priority, settings) kept. */
export function familyWithKeyReplaced(
  document: unknown,
  entry: KeyEntry,
  apiKey: string
): unknown[] {
  const value = apiKey.trim();
  if (!value) throw new KeyWriteError('invalid');
  const { groups, group } = located(document, entry);
  const keys = [...(group.keys as unknown[])];
  const index = entry.keyIndex ?? 0;
  if (entry.keyIndex === null && keys.length !== 1) throw new KeyWriteError('several-keys');
  const key = keys[index];
  if (!isRecord(key)) throw new KeyWriteError('not-found');
  keys[index] = { ...key, 'api-key': value };
  return replaced(groups, entry.groupIndex, { ...group, keys });
}

export interface NewKey {
  apiKey: string;
  /** A service of its own: the entry's name and address. */
  name?: string;
  baseUrl?: string;
}

/** A name not taken in the family: `base`, else `base-2`, `base-3`… */
const freeName = (groups: unknown[], base: string): string => {
  const names = new Set(groups.map((g) => (isRecord(g) ? String(g.name ?? '').trim() : '')));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
};

/** A base URL the owner typed: http(s) with a host. */
export function validBaseUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * A new key. A native family gets a group of its own (`<family>-<n>`, the next free number, as AI Providers
 * names it), with the service's base URL when it has one. An OpenAI-compatible service with a fixed address
 * (OpenRouter) joins the entry already on that address, so it shares that entry's models; with none, or for
 * a service of its own, a new entry is made.
 */
export function familyWithKeyAdded(
  document: unknown,
  target: KeyTarget,
  input: NewKey
): { family: ProviderFamily; groups: unknown[] } {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new KeyWriteError('invalid');
  const family = target.family;
  const groups = [...familyGroups(document, family)];
  const key = { 'api-key': apiKey };

  if (family !== 'openai-compatibility') {
    let n = groups.length + 1;
    const names = new Set(groups.map((g) => (isRecord(g) ? g.name : undefined)));
    while (names.has(`${family}-${n}`)) n += 1;
    const group: Group = { name: `${family}-${n}` };
    if (target.baseUrl) group['base-url'] = target.baseUrl;
    group.keys = [key];
    return { family, groups: [...groups, group] };
  }

  if (target.custom) {
    const name = (input.name ?? '').trim();
    const baseUrl = (input.baseUrl ?? '').trim();
    if (!name || !validBaseUrl(baseUrl)) throw new KeyWriteError('invalid');
    const taken = groups.some((g) => isRecord(g) && String(g.name ?? '').trim() === name);
    if (taken) throw new KeyWriteError('duplicate-name');
    return { family, groups: [...groups, { name, 'base-url': baseUrl, keys: [key] }] };
  }

  const host = hostOf(target.baseUrl);
  const existing = groups.findIndex(
    (g) =>
      isRecord(g) &&
      Array.isArray(g.keys) &&
      host !== null &&
      hostOf(typeof g['base-url'] === 'string' ? g['base-url'] : null) === host
  );
  if (existing !== -1) {
    const group = groups[existing] as Group;
    return {
      family,
      groups: replaced(groups, existing, { ...group, keys: [...(group.keys as unknown[]), key] }),
    };
  }
  const name = freeName(groups, target.entryName ?? 'compatible');
  return {
    family,
    groups: [...groups, { name, 'base-url': target.baseUrl, keys: [key] }],
  };
}

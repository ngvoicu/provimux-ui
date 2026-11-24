/**
 * An exclusion added or removed, as the request the original pages make for the same field (design
 * models-page.md, section 6), built from the page's own read. Pure.
 *
 * - An API key: `PUT /config/api-keys/<family>` with the family's list as read, one list changed: the key's own
 *   when it has one; the connection's when no other key of it uses that list; otherwise the key gets its own,
 *   the connection's with the change (as AI Providers' per-key switch does, `applyNativeDisabled`). The rest
 *   of the list, `*` and anything not a string included, stays as it is.
 * - Every subscription of a login type: `PUT /config/oauth/excluded-models` with the map as read, that type's
 *   list changed (its other spellings folded into it, as Auth Files writes it); a list left empty is removed.
 */
import type { ProviderFamily } from '@/services/api/providers';
import { isRecord } from '@/utils/helpers';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import { ALIAS_PATHS } from '../aliases/aliasesApi';
import { familyGroups } from '../aliases/rows';
import type { KeyEntry } from '../aliases/types';
import {
  LOGINS_EXCLUDED_KEY,
  inheritingKeys,
  loginsMapIn,
  loginsMapWritable,
  ruleKey,
  type Place,
} from './exclusions';

export const EXCLUDED_LOGINS_PATH = '/config/oauth/excluded-models';

export class ExclusionWriteError extends Error {
  constructor(readonly code: 'not-found' | 'unread' | 'invalid') {
    super(code);
    this.name = 'ExclusionWriteError';
  }
}

export interface ExclusionChange {
  place: Place;
  rule: string;
  /** true: add the rule; false: take it out. */
  excluded: boolean;
}

export interface PlannedExclusionWrite {
  path: string;
  body: unknown;
}

/** A stored list with one rule added (at the end) or taken out (every spelling of it); the rest untouched. */
export function listWithRule(list: readonly unknown[], rule: string, excluded: boolean): unknown[] {
  const key = ruleKey(rule);
  const rest = list.filter((item) => !(typeof item === 'string' && ruleKey(item) === key));
  return excluded ? [...rest, rule.trim()] : rest;
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The family's groups with one key's exclusions changed. */
export function familyWithKeyRule(
  document: unknown,
  entry: KeyEntry,
  rule: string,
  excluded: boolean
): unknown[] {
  if (entry.keyIndex === null) throw new ExclusionWriteError('invalid');
  const groups = [...familyGroups(document, entry.family)];
  const group = groups[entry.groupIndex];
  if (!isRecord(group) || !Array.isArray(group.keys)) throw new ExclusionWriteError('not-found');
  const keys = [...group.keys];
  const key = keys[entry.keyIndex];
  if (!isRecord(key)) throw new ExclusionWriteError('not-found');
  const own = key[LOGINS_EXCLUDED_KEY];
  const shared = group[LOGINS_EXCLUDED_KEY];
  for (const value of [own, shared]) {
    if (value !== undefined && value !== null && !Array.isArray(value)) {
      throw new ExclusionWriteError('unread');
    }
  }
  let next: Record<string, unknown>;
  if (own !== undefined && own !== null) {
    keys[entry.keyIndex] = {
      ...key,
      [LOGINS_EXCLUDED_KEY]: listWithRule(asList(own), rule, excluded),
    };
    next = { ...group, keys };
  } else if (inheritingKeys(group) <= 1) {
    const list = listWithRule(asList(shared), rule, excluded);
    next = { ...group };
    if (list.length) next[LOGINS_EXCLUDED_KEY] = list;
    else delete next[LOGINS_EXCLUDED_KEY];
  } else {
    keys[entry.keyIndex] = {
      ...key,
      [LOGINS_EXCLUDED_KEY]: listWithRule(asList(shared), rule, excluded),
    };
    next = { ...group, keys };
  }
  return groups.map((g, i) => (i === entry.groupIndex ? next : g));
}

/** The `oauth.excluded-models` map with one login type's list changed. */
export function loginsMapWithRule(
  document: unknown,
  type: string,
  rule: string,
  excluded: boolean
): Record<string, unknown> {
  if (!loginsMapWritable(document)) throw new ExclusionWriteError('unread');
  const map = loginsMapIn(document) as Record<string, unknown>;
  const target = normalizeOAuthProviderKey(type);
  if (!target) throw new ExclusionWriteError('invalid');
  const lists: unknown[] = [];
  for (const [spelling, value] of Object.entries(map)) {
    if (normalizeOAuthProviderKey(spelling) !== target) continue;
    if (value !== null && value !== undefined && !Array.isArray(value)) {
      throw new ExclusionWriteError('unread');
    }
    lists.push(...asList(value));
  }
  const list = listWithRule(lists, rule, excluded);
  const next: Record<string, unknown> = {};
  let placed = false;
  for (const [spelling, value] of Object.entries(map)) {
    if (normalizeOAuthProviderKey(spelling) !== target) {
      next[spelling] = value;
    } else if (!placed) {
      placed = true;
      if (list.length) next[target] = list;
    }
  }
  if (!placed && list.length) next[target] = list;
  return next;
}

/** The one request a change is: its path and its body, from the page's read. */
export function planExclusion(document: unknown, change: ExclusionChange): PlannedExclusionWrite {
  const rule = change.rule.trim();
  if (!rule) throw new ExclusionWriteError('invalid');
  const { place } = change;
  if (place.kind === 'logins') {
    return {
      path: EXCLUDED_LOGINS_PATH,
      body: loginsMapWithRule(document, place.type, rule, change.excluded),
    };
  }
  const family: ProviderFamily = place.entry.family;
  return {
    path: ALIAS_PATHS.family(family),
    body: familyWithKeyRule(document, place.entry, rule, change.excluded),
  };
}

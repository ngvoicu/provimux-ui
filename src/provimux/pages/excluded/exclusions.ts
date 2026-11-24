/**
 * The models an account never serves (design models-page.md, section 6), read from the Models page's own
 * read of the configuration. Two places hold them:
 *
 * - an API key's `excluded-models` (`api-keys.<family>`): the key's own list when it has one, else its
 *   connection's (the group's), as the proxy and AI Providers read it. `*` alone is the key's off switch
 *   (Accounts' switch), not an exclusion. OpenAI-compatible entries have no such list yet: they serve only
 *   the models in their list (`familyExcludes` is the one switch for when the proxy adds it).
 * - every subscription of a login type: `oauth.excluded-models.<type>` (`oauth-excluded-models` before v8),
 *   the list Auth Files' "Excluded models" page edits. A login whose own file has a list uses that list
 *   instead; the file is never read here (it holds the tokens).
 *
 * Pure: an `AliasState` in, places and exclusions out. Matching is upstream's (`matchesExcludedRule`): case
 * does not matter and `*` stands for any characters.
 */
import { DISABLE_ALL_RULE, matchesExcludedRule } from '@/components/excludedModels';
import type { ProviderFamily } from '@/services/api/providers';
import { isRecord } from '@/utils/helpers';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import type { ProvimuxModelRoute, ProvimuxModelRoutesResponse } from '../../api/types';
import { inexactNumbers } from '../aliases/rows';
import type { AliasState, KeyEntry, LoginEntry } from '../aliases/types';
import { serviceOfKey, serviceOfLogin, serviceOrder } from '../accounts/services';

/** Every subscription of one login type: `oauth.excluded-models.<type>`. */
export interface LoginsPlace {
  kind: 'logins';
  /** `logins:<type>` */
  id: string;
  /** The login type, normalized as Auth Files normalizes it (`claude`, `codex`, `antigravity`). */
  type: string;
  /** The stored keys of the map that normalize to `type`, in file order (usually one). */
  spellings: string[];
  service: string;
  /** Login files of the type; null when the credentials list could not be read. */
  loginCount: number | null;
  rules: string[];
}

/** One native API key. */
export interface KeyPlace {
  kind: 'key';
  /** The key's entry id (`<family>/<group>/<key>`), valid for one read. */
  id: string;
  entry: KeyEntry;
  service: string;
  /** Where the key's list is stored: its own, or its connection's (the group's). */
  storedOn: 'key' | 'group';
  /** The connection's keys that use the group's list, this one included; 0 when the key has its own. */
  sharing: number;
  rules: string[];
  /** The key's `*` rule: it is off (Accounts' switch). */
  off: boolean;
}

export type Place = LoginsPlace | KeyPlace;

export interface Exclusion {
  /** `<place id>|<rule, lower-case>` */
  id: string;
  rule: string;
  wildcard: boolean;
  place: Place;
}

export interface ExclusionState {
  places: Place[];
  exclusions: Exclusion[];
  /** API keys and entries of a family without exclusions (`familyExcludes`): the view says so in one line. */
  withoutExclusions: KeyEntry[];
  /** The map of `oauth.excluded-models` can be written whole: no subscription place without it. */
  loginMapWritable: boolean;
  /** Parts of the file holding exclusions the page cannot read (they stay as they are). */
  unread: string[];
}

export const LOGINS_EXCLUDED_KEY = 'excluded-models';

export const ruleKey = (rule: string): string => rule.trim().toLowerCase();
export const isPattern = (rule: string): boolean => rule.includes('*');

/**
 * Whether the proxy applies an API key's `excluded-models` in this family. OpenAI-compatible entries have none
 * yet (`OpenAICompatibility` in the proxy has no such field, and their registration applies none); a coming
 * Provimux release adds it. This is the one switch: when that release is the one the console runs against,
 * return true for them here. Their entries then become places (`keyPlaces`: an entry is one place,
 * `keyIndex === null`, so `storedListOf` and `familyWithKeyRule` take the entry's own list, at the level the
 * release stores it), they get a model list to offer (`KEY_CHANNEL`, or the entry's own models), and the line
 * saying they have none (`withoutExclusions`) is empty by itself.
 */
export const familyExcludes = (family: ProviderFamily): boolean =>
  family !== 'openai-compatibility';

/** The model-definition channel that lists a family's models (`GET /routing/model-definitions/<channel>`). */
const KEY_CHANNEL: Partial<Record<ProviderFamily, string>> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  interactions: 'gemini-interactions',
  vertex: 'vertex',
  xai: 'xai',
  meta: 'meta',
};

/** The channel whose built-in model list a place's models come from; null when there is none. */
export const channelOf = (place: Place): string | null =>
  place.kind === 'logins' ? place.type : (KEY_CHANNEL[place.entry.family] ?? null);

/** The stored `oauth.excluded-models` map: `{}` when absent; anything else as it is. */
export function loginsMapIn(document: unknown): unknown {
  const oauth = isRecord(document) ? document.oauth : undefined;
  if (oauth === undefined || oauth === null) return {};
  if (!isRecord(oauth)) return oauth;
  const map = oauth[LOGINS_EXCLUDED_KEY];
  return map === undefined || map === null ? {} : map;
}

/** Whether `oauth.excluded-models` can be rewritten whole without changing what the page did not read. */
export function loginsMapWritable(document: unknown): boolean {
  const map = loginsMapIn(document);
  return isRecord(map) && inexactNumbers(map, 'oauth.excluded-models').length === 0;
}

/** The rules of a stored list: its non-empty strings, trimmed, once each (first spelling), `*` apart. */
function rulesOf(list: readonly unknown[]): { rules: string[]; off: boolean } {
  const seen = new Set<string>();
  const rules: string[] = [];
  let off = false;
  for (const element of list) {
    if (typeof element !== 'string') continue;
    const rule = element.trim();
    if (!rule) continue;
    if (rule === DISABLE_ALL_RULE) {
      off = true;
      continue;
    }
    const key = ruleKey(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }
  return { rules, off };
}

const keyAt = (entry: KeyEntry): Record<string, unknown> | null => {
  const keys = entry.storedGroup.keys;
  const key = Array.isArray(keys) && entry.keyIndex !== null ? keys[entry.keyIndex] : undefined;
  return isRecord(key) ? key : null;
};

/** A key's own list when it has one (an empty one included), else its connection's. */
export function storedListOf(entry: KeyEntry): {
  list: unknown;
  storedOn: 'key' | 'group';
} {
  const own = keyAt(entry)?.[LOGINS_EXCLUDED_KEY];
  if (own !== undefined && own !== null) return { list: own, storedOn: 'key' };
  return { list: entry.storedGroup[LOGINS_EXCLUDED_KEY], storedOn: 'group' };
}

/** The connection's keys that have no list of their own (they use the group's). */
export function inheritingKeys(group: Readonly<Record<string, unknown>>): number {
  const keys = Array.isArray(group.keys) ? group.keys : [];
  return keys.filter((key) => {
    if (!isRecord(key)) return false;
    const own = key[LOGINS_EXCLUDED_KEY];
    return own === undefined || own === null;
  }).length;
}

function keyPlaces(entries: readonly KeyEntry[], unread: string[]): KeyPlace[] {
  const places: KeyPlace[] = [];
  for (const entry of entries) {
    if (!familyExcludes(entry.family) || entry.keyIndex === null) continue;
    const { list, storedOn } = storedListOf(entry);
    if (list !== undefined && list !== null && !Array.isArray(list)) {
      const at = `api-keys.${entry.family}[${entry.groupIndex}]`;
      unread.push(
        storedOn === 'key'
          ? `${at}.keys[${entry.keyIndex}].${LOGINS_EXCLUDED_KEY}`
          : `${at}.${LOGINS_EXCLUDED_KEY}`
      );
      continue;
    }
    const { rules, off } = rulesOf(Array.isArray(list) ? list : []);
    places.push({
      kind: 'key',
      id: entry.id,
      entry,
      service: serviceOfKey(entry.family, entry.host, entry.groupName),
      storedOn,
      sharing: storedOn === 'group' ? inheritingKeys(entry.storedGroup) : 0,
      rules,
      off,
    });
  }
  return places;
}

function loginPlaces(
  document: unknown,
  logins: readonly LoginEntry[],
  unread: string[]
): { places: LoginsPlace[]; writable: boolean } {
  const stored = loginsMapIn(document);
  const writable = loginsMapWritable(document);
  if (!writable) {
    const oauth = isRecord(document) ? document.oauth : undefined;
    if (!isRecord(stored)) {
      unread.push(isRecord(oauth) ? `oauth.${LOGINS_EXCLUDED_KEY}` : 'oauth');
    } else {
      unread.push(...inexactNumbers(stored, `oauth.${LOGINS_EXCLUDED_KEY}`));
    }
  }
  const map = writable ? (stored as Record<string, unknown>) : {};
  const byType = new Map<string, { spellings: string[]; lists: unknown[]; unread: boolean }>();
  for (const [spelling, list] of Object.entries(map)) {
    const type = normalizeOAuthProviderKey(spelling);
    if (!type) continue;
    const found = byType.get(type) ?? { spellings: [], lists: [], unread: false };
    found.spellings.push(spelling);
    if (Array.isArray(list)) found.lists.push(...list);
    else if (list !== null && list !== undefined) {
      found.unread = true;
      unread.push(`oauth.${LOGINS_EXCLUDED_KEY}.${spelling}`);
    }
    byType.set(type, found);
  }
  const counts = new Map(logins.map((login) => [login.channel, login.loginCount]));
  // Counts are known when the credentials list was read: every login type then has a count.
  const countsKnown = logins.some((login) => login.loginCount !== null);
  const types = new Set([...byType.keys(), ...logins.map((login) => login.channel)]);
  const places: LoginsPlace[] = [];
  for (const type of [...types].sort()) {
    const found = byType.get(type);
    if (found?.unread) continue;
    const loginCount = counts.get(type) ?? (countsKnown ? 0 : null);
    const { rules } = rulesOf(found?.lists ?? []);
    // A type with no subscription and no rule has nothing to show and nothing to offer.
    if (!rules.length && !loginCount) continue;
    places.push({
      kind: 'logins',
      id: `logins:${type}`,
      type,
      spellings: found?.spellings ?? [],
      service: serviceOfLogin(type) ?? `login:${type}`,
      loginCount,
      rules,
    });
  }
  return { places: writable ? places : [], writable };
}

/** The order places are listed in: by service (the catalog's order), subscriptions before keys. */
export function placeOrder(a: Place, b: Place): number {
  return (
    serviceOrder(a.service) - serviceOrder(b.service) ||
    a.service.localeCompare(b.service) ||
    (a.kind === b.kind ? 0 : a.kind === 'logins' ? -1 : 1)
  );
}

/** Every place an exclusion can be, and every exclusion, from the Models page's read. */
export function readExclusions(state: Pick<AliasState, 'document' | 'entries'>): ExclusionState {
  const unread: string[] = [];
  const keyEntries = state.entries.filter((entry): entry is KeyEntry => entry.store === 'api-key');
  const keys = keyPlaces(keyEntries, unread);
  const logins = loginPlaces(
    state.document,
    state.entries.filter((entry): entry is LoginEntry => entry.store === 'login'),
    unread
  );
  const places = [...logins.places, ...keys].sort(placeOrder);
  const exclusions = places.flatMap((place) =>
    place.rules.map((rule) => ({
      id: `${place.id}|${ruleKey(rule)}`,
      rule,
      wildcard: isPattern(rule),
      place,
    }))
  );
  return {
    places,
    exclusions,
    withoutExclusions: keyEntries.filter((entry) => !familyExcludes(entry.family)),
    loginMapWritable: logins.writable,
    unread,
  };
}

// --- One model, every place it is excluded -------------------------------------------------------------

/** A served route of a model matching a rule: who still serves it. */
export interface ServingRoute {
  model: string;
  route: ProvimuxModelRoute;
}

export interface ExcludedModel {
  /** `ruleKey` of the rule. */
  key: string;
  rule: string;
  wildcard: boolean;
  exclusions: Exclusion[];
  /** Routes the proxy serves now under a name the rule matches; null when the routes are not known. */
  stillServed: ServingRoute[] | null;
}

/** The routes of every served name the rule matches. */
export function servedMatching(
  rule: string,
  routes: ProvimuxModelRoutesResponse | null
): ServingRoute[] | null {
  if (!routes) return null;
  return routes.models.flatMap((model) =>
    matchesExcludedRule(rule, model.id)
      ? model.routes.map((route) => ({ model: model.id, route }))
      : []
  );
}

/** The exclusions, one item per rule (case does not matter), in the order of their names. */
export function excludedModels(
  exclusions: readonly Exclusion[],
  routes: ProvimuxModelRoutesResponse | null
): ExcludedModel[] {
  const byKey = new Map<string, ExcludedModel>();
  for (const exclusion of exclusions) {
    const key = ruleKey(exclusion.rule);
    const found = byKey.get(key);
    if (found) found.exclusions.push(exclusion);
    else {
      byKey.set(key, {
        key,
        rule: exclusion.rule,
        wildcard: exclusion.wildcard,
        exclusions: [exclusion],
        stillServed: null,
      });
    }
  }
  const items = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const item of items) item.stillServed = servedMatching(item.rule, routes);
  return items;
}

/** The accounts that still serve a model: distinct auth indexes (or providers when none). */
export const servingAccounts = (served: readonly ServingRoute[]): number =>
  new Set(served.map(({ route }) => route.auth_index ?? `${route.provider}:${route.host ?? ''}`))
    .size;

export interface ExcludedFilter {
  query: string;
  /** 'all' or a service id. */
  service: string;
}

export const EMPTY_EXCLUDED_FILTER: ExcludedFilter = { query: '', service: 'all' };

/**
 * Whether a rule answers the search: its text holds the query, or, when the query is a model name, the
 * rule takes that model out (`claude-*` answers `claude-opus-4-1`).
 */
export function ruleMatchesQuery(rule: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return rule.toLowerCase().includes(q) || matchesExcludedRule(rule, q);
}

/** The items the view shows, each with only the exclusions of the chosen service. */
export function filterExcluded(
  items: readonly ExcludedModel[],
  filter: ExcludedFilter
): ExcludedModel[] {
  return items.flatMap((item) => {
    if (!ruleMatchesQuery(item.rule, filter.query)) return [];
    const exclusions =
      filter.service === 'all'
        ? item.exclusions
        : item.exclusions.filter((exclusion) => exclusion.place.service === filter.service);
    return exclusions.length ? [{ ...item, exclusions }] : [];
  });
}

/** Each service with exclusions, and how many, in the catalog's order. */
export function servicesWithExclusions(
  exclusions: readonly Exclusion[]
): Array<{ service: string; count: number }> {
  const counts = new Map<string, number>();
  for (const exclusion of exclusions) {
    counts.set(exclusion.place.service, (counts.get(exclusion.place.service) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([service, count]) => ({ service, count }))
    .sort(
      (a, b) =>
        serviceOrder(a.service) - serviceOrder(b.service) || a.service.localeCompare(b.service)
    );
}

/** The places whose rules take a model name out (by its name or the model it sends upstream). */
export function placesExcluding(
  exclusions: readonly Exclusion[],
  names: readonly string[]
): Exclusion[] {
  return exclusions.filter((exclusion) =>
    names.some((name) => name && matchesExcludedRule(exclusion.rule, name))
  );
}

// --- Adding one ----------------------------------------------------------------------------------------

export type RuleProblem =
  | 'empty'
  /** `*` alone turns a key off: that is Accounts' switch. */
  | 'reserved'
  /** A comma or a space: the proxy keeps a key's rules joined by commas, so the rule would split. */
  | 'invalid'
  /** The place has this rule already. */
  | 'exists'
  /** A pattern of the place already takes the model out. */
  | 'covered';

/** Why a rule cannot be added to a place, or null when it can. `covered` names the pattern. */
export function ruleProblem(
  place: Place | null,
  text: string
): { problem: RuleProblem; pattern?: string } | null {
  const rule = text.trim();
  if (!rule) return { problem: 'empty' };
  if (rule === DISABLE_ALL_RULE) return { problem: 'reserved' };
  if (/[\s,]/.test(rule)) return { problem: 'invalid' };
  if (!place) return null;
  if (place.rules.some((existing) => ruleKey(existing) === ruleKey(rule))) {
    return { problem: 'exists' };
  }
  if (!isPattern(rule)) {
    const pattern = place.rules.find(
      (existing) => isPattern(existing) && matchesExcludedRule(existing, rule)
    );
    if (pattern) return { problem: 'covered', pattern };
  }
  return null;
}

/** Whether a served route is one of a place's: a login of its type, or the key by its auth index. */
export function routeOfPlace(place: Place, route: ProvimuxModelRoute): boolean {
  if (place.kind === 'logins') {
    return route.kind === 'oauth' && normalizeOAuthProviderKey(route.provider) === place.type;
  }
  return route.auth_index !== null && place.entry.authIndexes.includes(route.auth_index);
}

/**
 * Who would still serve a model once a place excludes it: the served routes of the names it matches, less the
 * place's own; null when the routes are not known.
 */
export function stillServedWithout(
  place: Place,
  rule: string,
  routes: ProvimuxModelRoutesResponse | null
): ServingRoute[] | null {
  const served = servedMatching(rule, routes);
  return served ? served.filter(({ route }) => !routeOfPlace(place, route)) : null;
}

/** The places a new exclusion can go to: keys, and login types with a subscription (or a count unknown). */
export const placesToOffer = (places: readonly Place[]): Place[] =>
  places.filter((place) => place.kind === 'key' || place.loginCount !== 0);

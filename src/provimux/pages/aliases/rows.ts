/**
 * The configuration as entries and rows (design aliases-page.md, 2.2 and 2.3). Pure: a `GET /config`
 * document and the credentials list in, an `AliasState` out. The stored objects are kept as read, so the
 * writers (plan.ts) can change only the keys the page owns.
 */
import type { ProviderFamily } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import { hasDisableAllModelsRule } from '@/components/providers/utils';
import { maskApiKey } from '@/utils/format';
import { isRecord } from '@/utils/helpers';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import type { AuthFileItem, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import { serviceOf } from './collisions';
import type { AliasRow, AliasState, KeyEntry, LoginEntry } from './types';

/** The families in the order of design 1.2; the page lists API-key entries in this order. */
export const ALIAS_FAMILIES: readonly ProviderFamily[] = [
  'gemini',
  'interactions',
  'codex',
  'claude',
  'xai',
  'meta',
  'vertex',
  'openai-compatibility',
];

/** The login files a channel count needs: their type (or provider). */
export type AliasLoginFile = Pick<AuthFileItem, 'type' | 'provider'>;

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Lower-case host of a base URL, without port, path or user info; null when there is none. */
export function hostOf(baseUrl: string | null | undefined): string | null {
  const text = baseUrl?.trim();
  if (!text) return null;
  for (const candidate of [text, `https://${text}`]) {
    try {
      const host = new URL(candidate).hostname.toLowerCase();
      if (host) return host;
    } catch {
      // not a URL as written; try with a scheme
    }
  }
  return null;
}

/**
 * The auth index the proxy injects into a stored key or entry at read time: `auth_index` (what
 * Provimux writes), else `auth-index`. Not configuration: writes strip both.
 */
export function injectedIndexOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const field of ['auth_index', 'auth-index']) {
    const raw = value[field];
    const index = typeof raw === 'number' ? String(raw) : trimmed(raw);
    if (index) return index;
  }
  return null;
}

/**
 * 2.5: a family's list of groups as stored, or `[]` when absent or not a list. Groups the page cannot read
 * stay in it, in their place. Replaces upstream's `readProviderGroups`, which throws on them.
 */
export function familyGroups(document: unknown, family: ProviderFamily): unknown[] {
  const apiKeys = isRecord(document) ? document['api-keys'] : undefined;
  const groups = isRecord(apiKeys) ? apiKeys[family] : undefined;
  return Array.isArray(groups) ? groups : [];
}

/** 2.5: the stored login alias map, `{}` when absent or null; anything else as it is (not readable). */
export function loginMapIn(document: unknown): unknown {
  const oauth = isRecord(document) ? document.oauth : undefined;
  if (oauth === undefined || oauth === null) return {};
  if (!isRecord(oauth)) return oauth;
  const map = oauth['model-alias'];
  return map === undefined || map === null ? {} : map;
}

/**
 * 2.5, numbers: a parsed number the browser does not hold as written. An integer beyond ±(2^53 − 1)
 * parses to an integer-valued double of at least 2^53, and one too large for a double to Infinity.
 */
export const isInexactNumber = (value: unknown): boolean =>
  typeof value === 'number' &&
  (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)));

/** The paths of every inexact number in a value, walked once; `path` names the value itself. */
export function inexactNumbers(value: unknown, path: string): string[] {
  if (isInexactNumber(value)) return [path];
  if (Array.isArray(value)) {
    return value.flatMap((element, index) => inexactNumbers(element, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, element]) =>
      inexactNumbers(element, `${path}.${key}`)
    );
  }
  return [];
}

/**
 * 2.5: whether the login alias map can be written whole: a map, without a number the browser cannot
 * hold. When it cannot, every login entry is `unread` and nothing of the map is ever written.
 */
export function loginMapWritable(document: unknown): boolean {
  const map = loginMapIn(document);
  return isRecord(map) && inexactNumbers(map, 'oauth.model-alias').length === 0;
}

/** A list that is present and not null but not a list: not readable (2.5). */
const unreadableList = (value: unknown) =>
  value !== undefined && value !== null && !Array.isArray(value);

/**
 * 2.2 step 2: the effective model list of a key, the key's own when present and not null, else the
 * group's; for an OpenAI-compatible entry, the group's. `readable` is false when that list is present and
 * not a list (2.5): it then gives no rows.
 */
export function effectiveModels(
  group: Readonly<Record<string, unknown>>,
  keyIndex: number | null
): { list: readonly unknown[]; source: 'key' | 'group'; readable: boolean } {
  if (keyIndex !== null) {
    const keys = group.keys as unknown[];
    const key = keys[keyIndex];
    if (isRecord(key) && key.models !== undefined && key.models !== null) {
      const readable = Array.isArray(key.models);
      return { list: readable ? (key.models as unknown[]) : [], source: 'key', readable };
    }
  }
  const readable = !unreadableList(group.models);
  return {
    list: Array.isArray(group.models) ? group.models : [],
    source: 'group',
    readable,
  };
}

/** 2.2 step 3: an element of a model list is a row when it is an object with a non-empty trimmed name. */
export const isModelRow = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && trimmed(value.name) !== '';

const keyRow = (entryId: string, model: Record<string, unknown>, sourceIndex: number): AliasRow => {
  const upstream = trimmed(model.name);
  const alias = trimmed(model.alias);
  const forceMapping = model['force-mapping'];
  const displayName = model['display-name'];
  return {
    id: `${entryId}#${sourceIndex}`,
    entryId,
    store: 'api-key',
    sourceIndex,
    upstream,
    alias: alias && alias !== upstream ? alias : null,
    fork: null,
    forceMapping: typeof forceMapping === 'boolean' ? forceMapping : null,
    displayName: typeof displayName === 'string' ? displayName : null,
  };
};

/** 2.3 step 2: every object of a login channel's stored list is a row, the ignored kinds included. */
export const loginRow = (
  entryId: string,
  model: Record<string, unknown>,
  sourceIndex: number
): AliasRow => {
  const forceMapping = model['force-mapping'];
  return {
    id: `${entryId}#${sourceIndex}`,
    entryId,
    store: 'login',
    sourceIndex,
    upstream: trimmed(model.name),
    alias: trimmed(model.alias) || null,
    fork: model.fork === true,
    forceMapping: typeof forceMapping === 'boolean' ? forceMapping : null,
    displayName: trimmed(model['display-name']) || null,
  };
};

function readKeyEntries(document: unknown, family: ProviderFamily) {
  const entries: KeyEntry[] = [];
  const rows: AliasRow[] = [];
  const unread = new Set<string>();
  const path = `api-keys.${family}`;
  const apiKeys = isRecord(document) ? document['api-keys'] : undefined;
  if (isRecord(apiKeys) && unreadableList(apiKeys[family])) {
    unread.add(path);
    return { entries, rows, unread };
  }
  // 2.5, numbers: a family holding one gives no entries, so it is never written and never rounded.
  const inexact = inexactNumbers(familyGroups(document, family), path);
  if (inexact.length) return { entries, rows, unread: new Set(inexact) };
  const groups = familyGroups(document, family);
  const openai = family === 'openai-compatibility';
  let configs: ReturnType<typeof normalizeProviderGroups>;
  try {
    configs = normalizeProviderGroups(groups, family);
  } catch {
    // Upstream's normalizer could not read the family: the whole family is unread.
    unread.add(path);
    return { entries, rows, unread };
  }
  // Groups, keys and OpenAI-compatible entries the normalizer gives nothing for (2.5).
  const read = new Set(
    configs.map(
      (config) => `${config.source?.groupIndex}/${openai ? 'g' : config.source?.keyIndex}`
    )
  );
  groups.forEach((group, groupIndex) => {
    if (!isRecord(group) || !Array.isArray(group.keys)) unread.add(`${path}[${groupIndex}]`);
    else if (openai) {
      if (!read.has(`${groupIndex}/g`)) unread.add(`${path}[${groupIndex}]`);
    } else {
      group.keys.forEach((_key, keyIndex) => {
        if (!read.has(`${groupIndex}/${keyIndex}`)) {
          unread.add(`${path}[${groupIndex}].keys[${keyIndex}]`);
        }
      });
    }
  });
  for (const config of configs) {
    const source = config.source;
    if (!source) continue;
    const groupIndex = source.groupIndex;
    const keyIndex = openai ? null : (source.keyIndex ?? null);
    const storedGroup = groups[groupIndex] as Record<string, unknown>;
    const id = openai ? `${family}/${groupIndex}/g` : `${family}/${groupIndex}/${keyIndex}`;
    const effective = effectiveModels(storedGroup, keyIndex);
    const listPath =
      effective.source === 'key'
        ? `${path}[${groupIndex}].keys[${keyIndex}].models`
        : `${path}[${groupIndex}].models`;
    if (!effective.readable) unread.add(listPath);
    const entryRows = effective.list.flatMap((model, index) => {
      if (isModelRow(model)) return [keyRow(id, model, index)];
      unread.add(`${listPath}[${index}]`);
      return [];
    });
    const host = hostOf(config.baseUrl);
    const storedKeys = storedGroup.keys as unknown[];
    const authIndex = openai
      ? injectedIndexOf(storedGroup)
      : injectedIndexOf(storedKeys[keyIndex as number]);
    const keyIndexes = openai ? storedKeys.flatMap((key) => injectedIndexOf(key) ?? []) : [];
    const authIndexes = openai
      ? storedKeys.length
        ? keyIndexes
        : authIndex
          ? [authIndex]
          : []
      : authIndex
        ? [authIndex]
        : [];
    const openaiConfig = config as OpenAIProviderConfig;
    const keyConfig = config as ProviderKeyConfig;
    entries.push({
      store: 'api-key',
      id,
      family,
      groupIndex,
      keyIndex,
      groupName: openai
        ? openaiConfig.name
        : typeof storedGroup.name === 'string'
          ? storedGroup.name
          : null,
      keyPreview: openai ? null : maskApiKey(keyConfig.apiKey),
      keyCount: openai ? openaiConfig.apiKeyEntries.length : 1,
      authIndex,
      authIndexes,
      host,
      prefix: config.prefix ?? null,
      disabled: openai
        ? openaiConfig.disabled === true
        : hasDisableAllModelsRule(keyConfig.excludedModels),
      listSource: entryRows.length ? effective.source : 'none',
      service: serviceOf({ store: 'api-key', host, family }),
      storedGroup,
    });
    rows.push(...entryRows);
  }
  return { entries, rows, unread };
}

function readLoginEntries(document: unknown, files: readonly AliasLoginFile[] | null) {
  const unread = new Set<string>();
  const oauth = isRecord(document) ? document.oauth : undefined;
  const stored = loginMapIn(document);
  const inexact = isRecord(stored) ? inexactNumbers(stored, 'oauth.model-alias') : [];
  const mapReadable = isRecord(stored) && inexact.length === 0;
  if (!isRecord(stored)) unread.add(isRecord(oauth) ? 'oauth.model-alias' : 'oauth');
  // 2.5, numbers: the map is not shown, every login entry is unread, and the map is never written.
  for (const path of inexact) unread.add(path);
  const map = mapReadable ? stored : {};
  type Channel = { spellings: string[]; storedList: unknown[]; paths: string[]; unread: boolean };
  const channels = new Map<string, Channel>();
  const empty = (): Channel => ({ spellings: [], storedList: [], paths: [], unread: !mapReadable });
  for (const [spelling, list] of Object.entries(map)) {
    const channel = normalizeOAuthProviderKey(spelling);
    if (!channel) continue;
    const found = channels.get(channel) ?? empty();
    found.spellings.push(spelling);
    const path = `oauth.model-alias.${spelling}`;
    if (Array.isArray(list)) {
      list.forEach((_element, index) => found.paths.push(`${path}[${index}]`));
      found.storedList.push(...list);
    } else if (unreadableList(list)) {
      found.unread = true;
      unread.add(path);
    }
    channels.set(channel, found);
  }
  let counts: Map<string, number> | null = null;
  if (files) {
    counts = new Map();
    for (const file of files) {
      const channel = normalizeOAuthProviderKey(String(file.type ?? file.provider ?? ''));
      if (!channel) continue;
      counts.set(channel, (counts.get(channel) ?? 0) + 1);
      if (!channels.has(channel)) channels.set(channel, empty());
    }
  }
  const entries: LoginEntry[] = [];
  const rows: AliasRow[] = [];
  for (const channel of [...channels.keys()].sort()) {
    const { spellings, storedList, paths, unread: channelUnread } = channels.get(channel)!;
    const id = `login/${channel}`;
    entries.push({
      store: 'login',
      id,
      channel,
      spellings,
      loginCount: counts ? (counts.get(channel) ?? 0) : null,
      service: serviceOf({ store: 'login', channel }),
      storedList,
      unread: channelUnread,
    });
    storedList.forEach((model, index) => {
      if (isRecord(model)) rows.push(loginRow(id, model, index));
      else unread.add(paths[index]);
    });
  }
  return { entries, rows, unread };
}

/**
 * The entries and rows of a `GET /config` document, which the state keeps as read (a save builds its
 * bodies from it, 3.4). `files` is the credentials list, or null when it could not be read (login counts
 * are then null). The ETag is the caller's (`aliasesApi.load`). Never throws on the document's shape:
 * what it cannot read is named in `unread` (2.5).
 */
export function readAliasState(
  document: unknown,
  files: readonly AliasLoginFile[] | null
): AliasState {
  const keyParts = ALIAS_FAMILIES.map((family) => readKeyEntries(document, family));
  const login = readLoginEntries(document, files);
  const routing = isRecord(document) ? document.routing : undefined;
  const apiKeys = isRecord(document) ? document['api-keys'] : undefined;
  const unread = [
    ...(apiKeys !== undefined && apiKeys !== null && !isRecord(apiKeys) ? ['api-keys'] : []),
    ...keyParts.flatMap((part) => [...part.unread]),
    ...login.unread,
  ];
  return {
    entries: [...keyParts.flatMap((part) => part.entries), ...login.entries],
    rows: [...keyParts.flatMap((part) => part.rows), ...login.rows],
    forceModelPrefix: isRecord(routing) && routing['force-model-prefix'] === true,
    document,
    etag: null,
    unread,
  };
}

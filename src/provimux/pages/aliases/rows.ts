/**
 * The configuration as entries and rows (design aliases-page.md, 2.2 and 2.3). Pure: a `GET /config`
 * document and the credentials list in, an `AliasState` out. The stored objects are kept as read, so the
 * writers (plan.ts) can change only the keys the page owns.
 */
import { readProviderGroups, type ProviderFamily } from '@/services/api/providers';
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
 * 2.2 step 2: the effective model list of a key, the key's own when present and not null, else the
 * group's; for an OpenAI-compatible entry, the group's.
 */
export function effectiveModels(
  group: Readonly<Record<string, unknown>>,
  keyIndex: number | null
): { list: readonly unknown[]; source: 'key' | 'group' } {
  if (keyIndex !== null) {
    const keys = group.keys as unknown[];
    const key = keys[keyIndex];
    if (isRecord(key) && key.models !== undefined && key.models !== null) {
      return { list: Array.isArray(key.models) ? key.models : [], source: 'key' };
    }
  }
  return { list: Array.isArray(group.models) ? group.models : [], source: 'group' };
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
  const groups = readProviderGroups(document, family);
  const openai = family === 'openai-compatibility';
  for (const config of normalizeProviderGroups(groups, openai)) {
    const source = config.source;
    if (!source) continue;
    const groupIndex = source.groupIndex;
    const keyIndex = openai ? null : (source.keyIndex ?? null);
    const storedGroup = groups[groupIndex];
    const id = openai ? `${family}/${groupIndex}/g` : `${family}/${groupIndex}/${keyIndex}`;
    const effective = effectiveModels(storedGroup, keyIndex);
    const entryRows = effective.list.flatMap((model, index) =>
      isModelRow(model) ? [keyRow(id, model, index)] : []
    );
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
  return { entries, rows };
}

function readLoginEntries(document: unknown, files: readonly AliasLoginFile[] | null) {
  const oauth = isRecord(document) ? document.oauth : undefined;
  const map = isRecord(oauth) && isRecord(oauth['model-alias']) ? oauth['model-alias'] : {};
  const channels = new Map<string, { spellings: string[]; storedList: unknown[] }>();
  for (const [spelling, list] of Object.entries(map)) {
    const channel = normalizeOAuthProviderKey(spelling);
    if (!channel) continue;
    const found = channels.get(channel) ?? { spellings: [], storedList: [] };
    found.spellings.push(spelling);
    if (Array.isArray(list)) found.storedList.push(...list);
    channels.set(channel, found);
  }
  let counts: Map<string, number> | null = null;
  if (files) {
    counts = new Map();
    for (const file of files) {
      const channel = normalizeOAuthProviderKey(String(file.type ?? file.provider ?? ''));
      if (!channel) continue;
      counts.set(channel, (counts.get(channel) ?? 0) + 1);
      if (!channels.has(channel)) channels.set(channel, { spellings: [], storedList: [] });
    }
  }
  const entries: LoginEntry[] = [];
  const rows: AliasRow[] = [];
  for (const channel of [...channels.keys()].sort()) {
    const { spellings, storedList } = channels.get(channel)!;
    const id = `login/${channel}`;
    entries.push({
      store: 'login',
      id,
      channel,
      spellings,
      loginCount: counts ? (counts.get(channel) ?? 0) : null,
      service: serviceOf({ store: 'login', channel }),
      storedList,
    });
    storedList.forEach((model, index) => {
      if (isRecord(model)) rows.push(loginRow(id, model, index));
    });
  }
  return { entries, rows };
}

/**
 * The entries and rows of a `GET /config` document. `files` is the credentials list, or null when it
 * could not be read (login counts are then null). The ETag is the caller's (`aliasesApi.load`).
 */
export function readAliasState(
  document: unknown,
  files: readonly AliasLoginFile[] | null
): AliasState {
  const keyParts = ALIAS_FAMILIES.map((family) => readKeyEntries(document, family));
  const login = readLoginEntries(document, files);
  const routing = isRecord(document) ? document.routing : undefined;
  return {
    entries: [...keyParts.flatMap((part) => part.entries), ...login.entries],
    rows: [...keyParts.flatMap((part) => part.rows), ...login.rows],
    forceModelPrefix: isRecord(routing) && routing['force-model-prefix'] === true,
    etag: null,
  };
}

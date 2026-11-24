/**
 * An API key's settings on Accounts (design accounts-page.md, section 7): the same form model, readers and
 * writers AI Providers uses, put together for one account. A native key is a member of a connection (a
 * group of `api-keys.<family>`): its address, proxy, prefix, headers, models and exclusions are the
 * connection's unless the key sets its own, as AI Providers reads them; a save is AI Providers' own
 * `saveNativeConnection` with every other key of the connection left as it is. An OpenAI-compatible entry
 * is one account, saved with AI Providers' `createOpenAIProvider` / `updateOpenAIProvider`. Pure: the page
 * makes the requests.
 */
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import { isRecord } from '@/utils/helpers';
import { normalizeConfigResponse } from '@/services/api/transformers';
import type { NativeProviderFamily, ProviderFamily } from '@/services/api/providers';
import type { OpenAIProviderConfig, ProviderKeyConfig, ProviderSource } from '@/types';
import { PROVIDER_DESCRIPTORS } from '@/features/providers/descriptors';
import { validateModelOptions } from '@/features/providers/modelOptions';
import {
  buildSharedSettings,
  memberFields,
  readMemberForm,
  readSharedForm,
} from '@/features/providers/nativeConnectionForm';
import { validateRuntimePolicy } from '@/features/providers/runtimePolicy';
import { buildInitialForm } from '@/features/providers/sheets/forms/BaseProviderForm';
import type {
  NativeSection,
  ProviderBrand,
  ProviderEntryFormInput,
  ProviderResource,
} from '@/features/providers/types';
import {
  buildNativeConnectionMembers,
  buildOpenAIConfig,
  buildProviderGroups,
} from '@/features/providers/useProviderWorkbench';
import { validateConnectionPool } from '@/features/providers/validateConnectionPool';
import type { MemberField } from '@/services/api/nativeProviderGroups';
import { familyGroups } from '../aliases/rows';
import type { KeyEntry } from '../aliases/types';

export type Form = ProviderEntryFormInput;

export const brandOf = (family: ProviderFamily): ProviderBrand =>
  family === 'openai-compatibility' ? 'openaiCompatibility' : family;

/** The connection and key AI Providers shows for an account's key; null when it has none (a partner's). */
export type LocatedKey =
  | {
      kind: 'native';
      family: NativeProviderFamily;
      section: NativeSection;
      resource: ProviderResource;
    }
  | { kind: 'compatible'; resource: ProviderResource };

const sourceOf = (resource: ProviderResource): ProviderSource | undefined =>
  (resource.raw as { source?: ProviderSource } | undefined)?.source;

/** Finds a key as AI Providers lists it, in the configuration Accounts read. */
export function locateKey(
  document: unknown,
  entry: Pick<KeyEntry, 'family' | 'groupIndex' | 'keyIndex'>
): LocatedKey | null {
  const groups = buildProviderGroups(normalizeConfigResponse(document));
  const group = groups.find((item) => item.id === brandOf(entry.family));
  if (!group) return null;
  if (entry.family === 'openai-compatibility') {
    const resource = group.resources.find(
      (item) => sourceOf(item)?.groupIndex === entry.groupIndex
    );
    return resource ? { kind: 'compatible', resource } : null;
  }
  const section = group.nativeSections?.find((item) => item.source.groupIndex === entry.groupIndex);
  const resource = section?.members.find(
    (item) => sourceOf(item)?.keyIndex === entry.keyIndex
  );
  return section && resource
    ? { kind: 'native', family: entry.family as NativeProviderFamily, section, resource }
    : null;
}

export interface NativeDraft {
  kind: 'native';
  family: NativeProviderFamily;
  /** The key's connection and the key; null while adding. */
  located: { section: NativeSection; resource: ProviderResource } | null;
  /** The connection's name (`claude-2`). */
  groupName: string;
  /** The other keys of its connection: a shared setting changes for them too. */
  siblings: number;
  sharedInitial: Form;
  shared: Form;
  memberInitial: Form;
  member: Form;
}

export interface CompatibleDraft {
  kind: 'compatible';
  /** The entry; null while adding a new one. */
  resource: ProviderResource | null;
  initial: Form;
  form: Form;
}

export type KeyDraft = NativeDraft | CompatibleDraft;

/** A name not taken in the family: `base`, else `base-2`, `base-3`… (Accounts' and AI Providers' rule). */
export function freeGroupName(document: unknown, family: ProviderFamily, base?: string): string {
  const groups = familyGroups(document, family);
  const names = new Set(groups.map((g) => (isRecord(g) ? String(g.name ?? '').trim() : '')));
  if (base) {
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }
  let n = groups.length + 1;
  while (names.has(`${family}-${n}`)) n += 1;
  return `${family}-${n}`;
}

/** A new key in a connection of its own, as AI Providers' "add" makes it. */
export function newNativeDraft(
  document: unknown,
  family: NativeProviderFamily,
  baseUrl: string | null
): NativeDraft {
  const defaults = buildInitialForm(family, null, 'create');
  const shared: Form = {
    ...readSharedForm({}, defaults),
    name: freeGroupName(document, family),
    baseUrl: baseUrl ?? defaults.baseUrl,
  };
  const member = readMemberForm(buildInitialForm(family, null, 'create'), null);
  return {
    kind: 'native',
    family,
    located: null,
    groupName: shared.name,
    siblings: 0,
    sharedInitial: shared,
    shared,
    memberInitial: member,
    member,
  };
}

export function nativeDraftOf(located: Extract<LocatedKey, { kind: 'native' }>): NativeDraft {
  const { family, section, resource } = located;
  const shared = readSharedForm(section.source.group, buildInitialForm(family, null, 'create'));
  const member = readMemberForm(buildInitialForm(family, resource, 'edit'), resource);
  return {
    kind: 'native',
    family,
    located: { section, resource },
    groupName: section.name,
    siblings: Math.max(0, section.keyCount - 1),
    sharedInitial: shared,
    shared,
    memberInitial: member,
    member,
  };
}

/** A new OpenAI-compatible entry with one key. */
export function newCompatibleDraft(name: string, baseUrl: string): CompatibleDraft {
  const initial = { ...buildInitialForm('openaiCompatibility', null, 'create'), name, baseUrl };
  return { kind: 'compatible', resource: null, initial, form: initial };
}

export function compatibleDraftOf(resource: ProviderResource): CompatibleDraft {
  const initial = buildInitialForm('openaiCompatibility', resource, 'edit');
  return { kind: 'compatible', resource, initial, form: initial };
}

export function draftOf(located: LocatedKey): KeyDraft {
  return located.kind === 'native' ? nativeDraftOf(located) : compatibleDraftOf(located.resource);
}

// --- one field, wherever it is stored ---------------------------------------------------------------------

/** Fields a key can set for itself or take from its connection (AI Providers' member fields). */
export type BothField = MemberField;
export const BOTH_FIELDS: readonly BothField[] = memberFields;

/** Where a field the owner edits is stored: the key's own value, or its connection's. */
export function ownerOf(draft: NativeDraft, field: BothField): 'member' | 'shared' {
  const mode = draft.member.memberModes?.[field];
  return mode && mode !== 'inherit' ? 'member' : 'shared';
}

/** True when a change to this field changes the other keys of the connection too. */
export function sharedWithOthers(draft: KeyDraft, field: BothField | 'baseUrl'): boolean {
  if (draft.kind !== 'native' || draft.siblings === 0) return false;
  return field === 'baseUrl' || ownerOf(draft, field) === 'shared';
}

/** The value the account uses for a field. */
export function valueOf<K extends BothField>(draft: KeyDraft, field: K): Form[K] {
  if (draft.kind === 'compatible') return draft.form[field];
  return ownerOf(draft, field) === 'member' ? draft.member[field] : draft.shared[field];
}

/** A field changed where it is stored; a key's explicit "none" becomes its own value. */
export function withValue<K extends BothField>(draft: KeyDraft, field: K, value: Form[K]): KeyDraft {
  if (draft.kind === 'compatible') return { ...draft, form: { ...draft.form, [field]: value } };
  if (ownerOf(draft, field) === 'shared') {
    return { ...draft, shared: { ...draft.shared, [field]: value } };
  }
  const modes = draft.member.memberModes;
  return {
    ...draft,
    member: {
      ...draft.member,
      [field]: value,
      ...(modes ? { memberModes: { ...modes, [field]: 'override' } } : {}),
    },
  };
}

/** The connection's fields (address, connection pool, retries and cooldowns). */
export function withShared(draft: KeyDraft, patch: Partial<Form>): KeyDraft {
  return draft.kind === 'compatible'
    ? { ...draft, form: { ...draft.form, ...patch } }
    : { ...draft, shared: { ...draft.shared, ...patch } };
}

/** The key's own fields (the key, weight, WebSockets, cloaking, behaviour). */
export function withMember(draft: KeyDraft, patch: Partial<Form>): KeyDraft {
  return draft.kind === 'compatible'
    ? { ...draft, form: { ...draft.form, ...patch } }
    : { ...draft, member: { ...draft.member, ...patch } };
}

export const sharedForm = (draft: KeyDraft): Form =>
  draft.kind === 'compatible' ? draft.form : draft.shared;
export const memberForm = (draft: KeyDraft): Form =>
  draft.kind === 'compatible' ? draft.form : draft.member;

const same = (a: Form, b: Form) =>
  a === b || JSON.stringify({ ...a, testModel: '' }) === JSON.stringify({ ...b, testModel: '' });

/** Anything changed besides the key itself (and, for a new entry, its name and address). */
export function settingsTouched(draft: KeyDraft): boolean {
  if (draft.kind === 'compatible') {
    const strip = (form: Form) => ({
      ...form,
      name: '',
      baseUrl: '',
      apiKeyEntries: (form.apiKeyEntries ?? []).map((entry) => ({ ...entry, apiKey: '' })),
    });
    return !same(strip(draft.form), strip(draft.initial));
  }
  return (
    !same(draft.shared, draft.sharedInitial) ||
    !same({ ...draft.member, apiKey: '' }, { ...draft.memberInitial, apiKey: '' })
  );
}

export function draftChanged(draft: KeyDraft): boolean {
  return draft.kind === 'compatible'
    ? !same(draft.form, draft.initial)
    : !same(draft.shared, draft.sharedInitial) || !same(draft.member, draft.memberInitial);
}

// --- checks ------------------------------------------------------------------------------------------------

/** The first problem, as an i18n key with its values; null when the draft can be saved. */
export function draftProblem(draft: KeyDraft): { key: string; values?: Record<string, unknown> } | null {
  const brand = draft.kind === 'compatible' ? 'openaiCompatibility' : draft.family;
  const descriptor = PROVIDER_DESCRIPTORS[brand];
  const shared = sharedForm(draft);
  const member = memberForm(draft);
  const initialShared = draft.kind === 'compatible' ? draft.initial : draft.sharedInitial;
  const pool = validateConnectionPool(shared.connectionPool, initialShared.connectionPool);
  if (pool) return { key: pool };
  for (const models of [shared.models, member.models]) {
    const issue = validateModelOptions(models);
    if (issue) return { key: issue };
  }
  if (shared.runtimePolicy) {
    const issue = validateRuntimePolicy(shared.runtimePolicy, descriptor.supportsRequestScopedErrors);
    if (issue) return { key: issue };
  }
  if (descriptor.supportsName && !shared.name.trim()) {
    return { key: 'providersPage.form.validation.nameRequired' };
  }
  if (descriptor.baseUrlRequired && !shared.baseUrl.trim()) {
    return { key: 'providersPage.form.validation.baseUrlRequired' };
  }
  const weights =
    draft.kind === 'compatible'
      ? (draft.form.apiKeyEntries ?? []).map((entry) => entry.weight)
      : [draft.member.weight];
  if (weights.some((weight) => weight !== undefined && !Number.isSafeInteger(weight))) {
    return { key: 'providersPage.form.validation.weightInteger' };
  }
  if (weights.some((weight) => weight !== undefined && weight > MAX_CREDENTIAL_WEIGHT)) {
    return { key: 'providersPage.form.validation.weightMax', values: { max: MAX_CREDENTIAL_WEIGHT } };
  }
  return null;
}

// --- what a save writes ------------------------------------------------------------------------------------

/**
 * The arguments of AI Providers' `providersApi.saveNativeConnection` for this key: the connection's settings
 * as AI Providers' connection form builds them, this key as its key row builds it, every other key of the
 * connection unchanged.
 */
export function nativeSave(draft: NativeDraft) {
  const group = draft.located?.section.source.group ?? {};
  const settings = buildSharedSettings(draft.family, group, draft.sharedInitial, draft.shared);
  const ours = {
    resource: draft.located?.resource ?? null,
    input: draft.member,
    initialInput: draft.memberInitial,
    unchanged: draft.located ? same(draft.member, draft.memberInitial) : false,
    disabled: draft.located ? undefined : false,
  };
  const rows = draft.located
    ? draft.located.section.members.map((resource) =>
        resource === draft.located!.resource
          ? ours
          : { resource, input: draft.member, unchanged: true }
      )
    : [ours];
  return {
    source: draft.located?.section.source,
    settings,
    members: buildNativeConnectionMembers(draft.family, draft.located?.section, rows),
  };
}

/** AI Providers' OpenAI-compatible entry for this draft (with the entry's stored fields kept). */
export function compatibleConfig(draft: CompatibleDraft): OpenAIProviderConfig {
  return buildOpenAIConfig(
    draft.form,
    draft.resource ? (draft.resource.raw as OpenAIProviderConfig) : null
  );
}

// --- a short account of what is set, for the panel ---------------------------------------------------------

export interface SettingsSummary {
  baseUrl: string | null;
  proxy: boolean;
  prefix: string | null;
  models: number;
  excluded: number;
  headers: number;
  weight: number | null;
}

const filled = (rows: Array<{ key: string }>) => rows.filter((row) => row.key.trim()).length;

export function summaryOf(draft: KeyDraft): SettingsSummary {
  const shared = sharedForm(draft);
  const member = memberForm(draft);
  const proxy =
    draft.kind === 'compatible'
      ? (draft.form.apiKeyEntries ?? []).some((entry) => entry.proxyUrl.trim())
      : valueOf(draft, 'proxyUrl').trim() !== '';
  const excludedText = draft.kind === 'compatible' ? '' : valueOf(draft, 'excludedModelsText');
  const weight =
    draft.kind === 'compatible' ? (draft.form.apiKeyEntries?.[0]?.weight ?? null) : member.weight;
  return {
    baseUrl: shared.baseUrl.trim() || null,
    proxy,
    prefix: valueOf(draft, 'prefix').trim() || null,
    models: valueOf(draft, 'models').filter((model) => model.name.trim()).length,
    excluded: excludedText.split('\n').filter((rule) => rule.trim()).length,
    headers: filled(valueOf(draft, 'headers')),
    weight: weight ?? null,
  };
}

/** The key a native draft holds (new), else the stored one (for listing models with it). */
export function probeKeyOf(draft: KeyDraft): string {
  if (draft.kind === 'compatible') {
    const entry = draft.form.apiKeyEntries?.[0];
    return entry?.apiKey.trim() || entry?.existingApiKey?.trim() || '';
  }
  return (
    draft.member.apiKey.trim() ||
    (draft.located?.resource.raw as ProviderKeyConfig | undefined)?.apiKey ||
    ''
  );
}

// --- the add sheet's key form ------------------------------------------------------------------------------

const hostIn = (url: string | null | undefined): string | null => {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * The OpenAI-compatible entry a new key on this address joins (OpenRouter's), as AI Providers lists it,
 * with a row for the new key at the end; null when none is there yet.
 */
export function joiningDraft(document: unknown, baseUrl: string): CompatibleDraft | null {
  const host = hostIn(baseUrl);
  if (!host) return null;
  const groups = buildProviderGroups(normalizeConfigResponse(document));
  const resource = groups
    .find((group) => group.id === 'openaiCompatibility')
    ?.resources.find((item) => hostIn((item.raw as OpenAIProviderConfig).baseUrl) === host);
  if (!resource) return null;
  const stored = compatibleDraftOf(resource);
  const initial: Form = {
    ...stored.initial,
    apiKeyEntries: [...(stored.initial.apiKeyEntries ?? []), { apiKey: '', proxyUrl: '' }],
  };
  return { kind: 'compatible', resource, initial, form: initial };
}

/** The same settings for the other Google API (Gemini ⇄ Interactions), in a connection of its own. */
export function retargeted(
  document: unknown,
  draft: NativeDraft,
  family: NativeProviderFamily
): NativeDraft {
  const fresh = newNativeDraft(document, family, null);
  return {
    ...fresh,
    shared: { ...draft.shared, name: fresh.shared.name },
    member: draft.member,
  };
}

/** The draft with what the simple form holds: the key, and a new entry's name and address. */
export function withTyped(
  draft: KeyDraft,
  typed: { apiKey: string; name?: string; baseUrl?: string }
): KeyDraft {
  const key = typed.apiKey.trim();
  if (draft.kind === 'native') return { ...draft, member: { ...draft.member, apiKey: key } };
  const entries = [...(draft.form.apiKeyEntries ?? [])];
  const last = entries.length ? entries.length - 1 : 0;
  entries[last] = { ...(entries[last] ?? { proxyUrl: '' }), apiKey: key };
  return {
    ...draft,
    form: {
      ...draft.form,
      apiKeyEntries: entries,
      ...(draft.resource ? {} : { name: (typed.name ?? '').trim(), baseUrl: (typed.baseUrl ?? '').trim() }),
    },
  };
}

/**
 * "Serve only my names" (design models-page.md 8; the gateway's only-my-names.md): the setting as the page reads
 * it from its one read of the configuration, the whole object each write sends, and what the switch, its preview,
 * "Not served" and the refused strip show. Pure.
 *
 * A name is his when an alias row gives it, when `models.only-my-names.keep` lists it (a model kept under its
 * vendor's name), or when an alias in a login's own file gives it (only the gateway can see that one). With the
 * switch on, every other name is refused. The gateway's status endpoint, `GET /provimux/names`, lists both sides;
 * the page joins it with the 30-day usage it already reads.
 */
import { isRecord } from '@/utils/helpers';
import type {
  ProvimuxModelRoutesResponse,
  ProvimuxNameAccount,
  ProvimuxNamesResponse,
  ProvimuxRefusedName,
} from '../../api/types';
import { nameKey } from '../aliases/collisions';
import { inexactNumbers } from '../aliases/rows';
import type { AliasDraft, AliasEntry } from '../aliases/types';
import { accessOf, compatibleEntryOf, type Access } from '../modelRoutes/logic';
import { entryOfRoute, lineProviderKeys, type ModelsFilter, type SetNames } from './catalog';

/** The config API's path for the setting: written whole, with `If-Match` (only-my-names.md 4). */
export const ONLY_MY_NAMES_PATH = '/config/models/only-my-names';

// --- the setting, as read --------------------------------------------------------------------------------

export interface OnlyMyNamesSetting {
  /** `models.only-my-names` as read; null when the file does not set it (off). */
  stored: Readonly<Record<string, unknown>> | null;
  enabled: boolean;
  /** `keep` as stored, every element in order: a write changes only what it means to. */
  keepStored: readonly unknown[];
  /** The names `keep` serves by: its strings, trimmed, without empty entries and patterns. */
  keep: string[];
  /**
   * The setting cannot be written whole (aliases-page.md 2.5): `models` or the setting is not a map, `keep` is
   * not a list, or it holds a number the browser cannot hold exactly. Nothing is written then.
   */
  unreadable: boolean;
}

/** A `keep` entry the gateway serves by: a string with something in it and no `*` (no wildcards, decision 4). */
export const keepable = (entry: unknown): entry is string =>
  typeof entry === 'string' && entry.trim() !== '' && !entry.includes('*');

export function readSetting(document: unknown): OnlyMyNamesSetting {
  const off: OnlyMyNamesSetting = {
    stored: null,
    enabled: false,
    keepStored: [],
    keep: [],
    unreadable: false,
  };
  const models = isRecord(document) ? document.models : undefined;
  if (models === undefined || models === null) return off;
  if (!isRecord(models)) return { ...off, unreadable: true };
  const stored = models['only-my-names'];
  if (stored === undefined || stored === null) return off;
  if (!isRecord(stored)) return { ...off, unreadable: true };
  const keep = stored.keep;
  const keepStored = Array.isArray(keep) ? keep : [];
  return {
    stored,
    enabled: stored.enabled === true,
    keepStored,
    keep: keepStored.filter(keepable).map((entry) => entry.trim()),
    unreadable:
      (keep !== undefined && keep !== null && !Array.isArray(keep)) ||
      inexactNumbers(stored, 'models.only-my-names').length > 0,
  };
}

/** The whole object a write sends: what the file holds, with `enabled` and `keep` set. Other fields stay. */
const bodyOf = (
  setting: OnlyMyNamesSetting,
  enabled: boolean,
  keep: readonly unknown[]
): Record<string, unknown> => ({ ...(setting.stored ?? {}), enabled, keep: [...keep] });

/** Keep: the names added at the end of `keep`, each once (case does not matter); the switch as it is. */
export function keepBody(setting: OnlyMyNamesSetting, names: readonly string[]) {
  const have = new Set(setting.keep.map(nameKey));
  const added: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!keepable(name) || have.has(nameKey(name))) continue;
    have.add(nameKey(name));
    added.push(name);
  }
  return bodyOf(setting, setting.enabled, [...setting.keepStored, ...added]);
}

/** Stop keeping: every spelling of the name taken out of `keep`; the rest, patterns included, stays. */
export const unkeepBody = (setting: OnlyMyNamesSetting, name: string) =>
  bodyOf(
    setting,
    setting.enabled,
    setting.keepStored.filter(
      (entry) => !(typeof entry === 'string' && nameKey(entry) === nameKey(name))
    )
  );

/** The switch, `keep` as it is. */
export const switchBody = (setting: OnlyMyNamesSetting, enabled: boolean) =>
  bodyOf(setting, enabled, setting.keepStored);

/** The entries the gateway ignores (a pattern, an empty one), taken out of `keep`. */
export const dropIgnoredBody = (setting: OnlyMyNamesSetting, values: readonly string[]) =>
  bodyOf(
    setting,
    setting.enabled,
    setting.keepStored.filter((entry) => !(typeof entry === 'string' && values.includes(entry)))
  );

// --- whose names ----------------------------------------------------------------------------------------

/**
 * The names the gateway counts as his besides alias rows, for the list: `keep` of the page's read (written by
 * this page a moment ago, before the gateway's answer has caught up), and the gateway's login-file names.
 */
export function setNamesOf(
  answer: ProvimuxNamesResponse | null,
  setting: OnlyMyNamesSetting
): SetNames {
  const spelled = new Map<string, string>();
  const kept = new Set<string>();
  const loginFile = new Set<string>();
  for (const name of setting.keep) {
    kept.add(nameKey(name));
    if (!spelled.has(nameKey(name))) spelled.set(nameKey(name), name);
  }
  for (const own of answer?.names ?? []) {
    if (!own.set_by.includes('login-file')) continue;
    loginFile.add(nameKey(own.name));
    if (!spelled.has(nameKey(own.name))) spelled.set(nameKey(own.name), own.name);
  }
  return { kept, loginFile, spelled };
}

/** His names, by key: the gateway's list and the read's `keep` (which a write just changed). */
export function yourNameKeys(
  answer: ProvimuxNamesResponse | null,
  setting: OnlyMyNamesSetting
): Set<string> {
  const keys = new Set((answer?.names ?? []).map((own) => nameKey(own.name)));
  // A name taken out of keep a moment ago: the gateway's answer may still list it as kept.
  for (const own of answer?.names ?? []) {
    if (
      own.set_by.length === 1 &&
      own.set_by[0] === 'keep' &&
      !setting.keep.some((k) => nameKey(k) === nameKey(own.name))
    ) {
      keys.delete(nameKey(own.name));
    }
  }
  for (const name of setting.keep) keys.add(nameKey(name));
  return keys;
}

// --- what is not his --------------------------------------------------------------------------------------

/** A name that is not his: served while the switch is off, refused while it is on. */
export interface OtherItem {
  key: string;
  name: string;
  /** Requests in the last 30 days; null when the usage is not known. */
  requests: number | null;
  /** Who serves it while the switch is off, and would serve it once kept; highest priority first. */
  accounts: ProvimuxNameAccount[];
}

/** Used names first, most used first; then by name. */
export const byUse = (a: OtherItem, b: OtherItem) =>
  (b.requests ?? 0) - (a.requests ?? 0) || a.name.localeCompare(b.name);

/** Every name an account offers that is not his, used ones first (the preview's and "Not served"'s order). */
export function othersOf(
  answer: ProvimuxNamesResponse | null,
  yours: ReadonlySet<string>,
  usage: Readonly<Record<string, number>> | null
): OtherItem[] {
  return (answer?.others ?? [])
    .filter((other) => !yours.has(nameKey(other.name)))
    .map((other) => ({
      key: nameKey(other.name),
      name: other.name,
      requests: usage ? (usage[nameKey(other.name)] ?? 0) : null,
      accounts: other.accounts,
    }))
    .sort(byUse);
}

/**
 * Names the gateway serves (or, switched off, would go on serving) that are neither his nor among `others`: an
 * account's prefixed copy of one of his names (`team/glm-5` when `glm-5` is his; the gateway's only-my-names.md
 * 3.3 serves it and lists it in neither `names` nor `others`). A name the routes list and the status endpoint does
 * not call another's is served, so it is never "Not served", and it counts among what is served. Keys.
 */
export function servedCopiesOf(
  routes: ProvimuxModelRoutesResponse | null,
  answer: ProvimuxNamesResponse | null,
  yours: ReadonlySet<string>
): Set<string> {
  const copies = new Set<string>();
  if (!routes || !answer) return copies;
  const others = new Set(answer.others.map((other) => nameKey(other.name)));
  for (const model of routes.models) {
    const key = nameKey(model.id);
    if (!yours.has(key) && !others.has(key)) copies.add(key);
  }
  return copies;
}

export interface Preview {
  /** The names that stop being served once the switch is on: used ones first. */
  stop: OtherItem[];
  /** Of them, the ones used in the last 30 days (most used first). */
  used: OtherItem[];
  /** The rest, by name. */
  unused: OtherItem[];
  /** How many names stay served: his. */
  served: number;
}

export function previewOf(others: readonly OtherItem[], served: number): Preview {
  const used = others.filter((other) => (other.requests ?? 0) > 0);
  const unused = others.filter((other) => !((other.requests ?? 0) > 0));
  return { stop: [...used, ...unused], used, unused, served };
}

/**
 * The 30-day usage behind the order: not read yet, unknown when the read failed, partial when the gateway folded
 * rows (the order by use is then not known for the folded names).
 */
export type UsageState = 'loading' | 'known' | 'unknown' | 'partial';

/** The usage state of a savings answer grouped by model. */
export function usageStateOf(
  answer: {
    breakdowns: ReadonlyArray<{
      by: readonly string[];
      rows: ReadonlyArray<{ model?: string }>;
      truncated: boolean;
    }>;
  } | null,
  failed: boolean
): UsageState {
  if (!answer) return failed ? 'unknown' : 'loading';
  const breakdown = answer.breakdowns.find((b) => b.by.length === 1 && b.by[0] === 'model');
  if (!breakdown) return 'unknown';
  return breakdown.truncated || breakdown.rows.some((row) => row.model === '~other')
    ? 'partial'
    : 'known';
}

/** A not-served name passes the page's search and "Served by" filter (by its accounts). */
export function otherMatches(
  item: OtherItem,
  filter: Pick<ModelsFilter, 'query' | 'provider'>,
  entries: readonly AliasEntry[]
): boolean {
  if (filter.provider !== 'all') {
    const keys = item.accounts.flatMap((account) =>
      lineProviderKeys(
        {
          provider: account.provider,
          access: accessOf(account.kind),
          entryId: entryOfRoute(account, entries)?.id ?? null,
          authIndex: account.auth_index,
          host: account.host,
        },
        entries
      )
    );
    if (!keys.includes(filter.provider)) return false;
  }
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [
    item.name,
    ...item.accounts.flatMap((account) => [
      account.provider,
      account.host,
      account.login.email,
      account.login.label,
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * Accounts of one kind and service, counted as Accounts counts them: "Claude subscription ×2" for two logins; an
 * OpenAI-compatible entry is one account whatever its number of keys ("OpenRouter").
 */
export interface AccountGroup {
  access: Access;
  provider: string;
  host: string | null;
  count: number;
}

/** A name's accounts grouped by service and kind, in their order (highest priority first). */
export function accountGroups(accounts: readonly ProvimuxNameAccount[]): AccountGroup[] {
  const groups: AccountGroup[] = [];
  for (const account of accounts) {
    const access = accessOf(account.kind);
    const found = groups.find(
      (group) =>
        group.access === access &&
        group.provider === account.provider &&
        group.host === account.host
    );
    if (found) {
      if (!compatibleEntryOf(account.provider)) found.count += 1;
    } else groups.push({ access, provider: account.provider, host: account.host, count: 1 });
  }
  return groups;
}

/** The refused names that are still not his (one kept a moment ago leaves the strip at once). */
export const refusedOf = (
  answer: ProvimuxNamesResponse | null,
  yours: ReadonlySet<string>
): ProvimuxRefusedName[] =>
  (answer?.refused?.names ?? []).filter((refused) => !yours.has(nameKey(refused.name)));

// --- the switch and the save ---------------------------------------------------------------------------

/** Where the switch stands: it does not apply (Home), it is off, or it is on. */
export function switchState(answer: ProvimuxNamesResponse): 'not-applied' | 'on' | 'off' {
  if (!answer.only_my_names.applies || answer.only_my_names.not_applied !== null) {
    return 'not-applied';
  }
  return answer.only_my_names.enabled ? 'on' : 'off';
}

/**
 * The names a save of the draft stops serving while the switch is on: names an alias row of the read gives and no
 * alias row of the draft does, unless `keep` or a login's own file also makes them his.
 */
export function droppedBySave(draft: AliasDraft, setNames: SetNames): string[] {
  const aliasNames = (rows: AliasDraft['rows']) => {
    const names = new Map<string, string>();
    for (const row of rows) {
      const alias = row.alias?.trim();
      if (alias && !names.has(nameKey(alias))) names.set(nameKey(alias), alias);
    }
    return names;
  };
  const before = aliasNames(draft.base.rows);
  const after = aliasNames(draft.rows);
  return [...before.entries()]
    .filter(([key]) => !after.has(key) && !setNames.kept.has(key) && !setNames.loginFile.has(key))
    .map(([, name]) => name);
}

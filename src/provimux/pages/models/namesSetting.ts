/**
 * "Serve only my names" (design models-page.md 8; the gateway's only-my-names.md): the setting as the page reads
 * it from its one read of the configuration, the whole object each write sends, and what the switch, its preview,
 * "Not served" and the refused strip show. Pure.
 *
 * A name is his when the configuration names it: an alias row gives it, or `models.only-my-names.keep` lists it (a
 * model kept under its vendor's name). An alias in a login's own file is not one (only-my-names.md 17.1 A): it is
 * among the others until kept. Names are compared exactly, trimmed and nothing else (17.1 B): `GPT-5.5` kept does
 * not make `gpt-5.5` his. With the switch on, every other name is refused. The gateway's status endpoint,
 * `GET /provimux/names`, lists both sides as the rule it applies now, his names with the ids served through them
 * (`copies`: under an account's prefix, or with a thinking level); the page joins it with the 30-day usage it
 * already reads.
 */
import { isRecord } from '@/utils/helpers';
import type {
  ProvimuxModelUsage,
  ProvimuxNameAccount,
  ProvimuxNamesResponse,
  ProvimuxRefusedName,
} from '../../api/types';
import { inexactNumbers } from '../aliases/rows';
import type { AliasDraft, AliasEntry } from '../aliases/types';
import { accessOf, compatibleEntryOf, type Access } from '../modelRoutes/logic';
import {
  entryOfRoute,
  lineProviderKeys,
  nameKey,
  type ModelsFilter,
  type SetNames,
} from './catalog';

/** The config API's path for the setting: written whole, with `If-Match` (only-my-names.md 4). */
export const ONLY_MY_NAMES_PATH = '/config/models/only-my-names';

// --- the setting, as read --------------------------------------------------------------------------------

export interface OnlyMyNamesSetting {
  /** `models.only-my-names` as read; null when the file does not set it (off). */
  stored: Readonly<Record<string, unknown>> | null;
  enabled: boolean;
  /** `keep` as stored, every element in order: a write changes only what it means to. */
  keepStored: readonly unknown[];
  /** The names `keep` serves by: its strings, trimmed, without empty entries, patterns and `auto`. */
  keep: string[];
  /**
   * The setting cannot be written whole (aliases-page.md 2.5): `models` or the setting is not a map, `keep` is
   * not a list, or it holds a number the browser cannot hold exactly. Nothing is written then.
   */
  unreadable: boolean;
}

/**
 * `auto` is never a name: clients send it for the first available model, and the gateway ignores it on `keep`
 * (`keep_ignored` reason `reserved`, only-my-names.md 17.2 F). Compared exactly, as every name is.
 */
export const RESERVED_NAME = 'auto';

/**
 * A `keep` entry the gateway serves by: a string with something in it, no `*` (no wildcards, decision 4), and not
 * `auto`.
 */
export const keepable = (entry: unknown): entry is string =>
  typeof entry === 'string' &&
  entry.trim() !== '' &&
  !entry.includes('*') &&
  entry.trim() !== RESERVED_NAME;

/**
 * A name without its thinking suffix, as the gateway cuts it (`registry.ProvimuxBase`): `opus(high)` is `opus`; a
 * name without one is itself.
 */
export function thinkingBase(name: string): string {
  const open = name.lastIndexOf('(');
  if (open === -1 || !name.endsWith(')')) return name;
  return name.slice(0, open).trim();
}

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

/**
 * Keep: the names added at the end of `keep`, each once and exactly as served (the gateway compares names exactly:
 * `GPT-5.5` kept does not serve `gpt-5.5`); the switch as it is.
 */
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

/**
 * Stop keeping: the entries that are this name (trimmed, exactly) taken out of `keep`; the rest stays, patterns and
 * the name in another case included (another name to the gateway).
 */
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
 * The gateway says which rule its answer describes (`applied`): the page then shows what it serves, and a write
 * not applied yet shows as such (`namesApplied.ts`), not as done. A gateway without it says nothing of the kind,
 * so the page joins the read's `keep` (written a moment ago, before the answer has caught up) to its answer.
 */
const joinsKeep = (answer: ProvimuxNamesResponse | null) => !answer || answer.applied === null;

/**
 * The names the gateway counts as his besides alias rows, for the list: what is kept, and the gateway's
 * login-file names (no longer given since only-my-names.md 17, still read from an older gateway). Kept: the gateway's kept names when it says which rule it applies (`source: 'shown'`), else
 * `keep` of the page's read; `source: 'config'` is always the read's (what a save of the file keeps).
 */
export function setNamesOf(
  answer: ProvimuxNamesResponse | null,
  setting: OnlyMyNamesSetting,
  source: 'shown' | 'config' = 'shown'
): SetNames {
  const spelled = new Map<string, string>();
  const kept = new Set<string>();
  const loginFile = new Set<string>();
  const keptNames =
    source === 'config' || joinsKeep(answer)
      ? setting.keep
      : (answer?.names ?? []).filter((own) => own.set_by.includes('keep')).map((own) => own.name);
  for (const name of keptNames) {
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

/**
 * His names, by key: the gateway's list; from a gateway that does not say which rule it applies, joined with the
 * read's `keep` (which a write just changed).
 */
export function yourNameKeys(
  answer: ProvimuxNamesResponse | null,
  setting: OnlyMyNamesSetting
): Set<string> {
  const keys = new Set((answer?.names ?? []).map((own) => nameKey(own.name)));
  if (!joinsKeep(answer)) return keys;
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

/** One of his names as the preview's chips show it: a kept one can stop being kept there. */
export interface YourName {
  key: string;
  name: string;
  kept: boolean;
}

/** His names for the preview's chips, by name: the gateway's, and any `yourNameKeys` joined from the read. */
export function yourNamesOf(
  answer: ProvimuxNamesResponse | null,
  setNames: SetNames | undefined,
  yours: ReadonlySet<string>
): YourName[] {
  const kept = setNames?.kept ?? new Set<string>();
  const byKey = new Map<string, YourName>();
  for (const own of answer?.names ?? []) {
    const key = nameKey(own.name);
    if (yours.has(key)) byKey.set(key, { key, name: own.name, kept: kept.has(key) });
  }
  // A name kept a moment ago, from a gateway that does not say which rule it applies.
  for (const key of yours) {
    if (!byKey.has(key))
      byKey.set(key, { key, name: setNames?.spelled.get(key) ?? key, kept: true });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
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
  /**
   * A spelling no account registers that reaches one that is, in another case, through upstream's lower-case
   * lookup (a tool sent `B-Coder`, an account offers `b-coder`): that spelling. Kept, it is served.
   */
  reaches?: string;
  /** No account offers the name in any case (a typo): keeping it would serve nothing, so it has no Keep. */
  unoffered?: boolean;
}

/** Used names first, most used first; then by name. */
export const byUse = (a: OtherItem, b: OtherItem) =>
  (b.requests ?? 0) - (a.requests ?? 0) || a.name.localeCompare(b.name);

/**
 * The spellings accounts register now, by their lower case (upstream finds a requested name by its lower case when
 * no account registers that spelling, only-my-names.md 18.3): each with the registered spellings and the accounts
 * `others` gives for them. A name his with no account adds nothing.
 */
export function offeredSpellingsOf(
  answer: ProvimuxNamesResponse | null
): Map<string, { spellings: string[]; accounts: ProvimuxNameAccount[] }> {
  const offered = new Map<string, { spellings: string[]; accounts: ProvimuxNameAccount[] }>();
  const add = (spelling: string, accounts: readonly ProvimuxNameAccount[]) => {
    const lower = nameKey(spelling).toLowerCase();
    const found = offered.get(lower) ?? { spellings: [], accounts: [] };
    if (!found.spellings.includes(nameKey(spelling))) found.spellings.push(nameKey(spelling));
    for (const account of accounts) {
      if (
        !found.accounts.some(
          (a) => a.auth_index === account.auth_index && a.provider === account.provider
        )
      )
        found.accounts.push(account);
    }
    offered.set(lower, found);
  };
  for (const other of answer?.others ?? []) add(other.name, other.accounts);
  for (const own of answer?.names ?? []) {
    if (own.accounts > 0) add(own.name, []);
    for (const copy of own.copies) add(copy.id, []);
  }
  return offered;
}

/**
 * Whether some account offers a name a tool asked for, in any case (a thinking suffix aside): when none does, the
 * gateway still refuses and counts it (its check reads no registration, only-my-names.md 18.2), but keeping it
 * would serve nothing.
 */
export const offeredInSomeCase = (offered: ReadonlyMap<string, unknown>, name: string): boolean =>
  offered.has(thinkingBase(nameKey(name)).toLowerCase());

/**
 * Every name an account offers that is not his, used ones first (the preview's and "Not served"'s order). With the
 * usage, also the names tools sent that no account registers in that spelling but reach one in another case
 * (`B-Coder` sent, `b-coder` offered): served while the switch is off, refused once on unless kept exactly. A sent
 * name no account offers in any case was never served (and is not in the usage): it is not here.
 */
export function othersOf(
  answer: ProvimuxNamesResponse | null,
  yours: ReadonlySet<string>,
  usage: Readonly<Record<string, number>> | null
): OtherItem[] {
  const copies = copyKeysOf(answer);
  const items: OtherItem[] = (answer?.others ?? [])
    .filter((other) => !yours.has(nameKey(other.name)) && !copies.has(nameKey(other.name)))
    .map((other) => ({
      key: nameKey(other.name),
      name: other.name,
      requests: usage ? (usage[nameKey(other.name)] ?? 0) : null,
      accounts: other.accounts,
    }));
  if (answer && usage) {
    const listed = new Set((answer.others ?? []).map((other) => nameKey(other.name)));
    const offered = offeredSpellingsOf(answer);
    for (const [key, requests] of Object.entries(usage)) {
      if (!(requests > 0) || !keepable(key) || yours.has(key) || copies.has(key) || listed.has(key))
        continue;
      const found = offered.get(key.toLowerCase());
      if (!found || found.spellings.includes(key)) continue;
      items.push({
        key,
        name: key,
        requests,
        accounts: found.accounts,
        reaches: [...found.spellings].sort()[0],
      });
    }
  }
  return items.sort(byUse);
}

/**
 * The ids served through his names that are not names of his (`copies`, only-my-names.md 17.2 C): his names under an
 * account's prefix (`team-a/opus` for `opus`, 3.3), and his names with a thinking suffix an account registers as an
 * id (`opus(high)`). Served with his names, so never "Not served". Keys; a copy that is itself one of his names is
 * his, not a copy.
 */
export function copyKeysOf(answer: ProvimuxNamesResponse | null): Set<string> {
  const own = new Set((answer?.names ?? []).map((name) => nameKey(name.name)));
  const copies = new Set<string>();
  for (const name of answer?.names ?? []) {
    for (const copy of name.copies) if (!own.has(nameKey(copy.id))) copies.add(nameKey(copy.id));
  }
  return copies;
}

/**
 * Of the copies, the spellings with a thinking suffix (`opus(high)`, `team-a/opus(high)`), each with the id it is a
 * spelling of (`opus`, `team-a/opus`). Not a name of its own: any name can be asked for with a level, and an
 * account that registers one as an id adds no name. The page counts it with that id and shows it on its card.
 */
export function levelCopiesOf(answer: ProvimuxNamesResponse | null): Map<string, string> {
  const levels = new Map<string, string>();
  for (const key of copyKeysOf(answer)) {
    const base = thinkingBase(key);
    if (base !== key && base !== '') levels.set(key, base);
  }
  return levels;
}

/** Copies counted among what is served: under an account's prefix, not a spelling with a thinking level. */
export const servedCopiesOf = (answer: ProvimuxNamesResponse | null): number => {
  const levels = levelCopiesOf(answer);
  return [...copyKeysOf(answer)].filter((key) => !levels.has(key)).length;
};

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

/**
 * The usage state of the page's 30 days of use. With the names tools sent: partial when names were folded into
 * `~other` or left out (`truncated`), or when the days before them could not be read or were folded. Without: the
 * rows by model, partial when folded.
 */
export function usageStateOf(answer: ProvimuxModelUsage | null, failed: boolean): UsageState {
  if (!answer) return failed ? 'unknown' : 'loading';
  const folded = (rows: ReadonlyArray<{ model?: string }>) =>
    rows.some((row) => row.model === '~other');
  const requested = answer.requested_models;
  if (requested && requested.from !== null) {
    return requested.truncated ||
      folded(requested.models) ||
      answer.before_failed === true ||
      (answer.before != null && (answer.before.truncated || folded(answer.before.rows)))
      ? 'partial'
      : 'known';
  }
  const breakdown = answer.breakdowns.find((b) => b.by.length === 1 && b.by[0] === 'model');
  if (!breakdown) return 'unknown';
  return breakdown.truncated || folded(breakdown.rows) ? 'partial' : 'known';
}

/**
 * The day from which the names tools sent are counted, when it falls inside the 30 days (the gateway began
 * keeping them since): the page says so in one line. null when they cover the whole range, or are not given.
 */
export function usageSinceOf(answer: ProvimuxModelUsage | null): string | null {
  const from = answer?.requested_models?.from ?? null;
  return from !== null && answer && from > answer.range.from ? from : null;
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

/** The refused names that are still not his, most refused first, then by name. */
export const refusedOf = (
  answer: ProvimuxNamesResponse | null,
  yours: ReadonlySet<string>
): ProvimuxRefusedName[] =>
  (answer?.refused?.names ?? [])
    .filter((refused) => !yours.has(nameKey(refused.name)))
    .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name));

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
 * alias row of the draft does (exactly: a rename that only changes case stops the old spelling), unless `keep` also
 * makes them his.
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

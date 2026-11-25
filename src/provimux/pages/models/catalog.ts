/**
 * The Models page's one list (design models-page.md): every name a client can send, with the routes that
 * serve it in the order they are tried. Built from four reads, none of which it changes:
 *
 * - the configuration's draft (the Aliases data layer: `src/provimux/pages/aliases/`), which says which
 *   routes come from a row of the configuration, what is not saved yet, and what the proxy will ignore;
 * - `/provimux/model-routes`, every name the proxy serves now, each route with its priority and cooldown;
 * - `/provimux/model-lists`, each login's list source and age;
 * - `/provimux/savings` for 30 days by model, which names were used.
 *
 * Without Provimux's endpoints the list holds the configuration's names only, with no order. Pure.
 */
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import type {
  ProvimuxFieldSource,
  ProvimuxLimits,
  ProvimuxModelListLogin,
  ProvimuxModelListsResponse,
  ProvimuxModelRoute,
  ProvimuxModelRoutesResponse,
  ProvimuxRecordedCooldown,
  ProvimuxSavingsResponse,
} from '../../api/types';
import { clientNames, nameGroups, nameKey } from '../aliases/collisions';
import {
  addKeyAlias,
  addLoginAlias,
  changeRow,
  draftEntries,
  isBlankNewRow,
  isBlocking,
  loginMapUnread,
  removeRow,
  rowChanged,
  rowIssues,
} from '../aliases/draft';
import { draftPriority, priorityChanged } from '../aliases/priority';
import type {
  AliasDraft,
  AliasEntry,
  AliasRow,
  AliasState,
  KeyEntry,
  LoginEntry,
  RowIssue,
  ServedNames,
  ServedRoute,
} from '../aliases/types';
import { accessOf, isCoolingAt, isOpenRouterHost, type Access } from '../modelRoutes/logic';
import {
  learnedByIndex,
  overlapOrder,
  paysPerToken,
  type OverlapOrder,
} from '../keyLists/keyLists';

export { nameKey } from '../aliases/collisions';

// --- the lines -------------------------------------------------------------------------------------

/**
 * A route line's state:
 * - `live`: the proxy serves it now, as the configuration says;
 * - `new`: a row of the draft, not saved yet;
 * - `changed`: the proxy serves it now; the draft changes its row (an option, or the name moves away);
 * - `removed`: the proxy serves it now; the draft takes it out of this name;
 * - `idle`: a row of the configuration that the proxy does not serve under this name (it ignores the
 *   row, the key is turned off, or the proxy does not say what it serves).
 */
export type LineState = 'live' | 'new' | 'changed' | 'removed' | 'idle';

export interface RouteLine {
  /** Unique among the lines of one name. */
  key: string;
  /** The configuration row behind the line; null for a route the proxy serves without one (built in). */
  rowId: string | null;
  /** The page's entry for the route (an API key, or a login type); null when the page has none. */
  entryId: string | null;
  access: Access;
  /** The provider id, as Model routes and Auth Files name it: `claude`, `openai-compatible-openrouter`. */
  provider: string;
  host: string | null;
  /** The login's account (e-mail) or the key's host; null when not known. */
  account: string | null;
  /**
   * Which key of an OpenAI-compatible entry with several keys the route is (its masked key): the entry's routes
   * otherwise read the same. null for every other route.
   */
  keyName: string | null;
  /** A login's file name on Auth Files, to open it there. */
  loginFile: string | null;
  authIndex: string | null;
  /** The model the route sends upstream. */
  upstream: string;
  /** The priority the route is tried with: the proxy's, or for an API key the draft's. null: not known. */
  priority: number | null;
  /** The draft changes this API key's priority. */
  priorityEdited: boolean;
  /**
   * A limit of the model behind the route is estimated: the login's own list offers the model and the
   * built-in list does not have it yet ('new'), or no list states its context or output ('default').
   */
  estimated: 'new' | 'default' | null;
  /** Where the login's list says each limit of the model comes from; null when not known (or an API key). */
  detail: ModelDetail | null;
  /** The reasoning levels the route offers, as the proxy reports them; null when not reported. */
  reasoning: string[] | null;
  /** 1-based: routes of rank 1 are tried first. null: not tried, or not known. */
  rank: number | null;
  /** Another tried route of the name has the same priority: the routing strategy chooses between them. */
  sharesRank: boolean;
  cooldown: ProvimuxRecordedCooldown | null;
  /** A login's model list, as Model lists reports it. */
  list: ProvimuxModelListLogin | null;
  state: LineState;
  /** The row's issue (design aliases-page.md 3.5); undefined when it has none. */
  issue: RowIssue | undefined;
  /** The API key is turned off. */
  off: boolean;
  /**
   * An API key serves it because its service's list names it, and no row of its settings does: it learned it
   * by itself (key-model-lists.md 3.1). `upstream` is then the id as the service lists it.
   */
  learned: boolean;
  /**
   * Another model of a pool (two rows of one OpenAI-compatible entry under one name): the key of the route line
   * it takes turns with. The proxy reports one route per key for the pool; the line's own row is the second
   * model. It has no rank of its own and is drawn on that route's line. null for every other line.
   */
  poolOf: string | null;
}

export type NameProblem =
  /** A row of the name is ignored by the proxy (no model or no name, equal to the model, repeated). */
  | 'ignored'
  /** A key never answers a row: an earlier row of the key has the name. */
  | 'shadowed'
  /** One service answers the name with different models. */
  | 'mixed';

export interface NameItem {
  /** `nameKey`: trimmed, lower-case. */
  key: string;
  /** As the proxy lists it, or as typed. */
  name: string;
  /**
   * A name the owner set (only-my-names.md 2.2): an alias row of the configuration (in the read or the draft)
   * gives it, `models.only-my-names.keep` lists it, or an alias in a login's own file gives it.
   */
  own: boolean;
  /** An alias row of the configuration (in the read or the draft) gives it: it can be renamed and removed. */
  aliased: boolean;
  /** `models.only-my-names.keep` lists it: kept under its own name. */
  kept: boolean;
  lines: RouteLine[];
  /**
   * How many accounts Provimux can send a request for this name to, or will once saved (design models-page.md
   * 2): of the lines tried, those it serves now (a row it does not serve is left out, where it says what it
   * serves), each account once, as Accounts counts them (a login; an API key; an OpenAI-compatible entry
   * with all its keys). Another name for the same model has accounts of its own.
   */
  accounts: number;
  problems: NameProblem[];
  /** The draft changes something of this name. */
  edited: boolean;
  /** Every configuration row of the name is new: a name made on this page, not saved yet. */
  fresh: boolean;
  /** Requests in the last 30 days; null when not known. */
  requests: number | null;
  limits: ProvimuxLimits | null;
  /** Where the name's context and output come from, when every route that is tried agrees; null: not known. */
  limitSources: { context: LimitSource | null; output: LimitSource | null };
  /** A key serves it because it learned it from its service's list. */
  learned: boolean;
  /**
   * A key learned it and a subscription serves it too (both tried): who is tried first between that key and the
   * subscription. null: no such overlap. `paysPerToken(paid)` is the case the owner wants to see.
   */
  paid: OverlapOrder | null;
}

/** Where a limit's value comes from: a company's own list, the built-in list, or neither (a default). */
export type LimitSource =
  { kind: 'list'; provider: string } | { kind: 'built-in' } | { kind: 'default' };

/** Where a login's model list says a model's limits come from (model-lists.md): its own list, the built-in
 *  list, or neither (null: a default). */
export interface ModelDetail {
  /** The login's own list has the model and the built-in list does not, yet. */
  learned: boolean;
  context: ProvimuxFieldSource;
  output: ProvimuxFieldSource;
  reasoning: ProvimuxFieldSource;
}

export interface CatalogInput {
  draft: AliasDraft;
  /** null: the proxy does not report its routes (no Provimux endpoint, or not read yet). */
  routes: ProvimuxModelRoutesResponse | null;
  lists: ProvimuxModelListsResponse | null;
  /** Requests per `nameKey`; null when not known. */
  usage: Record<string, number> | null;
  /** The server's now, for cooldowns. */
  nowMs: number;
  /** Per login (auth index), its models by id, with where each limit comes from (Model lists per login). */
  details?: Record<string, Record<string, ModelDetail>>;
  /** Names the gateway counts as his besides alias rows; absent on a gateway without the setting. */
  setNames?: SetNames;
}

/**
 * Names that are his without an alias row of the configuration (only-my-names.md 2.2), by `nameKey`: kept under
 * their own name (`keep` of the page's read), or given by an alias in a login's own file (the gateway's answer).
 */
export interface SetNames {
  kept: ReadonlySet<string>;
  loginFile: ReadonlySet<string>;
  /** Each name as written, for a kept name no account offers (it has no route to take a spelling from). */
  spelled: ReadonlyMap<string, string>;
}

/** 30 days of requests per name, from a savings answer grouped by model. */
export function usageByName(answer: ProvimuxSavingsResponse | null): Record<string, number> | null {
  if (!answer) return null;
  const breakdown = answer.breakdowns.find((b) => b.by.length === 1 && b.by[0] === 'model');
  if (!breakdown) return null;
  const usage: Record<string, number> = {};
  for (const row of breakdown.rows) {
    if (!row.model || row.model === '~other') continue;
    const key = nameKey(row.model);
    usage[key] = (usage[key] ?? 0) + row.requests;
  }
  return usage;
}

/** From the Model lists answers asked per login (`?auth_index=`), each login's models with their sources. */
export function detailsByLogin(
  answers: readonly ProvimuxModelListsResponse[]
): Record<string, Record<string, ModelDetail>> {
  const details: Record<string, Record<string, ModelDetail>> = {};
  for (const answer of answers) {
    for (const login of answer.logins) {
      if (!login.auth_index || !login.models) continue;
      const models: Record<string, ModelDetail> = {};
      for (const model of login.models) {
        models[model.id] = {
          learned: model.learned,
          context: model.sources.context,
          output: model.sources.output,
          reasoning: model.sources.reasoning_levels,
        };
      }
      details[login.auth_index] = models;
    }
  }
  return details;
}

/** The logins whose models to ask for, with what identifies their list's state (asked again when it changes). */
export const loginsToDetail = (lists: ProvimuxModelListsResponse | null) =>
  (lists?.logins ?? [])
    .filter((login) => login.auth_index && !login.disabled)
    .map((login) => ({
      authIndex: login.auth_index!,
      version: `${login.auth_index}|${login.live.fetched_at ?? ''}|${login.registered_models ?? ''}`,
    }));

/** The served names in the shape the name check of the data layer takes (aliases-page.md 4.4). */
export function servedOf(routes: ProvimuxModelRoutesResponse | null): ServedNames {
  if (!routes) return { known: false, byName: {} };
  const byName: Record<string, ServedRoute[]> = {};
  for (const model of routes.models) {
    const key = nameKey(model.id);
    byName[key] = [
      ...(byName[key] ?? []),
      ...model.routes.map((route): ServedRoute => ({
        authIndex: route.auth_index,
        kind: route.kind === 'oauth' ? 'oauth' : route.kind === 'apikey' ? 'apikey' : null,
        provider: route.provider,
        host: route.host,
      })),
    ];
  }
  return { known: true, byName };
}

/** The page's entry a served route belongs to: the API key by its auth index, the login type by provider. */
export function entryOfRoute(
  route: Pick<ProvimuxModelRoute, 'kind' | 'auth_index' | 'provider'>,
  entries: readonly AliasEntry[]
): AliasEntry | null {
  if (route.kind === 'apikey') {
    if (!route.auth_index) return null;
    return (
      entries.find(
        (entry) => entry.store === 'api-key' && entry.authIndexes.includes(route.auth_index!)
      ) ?? null
    );
  }
  if (route.kind === 'oauth') {
    const channel = normalizeOAuthProviderKey(route.provider);
    return entries.find((entry) => entry.store === 'login' && entry.channel === channel) ?? null;
  }
  return null;
}

/** The provider id of an entry, as the proxy's routes carry it. */
export function providerOfEntry(entry: AliasEntry): string {
  if (entry.store === 'login') return entry.channel;
  if (entry.family === 'openai-compatibility') return `openai-compatible-${entry.groupName ?? ''}`;
  return entry.family;
}

/** The row's client names, compared as names are (trimmed, lower-case). */
const namesOf = (row: AliasRow, entry: AliasEntry, state: Pick<AliasState, 'forceModelPrefix'>) =>
  row.upstream.trim() || row.alias?.trim()
    ? clientNames(row, entry, state.forceModelPrefix).map(nameKey).filter(Boolean)
    : [];

/** Lines tried: neither removed, ignored, shadowed nor turned off. */
const tried = (line: RouteLine) =>
  line.state !== 'removed' && !line.off && !isBlocking(line.issue) && line.issue !== 'shadowed';

/**
 * The account behind a line, as Accounts counts them: a login (by its auth index); an API key, or an
 * OpenAI-compatible entry with all its keys (by the page's entry); else what the line has.
 */
const accountOf = (line: RouteLine): string =>
  line.access === 'sub' && line.authIndex
    ? `login:${line.authIndex}`
    : line.entryId
      ? `entry:${line.entryId}`
      : `index:${line.authIndex ?? line.key}`;

/**
 * The accounts a name is sent to (`NameItem.accounts`). Where the proxy says what it serves, a row it does
 * not serve now (`idle`: a model the key excludes, a login type no login of which offers it) is not one.
 */
const accountsOf = (lines: readonly RouteLine[], servedKnown: boolean): number =>
  new Set(
    lines.filter((line) => tried(line) && !(servedKnown && line.state === 'idle')).map(accountOf)
  ).size;

/**
 * Ranks the tried lines by priority, highest first. When the priority of a tried line is not known (a
 * proxy that does not report it), no line of the name is ranked: a partial order would mislead. Where the
 * proxy says what it serves, a row it does not serve now (`idle`) has no place in the order; another model
 * of a pool is drawn on its route's line and has none of its own.
 */
function rank(lines: RouteLine[], servedKnown: boolean): RouteLine[] {
  const inOrder = (l: RouteLine) =>
    tried(l) && l.poolOf === null && !(servedKnown && l.state === 'idle');
  const unknown = lines.some((l) => inOrder(l) && l.priority === null);
  const priorities = unknown
    ? []
    : [
        ...new Set(lines.filter((l) => inOrder(l) && l.priority !== null).map((l) => l.priority!)),
      ].sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const line of lines) {
    if (inOrder(line) && line.priority !== null) {
      counts.set(line.priority, (counts.get(line.priority) ?? 0) + 1);
    }
  }
  const ranked = lines.map((line) =>
    !unknown && inOrder(line) && line.priority !== null
      ? {
          ...line,
          rank: priorities.indexOf(line.priority) + 1,
          sharesRank: (counts.get(line.priority) ?? 0) > 1,
        }
      : { ...line, rank: null, sharesRank: false }
  );
  const order = (line: RouteLine) => (line.state === 'removed' ? 3 : line.rank === null ? 2 : 1);
  return ranked
    .map((line, index) => ({ line, index }))
    .sort(
      (a, b) =>
        order(a.line) - order(b.line) ||
        (a.line.rank ?? 0) - (b.line.rank ?? 0) ||
        a.index - b.index
    )
    .map(({ line }) => line);
}

interface Collected {
  name: string;
  lines: RouteLine[];
  limits: ProvimuxLimits | null;
}

/**
 * Every name, with its lines. A name the proxy serves gets one line per route, in its order; the draft's
 * rows that the proxy does not serve (yet) under a name get a line each; a route whose row the draft takes
 * out of the name is `removed`. Lines are ranked by priority, highest first.
 */
export function buildNames(input: CatalogInput): NameItem[] {
  const { draft, routes, lists, usage, nowMs } = input;
  const details = input.details ?? {};
  const detailOf = (authIndex: string | null, upstream: string): ModelDetail | null =>
    authIndex !== null ? (details[authIndex]?.[upstream] ?? null) : null;
  const base = draft.base;
  const entries = draftEntries(draft);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const issues = rowIssues(draft);
  const draftRows = new Map(draft.rows.map((row) => [row.id, row]));
  const listByIndex = new Map(
    (lists?.logins ?? []).filter((l) => l.auth_index).map((l) => [l.auth_index!, l])
  );
  // What each key learned from its service's list, by the names it serves them under (its prefix included).
  const learnedNames = learnedByIndex(lists, (index) => {
    const entry = entries.find((e) => e.store === 'api-key' && e.authIndexes.includes(index));
    return entry?.store === 'api-key' ? entry.prefix : null;
  });

  // A login type's accounts and priority, and an API key's host, from any of its routes: for lines the
  // proxy does not serve.
  const loginRoutes = new Map<string, ProvimuxModelRoute[]>();
  const keyHosts = new Map<string, string>();
  for (const model of routes?.models ?? []) {
    for (const route of model.routes) {
      if (route.kind === 'apikey' && route.auth_index && route.host) {
        keyHosts.set(route.auth_index, route.host);
      }
      if (route.kind !== 'oauth') continue;
      const channel = normalizeOAuthProviderKey(route.provider);
      const known = loginRoutes.get(channel) ?? [];
      if (!known.some((r) => r.auth_index === route.auth_index)) known.push(route);
      loginRoutes.set(channel, known);
    }
  }

  const byName = new Map<string, Collected>();
  const collect = (key: string, name: string) => {
    const found = byName.get(key) ?? { name, lines: [], limits: null };
    byName.set(key, found);
    return found;
  };

  const keyPriority = (entry: AliasEntry | null) =>
    entry?.store === 'api-key' ? draftPriority(draft, entry) : null;
  const keyPriorityEdited = (entry: AliasEntry | null) =>
    entry?.store === 'api-key' && priorityChanged(draft, entry.id);
  const isOff = (entry: AliasEntry | null) => entry?.store === 'api-key' && entry.disabled;

  /** The base rows of an entry that answer under a name, in order (a key's later ones are shadowed). */
  const baseRowsFor = (entry: AliasEntry, key: string) =>
    base.rows.filter((row) => row.entryId === entry.id && namesOf(row, entry, base).includes(key));
  /** A row's state on a route the proxy serves: as saved, changed by the draft, or taken out of the name. */
  const stateOn = (entry: AliasEntry, baseRow: AliasRow, key: string): LineState => {
    const draftRow = draftRows.get(baseRow.id);
    if (!draftRow || !namesOf(draftRow, entry, base).includes(key)) return 'removed';
    return rowChanged(draftRow, baseRow) ? 'changed' : 'live';
  };
  /** The masked key a route of an OpenAI-compatible entry with several keys uses. */
  const keyNameOf = (entry: AliasEntry | null, authIndex: string | null) =>
    entry?.store === 'api-key' && entry.keyCount > 1 && authIndex
      ? (entry.keyPreviews?.[authIndex] ?? null)
      : null;

  const accounted = new Set<string>(); // `${rowId}\n${key}`

  // 1. What the proxy serves now.
  for (const model of routes?.models ?? []) {
    const key = nameKey(model.id);
    if (!key) continue;
    const found = collect(key, model.id);
    found.limits = model.limits;
    model.routes.forEach((route, index) => {
      const entry = entryOfRoute(route, entries);
      const rows = entry ? baseRowsFor(entry, key) : [];
      const baseRow = rows[0] ?? null;
      const draftRow = baseRow ? draftRows.get(baseRow.id) : undefined;
      let state: LineState = 'live';
      if (baseRow) {
        accounted.add(`${baseRow.id}\n${key}`);
        state = stateOn(entry!, baseRow, key);
      }
      // A pool: the entry's other rows under the name are models of this route, not routes of their own.
      const pool =
        entry?.store === 'api-key' && entry.family === 'openai-compatibility' ? rows.slice(1) : [];
      const priority =
        route.kind === 'apikey' && entry?.store === 'api-key' ? keyPriority(entry) : route.priority;
      const learnedId =
        route.kind === 'apikey' && !baseRow && route.auth_index
          ? learnedNames.get(route.auth_index)?.get(key)
          : undefined;
      const lineKey = `route-${index}-${route.auth_index ?? route.provider}`;
      found.lines.push({
        key: lineKey,
        rowId: baseRow?.id ?? null,
        entryId: entry?.id ?? null,
        access: accessOf(route.kind),
        provider: route.provider,
        host: route.host,
        account:
          route.kind === 'apikey'
            ? (route.host ?? route.login.label)
            : (route.login.email ?? route.login.label ?? route.login.name),
        keyName: route.kind === 'apikey' ? keyNameOf(entry, route.auth_index) : null,
        loginFile: route.kind === 'oauth' ? route.login.name : null,
        authIndex: route.auth_index,
        upstream:
          (draftRow ?? baseRow)?.upstream.trim() || learnedId || upstreamOfServed(route, model.id),
        priority,
        priorityEdited: keyPriorityEdited(entry),
        estimated: null,
        detail: null,
        reasoning: route.reasoning?.levels.length ? route.reasoning.levels : null,
        rank: null,
        sharesRank: false,
        cooldown: isCoolingAt(route.recorded_cooldown, nowMs) ? route.recorded_cooldown : null,
        list: route.auth_index ? (listByIndex.get(route.auth_index) ?? null) : null,
        state,
        issue: baseRow && draftRow ? issues[draftRow.id] : undefined,
        off: isOff(entry),
        learned: learnedId !== undefined,
        poolOf: null,
      });
      const routeLine = found.lines[found.lines.length - 1];
      for (const mate of pool) {
        accounted.add(`${mate.id}\n${key}`);
        const draftMate = draftRows.get(mate.id);
        found.lines.push({
          ...routeLine,
          key: `${lineKey}-pool-${mate.id}`,
          rowId: mate.id,
          upstream: (draftMate ?? mate).upstream.trim(),
          state: stateOn(entry!, mate, key),
          issue: draftMate ? issues[draftMate.id] : undefined,
          cooldown: null,
          learned: false,
          poolOf: lineKey,
        });
      }
    });
  }

  // 2. The draft's rows the proxy does not serve under a name: new, moved, ignored, or not reported.
  for (const row of draft.rows) {
    if (isBlankNewRow(row)) continue;
    const entry = entryById.get(row.entryId);
    if (!entry) continue;
    const baseRow = base.rows.find((r) => r.id === row.id);
    for (const key of namesOf(row, entry, base)) {
      if (accounted.has(`${row.id}\n${key}`)) continue;
      const shown = clientNames(row, entry, base.forceModelPrefix).find((n) => nameKey(n) === key);
      const found = collect(key, shown ?? key);
      const wasHere = baseRow ? namesOf(baseRow, entry, base).includes(key) : false;
      found.lines.push(
        pendingLine(row, entry, {
          state: !baseRow
            ? 'new'
            : !wasHere
              ? 'new'
              : rowChanged(row, baseRow)
                ? 'changed'
                : 'idle',
          issue: issues[row.id],
          priority: keyPriority(entry) ?? loginPriority(loginRoutes.get(channelOf(entry)) ?? []),
          priorityEdited: keyPriorityEdited(entry),
          logins: entry.store === 'login' ? (loginRoutes.get(entry.channel) ?? []) : [],
          listByIndex,
          keyHosts,
          off: isOff(entry),
        })
      );
    }
  }

  // 3. Base rows the draft takes out of a name that the proxy did not report serving.
  for (const row of base.rows) {
    const entry = entryById.get(row.entryId);
    if (!entry) continue;
    const draftRow = draftRows.get(row.id);
    for (const key of namesOf(row, entry, base)) {
      if (accounted.has(`${row.id}\n${key}`)) continue;
      if (draftRow && namesOf(draftRow, entry, base).includes(key)) continue;
      const shown = clientNames(row, entry, base.forceModelPrefix).find((n) => nameKey(n) === key);
      collect(key, shown ?? key).lines.push(
        pendingLine(row, entry, {
          state: 'removed',
          issue: undefined,
          priority: keyPriority(entry),
          priorityEdited: false,
          logins: entry.store === 'login' ? (loginRoutes.get(entry.channel) ?? []) : [],
          listByIndex,
          keyHosts,
          off: isOff(entry),
        })
      );
    }
  }

  // The name check of the data layer, for one service answering a name with different models.
  const groups = nameGroups(draft, servedOf(routes));
  const mixed = new Set(
    groups.filter((g) => g.verdict === 'several-models' && !g.pool).map((g) => g.key)
  );
  const aliasKeys = new Set<string>();
  for (const row of [...base.rows, ...draft.rows]) {
    if (row.alias && row.alias.trim()) aliasKeys.add(nameKey(row.alias));
  }
  // A kept name no account offers now still stands under his names: it is served once one does.
  for (const key of input.setNames?.kept ?? []) {
    if (!byName.has(key)) collect(key, input.setNames?.spelled.get(key) ?? key);
  }

  return [...byName.entries()].map(([key, found]): NameItem => {
    const kept = input.setNames?.kept.has(key) ?? false;
    const aliased = aliasKeys.has(key);
    const lines = rank(
      found.lines.map((line) => {
        const detail = line.access === 'sub' ? detailOf(line.authIndex, line.upstream) : null;
        if (!detail) return line;
        const estimated = detail.learned
          ? 'new'
          : detail.context === null || detail.output === null
            ? 'default'
            : null;
        return { ...line, detail, estimated };
      }),
      routes !== null
    );
    const triedLines = lines.filter(tried);
    const configLines = lines.filter((line) => line.rowId !== null);
    const problems: NameProblem[] = [];
    if (lines.some((line) => line.state !== 'removed' && isBlocking(line.issue))) {
      problems.push('ignored');
    }
    if (lines.some((line) => line.state !== 'removed' && line.issue === 'shadowed')) {
      problems.push('shadowed');
    }
    if (mixed.has(key)) problems.push('mixed');
    return {
      key,
      name: found.name,
      own: aliased || kept || (input.setNames?.loginFile.has(key) ?? false),
      aliased,
      kept,
      lines,
      accounts: accountsOf(lines, routes !== null),
      problems,
      edited: lines.some((line) => line.state !== 'live' && line.state !== 'idle'),
      fresh: configLines.length > 0 && configLines.every((line) => line.state === 'new'),
      requests: usage ? (usage[key] ?? 0) : null,
      limits: found.limits,
      limitSources: {
        context: agreedSource(triedLines, 'context'),
        output: agreedSource(triedLines, 'output'),
      },
      learned: lines.some((line) => line.learned && line.state !== 'removed'),
      paid: paidOverlap(triedLines),
    };
  });
}

/**
 * A model a key learned that a subscription also serves: between the first such key and the first
 * subscription, who is tried first, by their priorities. null when no tried line of a learned key and no tried
 * subscription line meet.
 */
function paidOverlap(tried: readonly RouteLine[]): OverlapOrder | null {
  const learned = tried.filter((line) => line.learned && line.access === 'api');
  const subs = tried.filter((line) => line.access === 'sub');
  if (!learned.length || !subs.length) return null;
  const top = (lines: readonly RouteLine[]) =>
    lines.some((line) => line.priority === null)
      ? null
      : Math.max(...lines.map((line) => line.priority as number));
  return overlapOrder(top(learned), top(subs));
}

/** The name's paid overlap is one the owner should see: the key is tried first, or shares the requests. */
export const paysWhileSubscribed = (item: NameItem): boolean =>
  item.paid !== null && paysPerToken(item.paid);

/** The source of one limit that every tried line agrees on; null when a line has none known, or they differ. */
function agreedSource(
  lines: readonly RouteLine[],
  limit: 'context' | 'output'
): LimitSource | null {
  if (!lines.length || lines.some((line) => line.detail === null)) return null;
  const sources = lines.map((line): LimitSource => {
    const source = line.detail![limit];
    return source === 'live'
      ? { kind: 'list', provider: line.provider }
      : source === 'built-in'
        ? { kind: 'built-in' }
        : source === null
          ? { kind: 'default' }
          : { kind: 'list', provider: '' };
  });
  // A source this console does not know says nothing.
  if (sources.some((source) => source.kind === 'list' && !source.provider)) return null;
  const first = JSON.stringify(sources[0]);
  return sources.every((source) => JSON.stringify(source) === first) ? sources[0] : null;
}

const channelOf = (entry: AliasEntry) => (entry.store === 'login' ? entry.channel : '');

/** A login type's priority when its logins agree on one; null otherwise. */
function loginPriority(routes: readonly ProvimuxModelRoute[]): number | null {
  const values = [...new Set(routes.map((route) => route.priority))];
  return values.length === 1 ? values[0] : null;
}

/** The upstream model of a route the configuration does not state: the name itself. */
const upstreamOfServed = (_route: ProvimuxModelRoute, id: string) => id;

function pendingLine(
  row: AliasRow,
  entry: AliasEntry,
  options: {
    state: LineState;
    issue: RowIssue | undefined;
    priority: number | null;
    priorityEdited: boolean;
    logins: readonly ProvimuxModelRoute[];
    listByIndex: Map<string, ProvimuxModelListLogin>;
    /** An API key's host as its routes report it, by auth index (a key without a base URL has one too). */
    keyHosts: Map<string, string>;
    off: boolean;
  }
): RouteLine {
  const login = entry.store === 'login' ? (options.logins[0] ?? null) : null;
  const one = options.logins.length === 1;
  return {
    key: `row-${row.id}`,
    rowId: row.id,
    entryId: entry.id,
    access: entry.store === 'login' ? 'sub' : 'api',
    provider: providerOfEntry(entry),
    host: entry.store === 'api-key' ? entry.host : null,
    account:
      entry.store === 'api-key'
        ? (entry.host ??
          entry.authIndexes.map((index) => options.keyHosts.get(index)).find(Boolean) ??
          entry.keyPreview)
        : one && login
          ? (login.login.email ?? login.login.label ?? login.login.name)
          : null,
    keyName: null,
    loginFile: one && login ? login.login.name : null,
    authIndex: entry.store === 'api-key' ? entry.authIndex : (one && login?.auth_index) || null,
    upstream: row.upstream.trim(),
    priority: options.priority,
    priorityEdited: options.priorityEdited,
    estimated: null,
    detail: null,
    reasoning: null,
    rank: null,
    sharesRank: false,
    cooldown: null,
    list: one && login?.auth_index ? (options.listByIndex.get(login.auth_index) ?? null) : null,
    state: options.state,
    issue: options.issue,
    off: options.off,
    learned: false,
    poolOf: null,
  };
}

// --- sections, filter, summary ----------------------------------------------------------------------

export type Section = 'yours' | 'used' | 'rest';

/**
 * Where a name stands: the owner's own names first (pools and short names), then the models used in the
 * last 30 days, then every other model. A name with an edit not saved counts as his while it lasts.
 */
export const sectionOf = (item: NameItem): Section =>
  item.own || item.fresh ? 'yours' : (item.requests ?? 0) > 0 ? 'used' : 'rest';

const byRequestsThenName = (a: NameItem, b: NameItem) =>
  (b.requests ?? 0) - (a.requests ?? 0) || a.name.localeCompare(b.name);

/** The names of each section, in their order: unsaved names first among his, then by use, then by name. */
export function sections(items: readonly NameItem[]): Record<Section, NameItem[]> {
  const out: Record<Section, NameItem[]> = { yours: [], used: [], rest: [] };
  for (const item of items) out[sectionOf(item)].push(item);
  out.yours.sort((a, b) => Number(b.fresh) - Number(a.fresh) || byRequestsThenName(a, b));
  out.used.sort(byRequestsThenName);
  out.rest.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** `learned`: a key learned the name from its service's list; `paid`: that, and a subscription serves it too. */
export type NameView = 'all' | 'several' | 'cooling' | 'problems' | 'learned' | 'paid';

export interface ModelsFilter {
  query: string;
  /**
   * 'all', `login:<channel>`, `family:<family>`, `openrouter`, `id:<provider id>`, or `account:<auth index>`
   * (one account: a login, or an API key; any index of an OpenAI-compatible entry names the entry).
   */
  provider: string;
  view: NameView;
}

export const EMPTY_MODELS_FILTER: ModelsFilter = { query: '', provider: 'all', view: 'all' };

const FAMILIES = [
  'gemini',
  'interactions',
  'codex',
  'claude',
  'xai',
  'meta',
  'vertex',
  'openai-compatibility',
];

/**
 * The filter the page opens with, from its own parameters and the old pages' addresses (redirected here):
 * `?q=`, `?view=`, `?account=` (Accounts' link: one account, by its auth index), `?provider=` (Model routes:
 * a provider id, or `openrouter`), `?family=` (the provider forms' link), `?channel=` and `?store=` (the old
 * login alias address).
 */
export function initialModelsFilter(params: URLSearchParams): ModelsFilter {
  const filter: ModelsFilter = { ...EMPTY_MODELS_FILTER, query: params.get('q')?.trim() ?? '' };
  const view = params.get('view');
  if (
    view === 'several' ||
    view === 'cooling' ||
    view === 'problems' ||
    view === 'learned' ||
    view === 'paid'
  ) {
    filter.view = view;
  }
  const account = params.get('account')?.trim() ?? '';
  const channel = normalizeOAuthProviderKey(params.get('channel') ?? '');
  const family = params.get('family')?.trim() ?? '';
  const provider = params.get('provider')?.trim() ?? '';
  if (account) filter.provider = `account:${account}`;
  else if (channel) filter.provider = `login:${channel}`;
  else if (FAMILIES.includes(family)) filter.provider = `family:${family}`;
  else if (provider === 'openrouter') filter.provider = 'openrouter';
  else if (provider) filter.provider = `id:${provider}`;
  else if (params.get('store') === 'login') filter.provider = 'logins';
  else if (params.get('store') === 'api-key') filter.provider = 'keys';
  return filter;
}

/**
 * The name of the account an `account:<auth index>` filter names: a login's e-mail (its label, else its
 * file), an API key's host or entry name; the index itself when nothing names it.
 */
export function accountNameOf(
  routes: ProvimuxModelRoutesResponse | null,
  entries: readonly AliasEntry[],
  index: string
): string {
  for (const model of routes?.models ?? []) {
    for (const route of model.routes) {
      if (route.auth_index !== index) continue;
      const name = route.login.email || route.login.label || route.host || route.login.name;
      if (name) return name;
    }
  }
  const entry = entries.find((e) => e.store === 'api-key' && e.authIndexes.includes(index));
  if (entry?.store === 'api-key') return entry.host ?? entry.groupName ?? index;
  return index;
}

/** The filter keys a line answers to. */
export function lineProviderKeys(
  line: Pick<RouteLine, 'provider' | 'access' | 'entryId' | 'authIndex' | 'host'>,
  entries: readonly AliasEntry[]
): string[] {
  const keys = [`id:${line.provider}`, line.access === 'sub' ? 'logins' : 'keys'];
  const entry = line.entryId ? entries.find((e) => e.id === line.entryId) : undefined;
  if (line.authIndex) keys.push(`account:${line.authIndex}`);
  // An OpenAI-compatible entry is one account with several keys: any of its indexes names all its lines.
  if (entry?.store === 'api-key' && entry.keyIndex === null) {
    for (const index of entry.authIndexes) keys.push(`account:${index}`);
  }
  if (entry?.store === 'login') keys.push(`login:${entry.channel}`);
  else if (entry?.store === 'api-key') keys.push(`family:${entry.family}`);
  else if (line.access === 'sub') keys.push(`login:${normalizeOAuthProviderKey(line.provider)}`);
  if (isOpenRouterHost(line.host)) keys.push('openrouter');
  return keys;
}

const coolingNow = (item: NameItem) => item.lines.some((line) => line.cooldown !== null);

/** Whether a name passes the filter. A name with an edit not saved always does, so it never vanishes. */
export function matches(
  item: NameItem,
  filter: ModelsFilter,
  entries: readonly AliasEntry[]
): boolean {
  if (filter.view === 'several' && item.accounts < 2) return false;
  if (filter.view === 'cooling' && !coolingNow(item)) return false;
  if (filter.view === 'problems' && item.problems.length === 0) return false;
  if (filter.view === 'learned' && !item.learned) return false;
  if (filter.view === 'paid' && !paysWhileSubscribed(item)) return false;
  if (
    filter.provider !== 'all' &&
    !item.lines.some((line) => lineProviderKeys(line, entries).includes(filter.provider))
  ) {
    return false;
  }
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [
    item.name,
    ...item.lines.flatMap((line) => [line.upstream, line.provider, line.account, line.host]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

export interface NamesSummary {
  names: number;
  yours: number;
  /** Names Provimux can send to more than one account. */
  several: number;
  cooling: number;
  problems: number;
  /** Names a key learned from its service's list. */
  learned: number;
  /** Of them, those a subscription serves too while the key is tried first or shares the requests. */
  paid: number;
}

export function summarizeNames(items: readonly NameItem[]): NamesSummary {
  return {
    names: items.length,
    yours: items.filter((item) => sectionOf(item) === 'yours').length,
    several: items.filter((item) => item.accounts > 1).length,
    cooling: items.filter(coolingNow).length,
    problems: items.filter((item) => item.problems.length > 0).length,
    learned: items.filter((item) => item.learned).length,
    paid: items.filter(paysWhileSubscribed).length,
  };
}

// --- editing a name ---------------------------------------------------------------------------------

/** A model that can be put under a name: a login type's model, or a model an API key lists. */
export interface Candidate {
  key: string;
  entryId: string;
  store: 'login' | 'api-key';
  upstream: string;
  /**
   * Why it cannot be added to the name: already under it; the login serves it under its own name; or its
   * login type or key already answers the name with another model (Provimux would ignore, or never use,
   * the second row; an OpenAI-compatible entry pools them instead).
   */
  blocked: 'in-name' | 'own-name' | 'taken' | null;
}

/** Whether nothing can be written for a login type (2.5). */
const loginLocked = (draft: AliasDraft, entry: LoginEntry) =>
  entry.unread || loginMapUnread(draft.base);

/**
 * What can go under a name: every model each login type serves (from the routes), and every model each
 * API key lists, minus the login types' own aliases. A key without a model list offers nothing (its first
 * alias would replace its built-in list); a key turned off neither.
 */
export function candidatesFor(
  draft: AliasDraft,
  routes: ProvimuxModelRoutesResponse | null,
  targetKey: string
): Candidate[] {
  const entries = draftEntries(draft);
  const out: Candidate[] = [];
  const inName = (entry: AliasEntry, upstream: string) =>
    draft.rows.some(
      (row) =>
        row.entryId === entry.id &&
        !isBlankNewRow(row) &&
        row.upstream.trim() === upstream &&
        namesOf(row, entry, draft.base).includes(targetKey)
    );
  const taken = (entry: AliasEntry, upstream: string) =>
    !(entry.store === 'api-key' && entry.family === 'openai-compatibility') &&
    draft.rows.some(
      (row) =>
        row.entryId === entry.id &&
        !isBlankNewRow(row) &&
        row.upstream.trim() !== upstream &&
        (entry.store === 'login'
          ? row.alias !== null && nameKey(row.alias) === targetKey
          : namesOf(row, entry, draft.base).includes(targetKey))
    );
  const blockedOf = (entry: AliasEntry, upstream: string): Candidate['blocked'] =>
    entry.store === 'login' && nameKey(upstream) === targetKey
      ? 'own-name'
      : inName(entry, upstream)
        ? 'in-name'
        : taken(entry, upstream)
          ? 'taken'
          : null;
  for (const entry of entries) {
    if (entry.store === 'login') {
      if (loginLocked(draft, entry)) continue;
      const aliases = new Set(
        draft.base.rows
          .filter((row) => row.entryId === entry.id && row.alias)
          .map((row) => nameKey(row.alias!))
      );
      const models = new Set<string>();
      for (const model of routes?.models ?? []) {
        const served = model.routes.some(
          (route) =>
            route.kind === 'oauth' && normalizeOAuthProviderKey(route.provider) === entry.channel
        );
        if (served && !aliases.has(nameKey(model.id))) models.add(model.id);
      }
      for (const row of draft.rows) {
        if (row.entryId === entry.id && row.upstream.trim()) models.add(row.upstream.trim());
      }
      for (const upstream of [...models].sort()) {
        out.push({
          key: `${entry.id}\n${upstream}`,
          entryId: entry.id,
          store: 'login',
          upstream,
          blocked: blockedOf(entry, upstream),
        });
      }
      continue;
    }
    if (entry.listSource === 'none' || entry.disabled) continue;
    const upstreams = [
      ...new Set(
        draft.rows
          .filter((row) => row.entryId === entry.id && !isBlankNewRow(row))
          .map((row) => row.upstream.trim())
      ),
    ];
    for (const upstream of upstreams) {
      out.push({
        key: `${entry.id}\n${upstream}`,
        entryId: entry.id,
        store: 'api-key',
        upstream,
        blocked: blockedOf(entry, upstream),
      });
    }
  }
  return out;
}

/** aliases-page.md 2.5: whether a key's model list is a part the page could not read. */
export function keyListUnread(entry: KeyEntry, unread: readonly string[]): boolean {
  const group = `api-keys.${entry.family}[${entry.groupIndex}]`;
  return (
    unread.includes(`${group}.models`) ||
    (entry.keyIndex !== null && unread.includes(`${group}.keys[${entry.keyIndex}].models`))
  );
}

/**
 * API keys that list no models: they serve their built-in list, and cannot take a name here. A key whose
 * list the page could not read is not one of them (the line about unread parts names it).
 */
export const listlessKeys = (draft: AliasDraft): KeyEntry[] =>
  draftEntries(draft).filter(
    (entry): entry is KeyEntry =>
      entry.store === 'api-key' &&
      entry.listSource === 'none' &&
      !keyListUnread(entry, draft.base.unread)
  );

/**
 * Whether a row takes edits here (aliases-page.md 2.5): not a login row of a login type, or of a login
 * alias map, the page could not read whole.
 */
export function rowEditable(draft: AliasDraft, rowId: string): boolean {
  const row = draft.rows.find((r) => r.id === rowId);
  if (!row) return false;
  if (row.store !== 'login') return true;
  if (loginMapUnread(draft.base)) return false;
  const entry = draftEntries(draft).find((e) => e.id === row.entryId);
  return !(entry?.store === 'login' && entry.unread);
}

/**
 * Puts a model under a name. A login type gets an alias row (`fork` on: the model keeps its own name too);
 * an API key gets a second row for the model, so it keeps answering under the model's name as well. A
 * login model whose own name is the name is already under it: nothing is added.
 */
export function addToName(draft: AliasDraft, candidate: Candidate, name: string): AliasDraft {
  const target = name.trim();
  if (!target || candidate.blocked) return draft;
  const entry = draftEntries(draft).find((e) => e.id === candidate.entryId);
  if (!entry) return draft;
  if (entry.store === 'login') {
    return addLoginAlias(draft, entry.channel, {
      upstream: candidate.upstream,
      alias: target,
      fork: true,
    });
  }
  return addKeyAlias(draft, entry.id, candidate.upstream, target);
}

/** The rows that give a name as an alias (not a key's model under its own name). */
const aliasRowsOf = (draft: AliasDraft, key: string) =>
  draft.rows.filter((row) => row.alias !== null && nameKey(row.alias) === key);

/**
 * Renames a name: every alias row of it takes the new name. Routes that serve the name as the model's own
 * name (a login's built-in model, a model an API key lists without an alias) keep it.
 */
export function renameName(draft: AliasDraft, key: string, to: string): AliasDraft {
  const next = to.trim();
  if (!next || nameKey(next) === key) return draft;
  return aliasRowsOf(draft, key).reduce(
    (current, row) => changeRow(current, row.id, { alias: next }),
    draft
  );
}

/** Removes a name: every alias row of it goes (an API key's model goes back to its own name). */
export function removeName(draft: AliasDraft, key: string): AliasDraft {
  return aliasRowsOf(draft, key).reduce((current, row) => removeRow(current, row.id), draft);
}

/** Whether a line's row can be taken out of its name here. */
export function removable(draft: AliasDraft, line: RouteLine): boolean {
  if (!line.rowId || line.state === 'removed' || !rowEditable(draft, line.rowId)) return false;
  const row = draft.rows.find((r) => r.id === line.rowId);
  if (!row) return false;
  if (row.store === 'login') return true;
  if (row.alias !== null) return true;
  // A key's model under its own name: removing it would remove the model from the key's list.
  return draft.rows.some(
    (r) => r.id !== row.id && r.entryId === row.entryId && r.upstream.trim() === row.upstream.trim()
  );
}

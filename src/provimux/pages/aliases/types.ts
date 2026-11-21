/**
 * The Aliases page's data model (design `.github/provimux/design/aliases-page.md`, sections 2, 3 and 4).
 * Entries are where something is served; rows are stored model rows. Nothing here holds a key's secret
 * except `KeyEntry.storedGroup`, which is the data layer's own and is never rendered.
 */
import type { ProviderFamily } from '@/services/api/providers';

/** `login:<channel>`, `key:<host>` for a key with a base URL, `key:<family>` for one without. */
export type ServiceId = string;

export interface KeyEntry {
  store: 'api-key';
  /** `<family>/<groupIndex>/<keyIndex>`; OpenAI-compatible: `<family>/<groupIndex>/g`. Valid for one load. */
  id: string;
  family: ProviderFamily;
  groupIndex: number;
  /** null for an OpenAI-compatible entry. */
  keyIndex: number | null;
  groupName: string | null;
  /** `maskApiKey(apiKey)`; null for an OpenAI-compatible entry (it has `keyCount` keys). */
  keyPreview: string | null;
  keyCount: number;
  /**
   * The index the proxy injects at read time (`auth_index`, or `auth-index`), read from the stored key;
   * for an OpenAI-compatible entry, the entry's own (it has one only without keys). null when none.
   */
  authIndex: string | null;
  /**
   * Every index a route of this entry can carry: the key's; for an OpenAI-compatible entry, those of
   * all its keys, or the entry's own when it has none. A route is this entry's when its index is here.
   */
  authIndexes: string[];
  /** Lower-case host of the effective base URL, no port, path or user info; null without a base URL. */
  host: string | null;
  prefix: string | null;
  /** OpenAI-compatible: `disabled === true`. Others: `hasDisableAllModelsRule(excludedModels)`. */
  disabled: boolean;
  /** Where the effective model list is stored. 'none': no list, the key serves its built-in models. */
  listSource: 'key' | 'group' | 'none';
  service: ServiceId;
  /** The stored group as read, untouched. The data layer's own; never rendered: it holds the keys. */
  storedGroup: Readonly<Record<string, unknown>>;
}

export interface LoginEntry {
  store: 'login';
  /** `login/<channel>` */
  id: string;
  /** `normalizeOAuthProviderKey` of the stored key. */
  channel: string;
  /** The stored keys that normalize to `channel`, in file order (usually one). */
  spellings: string[];
  /** Login files of this type; null when the credentials list could not be read. */
  loginCount: number | null;
  service: ServiceId;
  /** The stored lists of the spellings, concatenated, untouched. */
  storedList: readonly unknown[];
}

export type AliasEntry = KeyEntry | LoginEntry;

export interface AliasRow {
  /** `<entry.id>#<sourceIndex>` for a stored row, `<entry.id>#new-<n>` for a row of the draft. */
  id: string;
  entryId: string;
  store: 'api-key' | 'login';
  /** Position in the entry's stored list (`storedList`, or the effective `models` list); null: not stored. */
  sourceIndex: number | null;
  /** The upstream model, `name`. */
  upstream: string;
  /** The alias; null when the row is served under its own name. */
  alias: string | null;
  /** Login rows only: the upstream name stays listed beside the alias. null for API-key rows. */
  fork: boolean | null;
  /** Answers name the alias instead of the upstream model. null: the row stores no value. */
  forceMapping: boolean | null;
  displayName: string | null;
}

export interface AliasState {
  entries: AliasEntry[];
  rows: AliasRow[];
  forceModelPrefix: boolean;
  /** ETag of the read; null when the browser could not read the header (writes are then unconditional). */
  etag: string | null;
}

// --- Section 3: the draft and its commit -------------------------------------------------------

export interface AliasDraft {
  base: AliasState;
  rows: AliasRow[];
  nextNew: number;
}

/** What `changeRow` may set (3.1). API-key rows: `alias` and `forceMapping` only. */
export type AliasRowPatch = Partial<
  Pick<AliasRow, 'upstream' | 'alias' | 'fork' | 'forceMapping' | 'displayName'>
>;

/** A new login alias (3.3). `fork` defaults to true, as in the old editor. */
export interface NewLoginAlias {
  upstream: string;
  alias: string;
  fork?: boolean;
  forceMapping?: boolean | null;
  displayName?: string | null;
}

export type CommitUnit =
  | { store: 'api-key'; family: ProviderFamily; entryIds: string[] }
  | { store: 'login'; entryIds: string[] };

export interface CommitOutcome {
  /** Entry ids written. */
  done: string[];
  failed: { entryId: string; reason: 'conflict' | 'invalid' | 'error'; message: string }[];
}

export type RowIssue =
  /** Login row: no upstream name or no alias. Blocks. */
  | 'incomplete'
  /** Login row: alias equals the upstream name; the proxy ignores it. Blocks. */
  | 'same-as-name'
  /** Login row: an earlier row of the channel has this alias (case-insensitive). Blocks. */
  | 'duplicate'
  /**
   * API-key row, not OpenAI-compatible: an earlier row of the entry has this client name; this row
   * never answers. Warning, does not block.
   */
  | 'shadowed';

// --- Section 4: one name, several services -----------------------------------------------------

export type Verdict = 'single' | 'several-keys' | 'several-models' | 'several-services';

export interface NameGroup {
  /** `nameKey` of the name. */
  key: string;
  /** As first written. */
  name: string;
  /** Rows of enabled entries that answer under this name, in entry order. */
  rowIds: string[];
  /** Distinct, sorted. */
  services: ServiceId[];
  /** Distinct upstream names (trimmed, case-insensitive), sorted. */
  upstreams: string[];
  /** several-models inside one OpenAI-compatible entry: a pool the user configured. */
  pool: boolean;
  /** 4.4; empty when served names are unknown. */
  nativeServices: ServiceId[];
  verdict: Verdict;
}

export interface ServedRoute {
  authIndex: string | null;
  kind: 'oauth' | 'apikey' | null;
  provider: string;
  host: string | null;
}

/** What the proxy serves per client name (`nameKey`), from `/provimux/model-routes`. */
export interface ServedNames {
  known: boolean;
  byName: Record<string, ServedRoute[]>;
}

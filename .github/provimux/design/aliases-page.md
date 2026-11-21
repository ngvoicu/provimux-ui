# One page for all model aliases (ALP-02)

Built: every step of section 8, the data layer (W1 to W6, `src/provimux/pages/aliases/`), the page (U1,
`/provimux/aliases`), the old address (U2) and the provider forms (U3). U3's checks against a running proxy are
not done yet.

A model alias is the name a client sends for an upstream model. Today aliases are edited in two forms (each API-key
provider's model list; the login alias sub-page). This design moves alias editing to one Provimux page,
`/provimux/aliases`, which is **a view and an editor over the configuration that exists**: no new store, no change
to the proxy, no change to the configuration's format. The provider form keeps its model list and loses only the
alias field. The rule of ALP-01 holds everywhere: an alias exists only because someone typed it.

Read against: provimux-ui published `main` `42bb2925` (`fd72458a` plus ALP-01); the proxy (Provimux)
`provimux/main` `30772047`, which the owner will run, and `local` `4c071f30`. The proxy's alias rules are the same
in both branches. **The design is for a proxy that has Provimux's own endpoints** (`/provimux/model-routes`); a
proxy without them is a fallback the page survives, not a case it is shaped around. Paths in the proxy are
written `proxy:<path>`.

Contents: 0 four facts · 1 contracts · 2 row model · 3 operations · 4 one name, several services · 5 the forms ·
6 files · 7 tests · 8 steps · 9 open decisions and known limits · appendix: the Vertex check.

## 0. Four facts the design rests on

1. **The console writes through the v8 configuration tree.** `AGENTS.md` forbids the v0 API. The handlers in
   `proxy:internal/api/handlers/management/config_lists.go` (`PutVertexCompatKeys`, `PatchOAuthModelAlias`, …) are
   registered only under `/v0/management`, deprecated. Every alias read and write of the console is one handler,
   `ConfigV8` (`proxy:internal/api/handlers/management/config_v8.go`), under `/v8/management/config`.
2. **The proxy does not require an alias on a Vertex-style row.** The rule "name or alias empty: row dropped" is
   `normalizeVertexCompatKey`, in the v0 file. On the v8 path a row with a name alone is kept, listed and served
   under its name (proof in 5.2). What deletes such rows today is the console: `serializeVertexModelAliases`
   (`src/services/api/providers.ts`) leaves them out of the request, without a message. That is a fault, and this
   design fixes it. The login rule is real: a row whose alias is empty, equals its name, or repeats an earlier
   alias of its channel is ignored at load (`SanitizeOAuthModelAlias`,
   `proxy:internal/config/config_normalization.go`).
3. **There is a third alias store**, per login file: the list `model_aliases` inside the file, written with
   `PATCH /credentials/fields`, edited in Auth Files → a login's editor (`AuthFilePolicyFields`). The proxy reads
   it before the login-type list (`oauthModelAliasesForAuth`, `proxy:sdk/cliproxy/service_models.go`): for one
   alias the file's row wins; the login-type rows with other aliases still apply. `GET /credentials` does not
   return it; the only read is the download of the whole login file, tokens included. **This page never downloads
   a login file.** It does not show or write these aliases and says so (5.3).
4. **The existing login alias editor loses fields.** It reads only `name`, `alias`, `fork`, `force-mapping`
   (`normalizeOauthModelAlias`, `src/services/api/authFiles.ts`) and replaces the channel's list, so every save of
   a channel deletes `display-name` and `openapi` from all of that channel's rows. The new page must not (3.3).

## 1. The contracts

All paths are under `/v8/management`. `apiClient` adds the prefix and the key.

### 1.1 The configuration tree

| Request | Answer | Notes |
| --- | --- | --- |
| `GET /config` | 200, the whole document as JSON, v8 names. Headers `ETag: "<sha-256 of the file>"`, `Cache-Control: no-store` | holds both stores and `routing.force-model-prefix`; read from the file at each request, so a hand edit is seen |
| `GET /config/<path>` | 200 the value; 404 `{"error":"not_found"}` when the file has no such key | same `ETag` |
| `PUT /config/<path>` | 200 `{"status":"ok","config-version":8}` and the new `ETag` | the node at `<path>` is **replaced whole** |
| `PATCH /config/<path>` | same | mappings are merged key by key; a list in the body replaces the list |
| `DELETE /config/<path>` | same; 404 when absent | empty parents of the removed key are removed too |

- A path names YAML keys, never list positions ("Paths identify YAML keys, never array indexes. Lists are replaced
  whole", `config_v8.go`). **No request changes one row of a list.**
- Any write may carry `If-Match: <ETag>`. When the file changed since that tag, by another tab, another client or
  an editor: 412 `{"error":"precondition_failed"}` with the current `ETag`, and nothing is written. Without the
  header the write is unconditional. The check and the write are under one mutex in the handler. The proxy exposes
  `ETag` to cross-origin pages and accepts `If-Match` in preflight (`proxy:internal/api/server_middleware.go`).
  The console never sends `If-Match` today.
- A write is validated as a whole document (400 or 422 `{"error":"invalid_config","message":…}`), written to the
  file as given (rows the proxy ignores stay in the file), and the proxy reloads.
- A read adds the key's auth index as **`auth_index`** (underscore; `config_auth_index.go`,
  `injectV8APIKeyAuthIndexesLocked`) to every API key; an OpenAI-compatible entry gets it on each of its keys, and
  on the entry itself only when it has no keys. A write strips both `auth_index` and `auth-index`. The index is not
  configuration: it exists while the proxy's auth manager lists the key. Upstream's normalizer reads only
  `auth-index`, so the page reads the index from the stored objects itself (2.2). (Corrected in ALP-03, decision
  of 2026-11-20 by the chief with the owner's approval.)

### 1.2 Store A: API-key providers

`api-keys.<family>` with `<family>` one of `gemini`, `interactions`, `codex`, `claude`, `xai`, `meta`, `vertex`,
`openai-compatibility`. Each is a list of groups:

```yaml
api-keys:
  claude:
    - name: claude-1            # group
      base-url: …               # optional; belongs to the group
      models: [ … ]             # optional: the list every key of the group inherits
      keys:
        - api-key: …
          models: [ … ]         # optional: replaces the group's list for this key (null = inherit)
  openai-compatibility:
    - name: openrouter          # one entry = one group; its keys carry no models
      base-url: …
      models: [ … ]
      keys: [ { api-key: … } ]
```

A model row: `name` (upstream model), optional `alias`, and options that belong to the model, not to the alias
(`display-name`, `max-context-length`, `force-mapping`, `is-compat`, `thinking`, `priority`; `image`,
`input-modalities`, `output-modalities`, `use-max-completion-tokens` for OpenAI-compatible; `openapi` for Vertex;
`support-configuration-update` for Codex, xAI, Meta).

- **Read**: `GET /config`, then `api-keys.<family>`. Upstream's reader is `readProviderGroups` +
  `normalizeProviderGroups` (`providers.ts`, `transformers.ts`): one entry per key with the effective values (key
  over group).
- **Write**: `PUT /config/api-keys/<family>` with **the family's whole group list**: every group, every key, every
  field. Upstream's writers are `providersApi.update<Family>Config` and `providersApi.updateOpenAIProvider`: each
  reads `GET /config` again, finds the entry by the snapshot taken when the form opened (`locateProviderGroup`; if
  the entry is gone, changed or ambiguous it throws "Provider configuration changed or is ambiguous; refresh and
  try again."), writes only the differing fields onto the stored rows, and sends the list, without `If-Match`.
- **What the list means at run time** (`proxy:sdk/cliproxy/service_models.go`):

  | Family | Empty list | A row |
  | --- | --- | --- |
  | gemini, interactions, claude, codex, xai, meta, vertex | the key serves the family's built-in list | served under `alias`, or under `name` when there is no alias |
  | openai-compatibility | the entry serves nothing from the configuration | same |

  A non-empty list **replaces** the built-in list. `alias` equal to `name` is the same as no alias. Two rows of one
  entry with the same client name: OpenAI-compatible pools their upstream models
  (`resolveModelAliasPoolFromConfigModels`); in every other family the first row answers and the later one never
  does. With a `prefix`, each client name is also served as `<prefix>/<name>`, and only so when
  `routing.force-model-prefix` is true (`applyModelPrefixes`).

### 1.3 Store B: logins

`oauth.model-alias`: a map from login type ("channel": `claude`, `codex`, `antigravity`, `vertex`, `aistudio`,
`kimi`, `xai`, `meta`, or an OAuth plugin's key) to a list of rows `name`, `alias`, optional `fork`,
`force-mapping`, `display-name`, `openapi` (`OAuthModelAlias`, `proxy:internal/config/config_types.go`).

- **Read**: `GET /config` then `oauth.model-alias`, or `GET /config/oauth/model-alias` (404 = no aliases).
  Channel keys come back as written in the file; the proxy lower-cases them; the console also maps `_` to `-` and
  known synonyms (`normalizeOAuthProviderKey`).
- **Write (upstream)**: `authFilesApi.saveOauthModelAlias(channel, rows)`: `GET /config/oauth/model-alias`, drop
  every spelling of the channel, add the list under the normalized key, `PUT /config/oauth/model-alias` with **the
  whole map**, without `If-Match`. Writes of one browser tab are queued (`queueOauthMapWrite`).
- **Run time** (`applyOAuthModelAliasEntries`): the alias is added to the login type's model list; the upstream
  name stays listed only when a row for it has `fork: true`; `display-name` names the alias in model lists;
  `force-mapping` rewrites the model field of answers to the alias.

### 1.4 Two edits at once, and If-Match

Every alias write replaces a list far larger than the edit: store A the family's every group, key and field; store
B every login type's aliases. A writer that read before another writer's save and writes after it silently undoes
that save.

| Writer | Guard | Window left |
| --- | --- | --- |
| provider form, store A (upstream) | entry snapshot from the form's opening, compared with a fresh read just before the write | the round trip between that read and the write; no queue between two saves of one tab |
| old login alias page, store B (upstream) | fresh read before each write; one tab's writes queued | the same round trip; nothing across tabs |
| **the Aliases page, both stores** | fresh read, comparison of every entry it changes with what the page loaded, then **`If-Match` with that read's `ETag`** | none: a write lands only on the exact file it read |

**The page sends `If-Match` on every write.** A second tab, another client, or a hand edit of the file between the
page's read and its write gives 412 and no write. This is why the page has its own writer for store A (3.2):
upstream's writer cannot carry the header without edits in `providers.ts`. The provider form's own saves stay
unconditional, as today (section 9).

### 1.5 Requests the page reads besides the configuration

- `GET /credentials` (`authFilesApi.list`): the login files' types and counts. The list, never a file's content.
- `GET /routing/model-definitions/<channel>` (`authFilesApi.getModelDefinitions`): a login type's built-in model
  names, offered when adding a login alias. Free text stays allowed.
- `GET /provimux/model-routes?model=<a>&model=<b>…` (`provimuxApi.modelRoutes`): per client name, the credentials
  that serve it now (4.4). Provimux has it; on another proxy it answers 404 and the page falls back (4.4).

## 2. The row model

The page shows **entries** (where something is served) and **rows** (one stored model row). All types live in
`src/provimux/pages/aliases/types.ts`.

```ts
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
  /** The stored key's `auth_index`, else `auth-index` (for OpenAI-compatible: the entry's own); null if none. */
  authIndex: string | null;
  /** Every index a route of this entry can carry: the key's; OpenAI-compatible: all its keys' (the entry's own
   *  when it has no keys). */
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
  /** 2.5: the map, or a spelling's list, is present and not readable: nothing can be added, never written. */
  unread: boolean;
}

export type AliasEntry = KeyEntry | LoginEntry;

export interface AliasRow {
  /** `<entry.id>#<sourceIndex>` for a stored row, `<entry.id>#new-<n>` for a row of the draft. Valid for one load, as the entry's id (3.6). */
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
  /** 2.5: the parts the page cannot read, by path (such as `api-keys.claude[2]`). */
  unread: string[];
}
```

### 2.1 What belongs to the alias, what to the model

| Field | API-key row | Login row |
| --- | --- | --- |
| `alias` | the page edits it | the page edits it |
| `force-mapping` | of the alias: the page edits it. The provider form's advanced field stays too (same stored field; no upstream file is edited to remove it) | of the alias: the page edits it |
| `fork` | does not exist. "Keep the upstream name too" is a second row without alias (3.2) | of the alias: the page edits it; a new row starts `true`, as in the old editor |
| `display-name` | of the model row (it names the row with or without alias): shown, edited in the provider form | exists only on the alias row: the page shows and edits it |
| `openapi`, `thinking`, limits, modalities, `priority`, anything unknown | of the model: kept, not shown | kept, not shown |

### 2.2 Store A → rows

`readAliasState(document, files)` in `rows.ts`, pure:

1. For each family: `groups = familyGroups(document, family)` and `normalizeProviderGroups(groups, family
   === 'openai-compatibility')` for the effective display values (key, base URL, prefix, exclusions). One
   `KeyEntry` per normalized entry, ordered by family (the order of 1.2), `groupIndex`, `keyIndex`;
   `storedGroup = groups[groupIndex]`. `authIndex` and `authIndexes` are read from the stored key (entry), as
   `auth_index` falling back to `auth-index`, not through the normalizer (1.1).
2. The effective list is the stored key's `models` when that is present and not null, else the group's; for
   OpenAI-compatible, the group's. `listSource` is `'none'` when it gives no row, otherwise `'key'` or `'group'`
   by where it came from.
3. One `AliasRow` per element of the effective list that is an object with a non-empty trimmed `name`;
   `sourceIndex` is the element's position. `alias` is null when the stored alias is empty or equals `name` after
   trimming. `forceMapping` is the stored boolean of `force-mapping` or null; `displayName` the string of
   `display-name` or null; `fork` is null. Other elements are not rows and are written back where they were.
4. An entry with `listSource: 'none'` has no rows. **The page cannot give it an alias**: writing a first row would
   replace the built-in list by that one row. `listSource` tells the page, which sends the user to the provider
   form to list the models first.

### 2.3 Store B → rows

1. `map = document.oauth?.['model-alias'] ?? {}`. Keys are grouped by `normalizeOAuthProviderKey`; each group is one
   `LoginEntry`, plus one (without rows) for every login type that has a login file in `GET /credentials` and no
   key in the map. Entries are ordered by channel.
2. One `AliasRow` per element of `storedList` that is an object, **including rows the proxy ignores** (they get
   an issue, 3.5). `upstream` and `alias` are the trimmed strings (`alias` null when empty), `fork` is
   `fork === true`, `forceMapping` the stored boolean or null, `displayName` the trimmed string or null. Elements
   that are not objects are not rows and are written back where they were.

### 2.4 Rows → stores

Both writers work on **the stored objects as read**, never on a re-serialized form. A row that did not change is
written exactly as it was read; a changed row is its stored object with only these keys touched:

| Key | Store A | Store B |
| --- | --- | --- |
| `alias` | set (trimmed); **removed** when the row has no alias, in every family, Vertex included | set (trimmed); a row cannot be without one |
| `name` | never | set (trimmed) |
| `force-mapping` | `true` set; `false` written when the row stored a value, else the key removed | the same |
| `fork` | never | `true` set; else the key removed |
| `display-name` | never | set (trimmed), or removed when empty |
| every other key | untouched | untouched |

A new row is `{ name, alias }` (store B: plus the optional keys above). This is the whole mapping; no field the
page does not show can be lost, because the page never builds a row from its own fields.

### 2.5 What the page cannot read

The file can be edited by hand, so any part can have a shape this design does not describe. One rule, at every
level and in both stores: **a part the page cannot read gives no entry and no row, is named in `AliasState.unread`
by its path, stays in the file exactly as it is, and never stops the page from reading or writing the rest.** No
function of the data layer throws on the document's shape.

| Part | Not readable when | What follows |
| --- | --- | --- |
| `api-keys.<family>` | present and not a list | no entries, so it is never written |
| a group | not an object with a `keys` list | no entry; sent back in its place |
| a key (OpenAI-compatible: the entry) | upstream's normalizer gives nothing for it | the same |
| a model list, a channel's list | present, not null, not a list | no rows; nothing can be added (`listSource: 'none'`, `LoginEntry.unread`) |
| an element of a list | store A: not an object with a name; store B: not an object | no row; sent back in its place |
| `oauth.model-alias` | present and not a map | every login entry is `unread`; the map is never written |

`api-keys` or `oauth` itself present and not a map is named by that path, and is the same as every family, or the
map, not readable.

`familyGroups(document, family)` (`rows.ts`) is the family's list as stored, or `[]` when absent or not a list. If
upstream's normalizer throws on a family, the whole family is unread. The commit uses the same readers on its fresh
read: a family that is no longer a list gives `locate` nothing to find, and a map or channel no longer readable is
not `sameChannel`. Both are a `conflict`, without a request.

## 3. The operations

The page holds **one draft** over a loaded `AliasState` and commits it with one action. Operations are pure
functions in `draft.ts`: `(draft, …) => draft`. Nothing is requested until `commit`.

```ts
export interface AliasDraft { base: AliasState; rows: AliasRow[]; nextNew: number }

export function startDraft(state: AliasState): AliasDraft;
/** Change: alias, forceMapping; fork and displayName for login rows; upstream for login rows and new rows. */
export function changeRow(draft: AliasDraft, rowId: string, patch: AliasRowPatch): AliasDraft;
/** Add a second client name for a model an API-key entry already lists. */
export function addKeyAlias(draft: AliasDraft, entryId: string, upstream: string, alias: string): AliasDraft;
/** Add a login alias. fork defaults to true. */
export function addLoginAlias(draft: AliasDraft, channel: string, row: NewLoginAlias): AliasDraft;
/** Remove: see 3.2 and 3.3 for what it means per store. */
export function removeRow(draft: AliasDraft, rowId: string): AliasDraft;
export function discard(draft: AliasDraft): AliasDraft;
export interface LostEdit { kind: 'changed' | 'added' | 'removed'; before: AliasRow | null; after: AliasRow | null }
export interface Rebased {
  draft: AliasDraft;
  /** Old entry id -> the same entry's id in the fresh state, for every entry carried. */
  carried: Record<string, string>;
  /** Entries with edits neither written nor carried: the old entry and its edits. */
  lost: { entry: AliasEntry; edits: LostEdit[] }[];
}
export function rebase(draft: AliasDraft, state: AliasState, written: string[]): Rebased;
```

### 3.1 Change

Sets fields of one row in the draft. For an API-key row only `alias` and `forceMapping` can change; `upstream`
cannot (which models a key serves is the provider form's). Setting `alias` to an empty string or to the row's
upstream name makes it null.

### 3.2 Store A: add, remove, the request

- **Add** (`addKeyAlias`): only for an entry with rows and an `upstream` that one of its rows already has. The new
  row `{ upstream, alias }` is placed after the entry's last row with that upstream name. It copies no options:
  options are per row and are edited in the provider form.
- **Remove** (`removeRow`):
  - when another row of the entry has the same upstream name, the row is deleted (the key still serves the model);
  - otherwise the row stays and its alias becomes null. The page never removes the last row of a model.
- **Request**: one per family that has changed entries, whatever their number:

  ```ts
  const read = await apiClient.getRaw('/config');                  // the fresh document and its ETag
  const groups = familyGroups(read.data, family);
  for (const entry of changedEntriesOf(family)) {
    const g = locate(groups, entry);                               // -1: this entry is a conflict, left out
    if (g >= 0) groups[g] = withModels(groups[g], entry, draftRowsOf(entry));
  }
  await apiClient.put(`/config/api-keys/${family}`, groups,
    etag ? { headers: { 'If-Match': etag } } : undefined);         // not sent when every entry conflicted
  ```

  - `locate`: the index `entry.groupIndex` when the fresh group there deep-equals `entry.storedGroup`, both compared
    with `auth_index` and `auth-index` stripped (injected at read time, never a conflict); otherwise
    the single index whose group does; otherwise -1. Any change to the group since the page loaded is a conflict
    for its entries.
  - `withModels`: the effective list (2.2) with the rows' changes applied by the table of 2.4, new rows inserted,
    removed rows taken out, non-row elements in place. It is stored on **the key** (`keys[keyIndex].models`), and
    on the group for OpenAI-compatible. A key that inherited its group's list thereby gets its own; the group's
    list stays for the group's other keys.

**Proof that the written configuration is the old editor's.** Test A-1 (section 7): for each family and each
operation, upstream's writer is run as the provider form runs it (one `providersApi.update…` per changed entry,
each answered from the state the previous one wrote) and the page's `commit` is run on the same canned document;
the final stored family is compared as JSON, `auth_index` and `auth-index` aside (the server strips them). They are equal. That
includes where the list lands: upstream's writer also gives an inheriting key its own list. The differences, each
on purpose and each tested:

1. the page sends one request per family, with `If-Match`; upstream one per entry, without;
2. upstream removes `test-model`, an old console-only field, from the family on any write (`putGroups`); the page
   leaves stored fields it does not own as they are;
3. Vertex: before the fix of 5.2 upstream deleted every alias-less row of a key when one of its models changed.
   With the fix both keep them, and the two agree.

### 3.3 Store B: add, remove, the request

- **Add** (`addLoginAlias`): a new row for a channel (an existing `LoginEntry`, or a new one for a channel name
  the user gives). It returns the draft unchanged for an `unread` entry, and for every channel when the map is
  not readable (2.5). **Remove**: the row is deleted; the upstream name is then served under its own name again.
- **Request**: one for all changed channels:

  ```ts
  const read = await apiClient.getRaw('/config');
  const map = { ...(read.data?.oauth?.['model-alias'] ?? {}) };
  for (const entry of changedChannels()) {
    if (!sameChannel(map, entry)) continue;                        // changed since the page loaded: conflict
    replaceChannel(map, entry, writtenRowsOf(entry));              // every other key untouched
  }
  await apiClient.put('/config/oauth/model-alias', map,
    etag ? { headers: { 'If-Match': etag } } : undefined);
  ```

  `sameChannel`: the fresh lists of the channel's spellings, concatenated, deep-equal `entry.storedList`, compared
  with `auth_index` and `auth-index` stripped as in `locate`. It is false when the map or a spelling's value is not
  readable (2.5).
  `replaceChannel` removes every spelling of the channel and, when rows remain, sets the list under the
  normalized key: the old editor's rule (`updateOauthProviderMap`). When no channel remains the body is `{}`, as
  the old editor sends.

**Proof.** Test B-1: for the same edit, upstream's `authFilesApi.saveOauthModelAlias` / `deleteOauthModelAlias`
and the page's writer run against the same canned read, and the two `PUT /config/oauth/model-alias` bodies are
compared as JSON (maps unordered, lists ordered). They are equal **on `name`, `alias`, `fork` and
`force-mapping` of every row of every channel**. The differences, each on purpose and each tested:

1. the page keeps `display-name`, `openapi` and unknown fields of rows it did not remove; the old editor deletes
   them (section 0, fact 4);
2. the page never drops a stored row silently: a row the old editor would have discarded while reading (no name
   or no alias) is shown with an issue and blocks the commit until it is fixed or removed;
3. the page sends `If-Match`, and one request for all channels where the old editor sent one per channel.

### 3.4 Commit

```ts
export type CommitUnit =
  | { store: 'api-key'; family: ProviderFamily; entryIds: string[] }
  | { store: 'login'; entryIds: string[] };
export interface CommitOutcome {
  done: string[];                                         // entry ids written
  failed: { entryId: string; reason: 'conflict' | 'invalid' | 'error'; message: string }[];
}
export function planCommit(draft: AliasDraft): CommitUnit[];
export const aliasesApi: {
  load(client?: Client): Promise<AliasState>;
  commit(draft: AliasDraft): Promise<CommitOutcome>;
};
```

- `planCommit`: one unit per family with an entry whose draft rows differ from its base rows, in the family order
  of 1.2, then one unit for the logins when a channel differs. While any such entry has a row with a blocking
  issue (3.5), `commit` refuses the whole draft and requests nothing, as the old editor's save did.
- `commit` runs the units **one after another**, each guarded by `guardConfigConnection()`. A unit is: read,
  locate, write (3.2, 3.3). A failed unit does not stop the next. The units are not one transaction: each is
  atomic by itself.
- **412**: the file changed between the unit's read and its write. The unit is run **once more** from its read
  (the change may be elsewhere in the file; entries that still match are written). A second 412 fails every entry
  of the unit as `conflict`.
- `conflict` is also an entry that `locate` or `sameChannel` did not find unchanged. `invalid` is a 400 or 422
  from the server, with its message. Everything else is `error`.
- After `commit` the page calls `load()` again and `useConfigStore.getState().clearCache()`, so other pages do
  not show the old configuration, then `rebase(draft, state, outcome.done)` (3.6).
- `load()` is `apiClient.getRaw('/config')` (document and `ETag`) and `authFilesApi.list()`; if the credentials
  list fails, `loginCount` is null and the page still works. `etag` null (a browser that cannot read the header)
  is shown by the page as "saves are not protected against a change made elsewhere".

### 3.5 Issues

```ts
export type RowIssue =
  | 'incomplete'      // login row: no upstream name or no alias. Blocks.
  | 'same-as-name'    // login row: alias equals the upstream name; the proxy ignores it. Blocks.
  | 'duplicate'       // login row: an earlier row of the channel has this alias (case-insensitive). Blocks.
  | 'shadowed';       // API-key row, not OpenAI-compatible: an earlier row of the entry has this client name;
                      // this row never answers. Warning, does not block (the form never checked it).
export function rowIssues(draft: AliasDraft): Record<string, RowIssue>;   // by row id
```

A new row with neither name nor alias is not a row yet: no issue, not written. The three blocking issues are the
old editor's (`getAliasRowIssues`), which are the proxy's drop rules.

### 3.6 Rebase: a row belongs to the read it came from

Entry ids, row ids and `sourceIndex` are positions in one read of the file. They say which stored object a row is
only together with the state they were read from. **So a row is never moved to another state by its id or its
position.** `rebase` moves an entry's edits to a fresh state only through the entry's stored content.

- **The same entry** in the fresh state is an entry with equal stored content, compared as `locate` and
  `sameChannel` compare (`sameConfig`).
  - API key: a fresh `KeyEntry` of the same `family` and `keyIndex` whose `storedGroup` equals the old one's: the
    one at the old `groupIndex` when that one does, otherwise the only one that does, otherwise none.
  - Login: the fresh `LoginEntry` of the same `channel`, readable (2.5), whose `storedList` equals the old one's.
    A channel without an entry has an empty list, on either side.
- **Carried**: an entry with edits (`entryChanged`) that is not in `written` and is the same entry in the fresh
  state. Its draft rows are kept under the fresh entry's id (`entryId`, and `id` rebuilt from it; `sourceIndex`
  and the `new-<n>` numbers unchanged), in the fresh entry's place.
- **Lost**: an entry with edits that is not in `written` and is not the same entry in the fresh state: changed
  elsewhere, gone, or no longer the only one alike. It takes the fresh rows. Its edits are returned in `lost`,
  each as the base row and the draft row (`changed`: both; `added`: the draft row; `removed`: the base row).
  Nothing of them is in the new draft.
- Every other entry takes the fresh rows.

After any `rebase`, each draft row with a `sourceIndex` stands, in `draft.base`, on a stored object equal to the
one it was read from. With `locate` at commit, a write changes only the row the user edited.

## 4. "One name, several services"

### 4.1 Client names of a row

`clientNames(row, entry, forceModelPrefix)` in `collisions.ts`:

- `base = row.alias ?? row.upstream`, trimmed;
- API-key row: `[base]` without prefix; `[base, prefix + '/' + base]` with one; only `[prefix + '/' + base]` when
  `forceModelPrefix` and `prefix !== base`;
- login row: `[base]` (a login file's own prefix is not in the configuration; 4.4 covers what is served).

Names are compared after `trim().toLowerCase()` (`nameKey`); the proxy resolves aliases without regard to case.

### 4.2 Service

`service` of an entry: `login:<channel>` for a login type; for an API-key entry `key:<host>` when it has a base
URL, `key:<family>` when it has none (the family's own endpoint). Two keys, or two entries, with one host are one
service. A login and an API key are never one service, even of one vendor: they are billed apart and do not share
a prompt cache.

### 4.3 The rule

```ts
export type Verdict = 'single' | 'several-keys' | 'several-models' | 'several-services';
export interface NameGroup {
  key: string;             // nameKey
  name: string;            // as first written
  rowIds: string[];        // rows of enabled entries that answer under this name, in entry order
  services: ServiceId[];   // distinct, sorted
  upstreams: string[];     // distinct upstream names (trimmed, case-insensitive), sorted
  pool: boolean;           // several-models inside one OpenAI-compatible entry: a pool the user configured
  nativeServices: ServiceId[]; // 4.4; empty when served names are unknown
  verdict: Verdict;
}
export function nameGroups(draft: AliasDraft, served?: ServedNames): NameGroup[];
export function groupOfRow(groups: NameGroup[]): Record<string, string>;  // row id -> group key
```

For each `nameKey`, over the draft's rows of entries with `disabled === false`, leaving out rows with a blocking
issue and rows that are `shadowed`:

1. `services` = the distinct services of those rows' entries, plus `nativeServices`;
2. **`several-services`** when `services.length > 1`. This is the problem the page exists for: two services
   answer under one name, a client cannot tell which, and their prompt caches are separate;
3. else **`several-models`** when `upstreams.length > 1`: one service, but the name stands for different upstream
   models. `pool` is true when all the rows are in one OpenAI-compatible entry;
4. else **`several-keys`** when `rowIds.length > 1`: several keys or entries of one service serve one model under
   one name. **Not a problem**: that is load sharing;
5. else **`single`**.

Also not a problem, by construction: the same alias on a disabled entry; an alias and its own `<prefix>/` form;
one alias repeated across the keys of one group.

The page is told both ways: the list of groups, and per row the key of its group (`groupOfRow`), so it can mark a
row or gather a group. The rule runs on the **draft**, so a collision is seen before anything is written. It does
not block a commit: sharing a name across services can be meant.

### 4.4 Names served natively

The rows cannot know a name that no configuration row states: a login's built-in model names, a login file's own
aliases (the third store), the built-in list of a key without a model list. The most likely collision is of that
kind: an alias chosen to equal a model name a login already serves.

```ts
export interface ServedNames { known: boolean; byName: Record<string, ServedRoute[]> }  // by nameKey
export interface ServedRoute { authIndex: string | null; kind: 'oauth' | 'apikey' | null; provider: string;
                               host: string | null }
export function loadServedNames(names: string[], client?: Client): Promise<ServedNames>;
```

- **The normal case, Provimux**: `loadServedNames` is `provimuxApi.modelRoutes(client, names)` for the distinct
  client names of the draft's rows (none: no request), asked at load, after each commit, and again when the
  draft's set of client names changes (debounced; a late answer for an older set is dropped). For a group,
  `nativeServices` is
  the set of services of the routes of that name that the rows do not account for. A route is accounted for when
  the **base** state has a row with this client name in the route's entry (API key: the entry whose `authIndexes`
  include the route's `auth_index`, one rule for a key and for an OpenAI-compatible entry; login: the channel equal to `normalizeOAuthProviderKey(route.provider)`). The service of a
  route: `login:<that channel>` for `oauth`; `key:<host>` for `apikey` with a host, `key:<provider>` without; a
  route with `kind` null is ignored. `nameGroups` adds them to `services` (4.3, step 1).
- **The fallback, a proxy without the endpoint** (stock CLIProxyAPI, or a build older than `provimux/main`):
  when Provimux's presence store already says `modelRoutes` is `unsupported`, no request is made; a 404 or any
  failure gives the same result, `{ known: false, byName: {} }`. `nativeServices` is empty, the verdicts cover
  the configuration's rows only, and the page says in one line that names served without a configuration row
  were not checked. That line is the whole fallback: nothing else on the page depends on the endpoint, and the
  route and the nav item are not gated by it.

## 5. What the forms keep and lose

### 5.1 The provider form, per provider kind

The model list stays in every form: adding, removing and renaming model rows, the model discovery, the advanced
fields of a row. Only the alias field goes. `ModelEntriesEditor` is the one editor behind the standard form
(`BaseProviderForm`), the sponsor forms (`SponsorProviderForm`) and a login's own aliases (`AuthFilePolicyFields`,
with `oauthAliasOnly`); the change is made there once.

| Kind | Loses | Keeps | Note |
| --- | --- | --- | --- |
| gemini, interactions, claude, codex, xai, meta | the alias field of a row | the list, the advanced fields, discovery | a new row is saved with a name only |
| openai-compatibility and the sponsor forms | the alias field | the same, and the image switch | the same |
| vertex | the alias field | the same | the same, once the fault of 5.2 is fixed |
| a login's own aliases (`oauthAliasOnly`) | nothing | everything | the third store, 5.3 |

Per row, where the alias field was, the form shows the row's alias as text when it has one (`entry.alias`
non-empty and different from the name). Above the list one line, `ProvimuxAliasesLine`: "N aliases" (N = rows of
this list with such an alias; "No aliases" for 0) and a link to `/provimux/aliases?family=<family>`, a router
link in the same tab: leaving a form with unsaved input behaves as any navigation away from it does today. The
form's state still holds each row's alias as loaded and saves it back unchanged; a form opened before an alias
was changed on the page fails its save with upstream's "changed or is ambiguous" message instead of undoing the
page.

### 5.2 Vertex-style rows

- **Now**: a Vertex row is saved only with both a name and an alias. A row with a name alone disappears on save
  without a message, though the proxy serves such a row under its name. The form does not say the alias is
  required.
- **After**: the fault is fixed where it is, in `serializeVertexModelAliases` (two changed lines, section 6): a
  row is written when it has a name, and its `alias` only when it has one. The user enters the model name in the
  provider form, as for every other kind; an alias is given on the Aliases page, and only if someone types it.
  Removing it there removes the key (2.4). Rows stored earlier with `alias` equal to `name` (how such rows had to
  be written until now; upstream's test "Vertex same-name alias survives…" covers them) keep working and are
  shown as having no alias.
- **What proves the proxy serves a name-only row under its name.** Three functions, and a run of them:
  1. load: `SanitizeVertexCompatKeys` (`proxy:internal/config/vertex_compat.go`) keeps a model row when its name
     is not empty; the alias is only trimmed;
  2. listing: `buildVertexCompatConfigModels` (`proxy:sdk/cliproxy/service_models.go`) has its own branch for an
     empty alias (`id = alias`, and `id = name` when that is empty), as has the shared
     `buildConfiguredModelInfo`;
  3. routing: `resolveUpstreamModelForVertexAPIKey` → `resolveModelAliasFromConfigModels`
     (`proxy:sdk/cliproxy/auth/oauth_model_alias.go`) matches aliases first and then names, and returns the name.

  On 2026-11-20 these were run on the proxy's `local` `4c071f30`, the code the owner's proxy is built from, with
  two unit tests kept outside the tree (`go test -overlay`; the repository and the running proxy untouched): a
  v8 document with a Vertex key listing `gemini-x` without alias and `gemini-y` as `why` parses with both rows
  kept, lists the ids `gemini-x` and `why`, and a request for `gemini-x` resolves to `gemini-x`. Both pass; the
  tests are in the appendix. The three files do not differ between `local` and `provimux/main`. Not proved by
  this: an end-to-end request through a running proxy; step U3 asks for that check.
- The deprecated v0 handlers would still drop such a row if something wrote `vertex-api-key` through
  `/v0/management`. The console does not.

### 5.3 The login pages, and the aliases this page does not show

- `/auth-files`: the "model aliases" entry tile (`ModelRulesEntry`) **is** the read-only line: it already shows
  the number of mappings and login types and leads to the alias address. No file there changes.
- `/auth-files/oauth-model-alias` **leads to `/provimux/aliases?store=login`**, and
  `…/oauth-model-alias?provider=<p>` to `/provimux/aliases?store=login&channel=<p>` (`AliasesRedirect`, replace,
  no history entry). The tile, the "aliases" switch on the exclusions page and old links all arrive there.
- `/auth-files/oauth-excluded` is unchanged.
- **A login file's own aliases stay in that login's editor**, unchanged. The Aliases page shows, with its login
  rows and whenever there is a login entry, a fixed statement with a link to `/auth-files`
  (`provimux.aliases.login_file_note`): a login can carry aliases of its own; they are set in that login's
  editor, are not shown on this page, and for the same alias they win over the login type's row here. The page
  cannot tell whether any login has one: knowing would take the login files themselves. A name such an alias
  adds does appear among the native names (4.4), so a collision it causes is seen. Confirmed by the owner.

### 5.4 `src/components/modelAlias/` and the old page

They stay in the tree untouched: `src/pages/AuthFilesOAuthModelAliasEditPage.tsx`,
`src/components/modelAlias/*`, `src/features/authFiles/modelRules/*`. They are upstream's files; removing them
would make every upstream change to them a delete/modify conflict that stops the automatic sync
(`.github/provimux/SYNC.md`). The page is no longer reachable (its address is taken over, section 6); the modules
the exclusions page shares with it stay in use. The new page imports none of the alias diagram or the alias
ledger. Cost: the old page's code remains in the built file, as today (decision D3).

## 6. Where the files go

### 6.1 New, all Provimux's own

```
src/provimux/pages/aliases/
  types.ts            the types of sections 2, 3 and 4
  rows.ts             readAliasState: document + login files -> entries and rows
  draft.ts            startDraft, changeRow, addKeyAlias, addLoginAlias, removeRow, discard, rowIssues
  rebase.ts           rebase: the draft carried onto a fresh read (3.6)
  collisions.ts       clientNames, nameGroups, groupOfRow, serviceOf
  plan.ts             planCommit, locate, withModels, sameChannel, replaceChannel
  aliasesApi.ts       load, commit, loadServedNames
  formSeams.ts        aliasFieldType, countAliases (the forms' side)
  AliasesPage.tsx, AliasesPage.module.scss      the page (designer)
  AliasesRedirect.tsx                           the old address
src/provimux/components/ProvimuxAliasesLine.tsx  "N aliases" + link
src/provimux/components/ProvimuxRowAlias.tsx     a row's alias as text
tests/provimux/aliases-*.test.ts, tests/provimux/fixtures/aliases/*.json
```

Changed, Provimux's own (as they are at `42bb2925`, with the Savings page in them):

- `src/provimux/routes.tsx`: two more routes, `/provimux/aliases` and `/auth-files/oauth-model-alias`, neither
  inside `ProvimuxPageGate`;
- `src/provimux/nav.tsx`: `PROVIMUX_PAGES` gets a fourth item, placed after Model routes, whose `endpoint` is
  `null`; the item type becomes `endpoint: ProvimuxEndpoint | null`, a `null` item is always listed, and the icon
  moves from the `ICONS` record (keyed by endpoint) onto the item. `presence.ts` does not change;
- `src/provimux/components/ProvimuxIcons.tsx` (the icon), `src/provimux/index.ts` (exports),
  `src/provimux/locales/en.json` (`provimux.nav.aliases`, `provimux.nav_meta.aliases`, `provimux.aliases.*`).

### 6.2 Upstream-owned files touched: three files; four lines inserted, two changed, one moved

None is on the guard's protected list (`.github/provimux/guard.sh`). None was changed by ALP-01.

| File | Change | Why this and not less |
| --- | --- | --- |
| `src/features/providers/sheets/forms/ModelEntriesEditor.tsx` | **4 inserted lines, none changed**: the import from `@/provimux`; in the alias `<input>` (which has no `type` today), the attribute `type={aliasFieldType(oauthAliasOnly)}` (`'hidden'` for a provider list, `'text'` for a login's own aliases); after that `<input>`, `<ProvimuxRowAlias show={!oauthAliasOnly} alias={entry.alias} name={entry.name} />`; and as the first child of the fragment `<ProvimuxAliasesLine show={!oauthAliasOnly} models={models} family={providerBrand} />` | one file covers the standard and the sponsor forms. A hidden input cannot be focused, typed in or required, and no existing line moves, so upstream's edits around it merge |
| `src/services/api/providers.ts` | **2 changed lines** in `serializeVertexModelAliases`: `if (!name || !alias) return null;` becomes `if (!name) return null;`, and the line `alias,` becomes `...(alias ? { alias } : {}),` | the fault of 5.2 is in this function and nowhere else. It is a correction upstream could take (decision D5) |
| `src/router/MainRoutes.tsx` | **the existing seam `...PROVIMUX_ROUTES,` moves** from after `/quota` to the first element of the array | among sibling routes with one path the earlier wins (react-router's `compareIndexes`), so Provimux's route for `/auth-files/oauth-model-alias` takes the address over without touching upstream's line or its import |

`ProvimuxRowAlias` renders exactly one element when `show` is true, empty when the row has no alias, so the
row's three-column grid keeps its shape; both components render nothing when `show` is false.
`ProvimuxAliasesLine` maps the editor's `providerBrand` to the family (`openaiCompatibility` →
`openai-compatibility`); for a brand that is no family the link carries no filter.

Not touched: `BaseProviderForm.tsx`, `SponsorProviderForm.tsx`, `useProviderWorkbench.ts`, `authFiles.ts`,
`AuthFilesPage.tsx`, `ModelRulesEntry.tsx`, `AuthFilePolicyFields.tsx`, `MainLayout.tsx`, the seven upstream
locale files, anything under `src/components/modelAlias/`.

All commits carry the trailer `Provimux-Layer: branding`.

## 7. The tests

`bun:test`, under `tests/provimux/`, with `spyOn(apiClient, 'get' | 'getRaw' | 'put')` answering from canned
JSON in `tests/provimux/fixtures/aliases/` (the pattern of `tests/managementV8Api.test.ts`). Fixtures hold made-up
keys such as `fixture-key-1` and no address of a person.

Fixtures: `config-full.json` (a `GET /config` answer: every family; a group with two keys inheriting its list; a
key with its own list; rows with every option and one unknown field; a Vertex key with a name-only row, a
same-name row and an aliased row; a prefix; a disabled entry; a key without list; `oauth.model-alias` with two
channels, one written in two spellings, rows with `display-name`, `openapi`, an unknown field, and one row of
each ignored kind), `config-empty.json` (no `api-keys`, no `oauth`), `config-unreadable.json` (config-full with
one part of each kind of 2.5 that the page cannot read), `credentials.json`, `model-routes.json`.

**Data layer**

- **R-1 rows**: `readAliasState(config-full)` gives the expected entries and rows (ids, `listSource`, `host`,
  `service`, `disabled`, alias null for `alias == name`); `config-empty` gives none and does not throw.
- **R-2 nothing lost, store A**: a draft with no change plans no unit; one alias change sends a body in which
  every other row, key, group and field deep-equals the fixture, unknown field and `test-model` included.
- **R-3 nothing lost, store B**: one alias changed in one channel: the other channel is deep-equal; the changed
  channel's other rows keep `display-name`, `openapi` and the unknown field; both spellings are replaced by the
  normalized key.
- **A-1 equality with the old editor, store A**: section 3.2's comparison, for every family and for: set an
  alias, change it, clear it, set and unset `force-mapping`, add a second row, remove one; on a key with its own
  list and on a key inheriting its group's. And its stated differences: one request per family; `test-model`
  left; the Vertex name-only row kept by both.
- **B-1 equality with the old editor, store B**: section 3.3's comparison, and its three stated differences.
- **O-1 … O-6 operations**: change an alias; clear it (key removed, Vertex too); `addKeyAlias` (row placed after
  its model's last row, no options copied; refused for an unknown upstream and for `listSource: 'none'`);
  `removeRow` on an extra row (deleted) and on a model's only row (alias cleared, row kept); `addLoginAlias`
  (fork true by default; new channel); remove a channel's last row (key gone; last channel: body `{}`).
- **C-1 commit**: units run in order, one after the other (a unit's read starts after the previous `put`
  resolved); all changed entries of a family are in one `put`; a failing unit is reported and the next still
  runs; `rebase` carries the edits of entries not written (RB-1 … RB-8).
- **C-2 If-Match and conflicts**: every `put` of both stores carries `If-Match` with the `ETag` of that unit's
  read, and none when the header is missing. A 412: the unit is read and written once more, and succeeds when
  its entries are unchanged; a second 412 fails its entries as `conflict`. A group changed since load:
  `conflict` for its entries, the family's other entries still written; every entry in conflict: no `put`. A
  channel changed since load: `conflict`, other channels written. A connection change during commit aborts
  (`guardConfigConnection`). A draft with a blocking issue: no request at all.
- **I-1 issues**: each `RowIssue`, blocking or not; a blank new row has none.
- **N-1 names**: `clientNames` for no prefix, prefix, forced prefix, prefix equal to the name.
- **N-2 the rule**: one table-driven test, one case per line of 4.3 and of "not a problem": `single`;
  `several-keys` (two keys, one host); `several-models` with and without `pool`; `several-services` (login and
  key; two hosts; key with and without base URL); a disabled entry does not count; a shadowed or blocked row does
  not count; case differs only: one group.
- **N-3 native names**: with `model-routes.json`, an alias equal to a login's built-in name is `several-services`
  with that login in `nativeServices`; a route of the row's own entry is not native; a changed set of names
  asks again and an answer for an older set is dropped. The fallback: a 404 gives `known: false` and the verdict
  from rows only; presence `unsupported` makes no request.

**The forms still saving**

- **F-1 the Vertex fix**: `providersApi.updateVertexConfig` writes a name-only row as `{ name }` plus its
  options, an aliased row with its alias, a same-name row unchanged; a row without a name is still left out.
  Upstream's `providerEditingV8` and `providerModelOptionsApi` suites stay green unchanged.
- **F-2**: per family, a form save that adds a model row and one that removes a row keep every existing alias in
  the `PUT` body (the form's model inputs rebuilt with `readModelOptions`, then `buildProviderKeyConfig`, then
  `providersApi.update<Family>Config`; for OpenAI-compatible, whose builder is not exported and is not to be
  exported for a test, `providersApi.updateOpenAIProvider` on an entry written out in the test).
- **F-3**: a Vertex form save with a new name-only row writes that row, where it wrote none before.
- **F-4**: `renderToStaticMarkup(<ModelEntriesEditor …>)`: for a provider list the alias input is
  `type="hidden"`, the alias text and the "N aliases" line with its link are present; with `oauthAliasOnly` the
  input is `type="text"` and neither is present. `countAliases` ignores empty aliases and `alias == name`.
- **F-5 routes**: in the route table, `/auth-files/oauth-model-alias` resolves to `AliasesRedirect` and
  `/provimux/aliases` to the page, with and without Provimux's endpoints present; the redirect maps `?provider=`
  to `&channel=`; the nav lists the page whatever the presence entries say.
- The existing suites stay green unchanged, in particular `managementV8Api`, `providerModelOptions`,
  `discoveryNoAutoAlias`, `oauthForceMapping`, `modelRulesSession`, `tests/provimux/*`.

## 8. The steps

From `main` `42bb2925`. Each ends with `bun run verify` green and one commit (`Provimux-Layer: branding`).

**Worker: the data layer, no screen**

1. **W1 the Vertex fault.** The two lines in `providers.ts`. Holds after: F-1, F-3. Useful by itself: a Vertex
   row with a name alone is saved instead of vanishing.
2. **W2 rows.** `types.ts`, `rows.ts`, the fixtures. Holds after: R-1.
3. **W3 draft and rule.** `draft.ts`, `collisions.ts`. Holds after: O-*, I-1, N-1, N-2 as pure tests, no request.
4. **W4 writes.** `plan.ts`, `aliasesApi.ts`. Holds after: R-2, R-3, A-1, B-1, C-1, C-2.
5. **W5 native names.** `loadServedNames` and its part of `nameGroups`. Holds after: N-3, both the normal case
   and the fallback.
6. **W6 the forms' functions.** `formSeams.ts` (`aliasFieldType`, `countAliases`), not yet called from any
   upstream file. Holds after: the `countAliases` cases of F-4.

**Frontend designer: the page**

7. **U1 page.** `AliasesPage`, the nav item, the route `/provimux/aliases`, the strings. Reads `?store=`,
   `?channel=`, `?family=` as its initial filter. Holds after: every operation of section 3 can be done and
   committed on the page; verdicts and issues are visible on the draft; an entry whose save failed keeps its
   edits and says why; an entry changed elsewhere shows the current rows, and the page lists the edits that were
   not saved; leaving with a dirty draft asks first (`useUnsavedChangesGuard`); an entry with
   `listSource: 'none'` explains itself; the statement of 5.3 is shown; native names take part in the verdicts,
   and on a proxy without `/provimux/model-routes` the page says in one line that they were not checked; the nav
   and route parts of F-5. The old editors still exist: nothing is
   lost if the page is held back.

**Frontend designer, then: the forms** (only after U1 is accepted, since from here the old editors are gone)

8. **U2 the old address.** `AliasesRedirect`, its route, the move of the seam in `MainRoutes.tsx`. Holds after:
   F-5 whole; the tile on `/auth-files` opens the page on its login type.
9. **U3 the provider forms.** The two components and the seams in `ModelEntriesEditor.tsx`. Holds after: F-2,
   F-4; in a browser, one form of each kind (standard, sponsor, Vertex, a login's own aliases) saves; and,
   against a proxy the chief names, a Vertex row saved with a name alone is in the proxy's model list under that
   name.

## 9. Decisions left open, and known limits

**D1. A login file's own aliases: decided by the owner.** They stay in the login's editor; the page states that
they exist, are not shown and win (5.3). Showing them would need `model_aliases` in `GET /credentials`, a proxy
change, and is not part of this item.

**D2. Native names (4.4, step W5): part of the design.** Without them the page reports "single" for the
commonest real collision. The owner runs Provimux, which has the endpoint; the fallback without it is one line
on the page.

**D3. The old page's code stays in the built file.** Chosen for conflict-free syncs. The alternative removes it
from the build by changing upstream's route line and import in `MainRoutes.tsx`, at the price of a conflict
whenever upstream edits them.

**D4. The page has its own writers, and they differ from the old editors on purpose** (3.2, 3.3): `If-Match`,
one request per family, `display-name` and `openapi` kept, `test-model` left. The alternative for store A, calling
upstream's writer, would make equality with the form automatic but cannot send `If-Match`.

**D5. The Vertex correction** is two lines in an upstream file. Offering it upstream would remove them from the
layer; until then they are a possible conflict when upstream edits that function.

Known limits, accepted:

- The page does not merge: an entry changed elsewhere loses the page's edits on it. They are listed, to be typed
  again.
- The provider form's own saves stay unconditional (upstream's writer). Giving them `If-Match` too is a change of
  `getGroups` and `putGroups` in `providers.ts`, outside this item.
- A commit over several families and the logins is several requests; a failure in between leaves the earlier
  ones written. The outcome names each entry.
- The `ETag` is of the whole file, so a 412 can come from a change that has nothing to do with aliases. One
  retry absorbs it; `locate` and `sameChannel` decide whether the page's own entries were touched.
- A key that inherits its group's list is split from the group by its first alias change (the old editor's
  behaviour, 3.2). Shown through `listSource`, not prevented.
- The rule ignores exclusions: a name excluded on one entry still counts there. 4.4 shows what is served.
- `key:<family>` and `key:<host>` are two services even when the host is the family's own endpoint written out.
- `oauth.settings` rows can be keyed by an alias; renaming that alias leaves the setting without a target. The
  page does not read `oauth.settings`.
- A login file's prefix is not in the configuration, so a login row's `<prefix>/` names are known only through
  4.4.

## Appendix: the Vertex check

Run on the proxy's `local` `4c071f30` with `go test -overlay <map> -run TestOverlayVertex ./sdk/cliproxy/
./sdk/cliproxy/auth/`, the map placing each file below in its package without writing to the repository. Both
passed.

```go
package cliproxy // placed as sdk/cliproxy/zz_overlay_vertex_test.go

func TestOverlayVertexNameOnlyRowIsListedUnderItsName(t *testing.T) {
	data := []byte("config-version: 8\napi-keys:\n  vertex:\n    - name: vertex-1\n      keys:\n" +
		"        - api-key: fixture-key\n          models:\n            - name: gemini-x\n" +
		"            - name: gemini-y\n              alias: why\n")
	cfg, err := config.ParseConfigBytes(data)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	entry := &cfg.VertexCompatAPIKey[0]
	if len(entry.Models) != 2 {
		t.Fatalf("models kept after load = %d, want 2", len(entry.Models))
	}
	models := buildVertexCompatConfigModels(entry)
	if len(models) != 2 || models[0].ID != "gemini-x" || models[1].ID != "why" {
		t.Fatalf("listed ids are not [gemini-x why]")
	}
}
```

```go
package auth // placed as sdk/cliproxy/auth/zz_overlay_vertex_test.go

func TestOverlayVertexNameOnlyRowResolvesToItsName(t *testing.T) {
	models := []internalconfig.VertexCompatModel{{Name: "gemini-x"}, {Name: "gemini-y", Alias: "why"}}
	if got := resolveModelAliasFromConfigModels("gemini-x", asModelAliasEntries(models)); got != "gemini-x" {
		t.Fatalf("name-only row resolved to %q, want gemini-x", got)
	}
	if got := resolveModelAliasFromConfigModels("why", asModelAliasEntries(models)); got != "gemini-y" {
		t.Fatalf("aliased row resolved to %q, want gemini-y", got)
	}
}
```

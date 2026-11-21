# One page for all model aliases (ALP-02)

Built: steps W1 to U4 of section 8: the data layer (W1 to W6, `src/provimux/pages/aliases/`), the page (U1,
`/provimux/aliases`), the old address (U2), the provider forms (U3), W7, the save of 3.4, and U4, the page after a
save as 3.6 describes it. U3's checks against a running proxy are not done yet.

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
- **The 200 of a write carries the tag of the file that write left**, read back before the handler releases the
  same mutex (`config_v8.go`: `h.mu` is held from the read of the file to the answer). A second write can
  therefore be made conditional on the first with no read between them (3.4). When the file cannot be read back
  the answer has no `ETag`. A 412 and a refused write (400, 422) leave the file and its tag as they were; a 412's
  answer carries the current tag.
- Nothing in the proxy rewrites the file while it runs unasked: its writers are the management requests (all
  under that mutex) and the loader, which rewrites only a file somebody else changed (a plain management secret
  is hashed, conflicting old fields are removed; `proxy:internal/config/config_load.go`).
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
| **the Aliases page, both stores** | no read at the save: every write is built from the page's own read and carries **`If-Match` with that read's `ETag`** (after the first write, the tag that write answered) | none: a write lands only on the exact file the page shows |

**The page sends `If-Match` on every write, and never writes without one** (3.4). A second tab, another client, or
a hand edit of the file after the page's read gives 412 and no write. This is why the page has its own writer for
store A (3.2): upstream's writer cannot carry the header without edits in `providers.ts`. The provider form's own
saves stay unconditional, as today (section 9).

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
  /** `<entry.id>#<sourceIndex>` for a stored row, `<entry.id>#new-<n>` for a row of the draft. Valid for one load, as the entry's id (3.4). */
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
  /** The `GET /config` answer of this read, as parsed. A save builds its bodies from it (3.4). The data layer's
   *  own; never rendered: it holds the keys. */
  document: unknown;
  /** ETag of the read; null when the browser could not read the header: the page then saves nothing (3.4). */
  etag: string | null;
  /** 2.5: the parts the page cannot read, by path (such as `api-keys.claude[2]`). */
  unread: string[];
}
```

Everything in an `AliasState` belongs to **one read** of the file: the entries, the rows, their ids, `groupIndex`,
`keyIndex` and `sourceIndex` are positions in `document`, and mean nothing in any other read (3.4).

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
written exactly as it was read. **In a changed row only the fields the user changed are written**: each field of
the draft row is compared with the same field of its base row (the row as read: `upstream`, `alias` and
`displayName` after trimming, `fork` and `forceMapping` as values), and a field that is equal leaves its stored
key exactly as it is, however it is spelled there: a padded `display-name`, an explicit `fork: false`, an `alias`
equal to the name all stay.

| Field the user changed | Store A | Store B |
| --- | --- | --- |
| `alias` | `alias` set (trimmed); **removed** when the row now has no alias, in every family, Vertex included | `alias` set (trimmed); a row cannot be without one |
| `upstream` | cannot change (3.1) | `name` set (trimmed) |
| `forceMapping` | `force-mapping`: `true` set; `false` written when the row stored a value, else the key removed | the same |
| `fork` | does not exist | `fork: true` set; turned off: the key removed |
| `displayName` | cannot change | `display-name` set (trimmed), or removed when empty |
| a field not changed, and every other key | untouched | untouched |

A new row is `{ name, alias }` (store B: plus the optional keys above that are set). This is the whole mapping; no
field the page does not show can be lost, because the page never builds a stored row from its own fields.

A list is written with every element the page did not remove, each in its place; elements that are not rows are
never removed (2.5). **A list's key is left out only when the list is empty**: a list whose last row was removed
and that still holds an element the page cannot read is written with that element.

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
| a number anywhere in a family's list, or in `oauth.model-alias` | the browser cannot hold it exactly: an integer beyond ±(2^53 − 1) | named by the number's path; the family gives no entries, the map makes every login entry `unread`: neither is ever written, so the number is never rounded |

`api-keys` or `oauth` itself present and not a map is named by that path, and is the same as every family, or the
map, not readable.

`familyGroups(document, family)` (`rows.ts`) is the family's list as stored, or `[]` when absent or not a list. If
upstream's normalizer throws on a family, the whole family is unread.

**Numbers.** A write sends a whole family, or the whole login map, back through the browser, and `JSON.parse` has
already turned every number into a double: `9007199254740993` is read as `…992`, and would be written so. The
proxy keeps such integers exactly, so the page must not round them. A rounded integer is recognised in the parsed
value itself: `Number.isInteger(n) && !Number.isSafeInteger(n)`, or a number that is not finite (an integer
written beyond 2^53 − 1 parses to an integer-valued double of at least 2^53; at or below it the double is exact;
a decimal is written back as the same double the proxy would read). `readAliasState` walks each family's
list and the login map once for such a number. The price is that a family holding one is not on the page until
the number is changed in the file; no real option of a model row comes near that size.

**A save sends an unreadable part back as it was read.** The bodies of a save are built from the page's own read
(3.4), so a group, key, element or channel the page cannot read is in the body in its place, untouched. An entry
that is `unread` takes no edit: `changeRow`, `removeRow` and `addLoginAlias` return the draft unchanged for it, and
for every login row when the map is not readable, so no unit is ever planned for something the page cannot write
whole.

## 3. The operations

The page holds **one draft** over a loaded `AliasState` and commits it with one action. Operations are pure
functions in `draft.ts`: `(draft, …) => draft`. Nothing is requested until `commit`. A draft never leaves its
`base`: `startDraft` is the only function that gives a draft a state, and no function takes a draft and another
state (3.6).

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
/** One entry's rows are its base rows again; every other entry as it is. The same base. */
export function discardEntry(draft: AliasDraft, entryId: string): AliasDraft;
/** One edit of the draft, as the base row and the draft row (`changed`: both; `added`: the draft row;
 *  `removed`: the base row). */
export interface LostEdit { kind: 'changed' | 'added' | 'removed'; before: AliasRow | null; after: AliasRow | null }
/** The edits of one entry: its draft rows against its base rows. A blank new row is not an edit. */
export function editsOf(draft: AliasDraft, entryId: string): LostEdit[];
```

### 3.1 Change

Sets fields of one row in the draft. For an API-key row only `alias` and `forceMapping` can change; `upstream`
cannot (which models a key serves is the provider form's). Setting `alias` to an empty string or to the row's
upstream name makes it null. A row of an `unread` entry takes no change (2.5).

### 3.2 Store A: add, remove, the request

- **Add** (`addKeyAlias`): only for an entry with rows and an `upstream` that one of its rows already has. The new
  row `{ upstream, alias }` is placed after the entry's last row with that upstream name. It copies no options:
  options are per row and are edited in the provider form.
- **Remove** (`removeRow`):
  - when another row of the entry has the same upstream name, the row is deleted (the key still serves the model);
  - otherwise the row stays and its alias becomes null. The page never removes the last row of a model.
  - Either way the page drops the alias text being typed for that row, so its box shows what the draft holds.
- **Request**: one per family that has changed entries, whatever their number. Its body is built **from the
  page's own read**, never from another one (`planWrites`, 3.4):

  ```ts
  const groups = [...familyGroups(draft.base.document, family)];   // the read the rows came from
  for (const entry of changedEntriesOf(family)) {
    groups[entry.groupIndex] =
      withModels(groups[entry.groupIndex], entry, draftRowsOf(entry), baseRowsOf(entry));
  }
  // PUT /config/api-keys/<family> with `groups`; sent by `commit` with If-Match (3.4)
  ```

  - Each entry is written at its own position (`groupIndex`, `keyIndex`), which is a position in this very list.
    Two entries are two positions, so two entries are never written onto one key. Nothing is looked up, and
    nothing is compared: the proxy's `If-Match` check says whether the file still is this read.
  - The `auth_index` the proxy injected goes back as it was read; the proxy strips it (1.1). The page strips
    nothing.
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
- **Request**: one for all changed channels, built from the page's own read as in 3.2:

  ```ts
  let map = { ...loginMapIn(draft.base.document) };                // the read the rows came from
  for (const entry of changedChannels()) {
    map = replaceChannel(map, entry, writtenRowsOf(entry));        // every other key untouched
  }
  // PUT /config/oauth/model-alias with `map`; sent by `commit` with If-Match (3.4)
  ```

  `replaceChannel` removes every spelling of the channel and, **when the written list is not empty**, sets it
  under the normalized key: the old editor's rule (`updateOauthProviderMap`), except that an element the page
  cannot read counts and stays (2.4, 2.5): a channel holding `null` and one alias keeps `[null]` when the alias
  is removed. When no channel remains the body is `{}`, as the old editor sends. A changed channel is always one
  the page can write whole: an `unread` entry takes no edit (2.5).

**Proof.** Test B-1: for the same edit, upstream's `authFilesApi.saveOauthModelAlias` / `deleteOauthModelAlias`
and the page's writer run against the same canned read, and the two `PUT /config/oauth/model-alias` bodies are
compared as JSON (maps unordered, lists ordered). They are equal **on `name`, `alias`, `fork` and
`force-mapping` of every row of every channel**. The differences, each on purpose and each tested:

1. the page keeps `display-name`, `openapi` and unknown fields of rows it did not remove; the old editor deletes
   them (section 0, fact 4). In a changed row it leaves a field the user did not change as stored (2.4), so an
   explicit `fork: false` stays where the old editor dropped the key: the same meaning, and B-1 compares `fork`
   as "is true";
2. the page never drops a stored row silently: a row the old editor would have discarded while reading (no name
   or no alias) is shown with an issue and blocks the commit until it is fixed or removed;
3. the page sends `If-Match`, and one request for all channels where the old editor sent one per channel.

### 3.4 Save: every write is to the file the page read

The page has **one read**: the `GET /config` of `load()`, its document and its tag (the `ETag`). Every entry, row,
id and position on the page belongs to that read (section 2). A save reads nothing more. It writes parts of that
same read back, changed, and makes each write conditional on the file still being what the page knows:

- the body of a unit is built from the read's own document, `draft.base.document` (3.2, 3.3);
- the first write carries `If-Match` with the read's tag; each next write carries the tag the write before it
  answered (1.1).

So write *k* lands only on a file that is, byte for byte, the read plus the writes 1 … *k* − 1 of this save, and
every position in its body means what it meant when the user made the edit. The proxy makes that comparison, on
the SHA-256 of the file, under the lock it writes under. **The page itself compares nothing by content.** It has
no "same entry in another read", no search for an entry that moved, no stripping of fields before a comparison,
and no second attempt: there is nothing left that those could get wrong.

```ts
export type CommitUnit =
  | { store: 'api-key'; family: ProviderFamily; entryIds: string[] }
  | { store: 'login'; entryIds: string[] };
/** A unit with its request, `PUT <path>` with `body`. Pure: from the draft and its base alone. */
export interface PlannedWrite { unit: CommitUnit; path: string; body: unknown }
export type SaveFailure =
  | 'blocked'   // a changed entry has a blocking issue (3.5): nothing was sent
  | 'no-tag'    // the read, or the answer of the write before, carried no tag: this write was not sent
  | 'changed'   // 412: the file is not the one the page read
  | 'refused'   // 400 or 422: the proxy refused the configuration; `message` is its text
  | 'error';    // anything else, an answer that never came included: this write may have landed
export interface CommitOutcome {
  /** Entries of the units confirmed written: a 200 to a `PUT` sent with `If-Match`. Nothing else confirms. */
  confirmed: string[];
  /** Entries of the unit that ended the save and of every unit after it, in unit order. */
  unconfirmed: string[];
  /** Why the save ended early; null when every unit is confirmed. */
  failure: { reason: SaveFailure; message: string } | null;
}
export function planCommit(draft: AliasDraft): CommitUnit[];
export function planWrites(draft: AliasDraft): PlannedWrite[];
export const aliasesApi: {
  load(client?: Client): Promise<AliasState>;
  commit(draft: AliasDraft): Promise<CommitOutcome>;
};
```

The whole of `commit`, after the check for blocking issues:

```ts
let tag = draft.base.etag;
for (const write of planWrites(draft)) {
  if (!tag) return ended('no-tag');                       // no write without a tag
  assertConnection();                                     // guardConfigConnection()
  try {
    tag = await putWithTag(write.path, write.body, tag);  // the 200's ETag, or null
  } catch (error) {
    return ended(statusOf(error) === 412 ? 'changed' : refusedOrError(error));
  }
  confirmed.push(...write.unit.entryIds);
}
```

- `planCommit`: one unit per family with an entry whose draft rows differ from its base rows, in the family order
  of 1.2, then one unit for the logins when a channel differs. `planWrites` gives each unit its path and body
  (3.2, 3.3). Both are pure, so what a save would send can be checked without a request.
- While a changed entry has a row with a blocking issue (3.5), `commit` sends nothing (`blocked`), as the old
  editor's save did. The page does not offer Save then.
- The units are sent **one after another**, in that order. They are not one transaction: each is atomic by
  itself. **The first unit that is not confirmed ends the save**: it is not sent again, and no unit after it is
  sent. After a 412 the file is not the read any more. After an `error` the page does not know what the file is.
  After a refusal the file is unchanged, but the proxy validates the whole document on every write, so what
  refused one unit refuses the next (the live run recorded it: one unknown field in one family refused every
  unit of the commit).
- **What a save never does**: send a `PUT` without `If-Match`; send a `GET`; use the tag a 412 answered; try a
  unit a second time; write an entry anywhere but at its own position in the read.
- `putWithTag(path, body, tag)` sends `apiClient.put` with `If-Match: tag` and resolves with the `ETag` of the 200,
  or null when it has none. Any other success (a 202, a 204) rejects with its status and ends the save as `error`:
  it is not confirmed, and it may have landed. `apiClient.put` returns the body alone and `client.ts` is upstream's, so the header
  is read in the request's own `transformResponse`, placed after axios's default transforms (axios hands a
  transform the answer's headers and status; error bodies are still parsed for `apiClient`'s messages). It is the
  only place that reads a write's answer.
- A change of the management connection aborts the save (an `AbortError`, as `guardConfigConnection` throws it);
  the page then belongs to another connection and loads from it.
- `load()` is `apiClient.getRaw('/config')` (document and `ETag`) and `authFilesApi.list()`; if the credentials
  list fails, `loginCount` is null and the page still works.
- **A read without a tag** (`etag` null: a browser, or something between it and the proxy, that hides the header):
  the page shows the rows, takes no edit and says in one line that it cannot save and why (3.6). There is no
  unprotected save.

**What it rests on, and how it was checked.** One fact of the proxy: the 200 of a write carries the tag of the
file that write left (1.1). On 2026-11-21, against a proxy built from `provimux/main` `ac538607` with a
hand-written file never written through the API: one read, then three writes built from that one read (a family,
a second family, the login map), each with the tag the one before answered, all 200; a `GET` afterwards carried
the last answer's tag, and the same tag four seconds later (the reload after a write does not touch the file); a
write with the first read's tag then got 412 and a refused write left the tag as it was; through axios 1.20, a
`transformResponse` that takes the tag from a 200 alone read it, and took none from the 412. The live test
repeats this (L-4, L-7).

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

### 3.6 After a save: nothing is carried

A draft lives and ends with its read. **No edit is ever moved onto another read**: not by id, not by position,
not by content. What a save did not confirm is not kept as an edit; it is written down for the user, who types it
again on the file as it now is. The owner chose this: no automatic merge, retyping accepted.

When `commit` returns, whatever it returns:

1. The page drops the draft, the alias texts being typed and every mark of the old read, at once, before it
   requests anything.
2. Every edit of every entry in `outcome.unconfirmed` goes into the page's list of **edits not confirmed saved**
   (`unconfirmedEdits(draft, outcome)`, from the dropped draft): the entry's label as it was, each edit in words
   to type again from, and once for the save its reason (`outcome.failure`):
   - `changed`: the file was changed elsewhere after the page read it;
   - `refused`: the proxy's message, then one sentence: when the message names a field of the configuration,
     correct that field in the configuration first, then type these edits again;
   - `error`: the message, and that the last write may have landed, so each edit is to be checked against what
     the page now shows;
   - `no-tag`: the proxy's answer carried no tag, so the page did not write further.
3. The page calls `useConfigStore.getState().clearCache()` and `load()`. The fresh read is shown as it is, with no
   edit on it. When that read fails, the page shows the load error with its retry; the list stays above it.
4. The list stays until the user dismisses its items. Leaving the page while it has one asks first, as leaving
   with a dirty draft does: the list is the only copy of what was typed.

"Undo this entry" is `discardEntry` (section 3): the entry's rows are its base rows again, on the same read.

**The page's state, as one pure function.** What decides whether an edit is kept, shown or lost is not left to
effects and refs in the component. `pageLogic.ts` holds it, and `AliasesPage` keeps one `PageState` and sends
events:

```ts
export interface LostNotice { key: number; entry: AliasEntry; edits: LostEdit[]; failure: CommitOutcome['failure'] }
export interface PageState {
  /** null: no read is held (before the first read, after a save, until a read answers). */
  draft: AliasDraft | null;
  /** The alias texts being typed, by row id; a row of `draft` only. */
  texts: Record<string, string>;
  saving: boolean;
  /** From the start of any read to its answer or failure, the Reload button's included. */
  reading: boolean;
  /** The edits not confirmed saved, until dismissed. */
  lost: LostNotice[];
}
export type PageEvent =
  | { type: 'read-started' }
  | { type: 'read-answered'; state: AliasState }
  | { type: 'read-failed' }
  | { type: 'edited'; change: (draft: AliasDraft) => AliasDraft }
  | { type: 'alias-typed'; rowId: string; text: string }
  | { type: 'row-removed'; rowId: string }
  | { type: 'save-started' }
  | { type: 'save-answered'; outcome: CommitOutcome }
  | { type: 'dismissed'; key: number };
export function pageStep(page: PageState, event: PageEvent): PageState;
/** Whether the board takes input: a read is held, it has a tag, and nothing is pending. */
export function canEdit(page: PageState): boolean;
/** One item per entry of `outcome.unconfirmed` that has edits (`editsOf`). */
export function unconfirmedEdits(draft: AliasDraft, outcome: CommitOutcome): Omit<LostNotice, 'key'>[];
```

- `canEdit` is `draft !== null && draft.base.etag !== null && !saving && !reading`. `edited`, `alias-typed` and
  `row-removed` change nothing when it is false. **So nothing can be typed while a read is pending**, and the
  answer of a read never meets an edit made after the read began.
- The page starts a read only when the draft has no edit, or after the user agreed to drop its edits (the reload
  confirmation), or after a save. `read-answered` sets `draft` to `startDraft(state)` and empties `texts`: no row
  of an earlier draft is in it. `read-failed` leaves `draft` as it was (null after a save).
- `save-answered` sets `draft` to null, empties `texts`, and appends `unconfirmedEdits` to `lost`.
- `row-removed` is `removeRow` and drops `texts[rowId]`; `alias-typed` sets the text and `changeRow`'s alias.

As built (U4), the page adds to this, in `pageLogic.ts` alone:

- `read-failed` carries the message, held in `PageState.loadError`, so the body is a function of the state alone.
- Two more edit events, each a no-op unless `canEdit`: `entry-undone` ("Undo changes here": `discardEntry`, and
  the entry's texts dropped) and `discarded` (`discard`, no text left).
- A `read-answered` that lands while a save runs is dropped (`reading` false, the draft kept): the save's draft is
  the one its answer lists from, and the page reads again after the save. Only a change of the connection can
  start a read during a save.
- Each `LostNotice` carries `save`, the number of the save it came from: the list shows one card per save, with
  its reason once, and one item per entry.
- The save bar is up while the board takes input and the draft has edits, and stays while a save runs, to say
  "Saving…" with nothing to click; it is not up while a read is pending or on a read without a tag.
- A `commit` that rejects (the connection changed, 3.4) is answered as `error`, every planned entry unconfirmed.

**What the page shows below its header**, always in this order, each part independent of the others
(`AliasesBody`, a component of plain values, so it renders in a test without a request):

1. the edits not confirmed saved: page state, shown in every phase (reading, load error, empty, board);
2. while a read is held: the line that the page cannot save, when the read has no tag; and the line naming what
   the page cannot read (2.5);
3. the body, one of: the skeleton, the load error with its retry, the empty state, the board.

The empty state stands in for the board and for nothing else: a list of lost edits, or a path the page cannot
read, is shown above it as above a board.

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
  draft.ts            startDraft, changeRow, addKeyAlias, addLoginAlias, removeRow, discard, discardEntry,
                      editsOf, rowIssues
  collisions.ts       clientNames, nameGroups, groupOfRow, serviceOf
  plan.ts             planCommit, planWrites, withModels, replaceChannel (2.4, 3.2, 3.3); no comparison of
                      stored content
  aliasesApi.ts       load, commit, putWithTag, loadServedNames
  formSeams.ts        aliasFieldType, countAliases (the forms' side)
  pageLogic.ts        the page's pure rules: its filter and marks; pageStep, canEdit, unconfirmedEdits (3.6)
  AliasesPage.tsx, AliasesBody.tsx, LostEdits.tsx, AliasesPage.module.scss      the page (designer)
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
- **C-1, C-2 the save**: below, with the other tests of 3.4 and 3.6.
- **X-1 … X-7 what the page cannot read** (2.5): one case per line of its table, `unread` naming exactly that
  path and everything else read as without the bad part (X-1); `load()` resolves (X-2); an alias changed beside
  an unreadable group, key, element or channel sends that part back deep-equal, in its place (X-3); no operation
  changes the draft of an `unread` entry, nor of any login row when the map is unreadable, so no unit is planned
  (X-4); a part made unreadable elsewhere after the read is a change of the file like any other: 412, nothing
  written (X-5); junk at every level does not throw (X-6); numbers (X-7, below).
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

**The save (3.4, 3.6)**

The requests are answered by one stub, `fakeProxy(document)` (`tests/provimux/support/fakeProxy.ts`), which is
the contract of 1.1 and nothing else: one document and one tag that changes with every write; `getRaw('/config')`
answers both; `put` with a tag that is not the current one rejects with 412 and changes nothing; otherwise it
replaces the node at the path (stripping `auth_index` from groups and keys, as the proxy does), changes the tag,
and hands the new `ETag` to the request's `transformResponse` as axios would. `foreign(change)` edits the
document and changes the tag at any moment, also between two writes (`beforePut(n, fn)`). The stub records every
request and **counts each `put` without `If-Match`; every test of this group ends by checking that count is 0**.

- **C-1 the writes**: units in order, one after the other; all changed entries of a family in one `put`; no
  `getRaw` during `commit`; the first `put` carries the read's tag and each next one the tag the one before
  answered; after the commit the stub's document is the read with exactly the planned bodies in it.
- **C-2 the first unit not confirmed ends the save**, one case per reason, each checking `confirmed`,
  `unconfirmed`, `failure`, the number of `put`s, and that the stub's document is the read plus exactly the
  confirmed units: 412 (`changed`; the tag the 412 answered is never sent); 400 and 422 (`refused`, with the
  proxy's message); a rejected request and a 500 (`error`); a 200 without a tag before another unit (`no-tag`:
  the answered unit is confirmed, the next is not sent); a read without a tag (no request at all); a blocking
  issue (`blocked`, no request). A connection change before a write aborts, and that write is not sent.
- **C-3 two alike** (the review's first case): two deep-equal groups, an edit in each. With nothing changed
  elsewhere, each edit is in its own group of the `put` body. With one of the groups removed elsewhere before
  the save: 412, no write, both edits in `unconfirmedEdits`, and nothing reported confirmed.
- **C-4 keys that differ only below the top** (the review's second case): two keys equal but for
  `headers.auth-index` (`left`, `right`), an edit on `left`. It is in `left`'s list of the body. After a 503 and
  a reorder elsewhere, the edit is in `unconfirmedEdits`, the next draft is the fresh read without it, and no
  later save writes it anywhere.
- **W-1 only the edited field changes** (2.4), table-driven, both stores: on a stored row with a padded
  `display-name`, an explicit `fork: false`, `force-mapping: false`, an `alias` equal to its name, a padded
  `alias` and an unknown field, change one field at a time: the written object equals the stored one in every
  other key, spelling included.
- **W-2 elements the page cannot read stay** (2.4, 2.5): a channel `[null, row]` with the row removed is written
  as `[null]`; a channel `[row]` with the row removed loses its key; a store A list with a `null`, a string and
  an object without a name keeps each in its place through an add and a remove.
- **X-7 numbers** (2.5): a family whose list holds `9007199254740993` (the fixture is JSON text, parsed by
  `JSON.parse` as the browser does) gives no entries, `unread` names the number's path, and an edit in another
  family plans a body in which that family does not appear; the login map likewise makes every login entry
  `unread`; `9007199254740991` is read as any number.

**The properties** (`tests/provimux/aliases-save-property.test.ts`; seeded, 300 cases each, no library). They
replace RB-9, which compared counts taken from the draft it was testing and so passed with rows exchanged.

The generator makes documents in which **nothing can be told apart by its content**: one to three families of one
to three groups of one to three keys, lists on the group, on the key, on both or on neither, rows drawn from a
small pool of names and aliases, so that deep-equal groups, deep-equal keys, rows that share a name and differ
in the alias, and rows equal in every field are all common; keys that differ only in a nested field; an injected
`auth_index` on keys; elements that are not rows; stored spellings the reader normalizes (a padded `alias` or
`display-name`, an `alias` equal to its name, `fork: false`, `force-mapping: false`); unknown fields; a login map
with a channel in two spellings and a `null` element. No element carries a unique marker. The operations go
through `draft.ts` alone, and each is recorded by **where the test found its target in the document** (family,
group, key or channel, list position), from which the test writes the row id itself by the scheme of section 2;
it takes no id and no `sourceIndex` from the state.

Each property names the faults it must catch. The builder puts each fault into a scratch copy of the source, runs
the property, and reports that it fails, with the first failing seed. A fault that passes means the property is
not finished.

- **P-0 a row is the stored object at its position.** For every document: the rows of an entry, in order, are
  exactly the elements of its list that are rows, in list order; `sourceIndex` is the element's position; `id` is
  `<entry.id>#<position>`; every shown field is that element's (2.2, 2.3); the entry's id is its place in the
  document. *Must catch:* in `rows.ts`, two rows of an entry that share an upstream name exchange their
  `sourceIndex` (the exchange RB-9 let pass); an entry given another group's `storedGroup`.
- **P-1 an edit lands on the object the user edited, and nothing else changes.** `planWrites(draft)`, each body
  put at its path in a copy of the read, deep-equals **the oracle**: the recorded operations applied to another
  copy of the read at their recorded places, by the table of 2.4, in test code that uses nothing of `plan.ts`.
  The whole document is compared, so every other field of an edited row, every other row, key, group, family and
  channel, and every element that is not a row are compared too. *Must catch:* the writer finding a stored row by
  its upstream name or its content instead of its position; the writer rewriting a field that was not edited
  (trimming `display-name`, dropping `fork: false`); the writer dropping an element that is not a row, or a list
  left with only such elements; two entries written onto one key.
- **P-2 after a change elsewhere, the page writes nothing.** A random foreign change (a row, key or group
  inserted, removed, moved or edited, in the page's families or not; a setting outside both stores) at a random
  moment: before the first unit, or between two units. After `commit`, the stub's document deep-equals its
  document right after the foreign change; `confirmed` is exactly the entries of the units sent before it, and
  the document right before it is the read plus those units' bodies; every other changed entry is `unconfirmed`;
  `failure.reason` is `changed`; exactly one `put` was sent after the foreign change; `unconfirmedEdits` holds
  every recorded operation of those entries. *Must catch:* a unit tried again after a 412, from a fresh read or
  with the tag the 412 answered; the next unit sent after a 412; a unit reported confirmed without its 200.
- **P-3 no write without the right tag.** At random: a read without a tag, one answer without a tag, or neither.
  Every `put` carries the tag the stub last handed the page; `commit` makes no `getRaw`; after a missing tag no
  `put` follows and the remaining entries are `unconfirmed` with `no-tag`. *Must catch:* a write without
  `If-Match` when the tag is missing; a `GET` in the save to fetch a tag; the read's tag sent with every unit.
- **P-4 nothing is carried** (`pageStep`, pure). Random sequences of page events over random documents, reads and
  outcomes. After `read-answered`, `draft` equals `startDraft(state)` and `texts` is empty. An `edited`,
  `alias-typed` or `row-removed` between `read-started` and its answer, or while saving, or on a read without a
  tag, changes nothing. After `save-answered`, `draft` is null, and every operation made on the dropped draft is
  either of a confirmed entry or in `lost`. `lost` only grows, except by `dismissed`. *Must catch:* rows of an
  entry not confirmed kept in the next draft, by id, position or content; an edit accepted while a read is
  pending; an unconfirmed entry missing from `lost` when the fresh read has no entry left.

**The page** (`tests/provimux/aliases-page.test.ts`, `renderToStaticMarkup`)

- **G-1 the frame**: `AliasesBody` with a read that has no entry and one item in `lost` shows the item (the
  entry's label, the alias to type again) and the empty state; with a read that has no entry and a path in
  `unread`, the path and the empty state; with a load error and an item, both; while reading, the item.
- **G-2 not editable**: with `canEdit` false the board's fieldset is `disabled` and the save bar is not rendered;
  a read without a tag shows the line that the page cannot save.
- **G-3 the reasons**: an item for `refused` shows the proxy's message and the sentence about correcting the
  named field first; for `error`, that the last write may have landed; for `changed` and `no-tag`, their lines.
- **G-4 the remove control**: after `alias-typed` then `row-removed` on a model's only row, `texts` has no text
  for the row and the rendered box shows the draft's value, empty.
- Once in a browser, on the built page with intercepted answers: nothing can be typed between a click on Reload
  and its answer; a save refused with 412 after the last entry was removed elsewhere shows the list and the
  empty state; a sibling's `9007199254740993` is in no request.

**Against a live proxy** (`tests/provimux/aliases-live.test.ts`, skipped unless `ALIASES_LIVE_BASE` and
`ALIASES_LIVE_KEY` are set; a proxy built from source in a temporary folder, on `127.0.0.1`, families named
`alp-live-…`). L-1: `load()` gives a tag and a commit with it lands. L-2: a foreign write between the page's read
and its save: `changed`, and the file holds nothing of the page's; a foreign write between the first and the
second unit: the first unit's write is in the file, nothing of the others. L-3: the reported sequence (a row
inserted elsewhere at the head of the list the page edits): the file's list is the other client's. L-4: one
commit over two families and a login channel from a hand-written file, twenty times, all confirmed, **with no
`GET` between the units**. L-5: the families and channels not written read back as loaded. L-6: no `auth_index`
on disk. L-7: the tag of a `GET` after a commit is the tag its last write answered, and still is three seconds
later.

What each answers, of the review of `98fdc5ea`:

| The review found | The rule now | Tests |
| --- | --- | --- |
| 1. two edits written onto one key after a 412, both reported saved | no second attempt; an entry is written at its own position in the page's read (3.2, 3.4) | C-3, P-1, P-2 |
| 2. after a failed save, an edit carried to another key (a nested `headers.auth-index` was ignored in the comparison) | nothing is carried and nothing is compared (3.4, 3.6) | C-4, P-2, P-4 |
| 3. an unconditional write when a read had no tag | no write without a tag; a read without one takes no edit (3.4) | C-2, P-3, G-2 |
| 4. typing while a reload was pending, then replaced without a word | nothing is editable while a read is pending (3.6) | P-4, G-2, the browser check |
| 5. the empty state hid lost edits and unreadable paths | the notices are above the body, whatever the body is (3.6) | G-1, P-4 |
| 6. a channel `[null, alias]` deleted whole with its alias | a list's key is left out only when the list is empty (2.4, 3.3) | W-2, P-1 |
| 7. a rename trimmed `display-name` and dropped `fork: false` | only the fields the user changed are written (2.4) | W-1, P-1 |
| 8. a sibling row's integer above 2^53 rounded | a family or map holding such a number is not read, so never written (2.5) | X-7, the browser check |
| RB-9 passed with `sourceIndex` exchanged | P-0 and P-1 compare against the document, not against the draft | P-0, P-1 |
| the 400 for an unknown field did not say what to do | the list's `refused` item says to correct the named field first (3.6) | G-3 |
| Remove left the typed alias in the box | `row-removed` drops the row's text (3.2, 3.6) | G-4 |

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
   committed on the page; verdicts and issues are visible on the draft; after a save the page shows the file as
   it is and lists the edits not confirmed saved (3.6; rebuilt in U4); leaving with a dirty draft asks first
   (`useUnsavedChangesGuard`); an entry with
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

**The save rebuilt** (3.4, 3.6; decision D6). From `98fdc5ea`. Two steps, in this order; the second cannot be
verified without the first. More is deleted than written.

10. **W7 the save (worker; the data layer and its tests).**
    - *Delete:* `rebase.ts`; in `plan.ts`: `locate`, `sameChannel`, `sameConfig`, `withoutInjected`, `deepEqual`;
      in `aliasesApi.ts`: `runUnit`, its fresh read, the second attempt after a 412, the write without
      `If-Match` (`ifMatch` returning `undefined`), `CONFLICT_MESSAGE`; the file
      `tests/provimux/aliases-rebase.test.ts` whole (RB-1 to RB-9); in `aliases-commit.test.ts` the cases of the
      second attempt, of an entry found at another index, of `locate` and `sameChannel`, of a conflict per
      entry; in `aliases-unread.test.ts` the case of `rebase` onto a readable channel.
    - *Change:* `types.ts`: `AliasState.document`, `PlannedWrite`, `SaveFailure`, `CommitOutcome` (3.4), the
      comment of `LoginEntry.unread`. `rows.ts`: `readAliasState` keeps the document; a family's list and the
      login map are walked once for a number the browser cannot hold (2.5). `draft.ts`: `discardEntry` and
      `editsOf` (moved from `rebase.ts`, with `LostEdit`); `changeRow` and `removeRow` return the draft unchanged
      for a row of an `unread` entry. `plan.ts`: `planWrites` (the bodies of 3.2 and 3.3, from
      `draft.base.document`); the two row writers take the base row and write only the fields that differ (2.4);
      `replaceChannel` leaves the key out only for an empty list. `aliasesApi.ts`: `commit` as in 3.4,
      `putWithTag`. The live test's comparison of what reads back moves into the test's own support, and
      ignores `auth_index` only where the proxy injects it: on a group and on its keys.
    - *Holds after:* C-1 to C-4, W-1, W-2, X-1 to X-7, P-0 to P-3 with each named fault shown to fail, and the
      suites that were green before (R, A-1, B-1, O, I, N, F), A-1 and B-1 with the stated differences of 3.2 and
      3.3; against a proxy built from source, L-1 to L-7.
11. **U4 the page after a save (frontend designer).**
    - *Delete:* in `AliasesPage.tsx`: `pendingRef`, `stale`, `failures`, `applyState`'s carrying branch, the
      per-entry failure marks; in `pageLogic.ts`: `rekeyRows`, `rekeyEntries`; in `AliasesBoard.tsx`: the
      failure of an entry and the two lines that move to the frame; the strings `saved_partly`, `saved_none`,
      `failed_invalid`, `stale`, `stale_retry`, `not_saved_*` and the old `etag_missing`, in the seven languages.
    - *Change:* `pageLogic.ts`: `PageState`, `pageStep`, `canEdit`, `unconfirmedEdits` (3.6). `AliasesPage.tsx`
      keeps one `PageState`; the board's fieldset is `disabled={!canEdit(page)}`; leaving asks first while the
      draft is dirty or `lost` has an item. `AliasesBody.tsx`: the order of 3.6. `LostEdits.tsx`: one reason per
      save, by `failure.reason`; the `refused` sentence. "Undo this entry" calls `discardEntry`. New strings for
      the four reasons, for "this page cannot save" and for a save not confirmed whole.
    - *Holds after:* P-4 with each named fault shown to fail, G-1 to G-4, the strings test in seven languages,
      and the three browser checks of section 7.

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

**D6. A save writes the page's own read back; it reads nothing, compares nothing and carries nothing** (3.4,
3.6). The save before it read the file again for each unit, found each changed entry in that read by the content
of its group, tried once more after a 412, and afterwards carried the edits of failed entries onto the next read
by content. That let a save through when something unrelated had changed in the file, and it needed a comparison
of stored content in three places. Two reviews found lost data there: positions kept across reads; two entries
landing on one key; fields ignored in the comparison that were real; a write without a tag. The owner's rule,
"no automatic merge, an edit that cannot be saved safely is listed to be typed again", makes all of it
unnecessary. The price: **any change to the file after the page read it, aliases or not, refuses the save**, and
every edit of that save not yet written is listed. That needs a second tab, another client or a hand edit while
the page holds edits (nothing in the proxy writes the file by itself, 1.1).

**D7. Open, the owner's: keep the draft after a failure that wrote nothing?** After `refused` or `error` on the
first unit the file is, as far as the page knows, still its read, and the draft could stay as it is, on the same
read, for another try. The design does not: every failed save ends the same way, the list. Reasons: one path
instead of two; after a refusal caused by the file itself the user must change the file, which makes the read
stale anyway; after an `error` the page cannot know that nothing was written. What it costs: a save that fails
because the proxy could not be reached is typed again. If that proves a nuisance it can be added in `pageStep`
alone, without touching a write.

**D8. Open, the owner's: read again when the tab comes back.** A page left open holds an old read, and D6 then
refuses its next save if anything changed meanwhile. Reading again when the tab becomes visible, only while the
draft has no edit, would make that rare. Not in the design: it is not needed for safety, and can be added later
in the page alone.

Known limits, accepted:

- The page does not merge and does not carry: after a save that is not confirmed whole, whatever the cause, the
  edits not confirmed are listed, to be typed again.
- The provider form's own saves stay unconditional (upstream's writer). Giving them `If-Match` too is a change of
  `getGroups` and `putGroups` in `providers.ts`, outside this item.
- A commit over several families and the logins is several requests; a failure in between leaves the earlier
  ones written and ends the save: the units after it are not sent. The outcome names the entries of both kinds.
- The `ETag` is of the whole file, so a change that has nothing to do with aliases refuses the save too (D6).
- After `error` the page cannot tell whether its last write landed. The edits are listed as not confirmed, and
  the page shows the file as it is, where the user sees which of them are there.
- A family, or the login map, holding an integer beyond ±(2^53 − 1) is not on the page (2.5). The alternative
  keeps the digits (`JSON.parse` with source text, `JSON.rawJSON`) but only in browsers that have both, so the
  refusal would be needed beside it anyway.
- The proxy's lock covers every writer that goes through the proxy. A program that writes the file itself while
  a request is being handled is outside it for every client: the handler reads the file, then writes it whole.
- Something between the browser and the proxy that drops the tag makes the page read-only; one that weakens it
  (`W/"…"`) makes every save `changed`. Neither leads to an unprotected write.
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

# One page for every account (Accounts)

Accounts (`/provimux/accounts`, `src/provimux/pages/accounts/`) takes the menu places of three of the original console's
pages: AI Providers (API keys per provider family), Auth Files (the login files of subscriptions) and OAuth Login
(signing a subscription in). The owner found the three confusing: one account was spread over two or three pages, each
in the proxy's words. Accounts shows every subscription and API key in one list, in his words, and does there what he
does most: add one, fix one, turn one off or on, remove one, change its priority, see what it serves.

Every setting the three original pages have for an account can be set on Accounts, when adding it and when managing
it (section 7): the simple path stays one step, and "Advanced settings", closed, holds the rest. The other ways in of
OAuth Login (a Vertex AI service account, Sign in with ChatGPT for Codex, the login proxy) are choices of "Add account".
The three original pages are unchanged and keep their addresses; each account's "More settings" names in one line what
is still only there (section 8) and links to it. The menu changes through Provimux's nav seam (`nav.tsx`), the route is
in `routes.tsx`, and the page imports upstream's API modules, AI Providers' form model, builders and editors, and OAuth
Login's sign-in flow and dialogs as they are. One upstream function is exported: `buildInitialForm` of
`BaseProviderForm.tsx` (section 7.1). The proxy and the configuration's format are unchanged.

## 1. What it reads

| Read | For | Without it |
| --- | --- | --- |
| `GET /config` (with its `ETag`) | the API keys: `api-keys.<family>`, read as the Models page reads them (`aliases/rows.ts`) | the page cannot load |
| `GET /credentials` | the subscriptions: one login file each, with the proxy's status, renewal and cooldown fields | only the keys are listed, and the page says so |
| `GET /provimux/model-routes`, every 30 s | the cooldowns Provimux recorded on each key's routes, by `auth_index` | a key shows on or off only, and the page says so |

The page never reads a login file's content (`/credentials/download`): no token reaches it. A key is shown as AI
Providers shows it, masked (`maskApiKey`).

## 2. Services

An account belongs to a service, named as the owner knows it (`services.ts`): Claude, ChatGPT · OpenAI, Gemini,
OpenRouter, Antigravity, Devin, Muse (Meta), GitHub Copilot, xAI (Grok), Kimi, Vertex AI, or an OpenAI-compatible
entry of his own (its name; offered as "OpenAI-compatible (any other provider)", with a hint). A login's service comes from its type (`codex` is ChatGPT · OpenAI); a key's from its family
and, for an OpenAI-compatible entry, its address (openrouter.ai is OpenRouter, api.openai.com is OpenAI). A service
says how a subscription of it signs in (OAuth Login's flow, by its id) and where a key of it is stored:

| Service | Subscription (OAuth Login flow) | API key (`api-keys.<family>`, base URL) | Other ways in |
| --- | --- | --- | --- |
| Claude | `anthropic` | `claude` | — |
| ChatGPT · OpenAI | `codex` | `codex`, `https://api.openai.com/v1` (serves the built-in GPT models with no model list) | Sign in with ChatGPT for Codex (OAuth Login's SIWC binding) |
| Gemini | — | `gemini`; Advanced: "Interactions API" writes to `interactions` | Service account file (OAuth Login's Vertex import) |
| Vertex AI | — | `vertex` | Service account file |
| OpenRouter | — | `openai-compatibility`, `https://openrouter.ai/api/v1`; joins the entry already on openrouter.ai | — |
| xAI (Grok) | `xai` | `xai`, `https://api.x.ai/v1` | — |
| Muse (Meta) | `meta` | `meta`, `https://api.meta.ai/v1` (AI Providers' default) | — |
| Antigravity, Devin, GitHub Copilot | their own flow | — | — |
| Kimi | `kimi` (kimi.com) or `kimi-ai` (kimi.ai) | — (Kimi keys are a partner bundle, section 8) | — |
| OpenAI-compatible | — | `openai-compatibility`, a name and an address he types | — |

A login-providing plugin's flows are offered too, each as a service of its own. A service with one way in starts it at
once; with several, "How do you use …?" lists them (Subscription, API key, Service account file, Sign in with ChatGPT
for Codex), and each service tile names its ways ("Subscription · API key · Sign in with ChatGPT").

## 3. Whether it works now

One word per account (`state.ts`), with one line under it:

- **Off**: a login's `disabled` (or status `disabled`); a key's `excluded-models: ["*"]` (native) or `disabled: true`
  (OpenAI-compatible), as AI Providers reads them.
- **Signed out** (a login): `requires_sign_in`, a renewal state or recovery stage `sign_in_required`, or a cooldown on
  the whole login for `invalid_grant`. "Sign in to use it again."
- **Cooling down**: a cooldown on the whole login (its snapshot, counted down from when the list was received, as Auth
  Files counts it; on a server without snapshots, `next_retry_after` while the login is held), or one Provimux recorded
  on a key's routes. "until 15:17 · 47 min left".
- **Key refused** (a key): a cooldown on it for `unauthorized`, `payment_required` or `invalid_grant`.
- **Problem**: any other error the proxy reports for a login, with its message.
- **Working**: none of the above; "2 models cooling down" when some of its models cool down on their own.

"Needs you" is signed out, refused, or a problem; off and cooling down are not.

## 4. The page

Title, one line on what it is, the summary chips (accounts, working, signed out · with a problem, cooling down, off),
then search, the views All · Subscriptions · API keys · Needs you, and **Add account**. One card per service, in the
catalog's order; in it one row per account, the one tried first on top (highest priority; subscriptions before keys at
equal priority). A row: kind (Subscription green, API key amber, always with the word), who (the e-mail, else the
project, else the file name; a key's host and masked tail), the state, the priority, the fix when one is needed
(**Sign in again**, **Replace key**), the on/off switch, and the way into its panel. A row that needs him carries the
error colour on its left edge. Below the list, one line on what priority means.

An account's panel: the state in a sentence with its fix ("Try it now" clears a login's cooldown); **Use this account**;
**Priority**, with − and + and Save; **Settings**, a line of what is set ("api.openai.com · proxy · 3 models") and
**Change settings**, which turns the panel into the account's settings (section 7) with Save and Cancel; for a ChatGPT
login that can be bound, **Sign in with ChatGPT for Codex** (in use, bound, or not) and **Bind**; **See its models**
(Models filtered to the account: `?account=<auth index>`, or the login type or key family when the proxy reports no
routes); **More settings**, one line of what is still only on the original page (section 8) and a link (Auth Files
opened on the login, or AI Providers opened on the key's family and connection, through their own remembered filters);
**Remove account**, asked first.

## 5. Writes

Each change is the call the original page makes for the same change:

| Change | A login | An API key |
| --- | --- | --- |
| On, off | `PATCH /credentials/status` (Auth Files' switch) | the family's list with the key's `excluded-models` `*` rule (`applyNativeDisabled`) or the entry's `disabled` |
| Priority | `PATCH /credentials/fields` `{name, priority}`, the call Auth Files' editor makes for that field; 0 clears it | the key's own `priority` (the entry's for OpenAI-compatible), as Models sets it (`priority.ts`) |
| Remove | `DELETE /credentials` `{names}` | the key leaves its group (the group stays, as AI Providers leaves it); an OpenAI-compatible entry goes whole |
| Fix | OAuth Login's flow again: the file is named after the account, so signing in with the same account replaces it, and the proxy keeps its priority and settings | the key replaced in place; its priority, models and settings stay (an entry with several keys: on AI Providers) |
| Try now | `POST /routing/cooldown/reset` (Auth Files' reset) | — |
| Add | OAuth Login's flow and dialog, started at once | a native key: a group of its own, `<family>-<n>`, as AI Providers' add names it |
| Settings | `PATCH /credentials/fields` with only the fields that change (the Auth Files editor's call); the file is never read | AI Providers' own save (section 7.1): `providersApi.saveNativeConnection` (`If-Match`), or `createOpenAIProvider` / `updateOpenAIProvider` |
| Add with settings | the login proxy goes with the sign-in (OAuth Login's own request) | the same save as Settings, for a connection of its own or the OpenAI entry |
| Service account | OAuth Login's Vertex import (`POST /oauth/import?provider=vertex`) and its dialog | — |
| Sign in with ChatGPT | OAuth Login's SIWC binding and its dialog | — |

A key's change is `PUT /config/api-keys/<family>` with the family's list as read and one key changed at its position,
with `If-Match` set to the read's tag (`aliasesApi.putWithTag`). A list changed since the read is refused (412) and
nothing is written; the page reads again and says so. A read without a tag writes nothing. One write at a time; each
is followed by a new read.

## 6. Addresses and the menu

The menu holds **Accounts** in the place of AI Providers, Auth Files and OAuth Login, then Routing, Models and Savings.
The three original pages stay one click away, at the same addresses (`/ai-providers`, `/auth-files`, `/oauth`), in a
small group of their own right after Gateway, **All settings**, named in the owner's words: **API keys** (AI
Providers), **Subscriptions** (Auth Files, with its count), **Ways to sign in** (OAuth Login); each item's description
names the original page. They are upstream's own items (route, icon, badge), moved and renamed by `provimuxNav`
(`nav.tsx`); MainLayout is not edited, and the group is not added when upstream has none of them. `/provimux/accounts?login=<file>` or
`?account=<auth index>` opens an account's panel; `?add=<service>` (or `?add=1`) opens the add panel. Models links each
login to Accounts (its account and its priority), and Models' empty state to adding an account; Models reads
`?account=<auth index>`, a filter its menu names "Account: alex@example.com".

## 7. Settings

The owner, after the first release: "adding an account had a lot of possible settings. Where are they?" Every setting
the original pages have for one account is on Accounts, in two places that show the same fields:

- **Adding**: the key form is the key (and, for OpenAI-compatible, its name and address), then **Advanced settings**,
  closed. While closed it names what it holds ("Address, proxy, models, headers, prefix, priority, cloaking") and what
  is set in it ("proxy · 1 model · weight 3"). A sign-in's Advanced settings holds the login proxy.
- **Managing**: the panel's **Change settings** turns it into the account's settings, with Save (only once something
  changed) and Cancel; leaving with changes asks first, in AI Providers' own words.

### 7.1 An API key

The fields are AI Providers' form model (`ProviderEntryFormInput`, read by its `buildInitialForm`, `readSharedForm`
and `readMemberForm`), and a save is AI Providers' own (`keySettings.ts`). `buildInitialForm` was a private function of
`BaseProviderForm.tsx`; it is exported (one word and two comment lines), so Accounts reads a key exactly as AI Providers
reads it. The lists are AI Providers' own editors, imported: the models (`ModelEntriesEditor`, with "Get the list from
…", `useModelDiscovery`), the exclusions (`ExcludedModelsPicker`), cloaking (`LiteralReplacementEditor`,
`PatternReplacementEditor`), `ProviderBehaviorEditor`, `ConnectionPoolEditor`, `RuntimePolicyEditor`, and
`OptionalBooleanField`. The rest are Provimux fields in AI Providers' form language (`sharedForm.module.scss`), in the
owner's words:

| Group | Fields |
| --- | --- |
| Connection | Replace the key (managing; empty keeps it, the stored key is never put in a field), Address (base URL; empty: the service's own), Proxy, Custom headers; OpenAI-compatible: its name and address, and each key's proxy and weight |
| Models | Models it serves (the names are set on Models, section 7.3), Models it never serves |
| Routing | Prefix, Priority (adding; managing has the panel's Priority), Weight; WebSockets (Codex, xAI) |
| One level deeper | Cloaking and Request fingerprint and tool search (Claude), Vertex's routing (Vertex), Provider-specific behavior, Connection pool, Advanced runtime policy (retries, cooldowns, error rules) |

A native key belongs to a connection (a group of `api-keys.<family>`). A field the key sets for itself is edited on the
key; any other field is the connection's, and when the connection has other keys it carries a **shared** tag and the
view says so once: "This key shares the connection “anthropic” with 1 other key". Weight, WebSockets, cloaking, the
fingerprint and behaviour are always the key's own. The save is `providersApi.saveNativeConnection(family, source,
buildSharedSettings(…), buildNativeConnectionMembers(…))`: this key as AI Providers' key row builds it, every other key
passed as unchanged, one `PUT` with `If-Match`. A new key with settings is the same call for a connection of its own,
named `<family>-<n>`. Gemini's Advanced settings choose the Google API: the Interactions API writes the same settings
to `api-keys.interactions`. An OpenAI-compatible entry is saved with `createOpenAIProvider` / `updateOpenAIProvider`, as
AI Providers saves it (those two read and write without `If-Match`, as on AI Providers; `updateOpenAIProvider` refuses
an entry that changed since the read). A new OpenRouter key joins the entry already on openrouter.ai: its Advanced
settings are that entry's, "for all of them". A key added without touching Advanced settings is written as before
(section 5).

### 7.2 A subscription

A login's settings live in its file, next to its tokens. Accounts never reads the file (`/credentials/download`), so it
edits only what `GET /credentials` lists, with the value shown: **Note**, **Retries** (as for all accounts, or its own
number), **WebSockets** (Codex, xAI) and **Use Sign in with ChatGPT** (a bound Codex login); priority is the panel's own
field. A save is one `PATCH /credentials/fields` with only the fields that change (`loginSettings.ts`).

The settings the file keeps (proxy, prefix, headers, models it never serves, weight, its own model names, error rules,
cooling, xAI's API mode) are not edited here: a value he cannot see would invite overwriting it by mistake. One line
under them says where they are, in the menu's words ("… are in Subscriptions, under All settings"), and **Open this
login there** opens Auth Files on that login (its search set to the file, as "More settings" does), after asking about
unsaved changes. A proxy endpoint returning a login's non-secret fields would let Accounts show and edit them; it is on
the owner's list for later.

### 7.3 What stays where it was decided

- A key's **model names** (aliases) are set on Models, the one place for names of every account (design
  aliases-page.md, section 5: AI Providers' form shows them and links there); Accounts' list of a key's models does
  the same. A login's own model names are in its file (section 7.2).
- **Priority** of an account being managed is the panel's own field (section 5), not repeated in its settings.

### 7.4 The other ways in

Imported from OAuth Login as they are: `VertexImportDialog` with `useVertexImport` (Gemini or Vertex AI → Service
account file; the imported login appears under Vertex AI), `SiwcBindDialog` (ChatGPT → Sign in with ChatGPT for Codex,
and a bindable ChatGPT login's panel), and the login proxy of `useOAuthFlows` (`loginProxy`, `setLoginProxy`,
`loginProxyRejected`), checked and masked with OAuth Login's `checkLoginProxyUrl` and `maskProxyUrl`. The proxy signs in
through it and the new login keeps it (`applySessionProxyToAuthRecord` in the proxy). The add sheet no longer sends him
to OAuth Login for anything.

## 8. Left on the original pages

What cannot be done on Accounts, said in one line in each panel's "More settings"; the pages are in the menu under All
settings (section 6):

- **Auth Files** (Subscriptions): what a login's file keeps (section 7.2): proxy, prefix, headers, models it never
  serves, weight, its own model names, error rules, cooling, xAI's API mode; uploading or downloading the file; its
  quota. Also, not one account's settings: batch actions, the model rules of all logins of a service
  (`oauth-excluded-models`), manual refresh and verification.
- **AI Providers** (API keys): testing a key against a model; editing all the keys of a connection together, a key's own value of
  a shared setting (inherit, empty or its own), and a connection's name; partner bundles (APIKEY.FUN, FennoAI, Qiniu
  Cloud, AICodeMirror, Kimi keys), which write one key into several families at once.

## 9. Limits

A key's state is what the proxy keeps for it: on or off, and Provimux's route cooldowns. The proxy does not list
configuration keys in `/credentials`, so it has no "this key still works" check; that would need a proxy endpoint.
Priority is per account, for all its models; an order per model would need a change in the proxy.

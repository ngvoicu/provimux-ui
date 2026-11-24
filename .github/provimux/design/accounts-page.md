# One page for every account (Accounts)

Accounts (`/provimux/accounts`, `src/provimux/pages/accounts/`) takes the menu places of three of the original console's
pages: AI Providers (API keys per provider family), Auth Files (the login files of subscriptions) and OAuth Login
(signing a subscription in). The owner found the three confusing: one account was spread over two or three pages, each
in the proxy's words. Accounts shows every subscription and API key in one list, in his words, and does there what he
does most: add one, fix one, turn one off or on, remove one, change its priority, see what it serves.

The three original pages are unchanged and keep their addresses; each account links to its page there for everything
else ("More settings"). No upstream file is edited: the menu changes through Provimux's nav seam (`nav.tsx`), the
route is in `routes.tsx`, and the page imports upstream's API modules and OAuth Login's sign-in flow and dialog as they
are. The proxy and the configuration's format are unchanged.

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
entry of his own (its name). A login's service comes from its type (`codex` is ChatGPT · OpenAI); a key's from its family
and, for an OpenAI-compatible entry, its address (openrouter.ai is OpenRouter, api.openai.com is OpenAI). A service
says how a subscription of it signs in (OAuth Login's flow, by its id) and where a key of it is stored:

| Service | Subscription (OAuth Login flow) | API key (`api-keys.<family>`, base URL) |
| --- | --- | --- |
| Claude | `anthropic` | `claude` |
| ChatGPT · OpenAI | `codex` | `codex`, `https://api.openai.com/v1` (serves the built-in GPT models with no model list) |
| Gemini | — | `gemini` |
| OpenRouter | — | `openai-compatibility`, `https://openrouter.ai/api/v1`; joins the entry already on openrouter.ai |
| xAI (Grok) | `xai` | `xai`, `https://api.x.ai/v1` |
| Antigravity, Devin, Muse (Meta), GitHub Copilot | their own flow | — (on AI Providers) |
| Kimi | `kimi` (kimi.com) or `kimi-ai` (kimi.ai) | — |
| Other service | — | `openai-compatibility`, a name and an address he types |

A login-providing plugin's flows are offered too, each as a service of its own.

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
**Priority**, with − and + and Save; **See its models** (Models filtered to the account: `?account=<auth index>`, or
the login type or key family when the proxy reports no routes); **More settings** (Auth Files opened on the login, or AI
Providers opened on the key's family and connection, through their own remembered filters); **Remove account**, asked
first.

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

A key's change is `PUT /config/api-keys/<family>` with the family's list as read and one key changed at its position,
with `If-Match` set to the read's tag (`aliasesApi.putWithTag`). A list changed since the read is refused (412) and
nothing is written; the page reads again and says so. A read without a tag writes nothing. One write at a time; each
is followed by a new read.

## 6. Addresses and the menu

The menu holds **Accounts** in the place of AI Providers, Auth Files and OAuth Login (those three items leave it;
`/ai-providers`, `/auth-files`, `/oauth` stay), then Routing, Models and Savings. `/provimux/accounts?login=<file>` or
`?account=<auth index>` opens an account's panel; `?add=<service>` (or `?add=1`) opens the add panel. Models links each
login to Accounts (its account and its priority), and Models' empty state to adding an account; Models reads
`?account=<auth index>`, a filter its menu names "Account: alex@example.com".

## 7. Left on the original pages

- AI Providers: base URL, proxy, headers, model lists and exclusions, cloaking, group settings, weights; adding keys
  of the rarer families (Vertex, Interactions, Meta). Their existing keys are listed on Accounts.
- Auth Files: uploading and downloading login files; prefix, proxy, headers, weight, note, excluded models, retries, a
  login's own model aliases; quota cards; batch actions.
- OAuth Login: the login proxy, the Vertex service-account import, "Sign in with ChatGPT" for Codex.

## 8. Limits

A key's state is what the proxy keeps for it: on or off, and Provimux's route cooldowns. The proxy does not list
configuration keys in `/credentials`, so it has no "this key still works" check; that would need a proxy endpoint.
Priority is per account, for all its models; an order per model would need a change in the proxy.

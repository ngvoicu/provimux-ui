# One page for every model name (Models)

Models (`/provimux/models`, `src/provimux/pages/models/`) replaced three pages that answered parts of one question:
Aliases (`aliases-page.md`), Model routes and Model lists. The owner asked for one page: every model name he can send
is a row; under it, what serves it, in the order it is really tried; and his own names made, changed and removed there.

The proxy's rules and the configuration's format are unchanged. Sections 0 to 5 of `aliases-page.md` (the stores,
the writes with `If-Match`, the row model, the operations, what the page cannot read, the login files' own aliases)
are the rules this page writes by: its data layer, `src/provimux/pages/aliases/`, is the Aliases page's, extended
only by an API key's priority (section 4 below).

## 1. What it reads

| Read | For | Without it |
| --- | --- | --- |
| `GET /config` (with its `ETag`) and `GET /credentials` | the draft: rows, entries, issues | the page cannot load |
| `GET /provimux/model-routes`, every 30 s | every name the proxy serves, each route's priority and cooldown | only the configuration's names; no order where a priority is unknown; one line says so |
| `GET /provimux/model-lists`, every 30 s | each login's list source and age, on its routes; the live-lists switch | no list detail, no switch |
| `GET /provimux/model-lists?auth_index=…`, per login, again when its list changes | where each model's limits come from: which routes say "limits estimated", the sources in Details | no such marks or sources |
| `GET /provimux/savings?period=30d&group=model` | requests per name in 30 days, to find the names he uses | no "used" section |

`catalog.ts` (pure) joins them: a served route is matched to its configuration row (an API key by `auth_index`, a
login type by provider) when the read has a row answering that name in that entry; such a route is the row's, and the
draft says whether it is changed or removed. A route without a row is "built in" (a login's own model, a key's
built-in list, or an alias in a login's own file, which the page never reads). A draft row the proxy does not serve
under a name gets a line of its own: new, moved, ignored, or not reported.

## 2. A name and its routes

- Rows: one per name (compared trimmed, lower-case). His own names (an alias row gives them) come first, most used
  first, unsaved names on top; then the names used in 30 days; then the rest, folded until a search or filter.
- Order: among the tried routes (not removed, not ignored, not shadowed, not turned off), the highest priority first;
  equal priorities share a rank. When a tried route's priority is not known, no route of the name is ranked.
- Problems, one sentence each: a row Provimux ignores (`incomplete`, `same-as-name`, `duplicate`), a row a key never
  uses (`shadowed`), one service answering the name with different models (`several-models`, not a pool). A name
  served by several services is not a problem: it is a pool.

Words. The owner reads quickly and does not know the proxy's internals, so every label says what it means
(he asked "wtf is this" of Model lists' "17 not in the catalog yet"). A route of a model that only the login's own
list has (the built-in list lacks it) carries **new: limits estimated**, with one line on why: its context, output
and reasoning limits come from that list or from defaults; its tooltip names the company for each ("Context from
Codex's list; output: a default; reasoning levels: a default"). A route whose model has a limit no list states carries
"limits estimated", with the same kind of tooltip. Rows show no sizes ("why are they shown at all"): a name's
**Details** list its context, output and reasoning levels, each with where it comes from ("from Codex's list", "from
the built-in list", "a default"). No letter codes: Model lists' legend "L / B" ("who is the provider") is gone with
its table. A login's list reads "Claude's model list, 2 hours ago", "built-in
model list" or "providers.dev model list"; a name a subscription offers by itself "can't be taken out here"; no label
says catalog, alias row, login type or backoff.

## 3. Edits

All edits go to the one draft and are saved with one action, by `aliasesApi.commit` (aliases-page.md 3.4): the same
`PUT /config/api-keys/<family>` and `PUT /config/oauth/model-alias`, each with `If-Match`.

- **New name, add a model**: a login type gets an alias row with `fork: true`; an API key a second row for the model
  (its own name stays). Refused, with why: a model already under the name; a login model whose own name is the name;
  a login type or key that already answers the name with another model (Provimux would ignore, or never use, the
  second row; an OpenAI-compatible entry pools them instead). A key without a model list offers nothing.
- **Rename**: every alias row of the name takes the new name; routes under the model's own name keep the old one.
- **Remove a name, take a model out**: `removeRow` (a login row is deleted; a key's row loses its alias, so the key
  keeps the model under its own name). A key's model under its own name is taken out on AI Providers, not here.
- Rows of a part the page cannot read take no edit (aliases-page.md 2.5).

## 4. An API key's priority

The proxy reads an API key's priority from `api-keys.<family>`: the group's `priority`, which its keys inherit, or the
key's own (`null` inherits); an OpenAI-compatible entry has its own. That is the list the page already writes, so the
priority is edited here (`priority.ts`): set on the key (on the entry for OpenAI-compatible), in the same request as
the family's rows, with the same `If-Match`. A priority-only edit leaves the model list where it is stored. It applies
to every model of the key, and the page says so. A login's priority is in its login file: shown, and changed on Auth
Files (the login's account opens it there). An order per name would need a change in the proxy.

## 5. Addresses and settings

`/provimux/aliases` (`?family`, `?channel`, `?store`), `/provimux/model-routes` (`?provider`), `/provimux/live-lists`
and `/auth-files/oauth-model-alias` (`?provider` as the login type) lead to Models with their filter (`address.ts`).
The menu holds Models (always) and Savings. Below the list: the live-lists switch with "Refresh lists now"; Devin's
quota pause only with a Devin login, and OpenRouter only with an OpenRouter entry, both only where Provimux answers.

Not carried over: Model routes' per-route limit and reasoning chips (a name's Details hold its sizes and levels), and
Model lists' per-model table of which source stated each value (Details say it per name).

## 6. Excluded models

The owner (2026-11-24): "In the Models page, shouldn't I have the exclude models? And a list with all excluded and its
provider, nicely done?" Models has two views, **Names** (sections 1 to 5) and **Excluded models**: tabs under the
title, the view in the address (`?tab=excluded`, `&model=<name>` to search one model). The page keeps the location it
opened with while only its query changes (upstream's page transition), so the view is the page's own state, read from
the address when it opens and written back to it; a tab or a name's mark switches it without a navigation.

### 6.1 What is excluded where

`exclusions.ts` reads the page's one read of the configuration (no other request): places, and the rules on them.

| Place | Stored in | How the proxy applies it |
| --- | --- | --- |
| One API key (Gemini, Interactions, Claude, Codex, xAI, Meta, Vertex) | the key's `excluded-models`, else its connection's (`api-keys.<family>[g]`) | the key's list replaces the connection's; `*` alone is the key's off switch (Accounts' switch), not listed |
| Every subscription of a login type | `oauth.excluded-models.<type>` (`oauth-excluded-models` before v8; Auth Files' "Excluded models" page) | applies to every login of the type, unless the login's own file has a list, which then replaces it (`sdk/cliproxy/service_models.go`) |
| A login's own list | `excluded_models` in its login file, next to its tokens | never read here: one line says so and links to Subscriptions (Auth Files filtered to the service's type) |

OpenAI-compatible entries (OpenRouter and the owner's own) have no exclusions in the proxy (`OpenAICompatibility` has no
such field; their registration never applies one): they serve only the models in their list, and one line says so. A
coming Provimux release adds them. The one switch is `familyExcludes` in `exclusions.ts`: places, the write guard and
that line all follow it; switching it on also needs the entry-level list in `storedListOf` and `familyWithKeyRule`
(an entry is one place) and a model list to offer, at the level the release stores it. Not built until then.
Matching is upstream's (`matchesExcludedRule`): case does not matter and `*` stands for any characters; the proxy
matches the served name and the upstream model. A part of the file the page cannot read whole (a list that is not a
list, a number the browser cannot hold) is named in one line, not listed and never written.

### 6.2 The view

One card per model or pattern, in name order; in it one row per place (the service's icon, "Every Claude subscription
· 1 login now" or "Claude API key st******a1 · anthropic", the kind as on Accounts, **Remove**). A key's row links to its
account on Accounts; a key that uses its connection's list says "from its connection “anthropic”, shared by 2 keys".
Where the proxy reports its routes, each card says whether something still serves a model the rule matches: **Served
nowhere now** (the one inverse mark, and the card's left edge), or "Still served by 1 account" with who (a key by its
masked tail). Without routes it says that this is not known. Above: the counts (exclusions, models and patterns, served
nowhere), the search (a model's name finds the patterns that take it out), the services with exclusions as a filter,
and **Exclude a model**. On Names, a name a rule takes out (by its name or a model it sends) carries "Excluded in 2
places", linking to the view searched for it.

**Exclude a model**: the model (the service's built-in list from `GET /routing/model-definitions/<channel>` and the
served names offered, free text and patterns allowed), the service, then where: every subscription of it ("and any
added later") or one of its keys. Before writing, one line says what it will mean ("will no longer be served by every
Claude subscription. No other account serves it now: it will be served nowhere"). Refused, with why: `*` alone (the off
switch, on Accounts), a space or a comma (the proxy keeps a key's rules joined by commas), a rule the place has, a model
a pattern of the place already takes out.

### 6.3 Writes

Each change is written at once, one request, the original pages' own for the field, from the page's read and with
`If-Match` set to its tag (`writes.ts`, `exclusionsApi.ts`); the page then reads again, whatever the answer.

| Change | Request | Body |
| --- | --- | --- |
| Every subscription of a type | `PUT /config/oauth/excluded-models` (Auth Files' `saveOauthExcludedModels` path) | the map as read; the type's list with the rule added or taken out, its other spellings folded in; a list left empty is removed |
| One key | `PUT /config/api-keys/<family>` (as AI Providers and Accounts write a key) | the family's list as read with one list changed: the key's own when it has one (an emptied own list stays, so the key still does not use its connection's); the connection's when no other key uses it; otherwise the key gets its own, the connection's with the change (as `applyNativeDisabled` does). `*` and anything not a string stay |

A file changed since the read is refused (412) and nothing is written: the page says so and has read again. A read
without a tag writes nothing. While the names have edits not saved, no exclusion is written (one line says to save or
discard them first): a write changes the file's tag, which the names' save is conditional on.

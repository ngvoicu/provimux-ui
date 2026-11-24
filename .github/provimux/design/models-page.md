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
| `GET /provimux/model-lists?auth_index=…`, per login whose list has models the built-in list lacks, again when that list changes | which models get "new: limits estimated" | no such mark |
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
and reasoning limits come from that list or from defaults. A login's list reads "Claude's model list, 2 hours ago",
"built-in model list" or "providers.dev model list"; a name a subscription offers by itself "can't be taken out
here"; no label says catalog, alias row, login type or backoff.

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

Not carried over: Model routes' per-route reasoning levels and limit chips (the name keeps its context), and Model
lists' per-model table of which source stated each value.

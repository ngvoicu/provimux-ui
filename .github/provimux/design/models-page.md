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
- Accounts: a name's row says how many accounts Provimux can send it to ("2 accounts"), and the summary chip and
  the view "More than one account" ("20 served by more than one account") hold the names with more than one. That
  is where the order of priority matters, and where a paid key can share the requests with a subscription. It counts
  the tried routes, each account once, as Accounts counts them: a login; an API key; an OpenAI-compatible entry with
  all its keys (a pool of several models under one name in it is one account). Where the proxy reports what it
  serves, a row it does not serve now (a model the key excludes, a login type no login of which offers it) is not
  one; a signed-out or cooling login still is, as Accounts says it is skipped only meanwhile. The same model under
  another name (`devin/claude-opus-5-5`, OpenRouter's `anthropic/claude-opus-5.5`) is another name, with its own
  accounts: a request for one never goes to another's account. The owner read "20 on several routes" as "models I
  can reach in several ways", so the words are "account", never "route" or "fallback" (with the same priority, the
  accounts share the requests), and the filter beside them, "Served by", starts at "Any account". Joining such names
  is "Your names"' work.
- Lines (2026-11-25, three things a card drew wrong). An OpenAI-compatible entry with several keys has one route
  per key in the proxy (each its own cooldown), so one line per key; each such line names its key, masked as
  Accounts masks one ("openrouter.ai · key fi******h8", `KeyEntry.keyPreviews`), where two lines read the same before
  ("4 accounts" over 5 identical-looking lines). The entry still counts once. Where the proxy reports what it
  serves, a line it does not serve now (`idle`) gets no order number ("–"): only lines that are tried are ranked.
  A pool (two or more rows of one OpenAI-compatible entry under one name) is one route per key in the proxy, which
  takes turns between the pool's models on that key and tries the next one when one fails (`nextModelPoolOffset`,
  `rotateStrings`, `proxy:sdk/cliproxy/auth/conductor_models.go`). The card draws the other models on the route's
  own line, "→ deepseek/deepseek-v4 or deepseek/deepseek-v4-pro", the "or" explaining the pool; they are served,
  so no "doesn't serve this route now" (`RouteLine.poolOf`). In the editor each model stays a member of its own,
  removable; a removed one is struck through on the route's line until the save.
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

## 7. The System page's models card, and the catalog update

The owner (2026-11-24): System's "Available models" list is a duplicate of Models. The theme hides that card
(`theme/_system.scss`: the card of the page's column whose header holds `.modelsActions`), and one line takes its place:
"Every model your accounts serve, with its names, its routes and where it is excluded, is on Models", with **Open
Models**. `SystemPage.tsx` is not edited: the line comes from Provimux's seam already in its Quick links card
(`ProvimuxLinks` renders `ProvimuxSystemModels`), which places it right after the hidden card through a portal. When
upstream no longer has that card, nothing is placed and nothing is hidden.

The card's "Update model catalog" was `POST /models/refresh`, the request Models' "Refresh lists now" sends: the proxy
then updates the shared model catalog and, with live lists on, asks every login for its list. With live lists off
"Refresh lists now" cannot ask, so **Sync model catalog** stands beside it: Auth Files' own action
(`useModelCatalogSync`, imported as it is), the same request. Each button's line says which does what.

## 8. Serve only my names

The owner (2026-11-25): "In the Models page can we have a setting where only 'names' I set are available through
Provimux? The rest are like excluded?" The gateway's design is Provimux's `.github/provimux/design/only-my-names.md`
(the rule, the setting, the refusal, `GET /provimux/names`); its contract is `pui13/openapi.yaml` there. All six of
its decisions are taken as recommended: a `keep` list of exact names inside the setting, by name not by route, no
switching on with zero names, no wildcards, refusals counted in memory, the plugin path as it is. This section is
the page.

A name is **his** when an alias row gives it (the page's rule of section 1), when `models.only-my-names.keep` lists
it (a model kept under its vendor's name: an alias row equal to its name is dropped by the proxy, aliases-page.md
3.5), or when an alias in a login's own file gives it (only the gateway sees those: `set_by: login-file`). With the
switch on, every other name is refused as an unknown model.

### 8.1 What it reads and writes

| | |
| --- | --- |
| `GET /provimux/names`, every 30 s with the routes | the rule as the gateway applies it now (`applied`): his names (`names`, each with its prefixed `copies`), every other name with its accounts (`others`), the switch's state, `keep` entries the gateway ignores, and the names asked for and refused. Not probed at login: the page's own load reports to the presence store; a 404 hides the switch and changes nothing else |
| The page's read of the configuration | `models.only-my-names` as stored (`readSetting`): the source of every write's body, and where the switch stands while a write is not applied yet. From a gateway without `applied`, also `keep` the moment after a write, joined to its answer (`yourNameKeys`, `setNamesOf`) |
| `GET /provimux/savings?period=30d&group=model&include=requested_models` (read with the page, and again when the preview opens) | the order by use: `requested_models`, the names tools sent (an alias under the alias, a prefixed name with its prefix); when they start inside the 30 days (`from`), the days before by model (`?from=&to=&group=model`), and one line "Names are counted as your tools sent them since Nov 20; before that, under the model that answered." Without the field (an older gateway) or with no day of names, the rows by model, as before. Failed, folded into `~other` or `truncated`: one line says the order by use is not complete |
| `PUT /config/models/only-my-names` | the whole object, `{...as stored, enabled, keep}`, with `If-Match` on the read's tag (`onlyMyNamesApi`, `namesSetting.ts`): other fields of the object, patterns and anything not a string in `keep` stay as stored |

Writes are the exclusions' (section 6.3): one at a time, never while the names have edits not saved (the write
changes the tag their save is conditional on; one line says so and every Keep waits), nothing without a tag or
over a setting the page cannot read whole (not a map, `keep` not a list); a 412 writes nothing and the page reads
again. After every write the page reads the configuration, then waits on the gateway (`namesApplied.ts`).

**A write applied.** The gateway answers a write before its accounts have registered again, and its names describe
the rule it applies until they have. The page reads the names at once, then at 150 ms, 300 ms, 600 ms, 1 s, … and once a
second up to 15 s, until `applied.config_etag` is the configuration's tag the write left (the page's read after it,
else the write's own `ETag`) and `applied.applying` is false; then it reads the routes. Meanwhile the answer is the
rule before, and the page shows it as that once a read has said so (the first read, at once, usually reflects the
write already: the gateway commits it within milliseconds of answering, and until that read the page shows nothing
new rather than "as before"): the switch stands where the file puts it, reading "Applying…" and
disabled, its line "Applying your change. Until the gateway has, it serves the names as before." (no counts, which are
the old rule's); a kept name stays under Not served, its Keep busy, until the gateway serves it; the write's
notification ("Only your names are served now.") comes only then. Past 15 s, the switch reads "Not applied yet" and
the line is a warning: "The gateway
hasn't applied your change yet, so it still serves the names as before. This page looks again every 30 seconds.", the
notification "Saved, but the gateway hasn't applied it yet.", and the switch can be used again; the line goes with the
first 30 s read that reflects the write. A save of names and an exclusion wait the same way, without holding the save
bar. A gateway whose answer has no `applied` is read again 1 s and 4 s after the write, as before, with the read's
`keep` joined to its answer.

### 8.2 The switch

At the top of Names, above the summary, not with the settings below the list: it decides what the whole list
means, and for an owner with no names of his own the way in has to be the first thing on the page. A card with the
page's left edge (brand while on), the shield, "Serve only my names", one line ("Tools can ask only for the names
under Your names. Every other model is refused.") and its state in one line:

| State | The line |
| --- | --- |
| Off | "Off: all 561 names are served, 14 of them yours." With none of his own: "…You have no names of your own yet: turning this on starts by showing the ones your tools use, to keep." |
| On | "On: 14 names served, 547 not served." and **Show what isn't served** (unfolds Not served, scrolls to it). With no names (set by hand): "On, and you have no names: nothing is served…", warning tone |
| Home | the switch disabled, "Doesn't apply": "Home decides which names this gateway serves, so this setting doesn't apply here." A reason the console does not know reads the same way, without naming Home |

Turning it on writes nothing: it opens the preview, the switch reading "Not on yet". Turning it off is one click,
written at once, no question. `keep` entries the gateway ignores (a pattern, an empty one) are named in one line,
with **Remove them**.

### 8.3 The preview

What turning it on changes, before anything is switched, in the card under the switch:

- "547 names will stop being served. 6 of them were used in the last 30 days."
- **Stay served**: his names as chips; a kept one has its own ×, Stop keeping. None: "None yet. Keep the names your
  tools use, below: with none, nothing would be served."
- **Used in the last 30 days**: most used first, each with its requests, who serves it, and **Keep**; **Keep all 6**
  writes them in one request. Who serves it is the line the design asked for before Keep writes: each service by kind,
  in the access colours ("Claude subscription", "Claude API key · paid per token"), an OpenAI-compatible entry once
  whatever its number of keys, two logins of a type "×2" (`accountGroups`).
- **Not used in 30 days** (or "Every other name" when the usage is not known): folded with a sample; unfolded, a search
  ("Find a name to keep") and the rows, 60 at a time.
- The confirming row stays in reach (sticky) and says what will happen: "Serve only my names (14)"; while used names
  are not kept, the danger button "Turn on: 3 used names will be refused" and the line "3 names your tools used are
  not kept: a tool that asks for one will get an error."; with no names, the button is disabled and the line says to
  keep one first (decision 3). Cancel closes it.

Keep writes at once, while the switch is still off: the kept row leaves the used list and its chip appears, so the
list shrinks as he goes and the switch goes on last.

### 8.4 With it on

The list has two parts. **Your names**, cards as before; a kept name says "kept under its own name" (not also "Your
name"), has **Stop keeping** (written at once; its tooltip says tools asking for it are refused from then on) and no
rename or remove in its editor (it has no alias rows); a kept name no account offers now stands there too, "No account
offers this name now. It is served as soon as one does." Then **Not served**: every other name as a row with who
offers it and Keep, used ones first, folded ("Show the 547 names that aren't served (2 used in 30 days)"). The search
and "Served by" filter narrow it and unfold it; a view (More than one account, Cooling down, …) hides it, since its
rows have no routes. "Used in the last 30 days" and "Other models" are not drawn while it is on: everything not his is
under Not served.

### 8.5 What was refused

While `refused.names` has a name that is still not his, a warning strip under the switch: "Tools asked for 2 names
that aren't served", since when it counts, one line ("Keep a name to serve it under its own name, or set the tool to
ask for one of your names."), and per name how many times, when last, who would serve it, and Keep; most refused
first, then by name. The name is the one the gateway resolved (a speech route's `tts-1` shows as `grok-tts`), and no
line says it is the one the tool sent. A name kept since leaves the strip once the gateway serves it. Over 256 names:
one line says only the first 256 are counted.

### 8.6 The save

With the switch on, a save that takes a name's last alias away, the name neither kept nor set in a login's file,
stops serving it: the save bar says so after the count of changes ("2 names will no longer be served: haiku, sonnet")
(`droppedBySave`). A rename counts as the old name going.

### 8.7 Files and tests

`namesSetting.ts` (pure: the setting, the bodies, his names and their copies, the preview's order, the usage state,
the filter, the save's names), `namesApplied.ts` (pure: whether a write is applied, and the wait), `onlyMyNamesApi.ts`
(the write), `OnlyMyNames.tsx` and `.module.scss` (the switch with its preview, the refused strip,
Not served); `catalog.ts` takes the kept and login-file names (`SetNames`: `own`, `aliased`, `kept`). Tests:
`tests/provimux/only-my-names.test.ts`, with `fixtures/models/owner-names.json`, the gateway's answer for
`owner-config.json` (the fixture the gateway's test S2 can share): Your names equals the answer's `names`; the preview
orders used names first and counts them; Keep sends the whole object with `If-Match` and nothing else of the file
changes, a 412 writes nothing, no tag and an unreadable setting send nothing, unsaved edits stop every Keep; a 404
shows no switch; zero names keeps the button disabled; on, the refused strip and Not served; Home; the three line
fixes. Round 2 of the gateway: the marker read, the wait (at once, sooner then slower, late at the limit, a gateway
without it), the switch while applying and when late, a kept name not served before it is applied; copies counted and
never Not served; usage by the name sent (the whole range, a `from` inside it with the days before by model, folded,
an older gateway), the two savings requests; the refused strip's order. The fixture carries `applied` and `copies` as
the gateway's `pui13/examples/names.json` does.

### 8.8 What the contract does not give the page

Round 2 of the gateway (its only-my-names.md 15) gave the page the three it lacked: `applied` (whether an answer
reflects a write), `copies` (a name's prefixed copies; the page's guess from the routes is gone) and
`requested_models` (usage by the name the client sent). What it still does not give:

- `PUT /config/models/only-my-names` is the generic config writer at a path the file may not have yet; that it takes
  an object there is the gateway design's own [infer] (its test C2). If it refuses, Keep says "The gateway refused
  the change" with its message, and nothing else breaks.
- `applied.config_etag` matches only the configuration the gateway last read: when another writer changes the file
  between the page's write and its read after it, the page waits on the later tag. When one changes it after that
  read, an answer carries neither tag: the page then reads the configuration's tag alone, and an answer whose tag
  is the file's as it is now (and not the tag the write was conditional on) applies the file the write is part of
  (the gateway's tag is exact, its only-my-names.md 16.6). Before this, the page said "Not applied yet" for good.
- `requested_models` has no days: before its `from`, the page counts by the model that answered (an alias's traffic
  under the vendor's model, a prefix lost), and says from when names are counted. It is not filtered and has no
  per-key split: the preview cannot say which tool sent a name.
- A prefixed copy is drawn as the routes list it (with the served names; under "Other models" while the switch is on),
  not on its name's card: `copies` gives its accounts, not its routes.
- A refused name does not say which client key asked: the strip can say what and when, not which tool.

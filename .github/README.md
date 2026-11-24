<h1>
  <a href="https://providers.dev"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/lockup-dark.svg">
    <img alt="Provimux by providers.dev" src="assets/lockup-light.svg" width="224" height="56">
  </picture></a>
</h1>

<p>
  <a href="https://github.com/ngvoicu/provimux-ui/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/ngvoicu/provimux-ui?label=release&amp;color=4338ca"></a>
  <a href="../LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/ngvoicu/provimux-ui?color=4338ca"></a>
  <a href="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"><img alt="Built on the CLI Proxy API Management Center" src="https://img.shields.io/badge/built%20on-CLI%20Proxy%20API%20Management%20Center-4338ca"></a>
</p>

**One key for every AI account.**

The web console for Provimux and CLIProxyAPI. With Provimux, it shows which account serves each model, why a route is
paused, and each login's own model list.

**provimux-ui**, by [providers.dev](https://providers.dev), is the web console of
[Provimux](https://github.com/ngvoicu/provimux), the self-hosted AI gateway for you or your whole team that keeps your
prompt cache in use and shows which account answered each request. One page in your browser to manage your API keys (API key, `apikey`) and
accounts, see on **Models** every model name you can send and which accounts serve it, in the order they are tried,
with the cooldown recorded and each login's list, give models names of your own, watch quotas and logs, and edit the
config. It is built on the
[CLI Proxy API Management Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) by router-for-me:
every page of the original, in the providers.dev look, plus Provimux's own pages. Provimux downloads it by itself.

**[Provimux](https://github.com/ngvoicu/provimux)** · the endpoint &nbsp;·&nbsp; **provimux-ui** · its web console (this
repository) &nbsp;·&nbsp; **[providers.dev](https://providers.dev)**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/dashboard-desktop-dark.png">
  <img alt="The console's dashboard. The sidebar reads Provimux by providers.dev and lists Dashboard, AI Providers, Auth Files (3), OAuth Login, Routing, Quota Management, Logs Viewer, Config Panel and Management Center Info. The page headline reads Quiet for now, with the server version and Connected below it, a Manage providers button and an Inspect logs link; a card on the right shows 0 requests handled. Below: success rate –, credentials 3, provider keys 0, models 5, and an empty live-traffic chart." src="assets/dashboard-desktop-light.png">
</picture>

## What provimux-ui adds

- **[Provimux's own pages](#provimuxs-own-pages)**: **Models**, every model name you can send, with the API keys and
  logins that serve it in the order they are tried, the cooldowns Provimux recorded and each login's list; your own
  names (one model, or several under one name) made and saved there.
- **[The providers.dev look](#the-providersdev-look)**: "Provimux by providers.dev" throughout, in three themes.
- **[The Provimux version](#the-provimux-version-and-the-console-on-the-system-page)** and the console's update source
  on the System page.
- **[No sponsors or affiliate links](#no-sponsors-or-affiliate-links).**

Then: [Use it](#use-it) · [Versions and releases](#versions-and-releases) · [Build it](#build-it) ·
[Support](#support) · [Built on](#built-on-the-cli-proxy-api-management-center) · [License](#license)

### Provimux's own pages

In the sidebar under Gateway, **Models** (it replaced Aliases, Model routes and Model lists, whose addresses lead to
it) and **Savings**:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/models-desktop-dark.png">
  <img alt="The Models page. Chips read 41 names, 13 of yours, 4 on several routes, 2 cooling down, 1 needs a look. Below a search field, a filter by what serves a name, the views All, Several routes, Cooling down and Needs a look, and a New name button, the section Your names: opus, served by a Claude subscription, 1840 requests in 30 days; claude-opus-5-5, served in this order by a Claude subscription at priority 10, a Devin subscription at priority 5 that is cooling down, and a Claude API key and OpenRouter sharing priority 0; sonnet, marked Needs a look, with a second route Provimux ignores because the login type already uses the name." src="assets/models-desktop-light.png">
</picture>

**Models.** Every model name a client can send is a row: the models your subscriptions and keys serve under their own
names, and the names you made, one model or several under one name. Your names come first, then the models used in the
last 30 days, then the rest (folded). Under each name, the routes that serve it in the order Provimux tries them
(among the routes that can take a new request, a higher priority first; routes that share one share the requests):
subscription in green, API key in amber, the provider, the login as Auth Files names it (it opens there) or the key's
host, the model it sends upstream, its priority, the cooldown Provimux recorded on it, counting down (a record, not a
verdict on availability), and for a login where its list of models comes from and how old it is ("Claude's model
list, 2 hours ago"). A model only the login's own list has yet carries "new: limits estimated", with one line on why and where each of its
limits comes from; a context no list states reads "(a default)".

**New name** makes a name and puts models under it; on a name, **Edit** renames it, adds or takes out models, or
removes it. A row Provimux would ignore, or never use, says so in one sentence. An API key's priority is edited on its
route (it applies to every model of the key); a login's priority is in its file, on Auth Files. Everything is saved
with one action, as configuration rows (`api-keys.<family>`, `oauth.model-alias`) written only if the file is still
the one the page read. Below the list: the **live model lists** switch with a refresh request, and, when you have them,
**Devin's quota pause per model** (`oauth.providers.devin.model-level-cooling`) and **OpenRouter**, the
OpenAI-compatible entries on openrouter.ai that Provimux gives cache markers, a session header and OpenRouter's own
limits (on AI Providers such an entry carries an "OpenRouter · Provimux" tag).

Routes, lists and use come from endpoints only Provimux has (`/v8/management/provimux/…`, described in
[Provimux's README](https://github.com/ngvoicu/provimux/blob/main/.github/README.md#model-routes-and-live-list-status-for-the-console)).
Connected to CLIProxyAPI, which answers 404 there, Models shows the names of the configuration only, without order or
cooldowns, and says so; Savings is not in the sidebar.

### The providers.dev look

The console reads "Provimux by providers.dev" in the tab title, favicon, sidebar, login page and footer, with
providers.dev's colours and type (Geist and Geist Mono), in three themes: white, soft grey and dark. The original's
pages, settings and requests are unchanged; Provimux's own pages come on top of them.

<table>
  <tr>
    <td width="50%"><picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/login-desktop-dark.png">
      <img alt="The login page. On the left a field of indigo dots and the line Welcome to Provimux. On the right the Provimux by providers.dev signature, the title Management Center, the current URL, a management key field, Remember password and a Login button." src="assets/login-desktop-light.png">
    </picture></td>
    <td width="50%"><picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/system-desktop-dark.png">
      <img alt="The Management Center Info page. The Provimux tile, Provimux by providers.dev, the line with the Provimux version and the CLIProxyAPI release it is based on, and Built on CLIProxyAPI and the CLI Proxy API Management Center by router-for-me, MIT licensed. Cards show the management UI version, the server version, build time and connection status. Quick links: Provimux on GitHub, providers.dev, Built on CLIProxyAPI, Built on CLI Proxy API Management Center, CLIProxyAPI documentation. Below, the available models by provider." src="assets/system-desktop-light.png">
    </picture></td>
  </tr>
</table>

### The Provimux version and the console on the System page

Connected to Provimux, the Management Center Info page shows its version and the CLIProxyAPI release it is based on
("Provimux version 8.0.79-pmx.1 (based on CLIProxyAPI 8.0.79)"). Connected to CLIProxyAPI, it shows CLIProxyAPI's
version, as the original does. The quick links point to Provimux, providers.dev, CLIProxyAPI and the original console.
From v1.28.3-pmx.2 it also shows which console release is installed, and its update source: where the server's updater
fetches new releases (`management.panel-github-repository`, resolved with the updater's own rules, so a value the
updater cannot use shows the default it falls back to) and whether it updates itself.

### No sponsors or affiliate links

The original's sponsor page ("Quick Start"), the sponsor row under the proxy URL setting and the affiliate sign-up
links on provider presets are hidden. A test fails when a new upstream release adds an affiliate link that is not
hidden.

## Use it

**With Provimux, there is nothing to do.** Provimux downloads the latest provimux-ui release by itself, at startup and
every 3 hours, and installs it only when it matches the release's `checksums.txt`; a config that still names the
original console (`management.panel-github-repository`) gets provimux-ui too. Open
`http://127.0.0.1:8317/management.html` (on the same machine; from another machine, use the server's address) and sign
in with your management key (`management.secret-key`). To install Provimux, see
[its README](https://github.com/ngvoicu/provimux/blob/main/.github/README.md#install).

**For a team.** Provimux on a server your team shares serves everyone you choose, each with their own client key; to
open the console to other machines, set `management.allow-remote: true`. See
[For a team](https://github.com/ngvoicu/provimux/blob/main/.github/README.md#for-a-team) in Provimux's README.

**A release of your choice, or with CLIProxyAPI.** Give the server provimux-ui's `management.html` yourself: the asset
of a [release](https://github.com/ngvoicu/provimux-ui/releases) of this repository, or [your own build](#build-it).

1. Download `management.html` and its checksum into a folder, for example `~/provimux-ui`, and check it:

   ```bash
   mkdir -p ~/provimux-ui && cd ~/provimux-ui
   curl -fLO https://github.com/ngvoicu/provimux-ui/releases/latest/download/management.html
   curl -fLO https://github.com/ngvoicu/provimux-ui/releases/latest/download/checksums.txt
   shasum -a 256 -c checksums.txt   # on Linux: sha256sum -c checksums.txt
   ```

   It prints `management.html: OK`. For another release, replace `latest/download` with `download/<tag>`. The file
   carries the console's MIT license notice in a comment at its top.

2. In your config, stop the console's automatic updates. Otherwise the server replaces the file at startup and every
   3 hours with its own choice: Provimux with the latest provimux-ui, CLIProxyAPI with the original console:

   ```yaml
   management:
     disable-auto-update-panel: true
   ```

   Put it in your config's existing `management:` block if it has one. Configs from before CLIProxyAPI v8 call that
   block `remote-management:`; the server reads it too, but when a config has both, set the key in `management:`.

3. Start the server with `MANAGEMENT_STATIC_PATH` set to that folder (or to the file itself):

   ```bash
   MANAGEMENT_STATIC_PATH="$HOME/provimux-ui" provimux --config /path/to/your/config.yaml
   ```

4. Open `http://127.0.0.1:8317/management.html` (on the same machine; from another machine, use the server's
   address) and sign in with your management key (`management.secret-key`).

**Accounts.** Add API keys on the AI Providers page. For a company, use API keys and cloud accounts (for example
Vertex), billed to the company under its own agreement with the provider.

The OAuth Login page adds subscription logins (`oauth`). Provimux also accepts subscription logins for your own
account, for your own use. Whether a provider allows a third-party tool to use its subscription login is that
provider's decision: Anthropic's terms do not allow it, and OpenAI has not authorized it. Read your provider's terms
before you add a login; the account is yours and so is the risk. Provimux is not affiliated with or endorsed by
Anthropic or OpenAI.

Without `MANAGEMENT_STATIC_PATH`, the console lives in a `static` folder next to your config file (or under
`WRITABLE_PATH` when that is set): replacing `static/management.html` there, with automatic updates off, works too.
The console is served only when `management.disable-control-panel` is `false`, the default.

## Versions and releases

A provimux-ui version names the console release it is built on: `v1.28.3-pmx.1` is the CLI Proxy API Management Center
1.28.3 with Provimux build 1.

Releases are automatic. When the original console publishes a release, a workflow moves provimux-ui onto it, runs the
tests, the linter and the build, and when the check passes publishes `v<base>-pmx.1` on its own. Each release starts
as a prerelease and becomes the latest release once the published `management.html` has passed its checks, including
a headless browser run against a stub of the management API; Provimux then picks it up within 3 hours. A release that
fails a check waits for the owner, and the reason is in an issue. See
[.github/provimux/releases.md](provimux/releases.md) and [.github/provimux/SYNC.md](provimux/SYNC.md).

## Build it

With [Bun](https://bun.sh):

```bash
git clone https://github.com/ngvoicu/provimux-ui
cd provimux-ui
bun install && bun run build
```

The build is a single file, `dist/index.html`, with its scripts, styles and fonts inlined; rename it to
`management.html` to serve it as above. `bun run dev` starts a local server for working on it, and `bun run verify`
runs the tests, the linter and the build.

## Support

Provimux is free and stays open source (MIT). For companies that run it, providers.dev offers support plans:
**Community** (free: GitHub issues and discussions, best effort) and **Team**, **Business** and **Priority** (paid),
listed with prices and terms at [providers.dev/support](https://providers.dev/support/). A paid plan buys a private
channel and a first reply within a stated number of business days: a reply, not a promised fix. Provimux has one
maintainer, and we say so: announced holidays pause the clock, there is no 24/7 and no uptime promise for a service
you host yourself, and the code stays MIT, so you can always fork it.

## Built on the CLI Proxy API Management Center

provimux-ui is the [CLI Proxy API Management Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center)
by [Router-For.ME](https://github.com/router-for-me) and
[its contributors](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/graphs/contributors), MIT
licensed: every page, setting and request in the console is their work, except Provimux's own pages. It manages
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), which Provimux is a distribution of.

It stays close to the original on purpose. Each provimux-ui version is an upstream console release with a thin
Provimux layer on top:

- everything Provimux is in new files under `src/provimux/` (brand, theme, translations of the brand, the System
  page's lines and links, the sponsor hiding, Provimux's pages and their API clients);
- the original's files reach it only through one-line seams: an import, a logo, a line on a page;
- the parts of the console that compose requests to AI providers (quota and usage calls, OAuth logins, model lists,
  the AI Providers page's connection test and key usage check) are never changed: a check on every push and pull
  request, `provimux-ui-guard`, fails when a Provimux commit touches them.

The original's README, in [English](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/main/README.md) and [Chinese](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/main/README_CN.md), describes the
console's features.

This repository's GitHub **Sponsor** button goes to [the owner's GitHub Sponsors](https://github.com/sponsors/ngvoicu).
Sponsorships support Provimux and the owner's other open-source tools.

## License

MIT, like the original console. See [LICENSE](../LICENSE). Geist and Geist Mono are under the SIL Open Font License
([OFL.txt](../src/provimux/theme/fonts/OFL.txt)).

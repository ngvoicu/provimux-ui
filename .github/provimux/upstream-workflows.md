# Upstream workflows in provimux-ui

provimux-ui carries the Management Center's `.github/workflows/` files unchanged, so that rebasing onto each upstream console release never conflicts on them. Both are switched off in the GitHub settings of `ngvoicu/provimux-ui` (`gh workflow disable`), not by editing or deleting the files. They were disabled while Actions was still off for the repository, before any tag other than the base tag was pushed.

| Workflow file | Trigger | State in ngvoicu/provimux-ui | Why |
|---|---|---|---|
| `ci.yml` | `pull_request`, `push` to `main` and `dev` | disabled in ngvoicu/provimux-ui | Runs `bun install` and `bun run verify` (repository code) on every pull request; provimux-ui will run verify in its own workflows, with the read-only/publish split of its release pipeline. |
| `release.yml` | `push` of tags `v*` | disabled in ngvoicu/provimux-ui | Publishes `management.html` as a GitHub release for any `v*` tag, including upstream's version tags and `v*-pmx.*` tags; CLIProxyAPI and Provimux download the latest release within 3 hours, so an unbranded or unreviewed build would reach every install. |

provimux-ui's own workflows live in separately named files.

| provimux-ui workflow | Trigger | What it does |
|---|---|---|
| `provimux-ui-guard.yml` | `push` to `main`, `pull_request` | Required check: the base is an upstream console release tag, the Provimux layer sits last, and layer commits change no provider-facing path (`src/utils/quota/`, `src/features/quota/providers/`, `src/features/oauth/`, the quota clients in `src/services/api/`). Runs git and `.github/provimux/guard.sh` only. |

When a rebase brings a new upstream workflow file, disable it in the repository settings before pushing any tag, and add a row here.

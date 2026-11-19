# provimux-ui sync

`main` is a release tag of the [upstream console](https://github.com/router-for-me/Cli-Proxy-API-Management-Center), then
the Provimux layer (commits with the trailer `Provimux-Layer: branding`). When the upstream console publishes a release
(about 11 a month), provimux-ui moves the layer onto it, publishes `v<base>-pmx.1` and makes it the latest release,
with no step by the owner. It is Provimux's sync (`ngvoicu/provimux`, `.github/provimux/SYNC.md`) in the same shape,
adapted to a console that is one HTML file.

**Check, publish and promote automatically; the owner only for what needs a decision.** A workflow checks each new
release and reports in an issue. When the check passes, a second workflow, started only by that check run's
completion, pushes `main` and the tag with the owner's token `PROVIMUX_TOKEN`, a secret of the environment
`provimux-token` that only one fixed `git push` step sees. The tag starts the release workflow, which builds the
file, publishes it as a prerelease, checks the published file (digests, page, title, MIT notice, version) and loads
it in a headless browser against a stub of the management API, and only then makes it the latest release. When
anything refuses or fails, nothing more happens and the issue says why. "Publish now" is a fresh check run
(Actions → provimux-ui-check), never a hand-started publish run.

| Piece | Where it runs | What it may do |
|---|---|---|
| `provimux-ui-check.yml`, job `prepare` (`check.sh select`, `check.sh prepare`) | GitHub Actions | `contents: read`. git and the API only: runs no repository code. |
| `provimux-ui-check.yml`, jobs `test (candidate)` and `test (tag)` (`check.sh tree`, `check.sh test`) | GitHub Actions | `contents: read`. The only jobs that run upstream's and the candidate's code (`bun install`, `bun run verify`), one tree per job. They write logs and exit statuses and decide nothing. |
| `provimux-ui-check.yml`, job `verdict` (`check.sh verdict`) | GitHub Actions | `contents: read`. Reads the exit statuses as data, writes `result.json`, binds the artifact. Runs no repository code. |
| `provimux-ui-check.yml`, job `report` (`report.sh`) | GitHub Actions | `issues: write`. The run's own scripts only. |
| `provimux-ui-publish.yml`, job `publish`, step `Verify` (inline, before any checkout) | GitHub Actions, environment `provimux-token` | No secret. Proves this workflow revision is the live `main`, the check run's exact attempt passed on it, and that attempt's verdict binds one artifact. |
| `provimux-ui-publish.yml`, job `publish`, steps `Decide`, `Plan`, `Push values`, `Wait` (`autopublish.sh decide`, `publish.sh --ci`) | GitHub Actions, environment `provimux-token` | `GITHUB_TOKEN` with `issues: write`. `main`'s own scripts: git, gh, jq and the guard of the current `main` on git objects; never candidate or upstream code, `bun` or `node`. Never see `PROVIMUX_TOKEN`. |
| `provimux-ui-publish.yml`, job `publish`, step `Push` | GitHub Actions, environment `provimux-token` | The only step with `PROVIMUX_TOKEN`: one inline `git push` of values an earlier step checked; it runs `git` and nothing else. |
| `provimux-ui-publish.yml`, job `notify` (`autopublish.sh notify`) | GitHub Actions | `issues: write`, no environment, no secret. The current `main`'s script tells the sync issue what the remote really shows after a failure. |
| `provimux-ui-release.yml`, jobs `smoke` and `promote` | GitHub Actions, the tag's release run | `smoke`: `contents: read`, checks the published release (`release-check.sh`, `smoke.mjs`). `promote`: `contents: write` with `GITHUB_TOKEN`, no checkout, inline: makes it the latest release. |
| `.github/provimux/publish.sh` by hand | the owner's Mac | Pushes `main` and the tags with the owner's `git` and `gh` credentials, when the automatic publish refused and the owner decided. |

## The check

`provimux-ui-check.yml` runs every 3 hours and can be started by hand (Actions → provimux-ui-check → Run workflow,
input `tag`; or `gh workflow run provimux-ui-check.yml -R ngvoicu/provimux-ui -f tag=v1.28.4`). One run at a time.
Every job checks out the run's own commit (`github.sha`, the run's `head_sha`) and runs that commit's scripts.

**Job `prepare`** (`check.sh select`, then `check.sh prepare`; git and the API only):

1. **Release.** The newest *stable* release of the upstream console: published, neither a draft nor a prerelease,
   with a `vX.Y.Z` tag (not `releases/latest`). An explicit `tag` must be a stable release too.
2. **Old base.** The newest `vX.Y.Z` tag of upstream (its refs, `git ls-remote`, not local tags) whose commit is an
   ancestor of `main`. A `vX.Y.Z` tag reachable from `main`, as new as that base or newer, that upstream withdrew or
   moved fails the check: it never falls back to an older tag. `guard.sh` uses the same rule.
3. **Already done?** If `v<base>-pmx.*` exists: `published` when every such release is complete (not a draft, no
   longer a prerelease, both assets) and the newest `provimux-ui-release` run for the tag **at the tag's commit**
   succeeded; `in-progress` while such a run runs; `incomplete` otherwise (reported, with the release run's errors).
   If `main` is already on the tag and no `-pmx` tag exists: `unreleased` (reported). If the tag does not descend
   from the old base: fail.
4. **Rebase.** `git rebase --committer-date-is-author-date <tag commit>` in a temporary worktree, never `--onto`, so
   the same inputs give the same candidate.
5. **range-diff** of `<old base>..<old main>` against `<new base>..<candidate>`. A layer commit the rebase **dropped**
   (`<`) or **changed** (`!`) needs the owner's decision. A `!` whose change is identical, where only the upstream
   code around it moved (the `-U0` patches without hunk headers are equal: `split_changed` in `common.sh`), is listed
   as "context only" and accepted: the layer touches many upstream files, so this is the usual case of a rebase.
6. **Workflow files.** Every path under `.github/workflows/` new in the tag is listed, and `publish.sh` refuses such
   a release (see "New upstream workflow files").
7. **Guard** on the candidate with `PMX_EXPECT_BASE=<tag>` and `PMX_EXPECT_BASE_COMMIT=<commit>`.

**Jobs `test (candidate)` and `test (tag)`**, one runner each: `check.sh tree` makes a checkout of the commit (the
same files, filters and modes the release's `actions/checkout` makes, so the tested tree is the released tree),
without `.git`; then Node.js 24 and the Bun version the tree's `package.json` pins (`packageManager`; the release's
build job uses the same), and `check.sh test`: `bun install --frozen-lockfile`, then `bun run verify` (tests, lint,
build). They keep the logs and exit statuses and decide nothing.

**Job `verdict`** (`check.sh verdict`): `bun run verify` must pass on the candidate, because the release's build job
runs the same verify and a candidate that fails it cannot be released. The pristine tag's run says whose failure it
is: "the Provimux layer breaks it" when the tag passes, "upstream's own failure" when the tag fails too (still a
failure). It uploads the artifact `provimux-ui-check-<tag>` (`result.json`, `candidate.bundle`, `logs/`) and binds it
to itself: its step "Bind the artifact to the verdict" writes the artifact's id, name and digest as the job's one
annotation titled `provimux-ui-check-artifact`. `publish.sh` and `autopublish.sh` take only that artifact
(`check_artifact` in `common.sh`): of one given attempt of the run, the job `verdict`, exactly one such annotation, an
artifact of that id, run, name and digest, not expired. The test jobs can upload artifacts of any name but cannot
annotate the verdict job; whatever they upload is never read.

**Job `report`** (`report.sh`): one issue per base, `sync: v<base> — <state>`: `ready to publish`, `failed` (the step
and details: the rebase stop and conflicting files, the verify output of both trees, the guard output),
`release incomplete` (with the release run's errors), `main on base, not released`. `published`, `in-progress` and
`incomplete` are read from the releases and release runs by `report.sh` itself, never taken from `result.json`. It
closes the issue only when every `v<base>-pmx.*` release is complete with a successful release run for the tag's
commit and every job of the check succeeded.

## Publishing automatically: `provimux-ui-publish.yml`

One trigger: `workflow_run` of a completed `provimux-ui-check` run on `main`; no `workflow_dispatch`. One publish at a
time (`concurrency: provimux-ui-publish`, never cancelled midway).

**Job `publish`** (only for a check run that concluded `success`, on `main`, event `schedule` or `workflow_dispatch`,
of this repository; environment `provimux-token`; `contents`, `actions`, `checks: read`, `issues: write`). One job
verifies, plans and pushes, so no run id, attempt or artifact id crosses a job boundary:

1. **Verify, inline, before any checkout** (`selftest.sh` runs these exact lines, between `# >>> verify` and
   `# <<< verify`): the event is `workflow_run`; the workflow is `provimux-ui-publish.yml` on `refs/heads/main`;
   `github.workflow_sha` = the check run's `head_sha` = the live `refs/heads/main`. A rerun keeps its original
   `workflow_sha`, so a rerun after `main` moved is refused. The check run's **exact attempt** from the event must be
   `provimux-ui-check.yml`, on `main`, `schedule` or `workflow_dispatch`, `completed`/`success`, of this repository, at
   that `main`, with one job `verdict` carrying exactly one `provimux-ui-check-artifact` annotation.
2. **Checkout of exactly that commit** (no stored credential), and a check that `HEAD` is it.
3. **Decide** (`autopublish.sh decide`): `check_artifact` for exactly that run and attempt; it must be the verified
   artifact id. Skips (green) when the check selected no release, when the status is not `pass`, or when
   `v<base>-pmx.*` exists.
4. **Plan** (`publish.sh <tag> --ci --plan ...`, no token): everything in "Publishing by hand" up to the push, for
   exactly that run, attempt and artifact, with no `--accept-*` (a dropped or changed layer commit, or a new
   workflow file, is refused). It leaves `plan.env` and the verified bare repository.
5. **Push values** (inline, no token): reads `plan.env` (exactly 10 lines, each checked against its pattern and the
   verified values) and writes the push's repository, lease and refs as step outputs.
6. **`PROVIMUX_TOKEN` is set**: if not, red with that message; nothing is pushed.
7. **Push**, the only step with the token: one `git push --atomic --porcelain
   --force-with-lease=refs/heads/main:<the verified main>` of `main`, `v<base>` (when the repository lacks it) and
   `v<base>-pmx.1` from the plan's bare repository, hooks off, no global or system git config, the token read by a
   credential helper from git's environment.
8. **Wait** (`publish.sh --ci --wait`, no token): waits for the whole `provimux-ui-release` run of `v<base>-pmx.1` at
   the candidate (build, prerelease, smoke, promote) and the complete release, then closes the issue.

**Job `notify`** (after a failure or cancellation of `publish`; no environment): the current `main`'s
`autopublish.sh notify` reads the remote first (`main`, `v<base>`, every `v<base>-pmx.*` with its release and release
run, and that run's errors) and retitles `sync: v<base>` with what is true: `released`, `pushed, release running`,
`pushed, release not complete, owner needed` (e.g. a promotion check kept it a prerelease; the errors are quoted),
`ready, publishing waits for PROVIMUX_TOKEN`, `publish refused, owner needed`, `main pushed without its tags, owner
needed`, `main moved, nothing published`, or `publish failed, state unknown, owner needed`. Each distinct state and
reason is commented once.

Why the owner's token and not `GITHUB_TOKEN`: a tag pushed with `GITHUB_TOKEN` starts no workflow run, so no release
would be built; `GITHUB_TOKEN` cannot push commits that change `.github/workflows/` (a rebase onto a new upstream
release can); and the owner's token bypasses the ruleset "main: provimux-ui-guard required" (bypass: repository
admins) as the owner's own pushes do.

## Promotion: jobs `smoke` and `promote` of `provimux-ui-release.yml`

Every release is published as a prerelease first (job `publish`, unchanged), so the console updater of Provimux and
CLIProxyAPI, which reads `releases/latest`, does not see it yet. Then:

- **`smoke`** (`contents: read`, no secret): `release-check.sh <tag> <dir> <the build's sha256>` downloads the
  published `management.html` and `checksums.txt` from their public URLs and checks: exactly these two assets,
  uploaded; sha256 of the file = the line of `checksums.txt` = the API digest = the build job's; `checksums.txt`
  matches its own digest; one page (doctype first, no external script or stylesheet); the title "Provimux by
  providers.dev"; every line of `LICENSE` (the tag's) in the comment after the doctype; the version (the tag) in the
  page. Then `smoke.mjs` serves the file at `http://127.0.0.1:<port>/management.html` next to a stub of the
  management API (every `/v8/management/...` answers 401), opens it in headless Chrome over the DevTools protocol (no
  npm package) and checks: the login page renders (a form with a password field and a submit button), signing in
  with a throwaway key reaches the stub with that key as a bearer token and the page shows the refusal, no request
  leaves 127.0.0.1 (scripts, styles, fonts, images, fetches), no uncaught exception.
- **`promote`** (`contents: write` with `GITHUB_TOKEN`, no checkout, inline; `selftest.sh` runs its lines between
  `# >>> promote` and `# <<< promote`): only after `smoke` passed. The checked sha256 must be this run's build; it
  re-reads the release (not a draft; `management.html`'s digest still the checked one), does nothing when it is
  already the latest, refuses when a newer release is the latest (version order), then
  `gh release edit <tag> --prerelease=false --latest` and reads it back.

If any check fails, the release stays a prerelease, the release run is red, and the sync issue quotes the failing
job's errors (the publish job's `notify`, or the next check's report).

**Why in the release workflow, not separate.** Every `-pmx` tag gets the same checks, whoever pushed it (the
automatic publish, or the owner's `publish.sh` or `-pmx.2`), so no release needs a manual step; the expected file is
the same run's build output, so nothing has to bind a second workflow's run to this release (a separate
`workflow_run` workflow would need its own verifier of run, tag and commit, the hand-off the Provimux reviews
removed); and "the release run succeeded" now means "published and promoted", which is what `publish.sh --wait`, the
check's `published` state and the issue already read. In the publish workflow it would miss hand-pushed tags and run
a browser in the token's environment. The browser runs in `smoke`, which has no write permission; `promote` runs no
repository code.

**Dry run.** `gh workflow run provimux-ui-release.yml -R ngvoicu/provimux-ui --ref main -f release=v1.28.3-pmx.1`
skips the build and publish jobs, runs `smoke` against that published release and `promote`, which says what it
would do and changes nothing.

## The token

`PROVIMUX_TOKEN` is the owner's one fine-grained token for Provimux and provimux-ui (repositories `ngvoicu/provimux`,
`ngvoicu/homebrew-tap`, `ngvoicu/provimux-ui`; Contents: Read and write; Workflows: Read and write; Metadata: Read),
described in Provimux's `SYNC.md`, "The token". In provimux-ui it is a secret of the **environment
`provimux-token`** only, never a repository secret; only the job `publish` of `provimux-ui-publish.yml` declares the
environment, and only its step `Push` reads the secret. The release workflow needs no token of the owner.

The environment exists (created 2026-11-19 with these calls; no reviewers, no wait timer; it may deploy only from the
branch `main` and the tags `v*-pmx.*`):

```sh
echo '{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}' |
  gh api -X PUT repos/ngvoicu/provimux-ui/environments/provimux-token --input -
gh api -X POST repos/ngvoicu/provimux-ui/environments/provimux-token/deployment-branch-policies -f name=main -f type=branch
gh api -X POST repos/ngvoicu/provimux-ui/environments/provimux-token/deployment-branch-policies -f name='v*-pmx.*' -f type=tag
```

**The owner's step, once:** store the same token value there: Settings → Environments → `provimux-token` →
Environment secrets → Add secret `PROVIMUX_TOKEN`, or

```sh
gh secret set PROVIMUX_TOKEN --env provimux-token -R ngvoicu/provimux-ui    # asks for the value
```

A repository secret named `PROVIMUX_TOKEN` must not exist in provimux-ui. When the token expires or is revoked,
publishing stops red at its push and the issue says "publishing waits for PROVIMUX_TOKEN"; publishing by hand works
meanwhile (the release workflow needs no token of the owner).

### What still needs the owner

The token, once (or when it expires); a dropped or changed layer commit (`--accept-dropped`/`--accept-changed`); a
release with new workflow files ("New upstream workflow files"); a failed check, a rebase conflict, a failing
verify ("Manual cases"); a release that stayed a prerelease ("Check a release"); a `-pmx.2` on the same base; a
release older than the newest stable one (the scheduled check only checks the newest: start a check with its `tag`).

## Publishing by hand: `publish.sh`

On the owner's Mac, from a clone of `ngvoicu/provimux-ui`, in a scratch worktree of `upstream/main`. It changes
nothing in the clone (it works in a temporary repository that borrows the clone's objects) and runs no code of the
candidate or of upstream: only `git`, `gh`, `jq` and the guard of the current `main`.

```sh
git fetch upstream
git worktree add --detach ../pui-publish upstream/main && cd ../pui-publish
bash .github/provimux/publish.sh v1.28.4 --dry-run    # everything except the push
bash .github/provimux/publish.sh v1.28.4              # asks: type "publish v1.28.4"
cd - && git worktree remove ../pui-publish
```

1. **Check run.** The newest successful `provimux-ui-check` run on `main` whose `head_sha` is the remote `main` now
   and whose bound verdict artifact is `provimux-ui-check-<tag>` (`--run <id>` picks among such runs).
2. **Re-checks.** `result.json` says `pass` for this tag, its old `main` is the run's `head_sha`; the bundle's only
   head is the candidate; upstream's tag is still a stable release at the recorded commit (and the old base tag
   still at its commit); the remote `main` is still the old `main`; no `v<base>-pmx.*` exists.
3. **Verifies again locally**: ancestry (old base → new base → candidate, no merges); the range-diff (dropped,
   changed, context only) and the new workflow paths recomputed and equal to `result.json`'s; the guard of the
   current `main` on the candidate, on git objects only, with the exact base.
4. **Decisions.** Dropped and changed layer commits are refused unless each is named (`--accept-dropped <sha,...>`,
   `--accept-changed <sha,...>`, the old `main`'s commits, 7+ hex digits). New workflow files are refused outright.
5. **Plan, confirmation, re-checks, one atomic push**: `main` with `--force-with-lease=refs/heads/main:<old main>`
   (a literal SHA), `v<base>` at upstream's commit (when the repository lacks it), `v<base>-pmx.1` at the candidate.
   GitHub first, then the NAS mirror: `git push origin main v<base>-pmx.1` afterwards.
6. **Wait and close**: until the `provimux-ui-release` run of the tag at the candidate finished and the release is
   complete (promoted); then it closes the issue.

## Manual cases

Every procedure runs in a scratch worktree. Before changing `main`, capture the remote `main` as a literal SHA and
use it as the lease; never `upstream/main` resolved at push time:

```sh
git fetch upstream
lease=$(git rev-parse upstream/main); echo "$lease"
git worktree add --detach ../pui-fix "$lease" && cd ../pui-fix
```

### The rebase stops

The issue names the layer commit and the conflicting files. Rebase the layer onto the new tag by hand
(`git rebase <tag>`), resolve, `bash .github/provimux/guard.sh`, `bun install --frozen-lockfile && bun run verify`,
then push `main` (`--force-with-lease=refs/heads/main:$lease`) and the tag `v<base>-pmx.1` yourself (the release
workflow checks and promotes it), or push only `main` on the old base with the layer adjusted so that the next check
rebases cleanly.

### A layer commit was dropped or changed

Read the range-diff in the issue (or `logs/range-diff.txt` of the artifact). Intended (upstream took that part of the
layer): publish with `--accept-dropped <sha>` / `--accept-changed <sha>`. Not intended: fix the layer on the old base,
push it, run the check again.

### New upstream workflow files

provimux-ui carries upstream's workflow files unchanged and disables each one in the repository settings
(`upstream-workflows.md`). A new file would run as soon as it reaches `main` if it triggers on a push, and on the tags
if it triggers on tags, and a workflow can only be disabled once it exists on `main`. So `publish.sh` refuses such a
release and the owner publishes it in two pushes: with Actions off for the repository, push `main` (lease as above);
`gh workflow disable <file> -R ngvoicu/provimux-ui` for each new file and add its row to `upstream-workflows.md`;
Actions back on; then push `v<base>` and `v<base>-pmx.1`.

### Check a release

`gh release view v<base>-pmx.<n> -R ngvoicu/provimux-ui` and its `provimux-ui-release` run. A release that stayed a
prerelease failed `smoke` or `promote`; their errors are in the run and the issue. A problem of the file: fix it in a
new `-pmx.<n+1>` (a tag is never moved, a published asset never replaced). A problem of the check itself or the
runner: `gh run rerun <id> --failed -R ngvoicu/provimux-ui`. Promoting by hand is possible
(`gh release edit <tag> --prerelease=false --latest`) but skips the checks.

## Testing the scripts

- `bash .github/provimux/selftest.sh` runs the fixture tests offline (local repositories, a stub `gh` and `curl`):
  the guard and `release-meta.sh` with a base only upstream or withdrawn or moved, the range-diff's dropped, changed
  and context-only commits, `check.sh verdict`, `report.sh`, the inline verifier of `provimux-ui-publish.yml`,
  `autopublish.sh` decide and notify, `publish.sh --ci`, `release-check.sh` and the inline promote step of
  `provimux-ui-release.yml`. Run it after changing any of these.
- `check.sh`, `report.sh`, `publish.sh`, `autopublish.sh` and `selftest.sh` run with macOS bash 3.2.
- `PMX_TAG=v1.28.2 bash .github/provimux/check.sh` (all steps, in one process) from a checkout whose `HEAD` is the
  `main` to check: it runs `bun install` and `bun run verify` of both trees.
- `PMX_REPORT_DRY_RUN=1 RESULT=<result.json> CHECK_JOB=success bash .github/provimux/report.sh` prints the issue a
  result would produce; `PMX_NOTIFY_DRY_RUN=1 TAG=v1.28.4 OUTCOME=failed LOG=<log> bash
  .github/provimux/autopublish.sh notify` what a refusal would write.
- `PMX_LICENSE=LICENSE bash .github/provimux/release-check.sh v1.28.3-pmx.1 /tmp/rc` and
  `node .github/provimux/smoke.mjs /tmp/rc/management.html v1.28.3-pmx.1` check a published release locally.

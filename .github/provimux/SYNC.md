# provimux-ui sync

`main` is a release tag of the [upstream console](https://github.com/router-for-me/Cli-Proxy-API-Management-Center), then
the Provimux layer (commits with the trailer `Provimux-Layer: branding`). When the upstream console publishes a release
(about 11 a month), provimux-ui moves the layer onto it, publishes `v<base>-pmx.1` and makes it the latest release,
with no step by the owner. It is Provimux's sync (`ngvoicu/provimux`, `.github/provimux/SYNC.md`) in the same shape,
adapted to a console that is one HTML file. One commit of the layer, **the README commit**, replaces upstream's root
`README.md` and `README_CN.md` with a pointer of its own, and the sync re-applies it on every release ("The root README
commit"). The README commit is on `main` and required: the guard fails a stack without it (`require_readme=1`).

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
| `provimux-ui-check.yml`, jobs `test (candidate)` and `test (tag)` (`check.sh fetch-prepare`, `check.sh tree`, then the steps `bun install --frozen-lockfile` and `bun run verify`) | GitHub Actions | `contents`, `actions: read`. The only jobs that run upstream's and the candidate's code, one tree per job. They upload nothing; their result is their own steps' conclusions. |
| `provimux-ui-check.yml`, job `verdict` (`check.sh verdict`) | GitHub Actions | `contents`, `actions: read`. Reads the prepare artifact by its id and digest and the test jobs' step conclusions from the API, writes `result.json`, binds the artifact. Runs no repository code. |
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
3. **Already done?** If `v<base>-pmx.*` exists, its **newest** tag (version order) decides: `published` when that
   release is complete (not a draft, no longer a prerelease, both assets) and the newest `provimux-ui-release` run for
   the tag **at the tag's commit** succeeded; `in-progress` while that run runs; `incomplete` otherwise (reported,
   with the release run's errors). An earlier tag of the base that failed is kept as history in the issue: a failed
   `.1` followed by a verified `.2` is released, and the `.1`'s failure stays on record (`releases_status`).
   If `main` is already on the tag and no `-pmx` tag exists: `unreleased` (reported). If the tag does not descend
   from the old base: fail.
4. **Rebase.** `git rebase --committer-date-is-author-date <tag commit>` in a temporary worktree, never `--onto`, so
   the same inputs give the same candidate. The check resolves one stop itself, at the README commit, only when all of
   these hold: the old `main` has exactly one README commit `R` and the stop is at it (`REBASE_HEAD` = `R`); it is the
   first stop; `R` has one parent and changes only root READMEs (the set: `README.md`, `README_CN.md`; compared as
   whole root tree records, so an added empty directory counts), and no path of the set is a directory in `R`'s parent
   or at the stop; at least one path is unmerged and every unmerged path is in the set; every path the index holds
   differently from `HEAD` is in the set (names NUL-delimited, whole). Then each path of the set gets `R`'s entry
   (`git checkout R -- <path>`) or none (`git rm`), and `git rebase --continue` runs with the rebase's own `-c`
   options. Any other stop, and a second stop, fail the check as before; `rebase.json` records the README commit and
   the paths that conflicted.
5. **range-diff** of `<old base>..<old main>` against `<new base>..<candidate>` (`stack_range_diff` in `common.sh`,
   the only place either script runs `git range-diff`). With a README commit on both sides it is the range-diff of the
   commits below the README commits and of those above them, with the line `README  <R> -> <R'>  <subject>` between;
   the README commit is in no list and is checked instead by its **normal form**: `R'` is `R` re-applied (both one
   parent; the same author line and message; the same entries for the set; `R'`'s root tree records outside the set,
   name, mode, type and object, are its parent's, and no path of the set is a directory in its parent; the candidate's
   tip has the old `main`'s entries for the set). A failure is a reason (the check fails), and no flag accepts it. A
   git command that fails anywhere in this comparison (a segment's range-diff, a listing, a tree read) makes the check
   `error`: one failed segment is never hidden by another. `result.json`'s `readme` is `null` or `{old, new,
   reapplied}`. Every layer commit the rebase **dropped** (`<`) or **changed** (`!`) needs the owner's decision;
   nothing is accepted because "only the code around it moved" (review T-73: upstream swapping two items made an
   unchanged layer patch hide the wrong one). A pair range-diff calls **equal** (`=`) counts as changed too when one
   of its binary files differs: a patch shows a binary file only as "Binary files differ", so the full blob ids are
   compared, with paths NUL-delimited as git stores them (a non-ASCII name such as `café.png` included)
   (`range_diff_lists`, `binary_changes`).
6. **Workflow files.** Every path under `.github/workflows/` new in the tag is listed, and `publish.sh` refuses such
   a release (see "New upstream workflow files").
7. **Guard** on the candidate with `PMX_EXPECT_BASE=<tag>` and `PMX_EXPECT_BASE_COMMIT=<commit>`. Its rule 5 checks
   the README commit (every git read checked: a failed read fails the guard): exactly one (none fails:
   `require_readme=1`), with `Provimux-Layer: branding`, one parent, its root tree records outside the set equal to
   its parent's, no directory of its parent at a path of the set, `README.md` a regular file and `README_CN.md`
   absent; and then at the candidate exactly one root entry whose name begins with `readme` (any case), the regular
   file `README.md`. A root README upstream adds (`README_JA.md`) fails here, named.

**Jobs `test (candidate)` and `test (tag)`**, one runner each: before any code of the tree runs, `check.sh
fetch-prepare` fetches the prepare job's artifact by the id and digest that job output; `check.sh tree` makes a
checkout of the commit (the same files, filters and modes the release's `actions/checkout` makes, so the tested tree is
the released tree), without `.git`; then Node.js 24 and the Bun version the tree's `package.json` pins
(`packageManager`; the release's build job uses the same), and two steps of their own, `bun install
--frozen-lockfile` and `bun run verify` (tests, lint, build). They upload nothing. **The pristine tag's job is
diagnostic only**: its job and its two steps continue on error, so its failure never fails the job, the check run or
the publish of a passing candidate. Because GitHub reports a failed step that continues on error as `success`, its
failures are recorded by two marker steps that run only then, `pristine install failed (diagnostic)` and `pristine
verify failed (diagnostic)`, which the verdict reads.

**Every input of a later job is bound to the job that produced it.** A job of the same run can replace an artifact
under the same name (it holds the run's artifact token), so no job reads an artifact by name: the prepare job and the
verdict job output their upload's id and digest, and `fetch_artifact` (`common.sh`) takes only that id, of this run,
with that name and digest, and checks that the download hashes to it. The prepare job's state is JSON, read field by
field against a pattern (`state_get`), never sourced.

**Job `verdict`** (`check.sh verdict`): the test outcomes are the conclusions of the steps `bun install
--frozen-lockfile` and `bun run verify` of the jobs `test (candidate)` and `test (tag)` of this run attempt, read
from the API: nothing the tests wrote is read. `bun run verify` must pass on the candidate, because the release's build job
runs the same verify and a candidate that fails it cannot be released; the candidate alone decides. The pristine
tag's run says whose failure it is: "the Provimux layer breaks it" when the tag passes, "upstream's own failure" when
the tag fails too (still a failure); for a passing candidate its result (or its absence) is only shown in the issue. It uploads the artifact `provimux-ui-check-<tag>` (`result.json`, `candidate.bundle`, `logs/`) and binds it
to itself: its step "Bind the artifact to the verdict" writes the artifact's id, name and digest as the job's one
annotation titled `provimux-ui-check-artifact`. `publish.sh` and `autopublish.sh` take only that artifact
(`check_artifact` in `common.sh`): of one given attempt of the run, the job `verdict`, exactly one such annotation, an
artifact of that id, run, name and digest, not expired. The test jobs could upload artifacts of any name but cannot
annotate the verdict job; whatever they upload is never read. The report job fetches it by the id and digest the
verdict job output.

**Job `report`** (`report.sh`): one issue per base, `sync: v<base> — <state>`: `ready to publish`, `failed` (the step
and details: the rebase stop and conflicting files, the test steps' conclusions with links to both test jobs, the
guard output), `release incomplete` (with the release run's errors), `main on base, not released`. `published`,
`in-progress` and `incomplete` are read from the releases and release runs by `report.sh` itself, never taken from
`result.json`. It closes the issue only when the base's newest `-pmx` tag is released and every job of the check
succeeded, with the failed earlier tags of the base in the closing comment.

**The sweep.** The check selects one upstream release, but a tag can fail on any base (a hand-pushed `-pmx.2` on an
older base, an automatic one that failed after a newer upstream release). After its own base, `report.sh` lists every
`v*-pmx.*` tag and every release (`unreleased_bases`: one API call, one `ls-remote`), and for every other base whose
newest tag has no complete release opens or updates its own `sync: v<base> — release incomplete` issue with the
release run's errors; an open sync issue of a base that is now released is closed with its history.

## The root README commit

The design is `design/root-readme.md` (task T-100); Provimux has the same rule for its three root READMEs.

| | |
|---|---|
| Trailers | `Provimux-Layer: branding` and `Provimux-Readme: root`, in one trailer block |
| Paths, the set | exactly `README.md` and `README_CN.md` (root), in `PMX_README_PATHS` (`common.sh`) and `readme_paths` (`guard.sh`) |
| State it leaves | `README.md` the pointer (mode 100644), `README_CN.md` absent |
| How many | exactly one in `<base>..main` |

A commit is the README commit when its trailer `Provimux-Readme` has the value `root`. To change the pointer, add a
layer commit on top that edits `README.md`; it rebases cleanly, since the README commit always leaves the same file.
`tests/toolchainVersion.test.ts` (a one-line seam) no longer reads the root READMEs, and `.github/README.md` links the
original's README in its own repository. What still fails on purpose: upstream renames or moves a root README (the
rebase stops outside the set), another commit conflicts on a README, upstream adds a root README the set does not name
(the guard).

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
   exactly that run, attempt and artifact, with no `--accept-*` (a dropped or changed layer commit, or a new workflow
   file, is refused). It leaves `plan.env` and the verified bare repository.
5. **Push values** (inline, no token): reads `plan.env` (exactly 10 lines, each checked against its pattern and the
   verified values) and writes the push's repository, lease and refs as step outputs.
6. **`PROVIMUX_TOKEN` is set**: if not, red with that message; nothing is pushed.
7. **Push**, the only step with the token: one `git push --atomic --porcelain --force-with-lease=refs/heads/main:<the
   verified main>` of `main`, `v<base>` (when the repository lacks it) and `v<base>-pmx.1` from the plan's bare
   repository, hooks off, no global or system git config, the token read by a credential helper from git's
   environment.
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
CLIProxyAPI, which reads `releases/latest`, does not see it yet. The repository has **immutable releases** enabled:
once published, a release's assets and its tag cannot change (GitHub still allows changing the prerelease and latest
flags, which is all promotion does). Then:

- **`smoke`** (`contents: read`, no secret): `release-check.sh <tag> <dir> <the build's sha256>` downloads the
  published `management.html` and `checksums.txt` from their public URLs and checks: exactly these two assets,
  uploaded; sha256 of the file = the line of `checksums.txt` = the API digest = the build job's; `checksums.txt`
  matches its own digest; one page (doctype first, no external script or stylesheet); the title "Provimux by
  providers.dev"; every line of `LICENSE` (the tag's) in the comment after the doctype; the version (the tag) in the
  page. Then `smoke.mjs` serves the file at `http://127.0.0.1:<port>/management.html` next to a stub of the
  management API (every `/v8/management/...` answers 401), opens it in `chrome-headless-shell` (a pinned build installed
  with `@puppeteer/browsers`; unlike full Chrome it has no Google services that call out on their own) over the
  DevTools protocol and checks: the login page renders (a form with a password field and a submit button), signing in
  with a throwaway key reaches the stub with that key as a bearer token and the page shows the refusal, no uncaught
  exception, and **nothing leaves the stub for the whole browser process**: the stub is the browser's only proxy
  (`--proxy-server`, loopback not bypassed, every host name unresolvable but 127.0.0.1, WebRTC kept off non-proxied
  UDP); it serves only requests for its own origin and refuses and counts every other request, `CONNECT` tunnel
  (https, wss) and upgrade, from any page, worker or WebSocket; one attempt fails the check.
- **`promote`** (`contents: write` with `GITHUB_TOKEN`, `statuses` and `actions: read`, no checkout, inline;
  `selftest.sh` runs its lines between `# >>> promote` and `# <<< promote`): only after `smoke` passed, and **one at
  a time in the whole repository** (job concurrency group `provimux-ui-promote`; different tags run in different
  release concurrency groups). The checked sha256 must be this run's build. It requires the tag's commit to carry the
  release authorization for exactly this tag (next section); the release to be published, **immutable**, with
  `management.html`'s digest still the checked one; and the latest release to be read for certain: a 404 is "none
  yet"; an answer must name a `v<base>-pmx.<n>` tag (`{}` or malformed JSON stops it); any other error stops it. It does nothing when the release is
  already the latest, refuses when a newer release is the latest (version order), then runs
  `gh release edit <tag> --prerelease=false --latest` and reads it back: a failed edit, an unreadable readback or a
  readback that differs from "not a prerelease, the latest, the checked digest" is reported red with what it read.
  Waiting promotions all wait (`queue: max`; by default GitHub keeps one waiting job and cancels the others). A
  promotion cancelled anyway (a timeout, by hand) leaves the release a prerelease and is reported by the run itself
  (job `report`, below).

### Release authorization

A tag alone does not make a release. The build job (`release-auth.sh`, before anything is built) and the promote job
(inline) require that the tag's commit carries the **commit status `provimux-ui-release`**, state `success`,
description = the tag exactly, created either

- by a `provimux-ui-publish` run: `github-actions[bot]`, its `target_url` that run, which is read back from the API
  (`provimux-ui-publish.yml`, event `workflow_run`, on `main`, this repository), **and whose job `publish` has the
  steps `Push <tag> at <commit> (the only step with the token)` and `Authorize the release <tag> at <commit>`, both
  concluded success, for exactly this tag and commit** (`publish_pushed` in `common.sh`; the step names are evaluated
  at run time from the values the step "Push values" checked, and the jobs API reports them evaluated). A run whose
  push or authorization skipped, as in a run that stopped at the missing token, authorizes nothing. The publish job
  sets the status in that step right after its push (the build job waits for it up to 10 minutes); it is the only
  job of any workflow here with `statuses: write`; or
- by the repository owner's account: `publish.sh` by hand sets it with the owner's credentials after its push, and
  for a hand hotfix (a `-pmx.<n+1>` on the same base) the owner sets it before pushing the tag:

  ```sh
  gh api -X POST repos/ngvoicu/provimux-ui/statuses/<commit> -f state=success -f context=provimux-ui-release \
    -f description='v1.28.3-pmx.2' -f target_url='https://github.com/ngvoicu/provimux-ui'
  git push upstream v1.28.3-pmx.2
  ```

A tag nobody authorized, for example a higher-numbered tag on an older commit reachable from `main`, fails the build
job (no prerelease is made) and could not be promoted. Tags `v*` can be created, moved or deleted only by repository
admins (ruleset "v* tags: admins only"), i.e. the owner and the owner's token. (A tag on a commit older than these
rules runs that commit's older release workflow: see "Accepted risks".)

**A release run that does not complete reports itself.** Its job `report` (`release-report.sh`; issues: write) runs
when any job of a tag's release run failed or was cancelled, and opens or retitles `sync: v<base> — release
incomplete` with every failed or cancelled job and its errors, at once, whoever pushed the tag. The release stays a
prerelease and the run is red; the publish job's `notify` and the check's sweep say the same from their side.

**Why in the release workflow, not separate.** Every `-pmx` tag gets the same checks, whoever pushed it (the
automatic publish, or the owner's `publish.sh` or `-pmx.2`), so no release needs a manual step; the expected file is
the same run's build output, so nothing has to bind a second workflow's run to this release (a separate
`workflow_run` workflow would need its own verifier of run, tag and commit, the hand-off the Provimux reviews
removed); and "the release run succeeded" now means "published and promoted", which is what `publish.sh --wait`, the
check's `published` state and the issue already read. In the publish workflow it would miss hand-pushed tags and run
a browser in the token's environment. The browser runs in `smoke`, which has no write permission; `promote` runs no
repository code.

**Dry run.** `gh workflow run provimux-ui-release.yml -R ngvoicu/provimux-ui --ref main -f release=v1.28.3-pmx.1`
skips the build and publish jobs, runs `smoke` against that published release and `promote`, which runs every check
and says what it would do, or why it would refuse, and changes nothing. (`v1.28.3-pmx.1` predates both rules: it has no
authorization status and is not immutable, so its dry run says it would refuse.)

## The token

`PROVIMUX_TOKEN` is the owner's one fine-grained token for Provimux and provimux-ui (repositories `ngvoicu/provimux`,
`ngvoicu/homebrew-tap`, `ngvoicu/provimux-ui`; Contents: Read and write; Workflows: Read and write; Metadata: Read),
described in Provimux's `SYNC.md`, "The token". In provimux-ui it is a secret of the **environment
`provimux-token`** only, never a repository secret; only the job `publish` of `provimux-ui-publish.yml` declares the
environment, and only its step `Push` reads the secret. The release workflow needs no token of the owner.

The environment exists (created 2026-11-19 with these calls; no reviewers, no wait timer; it may deploy only from the
branch `main`, since no job of a tag's release run uses the token):

```sh
echo '{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}' |
  gh api -X PUT repos/ngvoicu/provimux-ui/environments/provimux-token --input -
gh api -X POST repos/ngvoicu/provimux-ui/environments/provimux-token/deployment-branch-policies -f name=main -f type=branch
```

### Repository settings the sync relies on

| Setting | Value | Set with |
|---|---|---|
| Environment `provimux-token` | deployments from branch `main` only; secret `PROVIMUX_TOKEN` (the owner's step) | above |
| Ruleset 27622080 "main: provimux-ui-guard required" | required check `provimux-ui-guard` on `main`; bypass: repository admins | earlier work |
| Ruleset 27664161 "v* tags: admins only" | tags `refs/tags/v*`: creation, update and deletion restricted; bypass: repository admins (the owner, and the owner's token) | `gh api -X POST repos/ngvoicu/provimux-ui/rulesets` with `{"name": "v* tags: admins only", "target": "tag", "enforcement": "active", "conditions": {"ref_name": {"include": ["refs/tags/v*"], "exclude": []}}, "rules": [{"type": "creation"}, {"type": "update"}, {"type": "deletion"}], "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}]}` |
| Immutable releases | enabled (applies to releases published from now on; `v1.28.3-pmx.1` stays mutable) | `gh api -X PUT repos/ngvoicu/provimux-ui/immutable-releases` |

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
verify ("Manual cases"); a root README upstream adds, renames or moves ("Upstream added or moved a root README"; upstream
editing its READMEs needs nothing); a release that stayed a prerelease ("Check a release"); a `-pmx.2` on the same base; a
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
   changed; by segments around the README commit, `stack_range_diff` on its own temporary repository) and the new
   workflow paths recomputed and equal to `result.json`'s; the README commit in normal form, and its pair `<R> <R'>`
   equal to `result.json`'s `readme`; the guard of the current `main` on the candidate, on git objects only, with the
   exact base. The plan shows `root READMEs    <R> -> <R'>`.
4. **Decisions.** Dropped and changed layer commits are refused unless each is named (`--accept-dropped <sha,...>`,
   `--accept-changed <sha,...>`, the old `main`'s commits, 7+ hex digits). New workflow files are refused outright,
   and so is a README commit out of normal form: no flag accepts it.
5. **Plan, confirmation, re-checks, one atomic push**: `main` with `--force-with-lease=refs/heads/main:<old main>` (a
   literal SHA), `v<base>` at upstream's commit (when the repository lacks it), `v<base>-pmx.1` at the candidate.
   Right after the push it sets the release authorization (owner's credentials; "Release authorization"). Only
   GitHub is pushed; the NAS mirror follows within the hour ("The NAS mirror").

**The NAS mirror follows by itself.** Neither the automatic publish nor `publish.sh` pushes to the NAS mirror
(`origin`, `ssh://git@zeenas:2222/ngvoicu/provimux-ui.git`): its hourly `Follow GitHub` run takes the rebased `main`
and the new tags ("The NAS mirror"). GitHub (`ngvoicu/provimux-ui`) is the truth for `main` and the `v*` tags.
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

At the README commit, in any hand rebase onto a new base, take the README commit's own paths:

```sh
git checkout REBASE_HEAD -- README.md
git rm -q -f --ignore-unmatch README_CN.md
GIT_EDITOR=true git rebase --continue
```

### Upstream added or moved a root README

Added (the guard names it, e.g. `README_JA.md`): read it (`git show v<base>:<path>`). On the old `main`, one layer
commit adds the path to the set in `guard.sh` (`readme_paths`) and `common.sh` (`PMX_README_PATHS`); push it (lease as
above) and start a check of the tag. A release that adds a translation usually edits `README.md` too, so the rebase stops
at the README commit and the check removes the new file with the rest. If it stops nowhere, the check says the README
commit is not in normal form: rebase by hand as in "The rebase stops", amend the README commit so that it also removes
the file, push `main` with the lease and the tag `v<base>-pmx.1` yourself. Moved or renamed (the rebase stops at the
README commit with a path outside the set): the file is then elsewhere in the tree with its links; decide there, then
the same.

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

## Accepted risks

The owner decided (2026-11-19, after review T-77) to accept these and not build further guards for them:

- **A mistaken `v*` tag on an older commit runs that commit's older release workflow.** A tag push runs the workflow
  file of the tagged commit, so a tag on a commit from before the release authorization (for example `bbfdffbc` or
  earlier) runs a release workflow without it, and some of those revisions can promote. Only repository admins can
  create, move or delete `v*` tags (ruleset 27664161, bypass: the admin role only), i.e. the owner by hand or the
  owner's token, whose only use is the publish job's push of the tag the check passed; and the token is not reachable
  from a tag's release run (the environment `provimux-token` allows only `main`, and no release job names it). Such a
  tag is an owner's mistake; its run reports itself or a check's sweep reports an incomplete release.
- **The code under test can fake its own results.** The test jobs run the candidate's and upstream's code; that code
  could make its own `bun run verify` step succeed. The check isolates what it can (one tree per job, no uploads, the
  outcome from the job's own steps through the API, every other input bound by artifact id and digest), but it cannot
  make code honest about testing itself. The same is true of the release's build job, which runs the same verify.
- **The existing release `v1.28.3-pmx.1` is mutable.** It was published before immutable releases were enabled
  (immutability applies only to releases published afterwards) and carries no release authorization status; it stays
  the latest release until a newer one is promoted, and a promotion dry run against it says it would refuse it.

## The NAS mirror

The owner's Forgejo server keeps a copy, `ssh://git@zeenas:2222/ngvoicu/provimux-ui.git`: `main`, the `v<X.Y.Z>-pmx.<n>`
tags and the `v<X.Y.Z>` base tags of `ngvoicu/provimux-ui`, nothing else. GitHub is the truth; nobody pushes to the NAS.
Its workflow `Follow GitHub` (`.forgejo/workflows/follow-github.yml`, a layer file) runs there every hour at minute 27
(UTC), and by hand: it brings the NAS's `main` to GitHub's and adds GitHub's new tags, running only `git`. The NAS is a
mirror: a fast-forward when it can be one; when GitHub's `main` is not a descendant of the NAS's (each sync rebases the
layer onto the new upstream release), the run first keeps the NAS's `main` as `refs/nas-backup/main-<UTC time>` (e.g.
`main-20261122T152700Z`), then sets the NAS's `main` to GitHub's, in one atomic push with `--force-with-lease` on the
NAS's `main`, so no commit is ever lost on the NAS. Only the NAS is written; GitHub is only read. It never merges and
never moves a tag: a tag at another commit on GitHub is reported and left as it is, and the run fails; its log is at
`http://zeenas:3000/ngvoicu/provimux-ui/actions`. The backups: `git ls-remote origin 'refs/nas-backup/*'`. GitHub
never reads `.forgejo/`; Forgejo, while `.forgejo/workflows/` exists, ignores `.github/workflows/`, so none of the
workflows above (nor upstream's `ci.yml` and `release.yml`) runs on the NAS. Keep `.forgejo/workflows/` in the layer:
without it a push of `main` or of a tag to the NAS would start them there. It has followed when
`git ls-remote origin refs/heads/main` and `git ls-remote upstream refs/heads/main` agree.

## Testing the scripts

- `bash .github/provimux/selftest.sh` runs the fixture tests offline (local repositories, a stub `gh` and `curl`):
  the guard and `release-meta.sh` with a base only upstream or withdrawn or moved, the range-diff's dropped, changed
  commits and binary blobs, `check.sh verdict` (state as data, outcomes from the API), `fetch_artifact`,
  `releases_status` with history and the sweep, `release-auth.sh`, `report.sh`, the inline verifier of
  `provimux-ui-publish.yml`,
  `autopublish.sh` decide and notify, `publish.sh --ci`, `release-check.sh` and the inline promote step of
  `provimux-ui-release.yml`, and the root README commit: the rebase stop through `check.sh prepare` (each condition
  broken in turn), `readme_normal` and `stack_range_diff` on candidates built by hand (one failing case per condition,
  empty segments, git range-diff's output byte for byte without a README commit), guard rule 5, and `publish.sh --ci
  --plan` offline end to end. Run it after changing any of these.
- Rehearsing a README change upstream: a bare repository with upstream's tags and one commit on the newest that edits
  `README.md` and `README_CN.md`, tagged as the next patch release; from a clone whose `HEAD` is the `main` to check,
  a state file at status `check` (`check.sh select`'s fields) in `<dir>/state.json`, then
  `PMX_UPSTREAM_URL=<that repository> PMX_CHECK_OUT=<dir> bash .github/provimux/check.sh prepare`. Expected: status
  `test` in `state.json`, the guard ok, every commit `=`, and the candidate's tree equal to the old `main`'s.
- `check.sh`, `report.sh`, `publish.sh`, `autopublish.sh` and `selftest.sh` run with macOS bash 3.2.
- actionlint (1.7.12, the newest) does not know `concurrency.queue` yet, which GitHub accepts (a probe run in the
  sandbox, 2026-11-19): run it as `actionlint -ignore 'unexpected key "queue" for "concurrency" section'
  .github/workflows/provimux-ui-*.yml`.
- `PMX_TAG=v1.28.2 bash .github/provimux/check.sh` (all steps, in one process) from a checkout whose `HEAD` is the
  `main` to check: it runs `bun install` and `bun run verify` of both trees.
- `PMX_REPORT_DRY_RUN=1 RESULT=<result.json> CHECK_JOB=success bash .github/provimux/report.sh` prints the issue a
  result would produce; `PMX_NOTIFY_DRY_RUN=1 TAG=v1.28.4 OUTCOME=failed LOG=<log> bash
  .github/provimux/autopublish.sh notify` what a refusal would write.
- `PMX_LICENSE=LICENSE bash .github/provimux/release-check.sh v1.28.3-pmx.1 /tmp/rc` and
  `CHROME=<chrome-headless-shell> node .github/provimux/smoke.mjs /tmp/rc/management.html v1.28.3-pmx.1` check a
  published release locally (`npx -y @puppeteer/browsers@2.13.2 install chrome-headless-shell@158.0.8127.36` installs
  the shell).

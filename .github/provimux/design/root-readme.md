# The root README commit and the sync (T-100)

Design only. It says how provimux-ui replaces the upstream console's root `README.md` and `README_CN.md` with one
short pointer of its own, and how the sync (`SYNC.md`) still publishes every upstream release with no step by the
owner.

The rule is Provimux's, and its reasons are written there once:
[`.github/provimux/design/root-readme.md` in ngvoicu/provimux](https://github.com/ngvoicu/provimux/blob/main/.github/provimux/design/root-readme.md)
(the four ways to resolve the rebase compared, the full list of selftest cases, the reviewer's list). This file
states the rule in full for provimux-ui and gives what differs here.

## What is different in provimux-ui

Checked on 2026-11-20 (`main` = `49c94b56`, 33 layer commits on `v1.28.3`):

- **An upstream test reads the root READMEs.** `tests/toolchainVersion.test.ts` requires `**Bun <version>**`, the
  version `package.json` pins, in `README.md` and in `README_CN.md`. `bun run verify` is the check's gate and the
  release's build, so with a pointer (or without `README_CN.md`) no release could be built. A fixed pointer cannot
  carry a version upstream bumps. So the layer takes that one case out of the test: one changed line in
  `tests/toolchainVersion.test.ts` (the `test.each(['README.md', 'README_CN.md'])` case no longer runs; the cases
  for `package.json`, the workflows and `AGENTS.md` stay). It is a seam in an upstream file like the others: if
  upstream edits that line or the lines around it, the commit shows as changed and the owner decides.
- **`.github/README.md` links the root READMEs** as "the original's README, in English and Chinese" (line 202).
  Those links move to the upstream repository
  (`https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/main/README.md` and `README_CN.md`).
- Upstream changed a root README in 3 of its last 24 release-to-release steps (`v1.24.2`..`v1.28.3`), and it has
  added and removed root READMEs before (`README_EN.md` and `README_CN.md`, 2025).
- Nothing else reads them: not the build (`vite.config.ts`, `package.json`), not `release-check.sh`, not the
  release workflow.
- The stack has no owner patches: the README commit is one of the layer's commits like any other.
- Outside this rule, and left as they are: the referral links in upstream's source
  (`src/features/providers/sponsor.ts`, `kimi.ts`, `fennoAI.ts`), which the layer hides in the page and does not
  remove from the tree.

## The README commit

| | |
|---|---|
| Trailers | `Provimux-Layer: branding` and `Provimux-Readme: root`, in that one trailer block |
| Subject | `docs(provimux): root README points to the provimux-ui README` |
| Paths, **the set** | exactly `README.md`, `README_CN.md` (root, literal). It changes no other path |
| State it leaves | `README.md` is the pointer (a regular file, mode 100644); `README_CN.md` does not exist |
| How many | exactly one in `<base>..main` |

A commit is the README commit when, and only when, its trailer `Provimux-Readme` has the value `root`. The
translation is deleted, not replaced. The pointer (the whole of `README.md`):

```markdown
# provimux-ui

**provimux-ui**, by [providers.dev](https://providers.dev), is the web console of
[Provimux](https://github.com/ngvoicu/provimux).

Its README is [`.github/README.md`](.github/README.md), the page GitHub shows at
<https://github.com/ngvoicu/provimux-ui>.

provimux-ui is built on the
[CLI Proxy API Management Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) by
router-for-me: each provimux-ui release is a release of that console with a thin Provimux layer on top. The
original console's README, in English and Chinese, is in
[its repository](https://github.com/router-for-me/Cli-Proxy-API-Management-Center#readme). Thanks to its authors
and contributors.

MIT licensed, like the original console. [LICENSE](LICENSE) keeps its copyright notice.
```

To change the pointer later, add a layer commit on top that edits `README.md`.

## The normal form

Let `R` be the README commit of the old `main` and `R'` that of a candidate. **`R'` is `R` re-applied** when, on
git objects:

1. `R` and `R'` each have exactly one parent;
2. their author lines and their messages are byte for byte the same;
3. for every path of the set, `R'` has what `R` has: the same mode and blob, or no entry in both;
4. `R'` differs from its parent in no path outside the set (`git diff-tree -r --no-renames -z --name-only`);
5. for every path of the set, the candidate's tip has what the old `main`'s tip has.

## Rebase

`check.sh prepare` runs the same `git rebase` as today. When it stops, the check resolves the stop itself only if
all of these hold; otherwise the stop fails the check as today:

- the old `main` has exactly one README commit `R`, and the stop is at it (`REBASE_HEAD` = `R`);
- it is the first stop of this rebase;
- `R` changes only paths of the set;
- every unmerged path is a path of the set (NUL-delimited, whole names);
- every path the index holds differently from `HEAD` is a path of the set.

Then, for each path of the set: `git checkout <R> -- <path>` if `R` has it, `git rm -q -f --ignore-unmatch --
<path>` if not; no path unmerged, the work tree as the index; `git rebase --continue` with `GIT_EDITOR=true` and
the rebase's own `-c` options. A second stop fails the check. `rebase.json` records the README commit and the
paths that conflicted. After the rebase, with or without a stop, the check requires the normal form.

## Verifier

The README commit is taken out of `git range-diff` by its position and checked by the normal form:

```text
range-diff  <old base>..R^   <new base>..R'^      then range_diff_lists, as today
normal form R, R'                                 no flag accepts a failure
range-diff  R..<old main>    R'..<candidate>      then range_diff_lists, as today
```

In `common.sh`, used by `check.sh prepare` and `publish.sh` in place of their `git range-diff` call:

```sh
PMX_README_PATHS=(README.md README_CN.md)

# readme_commits RANGE GIT...: the commits of RANGE whose trailer Provimux-Readme is "root",
# full SHAs, oldest first.
# readme_normal OLD NEW OLD_TIP NEW_TIP GIT...: 0 when NEW is OLD re-applied; 1 and the first
# failed condition on stderr.
# stack_range_diff OLD_BASE OLD_MAIN NEW_BASE CANDIDATE OUT GIT...: writes the stack's
# range-diff to OUT (the file range_diff_lists reads) and prints "<R> <R'>", or nothing when
# neither side has a README commit. Status 1, the reason on stderr, when the rule is broken.
```

| Old `main` | Candidate | `stack_range_diff` |
|---|---|---|
| no README commit | none | one `git range-diff` of the whole ranges: today's output, byte for byte |
| one, `R` | one, `R'` | requires the normal form; writes the segments below, the line `README  <R> -> <R'>  <subject>`, the segments above |
| one | none | the whole ranges: `R` is dropped (`<`), refused like any dropped commit |
| none | one | the whole ranges: `R'` is `>`, refused as today |
| more than one on either side | | fails |

- Both ranges are linear, and the commits below, plus one, plus the commits above are the whole range.
- `git range-diff` refuses an empty range, so an empty segment is not given to it: both sides empty, nothing; one
  side empty, each commit of the other side as a `<` or `>` header line in range-diff's format, full SHAs.
- The `README` line is not a header line: `range_diff_lists` never sees the README commit, in any list, and does
  not run `binary_changes` on it. The normal form compares its blobs directly, which is stronger.
- Every other commit keeps today's rule: `!` always needs the owner, and an `=` pair with a different binary file
  is changed.

`publish.sh` dies when `stack_range_diff` fails (no `--accept-*` flag covers it), and requires its own
`<R> <R'>` to equal `result.json`'s new key `readme` (`null`, or `{old, new, reapplied}`).

Not changed: the workflow files, the inline verifier, `check_artifact`, `fetch_artifact`, `plan.env`, the token
step, the release authorization, `autopublish.sh`, the release workflow.

## Guard: rule 5

`guard.sh` has its own copy of the set (the selftest checks that it equals `PMX_README_PATHS`). For
`<base>..HEAD`: more than one README commit is an error, and none is an error once `require_readme=1`; the README
commit carries `Provimux-Layer: branding`, has one parent, changes only paths of the set, leaves `README.md` a
`100644` blob and `README_CN.md` absent; at `HEAD`, the root entries whose name begins with `readme` (ASCII, any
case) are exactly one, the `100644` blob `README.md`. That last line stops a candidate with a root README upstream
added (`README_JA.md`), with the file named.

## Selftest and rehearsal

The selftest cases are Provimux's, on a fixture with `README.md` and `README_CN.md`: the rebase cases through
`check.sh prepare`; `stack_range_diff` and `readme_normal` on candidates built by hand, one failing case for each
of the five conditions; the guard's rule 5; `publish.sh --ci --plan` offline for the README case, for a bundle
whose `R'` also changes `LICENSE`, and for a `result.json` whose `readme` names another commit; `git range-diff`
called from `common.sh` only. One more here: an `=` pair above `R'` with a different image is still changed.

Rehearsal, before the README commit reaches `main`:

1. **The real stack on a scratch upstream tag.** A local bare repository with upstream's `v1.28.3` and one commit
   on it, tagged `v1.28.4`, that edits `README.md` and `README_CN.md` (their `**Bun <version>**` lines among
   others) and nothing else. In a scratch clone, the branch to check is `main` plus the work's commits.
   `PMX_UPSTREAM_URL=<that repository> PMX_CHECK_OUT=<dir> bash check.sh prepare`, from a state file with status
   `check`. Expected: status `test`, the guard ok, every commit `=`, and **the candidate's tree is that branch's
   tree** (`git rev-parse <candidate>^{tree}`), since upstream changed only READMEs. Then, in a container without
   credentials, `bun install --frozen-lockfile && bun run verify` on a checkout of the candidate: it passes, with
   the toolchain test's remaining cases run. Three more tags: one that adds `README_JA.md` (the guard fails, the
   file named), one that renames `README_CN.md` (the rebase fails at the README commit), one that also changes a
   file of the layer in conflict (the rebase fails at that commit).
2. **Upstream's real edit.** A scratch stack on the real `v1.26.7` (a layer commit, the README commit for that
   tree, a layer commit), `check.sh prepare` for the real `v1.27.0`. Expected: status `test`. Keep the plain
   whole-range `git range-diff` of the pair in the log.
3. **The first real sync** after the work is on `main`.

## SYNC.md

The first paragraph (one commit of the layer replaces the root READMEs); "The check", steps 4, 5 and 7; "Publishing
by hand", steps 3 and 4; "What still needs the owner" (a root README upstream adds, renames or moves; not upstream
editing its READMEs); "The rebase stops" (by hand, at the README commit: `git checkout REBASE_HEAD -- README.md`,
`git rm -q -f --ignore-unmatch README_CN.md`, `GIT_EDITOR=true git rebase --continue`); a new manual case,
**Upstream added or moved a root README** (on the old `main`, a layer commit adds the path to the set in
`guard.sh` and `common.sh`; start a check; if the rebase stops nowhere and the check says the README commit is not
in normal form, rebase by hand as in "The rebase stops" and remove the file in the README commit); "Testing the
scripts".

## Order of the work

Layer commits on top of `main`, each with the trailer, in two pushes with the review between them; after each push
to GitHub (`upstream`), mirror `main` to the NAS (`origin`):

1. `.github/README.md`: the original's README linked in its own repository.
2. `tests/toolchainVersion.test.ts`: the root README case out.
3. The rule: `common.sh`, `check.sh`, `publish.sh`, `guard.sh`, `report.sh` (one line for the `readme` key),
   `selftest.sh`, `SYNC.md`. With no README commit on `main`, every script behaves as before.

   Review here: the rule is on `main` and not yet used.
4. The README commit (the two paths only; both trailers).
5. `guard.sh`: `require_readme=1`, with its selftest case and its line in `SYNC.md`.

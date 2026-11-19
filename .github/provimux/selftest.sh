#!/usr/bin/env bash
# Fixture tests for the provimux-ui sync and release scripts (.github/provimux/SYNC.md,
# "Testing the scripts"). Offline: local git repositories stand in for upstream and for
# provimux-ui, and a stub gh (and curl) answers the GitHub API from files. Runs no
# repository code but these scripts. Adapted from Provimux's selftest.sh.
#
#   bash .github/provimux/selftest.sh        exit 0 when every case passes
#
# Cases:
#   guard.sh      base only upstream (no local tag); a reachable base tag withdrawn or
#                 moved upstream (never a fallback); the expected base; on git objects
#                 only (a bare repository, HEAD = the candidate)
#   release-meta  the base tag only upstream
#   range-diff    dropped and changed commits (a "!" always needs the owner: no
#                 context-only acceptance); two different images that range-diff calls
#                 "=" are changed (blob ids compared), the same image is not
#   verdict       check.sh verdict takes the test jobs' step conclusions from the API
#                 (stub): pass; the layer breaks verify; upstream's own failure; install
#                 fails; a missing test job (error); exit files a test job could write
#                 are ignored; the guard's rejection kept; a state value with shell code
#                 is refused and never runs; a state that is not JSON
#   fetch         fetch_artifact: only the producing job's id, name, run and digest, the
#                 download hashing to that digest; expired refused
#   report.sh     a successful release run for the wrong SHA (not published), the right
#                 SHA (published), a failed check job, a prerelease (not published: the
#                 release run's errors shown); a failure result (conclusions, job links)
#   history       releases_status: a failed .1 then a complete .2 is published, the .1
#                 kept as history; the sweep reports a failed tag on another base in its
#                 own issue and closes the released base's issue with the history
#   authorization release-auth.sh: a status from a provimux-ui-publish run or the owner
#                 passes; another workflow's run, another repository, another tag, a
#                 failure state, another account, no status fail
#   verifier      the inline first step of provimux-ui-publish.yml (from the workflow
#                 file between its markers, with a stub gh and git): passes only for
#                 workflow_sha = the check's head_sha = the live main, the event's exact
#                 attempt completed/success on main (schedule or dispatch, this repo), one
#                 verdict job with exactly one artifact annotation; refuses everything else
#   autopublish   decide: only the artifact the verdict job of the verified attempt bound
#                 counts, and it must be the verified id; notify reads the remote first:
#                 no token, refused, main moved, main = candidate without tags, -pmx tag
#                 with an incomplete release (the promotion check's error shown, rerun
#                 command, never "publish again"), a lost push acknowledgement with a
#                 complete release, remote unreadable, no tag
#   publish.sh    --ci: refuses a push token in its environment, and bad mode flags
#   release-check the published release: passes for the right files; fails for a
#                 checksum, API digest or build mismatch, a third asset, a missing
#                 title, version or MIT notice, an external script
#   promote       the inline step of provimux-ui-release.yml's promote job (from the
#                 workflow file between its markers): promotes an authorized, immutable,
#                 checked prerelease; refuses no or a wrong authorization, a mutable
#                 release, a changed digest, a newer latest, an unreadable latest (503),
#                 another build; reports a failed edit and a failed or wrong readback;
#                 a dry run changes nothing; one repository-wide concurrency group
# Needs bash 3.2+, git, jq.
# shellcheck disable=SC2030,SC2031 # subshells set the stub environment on purpose
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/provimux-selftest.XXXXXX")"
trap 'rm -rf "${tmp:?}"' EXIT
pass=0 failed=0
ok() { echo "ok    $*"; pass=$((pass + 1)); }
bad() { echo "FAIL  $*"; failed=$((failed + 1)); }
# expect NAME WANT GOT
expect() { if [[ "$3" == "$2" ]]; then ok "$1"; else bad "$1 (want '$2', got '$3')"; fi; }
# contains NAME FILE TEXT
contains() { if grep -qF -- "$3" "$2"; then ok "$1"; else bad "$1 ('$3' not in the output)"; fi; }
lacks() { if grep -qF -- "$3" "$2"; then bad "$1 ('$3' in the output)"; else ok "$1"; fi; }
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com \
  GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

# --- fixture repositories ------------------------------------------------------------------------
# up: "upstream" with v1.0.0 -> v1.1.0, and an unrelated commit (for a moved tag).
up="$tmp/up"
git init -q -b main "$up"
(
  cd "$up"
  mkdir -p .github/workflows src/utils/quota
  printf '{"name": "x"}\n' >package.json
  printf 'on: push\n' >.github/workflows/ci.yml
  printf 'export const a = 1;\n' >src/utils/quota/a.ts
  git add -A && git commit -q -m one && git tag v1.0.0
  echo b >b.txt && git add -A && git commit -q -m two && git tag -a -m v1.1.0 v1.1.0
  git checkout -q -b other v1.0.0 && echo c >c.txt && git add -A && git commit -q -m other && git checkout -q main
)
v110="$(git -C "$up" rev-parse 'v1.1.0^{commit}')"
other="$(git -C "$up" rev-parse other)"
# pmx: provimux-ui = v1.1.0 + two layer commits; local tags v1.0.0 and v1.1.0.
pmx="$tmp/pmx"
git clone -q "$up" "$pmx"
(
  cd "$pmx"
  git checkout -q --detach v1.1.0
  echo p >brand.txt && git add -A && git commit -q -m 'brand' -m 'Provimux-Layer: branding'
  echo l >layer.txt && git add -A && git commit -q -m 'layer' -m 'Provimux-Layer: branding'
)
guard() { (cd "$pmx" && PMX_UPSTREAM="$up" "$@" bash "$here/guard.sh") >"$tmp/guard.out" 2>&1 && echo pass || echo fail; }

echo "# guard.sh"
expect "base tag here and upstream: passes" pass "$(guard env)"
contains "  ... on base v1.1.0" "$tmp/guard.out" "Base: v1.1.0"
git -C "$pmx" tag -d v1.1.0 >/dev/null
expect "base tag only upstream (no local tag): passes" pass "$(guard env)"
contains "  ... on base v1.1.0" "$tmp/guard.out" "Base: v1.1.0"
expect "expected base v1.1.0 at its commit: passes" pass "$(guard env PMX_EXPECT_BASE=v1.1.0 PMX_EXPECT_BASE_COMMIT="$v110")"
expect "expected base v1.0.0 (older than the base): fails" fail "$(guard env PMX_EXPECT_BASE=v1.0.0)"
# As publish.sh runs it: a bare repository whose HEAD is the candidate, nothing checked out.
bare="$tmp/guard-bare.git"
git init -q --bare "$bare"
(cd "$pmx/.git/objects" && pwd) >"$bare/objects/info/alternates"
git --git-dir="$bare" update-ref --no-deref HEAD "$(git -C "$pmx" rev-parse HEAD)"
if (cd "$tmp" && GIT_DIR="$bare" PMX_UPSTREAM="$up" PMX_EXPECT_BASE=v1.1.0 PMX_EXPECT_BASE_COMMIT="$v110" bash "$here/guard.sh") >"$tmp/guard.out" 2>&1; then
  ok "guard on git objects only (bare repository, HEAD = candidate): passes"
else bad "guard on git objects only (bare repository, HEAD = candidate): passes ($(tail -n 1 "$tmp/guard.out"))"; fi
git -C "$pmx" tag v1.1.0 "$v110"
git -C "$up" tag -d v1.1.0 >/dev/null
expect "reachable base tag withdrawn upstream: fails" fail "$(guard env)"
contains "  ... says withdrawn" "$tmp/guard.out" "withdrawn"
expect "withdrawn, with the expected base: fails" fail "$(guard env PMX_EXPECT_BASE=v1.1.0 PMX_EXPECT_BASE_COMMIT="$v110")"
git -C "$up" tag v1.1.0 "$other"
expect "reachable base tag moved upstream: fails" fail "$(guard env)"
contains "  ... says moved" "$tmp/guard.out" "moved"
git -C "$up" tag -d v1.1.0 >/dev/null && git -C "$up" tag -a -m v1.1.0 v1.1.0 "$v110"

echo "# release-meta.sh"
# A tag push must be on main: the clone's origin has main = the layer.
git init -q --bare "$tmp/pmx-origin.git"
git -C "$pmx" push -q "$tmp/pmx-origin.git" HEAD:refs/heads/main
git -C "$pmx" remote set-url origin "$tmp/pmx-origin.git"
git -C "$pmx" tag -d v1.1.0 >/dev/null
git -C "$pmx" tag v1.1.0-pmx.1 HEAD
meta() {
  : >"$tmp/meta.out"
  (cd "$pmx" && GITHUB_EVENT_NAME=push GITHUB_REF_NAME=v1.1.0-pmx.1 GITHUB_REF=refs/tags/v1.1.0-pmx.1 \
    GITHUB_OUTPUT="$tmp/meta.out" GITHUB_STEP_SUMMARY=/dev/null PMX_UPSTREAM="$up" \
    bash "$here/release-meta.sh") >"$tmp/meta.log" 2>&1 && echo pass || echo fail
}
expect "base tag only upstream: passes" pass "$(meta)"
expect "  ... base=v1.1.0" "base=v1.1.0" "$(grep '^base=' "$tmp/meta.out" || true)"
git -C "$pmx" tag v1.1.0 "$v110"
git -C "$up" tag -d v1.1.0 >/dev/null
expect "base tag withdrawn upstream: fails" fail "$(meta)"
git -C "$up" tag -a -m v1.1.0 v1.1.0 "$v110"

# --- report.sh -------------------------------------------------------------------------------------
echo "# report.sh"
stub="$tmp/stub"
mkdir -p "$stub/bin" "$stub/api"
cat >"$stub/bin/gh" <<'EOF'
#!/usr/bin/env bash
# Stub gh: "gh api PATH [--jq EXPR]" prints $STUB_API/<PATH with / ? & = as _>.json (through
# jq -r EXPR), else a 404. "gh run download ID -n NAME -D DIR" copies $STUB_API/artifact-NAME/.
if [ "$1 $2" = "run download" ]; then
  n='' d=''
  while [ $# -gt 0 ]; do case "$1" in -n) n=$2; shift ;; -D) d=$2; shift ;; esac; shift; done
  [ -d "$STUB_API/artifact-$n" ] || { echo "stub gh: no artifact $n" >&2; exit 1; }
  mkdir -p "$d" && cp -R "$STUB_API/artifact-$n/." "$d/"
  exit 0
fi
# "gh issue ..." is recorded in $STUB_API/../issue.log.
if [ "$1" = issue ]; then echo "$*" >>"$STUB_API/../issue.log"; exit 0; fi
[ "$1" = api ] || { echo "stub gh: $*" >&2; exit 1; }
shift
p='' q='' m=GET
args="$*"
while [ $# -gt 0 ]; do
  case "$1" in --jq) q=$2; shift ;; -X | --method) m=$2; shift ;; -f | -F | -H) shift ;; -*) ;; *) [ -n "$p" ] || p=$1 ;; esac
  shift
done
# Writes (-X POST, ...) are recorded in $STUB_API/../write.log.
if [ "$m" != GET ]; then echo "$m $args" >>"$STUB_API/../write.log"; exit 0; fi
f="$STUB_API/$(printf %s "$p" | tr '/?&=' '____').json"
[ ! -f "$f.err" ] || { cat "$f.err" >&2; exit 1; }
[ -f "$f" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
if [ -n "$q" ]; then jq -r "$q" "$f"; else cat "$f"; fi
EOF
printf '#!/bin/sh\nexit 22\n' >"$stub/bin/curl"
chmod +x "$stub/bin/gh" "$stub/bin/curl"
# Provimux's remote: tag v1.1.0-pmx.1 at the layer commit.
remote="$tmp/remote.git"
git init -q --bare "$remote"
git -C "$pmx" push -q "$remote" "HEAD:refs/heads/main" "refs/tags/v1.1.0-pmx.1"
pmx_sha="$(git -C "$pmx" rev-parse HEAD)"
other_sha=0123456789012345678901234567890123456789
# shellcheck source=common.sh
. "$here/common.sh"
expected_assets 1.1.0-pmx.1 | jq -R -s '{draft: false, prerelease: false, published_at: "2026-11-19T00:00:00Z",
  assets: (split("\n") | map(select(length > 0) | {name: ., state: "uploaded"}))}' \
  >"$stub/api/repos_test_provimux-ui_releases_tags_v1.1.0-pmx.1.json"
runs() { # runs SHA: one successful provimux-ui-release run of the tag push, for commit SHA
  jq -n --arg sha "$1" '{workflow_runs: [{id: 7, path: ".github/workflows/provimux-ui-release.yml", event: "push",
    head_branch: "v1.1.0-pmx.1", head_sha: $sha, repository: {full_name: "test/provimux-ui"},
    status: "completed", conclusion: "success", created_at: "2026-11-19T00:00:00Z"}]}' \
    >"$stub/api/repos_test_provimux-ui_actions_runs_event_push_branch_v1.1.0-pmx.1_per_page_50.json"
}
report() { # report RESULT CHECK_JOB: the dry-run output in $tmp/report.out, the status printed
  PATH="$stub/bin:$PATH" STUB_API="$stub/api" PMX_REPO=test/provimux-ui PMX_REPO_URL="$remote" \
    PMX_REPORT_DRY_RUN=1 RESULT="$1" CHECK_JOB="$2" RUN_URL=https://example.invalid/run \
    bash "$here/report.sh" >"$tmp/report.out" 2>&1 || { echo "exit $?"; return; }
  sed -n '1s/^status=\([^ ]*\) .*/\1/p' "$tmp/report.out"
}
echo '{"status": "published", "upstream": {"tag": "v1.1.0"}, "reasons": []}' >"$tmp/published.json"
runs 0123456789012345678901234567890123456789
expect "release run succeeded for another SHA: not published" incomplete "$(report "$tmp/published.json" success)"
contains "  ... says which commit" "$tmp/report.out" "release run for that commit none"
runs "$pmx_sha"
expect "release run succeeded for the tag's SHA, release complete: published" published "$(report "$tmp/published.json" success)"
expect "the same, but the check job failed: not published" error "$(report "$tmp/published.json" 'prepare success, test failure, verdict success')"
jq '.draft = true' "$stub/api/repos_test_provimux-ui_releases_tags_v1.1.0-pmx.1.json" >"$tmp/d.json"
mv "$tmp/d.json" "$stub/api/repos_test_provimux-ui_releases_tags_v1.1.0-pmx.1.json"
expect "release is a draft: not published" incomplete "$(report "$tmp/published.json" success)"

cat >"$tmp/fail.json" <<'EOF'
{"status": "fail", "step": "done", "upstream": {"tag": "v1.1.0"}, "reasons": ["bun run verify on the candidate: failure"],
 "rebase": {"ok": true},
 "guard": {"ok": false, "output": "::error::Commit abc has no trailer"},
 "tests": {"ok": false, "candidate": {"install": "success", "verify": "failure", "job": "https://github.com/test/provimux-ui/actions/runs/1/job/2"},
           "tag": {"install": "success", "verify": "failure", "job": "https://github.com/test/provimux-ui/actions/runs/1/job/3"}}}
EOF
expect "failure result: reported as failed" fail "$(report "$tmp/fail.json" success)"
contains "  ... the reason shown" "$tmp/report.out" "bun run verify on the candidate: failure"
contains "  ... the step conclusions shown" "$tmp/report.out" "candidate success / failure"
contains "  ... the candidate's job linked" "$tmp/report.out" "test (candidate): https://github.com/test/provimux-ui/actions/runs/1/job/2"
contains "  ... the tag's job linked" "$tmp/report.out" "test (tag): https://github.com/test/provimux-ui/actions/runs/1/job/3"
contains "  ... guard output shown" "$tmp/report.out" "has no trailer"
lacks "  ... no rebase section for a clean rebase" "$tmp/report.out" "The rebase stopped at"
jq '.rebase = {ok: false, stopped_at: "0123456789abcdef0123456789abcdef01234567", subject: "owner patch", conflicts: ["a.go"]}' \
  "$tmp/fail.json" >"$tmp/fail2.json"
expect "rebase failure: reported as failed" fail "$(report "$tmp/fail2.json" success)"
contains "  ... rebase stop shown" "$tmp/report.out" "The rebase stopped at"

# --- provimux-ui-publish.yml's verifier, autopublish.sh and publish.sh --ci ----------------------------
# checkrun ID [JQ]: attempt 1 of a provimux-ui-check run of test/provimux-ui on main that passed (JQ edits it).
checkrun() {
  jq -n --arg sha "$pmx_sha" --argjson id "$1" '{id: $id, run_attempt: 1, path: ".github/workflows/provimux-ui-check.yml", head_branch: "main",
    event: "schedule", status: "completed", conclusion: "success", head_sha: $sha,
    repository: {full_name: "test/provimux-ui"}, head_repository: {full_name: "test/provimux-ui"}}' |
    jq "${2:-.}" >"$stub/api/repos_test_provimux-ui_actions_runs_$1_attempts_1.json"
}
# jobs RUN ATTEMPT NAME...: the jobs of that attempt (the job "verdict" gets id $VID, 900 by default).
jobs() {
  local run=$1 att=$2; shift 2
  printf '%s\n' "$@" | jq -R -s --argjson vid "${VID:-900}" 'split("\n") | map(select(length > 0)) | to_entries
    | {jobs: map({name: .value, id: (if .value == "verdict" then $vid else 800 + .key end)})}' \
    >"$stub/api/repos_test_provimux-ui_actions_runs_${run}_attempts_${att}_jobs_per_page_100.json"
}
# bind MESSAGE...: the annotations titled provimux-ui-check-artifact of the verdict job $VID
# (900 by default), plus an unrelated one.
bind() {
  { printf '%s\n' "$@" | jq -R -s 'split("\n") | map(select(length > 0) | {title: "provimux-ui-check-artifact", message: .})'
    echo '[{"title": "other", "message": "1 provimux-ui-check-v9.9.9"}]'; } | jq -s 'add' \
    >"$stub/api/repos_test_provimux-ui_check-runs_${VID:-900}_annotations_per_page_100.json"
}
# artifact ID RUN NAME STATUS TAG [JQ]: an artifact of RUN with a result.json (JQ edits its metadata).
artifact() {
  local d="$tmp/art-$1"
  rm -rf "$d"; mkdir -p "$d"
  jq -n --arg s "$4" --arg t "$5" '{status: $s, upstream: {tag: $t}}' >"$d/result.json"
  (cd "$d" && zip -q a.zip result.json) && mv "$d/a.zip" "$stub/api/repos_test_provimux-ui_actions_artifacts_$1_zip.json"
  jq -n --argjson id "$1" --argjson run "$2" --arg n "$3" '{id: $id, name: $n, expired: false, digest: "sha256:aa", workflow_run: {id: $run}}' |
    jq "${6:-.}" >"$stub/api/repos_test_provimux-ui_actions_artifacts_$1.json"
}

echo "# provimux-ui-publish.yml: the inline verifier"
wf="$here/../workflows/provimux-ui-publish.yml"
sed -n '/^ *# >>> verify$/,/^ *# <<< verify$/p' "$wf" | sed 's/^          //' >"$tmp/verify.sh"
if [[ "$(grep -c '' "$tmp/verify.sh")" -gt 20 ]]; then ok "verifier lines found in the workflow"; else bad "verifier lines found in the workflow"; fi
# A stub git for ls-remote only: prints $STUB_MAIN as refs/heads/main (fails when it is "fail").
mkdir -p "$stub/gitbin"
cat >"$stub/gitbin/git" <<'EOF'
#!/usr/bin/env bash
[ "$1" = ls-remote ] || { echo "stub git: $*" >&2; exit 1; }
[ "$STUB_MAIN" != fail ] || { echo "fatal: unable to access" >&2; exit 128; }
printf '%s\trefs/heads/main\n' "$STUB_MAIN"
EOF
chmod +x "$stub/gitbin/git"
# verify ENV...: "<run> <attempt> <artifact> <sha>" (or "exit N"); the reason in $tmp/verify.why
verify() {
  : >"$tmp/verify.out"
  env PATH="$stub/gitbin:$stub/bin:$PATH" STUB_API="$stub/api" PMX_REPO=test/provimux-ui GITHUB_OUTPUT="$tmp/verify.out" \
    STUB_MAIN="$pmx_sha" EVENT_NAME=workflow_run WORKFLOW_REF="test/provimux-ui/.github/workflows/provimux-ui-publish.yml@refs/heads/main" \
    WORKFLOW_SHA="$pmx_sha" EVENT_RUN=42 EVENT_ATTEMPT=1 EVENT_HEAD_SHA="$pmx_sha" "$@" \
    bash "$tmp/verify.sh" >"$tmp/verify.log" 2>&1 || { local rc=$?; sed -n 's/^why=//p' "$tmp/verify.out" >"$tmp/verify.why"; echo "exit $rc"; return; }
  echo "$(sed -n 's/^run=//p' "$tmp/verify.out") $(sed -n 's/^attempt=//p' "$tmp/verify.out") $(sed -n 's/^artifact=//p' "$tmp/verify.out") $(sed -n 's/^sha=//p' "$tmp/verify.out")"
}
checkrun 42; jobs 42 1 prepare 'test (candidate)' 'test (tag)' verdict report
bind '501 provimux-ui-check-v1.2.0 sha256:aa'
expect "check attempt passed on the live main = workflow_sha: run 42 attempt 1 artifact 501" "42 1 501 $pmx_sha" "$(verify env)"
expect "an old workflow revision (or a rerun of an old run): refused" "exit 1" "$(verify WORKFLOW_SHA="$other_sha")"
contains "  ... says why" "$tmp/verify.why" "nothing is published from another main"
expect "main moved since the check (event head_sha is older): refused" "exit 1" "$(verify EVENT_HEAD_SHA="$other_sha")"
expect "main moved after both (live main differs): refused" "exit 1" "$(verify STUB_MAIN="$other_sha")"
expect "main unreadable: refused, with a reason" "exit 1" "$(verify STUB_MAIN=fail)"
contains "  ... says so" "$tmp/verify.why" "cannot read refs/heads/main"
expect "workflow from another branch: refused" "exit 1" "$(verify WORKFLOW_REF=test/provimux-ui/.github/workflows/provimux-ui-publish.yml@refs/heads/x)"
expect "started by workflow_dispatch: refused" "exit 1" "$(verify EVENT_NAME=workflow_dispatch)"
expect "no attempt in the event: refused" "exit 1" "$(verify EVENT_ATTEMPT=)"
expect "attempt 2 named by the event, unreadable: refused" "exit 1" "$(verify EVENT_ATTEMPT=2)"
checkrun 42 '.conclusion = "failure"'
expect "that attempt failed: refused" "exit 1" "$(verify env)"
checkrun 42 '.status = "in_progress" | .conclusion = null'
expect "that attempt still running: refused" "exit 1" "$(verify env)"
checkrun 42 '.run_attempt = 2'
expect "the API answers another attempt: refused" "exit 1" "$(verify env)"
checkrun 42 '.event = "push"'
expect "check run started by a push: refused" "exit 1" "$(verify env)"
checkrun 42 '.head_branch = "feature"'
expect "check run not on main: refused" "exit 1" "$(verify env)"
checkrun 42 '.path = ".github/workflows/other.yml"'
expect "another workflow's run: refused" "exit 1" "$(verify env)"
checkrun 42 '.head_repository.full_name = "fork/provimux"'
expect "a fork's run: refused" "exit 1" "$(verify env)"
checkrun 42
jobs 42 1 prepare report
expect "no verdict job in that attempt: refused" "exit 1" "$(verify env)"
jobs 42 1 prepare verdict verdict
expect "two verdict jobs: refused" "exit 1" "$(verify env)"
jobs 42 1 prepare 'test (candidate)' 'test (tag)' verdict report
bind
expect "no artifact annotation: refused" "exit 1" "$(verify env)"
bind '501 provimux-ui-check-v1.2.0 sha256:aa' '502 provimux-ui-check-v1.3.0 sha256:aa'
expect "two artifact annotations: refused" "exit 1" "$(verify env)"
bind '501 provimux-ui-check-v1.2.0 sha256:aa'

echo "# autopublish.sh decide (check_artifact, the verified run, attempt and artifact)"
decide() { # decide ENV...: "<action> <tag>" (or "exit N")
  : >"$tmp/decide.out"
  env PATH="$stub/bin:$PATH" STUB_API="$stub/api" PMX_REPO=test/provimux-ui PMX_REPO_URL="$remote" \
    GITHUB_OUTPUT="$tmp/decide.out" PMX_CHECK_RUN=42 PMX_CHECK_ATTEMPT=1 PMX_ARTIFACT=501 PMX_EXPECT_MAIN="$pmx_sha" "$@" \
    bash "$here/autopublish.sh" decide >"$tmp/decide.log" 2>&1 || { echo "exit $?"; return; }
  echo "$(sed -n 's/^action=//p' "$tmp/decide.out") $(sed -n 's/^tag=//p' "$tmp/decide.out")"
}
artifact 501 42 provimux-ui-check-v1.2.0 pass v1.2.0
expect "bound verdict artifact 501 says pass: publish v1.2.0" "publish v1.2.0" "$(decide env)"
expect "the verified id is another artifact than the one bound now: error" "exit 1" "$(decide PMX_ARTIFACT=502)"
contains "  ... says not the verified one" "$tmp/decide.log" "not the verified 502"
# A test job (it runs the candidate's code) uploads a passing artifact for another tag;
# the verdict bound its own, which failed.
artifact 501 42 provimux-ui-check-v1.2.0 fail v1.2.0; artifact 502 42 provimux-ui-check-v1.3.0 pass v1.3.0
expect "planted passing artifact, bound verdict says fail: skip (the plant is ignored)" "skip v1.2.0" "$(decide env)"
expect "  ... and naming the plant's id cannot pick it: error" "exit 1" "$(decide PMX_ARTIFACT=502)"
artifact 501 42 provimux-ui-check-v1.2.0 pass v1.2.0
expect "planted artifact, bound verdict says pass: publish the bound one" "publish v1.2.0" "$(decide env)"
bind '502 provimux-ui-check-v1.3.0 sha256:aa'
artifact 502 43 provimux-ui-check-v1.3.0 pass v1.3.0
expect "annotation names an artifact of another run: error" "exit 1" "$(decide PMX_ARTIFACT=502)"
artifact 502 42 provimux-ui-check-v1.3.0 pass v1.3.0
bind '501 provimux-ui-check-v1.2.0 sha256:aa' '502 provimux-ui-check-v1.3.0 sha256:aa'
expect "two binding annotations: error" "exit 1" "$(decide env)"
bind
expect "no binding annotation: error" "exit 1" "$(decide env)"
bind '501 provimux-ui-check-v1.3.0 sha256:aa'
expect "annotation's name is not the artifact's: error" "exit 1" "$(decide env)"
bind '501 provimux-ui-check-v1.2.0 sha256:bb'
expect "digest differs: error" "exit 1" "$(decide env)"
bind '501 provimux-ui-check-v1.2.0 sha256:aa'
artifact 501 42 provimux-ui-check-v1.2.0 pass v1.2.0 '.expired = true'
expect "bound artifact expired: error" "exit 1" "$(decide env)"
artifact 501 42 provimux-ui-check-v1.2.0 pass v1.3.0
expect "result.json for another tag than its artifact: error" "exit 1" "$(decide env)"
artifact 501 42 provimux-ui-check-v1.2.0 pass v1.2.0
# A rerun (attempt 2) has its own verdict job (id 901) binding another artifact; the
# verified attempt 1 is used, never "the latest".
VID=901 jobs 42 2 prepare verdict report; VID=901 bind '502 provimux-ui-check-v1.3.0 sha256:aa'
expect "attempt 2 binds 502, the verified attempt 1: publish 501's v1.2.0" "publish v1.2.0" "$(decide env)"
expect "  ... the verified attempt 2 with artifact 501: error" "exit 1" "$(decide PMX_CHECK_ATTEMPT=2)"
expect "  ... the verified attempt 2 with its artifact 502: publish v1.3.0" "publish v1.3.0" "$(decide PMX_CHECK_ATTEMPT=2 PMX_ARTIFACT=502)"
jobs 42 2 prepare report
expect "an attempt without a verdict job: error (attempt 1's is not used)" "exit 1" "$(decide PMX_CHECK_ATTEMPT=2)"
artifact 503 42 provimux-ui-check-none published ''; bind '503 provimux-ui-check-none'
expect "the check selected no release (no digest given): skip" "skip " "$(decide PMX_ARTIFACT=503)"
artifact 504 42 provimux-ui-check-v1.1.0 pass v1.1.0; bind '504 provimux-ui-check-v1.1.0 sha256:aa'
expect "v1.1.0-pmx.1 exists already (second run, re-run): skip" "skip v1.1.0" "$(decide PMX_ARTIFACT=504)"
contains "  ... says already exists" "$tmp/decide.log" "already exists"
expect "no check run id: error" "exit 1" "$(decide PMX_CHECK_RUN=)"
expect "no attempt: error" "exit 1" "$(decide PMX_CHECK_ATTEMPT=)"
expect "no artifact id: error" "exit 1" "$(decide PMX_ARTIFACT=)"

echo "# autopublish.sh notify (reads the remote first)"
# notify TAG OUTCOME LOG-TEXT [ENV...]: the dry-run issue text in $tmp/notify.out, the title printed.
notify() {
  local t=$1 o=$2 l=$3; shift 3
  printf '%s' "$l" >"$tmp/publish.log"
  env PATH="$stub/bin:$PATH" STUB_API="$stub/api" PMX_REPO=test/provimux-ui PMX_REPO_URL="$remote" \
    PMX_NOTIFY_DRY_RUN=1 TAG="$t" OUTCOME="$o" LOG="$tmp/publish.log" EXPECT_MAIN="$pmx_sha" RUN_URL=https://example.invalid/run \
    "$@" bash "$here/autopublish.sh" notify >"$tmp/notify.out" 2>&1 || { echo "exit $?"; return; }
  sed -n 's/^title=//p' "$tmp/notify.out"
}
expect "no token, nothing on the remote: waits for the token" "sync: v1.2.0 — ready, publishing waits for PROVIMUX_TOKEN" "$(notify v1.2.0 no-token '' HAS_TOKEN=false)"
contains "  ... says publishing by hand works meanwhile" "$tmp/notify.out" "Publishing by hand also works"
contains "  ... names the environment" "$tmp/notify.out" "environment \`provimux-token\`"
contains "  ... gives the check of this tag" "$tmp/notify.out" "gh workflow run provimux-ui-check.yml -R test/provimux-ui -f tag=v1.2.0"
contains "  ... shows main unchanged" "$tmp/notify.out" "(the checked main: unchanged)"
log1='==> remote origin
publish: not accepted (--accept-dropped): 0123456789abcdef0123456789abcdef01234567 owner patch
publish: refused: accept each item above by name (SYNC.md), or fix the stack
'
expect "dropped patch, nothing on the remote: refused, owner needed" "sync: v1.2.0 — publish refused, owner needed" "$(notify v1.2.0 failed "$log1" HAS_TOKEN=true)"
contains "  ... the reason is shown" "$tmp/notify.out" "not accepted (--accept-dropped): 0123456789ab"
lacks "  ... progress lines are not" "$tmp/notify.out" "remote origin"
contains "  ... says nothing was pushed" "$tmp/notify.out" "nothing was pushed"
contains "  ... names the manual path" "$tmp/notify.out" "publish.sh v1.2.0"
lacks "  ... no token note when it is set" "$tmp/notify.out" "is not set"
# shellcheck disable=SC2016 # a literal Markdown table row
contains "  ... and that no -pmx tag exists" "$tmp/notify.out" '| `v1.2.0-pmx.*` | absent |'
m1="$(sed -n 2p "$tmp/notify.out")"
notify v1.2.0 failed "$log1" HAS_TOKEN=false >/dev/null
contains "refused while the token is missing: says the token is not set" "$tmp/notify.out" "is not set"
notify v1.2.0 failed "publish: the range-diff is empty or has commits not in the old main: see /tmp/x/provimux-publish.AbC123/range-diff.txt" >/dev/null
m2="$(sed -n 2p "$tmp/notify.out")"
notify v1.2.0 failed "publish: the range-diff is empty or has commits not in the old main: see /var/y/provimux-publish.Zz9/range-diff.txt" >/dev/null
expect "same reason, another temp dir: same marker (one comment)" "$m2" "$(sed -n 2p "$tmp/notify.out")"
if [[ "$m1" != "$m2" ]]; then ok "  ... another reason: another marker"; else bad "  ... another reason: another marker ($m1)"; fi
expect "publish.sh broke without a reason, before the verifier knew main: refused" "sync: v1.2.0 — publish refused, owner needed" \
  "$(notify v1.2.0 failed 'boom' EXPECT_MAIN=)"
contains "  ... says so" "$tmp/notify.out" "ended without a reason"
contains "  ... and that it stopped before its push" "$tmp/notify.out" "stopped before its push step"
expect "main is another commit than the checked one: main moved, nothing published" "sync: v1.2.0 — main moved, nothing published" \
  "$(notify v1.2.0 failed 'publish: main is now x' EXPECT_MAIN="$other_sha")"
lacks "  ... no publish command" "$tmp/notify.out" "publish.sh v1.2.0"
lacks "  ... promises no next check" "$tmp/notify.out" "next check"
contains "  ... gives the check of this tag" "$tmp/notify.out" "gh workflow run provimux-ui-check.yml -R test/provimux-ui -f tag=v1.2.0"
printf 'CANDIDATE=%s\nUPSTREAM_COMMIT=%s\n' "$pmx_sha" "$v110" >"$tmp/plan.env"
expect "main is the candidate, no -pmx tag: main pushed without its tags" "sync: v1.2.0 — main pushed without its tags, owner needed" \
  "$(notify v1.2.0 failed 'publish: git push reported a failure' EXPECT_MAIN="$other_sha" PLAN="$tmp/plan.env")"
contains "  ... gives the tag push" "$tmp/notify.out" "$pmx_sha:refs/tags/v1.2.0-pmx.1"
# v1.1.0-pmx.1 exists on the remote; its release is a draft (above), its release run (id 7) succeeded.
expect "-pmx tag exists, release a draft: pushed, release not complete" "sync: v1.1.0 — pushed, release not complete, owner needed" \
  "$(notify v1.1.0 failed 'publish: the provimux-ui-release run for v1.1.0-pmx.1 ended failure; the issue stays open')"
contains "  ... says how to rerun the release run" "$tmp/notify.out" "gh run rerun 7 --failed -R test/provimux-ui"
lacks "  ... never says to publish again" "$tmp/notify.out" "publish.sh v1.1.0"
lacks "  ... nor that nothing was pushed" "$tmp/notify.out" "nothing was pushed"
jq '.draft = false' "$stub/api/repos_test_provimux-ui_releases_tags_v1.1.0-pmx.1.json" >"$tmp/d.json"
mv "$tmp/d.json" "$stub/api/repos_test_provimux-ui_releases_tags_v1.1.0-pmx.1.json"
expect "push reported a failure but the remote has the complete release (lost acknowledgement): released" "sync: v1.1.0 — released" \
  "$(notify v1.1.0 failed 'publish: git push reported a failure' HAS_TOKEN=false)"
lacks "  ... not 'nothing was pushed'" "$tmp/notify.out" "nothing was pushed"
lacks "  ... promises no next check" "$tmp/notify.out" "next check"
lacks "  ... no token note for a complete release" "$tmp/notify.out" "is not set"
# The same for real (stub gh records issue commands): no open issue -> none is opened;
# an open "sync: v1.1.0 ..." issue -> it is closed.
notify_real() {
  : >"$stub/issue.log"
  env PATH="$stub/bin:$PATH" STUB_API="$stub/api" PMX_REPO=test/provimux-ui PMX_REPO_URL="$remote" \
    TAG=v1.1.0 OUTCOME=failed LOG="$tmp/publish.log" EXPECT_MAIN="$pmx_sha" RUN_URL=https://example.invalid/run \
    bash "$here/autopublish.sh" notify >"$tmp/notify.out" 2>&1 || { echo "exit $?"; return; }
  tr '\n' ' ' <"$stub/issue.log" | cut -c1-14
}
echo '[]' >"$stub/api/repos_test_provimux-ui_issues_state_open_per_page_100.json"
expect "released, no open issue: opens none" "" "$(notify_real)"
echo '[{"number": 5, "title": "sync: v1.1.0 — ready, publishing waits for PROVIMUX_TOKEN"}]' >"$stub/api/repos_test_provimux-ui_issues_state_open_per_page_100.json"
expect "released, the open issue: closes it" "issue close 5 " "$(notify_real)"
expect "remote unreadable: state unknown" "sync: v1.2.0 — publish failed, state unknown, owner needed" \
  "$(notify v1.2.0 failed 'publish: x' PMX_REPO_URL="$tmp/no-such-remote.git")"
contains "  ... says to look before acting" "$tmp/notify.out" "Do not publish or rerun anything before checking"
expect "no valid tag (the verifier failed early): provimux-ui-publish: failed" "provimux-ui-publish: failed" \
  "$(notify 'x; y' failed '' WHY='cannot read run 42 attempt 1')"
contains "  ... the verifier's reason is shown" "$tmp/notify.out" "cannot read run 42 attempt 1"

echo "# publish.sh --ci"
ci() { (cd "$pmx" && env -u PMX_PUSH_TOKEN -u PROVIMUX_TOKEN "$@") >"$tmp/ci.out" 2>&1 && echo "exit 0" || echo "exit $?"; }
P="$here/publish.sh"
full=(--ci --plan "$tmp/p1" --run 42 --attempt 1 --artifact 501 --expect-main "$pmx_sha")
expect "--ci with PROVIMUX_TOKEN in the environment: refused" "exit 1" "$(ci PROVIMUX_TOKEN=x bash "$P" v1.2.0 "${full[@]}")"
contains "  ... says publish.sh must never see it" "$tmp/ci.out" "must never see it"
expect "--ci with PMX_PUSH_TOKEN in the environment: refused" "exit 1" "$(ci PMX_PUSH_TOKEN=x bash "$P" v1.2.0 --ci --wait "$tmp/p1")"
expect "--ci without --plan or --wait: refused" "exit 1" "$(ci bash "$P" v1.2.0 --ci)"
expect "--ci with both --plan and --wait: refused" "exit 1" "$(ci bash "$P" v1.2.0 --ci --plan "$tmp/p1" --wait "$tmp/p1")"
expect "--ci --plan without --run/--expect-main: refused" "exit 1" "$(ci bash "$P" v1.2.0 --ci --plan "$tmp/p1")"
expect "--ci --plan without --attempt: refused" "exit 1" "$(ci bash "$P" v1.2.0 --ci --plan "$tmp/p1" --run 42 --artifact 501 --expect-main "$pmx_sha")"
expect "--ci --plan without --artifact: refused" "exit 1" "$(ci bash "$P" v1.2.0 --ci --plan "$tmp/p1" --run 42 --attempt 1 --expect-main "$pmx_sha")"
expect "--attempt without --run: refused" "exit 1" "$(ci bash "$P" v1.2.0 --attempt 1)"
expect "--artifact not digits: refused" "exit 1" "$(ci bash "$P" v1.2.0 --run 42 --artifact 5x)"
expect "--plan without --ci: refused" "exit 1" "$(ci bash "$P" v1.2.0 --plan "$tmp/p1")"
expect "--expect-main not a SHA: refused" "exit 1" "$(ci bash "$P" v1.2.0 --expect-main abc)"
mkdir -p "$tmp/p2" && printf 'TAG=v1.3.0\n' >"$tmp/p2/plan.env"
expect "--ci --wait on a plan for another tag: refused" "exit 1" "$(ci bash "$P" v1.2.0 --ci --wait "$tmp/p2")"

echo "# range-diff: every change goes to the owner; binary files by blob id (range_diff_lists)"
rd="$tmp/rd"
git init -q -b main "$rd"
(
  cd "$rd"
  printf '%s\n' a b c d e f g h i j >f1.txt; cp f1.txt f2.txt; cp f1.txt f3.txt
  git add -A && git commit -q -m v1 && git tag v1
  sed -i.bak 's/^e$/E/' f1.txt && rm f1.txt.bak && git commit -qam 'layer: f1 line e'
  sed -i.bak 's/^b$/B/; s/^e$/E/; s/^g$/G/; s/^i$/I/' f2.txt && rm f2.txt.bak && git commit -qam 'layer: f2 lines b, e, g and i'
  sed -i.bak 's/^d$/D/' f3.txt && rm f3.txt.bak && git commit -qam 'layer: f3 line d'
  git tag old-main
  git checkout -q --detach v1
  # Upstream's next release: next to the layer's f1 change, part of its f2 change, all of its f3 change.
  sed -i.bak 's/^c$/C/' f1.txt && sed -i.bak 's/^b$/B/' f2.txt && sed -i.bak 's/^d$/D/' f3.txt && rm ./*.bak
  git commit -qam v2 && git tag v2
  git checkout -q --detach old-main
  git rebase -q v2 2>/dev/null
  git tag candidate
  git range-diff --no-color --no-notes v1..old-main v2..candidate >"$tmp/rd.txt"
)
mkdir -p "$tmp/rdo"
# shellcheck source=common.sh
(cd "$rd" && . "$here/common.sh" && range_diff_lists "$tmp/rd.txt" "$tmp/rdo" git)
expect "the commit upstream made entirely: dropped" "layer: f3 line d" "$(cut -f2 "$tmp/rdo/dropped")"
expect "a commit upstream made in part, and one whose surrounding code moved: both changed (the owner decides)" \
  "layer: f1 line e|layer: f2 lines b, e, g and i" "$(cut -f2 "$tmp/rdo/changed" | paste -sd '|' -)"
expect "  ... no context-only list any more" "" "$(find "$tmp/rdo" \( -name '*context*' -o -name '*pairs*' \) -print)"
# Two images under the same path and subject: the patches read alike ("Binary files differ").
bin="$tmp/bin"
git init -q -b main "$bin"
(
  cd "$bin"
  echo base >README && git add -A && git commit -q -m base && git tag base
  printf '\x89PNG\0one' >logo.png && echo same >note.txt && git add -A && git commit -q -m 'layer: login image' && git tag one
  git checkout -q --detach base
  printf '\x89PNG\0two' >logo.png && echo same >note.txt && git add -A && git commit -q -m 'layer: login image' && git tag two
  git checkout -q --detach base
  printf '\x89PNG\0one' >logo.png && echo same >note.txt && git add -A && git commit -q -m 'layer: login image' && git tag one-again
  git range-diff --no-color --no-notes base..one base..two >"$tmp/bin1.txt"
  git range-diff --no-color --no-notes base..one base..one-again >"$tmp/bin2.txt"
)
expect "  ... git range-diff calls two different images equal" "=" "$(awk '{print $3}' "$tmp/bin1.txt" | head -n 1)"
mkdir -p "$tmp/bino1" "$tmp/bino2"
# shellcheck source=common.sh
(cd "$bin" && . "$here/common.sh" && range_diff_lists "$tmp/bin1.txt" "$tmp/bino1" git && range_diff_lists "$tmp/bin2.txt" "$tmp/bino2" git)
expect "an '=' pair whose image differs (another blob id): changed" "layer: login image (a binary file differs)" "$(cut -f2 "$tmp/bino1/changed")"
expect "an '=' pair with the same image (same blob id): unchanged" "" "$(cat "$tmp/bino2/changed")"

echo "# check.sh: state is data; the verdict reads the test jobs' steps from the API"
# vstate OUT [JQ]: a prepare state at status "test" (JQ edits it).
vstate() {
  rm -rf "$1"; mkdir -p "$1/logs"
  jq -n --arg u "$v110" --arg m "$pmx_sha" '{status: "test", step: "test", tag: "v1.2.0", base: "1.2.0", upstream_commit: $u,
    old_main: $m, old_base_tag: "v1.1.0", old_base_commit: $u, candidate: $m, commits: "2", guard_ok: "true"}' | jq "${2:-.}" >"$1/state.json"
  : >"$1/reasons.txt"
}
# tjobs CI CV TI TV: the jobs of run 900 attempt 1 (- leaves the test (tag) job out).
tjobs() {
  jq -n --arg ci "$1" --arg cv "$2" --arg ti "$3" --arg tv "$4" '
    def job($n; $i; $v): {name: $n, status: "completed", html_url: "https://github.com/test/provimux-ui/actions/runs/900/job/1",
      steps: [{name: "Set up job", conclusion: "success"}, {name: "bun install --frozen-lockfile", conclusion: $i},
              {name: "bun run verify", conclusion: $v}]};
    {jobs: ([{name: "prepare", status: "completed", steps: []}, job("test (candidate)"; $ci; $cv)]
            + (if $ti == "-" then [] else [job("test (tag)"; $ti; $tv)] end))}' \
    >"$stub/api/repos_test_provimux-ui_actions_runs_900_attempts_1_jobs_per_page_100.json"
}
# verdict [ENV...]: "<status> | <reasons joined by ; >"
verdict() {
  env PATH="$stub/bin:$PATH" STUB_API="$stub/api" PMX_REPO=test/provimux-ui PMX_CHECK_OUT="$tmp/v" \
    PMX_RUN_ID=900 PMX_RUN_ATTEMPT=1 "$@" bash "$here/check.sh" verdict >"$tmp/verdict.log" 2>&1 || { echo "exit $?"; return; }
  jq -r '"\(.status) | \(.reasons | join("; "))"' "$tmp/v/result.json"
}
vstate "$tmp/v"; tjobs success success success success
expect "both trees install and verify: pass" "pass | " "$(verdict)"
expect "  ... the conclusions recorded" "success success https://github.com/test/provimux-ui/actions/runs/900/job/1" \
  "$(jq -r '.tests.candidate | "\(.install) \(.verify) \(.job)"' "$tmp/v/result.json")"
vstate "$tmp/v"; tjobs success failure success success
expect "verify fails on the candidate, passes on the tag: the layer breaks it" \
  "fail | bun run verify on the candidate: failure; it passes on the pristine v1.2.0: the Provimux layer breaks it" "$(verdict)"
vstate "$tmp/v"; tjobs success failure success failure
r="$(verdict)"
expect "fails on both: still a failure" fail "${r%% |*}"
contains "  ... says it is upstream's own" <(echo "$r") "upstream's own failure"
vstate "$tmp/v"; tjobs failure skipped success success
expect "install fails on the candidate (verify skipped): fail" "fail | bun install --frozen-lockfile on the candidate: failure" "$(verdict | cut -d';' -f1)"
vstate "$tmp/v"; tjobs success success - -
r="$(verdict)"
expect "no test (tag) job: error" error "${r%% |*}"
contains "  ... says which job" <(echo "$r") 'not exactly one completed job "test (tag)"'
vstate "$tmp/v"; tjobs success success success success
expect "no run id: error (never files)" error "$(verdict PMX_RUN_ID= | cut -d' ' -f1)"
# A test job writes exit files claiming success; the API says failure: the API wins.
vstate "$tmp/v"; tjobs success failure success success
mkdir -p "$tmp/v/test/candidate" && echo 0 >"$tmp/v/test/candidate/verify.exit"
expect "exit files in the out dir are ignored: the step conclusion decides" fail "$(verdict | cut -d' ' -f1)"
vstate "$tmp/v" '.guard_ok = "false"'; echo 'the guard rejects the candidate' >"$tmp/v/reasons.txt"; tjobs success success success success
expect "verify passes but the guard rejected the candidate: fail" "fail | the guard rejects the candidate" "$(verdict)"
rm -f "$tmp/pwned"
vstate "$tmp/v" ".tag = \"v1.2.0\$(touch $tmp/pwned)\""; tjobs success success success success
expect "a state value with shell code: error, not run" "error | the prepare job's state is not valid" "$(verdict)"
if [[ -e "$tmp/pwned" ]]; then bad "  ... the code did not run"; else ok "  ... the code did not run"; fi
vstate "$tmp/v"; echo 'status=test' >"$tmp/v/state.json"
expect "a state that is not JSON: error" "error" "$(verdict | cut -d' ' -f1)"

echo "# fetch_artifact (by the producing job's id and digest, never by name)"
fa="$tmp/fa"; mkdir -p "$fa/src"; echo '{"status": "pass"}' >"$fa/src/result.json"
(cd "$fa/src" && zip -q ../a.zip result.json)
zsha="$(shasum -a 256 "$fa/a.zip" | cut -d' ' -f1)"
cp "$fa/a.zip" "$stub/api/repos_test_provimux-ui_actions_artifacts_600_zip.json"
fmeta() { jq -n --arg d "sha256:$zsha" '{id: 600, name: "pmx-prepare", expired: false, digest: $d, workflow_run: {id: 900}}' | jq "${1:-.}" \
  >"$stub/api/repos_test_provimux-ui_actions_artifacts_600.json"; }
fetch() { # fetch ID DIGEST [RUN] [NAME]: ok | fail
  rm -rf "$fa/out"
  # shellcheck source=common.sh
  (export PATH="$stub/bin:$PATH" STUB_API="$stub/api" PMX_REPO=test/provimux-ui; . "$here/common.sh"
    fetch_artifact "$1" "${4:-pmx-prepare}" "$2" "${3:-900}" "$fa/out") >/dev/null 2>&1 && echo ok || echo fail
}
fmeta
expect "the producing job's id and digest: fetched" ok "$(fetch 600 "$zsha")"
expect "  ... unpacked" '{"status": "pass"}' "$(cat "$fa/out/result.json" 2>/dev/null)"
expect "another run's artifact: refused" fail "$(fetch 600 "$zsha" 901)"
expect "another name under that id: refused" fail "$(fetch 600 "$zsha" 900 provimux-ui-check-v1.2.0)"
expect "a digest the producer did not output: refused" fail "$(fetch 600 "$(printf '%064d' 0)")"
fmeta '.expired = true'
expect "expired: refused" fail "$(fetch 600 "$zsha")"
fmeta; printf 'tampered' >>"$stub/api/repos_test_provimux-ui_actions_artifacts_600_zip.json"
expect "the download does not hash to the digest: refused" fail "$(fetch 600 "$zsha")"

echo "# report.sh and notify: a release that stayed a prerelease (promotion refused)"
jq '.draft = false | .prerelease = true' "$stub/api/repos_test_provimux-ui_releases_tags_v1.1.0-pmx.1.json" >"$tmp/d.json"
mv "$tmp/d.json" "$stub/api/repos_test_provimux-ui_releases_tags_v1.1.0-pmx.1.json"
jq --arg sha "$pmx_sha" '.workflow_runs[0] |= (.head_sha = $sha | .conclusion = "failure")' \
  "$stub/api/repos_test_provimux-ui_actions_runs_event_push_branch_v1.1.0-pmx.1_per_page_50.json" >"$tmp/r.json"
mv "$tmp/r.json" "$stub/api/repos_test_provimux-ui_actions_runs_event_push_branch_v1.1.0-pmx.1_per_page_50.json"
echo '{"jobs": [{"id": 71, "name": "build", "conclusion": "success"}, {"id": 77, "name": "smoke", "conclusion": "failure"}]}' \
  >"$stub/api/repos_test_provimux-ui_actions_runs_7_jobs_per_page_100.json"
echo '[{"annotation_level": "failure", "message": "no request leaves 127.0.0.1 (outside: https://fonts.example/x.woff2)"},
  {"annotation_level": "failure", "message": "Process completed with exit code 1."}]' \
  >"$stub/api/repos_test_provimux-ui_check-runs_77_annotations_per_page_50.json"
expect "prerelease, release run failed: incomplete" incomplete "$(report "$tmp/published.json" success)"
contains "  ... the promotion check's error shown" "$tmp/report.out" "smoke: no request leaves 127.0.0.1"
lacks "  ... not the runner's exit line" "$tmp/report.out" "Process completed"
expect "notify for that state: pushed, release not complete" "sync: v1.1.0 — pushed, release not complete, owner needed" \
  "$(notify v1.1.0 failed 'publish: the provimux-ui-release run for v1.1.0-pmx.1 ended failure')"
contains "  ... the promotion check's error shown" "$tmp/notify.out" "smoke: no request leaves 127.0.0.1"
contains "  ... says how to rerun" "$tmp/notify.out" "gh run rerun 7 --failed -R test/provimux-ui"

echo "# releases_status: the newest tag decides, failed predecessors stay as history; the sweep"
# v1.1.0-pmx.1 failed (a prerelease, its run failed: above); v1.1.0-pmx.2 is complete.
git -C "$pmx" push -q "$remote" "HEAD:refs/tags/v1.1.0-pmx.2" "HEAD:refs/tags/v1.0.9-pmx.1"
cmpl() { # cmpl TAG [JQ]: a complete release of TAG
  expected_assets | jq -R -s --arg t "$1" '{tag_name: $t, draft: false, prerelease: false, published_at: "2026-11-19T00:00:00Z",
    assets: (split("\n") | map(select(length > 0) | {name: ., state: "uploaded"}))}' | jq "${2:-.}" \
    >"$stub/api/repos_test_provimux-ui_releases_tags_$1.json"
}
truns() { # truns TAG ID CONCLUSION: one provimux-ui-release run of TAG at the layer commit
  jq -n --arg sha "$pmx_sha" --arg t "$1" --argjson id "$2" --arg c "$3" '{workflow_runs: [{id: $id, path: ".github/workflows/provimux-ui-release.yml",
    event: "push", head_branch: $t, head_sha: $sha, repository: {full_name: "test/provimux-ui"},
    status: "completed", conclusion: $c, created_at: "2026-11-19T01:00:00Z"}]}' \
    >"$stub/api/repos_test_provimux-ui_actions_runs_event_push_branch_$1_per_page_50.json"
}
cmpl v1.1.0-pmx.2; truns v1.1.0-pmx.2 9 success
cmpl v1.0.9-pmx.1 '.prerelease = true'; truns v1.0.9-pmx.1 8 failure
echo '{"jobs": [{"id": 88, "name": "promote", "conclusion": "failure"}]}' >"$stub/api/repos_test_provimux-ui_actions_runs_8_jobs_per_page_100.json"
echo '[{"annotation_level": "failure", "message": "v1.0.9-pmx.1 is not authorized by a provimux-ui-publish run or the owner: not promoted"}]' \
  >"$stub/api/repos_test_provimux-ui_check-runs_88_annotations_per_page_50.json"
jq -n '[{tag_name: "v1.1.0-pmx.2", draft: false, prerelease: false, published_at: "x",
         assets: [{name: "management.html", state: "uploaded"}, {name: "checksums.txt", state: "uploaded"}]},
        {tag_name: "v1.0.9-pmx.1", draft: false, prerelease: true, published_at: "x",
         assets: [{name: "management.html", state: "uploaded"}, {name: "checksums.txt", state: "uploaded"}]},
        {tag_name: "v1.1.0-pmx.1", draft: false, prerelease: true, published_at: "x", assets: []}]' \
  >"$stub/api/repos_test_provimux-ui_releases_per_page_100.json"
rs() { # rs BASE: the status, the reasons in $tmp/rs.txt
  : >"$tmp/rs.txt"
  # shellcheck source=common.sh
  (export PATH="$stub/bin:$PATH" STUB_API="$stub/api" PMX_REPO=test/provimux-ui PMX_REPO_URL="$remote"; . "$here/common.sh"
    releases_status "$1" "$tmp/rs.json" "$tmp/rs.txt")
}
expect "a failed .1, then a complete .2: published" published "$(rs 1.1.0)"
contains "  ... the .1's failure kept as history" "$tmp/rs.txt" "history: tag v1.1.0-pmx.1"
contains "  ... with its release run's error" "$tmp/rs.txt" "history: v1.1.0-pmx.1 smoke: no request leaves 127.0.0.1"
expect "a base whose newest tag failed: incomplete" incomplete "$(rs 1.0.9)"
expect "unreleased_bases: only the base whose newest tag has no complete release" "1.0.9" \
  "$( (export PATH="$stub/bin:$PATH" STUB_API="$stub/api" PMX_REPO=test/provimux-ui PMX_REPO_URL="$remote"; . "$here/common.sh"; unreleased_bases) )"
expect "report for v1.1.0: published" published "$(report "$tmp/published.json" success)"
contains "  ... and its sweep reports the failed tag on the other base" "$tmp/report.out" "sweep: sync: v1.0.9 — release incomplete"
contains "  ... with why" "$tmp/report.out" "is not authorized by a provimux-ui-publish run or the owner"
# For real (the stub records issue commands): the open v1.1.0 issue is closed with the
# history; the v1.0.9 failure gets its own issue.
echo '[{"number": 9, "title": "sync: v1.1.0 — release incomplete"}]' >"$stub/api/repos_test_provimux-ui_issues_state_open_per_page_100.json"
: >"$stub/issue.log"
env PATH="$stub/bin:$PATH" STUB_API="$stub/api" PMX_REPO=test/provimux-ui PMX_REPO_URL="$remote" RESULT="$tmp/published.json" \
  CHECK_JOB=success RUN_URL=https://example.invalid/run bash "$here/report.sh" >"$tmp/report.out" 2>&1 || true
contains "the released base's issue is closed" "$stub/issue.log" "issue close 9"
contains "  ... keeping the failed tag's history" "$stub/issue.log" "Earlier tags of this base that failed"
contains "the failed tag on the other base gets its issue" "$stub/issue.log" "issue create -R test/provimux-ui --title sync: v1.0.9 — release incomplete"
echo '[]' >"$stub/api/repos_test_provimux-ui_issues_state_open_per_page_100.json"

echo "# release authorization (release_authorized, release-auth.sh)"
asha="$pmx_sha"
# auth STATUSES-JSON: the statuses of the layer commit; then release-auth.sh's result.
auth() {
  echo "$1" >"$stub/api/repos_test_provimux-ui_commits_${asha}_statuses_per_page_100.json"
  env PATH="$stub/bin:$PATH" STUB_API="$stub/api" PMX_REPO=test/provimux-ui PMX_AUTH_WAIT=0 \
    bash "$here/release-auth.sh" v1.1.0-pmx.2 "$asha" >"$tmp/auth.out" 2>&1 && echo pass || echo fail
}
jq -n '{id: 31, path: ".github/workflows/provimux-ui-publish.yml", event: "workflow_run", head_branch: "main",
  repository: {full_name: "test/provimux-ui"}, head_repository: {full_name: "test/provimux-ui"}}' >"$stub/api/repos_test_provimux-ui_actions_runs_31.json"
jq -n '{id: 32, path: ".github/workflows/provimux-ui-check.yml", event: "workflow_dispatch", head_branch: "main",
  repository: {full_name: "test/provimux-ui"}, head_repository: {full_name: "test/provimux-ui"}}' >"$stub/api/repos_test_provimux-ui_actions_runs_32.json"
st() { jq -n --arg l "$1" --arg u "$2" --arg d "${3:-v1.1.0-pmx.2}" --arg s "${4:-success}" \
  '[{context: "provimux-ui-release", state: $s, description: $d, target_url: $u, creator: {login: $l}}]'; }
expect "status from a provimux-ui-publish run of this repository: authorized" pass "$(auth "$(st 'github-actions[bot]' https://github.com/test/provimux-ui/actions/runs/31)")"
expect "status from the owner: authorized" pass "$(auth "$(st test '')")"
expect "status from another workflow's run (the check): refused" fail "$(auth "$(st 'github-actions[bot]' https://github.com/test/provimux-ui/actions/runs/32)")"
expect "status naming a run of another repository: refused" fail "$(auth "$(st 'github-actions[bot]' https://github.com/other/provimux-ui/actions/runs/31)")"
expect "status for another tag (the .1): refused" fail "$(auth "$(st test '' v1.1.0-pmx.1)")"
expect "status not success: refused" fail "$(auth "$(st test '' v1.1.0-pmx.2 failure)")"
expect "status from another account: refused" fail "$(auth "$(st someone-else '')")"
expect "no status (a tag nobody authorized, e.g. a newer tag on an older commit): refused" fail "$(auth '[]')"
contains "  ... says why, as an error" "$tmp/auth.out" "::error title=release not authorized::"

echo "# release-check.sh (the published release as anyone downloads it)"
rc="$tmp/rc"
mkdir -p "$rc/bin" "$rc/api" "$rc/dl"
cp "$stub/bin/gh" "$rc/bin/gh"
cat >"$rc/bin/curl" <<'EOF'
#!/usr/bin/env bash
# Stub curl: "-o FILE URL" copies $STUB_DL/<last path element of URL>.
o='' u=''
while [ $# -gt 0 ]; do case "$1" in -o) o=$2; shift ;; --retry) shift ;; -*) ;; *) u=$1 ;; esac; shift; done
[ -f "$STUB_DL/${u##*/}" ] || exit 22
cp "$STUB_DL/${u##*/}" "$o"
EOF
chmod +x "$rc/bin/curl"
printf 'MIT License\n\nCopyright (c) 2026 x\n' >"$rc/LICENSE"
# page [TITLE] [EXTRA]: a management.html like the build's, version v1.1.0-pmx.1.
page() {
  printf '<!doctype html>\n<!--\nMIT License\nCopyright (c) 2026 x\n-->\n<html><head><title>%s</title>%s</head><body><script>const v="v1.1.0-pmx.1";</script></body></html>\n' \
    "${1:-Provimux by providers.dev}" "${2:-}" >"$rc/dl/management.html"
}
# publish [JQ]: checksums.txt and the release JSON for the files in $rc/dl (JQ edits the JSON).
publish() {
  local h c
  h="$(shasum -a 256 "$rc/dl/management.html" | cut -d' ' -f1)"
  printf '%s  management.html\n' "$h" >"$rc/dl/checksums.txt"
  c="$(shasum -a 256 "$rc/dl/checksums.txt" | cut -d' ' -f1)"
  jq -n --arg h "$h" --arg c "$c" '{tag_name: "v1.1.0-pmx.1", draft: false, prerelease: true, published_at: "2026-11-19T00:00:00Z",
    assets: [{name: "management.html", state: "uploaded", digest: "sha256:\($h)",
              browser_download_url: "https://github.com/test/provimux-ui/releases/download/v1.1.0-pmx.1/management.html"},
             {name: "checksums.txt", state: "uploaded", digest: "sha256:\($c)",
              browser_download_url: "https://github.com/test/provimux-ui/releases/download/v1.1.0-pmx.1/checksums.txt"}]}' |
    jq "${1:-.}" >"$rc/api/repos_test_provimux-ui_releases_tags_v1.1.0-pmx.1.json"
  echo "$h"
}
rcheck() { # rcheck [SHA256]: pass | fail, the output in $tmp/rc.out
  env PATH="$rc/bin:$PATH" STUB_API="$rc/api" STUB_DL="$rc/dl" PMX_REPO=test/provimux-ui PMX_LICENSE="$rc/LICENSE" \
    GITHUB_OUTPUT="$tmp/rc.gh" bash "$here/release-check.sh" v1.1.0-pmx.1 "$tmp/rc.work" "$@" >"$tmp/rc.out" 2>&1 && echo pass || echo fail
}
page; good="$(publish)"
expect "the release as built: passes" pass "$(rcheck)"
expect "  ... and with the build's sha256" pass "$(rcheck "$good")"
expect "another build's sha256: fails" fail "$(rcheck 0000000000000000000000000000000000000000000000000000000000000000)"
contains "  ... says the build differs" "$tmp/rc.out" "the build job built"
publish '.assets[0].digest = "sha256:00"' >/dev/null
expect "API digest differs from the file: fails" fail "$(rcheck)"
publish >/dev/null; echo "0000  management.html" >"$rc/dl/checksums.txt"
expect "checksums.txt differs from the file: fails" fail "$(rcheck)"
publish '.assets += [{name: "extra.js", state: "uploaded"}]' >/dev/null
expect "a third asset: fails" fail "$(rcheck)"
publish '.draft = true' >/dev/null
expect "a draft: fails" fail "$(rcheck)"
page 'CLI Proxy API Management Center'; publish >/dev/null
expect "another title: fails" fail "$(rcheck)"
page '' '<script src="https://cdn.example/x.js"></script>'; publish >/dev/null
expect "an external script: fails" fail "$(rcheck)"
page; sed -i.bak 's/v1.1.0-pmx.1/v1.1.0-pmx.0-dryrun/' "$rc/dl/management.html"; rm "$rc/dl/management.html.bak"; publish >/dev/null
expect "another version in the page: fails" fail "$(rcheck)"
page; sed -i.bak '/^Copyright/d' "$rc/dl/management.html"; rm "$rc/dl/management.html.bak"; publish >/dev/null
expect "the MIT notice incomplete: fails" fail "$(rcheck)"
contains "  ... names the notice" "$tmp/rc.out" "MIT notice"

echo "# provimux-ui-release.yml: the promote step"
sed -n '/^ *# >>> promote$/,/^ *# <<< promote$/p' "$here/../workflows/provimux-ui-release.yml" | sed 's/^          //' >"$tmp/promote.sh"
if [[ "$(grep -c '' "$tmp/promote.sh")" -gt 40 ]]; then ok "promote lines found in the workflow"; else bad "promote lines found in the workflow"; fi
pr="$tmp/pr"
mkdir -p "$pr/bin" "$pr/api" "$pr/after"
cat >"$pr/bin/gh" <<'EOF'
#!/usr/bin/env bash
# Stub gh for the promote step: "gh release edit" is logged and applies $STUB_API/../after/
# (it fails when $STUB_EDIT_FAIL is set). "gh api PATH [--jq Q]" answers from files; a
# PATH.err file is an error with that text.
if [ "$1" = release ]; then
  echo "$*" >>"$STUB_API/../release.log"
  [ -z "${STUB_EDIT_FAIL:-}" ] || { echo "HTTP 422" >&2; exit 1; }
  for f in "$STUB_API/../after/"*; do [ -e "$f" ] || continue; case "$f" in *.gone) rm -f "$STUB_API/$(basename "${f%.gone}")" ;; *) cp "$f" "$STUB_API/" ;; esac; done
  exit 0
fi
[ "$1" = api ] || exit 1
p=$2; q=''
[ "$3" = --jq ] && q=$4
f="$STUB_API/$(printf %s "$p" | tr '/?&=' '____').json"
[ ! -f "$f.err" ] || { cat "$f.err" >&2; exit 1; }
[ -f "$f" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
if [ -n "$q" ]; then jq -r "$q" "$f"; else cat "$f"; fi
EOF
chmod +x "$pr/bin/gh"
h=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
csha=cccccccccccccccccccccccccccccccccccccccc
# rel DIR PRERELEASE DIGEST LATEST [IMMUTABLE]: the release v1.1.0-pmx.2 and releases/latest in DIR.
rel() {
  mkdir -p "$1"
  jq -n --argjson pre "$2" --arg d "$3" --argjson im "${5:-true}" '{tag_name: "v1.1.0-pmx.2", draft: false, prerelease: $pre, immutable: $im,
    assets: [{name: "checksums.txt", digest: "sha256:cc"}, {name: "management.html", digest: $d}]}' \
    >"$1/repos_test_provimux-ui_releases_tags_v1.1.0-pmx.2.json"
  rm -f "$1/repos_test_provimux-ui_releases_latest.json.err"
  if [[ -n "$4" ]]; then jq -n --arg t "$4" '{tag_name: $t}' >"$1/repos_test_provimux-ui_releases_latest.json"
  else rm -f "$1/repos_test_provimux-ui_releases_latest.json"; fi
}
# pauth LOGIN URL: the authorization status on the tag's commit.
pauth() {
  jq -n --arg l "$1" --arg u "$2" '[{context: "provimux-ui-release", state: "success", description: "v1.1.0-pmx.2", target_url: $u, creator: {login: $l}}]' \
    >"$pr/api/repos_test_provimux-ui_commits_${csha}_statuses_per_page_100.json"
}
cp "$stub/api/repos_test_provimux-ui_actions_runs_31.json" "$stub/api/repos_test_provimux-ui_actions_runs_32.json" "$pr/api/"
jq -n --arg s "$csha" '{sha: $s}' >"$pr/api/repos_test_provimux-ui_commits_v1.1.0-pmx.2.json"
promote() { # promote ENV...: "<exit status> <gh release commands>"
  : >"$pr/release.log"
  local rc=0
  env PATH="$pr/bin:$PATH" STUB_API="$pr/api" GH_REPO=test/provimux-ui GITHUB_STEP_SUMMARY=/dev/null \
    GITHUB_EVENT_NAME=push GITHUB_REF=refs/tags/v1.1.0-pmx.2 GITHUB_SHA="$csha" TAG=v1.1.0-pmx.2 SHA="$h" BUILT="$h" "$@" \
    bash "$tmp/promote.sh" >"$tmp/promote.out" 2>&1 || rc=$?
  echo "$rc $(tr '\n' ' ' <"$pr/release.log")"
}
E='release edit v1.1.0-pmx.2 --prerelease=false --latest '
pauth 'github-actions[bot]' https://github.com/test/provimux-ui/actions/runs/31
rel "$pr/api" true "sha256:$h" v1.1.0-pmx.1; rel "$pr/after" false "sha256:$h" v1.1.0-pmx.2
expect "an authorized, immutable, checked prerelease, older latest: promoted" "0 $E" "$(promote)"
contains "  ... names who authorized it" "$tmp/promote.out" "authorized by provimux-ui-publish run 31"
rel "$pr/api" true "sha256:$h" v1.1.0-pmx.1
expect "the same on a dry run: nothing changes" "0 " "$(promote GITHUB_EVENT_NAME=workflow_dispatch GITHUB_REF=refs/heads/main)"
contains "  ... says what it would do" "$tmp/promote.out" "Dry run: would run gh release edit v1.1.0-pmx.2"
pauth test ''
rel "$pr/api" true "sha256:$h" v1.1.0-pmx.1
expect "authorized by the owner: promoted" "0 $E" "$(promote)"
pauth 'github-actions[bot]' https://github.com/test/provimux-ui/actions/runs/32
rel "$pr/api" true "sha256:$h" v1.1.0-pmx.1
expect "authorized by another workflow's run: refused" "1 " "$(promote)"
contains "  ... says it is not authorized" "$tmp/promote.out" "is not authorized"
echo '[]' >"$pr/api/repos_test_provimux-ui_commits_${csha}_statuses_per_page_100.json"
expect "no authorization (a tag nobody published, e.g. a newer tag on an older commit): refused" "1 " "$(promote)"
pauth 'github-actions[bot]' https://github.com/test/provimux-ui/actions/runs/31
rel "$pr/api" true "sha256:$h" v1.1.0-pmx.1 false
expect "not an immutable release: refused" "1 " "$(promote)"
contains "  ... says so" "$tmp/promote.out" "not an immutable release"
rel "$pr/api" false "sha256:$h" v1.1.0-pmx.2
expect "already the latest: nothing to do" "0 " "$(promote)"
rel "$pr/api" true "sha256:bbbb" v1.1.0-pmx.1
expect "the asset changed since the smoke job: refused" "1 " "$(promote)"
rel "$pr/api" true "sha256:$h" v1.2.0-pmx.1
expect "a newer release is the latest: refused (stays a prerelease)" "1 " "$(promote)"
contains "  ... says so" "$tmp/promote.out" "newer than v1.1.0-pmx.2"
rel "$pr/api" true "sha256:$h" ''
expect "no latest release yet (404): promoted" "0 $E" "$(promote)"
rel "$pr/api" true "sha256:$h" ''; echo 'gh: Service Unavailable (HTTP 503)' >"$pr/api/repos_test_provimux-ui_releases_latest.json.err"
expect "the latest release unreadable (503): refused, nothing changed" "1 " "$(promote)"
contains "  ... says so" "$tmp/promote.out" "cannot read the latest release: nothing changed"
rel "$pr/api" true "sha256:$h" v1.1.0-pmx.1
expect "the checked file is not this run's build: refused" "1 " "$(promote BUILT=0000000000000000000000000000000000000000000000000000000000000000)"
rel "$pr/api" true "sha256:$h" v1.1.0-pmx.1
expect "the edit itself fails: red, with what the release reads now" "1 $E" "$(promote STUB_EDIT_FAIL=1)"
contains "  ... reported" "$tmp/promote.out" "gh release edit failed; the release now reads"
rel "$pr/api" true "sha256:$h" v1.1.0-pmx.1; rm -f "$pr/after/"*; rel "$pr/after" true "sha256:$h" v1.1.0-pmx.1
expect "the edit did not take: red, with what it reads back" "1 $E" "$(promote)"
contains "  ... reported" "$tmp/promote.out" "edited, but it reads back as prerelease true"
rel "$pr/api" true "sha256:$h" v1.1.0-pmx.1; rm -f "$pr/after/"*; touch "$pr/after/repos_test_provimux-ui_releases_tags_v1.1.0-pmx.2.json.gone"
expect "the release cannot be read back after the edit: red, state unknown" "1 $E" "$(promote)"
contains "  ... reported" "$tmp/promote.out" "cannot be read back: its state is unknown"
rm -f "$pr/after/"*
expect "no tag from the smoke job: refused" "1 " "$(promote TAG=)"
if grep -q 'group: provimux-ui-promote' "$here/../workflows/provimux-ui-release.yml"; then
  ok "the promote job runs in one repository-wide concurrency group"
else bad "the promote job runs in one repository-wide concurrency group"; fi

echo
echo "$pass passed, $failed failed"
[[ $failed -eq 0 ]]

#!/usr/bin/env bash
# provimux-ui sync check (.github/provimux/SYNC.md), run by provimux-ui-check.yml. It
# publishes nothing and needs no token beyond read access: provimux-ui-publish.yml (or
# the owner, by hand) publishes a pass with publish.sh. Adapted from Provimux's check.sh.
#
#   check.sh select        which upstream console release, and whether there is anything
#                          to do (gh, read-only; runs no repository code)
#   check.sh prepare       rebase, bundle, range-diff, workflow paths, guard (git only)
#   check.sh tree T        T = candidate | tag: a checkout of that commit (git only, the
#                          same files the release's checkout builds), to $PMX_TREES/T,
#                          without .git
#   check.sh test T        bun install --frozen-lockfile, bun run verify on tree T. RUNS
#                          THE TREE'S CODE. Writes only logs and exit statuses to
#                          $PMX_TEST_OUT/T and decides nothing.
#   check.sh verdict       reads those exit statuses (data) and writes the status. Runs
#                          no repository code.
#   check.sh               all of them, in one process (local use only).
#
# select: the tag is $PMX_TAG, or upstream's newest stable release (published, not a
# draft, not a prerelease); an explicit tag must be one too. The base of main is the
# newest vX.Y.Z tag of upstream (its refs, not local tags) whose commit is an ancestor of
# main; a newer reachable tag that upstream withdrew or moved is an error (upstream_base).
#   - v<base>-pmx.* exists here: "published" when every such release is complete
#     (promoted, all assets) and its release run at the tag's commit succeeded,
#     "in-progress" while such a run runs, "incomplete" otherwise (releases_status);
#   - main is already on the tag (and no -pmx tag): "unreleased";
#   - the tag does not descend from main's base: "fail";
#   - otherwise: "check", and prepare goes on.
# prepare: git rebase <tag commit> (never --onto; committer date = author date, so the same
# inputs give the same candidate), bundle <tag commit>..candidate, range-diff of
# <old base>..<old main> against <tag>..<candidate> (dropped patches and changed patches
# need the owner; a patch whose change is identical and only its surrounding code moved is
# listed and accepted: split_changed), the paths under .github/workflows/ new in the tag
# (publish.sh refuses them), guard.sh with the expected base. Status "test".
# verdict: bun run verify must pass on the candidate: the release's build job runs the
# same verify, so a candidate that fails it cannot be released. The pristine tag's verify
# says whether a failure is upstream's own ("no worse") or the layer's.
#
# The status ends in $PMX_CHECK_OUT/result.json with candidate.bundle and logs/:
#   pass | fail | error | published | in-progress | incomplete | unreleased
# Exit status: 0 unless the script itself breaks (the status is the result).
#
# Env: PMX_TAG (optional), PMX_MAIN_REF (default HEAD), PMX_CHECK_OUT (default: a new temp
# dir), PMX_TEST_OUT (default $PMX_CHECK_OUT/test), PMX_TREES (default $PMX_CHECK_OUT/trees),
# PMX_RUN_URL, PMX_PREP_JOB / PMX_TEST_JOB (the jobs' results, for messages),
# PMX_UPSTREAM_REPO / PMX_UPSTREAM_URL / PMX_REPO / PMX_REPO_URL (common.sh).
# Runs with bash 3.2 (macOS); needs git, jq, gh (and bun for test). The rebase happens in
# a temporary worktree; the only refs it writes are refs/pmx-check/*, deleted on exit.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"

mode="${1:-all}"
out="${PMX_CHECK_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/provimux-ui-check.XXXXXX")}"
mkdir -p "$out/logs"
test_out="${PMX_TEST_OUT:-$out/test}"
trees="${PMX_TREES:-$out/trees}"
state="$out/state.env"
log() { echo "==> $*" >&2; }

status='' step='' tag='' base='' upstream_commit='' old_main='' old_base_tag='' old_base_commit=''
candidate='' commits='' guard_ok='' tests_ok=''
reasons="$out/reasons.txt"
save_state() {
  local v
  for v in status step tag base upstream_commit old_main old_base_tag old_base_commit candidate commits guard_ok; do
    printf '%s=%q\n' "$v" "${!v}"
  done >"$state"
}
reason() { printf '%s\n' "$*" >>"$reasons"; log "$*"; }

# result.json from the variables and files so far; also on an unexpected exit.
# write_result [STATUS REASON]: with arguments, a provisional result.
write_result() {
  local s="$status" rfile="$reasons" f
  if [[ $# -eq 2 ]]; then
    s=$1 rfile="$out/reasons.provisional.txt"
    printf '%s\n' "$2" >"$rfile"
  elif [[ -z "$s" || "$s" == running || "$s" == check || "$s" == test ]]; then
    s=error
    reason "check.sh stopped unexpectedly during step '$step'"
  fi
  touch "$reasons"
  for f in dropped changed context added wf-new wf-removed logs/range-diff.txt logs/guard.log; do touch "$out/$f"; done
  for f in tests rebase release; do [[ -s "$out/$f.json" ]] || echo 'null' >"$out/$f.json"; done
  jq -n \
    --arg status "$s" --arg step "$step" --arg tag "$tag" --arg base "$base" \
    --arg upstream_repo "$PMX_UPSTREAM_REPO" --arg upstream_commit "$upstream_commit" \
    --arg old_main "$old_main" --arg old_base_tag "$old_base_tag" --arg old_base_commit "$old_base_commit" \
    --arg candidate "$candidate" --arg commits "$commits" \
    --arg guard_ok "$guard_ok" --arg run_url "${PMX_RUN_URL:-}" \
    --rawfile reasons "$rfile" \
    --rawfile dropped "$out/dropped" --rawfile changed "$out/changed" --rawfile context "$out/context" \
    --rawfile added "$out/added" --rawfile wf_new "$out/wf-new" --rawfile wf_removed "$out/wf-removed" \
    --rawfile range_diff "$out/logs/range-diff.txt" --rawfile guard "$out/logs/guard.log" \
    --slurpfile tests "$out/tests.json" --slurpfile rebase "$out/rebase.json" --slurpfile release "$out/release.json" '
    def lines: split("\n") | map(select(length > 0));
    def commits: lines | map(split("\t") | {commit: .[0], subject: (.[1:] | join("\t"))});
    def ok($v): if $v == "" then null else ($v == "true") end;
    {
      schema: 1,
      status: $status,
      step: $step,
      reasons: ($reasons | lines),
      upstream: {repo: $upstream_repo, tag: $tag, commit: $upstream_commit},
      base: $base,
      old: {main: $old_main, base_tag: $old_base_tag, base_commit: $old_base_commit},
      candidate: $candidate,
      commits: (if $commits == "" then null else ($commits | tonumber) end),
      decisions: {dropped: ($dropped | commits), changed: ($changed | commits), new_workflows: ($wf_new | lines)},
      context_only: ($context | commits),
      added: ($added | commits),
      removed_workflows: ($wf_removed | lines),
      rebase: $rebase[0],
      guard: {ok: ok($guard_ok), output: ($guard | lines | .[-40:] | join("\n"))},
      tests: $tests[0],
      release: $release[0],
      range_diff: (if ($range_diff | length) > 60000 then ($range_diff[0:60000] + "\n[truncated: see logs/range-diff.txt]") else $range_diff end),
      run_url: $run_url
    }' >"$out/result.json"
  log "result: $s ($out/result.json)"
}

cleanup_paths=()
cleanup() {
  local p
  for p in ${cleanup_paths[@]+"${cleanup_paths[@]}"}; do
    git worktree remove --force "$p" >/dev/null 2>&1 || true
    rm -rf "${p:?}"
  done
  git for-each-ref --format='%(refname)' refs/pmx-check/ 2>/dev/null | while read -r r; do git update-ref -d "$r"; done
  git worktree prune >/dev/null 2>&1 || true
}

# --- select ---------------------------------------------------------------------------------
do_select() {
  local up_tags c s
  : >"$reasons"
  status=running
  step=select
  old_main="$(git rev-parse "${PMX_MAIN_REF:-HEAD}^{commit}")"
  up_tags="$(git ls-remote --tags "$PMX_UPSTREAM_URL")" || { status=error; reason "cannot list the tags of $PMX_UPSTREAM_URL"; return; }
  if ! c="$(upstream_base "$old_main" "$up_tags" 2>"$out/base.err")"; then
    status=error; reason "main's base: $(cat "$out/base.err")"; return
  fi
  old_base_tag="${c%% *}" old_base_commit="${c#* }"

  tag="${PMX_TAG:-}"
  if [[ -z "$tag" ]]; then
    tag="$(newest_stable_release)" || true
    [[ -n "$tag" ]] || { status=error; reason "cannot read the releases of $PMX_UPSTREAM_REPO"; return; }
  fi
  [[ "$tag" =~ $PMX_STABLE_RE ]] || { status=fail; reason "'$tag' is not a vX.Y.Z tag"; return; }
  base="${tag#v}"
  s="$(upstream_release_state "$tag")"
  if [[ "$s" != stable ]]; then
    status=fail
    case "$s" in
      missing) reason "$tag is not a published release of $PMX_UPSTREAM_REPO" ;;
      error:*) status=error; reason "cannot read release $tag of $PMX_UPSTREAM_REPO: ${s#error:}" ;;
      *) reason "$tag is a $s release of $PMX_UPSTREAM_REPO, not a stable one" ;;
    esac
    return
  fi
  upstream_commit="$(ls_remote_tag "$up_tags" "$tag")"
  [[ -n "$upstream_commit" ]] || { status=fail; reason "$tag has a release but no git tag in $PMX_UPSTREAM_URL"; return; }
  log "upstream $tag = ${upstream_commit:0:8}; main ${old_main:0:8} on $old_base_tag"

  s="$(releases_status "$base" "$out/release.json" "$reasons")"
  case "$s" in
    none) ;;
    error) status=error; return ;;
    *) status=$s; log "v$base already has provimux-ui tags: $status"; return ;;
  esac
  if [[ "$upstream_commit" == "$old_base_commit" ]]; then
    status=unreleased
    reason "main ${old_main:0:8} is already on $tag but no v$base-pmx.* tag exists"
    return
  fi
  if ! git merge-base --is-ancestor "$old_base_commit" "$upstream_commit" 2>/dev/null; then
    git fetch -q --no-tags "$PMX_UPSTREAM_URL" "refs/tags/$tag" || { status=error; reason "cannot fetch $tag"; return; }
    if ! git merge-base --is-ancestor "$old_base_commit" "$upstream_commit"; then
      status=fail; reason "$tag (${upstream_commit:0:8}) does not descend from main's base $old_base_tag"; return
    fi
  fi
  status=check
}

# --- prepare (git only) ---------------------------------------------------------------------
do_prepare() {
  local wt stopped
  # shellcheck disable=SC1090
  . "$state"
  [[ "$status" == check ]] || { log "nothing to prepare (status $status)"; return; }
  status=running

  step=fetch
  git fetch -q --no-tags "$PMX_UPSTREAM_URL" "refs/tags/$tag" || { status=error; reason "cannot fetch $tag"; return; }
  [[ "$(git rev-parse "FETCH_HEAD^{commit}")" == "$upstream_commit" ]] ||
    { status=error; reason "$tag moved while checking: now $(git rev-parse --short "FETCH_HEAD^{commit}")"; return; }
  git update-ref refs/pmx-check/upstream "$upstream_commit"

  # 1. Rebase, in a temporary worktree: git rebase <tag>, never --onto.
  step=rebase
  wt="$(mktemp -d "${TMPDIR:-/tmp}/provimux-ui-check-wt.XXXXXX")"
  cleanup_paths+=("$wt")
  git worktree add -q --detach "$wt" "$old_main"
  log "git rebase $tag"
  if ! (cd "$wt" && git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    -c rebase.autoStash=false -c rebase.updateRefs=false -c core.hooksPath=/dev/null \
    rebase --committer-date-is-author-date "$upstream_commit") >"$out/logs/rebase.log" 2>&1; then
    stopped="$(cd "$wt" && git rev-parse -q --verify REBASE_HEAD || true)"
    (
      cd "$wt"
      jq -n --arg stopped "$stopped" \
        --arg subject "$( [[ -n "$stopped" ]] && git log -1 --format=%s "$stopped" || true)" \
        --arg conflicts "$(git diff --name-only --diff-filter=U || true)" \
        --rawfile log "$out/logs/rebase.log" \
        '{ok: false, stopped_at: $stopped, subject: $subject,
          conflicts: ($conflicts | split("\n") | map(select(length > 0))),
          log: ($log | split("\n") | .[-30:] | join("\n"))}' >"$out/rebase.json"
      git rebase --abort >/dev/null 2>&1 || true
    )
    status=fail
    reason "main does not rebase cleanly onto $tag${stopped:+ (stopped at ${stopped:0:8})}"
    return
  fi
  candidate="$(cd "$wt" && git rev-parse HEAD)"
  commits="$(git rev-list --count "$upstream_commit..$candidate")"
  echo '{"ok": true}' >"$out/rebase.json"
  git update-ref refs/pmx-check/candidate "$candidate"
  git bundle create -q "$out/candidate.bundle" refs/pmx-check/candidate "^$upstream_commit"
  log "candidate ${candidate:0:8}: $commits commits on $tag"

  # 2. range-diff: which layer commits the rebase dropped or changed.
  step=range-diff
  git range-diff --no-color --no-notes "$old_base_commit..$old_main" "$upstream_commit..$candidate" >"$out/logs/range-diff.txt"
  range_diff_lists "$out/logs/range-diff.txt" "$out" git
  [[ ! -s "$out/added" ]] || reason "the candidate has commits that are not in the old main (range-diff '>')"
  [[ -z "$(git rev-list --merges "$upstream_commit..$candidate")" ]] || reason "the candidate has merge commits above $tag"

  # 3. Workflow files: every path new in the tag stops publish.sh (SYNC.md).
  step=workflows
  git ls-tree -r --name-only "$old_base_commit" -- .github/workflows/ | sort >"$out/wf-old"
  git ls-tree -r --name-only "$upstream_commit" -- .github/workflows/ | sort >"$out/wf-tag"
  comm -13 "$out/wf-old" "$out/wf-tag" >"$out/wf-new"
  comm -23 "$out/wf-old" "$out/wf-tag" >"$out/wf-removed"

  # 4. Guard (this run's copy, git only): the base must be exactly the tag's commit.
  step=guard
  if (cd "$wt" && PMX_UPSTREAM="$PMX_UPSTREAM_URL" PMX_EXPECT_BASE="$tag" PMX_EXPECT_BASE_COMMIT="$upstream_commit" \
    bash "$here/guard.sh") >"$out/logs/guard.log" 2>&1; then
    guard_ok=true
  else
    guard_ok=false; reason "the guard rejects the candidate"
  fi
  step="test"
  status="test"
}

# --- tree (git only) ---------------------------------------------------------------------------
# do_tree candidate|tag: a checkout of the commit (as the release's actions/checkout makes
# it: the same files, filters and modes), without .git, to $trees/<T>. Works in its own
# repository, so it needs only the prepare step's out dir.
do_tree() {
  local which=$1 repo c
  # shellcheck disable=SC1090
  . "$state"
  [[ "$status" == test ]] || { echo "check.sh tree: nothing to test (status $status)" >&2; exit 1; }
  repo="$(mktemp -d "${TMPDIR:-/tmp}/provimux-ui-check-tree.XXXXXX")"
  cleanup_paths+=("$repo")
  tg() { git --git-dir="$repo" "$@"; }
  tg init -q --bare
  tg fetch -q --no-tags "$PMX_UPSTREAM_URL" "+refs/tags/$tag:refs/pmx/upstream"
  [[ "$(tg rev-parse "refs/pmx/upstream^{commit}")" == "$upstream_commit" ]] ||
    { echo "check.sh tree: $tag is no longer $upstream_commit" >&2; exit 1; }
  case "$which" in
    tag) c="$upstream_commit" ;;
    candidate)
      tg fetch -q "$out/candidate.bundle" "+refs/pmx-check/candidate:refs/pmx/candidate"
      [[ "$(tg rev-parse refs/pmx/candidate)" == "$candidate" ]] ||
        { echo "check.sh tree: the bundle is not the candidate $candidate" >&2; exit 1; }
      c="$candidate"
      ;;
    *) echo "usage: $0 tree candidate|tag" >&2; exit 2 ;;
  esac
  rm -rf "${trees:?}/$which"
  mkdir -p "$trees/$which"
  tg -c core.bare=false -c core.hooksPath=/dev/null --work-tree="$trees/$which" checkout -q -f --detach "$c"
  log "tree $which ($c) in $trees/$which"
}

# --- test (runs the tree's code; logs and exit statuses only) ------------------------------------
# step NAME CMD...: runs CMD in the tree, keeping NAME.log and NAME.exit.
do_test() {
  local which=$1 dir d e
  dir="$trees/$which" d="$test_out/$which"
  [[ -d "$dir" ]] || { echo "check.sh test: no tree $dir (run check.sh tree $which)" >&2; exit 1; }
  rm -rf "${d:?}"; mkdir -p "$d"
  run_step() {
    local name=$1; shift
    log "$* ($which)"
    set +e; (cd "$dir" && "$@") >"$d/$name.log" 2>&1; e=$?; set -e
    echo "$e" >"$d/$name.exit"
    return "$e"
  }
  run_step install bun install --frozen-lockfile && run_step verify bun run verify || true
  log "logs and exit statuses in $d"
}

# --- verdict (no repository code: the exit statuses are data) ------------------------------------
exitval() {
  local v=''
  [[ -f "$1" ]] && v="$(head -c 16 "$1" | tr -d ' \n\r')"
  [[ "$v" =~ ^[0-9]{1,3}$ ]] && echo "$v" || echo -1
}
# tail_log FILE: the last 60 lines, without ANSI colour codes.
tail_log() { [[ -f "$1" ]] && tail -n 60 "$1" | sed $'s/\x1b\\[[0-9;]*m//g' || true; }

do_verdict() {
  local c="$test_out/candidate" t="$test_out/tag" w ci cv ti tv
  [[ -f "$state" ]] || { status=error step=verdict; reason "no result from the prepare job (job: ${PMX_PREP_JOB:-unknown})"; return; }
  # shellcheck disable=SC1090
  . "$state"
  [[ "$status" == test ]] || { log "nothing to decide (status $status): result.json stays"; verdict_skip=1; return; }
  status=running
  step=verdict
  for w in candidate tag; do
    [[ -f "$test_out/$w/install.exit" ]] ||
      { status=error; reason "the test job for the $w left no result (test jobs: ${PMX_TEST_JOB:-unknown})"; }
  done
  [[ "$status" == running ]] || return 0
  ci="$(exitval "$c/install.exit")" cv="$(exitval "$c/verify.exit")"
  ti="$(exitval "$t/install.exit")" tv="$(exitval "$t/verify.exit")"
  # -1: did not run (the install failed) or left no status.
  if [[ "$ci" == 0 && "$cv" == 0 ]]; then
    tests_ok=true
  else
    tests_ok=false
    if [[ "$ci" != 0 ]]; then
      reason "bun install --frozen-lockfile fails on the candidate (exit $ci)"
    else
      reason "bun run verify fails on the candidate (exit $cv)"
    fi
    if [[ "$ti" == 0 && "$tv" == 0 ]]; then
      reason "it passes on the pristine $tag: the Provimux layer breaks it"
    else
      reason "it fails on the pristine $tag too (install exit $ti, verify exit $tv): upstream's own failure, but the release's build runs the same verify, so this release cannot be built"
    fi
  fi
  jq -n --arg ok "$tests_ok" --argjson ci "$ci" --argjson cv "$cv" --argjson ti "$ti" --argjson tv "$tv" \
    --arg clog "$(tail_log "$c/verify.log"; [[ "$ci" == 0 ]] || tail_log "$c/install.log")" \
    --arg tlog "$(if [[ "$ti" == 0 && "$tv" == 0 ]]; then :; else tail_log "$t/verify.log"; tail_log "$t/install.log"; fi)" \
    '{ok: ($ok == "true"), candidate: {install: $ci, verify: $cv, tail: $clog},
      tag: {install: $ti, verify: $tv, tail: $tlog}}' >"$out/tests.json"
  step="done"
  if [[ -s "$reasons" ]]; then status=fail; else status=pass; fi
}

verdict_skip=0
case "$mode" in
  select)
    trap 'save_state; if [[ "$status" == check ]]; then step=prepare; write_result error "the prepare step did not finish (see the job log)"; else write_result; fi' EXIT
    do_select
    ;;
  prepare)
    trap 'cleanup; save_state; if [[ "$status" == test ]]; then write_result error "the tests or the verdict did not finish (see the run)"; else write_result; fi' EXIT
    do_prepare
    ;;
  tree)
    trap 'cleanup' EXIT
    do_tree "${2:-}"
    ;;
  test)
    do_test "${2:-}"
    ;;
  verdict)
    trap 'if [[ $verdict_skip -eq 0 ]]; then write_result; fi' EXIT
    do_verdict
    ;;
  all)
    trap 'cleanup; if [[ $verdict_skip -eq 0 ]]; then write_result; fi' EXIT
    do_select
    save_state
    if [[ "$status" == check ]]; then
      do_prepare
      save_state
      if [[ "$status" == test ]]; then
        do_tree candidate; do_tree tag
        do_test candidate; do_test tag
        do_verdict
      fi
    fi
    ;;
  *) echo "usage: $0 [select|prepare|tree T|test T|verdict]" >&2; exit 2 ;;
esac
{ echo "status=$status"; echo "tag=$tag"; echo "out=$out"; } >>"${GITHUB_OUTPUT:-/dev/null}"

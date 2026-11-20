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
#   check.sh fetch-prepare ID DIGEST
#                          the prepare job's artifact pmx-prepare into $PMX_CHECK_OUT, by
#                          the id and digest the prepare job output (fetch_artifact)
#   check.sh verdict       the status, from the prepare step's state (data) and the test
#                          jobs' own step conclusions, read from the API: "bun install
#                          --frozen-lockfile" and "bun run verify" of the jobs "test
#                          (candidate)" and "test (tag)" of this run attempt. Nothing the
#                          tests wrote is read. Runs no repository code.
#   check.sh               all of them, in one process (local use only: it runs bun
#                          install and bun run verify of both trees itself).
# The workflow's test jobs run bun install --frozen-lockfile and bun run verify as their
# own steps; RUNS THE TREE'S CODE there, and nothing leaves those jobs but their result.
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
# <old base>..<old main> against <tag>..<candidate> (dropped and changed layer commits
# need the owner,
# never accepted automatically: range_diff_lists; a binary file that differs makes even
# an "=" pair changed), the paths under .github/workflows/ new in the tag
# (publish.sh refuses them), guard.sh with the expected base. Status "test".
# The root README commit (trailer "Provimux-Readme: root", SYNC.md "The root README
# commit"): when the rebase stops at it on root READMEs only, prepare re-applies it (its
# own entries for those paths) and continues, once; any other stop fails as above. The
# range-diff is then of the commits below and above it, and the README commit must be the
# old one re-applied (stack_range_diff in common.sh); result.json's "readme" names both.
# verdict: bun run verify must pass on the candidate: the release's build job runs the
# same verify, so a candidate that fails it cannot be released. The pristine tag's verify
# says whether a failure is upstream's own ("no worse") or the layer's.
#
# The status ends in $PMX_CHECK_OUT/result.json with candidate.bundle and logs/:
#   pass | fail | error | published | in-progress | incomplete | unreleased
# Exit status: 0 unless the script itself breaks (the status is the result).
#
# Env: PMX_TAG (optional), PMX_MAIN_REF (default HEAD), PMX_CHECK_OUT (default: a new temp
# dir), PMX_TREES (default $PMX_CHECK_OUT/trees), PMX_RUN_URL, PMX_PREP_JOB / PMX_TEST_JOB
# (the jobs' results, for messages), PMX_RUN_ID / PMX_RUN_ATTEMPT and GH_TOKEN with
# actions: read (verdict),
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
trees="${PMX_TREES:-$out/trees}"
state="$out/state.json"
log() { echo "==> $*" >&2; }

status='' step='' tag='' base='' upstream_commit='' old_main='' old_base_tag='' old_base_commit=''
candidate='' commits='' guard_ok='' tests_ok=''
reasons="$out/reasons.txt"
# The state between the steps is JSON, read back field by field against a pattern
# (state_get in common.sh), never sourced.
save_state() {
  jq -n --arg status "$status" --arg step "$step" --arg tag "$tag" --arg base "$base" \
    --arg upstream_commit "$upstream_commit" --arg old_main "$old_main" --arg old_base_tag "$old_base_tag" \
    --arg old_base_commit "$old_base_commit" --arg candidate "$candidate" --arg commits "$commits" --arg guard_ok "$guard_ok" \
    '$ARGS.named' >"$state"
}
load_state() {
  local sha='^([0-9a-f]{40})?$' t='^(v[0-9]+\.[0-9]+\.[0-9]+)?$'
  status="$(state_get "$state" status '^(check|test|running|pass|fail|error|published|in-progress|incomplete|unreleased)?$')" &&
    step="$(state_get "$state" step '^[a-z-]*$')" &&
    tag="$(state_get "$state" tag "$t")" &&
    base="$(state_get "$state" base '^([0-9]+\.[0-9]+\.[0-9]+)?$')" &&
    upstream_commit="$(state_get "$state" upstream_commit "$sha")" &&
    old_main="$(state_get "$state" old_main "$sha")" &&
    old_base_tag="$(state_get "$state" old_base_tag "$t")" &&
    old_base_commit="$(state_get "$state" old_base_commit "$sha")" &&
    candidate="$(state_get "$state" candidate "$sha")" &&
    commits="$(state_get "$state" commits '^[0-9]*$')" &&
    guard_ok="$(state_get "$state" guard_ok '^(true|false)?$')"
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
  for f in dropped changed added wf-new wf-removed logs/range-diff.txt logs/guard.log; do touch "$out/$f"; done
  for f in tests rebase release readme; do [[ -s "$out/$f.json" ]] || echo 'null' >"$out/$f.json"; done
  jq -n \
    --arg status "$s" --arg step "$step" --arg tag "$tag" --arg base "$base" \
    --arg upstream_repo "$PMX_UPSTREAM_REPO" --arg upstream_commit "$upstream_commit" \
    --arg old_main "$old_main" --arg old_base_tag "$old_base_tag" --arg old_base_commit "$old_base_commit" \
    --arg candidate "$candidate" --arg commits "$commits" \
    --arg guard_ok "$guard_ok" --arg run_url "${PMX_RUN_URL:-}" \
    --rawfile reasons "$rfile" \
    --rawfile dropped "$out/dropped" --rawfile changed "$out/changed" \
    --rawfile added "$out/added" --rawfile wf_new "$out/wf-new" --rawfile wf_removed "$out/wf-removed" \
    --rawfile range_diff "$out/logs/range-diff.txt" --rawfile guard "$out/logs/guard.log" \
    --slurpfile tests "$out/tests.json" --slurpfile rebase "$out/rebase.json" --slurpfile release "$out/release.json" --slurpfile readme "$out/readme.json" '
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
      added: ($added | commits),
      removed_workflows: ($wf_removed | lines),
      rebase: $rebase[0],
      readme: $readme[0],
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
# The rebase's -c options, the same for --continue.
rb=(git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com'
  -c rebase.autoStash=false -c rebase.updateRefs=false -c core.hooksPath=/dev/null)
readme_old='' readme_conflicts='' wt=''

# rebase_failed WHEN: rebase.json from the stopped rebase, abort it, status fail.
rebase_failed() {
  local stopped
  stopped="$(cd "$wt" && git rev-parse -q --verify REBASE_HEAD || true)"
  (
    cd "$wt"
    jq -n --arg stopped "$stopped" \
      --arg subject "$( [[ -n "$stopped" ]] && git log -1 --format=%s "$stopped" || true)" \
      --arg conflicts "$(git diff --name-only --diff-filter=U || true)" \
      --arg readme "$readme_conflicts" --arg readme_commit "$readme_old" \
      --rawfile log "$out/logs/rebase.log" \
      '{ok: false, stopped_at: $stopped, subject: $subject,
        conflicts: ($conflicts | split("\n") | map(select(length > 0))),
        log: ($log | split("\n") | .[-30:] | join("\n"))}
       + (if $readme == "" then {} else {readme: {stopped_at: $readme_commit, conflicts: ($readme | split(" ") | map(select(length > 0)))}} end)' >"$out/rebase.json"
    git rebase --abort >/dev/null 2>&1 || true
  )
  status=fail
  reason "main does not rebase cleanly onto $tag${stopped:+ (stopped at ${stopped:0:8})}${1:+ $1}"
}

# readme_stop: the rebase in $wt stopped (its first stop); resolves it, status 0, only when
# all of these hold (design/root-readme.md, "Rebase"), and touches nothing otherwise:
#   the old main has exactly one README commit R and the stop is at it (REBASE_HEAD = R);
#   R has one parent and changes only paths of the set;
#   at least one path is unmerged, and every unmerged path is a path of the set;
#   every path the index holds differently from HEAD is a path of the set.
# Then each path of the set gets R's entry (git checkout R -- path) or none (git rm), no
# path may stay unmerged and the work tree must match the index. Sets readme_conflicts.
readme_stop() {
  local r stopped rec name unmerged='' n f st
  r="$(readme_commits "$old_base_commit..$old_main" git)" || return 1
  n="$(grep -c . <<<"$r" || true)"
  [[ "$n" == 1 ]] || return 1
  stopped="$(cd "$wt" && git rev-parse -q --verify REBASE_HEAD)" || return 1
  [[ "$stopped" == "$r" ]] || return 1
  n="$(git rev-list --parents -n 1 "$r")" || return 1
  [[ "$(wc -w <<<"$n" | tr -d ' ')" == 2 ]] || return 1
  # R changes no root entry outside the set (whole records: a directory or an empty tree
  # counts), and no path of the set is a directory in R's parent or in the stop's HEAD.
  outside_same "$r^" "$r" git >>"$out/logs/rebase.log" 2>&1 || return 1
  set_not_tree "$r^" git >>"$out/logs/rebase.log" 2>&1 || return 1
  (cd "$wt" && set_not_tree HEAD git) >>"$out/logs/rebase.log" 2>&1 || return 1
  f="$(pmx_tmp)" || return 1
  # ls-files -u -z: "<mode> <object> <stage>\t<path>", NUL-ended, one record per stage.
  (cd "$wt" && git ls-files -u -z) >"$f" || { rm -f "$f"; return 1; }
  st=0
  while IFS= read -r -d '' rec; do
    name="${rec#*$'\t'}"
    readme_path "$name" || { log "the rebase stopped at the README commit with a conflict outside the root READMEs: ${name//$'\n'/?}"; st=1; break; }
    case " $unmerged " in *" $name "*) ;; *) unmerged="${unmerged:+$unmerged }$name" ;; esac
  done <"$f"
  [[ $st -eq 0 && -n "$unmerged" ]] || { rm -f "$f"; return 1; }
  (cd "$wt" && git diff-index --cached --no-renames -z --name-only HEAD) >"$f" || { rm -f "$f"; return 1; }
  while IFS= read -r -d '' name; do
    readme_path "$name" || { log "the rebase stopped at the README commit with ${name//$'\n'/?} staged, not a root README"; st=1; break; }
  done <"$f"
  rm -f "$f"
  [[ $st -eq 0 ]] || return 1
  # (set -e does not apply in a "||" list: every step is tested.)
  (
    cd "$wt" || exit 1
    for name in "${PMX_README_PATHS[@]}"; do
      e="$(root_entry "$r" "$name" git)" || exit 1
      if [[ -n "$e" ]]; then
        git checkout -q "$r" -- ":(top,literal)$name" || exit 1
      else
        git rm -q -f --ignore-unmatch -- ":(top,literal)$name" || exit 1
      fi
    done
    u="$(git ls-files -u)" || exit 1
    [[ -z "$u" ]] && git diff --quiet --no-ext-diff --no-textconv
  ) >>"$out/logs/rebase.log" 2>&1 || return 1
  readme_old=$r readme_conflicts=$unmerged
}

do_prepare() {
  local pair='' st
  load_state || { status=error; reason "the select step's state is not valid"; return; }
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
  if ! (cd "$wt" && "${rb[@]}" rebase --committer-date-is-author-date "$upstream_commit") >"$out/logs/rebase.log" 2>&1; then
    # The one stop the check resolves itself: at the README commit, on root READMEs only.
    if readme_stop; then
      log "the rebase stopped at the README commit ${readme_old:0:8} on root READMEs only: re-applied ($readme_conflicts)"
      if ! (cd "$wt" && GIT_EDITOR=true "${rb[@]}" rebase --continue) >>"$out/logs/rebase.log" 2>&1; then
        rebase_failed "after the README commit ${readme_old:0:8} was re-applied"
        return
      fi
    else
      rebase_failed ''
      return
    fi
  fi
  candidate="$(cd "$wt" && git rev-parse HEAD)"
  commits="$(git rev-list --count "$upstream_commit..$candidate")"
  if [[ -n "$readme_conflicts" ]]; then
    jq -n --arg c "$readme_old" --arg p "$readme_conflicts" \
      '{ok: true, readme: {stopped_at: $c, conflicts: ($p | split(" ") | map(select(length > 0)))}}' >"$out/rebase.json"
  else
    echo '{"ok": true}' >"$out/rebase.json"
  fi
  git update-ref refs/pmx-check/candidate "$candidate"
  git bundle create -q "$out/candidate.bundle" refs/pmx-check/candidate "^$upstream_commit"
  log "candidate ${candidate:0:8}: $commits commits on $tag"

  # 2. range-diff: which layer commits the rebase dropped or changed. With a README commit
  # on both sides, the commits below and above it, and the README commit by its normal
  # form (stack_range_diff in common.sh).
  step=range-diff
  pair="$(stack_range_diff "$old_base_commit" "$old_main" "$upstream_commit" "$candidate" "$out/logs/range-diff.txt" git 2>"$out/readme.err")" &&
    st=0 || st=$?
  if [[ $st -eq 2 ]]; then
    status=error; reason "git failed comparing the stack: $(tr '\n' ' ' <"$out/readme.err")"; return
  elif [[ $st -ne 0 ]]; then
    pair=''; reason "the root README rule: $(tr '\n' ' ' <"$out/readme.err")"
  fi
  if [[ -n "$pair" ]]; then
    jq -n --arg o "${pair% *}" --arg n "${pair#* }" --arg p "$readme_conflicts" \
      '{old: $o, new: $n, reapplied: ($p | split(" ") | map(select(length > 0)))}' >"$out/readme.json"
    log "README commit ${pair% *} -> ${pair#* } (normal form)"
  fi
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
  load_state || { echo "check.sh tree: the prepare step's state is not valid" >&2; exit 1; }
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

# --- test (local mode only: runs the tree's code) ------------------------------------------------
# do_test T: bun install --frozen-lockfile, then bun run verify, in tree T; the outcome of
# each (success | failure | skipped) in res_<T>_install / res_<T>_verify, the logs in
# $out/test/<T>/. In the workflow these are the test jobs' own steps instead.
res_candidate_install='' res_candidate_verify='' res_tag_install='' res_tag_verify=''
do_test() {
  local which=$1 dir d
  dir="$trees/$which" d="$out/test/$which"
  [[ -d "$dir" ]] || { echo "check.sh test: no tree $dir" >&2; exit 1; }
  rm -rf "${d:?}"; mkdir -p "$d"
  printf -v "res_${which}_install" skipped; printf -v "res_${which}_verify" skipped
  log "bun install --frozen-lockfile ($which)"
  if (cd "$dir" && bun install --frozen-lockfile) >"$d/install.log" 2>&1; then
    printf -v "res_${which}_install" success
    log "bun run verify ($which)"
    if (cd "$dir" && bun run verify) >"$d/verify.log" 2>&1; then printf -v "res_${which}_verify" success
    else printf -v "res_${which}_verify" failure; fi
  else
    printf -v "res_${which}_install" failure
  fi
  log "logs in $d"
}

# --- verdict (no repository code) ------------------------------------------------------------------
# api_outcomes: the test jobs' step conclusions for this run attempt (the API, not files),
# into res_<T>_install / res_<T>_verify (success | failure | skipped | cancelled | missing)
# and url_<T>; fails when a test job is not exactly one completed job.
url_candidate='' url_tag=''
api_outcomes() {
  local jobs w j
  [[ "${PMX_RUN_ID:-}" =~ ^[0-9]+$ && "${PMX_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]] ||
    { reason "the verdict needs PMX_RUN_ID and PMX_RUN_ATTEMPT (the test jobs' results are read from the API)"; return 1; }
  jobs="$(gh api "repos/$PMX_REPO/actions/runs/$PMX_RUN_ID/attempts/$PMX_RUN_ATTEMPT/jobs?per_page=100")" ||
    { reason "cannot read the jobs of run $PMX_RUN_ID attempt $PMX_RUN_ATTEMPT"; return 1; }
  for w in candidate tag; do
    j="$(jq -c --arg n "test ($w)" '[.jobs[] | select(.name == $n)] | if length == 1 and .[0].status == "completed" then .[0] else null end' <<<"$jobs")"
    if [[ "$j" == null && "$w" == tag ]]; then
      # The pristine run is diagnostic only: without it the candidate still decides.
      res_tag_install=missing res_tag_verify=missing
      continue
    fi
    [[ "$j" != null ]] || { reason "run $PMX_RUN_ID attempt $PMX_RUN_ATTEMPT has not exactly one completed job \"test ($w)\" (test jobs: ${PMX_TEST_JOB:-unknown})"; return 1; }
    # step NAME: that step's conclusion; for the tag, whose steps continue on error (and
    # then report "success"), a marker step that ran means the step failed.
    printf -v "res_${w}_install" '%s' "$(jq -r --arg w "$w" '
      def step($n): [.steps[] | select(.name == $n) | .conclusion // "missing"] | if length == 1 then .[0] else "missing" end;
      if $w == "tag" and step("pristine install failed (diagnostic)") == "success" then "failure" else step("bun install --frozen-lockfile") end' <<<"$j")"
    printf -v "res_${w}_verify" '%s' "$(jq -r --arg w "$w" '
      def step($n): [.steps[] | select(.name == $n) | .conclusion // "missing"] | if length == 1 then .[0] else "missing" end;
      if $w == "tag" and step("pristine verify failed (diagnostic)") == "success" then "failure" else step("bun run verify") end' <<<"$j")"
    printf -v "url_${w}" '%s' "$(jq -r '.html_url // ""' <<<"$j" | grep -E '^https://github\.com/' || true)"
  done
}

do_verdict() {
  local from=$1
  [[ -f "$state" ]] || { status=error step=verdict; reason "no result from the prepare job (job: ${PMX_PREP_JOB:-unknown})"; return 0; }
  load_state || { status=error step=verdict; reason "the prepare job's state is not valid"; return 0; }
  [[ "$status" == test ]] || { log "nothing to decide (status $status): result.json stays"; verdict_skip=1; return 0; }
  status=running
  step=verdict
  if [[ "$from" == api ]]; then api_outcomes || { status=error; return 0; }; fi
  if [[ "$res_candidate_install" == success && "$res_candidate_verify" == success ]]; then
    tests_ok=true
  else
    tests_ok=false
    if [[ "$res_candidate_install" != success ]]; then
      reason "bun install --frozen-lockfile on the candidate: $res_candidate_install"
    else
      reason "bun run verify on the candidate: $res_candidate_verify"
    fi
    if [[ "$res_tag_install" == success && "$res_tag_verify" == success ]]; then
      reason "it passes on the pristine $tag: the Provimux layer breaks it"
    else
      reason "on the pristine $tag too (install $res_tag_install, verify $res_tag_verify): upstream's own failure, but the release's build runs the same verify, so this release cannot be built"
    fi
  fi
  jq -n --arg ok "$tests_ok" --arg ci "$res_candidate_install" --arg cv "$res_candidate_verify" --arg cu "$url_candidate" \
    --arg ti "$res_tag_install" --arg tv "$res_tag_verify" --arg tu "$url_tag" \
    '{ok: ($ok == "true"), candidate: {install: $ci, verify: $cv, job: $cu}, tag: {install: $ti, verify: $tv, job: $tu}}' >"$out/tests.json"
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
  fetch-prepare)
    # The prepare job's artifact, by the id and digest that job output (fetch_artifact).
    fetch_artifact "${2:-}" pmx-prepare "${3:-}" "${GITHUB_RUN_ID:-}" "$out" || exit 1
    ;;
  verdict)
    trap 'if [[ $verdict_skip -eq 0 ]]; then write_result; fi' EXIT
    do_verdict api
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
        save_state
        do_verdict local
      fi
    fi
    ;;
  *) echo "usage: $0 [select|prepare|fetch-prepare ID DIGEST|tree T|verdict]" >&2; exit 2 ;;
esac
{ echo "status=$status"; echo "tag=$tag"; echo "out=$out"; } >>"${GITHUB_OUTPUT:-/dev/null}"

#!/usr/bin/env bash
# provimux-ui publish (.github/provimux/SYNC.md): publishes what provimux-ui-check passed.
# provimux-ui-publish.yml runs it (--ci) for every passing check; by hand, the owner runs
# it on their Mac with their own git and gh credentials when the automatic publish
# refused. It never asks for or stores a token, and it runs no code of the candidate or of
# upstream (only git, gh, jq, and the guard of the current main). Adapted from Provimux's
# publish.sh.
#
#   publish.sh <vX.Y.Z> [--dry-run] [--yes] [--run <id>] [--expect-main <sha>] [--remote <name>]
#              [--accept-dropped <sha,...>] [--accept-changed <sha,...>] [--timeout <minutes>]
#   publish.sh <vX.Y.Z> --ci --plan <dir> --run <id> --attempt <n> --artifact <id> --expect-main <sha>
#   publish.sh <vX.Y.Z> --ci --wait <dir>                    (both: provimux-ui-publish.yml)
#
# 1. Picks the check run: a provimux-ui-check run of this repository, on main (event schedule
#    or workflow_dispatch), completed with conclusion success, whose head_sha is the
#    remote main now (and --expect-main, when given); the newest such run whose verdict
#    artifact is provimux-ui-check-<tag> (--run only picks among such runs). The run's
#    success and its attempt come from one read (with --attempt: of exactly that
#    attempt). The artifact is the one that attempt's verdict job bound to itself
#    (check_artifact in common.sh), never one found by name; with --artifact it must be
#    that id. Verifies it: result.json says pass for this tag and its old main is the
#    run's head_sha; the bundle's tip is result.json's candidate.
# 2. Rechecks the world: the upstream tag is still a published, non-draft, non-prerelease
#    release at the recorded commit, the old base tag too; the remote main is the
#    recorded old main; v<base>-pmx.* does not exist yet.
# 3. Verifies the candidate again here, in a temporary repository: the new base descends
#    from the old base, the candidate from the new base, no merge commits; git range-diff
#    of <old base>..<old main> against <new base>..<candidate>; the new workflow paths;
#    the guard of the current main (the remote main, = the old main) with the expected
#    base. Dropped or changed layer commits are refused unless named exactly with the
#    --accept-* flags (commits: the old main's commit, 7 or more hex digits); a commit
#    whose change is identical and only its surrounding code moved is not "changed"
#    (split_changed in common.sh). A release that adds or renames workflow files is
#    refused: SYNC.md, "New upstream workflow files".
# 4. Prints what it will push and asks (--yes skips the question), rechecks step 2
#    immediately before pushing, then makes one atomic push: main with
#    --force-with-lease=refs/heads/main:<recorded old main> (a literal SHA), tag v<base> at
#    upstream's commit, tag v<base>-pmx.1 at the candidate.
# 5. Waits until the provimux-ui-release run for v<base>-pmx.1 at the candidate has
#    finished successfully (build, prerelease, the checks of the published file in a
#    browser, promotion to the latest release) and the release is complete, prints the
#    run's conclusion and jobs, then closes the "sync: v<base>" issue.
#
#   --dry-run    everything except the push (shows git push --dry-run), no wait, no close
#   --expect-main <sha>  refuse unless the remote main, the check run's head_sha and the
#                push lease are all exactly this commit
#   --ci         for provimux-ui-publish.yml (SYNC.md, "Publishing automatically"). It never
#                sees the push token: it refuses to run when PROVIMUX_TOKEN or
#                PMX_PUSH_TOKEN is in its environment. Two halves around the workflow's
#                own push step:
#                --plan <dir>  steps 1 to 4 without the question and without the push
#                              (needs --run, --attempt, --artifact and --expect-main, the
#                              values the workflow's verifier proved): leaves
#                              <dir>/plan.env and the verified repository
#                              <dir>/work/repo.git for the push
#                --wait <dir>  step 5 for the plan in <dir>, after the workflow pushed it
#                Without --ci nothing changes: the owner's own git and gh credentials.
#
# Run it from a clone of ngvoicu/provimux-ui (any branch, nothing is checked out or changed:
# the work happens in a temporary repository that borrows this clone's objects).
# Needs bash 3.2+, git, gh (logged in as the owner), jq.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"

usage() { sed -n '2,62p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
die() { echo "publish: $*" >&2; exit 1; }
log() { echo "==> $*" >&2; }

tag='' dry_run=0 yes=0 ci=0 plan_dir='' wait_dir='' expect_main='' run_id='' attempt='' artifact_id='' remote='' accept_dropped='' accept_changed=''
timeout_min=120
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --yes) yes=1 ;;
    --ci) ci=1 ;;
    --plan) plan_dir="${2:?}"; shift ;;
    --wait) wait_dir="${2:?}"; shift ;;
    --expect-main) expect_main="${2:?}"; shift ;;
    --run) run_id="${2:?}"; shift ;;
    --attempt) attempt="${2:?}"; shift ;;
    --artifact) artifact_id="${2:?}"; shift ;;
    --remote) remote="${2:?}"; shift ;;
    --accept-dropped) accept_dropped="${2:?}"; shift ;;
    --accept-changed) accept_changed="${2:?}"; shift ;;
    --timeout) timeout_min="${2:?}"; shift ;;
    -h | --help) usage ;;
    v*) [[ -z "$tag" ]] || usage; tag="$1" ;;
    *) usage ;;
  esac
  shift
done
[[ "$tag" =~ $PMX_STABLE_RE ]] || usage
[[ -z "$run_id" || "$run_id" =~ ^[0-9]+$ ]] || die "--run takes a run id (digits)"
[[ -z "$attempt" || "$attempt" =~ ^[0-9]+$ ]] || die "--attempt takes a run attempt (digits)"
[[ -z "$artifact_id" || "$artifact_id" =~ ^[0-9]+$ ]] || die "--artifact takes an artifact id (digits)"
[[ -z "$attempt$artifact_id" || -n "$run_id" ]] || die "--attempt and --artifact need --run"
base="${tag#v}"
pmx_tag="v$base-pmx.1"

[[ -z "$expect_main" || "$expect_main" =~ $PMX_SHA_RE ]] || die "--expect-main takes a full commit SHA"

# --- CI: never the token; plan or wait -------------------------------------------------
if [[ $ci -eq 1 ]]; then
  [[ -z "${PROVIMUX_TOKEN:-}" && -z "${PMX_PUSH_TOKEN:-}" ]] ||
    die "--ci: a push token is in the environment; publish.sh must never see it (only the workflow's push step has it)"
  [[ -n "$plan_dir" || -n "$wait_dir" ]] && [[ -z "$plan_dir" || -z "$wait_dir" ]] ||
    die "--ci needs exactly one of --plan <dir> or --wait <dir>"
  if [[ -n "$plan_dir" ]]; then
    [[ -n "$run_id" && -n "$attempt" && -n "$artifact_id" && -n "$expect_main" ]] ||
      die "--ci --plan needs --run, --attempt, --artifact and --expect-main"
  fi
  export GIT_TERMINAL_PROMPT=0
elif [[ -n "$plan_dir$wait_dir" ]]; then
  die "--plan and --wait are for --ci"
fi

# --- 5. wait for the whole release run, then close the issue ---------------------------------
# Done means: the provimux-ui-release run for the tag finished successfully (every job:
# build, publish, smoke, promote) and the GitHub release is complete (promoted, both
# assets); only a run for the candidate commit counts.
wait_and_close() {
  local deadline s run_state run run_url url n
  log "waiting for the provimux-ui-release run of $pmx_tag and its release (up to $timeout_min minutes)"
  deadline=$(( $(date +%s) + timeout_min * 60 ))
  while :; do
    s="$(release_state "$pmx_tag")"
    run_state="$(release_run_state "$pmx_tag" "$candidate")"
    log "release: $s; release run: $run_state"
    case "$run_state" in
      success) break ;;
      failure:*) break ;;
    esac
    [[ $(date +%s) -lt $deadline ]] || die "timed out waiting for the release run of $pmx_tag (last: run $run_state, release $s); the issue stays open. Check it later (SYNC.md: \"Check a release\")."
    sleep 30
  done
  run="$(release_run_id "$pmx_tag" "$candidate")"
  run_url="https://github.com/$PMX_REPO/actions/runs/$run"
  echo
  echo "provimux-ui-release run $run_url: ${run_state#failure:}"
  [[ -n "$run" ]] && gh api "repos/$PMX_REPO/actions/runs/$run/jobs?per_page=100" \
    --jq '.jobs[] | "  \(.conclusion // .status)\t\(.name)"' || true
  if [[ "$run_state" != success ]]; then
    release_run_errors "$run" | sed 's/^/publish: release run: /' >&2
    die "the provimux-ui-release run for $pmx_tag ended ${run_state#failure:}; the issue stays open (SYNC.md: \"Check a release\")"
  fi
  s="$(release_state "$pmx_tag")"
  [[ "$s" == complete ]] || die "the release run succeeded but the release $pmx_tag is $s; the issue stays open"
  url="https://github.com/$PMX_REPO/releases/tag/$pmx_tag"
  echo "Published: $url"
  for n in $(sync_issues "$base"); do
    gh issue close "$n" -R "$PMX_REPO" --comment "Published $url (main ${old_main:0:12} -> ${candidate:0:12}): the provimux-ui-release run succeeded (the published file checked and loaded in a browser, then promoted to the latest release): $run_url" >/dev/null
    echo "Closed issue #$n"
  done
}

# plan_get FILE KEY PATTERN: the value of KEY in the plan file, checked against PATTERN.
plan_get() {
  local v
  v="$(sed -n "s/^$2=//p" "$1" | head -n 1)"
  [[ "$v" =~ $3 ]] || die "plan: $2 is '$v'"
  echo "$v"
}
if [[ -n "$wait_dir" ]]; then
  plan="$wait_dir/plan.env"
  [[ -s "$plan" ]] || die "no plan in $wait_dir"
  [[ "$(plan_get "$plan" TAG "$PMX_STABLE_RE")" == "$tag" ]] || die "the plan is for another tag"
  pmx_tag="$(plan_get "$plan" PMX_TAG '^v[0-9]+\.[0-9]+\.[0-9]+-pmx\.1$')"
  candidate="$(plan_get "$plan" CANDIDATE "$PMX_SHA_RE")"
  old_main="$(plan_get "$plan" OLD_MAIN "$PMX_SHA_RE")"
  wait_and_close
  exit 0
fi

# --- where to push --------------------------------------------------------------------
git rev-parse --git-dir >/dev/null 2>&1 || die "run it inside a clone of $PMX_REPO"
if [[ -z "$remote" ]]; then
  remote="$(git remote -v | awk -v r="$PMX_REPO" '$3 == "(push)" && ($2 ~ ("github.com[:/]" r "(\\.git)?$")) {print $1; exit}')"
  [[ -n "$remote" ]] || die "no remote of this clone points at $PMX_REPO; pass --remote"
fi
push_url="$(git remote get-url --push "$remote")"
log "remote $remote ($push_url)"

if [[ -n "$plan_dir" ]]; then
  # Kept for the workflow's push step: the verified repository and the plan.
  [[ ! -e "$plan_dir" ]] || die "--plan: $plan_dir exists already"
  mkdir -p "$plan_dir/work"
  work="$(cd "$plan_dir/work" && pwd)"
else
  work="$(mktemp -d "${TMPDIR:-/tmp}/provimux-publish.XXXXXX")"
  trap 'rm -rf "${work:?}"' EXIT
fi

remote_main="$(git ls-remote "$push_url" refs/heads/main | awk '{print $1}')"
[[ "$remote_main" =~ $PMX_SHA_RE ]] || die "cannot read main of $push_url"
[[ -z "$expect_main" || "$remote_main" == "$expect_main" ]] ||
  die "the remote main is $remote_main, not the expected $expect_main"

# --- 1. the check run and its artifact -------------------------------------------------------
# check_run ID [ATTEMPT]: "<head_sha> <attempt>" when ID (its latest attempt, or exactly
# ATTEMPT) is a successful provimux-ui-check run of PMX_REPO on main (schedule or
# workflow_dispatch); fails otherwise. Success, head_sha and attempt come from one read.
check_run() {
  local path="repos/$PMX_REPO/actions/runs/$1"
  [[ -z "${2:-}" ]] || path="$path/attempts/$2"
  gh api "$path" >"$work/run-$1.json" 2>/dev/null || return 1
  jq -er --arg repo "$PMX_REPO" --arg att "${2:-}" "$PMX_CHECK_RUN_OK"'
    | select(($att == "" or (.run_attempt | tostring) == $att) and (.run_attempt | tostring | test("^[0-9]+$")))
    | "\(.head_sha) \(.run_attempt)"' "$work/run-$1.json"
}
if [[ -n "$run_id" ]]; then
  ra="$(check_run "$run_id" "$attempt")" ||
    die "run $run_id${attempt:+ attempt $attempt} is not a successful provimux-ui-check run of $PMX_REPO on main"
  run_sha="${ra%% *}" attempt="${ra#* }"
  [[ "$run_sha" == "$remote_main" ]] ||
    die "run $run_id checked main $run_sha, but the remote main is $remote_main; run the check again"
  bound="$(check_artifact "$run_id" "$attempt" "$work/artifact" 2>"$work/artifact.err")" ||
    die "run $run_id: $(cat "$work/artifact.err")"
  [[ -z "$artifact_id" || "${bound%% *}" == "$artifact_id" ]] ||
    die "run $run_id attempt $attempt binds artifact ${bound%% *}, not the verified $artifact_id"
else
  # The newest qualifying run on the current main whose verdict artifact is for this tag.
  for id in $(gh api "repos/$PMX_REPO/actions/workflows/provimux-ui-check.yml/runs?branch=main&head_sha=$remote_main&status=success&per_page=50" \
    --jq '.workflow_runs | sort_by(.created_at) | reverse | .[].id'); do
    ra="$(check_run "$id")" || continue
    run_sha="${ra%% *}" attempt="${ra#* }"
    [[ "$run_sha" == "$remote_main" ]] || continue
    rm -rf "$work/artifact"
    bound="$(check_artifact "$id" "$attempt" "$work/artifact" 2>/dev/null)" || continue
    if [[ "${bound#* }" == "provimux-ui-check-$tag" ]]; then run_id="$id"; break; fi
  done
  [[ -n "$run_id" ]] || die "no successful provimux-ui-check run on main for the current main ${remote_main:0:12} has a verdict artifact provimux-ui-check-$tag; run the check first (Actions → provimux-ui-check)"
fi
[[ "${bound#* }" == "provimux-ui-check-$tag" ]] || die "run $run_id's verdict artifact is ${bound#* }, not provimux-ui-check-$tag"
log "check run https://github.com/$PMX_REPO/actions/runs/$run_id attempt $attempt (main $run_sha), verdict artifact ${bound%% *}"
res="$work/artifact/result.json"
bundle="$work/artifact/candidate.bundle"
[[ -s "$res" ]] || die "the artifact has no result.json"
# r PATH: the field as text ("" when null or missing; false stays "false").
r() { jq -r "$1 | if . == null then \"\" else tostring end" "$res"; }
[[ "$(r .status)" == pass ]] || die "the check's result is '$(r .status)', not pass: $(jq -r '.reasons | join("; ")' "$res")"
[[ -s "$bundle" ]] || die "the artifact has no candidate.bundle"
[[ "$(r .upstream.tag)" == "$tag" ]] || die "the artifact is for '$(r .upstream.tag)', not $tag"
[[ "$(r .tests.ok)" == true && "$(r .guard.ok)" == true ]] ||
  die "result.json says pass but verify/guard are not both ok"
upstream_commit="$(r .upstream.commit)"
old_main="$(r .old.main)"
old_base_tag="$(r .old.base_tag)"
old_base_commit="$(r .old.base_commit)"
candidate="$(r .candidate)"
for v in upstream_commit old_main old_base_commit candidate; do
  [[ "${!v}" =~ $PMX_SHA_RE ]] || die "result.json: $v is not a commit SHA"
done
[[ "$old_base_tag" =~ $PMX_STABLE_RE ]] || die "result.json: old base tag '$old_base_tag'"
[[ "$old_main" == "$run_sha" ]] || die "result.json's old main $old_main is not the check run's head_sha $run_sha"

# --- 2. the world still matches what was checked (again right before the push) ----------------
remote_base_tag=''
recheck() {
  local s up_tags remote_refs existing_pmx rm
  s="$(upstream_release_state "$tag")"
  [[ "$s" == stable ]] || die "$tag is now '$s' in $PMX_UPSTREAM_REPO, not a stable release"
  up_tags="$(git ls-remote --tags "$PMX_UPSTREAM_URL")" || die "cannot list the tags of $PMX_UPSTREAM_URL"
  [[ "$(ls_remote_tag "$up_tags" "$tag")" == "$upstream_commit" ]] ||
    die "upstream's $tag is now '$(ls_remote_tag "$up_tags" "$tag")', the check used $upstream_commit"
  [[ "$(ls_remote_tag "$up_tags" "$old_base_tag")" == "$old_base_commit" ]] ||
    die "upstream's $old_base_tag is not $old_base_commit"
  remote_refs="$(git ls-remote "$push_url" refs/heads/main "refs/tags/$tag" "refs/tags/$tag^{}" "refs/tags/v$base-pmx.*")" ||
    die "cannot read $push_url"
  rm="$(awk '$2 == "refs/heads/main" {print $1}' <<<"$remote_refs")"
  [[ "$rm" == "$old_main" ]] || die "the remote main is $rm, but the check rebased $old_main; run the check again"
  existing_pmx="$(awk '{print $2}' <<<"$remote_refs" | grep -E "^refs/tags/v$base-pmx\." | sed 's|^refs/tags/||; s/\^{}$//' | sort -u | paste -sd ' ' - || true)"
  [[ -z "$existing_pmx" ]] || die "$existing_pmx already exists on $remote; a -pmx.2 on the same base is cut by hand (SYNC.md)"
  remote_base_tag="$(ls_remote_tag "$remote_refs" "$tag")"
  [[ -z "$remote_base_tag" || "$remote_base_tag" == "$upstream_commit" ]] ||
    die "$remote already has $tag at $remote_base_tag, upstream's is $upstream_commit"
}
recheck

# --- 3. verify the candidate here -----------------------------------------------------------
repo="$work/repo.git"
git init -q --bare "$repo"
objects="$(cd "$(git rev-parse --git-common-dir)" && pwd)/objects"
echo "$objects" >"$repo/objects/info/alternates"
g() { git --git-dir="$repo" "$@"; }
g fetch -q --no-tags "$push_url" "+refs/heads/main:refs/pmx/remote-main"
g fetch -q --no-tags "$PMX_UPSTREAM_URL" "+refs/tags/$tag:refs/pmx/upstream" "+refs/tags/$old_base_tag:refs/pmx/old-base"
[[ "$(g rev-parse "refs/pmx/upstream^{commit}")" == "$upstream_commit" ]] || die "fetched $tag is not $upstream_commit"
[[ "$(g rev-parse "refs/pmx/old-base^{commit}")" == "$old_base_commit" ]] || die "fetched $old_base_tag is not $old_base_commit"
g cat-file -e "$old_main^{commit}" 2>/dev/null || g fetch -q --no-tags "$push_url" "$old_main" ||
  die "cannot get the old main $old_main"
g bundle verify -q "$bundle" >/dev/null 2>&1 || die "the bundle does not verify against $tag"
heads="$(g bundle list-heads "$bundle")"
[[ "$(wc -l <<<"$heads" | tr -d ' ')" == 1 ]] || die "the bundle has more than one head"
[[ "$(awk '{print $1}' <<<"$heads")" == "$candidate" ]] || die "the bundle's tip is not result.json's candidate $candidate"
g fetch -q "$bundle" "+$(awk '{print $2}' <<<"$heads"):refs/pmx/candidate"
[[ "$(g rev-parse refs/pmx/candidate)" == "$candidate" ]] || die "the fetched candidate is not $candidate"

g merge-base --is-ancestor "$old_base_commit" "$old_main" || die "$old_base_tag is not an ancestor of the old main"
g merge-base --is-ancestor "$old_base_commit" "$upstream_commit" || die "$tag does not descend from the old base $old_base_tag"
g merge-base --is-ancestor "$upstream_commit" "$candidate" || die "the candidate is not built on $tag"
[[ -z "$(g rev-list --merges "$upstream_commit..$candidate")" ]] || die "the candidate has merge commits above $tag"

g range-diff --no-color --no-notes "$old_base_commit..$old_main" "$upstream_commit..$candidate" >"$work/range-diff.txt"
range_diff_lists "$work/range-diff.txt" "$work" git --git-dir="$repo"
[[ ! -s "$work/added" ]] && [[ -n "$(cat "$work/range-diff.txt")" ]] || die "the range-diff is empty or has commits not in the old main: see $work/range-diff.txt"
g ls-tree -r --name-only "$old_base_commit" -- .github/workflows/ | sort >"$work/wf-old"
g ls-tree -r --name-only "$upstream_commit" -- .github/workflows/ | sort >"$work/wf-tag"
comm -13 "$work/wf-old" "$work/wf-tag" >"$work/wf-new"

# The check's lists must agree with what was computed here.
same() { diff <(cut -f1 "$1" | sort) <(jq -r "$2" "$res" | sort) >/dev/null; }
same "$work/dropped" '.decisions.dropped[].commit' || die "result.json's dropped commits differ from this range-diff"
same "$work/changed" '.decisions.changed[].commit' || die "result.json's changed commits differ from this range-diff"
same "$work/context" '.context_only[].commit' || die "result.json's context-only commits differ from this range-diff"
same "$work/wf-new" '.decisions.new_workflows[]' || die "result.json's new workflow paths differ from this comparison"

# Guard: the copy on the current main (the remote main, checked to be the old main and
# the check run's head_sha), on the candidate, with the exact base. Never the candidate's
# or the artifact's copy.
# On git objects only: nothing of the candidate is checked out (no checkout filters, no
# hooks); the guard runs against a bare repository whose HEAD is the candidate.
g show "$remote_main:.github/provimux/guard.sh" >"$work/guard.sh"
gr="$work/guard.git"
git init -q --bare "$gr"
(cd "$repo/objects" && pwd) >"$gr/objects/info/alternates"
git --git-dir="$gr" update-ref --no-deref HEAD "$candidate"
if ! (cd "$work" && GIT_DIR="$gr" PMX_UPSTREAM="$PMX_UPSTREAM_URL" PMX_EXPECT_BASE="$tag" PMX_EXPECT_BASE_COMMIT="$upstream_commit" \
  bash "$work/guard.sh") >"$work/guard.log" 2>&1; then
  cat "$work/guard.log" >&2
  die "the guard rejects the candidate"
fi
guard_ok="$(tail -n 1 "$work/guard.log")"

# --- the owner's decisions ------------------------------------------------------------------
refused=0
# accepted LIST-FILE ACCEPT-CSV NAME KIND: every entry named, and every name an entry.
accepted() {
  local file=$1 csv=$2 flag=$3 kind=$4 item name hit
  local names
  names="$(tr ',' '\n' <<<"$csv" | sed '/^$/d')"
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    hit=0
    while IFS=$'\t' read -r item _; do
      [[ -n "$item" ]] || continue
      if [[ "$kind" == commit ]]; then
        [[ ${#name} -ge 7 && "$item" == "$name"* ]] && hit=1
      else
        [[ "$item" == "$name" ]] && hit=1
      fi
    done <"$file"
    [[ $hit -eq 1 ]] || { echo "publish: $flag names '$name', which is not in the list below" >&2; refused=1; }
  done <<<"$names"
  while IFS=$'\t' read -r item rest; do
    [[ -n "$item" ]] || continue
    hit=0
    while IFS= read -r name; do
      [[ -z "$name" ]] && continue
      if [[ "$kind" == commit ]]; then
        [[ ${#name} -ge 7 && "$item" == "$name"* ]] && hit=1
      else
        [[ "$item" == "$name" ]] && hit=1
      fi
    done <<<"$names"
    [[ $hit -eq 1 ]] || { echo "publish: not accepted ($flag): $item ${rest:-}" >&2; refused=1; }
  done <"$file"
}
accepted "$work/dropped" "$accept_dropped" --accept-dropped commit
accepted "$work/changed" "$accept_changed" --accept-changed commit
if [[ -s "$work/wf-new" ]]; then
  echo "publish: $tag adds or renames workflow files (below); publish.sh does not publish such a release: follow \"New upstream workflow files\" in SYNC.md" >&2
  refused=1
fi

# --- 4. the plan ---------------------------------------------------------------------------------
n_same="$(grep -cE '^ *[0-9]+: +[0-9a-f]+ = ' "$work/range-diff.txt" || true)"
cat <<EOF

provimux-ui publish: upstream console $tag ($upstream_commit)
  check run       https://github.com/$PMX_REPO/actions/runs/$run_id
  old main        $old_main (on $old_base_tag)
  candidate       $candidate ($(g rev-list --count "$upstream_commit..$candidate") commits on $tag)
  range-diff      $n_same unchanged, $(wc -l <"$work/context" | tr -d ' ') moved context only, $(wc -l <"$work/changed" | tr -d ' ') changed, $(wc -l <"$work/dropped" | tr -d ' ') dropped
  new workflows   $(wc -l <"$work/wf-new" | tr -d ' ')
  guard (here)    $guard_ok
  verify (check)  candidate passes; pristine $tag: $(jq -r '.tests.tag | if .install == 0 and .verify == 0 then "passes" else "fails (install \(.install), verify \(.verify))" end' "$res")
EOF
for f in dropped changed; do
  if [[ -s "$work/$f" ]]; then echo "  $f:"; sed 's/^/    /' "$work/$f"; fi
done
[[ -s "$work/wf-new" ]] && { echo "  new workflow files:"; sed 's/^/    /' "$work/wf-new"; }
if [[ -s "$work/changed" ]]; then
  echo
  echo "range-diff of the changed patches:"
  sed -n '/^ *[0-9]*: *[0-9a-f]* ! /,/^ *[0-9-]*: *[0-9a-f-]* [=<>] /p' "$work/range-diff.txt" | sed 's/^/  /'
fi
[[ $refused -eq 0 ]] || die "refused: accept each item above by name (SYNC.md), or fix the stack"

# The upstream tag is pushed only when the remote does not have it yet (same commit checked above).
push_refs() {
  refs=("$candidate:refs/heads/main")
  [[ -z "$remote_base_tag" ]] && refs+=("$upstream_commit:refs/tags/$tag")
  refs+=("$candidate:refs/tags/$pmx_tag")
}
push_refs
pushargs=(--atomic --porcelain "--force-with-lease=refs/heads/main:$old_main")

echo
echo "Push to $push_url (one atomic push):"
echo "  git push ${pushargs[*]} $push_url ${refs[*]}"
for x in "${refs[@]}"; do echo "    ${x%%:*} -> ${x#*:}"; done
echo

if [[ -n "$plan_dir" ]]; then
  # The workflow pushes exactly this, in its own step, with the lease on the expected main.
  recheck
  [[ "$old_main" == "$expect_main" ]] || die "the lease would be $old_main, not the expected main $expect_main"
  {
    echo "TAG=$tag"
    echo "PMX_TAG=$pmx_tag"
    echo "OLD_MAIN=$old_main"
    echo "CANDIDATE=$candidate"
    echo "UPSTREAM_COMMIT=$upstream_commit"
    echo "PUSH_BASE_TAG=$([[ -z "$remote_base_tag" ]] && echo 1 || echo 0)"
    echo "REPO=$repo"
    echo "RUN=$run_id"
    echo "ATTEMPT=$attempt"
    echo "ARTIFACT=${bound%% *}"
  } >"$plan_dir/plan.env"
  echo "Plan written: $plan_dir/plan.env (nothing pushed)."
  exit 0
fi

if [[ $dry_run -eq 1 ]]; then
  recheck
  log "dry run: git push --dry-run"
  g push --dry-run "${pushargs[@]}" "$push_url" "${refs[@]}" || die "git push --dry-run failed"
  echo
  echo "Dry run: nothing was pushed."
  exit 0
fi

if [[ $yes -eq 0 ]]; then
  printf 'Push this? Type "publish %s": ' "$tag" >/dev/tty
  read -r answer </dev/tty
  [[ "$answer" == "publish $tag" ]] || die "not confirmed; nothing pushed"
fi
# The world may have moved while the owner read the plan: check it again, right before the push.
log "rechecking upstream's $tag and the remote before pushing"
recheck
push_refs
g push "${pushargs[@]}" "$push_url" "${refs[@]}" || die "the push failed; nothing was changed on $remote (atomic)"
echo "Pushed."

wait_and_close

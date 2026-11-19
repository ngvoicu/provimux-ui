# shellcheck shell=bash
# Shared by check.sh, report.sh, publish.sh and autopublish.sh (.github/provimux/SYNC.md).
# Sourced, not run. Needs git, jq, and gh (authenticated, read access at least) for the
# API helpers. Adapted from Provimux's .github/provimux/common.sh.

PMX_UPSTREAM_REPO="${PMX_UPSTREAM_REPO:-router-for-me/Cli-Proxy-API-Management-Center}"
PMX_UPSTREAM_URL="${PMX_UPSTREAM_URL:-https://github.com/$PMX_UPSTREAM_REPO}"
PMX_REPO="${PMX_REPO:-ngvoicu/provimux-ui}"
PMX_REPO_URL="${PMX_REPO_URL:-https://github.com/$PMX_REPO}"
PMX_STABLE_RE='^v[0-9]+\.[0-9]+\.[0-9]+$'
# shellcheck disable=SC2034 # used by the scripts that source this file
PMX_SHA_RE='^[0-9a-f]{40}$'

# ls_remote_tag LS-REMOTE-OUTPUT TAG: the commit TAG points to (peeled when annotated), or "".
ls_remote_tag() {
  local peeled plain
  peeled="$(awk -v r="refs/tags/$2^{}" '$2==r {print $1}' <<<"$1")"
  plain="$(awk -v r="refs/tags/$2" '$2==r {print $1}' <<<"$1")"
  echo "${peeled:-$plain}"
}

# upstream_release_state TAG: stable | prerelease | draft | missing | error:<message>.
# Only "stable" (a published release, neither draft nor prerelease) may be synced to.
upstream_release_state() {
  local json
  if ! json="$(gh api "repos/$PMX_UPSTREAM_REPO/releases/tags/$1" 2>&1)"; then
    case "$json" in
      *"Not Found"* | *"HTTP 404"*) echo missing ;;
      *) echo "error:$(head -n 1 <<<"$json")" ;;
    esac
    return 0
  fi
  jq -r 'if .draft then "draft" elif .prerelease then "prerelease"
         elif (.published_at // "") == "" then "draft" else "stable" end' <<<"$json"
}

# newest_stable_release: the highest vX.Y.Z among upstream's published, non-draft,
# non-prerelease releases (not "releases/latest", which upstream can point anywhere).
newest_stable_release() {
  gh api "repos/$PMX_UPSTREAM_REPO/releases?per_page=100" \
    --jq '.[] | select((.draft | not) and (.prerelease | not) and ((.published_at // "") != "")) | .tag_name' |
    grep -E "$PMX_STABLE_RE" | sort -V | tail -n 1
}

# The files provimux-ui-release.yml publishes.
expected_assets() { printf '%s\n' checksums.txt management.html; }

# A provimux-ui-check run (actions/runs/<id>[/attempts/<n>] JSON, --arg repo PMX_REPO)
# that publish.sh accepts: of this repository, on main, event schedule or
# workflow_dispatch, completed with conclusion success, with a commit SHA.
# shellcheck disable=SC2034,SC2016 # used by publish.sh; jq, not shell
PMX_CHECK_RUN_OK='select(.path == ".github/workflows/provimux-ui-check.yml" and .head_branch == "main"
   and (.event == "schedule" or .event == "workflow_dispatch")
   and .status == "completed" and .conclusion == "success"
   and .repository.full_name == $repo and .head_repository.full_name == $repo
   and (.head_sha | test("^[0-9a-f]{40}$")))'

# check_artifact RUN ATTEMPT DIR: the artifact provimux-ui-check-<tag> that the verdict
# job of attempt ATTEMPT of RUN uploaded, downloaded and unpacked into DIR; prints
# "<artifact id> <name>". The attempt is given, never looked up here.
# The binding: the verdict job (it runs no repository code) writes the id, name and digest
# of its own upload as its only annotation titled "provimux-ui-check-artifact"; the test
# jobs, which run upstream's and the candidate's code, can upload artifacts of any name in
# the same run but cannot annotate the verdict job. The artifact must be that id, of RUN,
# with that name (and digest when both are known), unexpired. Fails (status 1, the reason
# on stderr) otherwise. Needs gh with actions: read and checks: read, and unzip.
check_artifact() {
  local run=$1 attempt=$2 dir=$3 job ann id name digest meta
  [[ "$run" =~ ^[0-9]+$ && "$attempt" =~ ^[0-9]+$ ]] || { echo "check_artifact: run '$run' attempt '$attempt'" >&2; return 1; }
  job="$(gh api "repos/$PMX_REPO/actions/runs/$run/attempts/$attempt/jobs?per_page=100" \
    --jq '[.jobs[] | select(.name == "verdict")] | if length == 1 then .[0].id else "" end')" ||
    { echo "cannot list the jobs of run $run attempt $attempt" >&2; return 1; }
  [[ "$job" =~ ^[0-9]+$ ]] || { echo "run $run attempt $attempt has no single job \"verdict\"" >&2; return 1; }
  ann="$(gh api "repos/$PMX_REPO/check-runs/$job/annotations?per_page=100" \
    --jq '[.[] | select(.title == "provimux-ui-check-artifact") | .message] | if length == 1 then .[0] else "" end')" ||
    { echo "cannot read the annotations of the verdict job $job" >&2; return 1; }
  read -r id name digest _ <<<"$ann" || true
  [[ "$id" =~ ^[0-9]+$ && "$name" =~ ^provimux-ui-check-(none|v[0-9]+\.[0-9]+\.[0-9]+)$ ]] ||
    { echo "the verdict job $job of run $run attempt $attempt names no artifact (one annotation \"provimux-ui-check-artifact\": <id> <name> [digest])" >&2; return 1; }
  meta="$(gh api "repos/$PMX_REPO/actions/artifacts/$id")" || { echo "cannot read artifact $id" >&2; return 1; }
  jq -e --arg run "$run" --arg name "$name" --arg digest "${digest:-}" \
    '(.workflow_run.id | tostring) == $run and .name == $name and (.expired | not)
     and ($digest == "" or (.digest // "") == "" or .digest == $digest)' <<<"$meta" >/dev/null ||
    { echo "artifact $id is not the verdict's $name of run $run (or it expired)" >&2; return 1; }
  mkdir -p "$dir"
  gh api "repos/$PMX_REPO/actions/artifacts/$id/zip" >"$dir/.artifact.zip" || { echo "cannot download artifact $id" >&2; return 1; }
  unzip -q -o "$dir/.artifact.zip" -d "$dir" || { echo "artifact $id is not a zip" >&2; return 1; }
  rm -f "$dir/.artifact.zip"
  echo "$id $name"
}

# runs_json TAG: the newest push runs of TAG in PMX_REPO. Retried without a token when the
# job's token may not read actions (the repository is public).
runs_json() {
  gh api "repos/$PMX_REPO/actions/runs?event=push&branch=$1&per_page=50" 2>/dev/null ||
    curl -fsSL -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/$PMX_REPO/actions/runs?event=push&branch=$1&per_page=50" 2>/dev/null
}
# The provimux-ui-release runs of PMX_REPO for the push of tag $tag at commit $sha, newest last.
# shellcheck disable=SC2016 # jq, not shell
PMX_RELEASE_RUNS='[.workflow_runs[] | select(.path == ".github/workflows/provimux-ui-release.yml"
   and .event == "push" and .head_branch == $tag and .head_sha == $sha
   and .repository.full_name == $repo)] | sort_by(.created_at)'

# release_run_state TAG SHA: the newest provimux-ui-release run for the push of TAG at
# commit SHA (a run for another commit does not count):
# running | success | failure:<conclusion> | none | unknown.
release_run_state() {
  local s json
  json="$(runs_json "$1")" || { echo unknown; return 0; }
  s="$(jq -r --arg tag "$1" --arg sha "$2" --arg repo "$PMX_REPO" "$PMX_RELEASE_RUNS"' | last
        | if . == null then "none" else "\(.status) \(.conclusion // "")" end' <<<"$json")" ||
    { echo unknown; return 0; }
  case "$s" in
    none) echo none ;;
    "completed success") echo success ;;
    completed*) echo "failure:${s#completed }" ;;
    *) echo running ;;
  esac
}

# release_run_id TAG SHA: the id of that run, or "".
release_run_id() {
  local json
  json="$(runs_json "$1")" || return 0
  jq -r --arg tag "$1" --arg sha "$2" --arg repo "$PMX_REPO" "$PMX_RELEASE_RUNS"' | last | .id // empty' <<<"$json" || true
}

# release_run_errors RUN: the error annotations of RUN's failed jobs, "<job>: <message>",
# one per line (at most 10): why a release stayed a prerelease (the smoke or promote job
# says why in an ::error). Empty when there are none or they cannot be read.
release_run_errors() {
  local job name
  [[ "$1" =~ ^[0-9]+$ ]] || return 0
  gh api "repos/$PMX_REPO/actions/runs/$1/jobs?per_page=100" \
    --jq '.jobs[] | select(.conclusion == "failure") | "\(.id)\t\(.name)"' 2>/dev/null |
    while IFS=$'\t' read -r job name; do
      gh api "repos/$PMX_REPO/check-runs/$job/annotations?per_page=50" \
        --jq ".[] | select(.annotation_level == \"failure\") | \"$name: \" + (.message | gsub(\"\\n\"; \" \"))" 2>/dev/null || true
    done | grep -v 'Process completed with exit code' | head -n 10 || true
}

# release_state TAG (v<base>-pmx.<n>): complete | missing | draft | prerelease |
# partial:<missing files> | error:<message>. Complete = a published GitHub release that
# is not a draft and no longer a prerelease (the release workflow's promote job made it
# the latest after its checks), with every expected asset uploaded.
release_state() {
  local json have missing='' f
  if ! json="$(gh api "repos/$PMX_REPO/releases/tags/$1" 2>&1)"; then
    case "$json" in *"Not Found"* | *"HTTP 404"*) echo missing; return 0 ;; esac
    echo "error:$(head -n 1 <<<"$json")"; return 0
  fi
  [[ "$(jq -r '.draft' <<<"$json")" == "false" ]] || { echo draft; return 0; }
  [[ "$(jq -r '.published_at // ""' <<<"$json")" != "" ]] || { echo draft; return 0; }
  [[ "$(jq -r '.prerelease' <<<"$json")" == "false" ]] || { echo prerelease; return 0; }
  have="$(jq -r '.assets[] | select(.state == "uploaded") | .name' <<<"$json")"
  while IFS= read -r f; do
    grep -qxF "$f" <<<"$have" || missing="$missing $f"
  done < <(expected_assets)
  if [[ -n "$missing" ]]; then echo "partial:${missing# }"; else echo complete; fi
}

# sync_issues BASE: numbers of the open issues "sync: v<BASE>" or "sync: v<BASE> — ...", oldest first.
sync_issues() {
  gh api --paginate "repos/$PMX_REPO/issues?state=open&per_page=100" \
    --jq ".[] | select(.pull_request == null) | select(.title == \"sync: v$1\" or (.title | startswith(\"sync: v$1 \"))) | .number" |
    sort -n
}

# releases_status BASE JSON REASONS: whether every v<BASE>-pmx.* tag of PMX_REPO is
# released. Prints none | published | in-progress | incomplete | error; writes the
# per-tag states to the file JSON ([{tag, sha, release, run}]) and appends reasons to the
# file REASONS (with the failed release run's errors). Published = for every such tag the
# GitHub release is complete (release_state: promoted, all assets) and the newest
# provimux-ui-release run for the tag AT THE TAG'S COMMIT succeeded.
releases_status() {
  local base=$1 json=$2 rfile=$3 refs tags t sha s run st=published rid
  if ! refs="$(git ls-remote --tags "$PMX_REPO_URL" "refs/tags/v$base-pmx.*")"; then
    echo '[]' >"$json"; echo "cannot list the tags of $PMX_REPO_URL" >>"$rfile"; echo error; return 0
  fi
  tags="$(awk '{print $2}' <<<"$refs" | sed 's|^refs/tags/||; s/\^{}$//' | sort -u -V)"
  if [[ -z "$tags" ]]; then echo '[]' >"$json"; echo none; return 0; fi
  : >"$json.tmp"
  for t in $tags; do
    sha="$(ls_remote_tag "$refs" "$t")"
    s="$(release_state "$t")"
    run="$(release_run_state "$t" "$sha")"
    jq -nc --arg tag "$t" --arg sha "$sha" --arg release "$s" --arg run "$run" \
      '{tag: $tag, sha: $sha, release: $release, run: $run}' >>"$json.tmp"
    if [[ "$s" != complete || "$run" != success ]]; then
      if [[ "$run" == running ]]; then
        [[ "$st" == incomplete ]] || st=in-progress
      else
        st=incomplete
        echo "tag $t (${sha:0:12}) exists but its release is $s and its release run for that commit is $run" >>"$rfile"
        rid="$(release_run_id "$t" "$sha")"
        [[ -z "$rid" ]] || release_run_errors "$rid" | sed "s/^/  $t /" >>"$rfile"
      fi
    fi
  done
  jq -s '.' "$json.tmp" >"$json"
  rm -f "$json.tmp"
  echo "$st"
}

# ver_ge A B: version A >= version B (vX.Y.Z).
ver_ge() { [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1)" == "$1" ]]; }

# upstream_base REV LS-REMOTE-OUTPUT: the base of REV, printed "<tag> <commit>": the newest
# vX.Y.Z tag of upstream (from LS-REMOTE-OUTPUT, upstream's own refs, not local tags) whose
# commit is an ancestor of REV. Fails (status 1, the reason on stderr) when there is none,
# or when a vX.Y.Z tag reachable from REV here, as new as that base or newer, is missing
# upstream (withdrawn) or points at another commit there (moved): never falls back.
# Same rule as guard.sh and release-meta.sh.
upstream_base() {
  local rev=$1 refs=$2 t c lc base='' base_commit=''
  while IFS= read -r t; do
    c="$(ls_remote_tag "$refs" "$t")"
    git cat-file -e "$c^{commit}" 2>/dev/null || continue
    if git merge-base --is-ancestor "$c" "$rev"; then base=$t base_commit=$c; break; fi
  done < <(awk '{print $2}' <<<"$refs" | sed 's|^refs/tags/||; s/\^{}$//' | grep -E "$PMX_STABLE_RE" | sort -u | sort -r -V)
  if [[ -z "$base" ]]; then
    echo "no vX.Y.Z tag of $PMX_UPSTREAM_REPO is an ancestor of $(git rev-parse --short "$rev")" >&2; return 1
  fi
  for t in $(git tag --merged "$rev" --list 'v*' | grep -E "$PMX_STABLE_RE" || true); do
    ver_ge "$t" "$base" || continue
    lc="$(git rev-parse "$t^{commit}")"
    c="$(ls_remote_tag "$refs" "$t")"
    if [[ -z "$c" ]]; then
      echo "tag $t (${lc:0:8}), reachable from $(git rev-parse --short "$rev"), is no longer a tag of $PMX_UPSTREAM_REPO (withdrawn); refusing to fall back to $base" >&2; return 1
    elif [[ "$c" != "$lc" ]]; then
      echo "tag $t is ${lc:0:8} here but ${c:0:8} in $PMX_UPSTREAM_REPO (moved); refusing to fall back to $base" >&2; return 1
    fi
  done
  echo "$base $base_commit"
}

# range_diff_lists RANGE-DIFF-FILE DIR GIT...: from git range-diff output, the old main's
# dropped (<) commits and the candidate's added (>) ones, as "<full sha>\t<subject>" lines
# in DIR/dropped and DIR/added, and the changed (!) pairs as "<old sha>\t<new sha>\t<subject>"
# in DIR/changed.pairs; then split_changed. GIT is the git command that resolves the short
# SHAs (e.g. git --git-dir=X).
range_diff_lists() {
  local file=$1 dir=$2 line p op a b subj
  shift 2
  : >"$dir/dropped"; : >"$dir/changed.pairs"; : >"$dir/added"
  while IFS= read -r line; do
    p="$(sed -E 's/^ *([0-9]+|-+): +([0-9a-f]+|-+) ([=!<>]) +([0-9]+|-+): +([0-9a-f]+|-+) (.*)$/\3	\2	\5	\6/' <<<"$line")"
    IFS=$'\t' read -r op a b subj <<<"$p"
    case "$op" in
      '<') printf '%s\t%s\n' "$("$@" rev-parse "$a^{commit}")" "$subj" >>"$dir/dropped" ;;
      '!') printf '%s\t%s\t%s\n' "$("$@" rev-parse "$a^{commit}")" "$("$@" rev-parse "$b^{commit}")" "$subj" >>"$dir/changed.pairs" ;;
      '>') printf '%s\t%s\n' "$("$@" rev-parse "$b^{commit}")" "$subj" >>"$dir/added" ;;
    esac
  done < <(grep -E '^ *([0-9]+|-+): +([0-9a-f]+|-+) [=!<>] +([0-9]+|-+): +([0-9a-f]+|-+) ' "$file" || true)
  split_changed "$dir" "$@"
}

# patch_lines GIT... -- COMMIT: COMMIT's own change without context: the -U0 patch with
# the hunk headers (line numbers) and index lines left out. Two commits with the same
# patch_lines make the same change; they differ at most in the code around it.
patch_lines() {
  local c="${*: -1}"
  set -- "${@:1:$#-2}"
  "$@" diff-tree -p -U0 --no-color --no-ext-diff --format= "$c" | grep -vE '^(@@ |index )' || true
}

# split_changed DIR GIT...: splits the changed pairs (DIR/changed.pairs) into DIR/changed
# (the change itself differs: the owner decides, publish.sh refuses it unless named) and
# DIR/context (only the code around the change differs, e.g. upstream edited lines next to
# a layer change: listed in the issue, accepted). Both "<old main's sha>\t<subject>".
split_changed() {
  local dir=$1 a b subj
  shift
  : >"$dir/changed"; : >"$dir/context"
  while IFS=$'\t' read -r a b subj; do
    [[ -n "$a" ]] || continue
    if [[ "$(patch_lines "$@" -- "$a")" == "$(patch_lines "$@" -- "$b")" ]]; then
      printf '%s\t%s\n' "$a" "$subj" >>"$dir/context"
    else
      printf '%s\t%s\n' "$a" "$subj" >>"$dir/changed"
    fi
  done <"$dir/changed.pairs"
}

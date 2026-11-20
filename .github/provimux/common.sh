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

# releases_status BASE JSON REASONS: whether v<BASE> is released, decided by its NEWEST
# v<BASE>-pmx.* tag (version order): published when that tag's GitHub release is complete
# (release_state: promoted, both assets) and its newest provimux-ui-release run AT THE
# TAG'S COMMIT succeeded; in-progress while that run runs; incomplete otherwise. Prints
# none | published | in-progress | incomplete | error. Writes every tag's state to the
# file JSON ([{tag, sha, release, run, newest}]) and appends to the file REASONS each
# failed tag with its release run's errors: for the newest tag as the reason, for an
# earlier one as "history: ..." (a failed .1 followed by a verified .2 is released, and
# the .1's failure stays on record).
releases_status() {
  local base=$1 json=$2 rfile=$3 refs tags t sha s run st='' rid newest prefix
  if ! refs="$(git ls-remote --tags "$PMX_REPO_URL" "refs/tags/v$base-pmx.*")"; then
    echo '[]' >"$json"; echo "cannot list the tags of $PMX_REPO_URL" >>"$rfile"; echo error; return 0
  fi
  tags="$(awk '{print $2}' <<<"$refs" | sed 's|^refs/tags/||; s/\^{}$//' | sort -u -V)"
  if [[ -z "$tags" ]]; then echo '[]' >"$json"; echo none; return 0; fi
  newest="$(tail -n 1 <<<"$tags")"
  : >"$json.tmp"
  for t in $tags; do
    sha="$(ls_remote_tag "$refs" "$t")"
    s="$(release_state "$t")"
    run="$(release_run_state "$t" "$sha")"
    jq -nc --arg tag "$t" --arg sha "$sha" --arg release "$s" --arg run "$run" --argjson newest "$([[ "$t" == "$newest" ]] && echo true || echo false)" \
      '{tag: $tag, sha: $sha, release: $release, run: $run, newest: $newest}' >>"$json.tmp"
    prefix=''
    [[ "$t" == "$newest" ]] || prefix='history: '
    if [[ "$s" == complete && "$run" == success ]]; then
      [[ "$t" != "$newest" ]] || st=published
    elif [[ "$run" == running ]]; then
      [[ "$t" != "$newest" ]] || st=in-progress
    else
      [[ "$t" != "$newest" ]] || st=incomplete
      echo "${prefix}tag $t (${sha:0:12}): its release is $s and its release run for that commit is $run" >>"$rfile"
      rid="$(release_run_id "$t" "$sha")"
      [[ -z "$rid" ]] || release_run_errors "$rid" | sed "s/^/  ${prefix}$t /" >>"$rfile"
    fi
  done
  jq -s '.' "$json.tmp" >"$json"
  rm -f "$json.tmp"
  echo "$st"
}

# unreleased_bases: the bases (X.Y.Z) whose newest v<base>-pmx.* tag has no complete
# release (release_state), one per line: what the report's sweep looks at, so that a
# failed tag on any base, pushed by the automatic publish or by hand, is reported. One
# API call for all releases, one ls-remote for all tags.
unreleased_bases() {
  local refs rel t base newest
  refs="$(git ls-remote --tags "$PMX_REPO_URL" 'refs/tags/v*-pmx.*')" || return 1
  rel="$(gh api --paginate "repos/$PMX_REPO/releases?per_page=100" \
    --jq '.[] | select((.draft | not) and (.prerelease | not) and ((.published_at // "") != "")
          and ([.assets[] | select(.state == "uploaded") | .name] | contains(["management.html", "checksums.txt"]))) | .tag_name')" || return 1
  # shellcheck disable=SC2013 # versions have no spaces
  for base in $(awk '{print $2}' <<<"$refs" | sed -E 's|^refs/tags/v||; s/\^\{\}$//; s/-pmx\..*$//' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -u -V); do
    newest="$(awk '{print $2}' <<<"$refs" | sed 's|^refs/tags/||; s/\^{}$//' | grep -E "^v${base//./\\.}-pmx\.[0-9]+$" | sort -u -V | tail -n 1)"
    [[ -n "$newest" ]] || continue
    grep -qxF "$newest" <<<"$rel" || echo "$base"
  done
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

# range_diff_lists RANGE-DIFF-FILE DIR GIT...: from git range-diff output, as
# "<full sha>\t<subject>" lines: DIR/dropped (<, the old main's commit), DIR/changed (!,
# the old main's commit; every one needs the owner), DIR/added (>, the candidate's).
# A pair range-diff calls equal (=) counts as changed too when a binary file of it
# differs (binary_changes): a patch shows a binary file only as "Binary files differ",
# so two different images look equal there. GIT is the git command that resolves the
# short SHAs (e.g. git --git-dir=X).
range_diff_lists() {
  local file=$1 dir=$2 line p op a b subj
  shift 2
  : >"$dir/dropped"; : >"$dir/changed"; : >"$dir/added"
  while IFS= read -r line; do
    p="$(sed -E 's/^ *([0-9]+|-+): +([0-9a-f]+|-+) ([=!<>]) +([0-9]+|-+): +([0-9a-f]+|-+) (.*)$/\3	\2	\5	\6/' <<<"$line")"
    IFS=$'\t' read -r op a b subj <<<"$p"
    case "$op" in
      '<') printf '%s\t%s\n' "$("$@" rev-parse "$a^{commit}")" "$subj" >>"$dir/dropped" ;;
      '!') printf '%s\t%s\n' "$("$@" rev-parse "$a^{commit}")" "$subj" >>"$dir/changed" ;;
      '>') printf '%s\t%s\n' "$("$@" rev-parse "$b^{commit}")" "$subj" >>"$dir/added" ;;
      '=')
        if [[ "$(binary_changes "$@" -- "$a" | git hash-object --stdin)" != "$(binary_changes "$@" -- "$b" | git hash-object --stdin)" ]]; then
          printf '%s\t%s (a binary file differs)\n' "$("$@" rev-parse "$a^{commit}")" "$subj" >>"$dir/changed"
        fi
        ;;
    esac
  done < <(grep -E '^ *([0-9]+|-+): +([0-9a-f]+|-+) [=!<>] +([0-9]+|-+): +([0-9a-f]+|-+) ' "$file" || true)
}

# binary_changes GIT... -- COMMIT: the binary files COMMIT changes, as NUL-ended records
# "<old mode> <new mode> <old blob> <new blob> <status>\t<path>", the full blob ids, the
# path as git stores it (never quoted: -z throughout, so "café.png" or a name with a
# newline is one record), sorted. A file is binary when git diff-tree --numstat counts
# no lines for it ("-"). Compare two commits' outputs whole (e.g. by hashing them).
binary_changes() {
  local c="${*: -1}" rec meta path
  local -a binpaths=()
  set -- "${@:1:$#-2}"
  # --numstat -z: "<added>\t<deleted>\t<path>" NUL-ended (no renames: one path each).
  while IFS= read -r -d '' rec; do
    [[ "$rec" == -$'\t'-$'\t'* ]] && binpaths+=("${rec#-$'\t'-$'\t'}")
  done < <("$@" diff-tree -r -z --no-commit-id --numstat --no-renames "$c")
  [[ ${#binpaths[@]} -gt 0 ]] || return 0
  # -z raw: ":<old mode> <new mode> <old blob> <new blob> <status>" NUL, then the path NUL.
  while IFS= read -r -d '' meta && IFS= read -r -d '' path; do
    for rec in "${binpaths[@]}"; do
      if [[ "$rec" == "$path" ]]; then printf '%s\t%s\0' "${meta#:}" "$path"; break; fi
    done
  done < <("$@" diff-tree -r -z --no-commit-id --no-abbrev --no-renames "$c") | LC_ALL=C sort -z
}

# --- the root README commit (design/root-readme.md; SYNC.md, "The root README commit") ---
# One layer commit, the README commit (trailer "Provimux-Readme: root"), replaces upstream's
# root READMEs: it changes exactly the paths of this set (root, literal) and leaves
# README.md (the pointer) and no other. guard.sh has its own copy of the set (the selftest
# checks that the two are equal). With no README commit on either side, every function
# below gives what the scripts computed before.
PMX_README_PATHS=(README.md README_CN.md)

# readme_path NAME: status 0 when NAME, whole, is a path of the set.
readme_path() {
  local p
  for p in "${PMX_README_PATHS[@]}"; do [[ "$1" == "$p" ]] && return 0; done
  return 1
}

# Every function below returns 0 when it holds, 1 when the README rule is broken (the reason
# on stderr) and 2 when git failed (stderr): a read git could not make never counts as a
# pass. Callers run them in "if"/"||" context, where set -e does not apply, so each git
# call's status is tested where it is made.

# pmx_tmp: a new temporary file (NUL-delimited git output cannot live in a variable).
pmx_tmp() { mktemp "${TMPDIR:-/tmp}/pmx-readme.XXXXXX"; }

# readme_commits RANGE GIT...: the commits of RANGE (A..B) whose trailer Provimux-Readme
# has the value "root", full SHAs, oldest first, one per line.
readme_commits() {
  local rng=$1 list c v
  shift
  list="$("$@" rev-list --reverse --topo-order "$rng")" || { echo "git rev-list $rng failed" >&2; return 2; }
  for c in $list; do
    v="$("$@" log -1 --format='%(trailers:key=Provimux-Readme,valueonly)' "$c")" ||
      { echo "git log $c failed" >&2; return 2; }
    # shellcheck disable=SC2001 # trailing blanks of every line
    v="$(sed 's/[[:space:]]*$//' <<<"$v")"
    if grep -qx 'root' <<<"$v"; then echo "$c"; fi
  done
}

# root_records COMMIT FILE GIT...: the root entries of COMMIT's tree into FILE, as git
# ls-tree -z writes them ("<mode> <type> <object>\t<name>", NUL-ended, git's order).
root_records() {
  local c=$1 f=$2
  shift 2
  "$@" ls-tree -z "$c^{tree}" >"$f" || { echo "git ls-tree $c failed" >&2; return 2; }
}

# root_entry COMMIT NAME GIT...: "<mode> <type> <object>" of the root entry NAME (whole,
# NUL-delimited) of COMMIT's tree, or nothing when there is none.
root_entry() {
  local c=$1 name=$2 f rec st=0
  shift 2
  f="$(pmx_tmp)" || return 2
  if root_records "$c" "$f" "$@"; then
    while IFS= read -r -d '' rec; do
      if [[ "${rec#*$'\t'}" == "$name" ]]; then printf '%s\n' "${rec%%$'\t'*}"; break; fi
    done <"$f"
  else
    st=2
  fi
  rm -f "$f"
  return $st
}

# outside_same A B GIT...: status 0 when the root entries of A and B outside the set are
# the same records (name, mode, type, object: a changed, added or removed file, directory,
# empty tree, symlink or submodule anywhere outside the set differs at the root); 1 and
# their names on stderr when not.
outside_same() {
  local a=$1 b=$2 fa fb oa ob rec st=0 diffs
  shift 2
  fa="$(pmx_tmp)" && fb="$(pmx_tmp)" && oa="$(pmx_tmp)" && ob="$(pmx_tmp)" || return 2
  if root_records "$a" "$fa" "$@" && root_records "$b" "$fb" "$@"; then
    while IFS= read -r -d '' rec; do readme_path "${rec#*$'\t'}" || printf '%s\0' "$rec"; done <"$fa" >"$oa"
    while IFS= read -r -d '' rec; do readme_path "${rec#*$'\t'}" || printf '%s\0' "$rec"; done <"$fb" >"$ob"
    if ! cmp -s "$oa" "$ob"; then
      diffs="$(comm -3 <(tr '\n\0' '?\n' <"$oa" | LC_ALL=C sort) <(tr '\n\0' '?\n' <"$ob" | LC_ALL=C sort) |
        sed 's/^[[:space:]]*//; s/^[^	]*	//' | LC_ALL=C sort -u | paste -sd ' ' -)"
      echo "${diffs:-the root entries outside the set}" >&2
      st=1
    fi
  else
    st=2
  fi
  rm -f "$fa" "$fb" "$oa" "$ob"
  return $st
}

# set_not_tree COMMIT GIT...: status 0 when no path of the set is a directory or a
# submodule at COMMIT's root (replacing one would drop what is under it); 1 and the path
# on stderr when one is.
set_not_tree() {
  local c=$1 p e
  shift
  for p in "${PMX_README_PATHS[@]}"; do
    e="$(root_entry "$c" "$p" "$@")" || return 2
    case "$e" in
      '' | 100644\ blob\ * | 100755\ blob\ * | 120000\ blob\ *) ;;
      *) echo "$p is '$e' at ${c:0:12}, not a file" >&2; return 1 ;;
    esac
  done
}

# readme_normal OLD NEW OLD_TIP NEW_TIP GIT...: status 0 when NEW is OLD re-applied (the
# normal form, five conditions on git objects); 1 and the first failed condition on
# stderr; 2 when git failed.
readme_normal() {
  local t st
  t="$(mktemp -d "${TMPDIR:-/tmp}/pmx-readme.XXXXXX")" || return 2
  readme_normal_in "$t" "$@"
  st=$?
  rm -rf "${t:?}"
  return $st
}
# shellcheck disable=SC2015 # "A && B || return": either failing returns
readme_normal_in() {
  local t=$1 o=$2 n=$3 ot=$4 nt=$5 c pl p eo en why st
  shift 5
  for c in "$o" "$n"; do
    pl="$("$@" rev-list --parents -n 1 "$c")" || { echo "git rev-list $c failed" >&2; return 2; }
    [[ "$(wc -w <<<"$pl" | tr -d ' ')" == 2 ]] ||
      { echo "condition 1: the README commit ${c:0:12} has not exactly one parent" >&2; return 1; }
  done
  "$@" cat-file commit "$o" >"$t/o" && "$@" cat-file commit "$n" >"$t/n" ||
    { echo "git cat-file of the README commits failed" >&2; return 2; }
  sed -n '/^$/q; /^author /p' "$t/o" >"$t/oa"; sed -n '/^$/q; /^author /p' "$t/n" >"$t/na"
  sed '1,/^$/d' "$t/o" >"$t/om"; sed '1,/^$/d' "$t/n" >"$t/nm"
  [[ -s "$t/oa" ]] && cmp -s "$t/oa" "$t/na" ||
    { echo "condition 2: the README commit ${n:0:12} has another author than ${o:0:12}" >&2; return 1; }
  cmp -s "$t/om" "$t/nm" ||
    { echo "condition 2: the README commit ${n:0:12} has another message than ${o:0:12}" >&2; return 1; }
  for p in "${PMX_README_PATHS[@]}"; do
    eo="$(root_entry "$o" "$p" "$@")" && en="$(root_entry "$n" "$p" "$@")" || return 2
    [[ "$eo" == "$en" ]] ||
      { echo "condition 3: $p in the README commit ${n:0:12} is not what ${o:0:12} has" >&2; return 1; }
  done
  why="$(outside_same "$n^" "$n" "$@" 2>&1)"
  st=$?
  [[ $st -ne 2 ]] || { echo "$why" >&2; return 2; }
  [[ $st -eq 0 ]] ||
    { echo "condition 4: the README commit ${n:0:12} changes a root entry outside the root READMEs: $why" >&2; return 1; }
  why="$(set_not_tree "$n^" "$@" 2>&1)"
  st=$?
  [[ $st -ne 2 ]] || { echo "$why" >&2; return 2; }
  [[ $st -eq 0 ]] ||
    { echo "condition 4: the README commit ${n:0:12} replaces a directory: $why" >&2; return 1; }
  for p in "${PMX_README_PATHS[@]}"; do
    eo="$(root_entry "$ot" "$p" "$@")" && en="$(root_entry "$nt" "$p" "$@")" || return 2
    [[ "$eo" == "$en" ]] ||
      { echo "condition 5: $p at the candidate ${nt:0:12} is not what the old main ${ot:0:12} has" >&2; return 1; }
  done
}

# rev_count RANGE GIT...: the number of commits of RANGE.
rev_count() {
  local r=$1 n
  shift
  n="$("$@" rev-list --count "$r")" && [[ "$n" =~ ^[0-9]+$ ]] || { echo "git rev-list --count $r failed" >&2; return 2; }
  echo "$n"
}

# one_sided OP RANGE GIT...: every commit of RANGE as a git range-diff header line, OP "<"
# (the old side) or ">" (the new side), full SHAs, so range_diff_lists reads them as
# dropped or added. git range-diff itself refuses an empty range.
one_sided() {
  local op=$1 rng=$2 list c s i=0 dash=----------------------------------------
  shift 2
  list="$("$@" rev-list --reverse --topo-order "$rng")" || { echo "git rev-list $rng failed" >&2; return 2; }
  for c in $list; do
    i=$((i + 1))
    s="$("$@" log -1 --format=%s "$c")" || { echo "git log $c failed" >&2; return 2; }
    if [[ "$op" == '<' ]]; then
      printf '%s:  %s < -:  %s %s\n' "$i" "$c" "$dash" "$s"
    else
      printf -- '-:  %s > %s:  %s %s\n' "$dash" "$i" "$c" "$s"
    fi
  done
}

# segment_range_diff OLD-RANGE NEW-RANGE GIT...: git range-diff of the two ranges; when one
# is empty, the other's commits one-sided; when both are, nothing. Status 2 when git failed.
segment_range_diff() {
  local a=$1 b=$2 na nb
  shift 2
  na="$(rev_count "$a" "$@")" && nb="$(rev_count "$b" "$@")" || return 2
  if [[ "$na" != 0 && "$nb" != 0 ]]; then
    "$@" range-diff --no-color --no-notes "$a" "$b" || { echo "git range-diff $a $b failed" >&2; return 2; }
  elif [[ "$na" != 0 ]]; then
    one_sided '<' "$a" "$@"
  elif [[ "$nb" != 0 ]]; then
    one_sided '>' "$b" "$@"
  fi
}

# stack_range_diff OLD_BASE OLD_MAIN NEW_BASE CANDIDATE OUT GIT...: writes the stack's
# range-diff to OUT (the file range_diff_lists reads) and prints "<R> <R'>" (the README
# commits of the old main and of the candidate), or nothing when the two are not both
# there. The only place git range-diff runs for check.sh and publish.sh.
#   no README commit on either side, or on one side only: one git range-diff of the whole
#     ranges, byte for byte what the scripts ran before (a README commit on one side only
#     is then dropped "<" or added ">", refused as any other);
#   one on each side: the range-diff of the commits below them, the line
#     "README  <R> -> <R'>  <subject>", the range-diff of the commits above them; and R'
#     must be R re-applied (readme_normal): otherwise status 1 (OUT still written);
#   more than one on either side, a merge commit, or parts that do not add up: status 1.
# Status 2 when any git command failed (a failed segment is never hidden by another).
# The README line is no range-diff header, so the README commit is in no list.
# shellcheck disable=SC2015 # "A && B || return": either failing returns
stack_range_diff() {
  local ob=$1 om=$2 nb=$3 cand=$4 out=$5 ro rn no nn m1 m2 c st
  local n_ob_r n_r_om n_ob_om n_nb_r n_r_c n_nb_c
  shift 5
  ro="$(readme_commits "$ob..$om" "$@")" && rn="$(readme_commits "$nb..$cand" "$@")" || return 2
  no="$(grep -c . <<<"$ro" || true)" nn="$(grep -c . <<<"$rn" || true)"
  if [[ "$no" -gt 1 || "$nn" -gt 1 ]]; then
    "$@" range-diff --no-color --no-notes "$ob..$om" "$nb..$cand" >"$out" || true
    echo "more than one README commit (trailer Provimux-Readme: root): $no in the old main, $nn in the candidate" >&2
    return 1
  fi
  if [[ "$no" == 0 || "$nn" == 0 ]]; then
    "$@" range-diff --no-color --no-notes "$ob..$om" "$nb..$cand" >"$out" ||
      { echo "git range-diff $ob..$om $nb..$cand failed" >&2; return 2; }
    return 0
  fi
  # Each range on its own: git rev-list of two ranges together combines their exclusions.
  m1="$("$@" rev-list --merges "$ob..$om")" && m2="$("$@" rev-list --merges "$nb..$cand")" ||
    { echo "git rev-list --merges failed" >&2; return 2; }
  if [[ -n "$m1$m2" ]]; then
    "$@" range-diff --no-color --no-notes "$ob..$om" "$nb..$cand" >"$out" || true
    echo "a merge commit in the stack: the README rule needs linear ranges" >&2
    return 1
  fi
  for c in "$ro" "$rn"; do
    m1="$("$@" rev-list --parents -n 1 "$c")" || { echo "git rev-list $c failed" >&2; return 2; }
    [[ "$(wc -w <<<"$m1" | tr -d ' ')" == 2 ]] ||
      { echo "condition 1: the README commit ${c:0:12} has not exactly one parent" >&2; return 1; }
  done
  n_ob_r="$(rev_count "$ob..$ro^" "$@")" && n_r_om="$(rev_count "$ro..$om" "$@")" && n_ob_om="$(rev_count "$ob..$om" "$@")" &&
    n_nb_r="$(rev_count "$nb..$rn^" "$@")" && n_r_c="$(rev_count "$rn..$cand" "$@")" && n_nb_c="$(rev_count "$nb..$cand" "$@")" ||
    return 2
  if [[ $((n_ob_r + 1 + n_r_om)) != "$n_ob_om" || $((n_nb_r + 1 + n_r_c)) != "$n_nb_c" ]]; then
    "$@" range-diff --no-color --no-notes "$ob..$om" "$nb..$cand" >"$out" || true
    echo "the commits below and above the README commit do not add up to the stack" >&2
    return 1
  fi
  : >"$out"
  segment_range_diff "$ob..$ro^" "$nb..$rn^" "$@" >>"$out" || return 2
  c="$("$@" log -1 --format=%s "$rn")" || { echo "git log $rn failed" >&2; return 2; }
  printf 'README  %s -> %s  %s\n' "$ro" "$rn" "$c" >>"$out"
  segment_range_diff "$ro..$om" "$rn..$cand" "$@" >>"$out" || return 2
  readme_normal "$ro" "$rn" "$om" "$cand" "$@"
  st=$?
  [[ $st -eq 0 ]] || return $st
  echo "$ro $rn"
}

# fetch_artifact ID NAME DIGEST RUN DIR: the artifact ID of this repository, unpacked into
# DIR, only if it belongs to RUN, has NAME and DIGEST (sha256:<hex>, as the uploading
# job's upload step gave it), is not expired, and the downloaded zip hashes to DIGEST.
# The id and digest come from the producing job's outputs (a job that ran no code of the
# candidate or of upstream), never from a lookup by name: a job of the same run can
# replace an artifact under the same name, never under the same id and digest.
fetch_artifact() {
  local id=$1 name=$2 digest=$3 run=$4 dir=$5 got
  [[ "$id" =~ ^[0-9]+$ && "$digest" =~ ^(sha256:)?[0-9a-f]{64}$ && "$run" =~ ^[0-9]+$ ]] ||
    { echo "fetch_artifact: id '$id', digest '$digest', run '$run'" >&2; return 1; }
  digest="sha256:${digest#sha256:}"
  gh api "repos/$PMX_REPO/actions/artifacts/$id" | jq -e --arg run "$run" --arg name "$name" --arg d "$digest" \
    '(.workflow_run.id | tostring) == $run and .name == $name and (.expired | not) and .digest == $d' >/dev/null ||
    { echo "artifact $id is not $name of run $run with $digest" >&2; return 1; }
  mkdir -p "$dir"
  gh api "repos/$PMX_REPO/actions/artifacts/$id/zip" >"$dir/.artifact.zip" || { echo "cannot download artifact $id" >&2; return 1; }
  if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$dir/.artifact.zip" | cut -d' ' -f1)"
  else got="$(shasum -a 256 "$dir/.artifact.zip" | cut -d' ' -f1)"; fi
  [[ "sha256:$got" == "$digest" ]] || { echo "artifact $id downloads as sha256:$got, not $digest" >&2; return 1; }
  unzip -q -o "$dir/.artifact.zip" -d "$dir" || { echo "artifact $id is not a zip" >&2; return 1; }
  rm -f "$dir/.artifact.zip"
}

# state_get FILE KEY REGEX: the value of KEY in the JSON state FILE (check.sh's state,
# read as data, never sourced), checked against REGEX ("" passes when REGEX allows it).
state_get() {
  local v
  v="$(jq -r --arg k "$2" 'if type == "object" then (.[$k] // "") else error("not an object") end | tostring' "$1")" ||
    { echo "state: $1 is not a JSON object" >&2; return 1; }
  [[ "$v" =~ $3 ]] || { echo "state: $2 is '$v'" >&2; return 1; }
  printf '%s' "$v"
}

# --- release authorization (SYNC.md, "Release authorization") --------------------------
# A release is built and promoted only for a tag whose commit carries the commit status
# PMX_AUTH_CONTEXT, state success, description = the tag exactly, created either by this
# repository's provimux-ui-publish run (github-actions[bot], target_url = that run, read
# back from the API: provimux-ui-publish.yml, event workflow_run, on main, this
# repository) or by the repository owner's account (publish.sh by hand, or the owner's
# documented hotfix path). Only the publish job holds statuses: write.
PMX_AUTH_CONTEXT=provimux-ui-release

# authorize_release TAG SHA URL: sets that status (the caller's gh credentials).
authorize_release() {
  gh api -X POST "repos/$PMX_REPO/statuses/$2" -f state=success -f context="$PMX_AUTH_CONTEXT" \
    -f description="$1" -f target_url="$3" >/dev/null
}

# publish_pushed RUN TAG SHA: run RUN's job "publish" (any attempt) has the steps
# "Push TAG at SHA (the only step with the token)" and "Authorize the release TAG at SHA",
# both concluded success: that run pushed exactly this tag at this commit and set the
# status itself. (Step names are evaluated at run time; the values were checked first.)
publish_pushed() {
  gh api "repos/$PMX_REPO/actions/runs/$1/jobs?filter=all&per_page=100" |
    jq -e --arg push "Push $2 at $3 (the only step with the token)" --arg auth "Authorize the release $2 at $3" '
      [.jobs[] | select(.name == "publish") | .steps[] | select(.conclusion == "success") | .name] as $ok
      | ($ok | index($push)) != null and ($ok | index($auth)) != null' >/dev/null
}

# release_authorized TAG SHA: 0 when SHA carries a valid authorization for TAG; 1 when it
# does not (the reason on stderr); 2 when the statuses cannot be read.
release_authorized() {
  local tag=$1 sha=$2 owner="${PMX_REPO%%/*}" list login url run
  list="$(gh api "repos/$PMX_REPO/commits/$sha/statuses?per_page=100" \
    --jq ".[] | select(.context == \"$PMX_AUTH_CONTEXT\" and .state == \"success\" and .description == \"$tag\") | \"\(.creator.login) \(.target_url // \"\")\"")" ||
    { echo "cannot read the statuses of $sha" >&2; return 2; }
  while read -r login url; do
    [[ -n "$login" ]] || continue
    if [[ "$login" == "$owner" ]]; then echo "authorized by the owner ($login)"; return 0; fi
    [[ "$login" == "github-actions[bot]" && "$url" =~ ^https://github\.com/$PMX_REPO/actions/runs/([0-9]+)$ ]] || continue
    run="${BASH_REMATCH[1]}"
    if gh api "repos/$PMX_REPO/actions/runs/$run" | jq -e --arg repo "$PMX_REPO" \
      '.path == ".github/workflows/provimux-ui-publish.yml" and .event == "workflow_run" and .head_branch == "main"
       and .repository.full_name == $repo and .head_repository.full_name == $repo' >/dev/null &&
      publish_pushed "$run" "$tag" "$sha"; then
      echo "authorized by provimux-ui-publish run $run"; return 0
    fi
  done <<<"$list"
  echo "$sha carries no $PMX_AUTH_CONTEXT status for $tag from a provimux-ui-publish run or the owner" >&2
  return 1
}

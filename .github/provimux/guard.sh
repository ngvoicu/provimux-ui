#!/usr/bin/env bash
# provimux-ui guard (PUI-05), run by .github/workflows/provimux-ui-guard.yml.
# Mirrors Provimux's guard (ngvoicu/provimux, .github/provimux/guard.sh).
#
# The console composes requests that the server sends to AI providers (quota and
# usage calls, OAuth flows). Those must stay identical to the upstream console.
# main = upstream console release tag + Provimux layer (commits with the trailer
# "Provimux-Layer: branding").
#
# Checks HEAD:
#   1. the base is the newest vX.Y.Z tag of the upstream console (its refs, not local
#      tags) whose commit is an ancestor of HEAD, and it is not HEAD itself; a vX.Y.Z
#      tag reachable from HEAD here, as new as that base or newer, that upstream
#      withdrew or moved is an error, never a reason to fall back to an older base.
#      With PMX_EXPECT_BASE (and PMX_EXPECT_BASE_COMMIT) the base must be exactly that
#      upstream tag at that commit;
#   2. base..HEAD has at least one layer commit, and once one appears every later
#      commit carries the trailer too;
#   3. no layer commit changes a protected path, against any of its parents;
#   4. for a pull request (PMX_TARGET = the target branch's commit): the PR's own
#      commits since the merge base touch no protected path, it merges cleanly, and
#      the merged tree differs from the target in no protected path. Changes to
#      protected paths reach main only from upstream, by a rebase onto a new upstream
#      release pushed by the owner, never through a PR;
#   5. the root README commit (design/root-readme.md; SYNC.md, "The root README commit"):
#      at most one commit of base..HEAD has the trailer "Provimux-Readme: root" (none
#      fails once require_readme=1); it carries "Provimux-Layer: branding", has one
#      parent, changes only the paths of readme_paths, and leaves README.md a regular
#      file (100644) and the other paths absent; and then at HEAD the root entries whose
#      name begins with "readme" (ASCII, any case) are exactly the 100644 blob README.md.
#      With no README commit (and require_readme=0) this rule checks nothing.
#
# Env: PMX_TARGET (optional, pull requests), PMX_UPSTREAM (default: the upstream
# console), PMX_EXPECT_BASE / PMX_EXPECT_BASE_COMMIT (optional: the sync check and
# publish.sh).
set -euo pipefail

upstream=${PMX_UPSTREAM:-https://github.com/router-for-me/Cli-Proxy-API-Management-Center}
# Directories (trailing /) and single files whose content is provider-facing: the
# quota and usage requests, their parsers, the OAuth flows, the provider model-list
# requests, the AI Providers page's connection test and key usage check, and the
# management api-call transport that carries them to the server.
protected=(
  src/utils/quota/
  src/features/quota/providers/
  src/features/oauth/
  src/features/providers/sheets/forms/useConnectivityTest.ts
  src/features/providers/sheets/forms/useSponsorUsageCheck.ts
  src/services/api/apiCall.ts
  src/services/api/antigravitySubscription.ts
  src/services/api/claudeResetGrants.ts
  src/services/api/claudeUsage.ts
  src/services/api/devinQuota.ts
  src/services/api/kimiQuota.ts
  src/services/api/metaQuota.ts
  src/services/api/models.ts
)
# The root READMEs the README commit replaces (rule 5): the same set as PMX_README_PATHS in
# common.sh (the selftest checks it). The README commit leaves README.md, the pointer.
readme_paths=(README.md README_CN.md)
require_readme=0
pathspec=()
for p in "${protected[@]}"; do pathspec+=(":(top,literal)$p"); done
protected_list="${protected[*]}"

fail=0
err() { echo "::error::$*"; fail=1; }

# Print each protected file name NUL-delimited input gives, one per line (names
# with spaces or accents intact; a newline in a name is shown as '?').
names() { while IFS= read -r -d '' f; do printf '%s\n' "${f//$'\n'/?}"; done; }

head=$(git rev-parse HEAD)
short() { git rev-parse --short "$1"; }
subject() { git log -1 --format=%s "$1"; }

# --- 1. Base: a real upstream release tag, not the tip ---------------------------
# Upstream's refs decide (git ls-remote), not local tags: the base is the newest vX.Y.Z
# tag of upstream whose commit is an ancestor of HEAD. A vX.Y.Z tag reachable from HEAD
# here, as new as that base or newer, that upstream no longer has (withdrawn) or has at
# another commit (moved) is an error, never a reason to fall back to an older base.
# Same rule as upstream_base in common.sh (this file stays self-contained: workflows
# and publish.sh run a copy of it alone).
if ! upstream_tags=$(git ls-remote --tags "$upstream" 'refs/tags/v*'); then
  echo "::error::Cannot list the tags of $upstream."
  exit 1
fi
upstream_commit() { # commit an upstream tag points to (peeled when annotated)
  local t=$1 peeled plain
  peeled=$(awk -v r="refs/tags/$t^{}" '$2==r {print $1}' <<<"$upstream_tags")
  plain=$(awk -v r="refs/tags/$t" '$2==r {print $1}' <<<"$upstream_tags")
  echo "${peeled:-$plain}"
}
stable_re='^v[0-9]+\.[0-9]+\.[0-9]+$'
base=''
base_commit=''
# shellcheck disable=SC2013 # tag names have no spaces
for t in $(awk '{print $2}' <<<"$upstream_tags" | sed 's|^refs/tags/||; s/\^{}$//' | grep -E "$stable_re" | sort -u | sort -r -V); do
  up=$(upstream_commit "$t")
  git cat-file -e "$up^{commit}" 2>/dev/null || continue
  if git merge-base --is-ancestor "$up" HEAD; then
    base=$t
    base_commit=$up
    break
  fi
done
if [ -z "$base" ]; then
  echo "::error::No vX.Y.Z release tag of $upstream is an ancestor of HEAD; cannot find the base."
  exit 1
fi
for t in $(git tag --merged HEAD --list 'v*' | grep -E "$stable_re" || true); do
  # Only tags as new as the base or newer.
  [ "$(printf '%s\n%s\n' "$t" "$base" | sort -V | tail -n 1)" = "$t" ] || continue
  local_commit=$(git rev-parse "$t^{commit}")
  up=$(upstream_commit "$t")
  if [ -z "$up" ]; then
    echo "::error::Tag $t ($(short "$local_commit")) is reachable from HEAD but is no longer a tag in $upstream (withdrawn); refusing to fall back to $base."
    exit 1
  elif [ "$up" != "$local_commit" ]; then
    echo "::error::Tag $t is $(short "$local_commit") here but ${up:0:8} in $upstream (moved); refusing to fall back to $base. Fix the tag."
    exit 1
  fi
done
if [ -n "${PMX_EXPECT_BASE:-}" ]; then
  # The sync: the base must be exactly the given upstream tag, at the given commit.
  up=$(upstream_commit "$PMX_EXPECT_BASE")
  if [ -z "$up" ]; then
    echo "::error::Expected base $PMX_EXPECT_BASE is not a tag in $upstream."
    exit 1
  fi
  if [ -n "${PMX_EXPECT_BASE_COMMIT:-}" ] && [ "$up" != "$PMX_EXPECT_BASE_COMMIT" ]; then
    echo "::error::Expected base $PMX_EXPECT_BASE at ${PMX_EXPECT_BASE_COMMIT:0:8}, but upstream's tag is ${up:0:8}."
    exit 1
  fi
  if [ "$base" != "$PMX_EXPECT_BASE" ] || [ "$base_commit" != "$up" ]; then
    echo "::error::Expected base $PMX_EXPECT_BASE (${up:0:8}), but the base of HEAD is $base (${base_commit:0:8})."
    exit 1
  fi
fi
echo "Base: $base ($(short "$base_commit")), head: $(short "$head")"
if [ "$base_commit" = "$head" ]; then
  echo "::error::HEAD is the upstream release $base itself; there are no Provimux commits to check."
  exit 1
fi

# --- 2 and 3. Layer order and protected paths, per commit --------------------------
in_layer=0
first_layer=''
for c in $(git rev-list --reverse --topo-order "$base_commit..HEAD"); do
  if git log -1 --format='%(trailers:key=Provimux-Layer,valueonly)' "$c" | sed 's/[[:space:]]*$//' | grep -qx 'branding'; then
    if [ "$in_layer" -eq 0 ]; then in_layer=1; first_layer=$(short "$c"); fi
    # Against every parent (-m): a layer merge must not bring protected changes from either side.
    hits=$(git diff-tree -r -m --root --no-commit-id --name-only -z "$c" -- "${pathspec[@]}" | names | sort -u)
    while IFS= read -r f; do
      [ -n "$f" ] && err "Provimux-layer commit $(short "$c") (\"$(subject "$c")\") touches protected path $f. Layer commits must not change anything under: $protected_list"
    done <<<"$hits"
  elif [ "$in_layer" -eq 1 ]; then
    err "Commit $(short "$c") (\"$(subject "$c")\") has no 'Provimux-Layer: branding' trailer but follows layer commit $first_layer. Only upstream commits may sit below the Provimux layer; add the trailer if it belongs to the layer."
  fi
done
if [ -z "$first_layer" ]; then
  err "No commit in $base..$(short "$head") carries the 'Provimux-Layer: branding' trailer. A change to main must sit on top of the Provimux layer (is the branch based on the upstream tag below the layer?)."
fi

# --- 4. Pull request: what it introduces relative to its target ---------------------
if [ -n "${PMX_TARGET:-}" ]; then
  target=$(git rev-parse "$PMX_TARGET^{commit}")
  echo "Pull request target: $(short "$target")"
  # What the PR's own commits change since the merge base.
  hits=$(git diff --name-only -z "$target...$head" -- "${pathspec[@]}" | names)
  # What merging it would change on the target: the merged tree against the target.
  # Not the branch tips: a PR that merged main earlier still has the old blob of a
  # protected file the target changed since, and a clean merge keeps the target's.
  # -z output: the merged tree's id, then (on a conflict) each conflicted file name.
  merge_out=$(mktemp)
  set +e
  git merge-tree --write-tree --no-messages --name-only -z "$target" "$head" >"$merge_out"
  merge_status=$?
  set -e
  if [ "$merge_status" -eq 1 ]; then
    conflicts=$({ IFS= read -r -d '' _ || true; names; } <"$merge_out" | sort -u | paste -sd ',' - | sed 's/,/, /g')
    err "This pull request does not merge cleanly into main ($(short "$target")); conflicts in: $conflicts. The guard checks what the merge would change, so a conflicting PR cannot pass: merge main into the branch (or rebase onto it), resolve the conflicts, and push again."
  elif [ "$merge_status" -ne 0 ]; then
    err "git merge-tree failed (exit $merge_status) merging $(short "$head") into $(short "$target"); cannot check what this pull request would change."
  else
    IFS= read -r -d '' tree <"$merge_out"
    hits=$(printf '%s\n%s\n' "$hits" "$(git diff --name-only -z "$target" "$tree" -- "${pathspec[@]}" | names)")
  fi
  rm -f "$merge_out"
  hits=$(sed '/^$/d' <<<"$hits" | sort -u)
  while IFS= read -r f; do
    [ -n "$f" ] && err "This pull request changes protected path $f relative to main ($(short "$target")). Changes to $protected_list reach main only from upstream (a rebase onto a new upstream release pushed by the owner), never through a pull request."
  done <<<"$hits"
fi

# --- 5. The root README commit ------------------------------------------------------
# Every git read here is checked: a read that fails stops the guard (never a pass).
fatal() { echo "::error::$*"; exit 1; }
in_readme_set() { local p; for p in "${readme_paths[@]}"; do [ "$1" = "$p" ] && return 0; done; return 1; }
rr_tmp=$(mktemp -d "${TMPDIR:-/tmp}/pmx-guard.XXXXXX") || fatal "cannot make a temporary directory"
trap 'rm -rf "${rr_tmp:?}"' EXIT
# root_records C FILE: the root entries of C's tree, "<mode> <type> <object>\t<name>", NUL-ended.
root_records() { git ls-tree -z "$1^{tree}" >"$2" || fatal "git ls-tree $1 failed"; }
# entry_in FILE NAME: "<mode> <type> <object>" of the root entry NAME in FILE, or nothing.
entry_in() {
  local rec
  while IFS= read -r -d '' rec; do
    if [ "${rec#*$'\t'}" = "$2" ]; then printf '%s\n' "${rec%%$'\t'*}"; return 0; fi
  done <"$1"
}
# outside FILE: the records of FILE whose name is not in the set, NUL-ended.
outside() { local rec; while IFS= read -r -d '' rec; do in_readme_set "${rec#*$'\t'}" || printf '%s\0' "$rec"; done <"$1"; }
readme_commits=''
layer_commits=$(git rev-list --reverse --topo-order "$base_commit..HEAD") || fatal "git rev-list $base_commit..HEAD failed"
for c in $layer_commits; do
  v=$(git log -1 --format='%(trailers:key=Provimux-Readme,valueonly)' "$c") || fatal "git log $c failed"
  # shellcheck disable=SC2001 # trailing blanks of every line
  v=$(sed 's/[[:space:]]*$//' <<<"$v")
  if grep -qx 'root' <<<"$v"; then readme_commits="$readme_commits $c"; fi
done
n_readme=$(wc -w <<<"$readme_commits" | tr -d ' ')
if [ "$n_readme" -gt 1 ]; then
  err "$n_readme commits in $base..$(short "$head") carry the trailer 'Provimux-Readme: root' ($(for c in $readme_commits; do short "$c"; done | paste -sd ' ' -)); exactly one commit is the README commit."
elif [ "$n_readme" -eq 0 ] && [ "$require_readme" -eq 1 ]; then
  err "No commit in $base..$(short "$head") carries the trailer 'Provimux-Readme: root': the README commit, which replaces the root READMEs, is missing."
elif [ "$n_readme" -eq 1 ]; then
  r=${readme_commits# }
  rs="$(short "$r") (\"$(subject "$r")\")"
  lv=$(git log -1 --format='%(trailers:key=Provimux-Layer,valueonly)' "$r") || fatal "git log $r failed"
  # shellcheck disable=SC2001 # trailing blanks of every line
  lv=$(sed 's/[[:space:]]*$//' <<<"$lv")
  grep -qx 'branding' <<<"$lv" || err "The README commit $rs has no 'Provimux-Layer: branding' trailer."
  parents=$(git rev-list --parents -n 1 "$r") || fatal "git rev-list $r failed"
  root_records "$r" "$rr_tmp/r"
  if [ "$(wc -w <<<"$parents" | tr -d ' ')" -ne 2 ]; then
    err "The README commit $rs has not exactly one parent."
  else
    # Whole root records outside the set (name, mode, type, object): a changed file, an
    # added empty directory or a submodule anywhere below the root shows here.
    root_records "$r^" "$rr_tmp/p"
    outside "$rr_tmp/p" >"$rr_tmp/po"
    outside "$rr_tmp/r" >"$rr_tmp/ro"
    if ! cmp -s "$rr_tmp/po" "$rr_tmp/ro"; then
      names=$(comm -3 <(tr '\n\0' '?\n' <"$rr_tmp/po" | LC_ALL=C sort) <(tr '\n\0' '?\n' <"$rr_tmp/ro" | LC_ALL=C sort) |
        sed 's/^[[:space:]]*//; s/^[^	]*	//' | LC_ALL=C sort -u | paste -sd ' ' -)
      err "The README commit $rs changes the root entries $names; it may change only: ${readme_paths[*]}."
    fi
    for p in "${readme_paths[@]}"; do
      e=$(entry_in "$rr_tmp/p" "$p")
      case "$e" in
        '' | "100644 blob "* | "100755 blob "* | "120000 blob "*) ;;
        *) err "The README commit $rs replaces $p, which is '$e' in its parent, not a file." ;;
      esac
    done
  fi
  for p in "${readme_paths[@]}"; do
    e=$(entry_in "$rr_tmp/r" "$p")
    if [ "$p" = README.md ]; then
      case "$e" in "100644 blob "*) ;; *) err "The README commit $rs leaves README.md as '${e:-absent}', not a regular file (100644 blob)." ;; esac
    elif [ -n "$e" ]; then
      err "The README commit $rs leaves $p in place; it must delete it."
    fi
  done
  # At HEAD: exactly one root README, the 100644 blob README.md (a README upstream adds
  # or a later commit brings back is named here).
  root_records HEAD "$rr_tmp/h"
  seen=0
  while IFS= read -r -d '' rec; do
    name=${rec#*$'\t'} meta=${rec%%$'\t'*}
    lc=$(printf '%s' "${name:0:6}" | LC_ALL=C tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')
    [ "$lc" = readme ] || continue
    if [ "$name" = README.md ] && case "$meta" in "100644 blob "*) true ;; *) false ;; esac; then
      seen=1
    else
      err "HEAD has the root entry ${name//$'\n'/?} ($meta): the only root README is README.md, the pointer (a 100644 blob). A root README upstream added or moved needs the owner: SYNC.md, \"Upstream added or moved a root README\"."
    fi
  done <"$rr_tmp/h"
  [ "$seen" -eq 1 ] || err "HEAD has no root README.md (a 100644 blob): the README commit's pointer is missing."
  [ "$fail" -ne 0 ] || echo "README commit: $rs; the root README is README.md only."
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "OK: $(git rev-list --count "$base_commit..HEAD") commits since $base ($(short "$base_commit")); layer starts at $first_layer; no protected path changed."

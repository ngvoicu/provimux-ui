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
#   1. the base is the newest vX.Y.Z tag reachable from HEAD, it exists in the
#      upstream console repository at the same commit (a tag that differs from
#      upstream's is an error, never a reason to fall back to an older base), and it
#      is not HEAD itself. With PMX_EXPECT_BASE (and PMX_EXPECT_BASE_COMMIT) the base
#      must be exactly that upstream tag at that commit, an ancestor of HEAD; no local
#      tag is needed;
#   2. base..HEAD has at least one layer commit, and once one appears every later
#      commit carries the trailer too;
#   3. no layer commit changes a protected path, against any of its parents;
#   4. for a pull request (PMX_TARGET = the target branch's commit): the PR's own
#      commits since the merge base touch no protected path, it merges cleanly, and
#      the merged tree differs from the target in no protected path. Changes to
#      protected paths reach main only from upstream, by a rebase onto a new upstream
#      release pushed by the owner, never through a PR.
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
upstream_tags=$(git ls-remote --tags "$upstream" 'refs/tags/v*')
upstream_commit() { # commit an upstream tag points to (peeled when annotated)
  local t=$1 peeled plain
  peeled=$(awk -v r="refs/tags/$t^{}" '$2==r {print $1}' <<<"$upstream_tags")
  plain=$(awk -v r="refs/tags/$t" '$2==r {print $1}' <<<"$upstream_tags")
  echo "${peeled:-$plain}"
}
base=''
base_commit=''
if [ -n "${PMX_EXPECT_BASE:-}" ]; then
  # The sync: the base is given; it must be upstream's tag, at the given commit.
  up=$(upstream_commit "$PMX_EXPECT_BASE")
  if [ -z "$up" ]; then
    echo "::error::Expected base $PMX_EXPECT_BASE is not a tag in $upstream."
    exit 1
  fi
  if [ -n "${PMX_EXPECT_BASE_COMMIT:-}" ] && [ "$up" != "$PMX_EXPECT_BASE_COMMIT" ]; then
    echo "::error::Expected base $PMX_EXPECT_BASE at ${PMX_EXPECT_BASE_COMMIT:0:8}, but upstream's tag is ${up:0:8}."
    exit 1
  fi
  if ! git merge-base --is-ancestor "$up" HEAD 2>/dev/null; then
    echo "::error::Expected base $PMX_EXPECT_BASE (${up:0:8}) is not an ancestor of HEAD."
    exit 1
  fi
  # No newer vX.Y.Z tag may be reachable (HEAD would then be on another base).
  for t in $(git tag --merged HEAD --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -rV); do
    if [ "$(printf '%s\n%s\n' "$t" "$PMX_EXPECT_BASE" | sort -V | tail -n 1)" != "$PMX_EXPECT_BASE" ]; then
      echo "::error::Tag $t, newer than the expected base $PMX_EXPECT_BASE, is reachable from HEAD."
      exit 1
    fi
    break
  done
  base=$PMX_EXPECT_BASE
  base_commit=$up
else
  for t in $(git tag --merged HEAD --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -rV); do
    local_commit=$(git rev-parse "$t^{commit}")
    up=$(upstream_commit "$t")
    if [ -z "$up" ]; then
      echo "Skipping tag $t: not a tag in $upstream."
    elif [ "$up" != "$local_commit" ]; then
      echo "::error::Tag $t is $(short "$local_commit") here but ${up:0:8} in $upstream; refusing to fall back to an older base. Fix the tag."
      exit 1
    else
      base=$t
      base_commit=$local_commit
      break
    fi
  done
  if [ -z "$base" ]; then
    echo "::error::No vX.Y.Z tag reachable from HEAD matches a release tag of $upstream; cannot find the base."
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

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "OK: $(git rev-list --count "$base_commit..HEAD") commits since $base ($(short "$base_commit")); layer starts at $first_layer; no protected path changed."

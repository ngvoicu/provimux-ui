#!/usr/bin/env bash
# provimux-ui release metadata (PUI-10), run by provimux-ui-release.yml in its
# read-only build job. Mirrors Provimux's .github/provimux/release-meta.sh.
#
# Tag push: GITHUB_REF_NAME = v<base>-pmx.<n>. Manual run (dry run): INPUT_VERSION =
# v<base>-pmx.<anything>, or empty for v<base>-pmx.0-dryrun.
#
# <base> must be exactly the base of HEAD: the newest vX.Y.Z release tag of the
# upstream console, read from upstream's refs (git ls-remote), whose commit is an
# ancestor of HEAD. A version naming any other base is refused, so no release can
# claim a console release it is not built on. A tag push must also be on main.
#
# Writes to $GITHUB_OUTPUT: version (the tag, with "v": the build's VERSION, as
# upstream's release.yml sets it), base (vX.Y.Z), base_commit, publish (true only
# for a tag push).
# Env: PMX_UPSTREAM (default: the upstream console), as for guard.sh.
set -euo pipefail
fail() { echo "::error::$*"; exit 1; }

upstream=${PMX_UPSTREAM:-https://github.com/router-for-me/Cli-Proxy-API-Management-Center}
head=$(git rev-parse HEAD)

# --- The base of HEAD, from upstream's refs ----------------------------------------
upstream_tags=$(git ls-remote --tags "$upstream" 'refs/tags/v*') ||
  fail "Cannot list the tags of $upstream."
base=''
base_commit=''
# shellcheck disable=SC2013 # tag names have no spaces
for t in $(awk '{ sub("^refs/tags/", "", $2); sub("\\^\\{\\}$", "", $2); print $2 }' <<<"$upstream_tags" |
  grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -u | sort -rV); do
  peeled=$(awk -v r="refs/tags/$t^{}" '$2==r {print $1}' <<<"$upstream_tags")
  plain=$(awk -v r="refs/tags/$t" '$2==r {print $1}' <<<"$upstream_tags")
  c=${peeled:-$plain}
  # An upstream commit this clone lacks is not an ancestor of HEAD.
  if git cat-file -e "$c^{commit}" 2>/dev/null && git merge-base --is-ancestor "$c" HEAD; then
    base=$t
    base_commit=$c
    break
  fi
done
[[ -n "$base" ]] || fail "No release tag of $upstream is an ancestor of HEAD; cannot find the base."
[[ "$base_commit" != "$head" ]] || fail "HEAD is the upstream release $base itself, not a provimux-ui commit."

# --- The version asked for -----------------------------------------------------------
if [[ "${GITHUB_EVENT_NAME:-}" == "push" ]]; then
  [[ "${GITHUB_REF:-}" == "refs/tags/$GITHUB_REF_NAME" ]] || fail "${GITHUB_REF:-?} is not a tag."
  version=$GITHUB_REF_NAME
  [[ "$version" =~ ^(v[0-9]+\.[0-9]+\.[0-9]+)-pmx\.[0-9]+$ ]] ||
    fail "Tag $version is not v<major>.<minor>.<patch>-pmx.<n>."
  [[ "$(git rev-parse "refs/tags/$version^{commit}")" == "$head" ]] ||
    fail "Tag $version is not HEAD ($(git rev-parse --short HEAD))."
  # Releases come from main only.
  git fetch -q --no-tags origin '+refs/heads/main:refs/remotes/origin/main' ||
    fail "Cannot fetch main."
  git merge-base --is-ancestor "$head" refs/remotes/origin/main ||
    fail "Tag $version ($(git rev-parse --short HEAD)) is not on main."
  publish=true
else
  version=${INPUT_VERSION:-}
  [[ -n "$version" ]] || version="${base}-pmx.0-dryrun"
  [[ "$version" =~ ^(v[0-9]+\.[0-9]+\.[0-9]+)-pmx\.[0-9A-Za-z.-]+$ ]] ||
    fail "Version $version is not v<base>-pmx.<n>[...]."
  publish=false
fi
named=${BASH_REMATCH[1]}

[[ "$named" == "$base" ]] ||
  fail "Version $version names base $named, but $(git rev-parse --short HEAD) is built on $base (the newest upstream console release whose commit is an ancestor of it). Tag it ${base}-pmx.<n>."

out="${GITHUB_OUTPUT:-/dev/stdout}"
{
  echo "version=$version"
  echo "base=$base"
  echo "base_commit=$base_commit"
  echo "publish=$publish"
} >>"$out"
{
  echo "### provimux-ui ${version}"
  echo
  echo "- Console base: \`${base}\` (\`${base_commit:0:12}\`, the newest upstream release whose commit is an ancestor of the commit)"
  echo "- Commit: \`$(git rev-parse --short HEAD)\`"
  echo "- Publish: ${publish}"
} >>"${GITHUB_STEP_SUMMARY:-/dev/stderr}"

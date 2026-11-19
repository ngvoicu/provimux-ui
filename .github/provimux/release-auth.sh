#!/usr/bin/env bash
# provimux-ui release authorization (.github/provimux/SYNC.md, "Release authorization"),
# run by the build job of provimux-ui-release.yml on a tag push, before anything is
# built: the tag's commit must carry the status that a provimux-ui-publish run (or the
# owner) set for exactly this tag (release_authorized in common.sh). The publish job sets
# it right after its push, so this waits for it up to $PMX_AUTH_WAIT seconds (default
# 600). Runs no repository code but this script and common.sh; needs gh with
# statuses: read and actions: read.
#
#   release-auth.sh <tag> <sha>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"
tag="${1:-}" sha="${2:-}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-pmx\.[0-9]+$ && "$sha" =~ $PMX_SHA_RE ]] || { echo "usage: $0 <v<base>-pmx.<n>> <sha>" >&2; exit 2; }
deadline=$(( $(date +%s) + ${PMX_AUTH_WAIT:-600} ))
while :; do
  rc=0
  why="$(release_authorized "$tag" "$sha" 2>&1)" || rc=$?
  if [[ $rc -eq 0 ]]; then echo "$tag ($sha): $why"; exit 0; fi
  if [[ $(date +%s) -ge $deadline ]]; then
    echo "::error title=release not authorized::$tag ($sha): $why. Only a tag that provimux-ui-publish pushed, or one the owner authorized (SYNC.md, \"Release authorization\"), is built and promoted."
    exit 1
  fi
  echo "waiting for the release authorization of $tag ($why)"
  sleep 15
done

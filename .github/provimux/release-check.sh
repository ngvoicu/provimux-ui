#!/usr/bin/env bash
# provimux-ui release check (.github/provimux/SYNC.md, "Promotion"), run by the "smoke" job
# of provimux-ui-release.yml before the "promote" job makes a release the latest. Checks
# the PUBLISHED release as anyone downloads it; runs no repository code (bash, curl, jq,
# sha256sum or shasum, and gh for the release's metadata).
#
#   release-check.sh <tag> <dir> [<sha256>]
#
# <tag> v<base>-pmx.<n>, a published (not draft) release of $PMX_REPO with exactly the
# assets management.html and checksums.txt, both uploaded. Downloads them from their
# public URLs into <dir> and checks:
#   - sha256 of management.html = the line of checksums.txt (exactly
#     "<sha256>  management.html") = the API digest of the asset (= <sha256>, the build
#     job's, when given); checksums.txt matches its own API digest;
#   - one self-contained page: no external script or stylesheet, a doctype first;
#   - the title "Provimux by providers.dev";
#   - the MIT notice: every non-empty line of LICENSE ($PMX_LICENSE, default the
#     LICENSE of <tag> read with git show), in order, in the comment after the doctype;
#   - the version: the page carries "<tag>" (the build's VERSION).
# Each failure is an ::error line (the issue quotes them); exit 1 after all checks.
# Writes sha256=<sha256> and prerelease=<true|false> to $GITHUB_OUTPUT.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"

tag="${1:-}" dir="${2:-}" want="${3:-}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-pmx\.[0-9]+$ && -n "$dir" ]] || { echo "usage: $0 <v<base>-pmx.<n>> <dir> [sha256]" >&2; exit 2; }
[[ -z "$want" || "$want" =~ ^[0-9a-f]{64}$ ]] || { echo "release-check: '$want' is not a sha256" >&2; exit 2; }
fails=0
bad() { echo "::error title=release check $tag::$*"; fails=$((fails + 1)); }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
mkdir -p "$dir"

rel="$dir/release.json"
gh api "repos/$PMX_REPO/releases/tags/$tag" >"$rel" || { bad "cannot read release $tag of $PMX_REPO"; exit 1; }
jq -e --arg t "$tag" '.tag_name == $t and (.draft | not) and (.published_at // "") != ""' "$rel" >/dev/null ||
  { bad "$tag is not a published release"; exit 1; }
names="$(jq -r '[.assets[] | select(.state == "uploaded") | .name] | sort | join(" ")' "$rel")"
[[ "$names" == "checksums.txt management.html" && "$(jq '.assets | length' "$rel")" == 2 ]] ||
  { bad "the release's assets are '$(jq -r '[.assets[] | "\(.name) (\(.state))"] | join(", ")' "$rel")', not exactly management.html and checksums.txt, uploaded"; exit 1; }
for f in management.html checksums.txt; do
  url="$(jq -r --arg f "$f" '.assets[] | select(.name == $f) | .browser_download_url' "$rel")"
  [[ "$url" == "https://github.com/$PMX_REPO/releases/download/$tag/$f" ]] || { bad "$f's download URL is $url"; exit 1; }
  curl -fsSL --retry 3 -o "$dir/$f" "$url" || { bad "cannot download $url"; exit 1; }
done

# --- digests ---
page="$dir/management.html"
got="$(sha256 "$page")"
[[ "$(cat "$dir/checksums.txt")" == "$got  management.html" ]] ||
  bad "checksums.txt is '$(head -c 200 "$dir/checksums.txt" | tr '\n' ' ')', management.html is sha256 $got"
api="$(jq -r '.assets[] | select(.name == "management.html") | .digest // ""' "$rel")"
[[ "$api" == "sha256:$got" ]] || bad "the API digest of management.html is '$api', the file is sha256:$got"
api="$(jq -r '.assets[] | select(.name == "checksums.txt") | .digest // ""' "$rel")"
[[ "$api" == "sha256:$(sha256 "$dir/checksums.txt")" ]] || bad "the API digest of checksums.txt is '$api', not the file's"
[[ -z "$want" || "$got" == "$want" ]] || bad "management.html is sha256 $got, the build job built $want"

# --- the page ---
head -n 1 "$page" | grep -qix '<!doctype html>' || bad "management.html does not start with its doctype"
! grep -Eiq '<script[^>]*[[:space:]]src=|<link[^>]*rel="?stylesheet' "$page" || bad "management.html loads external scripts or stylesheets"
grep -Fq '<title>Provimux by providers.dev</title>' "$page" || bad "management.html lacks the title \"Provimux by providers.dev\""
grep -Fq -e "\"$tag\"" -e "\`$tag\`" "$page" || bad "management.html does not carry its version $tag"
lic="$dir/license.txt"
if [[ -n "${PMX_LICENSE:-}" ]]; then grep -v '^[[:space:]]*$' "$PMX_LICENSE" >"$lic"
else git show "refs/tags/$tag:LICENSE" 2>/dev/null | grep -v '^[[:space:]]*$' >"$lic" || true; fi
if [[ ! -s "$lic" ]]; then
  bad "no LICENSE to compare with (the tag's LICENSE, or \$PMX_LICENSE)"
elif [[ "$(sed -n 2p "$page")" != '<!--' ]]; then
  bad "management.html lacks the license comment after the doctype"
else
  awk 'NR > 2 && /^-->$/ { exit } NR > 2' "$page" | grep -Fxf "$lic" | diff -u "$lic" - >"$dir/license.diff" ||
    bad "management.html does not carry LICENSE's MIT notice (see the job log)"
  cat "$dir/license.diff"
fi

{ echo "sha256=$got"; echo "prerelease=$(jq -r '.prerelease' "$rel")"; } >>"${GITHUB_OUTPUT:-/dev/null}"
if [[ $fails -gt 0 ]]; then echo "release-check: $tag: $fails check(s) failed" >&2; exit 1; fi
echo "release-check: $tag: management.html sha256 $got matches checksums.txt and the API digest${want:+ and the build}; one page, title, MIT notice, version $tag"

#!/usr/bin/env bash
# provimux-ui release report (.github/provimux/SYNC.md, "Promotion"), the job "report"
# of provimux-ui-release.yml: a tag's release run that did not complete (a job failed,
# or was cancelled, e.g. a promotion waiting in the queue) reports itself, at once, in
# the issue "sync: v<base>" (opened, or retitled and updated), instead of waiting for a
# check's sweep. The issue lists every failed or cancelled job with its error
# annotations; a check closes it once the base's newest tag is released.
#
#   release-report.sh <v<base>-pmx.<n>> <run id>
#
# Env: GH_TOKEN (issues: write, actions: read, checks: read), PMX_REPO, RUN_URL,
# PMX_REPORT_DRY_RUN=1 prints instead. Runs gh and jq only.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"
tag="${1:-}" run="${2:-}"
[[ "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)-pmx\.[0-9]+$ ]] || { echo "usage: $0 <v<base>-pmx.<n>> <run id>" >&2; exit 2; }
base="${BASH_REMATCH[1]}"
[[ "$run" =~ ^[0-9]+$ ]] || { echo "usage: $0 <v<base>-pmx.<n>> <run id>" >&2; exit 2; }
tmp="$(mktemp -d "${TMPDIR:-/tmp}/provimux-ui-release-report.XXXXXX")"
trap 'rm -rf "${tmp:?}"' EXIT
fence() { echo '~~~~text'; sed 's/~~~/~ ~ ~/g' | cut -c1-400; echo '~~~~'; }

gh api "repos/$PMX_REPO/actions/runs/$run/jobs?per_page=100" \
  --jq '.jobs[] | select(.conclusion == "failure" or .conclusion == "cancelled") | "\(.name): \(.conclusion)"' >"$tmp/jobs.txt" ||
  echo "the jobs of run $run could not be read" >"$tmp/jobs.txt"
release_run_errors "$run" >"$tmp/errors.txt"
grep -q 'cancelled' "$tmp/jobs.txt" &&
  echo "a cancelled job (a promotion waiting in the queue, a timeout, or by hand) leaves the release as it was: a prerelease" >>"$tmp/errors.txt"
title="sync: v$base — release incomplete"
marker="<!-- provimux-ui-release $tag run=$run $(cat "$tmp/jobs.txt" "$tmp/errors.txt" | git hash-object --stdin) -->"
{
  echo "$marker"
  echo "**The release run of \`$tag\` did not complete**, so the release is not (or not yet) the latest. This run reports itself:"
  echo
  echo "Jobs that failed or were cancelled:"
  fence <"$tmp/jobs.txt"
  if [[ -s "$tmp/errors.txt" ]]; then echo "Why:"; fence <"$tmp/errors.txt"; fi
  echo "See \"Check a release\" in SYNC.md: fix a problem of the file in a new \`-pmx.<n+1>\`; rerun the failed jobs (\`gh run rerun $run --failed -R $PMX_REPO\`) when it was not the file's. A check closes this issue once the newest tag of this base is released."
  echo
  echo "Run: ${RUN_URL:-https://github.com/$PMX_REPO/actions/runs/$run}"
} >"$tmp/body.md"

if [[ -n "${PMX_REPORT_DRY_RUN:-}" ]]; then echo "title=$title"; cat "$tmp/body.md"; exit 0; fi
n="$(sync_issues "$base" | head -n 1)"
if [[ -z "$n" ]]; then
  gh issue create -R "$PMX_REPO" --title "$title" --body-file "$tmp/body.md"
elif [[ "$(gh api "repos/$PMX_REPO/issues/$n" --jq '.body' | head -n 1)" != "$marker" ]]; then
  gh issue edit "$n" -R "$PMX_REPO" --title "$title" --body-file "$tmp/body.md" >/dev/null
  gh issue comment "$n" -R "$PMX_REPO" --body "Now: **release incomplete**: the release run of \`$tag\` did not complete (the description shows it). ${RUN_URL:-}" >/dev/null
  echo "Updated #$n: $title"
else
  echo "#$n already says this"
fi

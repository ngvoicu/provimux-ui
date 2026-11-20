#!/usr/bin/env bash
# provimux-ui sync report (.github/provimux/SYNC.md), the "report" job of
# provimux-ui-check.yml: turns the check's result.json (or its absence) into the one issue
# "sync: v<base>". Adapted from Provimux's report.sh.
#
#   pass                     "sync: v<base> — ready to publish" (provimux-ui-publish.yml then
#                            publishes it, or retitles the issue and says why it cannot)
#   fail, error, no result   "sync: v<base> — failed", with the step and the details
#   incomplete               "sync: v<base> — release incomplete" (a v<base>-pmx.* tag
#                            whose release is not complete, e.g. still a prerelease
#                            because a promotion check failed, and whose release run
#                            ended; the release run's errors say why)
#   unreleased               "sync: v<base> — main on base, not released"
#   published                closes the open issue, only after this script verified it
#                            itself: for every v<base>-pmx.* tag, the GitHub release is
#                            public (not a draft, not a prerelease: promoted) with its
#                            assets and the newest provimux-ui-release run for the tag AT THE TAG'S
#                            COMMIT succeeded (releases_status in common.sh), and every
#                            job of the check succeeded. Otherwise it reports what it found.
#   in-progress              nothing (a release run for the tag's commit is still running)
#
# One open issue per base: an open one is edited (title and body); a comment is added
# when the status or the candidate changed. result.json comes from a job that ran
# upstream's code, so it is data: the tag and SHAs are checked against patterns, and
# every free text is shown inside code blocks.
#
# Env: RESULT (path to result.json; may not exist), CHECK_JOB (the check job's result:
# success, failure, cancelled, ...), TAG_HINT (the tag the check selected, if any),
# RUN_URL, GH_TOKEN with issues: write on PMX_REPO, PMX_REPORT_DRY_RUN=1 to print only
# (the release state is still read from GitHub).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"

result="${RESULT:-}"
check_job="${CHECK_JOB:-unknown}"
run_url="${RUN_URL:-}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/provimux-report.XXXXXX")"
trap 'rm -rf "${tmp:?}"' EXIT
body="$tmp/body.md"

if [[ -n "$result" && -s "$result" ]] && jq -e 'type == "object"' "$result" >/dev/null 2>&1; then
  r="$result"
else
  r="$tmp/result.json"
  jq -n --arg tag "${TAG_HINT:-}" --arg job "$check_job" \
    '{status: "error", step: "check job", upstream: {tag: $tag},
      reasons: ["the check job ended \"\($job)\" without a result.json (see the run log)"]}' >"$r"
fi
j() { jq -r "$1 // empty" "$r"; }
# isfalse PATH: the field is the boolean false (not "missing": `false // empty` is empty).
isfalse() { [[ "$(jq -r "$1 | tostring" "$r")" == false ]]; }

status="$(j .status)"
case "$status" in
  pass | fail | error | published | in-progress | incomplete | unreleased) ;;
  *) status=error ;;
esac
# A job that failed after writing "pass" is not a pass.
if [[ "$status" == pass && "$check_job" != success ]]; then
  status=error
  jq --arg job "$check_job" '.reasons += ["result.json says pass but the check job ended \"\($job)\""]' "$r" >"$tmp/r2" && r="$tmp/r2"
fi

tag="$(j .upstream.tag)"
[[ -n "$tag" ]] || tag="${TAG_HINT:-}"
if [[ "$tag" =~ $PMX_STABLE_RE ]]; then
  label="$tag"
else
  # Not a release tag (a bad manual input): a sanitized label, one issue per label.
  label="$(printf '%s' "$tag" | tr -cd 'A-Za-z0-9._-' | cut -c1-40)"
  [[ -n "$label" ]] || label="unknown"
  label="v${label#v}"
fi
base="${label#v}"

# published / in-progress / incomplete: verified here, never taken from result.json.
if [[ "$status" == published || "$status" == in-progress || "$status" == incomplete ]]; then
  : >"$tmp/rel-reasons.txt"
  if [[ "$label" =~ $PMX_STABLE_RE ]]; then
    rs="$(releases_status "$base" "$tmp/releases.json" "$tmp/rel-reasons.txt")"
  else
    rs=error; echo '[]' >"$tmp/releases.json"; echo "'$label' is not a release tag" >"$tmp/rel-reasons.txt"
  fi
  case "$rs" in
    published)
      if [[ "$check_job" != success ]]; then
        status=error
        echo "the releases look complete, but the check ended \"$check_job\"; not closing" >>"$tmp/rel-reasons.txt"
      else
        status=published
      fi
      ;;
    in-progress | incomplete) status=$rs ;;
    none) echo "result.json says $status, but no v$base-pmx.* tag exists" >>"$tmp/rel-reasons.txt"; status=error ;;
    *) status=error ;;
  esac
  jq --slurpfile rel "$tmp/releases.json" --rawfile why "$tmp/rel-reasons.txt" \
    '.release = $rel[0] | .reasons = ($why | split("\n") | map(select(length > 0)))' "$r" >"$tmp/r3" && r="$tmp/r3"
fi
sha() { local v; v="$(j "$1")"; [[ "$v" =~ $PMX_SHA_RE ]] && echo "$v" || echo ""; }
upstream_commit="$(sha .upstream.commit)"
old_main="$(sha .old.main)"
candidate="$(sha .candidate)"
old_base_tag="$(j .old.base_tag)"; [[ "$old_base_tag" =~ $PMX_STABLE_RE ]] || old_base_tag=''

# fence: free text as a code block that the text cannot close.
fence() { echo '~~~~text'; sed 's/~~~/~ ~ ~/g' | cut -c1-400; echo '~~~~'; }
list() { jq -r "$1" "$r" | fence; }

marker="<!-- provimux-sync status=$status candidate=${candidate:-none} -->"
case "$status" in
  pass) title="sync: $label — ready to publish" ;;
  fail | error) title="sync: $label — failed" ;;
  incomplete) title="sync: $label — release incomplete" ;;
  unreleased) title="sync: $label — main on base, not released" ;;
  *) title='' ;;
esac

{
  echo "$marker"
  case "$status" in
    pass)
      echo "**Ready to publish:** provimux-ui \`main\` rebased onto the upstream console [\`$tag\`](https://github.com/$PMX_UPSTREAM_REPO/releases/tag/$tag) (\`${upstream_commit:0:12}\`). \`provimux-ui-publish\` publishes it automatically once this check run has finished, and the release workflow promotes it to the latest release after checking it (SYNC.md, \"Publishing automatically\"); if either cannot, it says why here."
      echo
      echo "| | |"
      echo "|---|---|"
      echo "| old \`main\` | \`$old_main\` on \`$old_base_tag\` |"
      echo "| candidate | \`$candidate\`, $(j .commits) commits on \`$tag\` |"
      echo "| \`bun run verify\` | candidate: passes; pristine \`$tag\`: $(jq -r 'if .tests.tag.install == "success" and .tests.tag.verify == "success" then "passes" else "install \(.tests.tag.install), verify \(.tests.tag.verify)" end' "$r" | tr -cd 'A-Za-z0-9 ,.;:()_-') |"
      echo "| guard | ok |"
      [[ "$(sha .readme.old)" == "" ]] || echo "| root READMEs | the README commit \`$(sha .readme.old | cut -c1-12)\` re-applied as \`$(sha .readme.new | cut -c1-12)\` (normal form)$(jq -r '.readme.reapplied // [] | if length > 0 then "; reapplied at the rebase stop: " + join(", ") else "" end' "$r" | tr -cd 'A-Za-z0-9 ,.;:_-') |"
      echo
      nd="$(jq '.decisions.dropped | length' "$r")"; nc="$(jq '.decisions.changed | length' "$r")"; nw="$(jq '.decisions.new_workflows | length' "$r")"
      if [[ "$nd$nc$nw" == "000" ]]; then
        echo "**Decisions needed:** none (no layer commit dropped or changed, no new workflow file)."
      else
        echo "**Decisions needed** before publishing: \`publish.sh\` refuses until each is accepted by name (SYNC.md), so the automatic publish refuses and the owner publishes by hand."
        echo
        if [[ "$nd" != 0 ]]; then echo "Patches the rebase **dropped** (accept with \`--accept-dropped <sha,...>\`):"; list '.decisions.dropped[] | "\(.commit[0:12]) \(.subject)"'; fi
        if [[ "$nc" != 0 ]]; then echo "Patches the rebase **changed** (accept with \`--accept-changed <sha,...>\`):"; list '.decisions.changed[] | "\(.commit[0:12]) \(.subject)"'; fi
        if [[ "$nw" != 0 ]]; then echo "**New workflow files** in \`$tag\`: \`publish.sh\` refuses this release; follow \"New upstream workflow files\" in SYNC.md:"; list '.decisions.new_workflows[]'; fi
      fi
      echo
      echo "**Publish by hand** only if the automatic publish refused (it says so here). On the owner's Mac, in a worktree of \`upstream/main\` of provimux-ui; see \`.github/provimux/SYNC.md\`:"
      echo
      echo '```sh'
      echo "bash .github/provimux/publish.sh $tag --dry-run"
      echo "bash .github/provimux/publish.sh $tag"
      echo '```'
      echo
      ;;
    fail | error)
      echo "**The sync check for the upstream console \`$label\` failed** at step **$(j .step | tr -cd 'A-Za-z0-9 _-')**. Nothing was published."
      echo
      echo "Why:"
      list '.reasons[]?'
      if isfalse .rebase.ok; then
        echo "The rebase stopped at:"
        list '.rebase | "\(.stopped_at[0:12]) \(.subject)\nconflicting files:\n" + (.conflicts | map("  " + .) | join("\n"))'
        echo "If upstream took this patch in another form, see \"Upstream took a patch in another form\" in SYNC.md."
      fi
      if isfalse .tests.ok; then
        echo "\`bun install --frozen-lockfile\` / \`bun run verify\` (the test jobs' own step conclusions): candidate $(jq -r '"\(.tests.candidate.install) / \(.tests.candidate.verify)"' "$r" | tr -cd 'a-z /-'), pristine \`$label\` $(jq -r '"\(.tests.tag.install) / \(.tests.tag.verify)"' "$r" | tr -cd 'a-z /-'). Their output is in the jobs' logs:"
        for w in candidate tag; do
          u="$(j ".tests.$w.job")"
          [[ "$u" =~ ^https://github\.com/[A-Za-z0-9._/-]+$ ]] && echo "- test ($w): $u"
        done
        echo
      fi
      if isfalse .guard.ok; then echo "Guard:"; list '.guard.output'; fi
      echo "Fix it by hand following \`.github/provimux/SYNC.md\`. The next check (every 3 hours, or Actions → provimux-ui-check → Run workflow) updates this issue."
      ;;
    incomplete)
      echo "**The newest provimux-ui tag for \`$label\` has no complete release**, and its release run is not running."
      echo
      list '.reasons[]?'
      echo "Releases:"
      list '.release[]? | "\(.tag) (\(.sha[0:12] // "?")): release \(.release), release run for that commit \(.run)"'
      echo "A release that stayed a prerelease failed a promotion check (the errors above): fix the cause in a new \`-pmx.<n+1>\`, or, if the check itself was wrong, rerun the failed jobs (\`gh run rerun <id> --failed -R $PMX_REPO\`). A failed build or publish job: rerun it. See \"Check a release\" in SYNC.md. A check closes this issue once the newest tag of this base is released (its failed predecessors stay listed)."
      ;;
    unreleased)
      echo "**\`main\` is already on \`$label\` but no \`v$base-pmx.*\` tag exists.** This is the state between the two pushes of \"New upstream workflow files\" in SYNC.md."
      echo
      list '.reasons[]?'
      echo "Finish that procedure (push the two tags, SYNC.md)."
      ;;
  esac
  echo
  echo "Run: $run_url"
  if [[ "$status" == pass || "$status" == fail ]] && [[ -n "$(j .range_diff)" ]]; then
    echo
    echo "<details><summary>git range-diff old base..old main vs new base..candidate</summary>"
    echo
    jq -r '.range_diff' "$r" | head -c 50000 | fence
    echo
    echo "</details>"
  fi
} >"$body"

# close_released ISSUE BASE REASONS: closes ISSUE for a released base, keeping the history
# of its failed earlier tags (the "history:" lines of REASONS) in the comment.
close_released() {
  {
    echo "Verified: the newest \`v$2-pmx.*\` release is public, promoted and complete, and its provimux-ui-release run for the tag's commit succeeded. $run_url"
    if grep -q '^ *history: ' "$3"; then echo; echo "Earlier tags of this base that failed (kept for the record):"; sed -n 's/^ *history: //p' "$3" | fence; fi
  } >"$tmp/close.md"
  gh issue close "$1" -R "$PMX_REPO" --comment "$(cat "$tmp/close.md")" >/dev/null
  echo "Closed #$1"
}

# sweep: every other base whose newest -pmx tag has no complete release (a failed
# automatic or hand-pushed tag, on any base), reported in its own "sync: v<base>" issue;
# and every other open sync issue whose base is now released, closed with its history.
sweep() {
  local bases b rs n t marker
  bases="$(unreleased_bases)" || { echo "sweep: cannot list the releases" >&2; return 0; }
  for b in $bases; do
    [[ "$b" != "$base" ]] || continue
    : >"$tmp/sw-reasons.txt"
    rs="$(releases_status "$b" "$tmp/sw.json" "$tmp/sw-reasons.txt")"
    [[ "$rs" == incomplete ]] || continue
    t="sync: v$b — release incomplete"
    marker="<!-- provimux-sync status=incomplete reasons=$(git hash-object --stdin <"$tmp/sw-reasons.txt") -->"
    {
      echo "$marker"
      echo "**The newest provimux-ui tag for \`v$b\` has no complete release** (found by the check's sweep of every tag; it may have been pushed by hand)."
      echo
      fence <"$tmp/sw-reasons.txt"
      echo "Releases:"
      jq -r '.[] | "\(.tag) (\(.sha[0:12])): release \(.release), release run for that commit \(.run)"' "$tmp/sw.json" | fence
      echo "See \"Check a release\" in SYNC.md. A check closes this issue once the newest tag of this base is released."
      echo
      echo "Run: $run_url"
    } >"$tmp/sw-body.md"
    if [[ -n "${PMX_REPORT_DRY_RUN:-}" ]]; then echo "sweep: $t"; cat "$tmp/sw-body.md"; continue; fi
    n="$(sync_issues "$b" | head -n 1)"
    if [[ -z "$n" ]]; then
      gh issue create -R "$PMX_REPO" --title "$t" --body-file "$tmp/sw-body.md"
    elif [[ "$(gh api "repos/$PMX_REPO/issues/$n" --jq '.body' | head -n 1)" != "$marker" ]]; then
      gh issue edit "$n" -R "$PMX_REPO" --title "$t" --body-file "$tmp/sw-body.md" >/dev/null
      gh issue comment "$n" -R "$PMX_REPO" --body "Now: **release incomplete** (the description shows this run). $run_url" >/dev/null
      echo "Updated #$n: $t"
    fi
  done
  [[ -z "${PMX_REPORT_DRY_RUN:-}" ]] || return 0
  gh api --paginate "repos/$PMX_REPO/issues?state=open&per_page=100" \
    --jq '.[] | select(.pull_request == null) | .title | capture("^sync: v(?<b>[0-9]+\\.[0-9]+\\.[0-9]+)( |$)").b' 2>/dev/null | sort -u |
    while IFS= read -r b; do
      if [[ "$b" == "$base" ]] || grep -qxF "$b" <<<"$bases"; then continue; fi
      : >"$tmp/sw-reasons.txt"
      [[ "$(releases_status "$b" "$tmp/sw.json" "$tmp/sw-reasons.txt")" == published ]] || continue
      for n in $(sync_issues "$b"); do close_released "$n" "$b" "$tmp/sw-reasons.txt"; done
    done
}

if [[ -n "${PMX_REPORT_DRY_RUN:-}" ]]; then
  echo "status=$status title=${title:-<none>}"
  cat "$body"
  sweep
  exit 0
fi

numbers="$(sync_issues "$base")"
number="$(head -n 1 <<<"$numbers")"

case "$status" in
  published)
    for n in $numbers; do
      close_released "$n" "$base" "$tmp/rel-reasons.txt"
    done
    [[ -n "$numbers" ]] || echo "Published; no open issue for $label."
    ;;
  in-progress)
    echo "Release run in progress for $label; nothing to report."
    ;;
  *)
    if [[ -n "$number" ]]; then
      before="$(gh api "repos/$PMX_REPO/issues/$number" --jq '.body' | head -n 1)"
      gh issue edit "$number" -R "$PMX_REPO" --title "$title" --body-file "$body" >/dev/null
      if [[ "$before" != "$marker" ]]; then
        gh issue comment "$number" -R "$PMX_REPO" --body "Now: **${title#"sync: $label — "}** (the description shows this run). $run_url" >/dev/null
      fi
      echo "Updated #$number: $title"
    else
      gh issue create -R "$PMX_REPO" --title "$title" --body-file "$body"
    fi
    ;;
esac
sweep

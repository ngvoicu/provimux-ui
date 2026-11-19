# provimux-ui releases

A release is one file, `management.html` (the console, with its scripts, styles, fonts and the MIT notice of
`LICENSE` inlined), and `checksums.txt` (its sha256). `.github/workflows/provimux-ui-release.yml` builds, publishes,
checks and promotes it; nothing is uploaded or promoted by hand. Each new upstream console release is released
automatically (`SYNC.md`): `provimux-ui-check` passes it, `provimux-ui-publish` pushes `main` and `v<base>-pmx.1`.

## Versions

`v<base>-pmx.<n>`: `<base>` is the upstream console release the tree is built on (`v1.28.3`), `<n>` counts the
provimux-ui releases on that base from 1. The first release is `v1.28.3-pmx.1`. The build's `VERSION` is the tag,
so the System page shows it as the console version.

The workflow refuses a tag whose base is not the tree's: `<base>` must be the newest release tag of
[the upstream console](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) whose commit is an ancestor
of the tagged commit (`.github/provimux/release-meta.sh`, read from upstream's tags, not local ones). The tag must be
on `main` and pass `guard.sh` with that base.

## Making a release by hand

For a change of the layer between upstream releases (a `-pmx.<n+1>` on the same base); new upstream releases need no
step (`SYNC.md`).

1. Land the commits on `main` (guard and `bun run verify` green), then try the workflow without publishing: Actions,
   `provimux-ui-release`, Run workflow on `main` (or `gh workflow run provimux-ui-release.yml --ref main`). The dry
   run builds `v<base>-pmx.0-dryrun` and uploads it as the run's `release` artifact.
2. Authorize the release, then tag the commit on `main` and push the tag to GitHub, then to the NAS mirror. Only the
   owner may create `v*` tags (ruleset "v* tags: admins only"), and the release workflow builds and promotes a tag only
   when its commit carries the status `provimux-ui-release` for exactly that tag (`SYNC.md`, "Release
   authorization"):

   ```bash
   gh api -X POST repos/ngvoicu/provimux-ui/statuses/$(git rev-parse main) -f state=success \
     -f context=provimux-ui-release -f description=v1.28.3-pmx.2 -f target_url=https://github.com/ngvoicu/provimux-ui
   git tag -a v1.28.3-pmx.2 -m 'provimux-ui v1.28.3-pmx.2' main
   git push upstream v1.28.3-pmx.2
   git push origin v1.28.3-pmx.2
   ```

3. The workflow publishes the release as a **prerelease** (GitHub's latest release, which Provimux's and
   CLIProxyAPI's console updater reads, skips prereleases), then checks the published file and loads it in a
   headless browser against a stub of the management API (job `smoke`), and only then makes it the latest release
   (job `promote`). If a check fails it stays a prerelease and the run is red: fix it in a new `-pmx.<n+1>` (a tag
   is never moved and a published asset is never replaced), or rerun the failed jobs when the failure was not the
   file's. `SYNC.md`, "Promotion" and "Check a release".

## What the workflow does

| Job | Permissions | Runs |
|---|---|---|
| `build` | `contents`, `statuses`, `actions: read`, checkout without a stored credential | `release-meta.sh` (version and base), on a tag push `release-auth.sh` (the release authorization, `SYNC.md`), `guard.sh` (with that base), `bun install --frozen-lockfile`, `bun run verify`, `bun run build` with `VERSION=<tag>`; checks the file (single page, version, title, the whole `LICENSE` notice in the comment after the doctype), writes `checksums.txt` and the release notes, uploads them as the `release` artifact. |
| `publish` | `contents: write`, `GITHUB_TOKEN` only; tag pushes only | No checkout and no repository script. Creates a draft prerelease from the artifact, checks each asset's digest, publishes it, then checks the public release again. A rerun never replaces an asset: a published release must already hold the run's files, a draft left by a failed run gets only its missing assets. |
| `smoke` | `contents: read` | `release-check.sh` on the published release (sha256 = `checksums.txt` = API digest = the build's; one page; title; MIT notice; version), then `smoke.mjs`: chrome-headless-shell whose only proxy is a stub of the management API (login page renders, sign-in reaches the stub, nothing of the whole browser leaves the stub). |
| `promote` | `contents: write`, `GITHUB_TOKEN` only; one at a time in the repository | No checkout and no repository script. After `smoke`: the release authorization, an immutable release whose digest is still the checked one, the latest release read for certain and not newer; `gh release edit <tag> --prerelease=false --latest`, read back (a failed edit or readback is reported). |

A manual run with the input `release=<tag>` runs only `smoke` and `promote` against that published release; `promote`
says what it would do and changes nothing.

Actions are pinned by commit. The release notes say which upstream release the console is built on, what Provimux's
layer is, and link to the README and to the original's release.

## Checking a download

```bash
curl -fLO https://github.com/ngvoicu/provimux-ui/releases/download/v1.28.3-pmx.1/management.html
curl -fLO https://github.com/ngvoicu/provimux-ui/releases/download/v1.28.3-pmx.1/checksums.txt
sha256sum -c checksums.txt   # macOS: shasum -a 256 -c checksums.txt
```

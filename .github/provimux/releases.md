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
2. Tag the commit on `main` and push the tag to GitHub, then to the NAS mirror:

   ```bash
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
| `build` | `contents: read`, checkout without a stored credential | `release-meta.sh` (version and base), `guard.sh` (with that base), `bun install --frozen-lockfile`, `bun run verify`, `bun run build` with `VERSION=<tag>`; checks the file (single page, version, title, the whole `LICENSE` notice in the comment after the doctype), writes `checksums.txt` and the release notes, uploads them as the `release` artifact. |
| `publish` | `contents: write`, `GITHUB_TOKEN` only; tag pushes only | No checkout and no repository script. Creates a draft prerelease from the artifact, checks each asset's digest, publishes it, then checks the public release again. A rerun never replaces an asset: a published release must already hold the run's files, a draft left by a failed run gets only its missing assets. |
| `smoke` | `contents: read` | `release-check.sh` on the published release (sha256 = `checksums.txt` = API digest = the build's; one page; title; MIT notice; version), then `smoke.mjs`: headless Chrome against a stub of the management API (login page renders, sign-in reaches the stub, no request leaves 127.0.0.1). |
| `promote` | `contents: write`, `GITHUB_TOKEN` only | No checkout and no repository script. After `smoke`: the digest is still the checked one, no newer release is the latest; `gh release edit <tag> --prerelease=false --latest`, read back. |

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

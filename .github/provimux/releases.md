# provimux-ui releases

A release is one file, `management.html` (the console, with its scripts, styles, fonts and the MIT notice of
`LICENSE` inlined), and `checksums.txt` (its sha256). `.github/workflows/provimux-ui-release.yml` builds and
publishes it; nothing is uploaded by hand.

## Versions

`v<base>-pmx.<n>`: `<base>` is the upstream console release the tree is built on (`v1.28.3`), `<n>` counts the
provimux-ui releases on that base from 1. The first release is `v1.28.3-pmx.1`. The build's `VERSION` is the tag,
so the System page shows it as the console version.

The workflow refuses a tag whose base is not the tree's: `<base>` must be the newest release tag of
[the upstream console](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) whose commit is an ancestor
of the tagged commit (`.github/provimux/release-meta.sh`, read from upstream's tags, not local ones). The tag must be
on `main` and pass `guard.sh` with that base.

## Making a release

1. Land the commits on `main` (guard and `bun run verify` green), then try the workflow without publishing: Actions,
   `provimux-ui-release`, Run workflow on `main` (or `gh workflow run provimux-ui-release.yml --ref main`). The dry
   run builds `v<base>-pmx.0-dryrun` and uploads it as the run's `release` artifact.
2. Tag the commit on `main` and push the tag to GitHub, then to the NAS mirror:

   ```bash
   git tag -a v1.28.3-pmx.2 -m 'provimux-ui v1.28.3-pmx.2' main
   git push upstream v1.28.3-pmx.2
   git push origin v1.28.3-pmx.2
   ```

3. The workflow publishes the release as a **prerelease**. Every release starts as one: GitHub's latest release,
   which Provimux's and CLIProxyAPI's console updater reads (`releases/latest`), skips prereleases, so the new file
   reaches no install yet.
4. Try the release's `management.html` with a Provimux binary on a spare port (temporary config and auth folder, a
   throwaway management key, `MANAGEMENT_STATIC_PATH` pointing at the file, `disable-auto-update-panel: true`): sign
   in, check the title, the brand and the version on the System page.
5. If it works, make it the latest release:

   ```bash
   gh release edit v1.28.3-pmx.2 --repo ngvoicu/provimux-ui --prerelease=false --latest
   ```

   If it does not, leave it a prerelease (or delete the release and its tag) and fix it in a new `-pmx.<n+1>`.
   A tag is never moved and a published asset is never replaced.

## What the workflow does

| Job | Permissions | Runs |
|---|---|---|
| `build` | `contents: read`, checkout without a stored credential | `release-meta.sh` (version and base), `guard.sh` (with that base), `bun install --frozen-lockfile`, `bun run verify`, `bun run build` with `VERSION=<tag>`; checks the file (single page, version, title, the whole `LICENSE` notice in the comment after the doctype), writes `checksums.txt` and the release notes, uploads them as the `release` artifact. |
| `publish` | `contents: write`, `GITHUB_TOKEN` only; tag pushes only | No checkout and no repository script. Creates a draft prerelease from the artifact, checks each asset's digest, publishes it, then checks the public release again. A rerun never replaces an asset: a published release must already hold the run's files, a draft left by a failed run gets only its missing assets. |

Actions are pinned by commit. The release notes say which upstream release the console is built on, what Provimux's
layer is, and link to the README and to the original's release.

## Checking a download

```bash
curl -fLO https://github.com/ngvoicu/provimux-ui/releases/download/v1.28.3-pmx.1/management.html
curl -fLO https://github.com/ngvoicu/provimux-ui/releases/download/v1.28.3-pmx.1/checksums.txt
sha256sum -c checksums.txt   # macOS: shasum -a 256 -c checksums.txt
```

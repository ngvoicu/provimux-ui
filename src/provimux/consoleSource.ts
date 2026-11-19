/**
 * Which console release this is, and where the server downloads it from (`management.panel-github-repository`).
 *
 * The server's rules, mirrored:
 * - Provimux (internal/managementasset/updater.go, PUI-11): an empty value, provimux-ui's address or the original
 *   console's address all mean provimux-ui; another GitHub repository is used as given; anything else falls back to
 *   provimux-ui.
 * - Stock CLIProxyAPI: an empty or unusable value means the original console; a GitHub repository is used as given.
 * Both check for a new release every 3 hours unless `management.disable-auto-update-panel` is on.
 */

export const PROVIMUX_UI_REPO = 'ngvoicu/provimux-ui';
export const ORIGINAL_CONSOLE_REPO = 'router-for-me/Cli-Proxy-API-Management-Center';

/** GitHub's numeric ids of the two repositories (api.github.com/repositories/<id>), as Provimux's updater knows them. */
const REPOSITORY_IDS: Record<string, string> = {
  '1051566067': ORIGINAL_CONSOLE_REPO,
  '1463889407': PROVIMUX_UI_REPO,
};

export type ConsoleBuild =
  { kind: 'release'; version: string; base: string } | { kind: 'dev'; version: string };

const RELEASE = /^v?(\d+\.\d+\.\d+)-pmx\.\d+$/i;

/** `v1.28.3-pmx.1` is provimux-ui's release on the Management Center v1.28.3; anything else is a development build. */
export function describeConsoleBuild(version: string | null | undefined): ConsoleBuild {
  const value = (version ?? '').trim() || 'dev';
  const match = RELEASE.exec(value);
  return match
    ? { kind: 'release', version: value, base: `v${match[1]}` }
    : { kind: 'dev', version: value };
}

/** "owner/repo" of a GitHub repository address (github.com or api.github.com), as written; null when it is not one. */
export function githubRepositoryOf(address: string | null | undefined): string | null {
  const value = (address ?? '').trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let segments = url.pathname.split('/').filter(Boolean);
  if (host === 'api.github.com') {
    if (segments[0] === 'repositories' && segments[1]) return REPOSITORY_IDS[segments[1]] ?? null;
    if (segments[0] !== 'repos') return null;
    segments = segments.slice(1);
  } else if (host !== 'github.com' && host !== 'www.github.com') {
    return null;
  }
  if (segments.length < 2) return null;
  return `${segments[0]}/${segments[1].replace(/\.git$/i, '')}`;
}

const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();

export type ConsoleSourceReason =
  /** nothing configured: the server's default */
  | 'default'
  /** the configured repository */
  | 'configured'
  /** Provimux: the original console's address counts as its default, provimux-ui */
  | 'original_as_default'
  /** not a GitHub repository: the server uses its default */
  | 'invalid_as_default';

export interface ConsoleSource {
  /** "owner/repo" the server downloads from. */
  repository: string;
  reason: ConsoleSourceReason;
}

export function describeConsoleSource(
  configured: string | null,
  server: 'provimux' | 'cliproxyapi'
): ConsoleSource {
  const fallback = server === 'provimux' ? PROVIMUX_UI_REPO : ORIGINAL_CONSOLE_REPO;
  if (!configured || !configured.trim()) return { repository: fallback, reason: 'default' };
  const repository = githubRepositoryOf(configured);
  if (repository === null) return { repository: fallback, reason: 'invalid_as_default' };
  if (server === 'provimux' && same(repository, ORIGINAL_CONSOLE_REPO)) {
    return { repository: PROVIMUX_UI_REPO, reason: 'original_as_default' };
  }
  return { repository, reason: 'configured' };
}

export const githubUrl = (repository: string) => `https://github.com/${repository}`;

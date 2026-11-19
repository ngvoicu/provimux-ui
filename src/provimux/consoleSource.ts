/**
 * Which console release this is, and where the server's updater fetches new releases from
 * (`management.panel-github-repository`): the "update source" on the System page.
 *
 * The updater's rules, ported line by line so the page never names another publisher than the server picks:
 * - Provimux (provimux main, internal/managementasset/updater.go: `resolveReleaseURL`, `isDefaultPanelRepository`):
 *   an empty value, or any spelling of provimux-ui or of the original console, means provimux-ui; otherwise as stock.
 * - Stock CLIProxyAPI v8.0.78 (`resolveReleaseURL`, as `upstreamResolveReleaseURL` in Provimux's
 *   updater_provimux_test.go): an api.github.com address is used with `/releases/latest` added; a github.com
 *   repository becomes its API address; anything else, `www.github.com` and `github.com:443` included, falls back to
 *   the server's default.
 * Both read the value with Go's `net/url`, so `goParse` below follows `url.Parse`. tests/provimux/consoleSource.test.ts
 * checks both against a table the server's own functions produced (fixtures/panel-repository-resolver.json).
 * Both check for a new release every 3 hours unless `management.disable-auto-update-panel` is on.
 */

export const PROVIMUX_UI_REPO = 'ngvoicu/provimux-ui';
export const ORIGINAL_CONSOLE_REPO = 'router-for-me/Cli-Proxy-API-Management-Center';
const RELEASE_URL = (repository: string) =>
  `https://api.github.com/repos/${repository}/releases/latest`;
export const PROVIMUX_DEFAULT_RELEASE_URL = RELEASE_URL(PROVIMUX_UI_REPO);
export const STOCK_DEFAULT_RELEASE_URL = RELEASE_URL(ORIGINAL_CONSOLE_REPO);

/* ---------- this console's release ---------- */

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

/* ---------- Go's url.Parse, as far as the updater uses it ---------- */

interface GoURL {
  scheme: string;
  opaque: string;
  user: string | null;
  /** Host with port, as written (Go keeps its case). */
  host: string;
  /** Unescaped path. */
  path: string;
  rawQuery: string;
  forceQuery: boolean;
  fragment: string;
}

const isHex = (c: string) => /^[0-9a-fA-F]$/.test(c);

/** url.unescape: %XX sequences decoded to bytes; a broken sequence is an error (null). */
function unescape(s: string, mode: 'path' | 'host' | 'user' | 'fragment'): string | null {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '%') {
      if (i + 2 >= s.length || !isHex(s[i + 1]) || !isHex(s[i + 2])) return null;
      // In a host, %-escapes may only produce non-ASCII bytes, except %25 (RFC 6874).
      if (mode === 'host' && parseInt(s[i + 1], 16) < 8 && s.slice(i, i + 3) !== '%25') return null;
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 3;
      continue;
    }
    if (mode === 'host' && c.charCodeAt(0) < 0x80 && hostCharNeedsEscape(c)) return null;
    const point = String.fromCodePoint(s.codePointAt(i) ?? 0);
    bytes.push(...encoder.encode(point));
    i += point.length;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** url.shouldEscape(c, encodeHost) for ASCII: what a host may not contain. */
const hostCharNeedsEscape = (c: string) => !/^[A-Za-z0-9\-_.~!$&'()*+,;=:[\]<>"]$/.test(c);

/** url.validOptionalPort */
const validOptionalPort = (port: string) => port === '' || /^:\d*$/.test(port);

/** url.validUserinfo */
const validUserinfo = (s: string) => /^[A-Za-z0-9\-._:~!$&'()*+,;=%@]*$/.test(s);

/** url.parseHost: brackets and port checked, escapes decoded. */
function parseHost(host: string): string | null {
  if (host.startsWith('[')) {
    const close = host.lastIndexOf(']');
    if (close < 0 || !validOptionalPort(host.slice(close + 1))) return null;
  } else {
    const colon = host.lastIndexOf(':');
    if (colon !== -1 && !validOptionalPort(host.slice(colon))) return null;
  }
  return unescape(host, 'host');
}

/** url.Parse (not via a request). null where Go returns an error. */
export function goParse(raw: string): GoURL | null {
  const hashAt = raw.indexOf('#');
  const main = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : unescape(raw.slice(hashAt + 1), 'fragment');
  if (fragment === null) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(main)) return null;

  // getScheme
  let scheme = '';
  let rest = main;
  for (let i = 0; i < main.length; i++) {
    const c = main[i];
    if (/[A-Za-z]/.test(c)) continue;
    if (/[0-9+\-.]/.test(c)) {
      if (i === 0) break;
      continue;
    }
    if (c === ':') {
      if (i === 0) return null; // missing protocol scheme
      scheme = main.slice(0, i).toLowerCase();
      rest = main.slice(i + 1);
    }
    break;
  }

  let rawQuery = '';
  let forceQuery = false;
  if (rest.endsWith('?') && rest.split('?').length === 2) {
    forceQuery = true;
    rest = rest.slice(0, -1);
  } else {
    const q = rest.indexOf('?');
    if (q !== -1) {
      rawQuery = rest.slice(q + 1);
      rest = rest.slice(0, q);
    }
  }

  const base = {
    scheme,
    opaque: '',
    user: null,
    host: '',
    path: '',
    rawQuery,
    forceQuery,
    fragment,
  };
  if (!rest.startsWith('/')) {
    if (scheme !== '') return { ...base, opaque: rest };
    // A relative reference whose first segment has a colon is an error.
    const slash = rest.indexOf('/');
    if ((slash === -1 ? rest : rest.slice(0, slash)).includes(':')) return null;
  }

  let user: string | null = null;
  let host = '';
  if ((scheme !== '' || !rest.startsWith('///')) && rest.startsWith('//')) {
    let authority = rest.slice(2);
    const slash = authority.indexOf('/');
    if (slash !== -1) {
      rest = authority.slice(slash);
      authority = authority.slice(0, slash);
    } else {
      rest = '';
    }
    const at = authority.lastIndexOf('@');
    let hostPart = authority;
    if (at !== -1) {
      const userinfo = authority.slice(0, at);
      if (!validUserinfo(userinfo) || unescape(userinfo, 'user') === null) return null;
      user = userinfo;
      hostPart = authority.slice(at + 1);
    }
    const parsedHost = parseHost(hostPart);
    if (parsedHost === null) return null;
    host = parsedHost;
  }

  const path = unescape(rest, 'path');
  if (path === null) return null;
  return { ...base, user, host, path };
}

/** URL.Hostname: the host without its port and brackets. */
function hostname(host: string): string {
  let name = host;
  const colon = name.lastIndexOf(':');
  if (colon !== -1 && validOptionalPort(name.slice(colon))) name = name.slice(0, colon);
  if (name.startsWith('[') && name.endsWith(']')) name = name.slice(1, -1);
  return name;
}

/** url.escape for a path or a fragment: what Go writes back in URL.String. */
function escape(s: string, mode: 'path' | 'fragment'): string {
  const keep = mode === 'path' ? /[A-Za-z0-9\-_.~$&+,/:;=@]/ : /[A-Za-z0-9\-_.~$&+,/:;=?@!()*]/;
  let out = '';
  for (const byte of new TextEncoder().encode(s)) {
    const c = String.fromCharCode(byte);
    out += byte < 0x80 && keep.test(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** URL.String for an absolute URL whose path the updater changed. */
function goString(u: GoURL): string {
  let out = u.scheme ? `${u.scheme}:` : '';
  if (u.opaque) {
    out += u.opaque;
  } else {
    if (u.scheme || u.host || u.user !== null) {
      if (u.host || u.path || u.user !== null) out += '//';
      if (u.user !== null) out += `${u.user}@`;
      out += u.host;
    }
    const path = escape(u.path, 'path');
    if (path && path[0] !== '/' && u.host) out += '/';
    out += path;
  }
  if (u.forceQuery || u.rawQuery) out += `?${u.rawQuery}`;
  if (u.fragment) out += `#${escape(u.fragment, 'fragment')}`;
  return out;
}

/* ---------- the updaters' resolvers ---------- */

/** GitHub's ids of the two repositories, as Provimux's updater knows them (api.github.com/repositories/<id>). */
const PROVIMUX_UI_ID = '1463889407';
const ORIGINAL_ID = '1051566067';

/**
 * Provimux's isDefaultPanelRepository, saying which of the two it names: provimux-ui or the original console
 * (by owner/name in any case, with or without ".git", on github.com, www.github.com or api.github.com, or by id).
 */
export function provimuxDefaultName(repo: string): 'provimux-ui' | 'original' | null {
  const parsed = goParse(repo);
  if (parsed === null) return null;
  let segments = parsed.path.toLowerCase().split('/').filter(Boolean);
  const host = hostname(parsed.host).toLowerCase();
  if (host === 'api.github.com' && segments.length >= 2 && segments[0] === 'repositories') {
    // strconv.ParseUint: digits only; leading zeros allowed.
    if (!/^\d+$/.test(segments[1])) return null;
    const id = segments[1].replace(/^0+(?=\d)/, '');
    return id === PROVIMUX_UI_ID ? 'provimux-ui' : id === ORIGINAL_ID ? 'original' : null;
  }
  if (host === 'api.github.com' && segments.length >= 1 && segments[0] === 'repos') {
    segments = segments.slice(1);
  } else if (host !== 'github.com' && host !== 'www.github.com') {
    return null;
  }
  if (segments.length < 2) return null;
  const name = `${segments[0]}/${segments[1].replace(/\.git$/, '')}`;
  if (name === PROVIMUX_UI_REPO) return 'provimux-ui';
  if (name === ORIGINAL_CONSOLE_REPO.toLowerCase()) return 'original';
  return null;
}

/** How a value resolved: the URL the updater requests, and which branch of the resolver produced it. */
export interface ResolvedRelease {
  url: string;
  branch: 'empty' | 'named-default' | 'api' | 'github' | 'fallback';
}

/** Stock CLIProxyAPI's resolveReleaseURL (v8.0.78), with its default passed in. */
export function upstreamResolveRelease(repo: string, defaultUrl: string): ResolvedRelease {
  const value = repo.trim();
  if (value === '') return { url: defaultUrl, branch: 'empty' };
  const parsed = goParse(value);
  if (parsed === null || parsed.host === '') return { url: defaultUrl, branch: 'fallback' };
  const host = parsed.host.toLowerCase();
  const path = parsed.path.endsWith('/') ? parsed.path.slice(0, -1) : parsed.path;
  if (host === 'api.github.com') {
    const withLatest = path.toLowerCase().endsWith('/releases/latest')
      ? path
      : `${path}/releases/latest`;
    return { url: goString({ ...parsed, path: withLatest }), branch: 'api' };
  }
  if (host === 'github.com') {
    const parts = path.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length >= 2 && parts[0] !== '' && parts[1] !== '') {
      return {
        url: RELEASE_URL(`${parts[0]}/${parts[1].replace(/\.git$/, '')}`),
        branch: 'github',
      };
    }
  }
  return { url: defaultUrl, branch: 'fallback' };
}

/** Provimux's resolveReleaseURL. */
export function provimuxResolveRelease(repo: string): ResolvedRelease {
  const value = repo.trim();
  if (value === '') return { url: PROVIMUX_DEFAULT_RELEASE_URL, branch: 'empty' };
  if (provimuxDefaultName(value) !== null) {
    return { url: PROVIMUX_DEFAULT_RELEASE_URL, branch: 'named-default' };
  }
  return upstreamResolveRelease(value, PROVIMUX_DEFAULT_RELEASE_URL);
}

/* ---------- what the System page says ---------- */

export type UpdateSourceReason =
  /** nothing configured: the server's default */
  | 'default'
  /** the configured repository */
  | 'configured'
  /** Provimux: the original console's address counts as its default, provimux-ui */
  | 'original_as_default'
  /** a value the updater cannot use: it falls back to its default */
  | 'unusable_as_default';

export interface UpdateSource {
  /** What the updater requests. */
  releaseUrl: string;
  /** "owner/repo" when the release URL is a repository's; null (an id, another API path): show the URL. */
  repository: string | null;
  reason: UpdateSourceReason;
}

const REPOSITORY_RELEASE =
  /^https:\/\/api\.github\.com\/repos\/([^/?#]+)\/([^/?#]+)\/releases\/latest$/i;

export function describeUpdateSource(
  configured: string | null,
  server: 'provimux' | 'cliproxyapi'
): UpdateSource {
  const value = configured ?? '';
  const resolved =
    server === 'provimux'
      ? provimuxResolveRelease(value)
      : upstreamResolveRelease(value, STOCK_DEFAULT_RELEASE_URL);
  const match = REPOSITORY_RELEASE.exec(resolved.url);
  const repository = match ? `${match[1]}/${match[2]}` : null;
  let reason: UpdateSourceReason;
  switch (resolved.branch) {
    case 'empty':
      reason = 'default';
      break;
    case 'named-default':
      reason =
        provimuxDefaultName(value.trim()) === 'original' ? 'original_as_default' : 'configured';
      break;
    case 'fallback':
      reason = 'unusable_as_default';
      break;
    default:
      reason = 'configured';
  }
  return { releaseUrl: resolved.url, repository, reason };
}

export const githubUrl = (repository: string) => `https://github.com/${repository}`;

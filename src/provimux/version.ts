/**
 * Provimux versions are CLIProxyAPI versions with a Provimux suffix: `8.0.78-pmx.1` is Provimux's first release
 * on CLIProxyAPI 8.0.78. The server sends its version in the `X-CPA-Version` header.
 */

const PROVIMUX_SUFFIX = /-pmx\.\d+$/i;

export type ServerVersionInfo =
  | { kind: 'provimux'; version: string; base: string }
  | { kind: 'cliproxyapi'; version: string };

/** The CLIProxyAPI version a Provimux version is based on, or null when it is not a Provimux version. */
export function provimuxBaseVersion(version: string | null | undefined): string | null {
  const value = (version ?? '').trim();
  if (!PROVIMUX_SUFFIX.test(value)) return null;
  const base = value.replace(PROVIMUX_SUFFIX, '').replace(/^v/i, '');
  return base || null;
}

/** What the connected server is: Provimux (with its base), another CLIProxyAPI build, or unknown (null). */
export function describeServerVersion(version: string | null | undefined): ServerVersionInfo | null {
  const value = (version ?? '').trim();
  if (!value) return null;
  const base = provimuxBaseVersion(value);
  return base ? { kind: 'provimux', version: value, base } : { kind: 'cliproxyapi', version: value };
}

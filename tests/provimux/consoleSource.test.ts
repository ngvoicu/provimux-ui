// The System page's update source (T-78, finding 3): the console resolves management.panel-github-repository exactly
// as the server's updater does. fixtures/panel-repository-resolver.json was produced by the server's own functions,
// run with go1.27.3: resolveReleaseURL and isDefaultPanelRepository from Provimux main 8b943f74
// (internal/managementasset/updater.go) and upstreamResolveReleaseURL, stock v8.0.78's resolver, from
// updater_provimux_test.go. Its inputs are every spelling those server tests use, plus edge cases (ports, user info,
// queries, bad escapes, IPv6, scheme-less forms, control characters).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  PROVIMUX_DEFAULT_RELEASE_URL,
  STOCK_DEFAULT_RELEASE_URL,
  describeConsoleBuild,
  describeUpdateSource,
  provimuxDefaultName,
  provimuxResolveRelease,
  upstreamResolveRelease,
} from '../../src/provimux/consoleSource';

interface Row {
  input: string;
  provimux: string;
  provimuxDefault: boolean;
  stock: string;
}
const rows = JSON.parse(
  readFileSync('tests/provimux/fixtures/panel-repository-resolver.json', 'utf8')
) as Row[];

describe('the updaters, as the server runs them', () => {
  test('the table covers the server tests and the review cases', () => {
    expect(rows.length).toBeGreaterThanOrEqual(74);
    const inputs = rows.map((row) => row.input);
    expect(inputs).toContain('https://api.github.com/repositories/1296269');
    expect(inputs).toContain('https://www.github.com/review-org/review-panel');
    expect(inputs).toContain(
      'HTTPS://GitHub.COM:443/Router-For-Me/cli-proxy-api-management-center'
    );
    expect(inputs).toContain('git@github.com:someone/my-panel.git');
  });

  test.each(rows.map((row) => [JSON.stringify(row.input), row] as const))(
    'Provimux: %s',
    (_, row) => {
      expect(provimuxResolveRelease(row.input).url).toBe(row.provimux);
      expect(provimuxDefaultName(row.input.trim()) !== null).toBe(row.provimuxDefault);
    }
  );

  test.each(rows.map((row) => [JSON.stringify(row.input), row] as const))(
    'stock CLIProxyAPI v8.0.78: %s',
    (_, row) => {
      expect(upstreamResolveRelease(row.input, STOCK_DEFAULT_RELEASE_URL).url).toBe(row.stock);
    }
  );
});

describe('what the System page names', () => {
  test('a numeric repository id the updater uses is shown as its URL, not as the default', () => {
    // Review: the page said "not a GitHub repository … the server's default" while the updater used this id.
    expect(
      describeUpdateSource('https://api.github.com/repositories/1296269', 'provimux')
    ).toMatchObject({
      releaseUrl: 'https://api.github.com/repositories/1296269/releases/latest',
      repository: null,
      reason: 'configured',
    });
  });

  test('www.github.com is not a repository the updater reads: it falls back to the default', () => {
    // Review: the page named review-org/review-panel while the updater fetched provimux-ui.
    expect(
      describeUpdateSource('https://www.github.com/review-org/review-panel', 'provimux')
    ).toMatchObject({
      releaseUrl: PROVIMUX_DEFAULT_RELEASE_URL,
      repository: 'ngvoicu/provimux-ui',
      reason: 'unusable_as_default',
    });
    expect(
      describeUpdateSource('https://www.github.com/review-org/review-panel', 'cliproxyapi')
    ).toMatchObject({
      releaseUrl: STOCK_DEFAULT_RELEASE_URL,
      repository: 'router-for-me/Cli-Proxy-API-Management-Center',
      reason: 'unusable_as_default',
    });
  });

  test("the original console's address on Provimux, and the defaults", () => {
    expect(
      describeUpdateSource(
        'https://www.github.com/router-for-me/Cli-Proxy-API-Management-Center',
        'provimux'
      )
    ).toMatchObject({ repository: 'ngvoicu/provimux-ui', reason: 'original_as_default' });
    expect(
      describeUpdateSource('https://github.com/NGVOICU/Provimux-UI.git', 'provimux')
    ).toMatchObject({ repository: 'ngvoicu/provimux-ui', reason: 'configured' });
    expect(describeUpdateSource(null, 'provimux')).toMatchObject({
      repository: 'ngvoicu/provimux-ui',
      reason: 'default',
    });
    expect(describeUpdateSource('  ', 'cliproxyapi')).toMatchObject({
      repository: 'router-for-me/Cli-Proxy-API-Management-Center',
      reason: 'default',
    });
  });

  test('a custom repository keeps the spelling the updater requests', () => {
    expect(
      describeUpdateSource('ssh://git@github.com/someone/my-panel.git', 'provimux')
    ).toMatchObject({
      releaseUrl: 'https://api.github.com/repos/someone/my-panel/releases/latest',
      repository: 'someone/my-panel',
      reason: 'configured',
    });
    expect(
      describeUpdateSource('https://api.github.com/repos/someone/my-panel?per_page=1', 'provimux')
    ).toMatchObject({
      // T-83: the query is not shown, so the publisher is named and the address marked as reduced.
      releaseUrl: 'https://api.github.com/repos/someone/my-panel/releases/latest?per_page=1',
      repository: 'someone/my-panel',
      hidden: true,
      reason: 'configured',
    });
  });

  test('the label is "Update source", in every language', () => {
    const strings = JSON.parse(readFileSync('src/provimux/locales/en.json', 'utf8'));
    expect(strings.provimux.console.update_source).toBe('Update source:');
    expect(JSON.stringify(strings.provimux.console)).not.toContain('Downloaded from');
    const source = readFileSync('src/provimux/components/ProvimuxConsoleSource.tsx', 'utf8');
    expect(source).toContain("t('provimux.console.update_source')");
  });
});

describe('this console', () => {
  test('a release names its Management Center base; anything else is a development build', () => {
    expect(describeConsoleBuild('v1.28.3-pmx.1')).toEqual({
      kind: 'release',
      version: 'v1.28.3-pmx.1',
      base: 'v1.28.3',
    });
    expect(describeConsoleBuild('v1.28.3-pmx.1-1-ga8aa588e').kind).toBe('dev');
    expect(describeConsoleBuild('')).toEqual({ kind: 'dev', version: 'dev' });
  });
});

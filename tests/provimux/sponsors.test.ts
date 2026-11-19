// Sponsors and affiliate links hidden (PUI-07): the three seams, and no affiliate link anywhere.
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hideSponsor, hideSponsorNav } from '../../src/provimux/sponsors';

const read = (path: string) => readFileSync(path, 'utf8');
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

describe('the three seams', () => {
  test('Quick Start leaves the sidebar, wherever upstream puts it', () => {
    const groups = [
      { id: 'operate', items: [{ path: '/' }, { path: '/quick-start' }] },
      { id: 'gateway', items: [{ path: '/ai-providers' }, { kind: 'drawer', id: 'x', children: [] }] },
    ];
    hideSponsorNav(groups);
    expect(groups[0].items).toEqual([{ path: '/' }]);
    expect(groups[1].items).toHaveLength(2);
    expect(read('src/components/layout/MainLayout.tsx')).toMatch(
      /\];\n {2}hideSponsorNav\(navGroups\);\n {2}const navItems = navGroups/
    );
  });

  test('the Quick Start route goes to AI Providers', () => {
    const routes = read('src/router/MainRoutes.tsx');
    expect(routes).toContain(
      "{ path: '/quick-start', element: <Navigate to=\"/ai-providers\" replace /> },"
    );
    expect(routes).not.toContain('fixedBrand="apikeyFun"');
  });

  test('the proxy row shows no sponsor', () => {
    expect(hideSponsor({ name: 'x', url: 'https://example.com' })).toBeUndefined();
    expect(read('src/features/config/components/fields/sharedFields.tsx')).toContain(
      'const sponsor = hideSponsor(SPONSORS[0]);'
    );
  });
});

describe('affiliate links', () => {
  // The stylesheet rule that hides them: a[href*='…'] and a[href^='…'] selectors.
  const css = read('src/provimux/theme/_sponsors.scss');
  const selectors = [...css.matchAll(/a\[href(\*|\^)='([^']+)'\]/g)].map(([, op, value]) => ({
    op,
    value,
  }));
  const hidden = (url: string) =>
    selectors.some(({ op, value }) => (op === '*' ? url.includes(value) : url.startsWith(value)));

  // Every URL in the source that is an affiliate link: a referral parameter, or a constant named so.
  const REFERRAL = /[?&](aff|ref|referral|invite|invitecode|keyword|promo|coupon|via|utm_[a-z]+)=/i;
  const affiliateUrls = sourceFiles('src')
    .filter((path) => !path.startsWith(join('src', 'provimux')))
    .flatMap((path) =>
      read(path)
        .split('\n')
        .flatMap((line, index, lines) => {
          const urls = [...line.matchAll(/['"`](https?:\/\/[^'"`\s$]+)/g)].map((m) => m[1]);
          // A value on its own line belongs to the declaration that ends the line above with "=".
          const above = lines[index - 1] ?? '';
          const declaration = /=\s*$/.test(above) ? `${above} ${line}` : line;
          return urls
            .filter((url) => REFERRAL.test(url) || /AFFILIATE|SPONSOR|signUp/i.test(declaration))
            .map((url) => ({ path, url }));
        })
    );

  test('the source has the affiliate links this test expects to find', () => {
    const urls = affiliateUrls.map(({ url }) => url);
    expect(urls).toContain('https://apikey.fan/register?aff=AKCPA');
    expect(urls).toContain('https://platform.kimi.com/?aff=cliproxyapi');
    expect(urls).toContain('https://bestproxy.com/?keyword=ayh7otlb');
    expect(urls).toContain('https://s.qiniu.com/miI73q');
  });

  test('every one is hidden by the stylesheet', () => {
    expect(affiliateUrls.filter(({ url }) => !hidden(url))).toEqual([]);
  });

  test('the line that only introduces a hidden link goes with it', () => {
    expect(css).toContain("p:has(> a[href*='aff='])");
    expect(read('src/features/oauth/components/OAuthFlowDialog.tsx')).toMatch(
      /<p className=\{styles\.hint\}>[\s\S]*?<a className=\{styles\.inlineLink\} href=\{sponsor\.url\}/
    );
  });
});

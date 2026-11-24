/**
 * The Dashboard's "Where to go from here" (owner, 2026-11-24): Accounts, Models and Routing first, then the rest of
 * upstream's cards; AI Providers and Auth Files are in the menu under Advanced settings, not here. Upstream's list is
 * hard-coded, so its one seam wraps it (provimuxDashboardLinks); the theme gives the first three a row of their own.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import * as sass from 'sass';
import i18n from '../../src/i18n/index';
import { DashboardPage } from '../../src/features/dashboard/DashboardPage';
import { provimuxDashboardLinks } from '@/provimux/dashboard';

const read = (path: string) => readFileSync(path, 'utf8');

describe("the Dashboard leads to Provimux's pages", () => {
  test("Accounts, Models and Routing first, then the rest in upstream's order; the replaced pages left out", () => {
    const t = ((key: string) => key) as never;
    const upstream = ['/ai-providers', '/auth-files', '/config', '/quota', '/logs', '/system'].map(
      (to) => ({
        to,
        icon: null,
        title: to,
      })
    );
    expect(provimuxDashboardLinks(upstream, t).map((card) => card.to)).toEqual([
      '/provimux/accounts',
      '/provimux/models',
      '/routing',
      '/config',
      '/quota',
      '/logs',
      '/system',
    ]);
    // A card upstream adds later stays, in its place; one Provimux already shows is not repeated.
    const later = [
      ...upstream,
      { to: '/routing', icon: null, title: 'r' },
      { to: '/x', icon: null, title: 'x' },
    ];
    expect(
      provimuxDashboardLinks(later, t)
        .map((card) => card.to)
        .slice(-2)
    ).toEqual(['/system', '/x']);
  });

  test("the page renders them, titled in the menu's words", async () => {
    await i18n.changeLanguage('en');
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(DashboardPage))
    );
    const section = html.slice(html.indexOf(i18n.t('dashboard.cta_title')));
    const cards = [
      ...section.matchAll(/<a[^>]*href="([^"]+)"[\s\S]*?<span>([^<]+)<\/span><span aria-hidden/g),
    ].map((m) => [m[1], m[2]]);
    expect(cards).toEqual([
      ['/provimux/accounts', 'Accounts'],
      ['/provimux/models', 'Models'],
      ['/routing', i18n.t('nav.routing')],
      ['/config', i18n.t('nav.config_management')],
      ['/quota', i18n.t('nav.quota_management')],
      ['/logs', i18n.t('nav.logs')],
      ['/system', i18n.t('nav.system_info')],
    ]);
  });

  test('one seam in DashboardPage.tsx, and the theme lays out three, then four', () => {
    const page = read('src/features/dashboard/DashboardPage.tsx');
    expect(page).toContain("import { provimuxDashboardLinks, provimuxDashboardTo } from '@/provimux';");
    expect(page).toContain('const ctaCards = provimuxDashboardLinks([');
    expect(page).toContain('  ], t);');
    const css = sass.compile('src/provimux/theme/_dashboard.scss').css;
    expect(css).toContain(
      '[class*=dashboard-module__ctaGrid___]:has(> a[href$="/provimux/accounts"])'
    );
    expect(css).toContain('grid-template-columns: repeat(12, minmax(0, 1fr));');
    expect(read('src/provimux/theme/index.scss')).toContain("@use './dashboard';");
  });
});

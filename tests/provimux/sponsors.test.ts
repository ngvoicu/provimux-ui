// Sponsors and affiliate links hidden (PUI-07, T-45, T-49): the seams, configured sponsor keys still reachable,
// and no referral link visible on the pages that carry them.
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import * as sass from 'sass';
import i18n from '../../src/i18n/index';
import { OAuthPage } from '../../src/features/oauth/OAuthPage';
import { OAuthFlowDialog } from '../../src/features/oauth/components/OAuthFlowDialog';
import { OAUTH_PROVIDERS, isSponsor } from '../../src/features/oauth/providers';
import { ProviderCategoryList } from '../../src/features/providers/components/ProviderCategoryList';
import { ProviderResourcePanel } from '../../src/features/providers/components/ProviderResourcePanel';
import { PROVIDER_BRAND_ORDER } from '../../src/features/providers/descriptors';
import {
  getSponsorProviderDefinition,
  isMultiProtocolSponsorBrand,
} from '../../src/features/providers/sponsorDefinitions';
import type { ProviderBrand, ProviderGroup } from '../../src/features/providers/types';
import { buildProviderGroups } from '../../src/features/providers/useProviderWorkbench';
import { PROVIMUX_LINKS } from '../../src/provimux/brand';
import {
  SPONSOR_GROUP_BRANDS,
  hideSponsor,
  hideSponsorNav,
  noQuickFill,
  offersCreate,
  providerGroupsWithoutOffers,
} from '../../src/provimux/sponsors';
import type { Config } from '../../src/types';

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

const read = (path: string) => readFileSync(path, 'utf8');
const sourceFiles = (dir: string, pattern: RegExp): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path, pattern)
      : pattern.test(name)
        ? [path]
        : [];
  });
const unescape = (value: string) =>
  value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
/** Every link a rendered page holds: href and the markup around it. */
const links = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => unescape(m[1]));

// Sponsors with an affiliate sign-up (Kimi is a provider with its own API and stays listed).
const AFFILIATE_SPONSORS = PROVIDER_BRAND_ORDER.filter(
  (brand) =>
    isMultiProtocolSponsorBrand(brand) &&
    brand !== 'kimi' &&
    Boolean(getSponsorProviderDefinition(brand).affiliateUrl)
);

describe('seams', () => {
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

  test('AI Providers builds its groups without offers, and draws no Quick Fill list', () => {
    expect(read('src/features/providers/ProvidersWorkbenchPage.tsx')).toContain(
      ': providerGroupsWithoutOffers(allGroups),'
    );
    expect(read('src/features/providers/components/ProviderCategoryList.tsx')).toContain(
      'const QUICK_FILL_BRANDS: ReadonlySet<ProviderBrand> = new Set(noQuickFill(QUICK_FILL_BRAND_ORDER));'
    );
    expect(noQuickFill(['fennoAI', 'qiniuCloud'])).toEqual([]);
  });
});

describe('AI Providers sponsor groups', () => {
  const groupsFor = (config: Config) => providerGroupsWithoutOffers(buildProviderGroups(config));
  const renderList = (groups: ProviderGroup[]) =>
    renderToStaticMarkup(
      createElement(ProviderCategoryList, { groups, activeBrand: 'gemini', onSelect: () => {} })
    );
  const name = (brand: ProviderBrand) => `>${i18n.t(`providersPage.providerNames.${brand}`)}<`;
  const codexUrl = (brand: ProviderBrand) =>
    getSponsorProviderDefinition(brand as Parameters<typeof getSponsorProviderDefinition>[0])
      .baseUrlOptions[0].codexBaseUrl;

  // An operator's keys: one ordinary Codex key and one key at each sponsor's Codex address.
  const configured = {
    codexApiKeys: [
      { apiKey: 'sk-own', baseUrl: 'https://api.openai.com/v1' },
      ...SPONSOR_GROUP_BRANDS.map((brand, index) => ({
        apiKey: `sk-sponsor-${index}`,
        baseUrl: codexUrl(brand as ProviderBrand),
      })),
    ],
  } as unknown as Config;

  test('every sponsor with an affiliate sign-up is a group the layer knows', () => {
    expect(AFFILIATE_SPONSORS.length).toBeGreaterThan(0);
    expect(AFFILIATE_SPONSORS.filter((brand) => !SPONSOR_GROUP_BRANDS.includes(brand))).toEqual([]);
    const quickFill = read('src/features/providers/components/ProviderCategoryList.tsx').match(
      /QUICK_FILL_BRAND_ORDER[^=]*=\s*\[([^\]]*)\]/
    )?.[1];
    const brands = [...(quickFill ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(brands.length).toBeGreaterThan(0);
    expect(brands.filter((brand) => !SPONSOR_GROUP_BRANDS.includes(brand))).toEqual([]);
  });

  test('with nothing configured, no sponsor is offered and there is one list', async () => {
    await i18n.changeLanguage('en');
    const groups = groupsFor({} as Config);
    expect(groups.map((group) => group.id).filter((id) => SPONSOR_GROUP_BRANDS.includes(id))).toEqual(
      []
    );
    const html = renderList(groups);
    expect(html.match(/<aside\b/g) ?? []).toHaveLength(1);
    expect(html).not.toContain(i18n.t('providersPage.categories.quickFill'));
    for (const brand of AFFILIATE_SPONSORS) expect(html).not.toContain(name(brand));
  });

  test('configured sponsor keys stay reachable: every configured key is listed', async () => {
    await i18n.changeLanguage('en');
    const all = buildProviderGroups(configured);
    const shown = groupsFor(configured);
    const count = (groups: ProviderGroup[]) =>
      groups.reduce((total, group) => total + group.resources.length, 0);
    // Upstream holds the sponsor keys in the sponsor groups, not in Codex.
    expect(all.find((group) => group.id === 'codex')?.resources).toHaveLength(1);
    for (const brand of SPONSOR_GROUP_BRANDS) {
      expect(shown.find((group) => group.id === brand)?.resources.length).toBeGreaterThan(0);
    }
    expect(count(shown)).toBe(count(all));
    expect(count(shown)).toBeGreaterThanOrEqual(1 + SPONSOR_GROUP_BRANDS.length);
    // Listed with the other providers: one list, no Quick Fill heading.
    const html = renderList(shown);
    expect(html.match(/<aside\b/g) ?? []).toHaveLength(1);
    expect(html).not.toContain(i18n.t('providersPage.categories.quickFill'));
    for (const brand of SPONSOR_GROUP_BRANDS) expect(html).toContain(name(brand as ProviderBrand));
  });

  test('each configured sponsor key is a row with edit, delete and an on/off switch', async () => {
    await i18n.changeLanguage('en');
    for (const group of groupsFor(configured).filter((g) => SPONSOR_GROUP_BRANDS.includes(g.id))) {
      const html = renderToStaticMarkup(
        createElement(ProviderResourcePanel, {
          group,
          filter: '',
          onFilterChange: () => {},
          filteredResources: group.resources,
          selectedId: null,
          onView: () => {},
          onEdit: () => {},
          onDelete: () => {},
          onToggleDisabled: () => {},
          onCreate: () => {},
        })
      );
      expect(html).toContain(`aria-label="${i18n.t('providersPage.actions.edit')}"`);
      expect(html).toContain(`aria-label="${i18n.t('providersPage.actions.delete')}"`);
      expect(html).toMatch(/<input[^>]*type="checkbox"/);
    }
  });

  test('a remembered sponsor selection with nothing configured falls back to the first provider', () => {
    expect(read('src/features/providers/ProvidersWorkbenchPage.tsx')).toMatch(
      /groups\.some\(\(group\) => group\.id === uiState\.activeBrand\)\s*\? uiState\.activeBrand\s*: firstVisibleBrand/
    );
  });
});

// T-54: "New" on a listed sponsor group opened a blank form whose save replaced the group's saved key.
describe('no "New" on a sponsor group', () => {
  const page = () => read('src/features/providers/ProvidersWorkbenchPage.tsx');
  const configured = {
    codexApiKeys: SPONSOR_GROUP_BRANDS.map((brand, index) => ({
      apiKey: `sk-sponsor-${index}`,
      baseUrl: getSponsorProviderDefinition(
        brand as Parameters<typeof getSponsorProviderDefinition>[0]
      ).baseUrlOptions[0].codexBaseUrl,
    })),
  } as unknown as Config;
  const empty = buildProviderGroups({} as Config);
  const renderPanel = (group: ProviderGroup, filteredResources: ProviderGroup['resources']) =>
    renderToStaticMarkup(
      createElement(ProviderResourcePanel, {
        group,
        filter: filteredResources.length ? '' : 'no-such-key',
        onFilterChange: () => {},
        filteredResources,
        selectedId: null,
        onView: () => {},
        onEdit: () => {},
        onDelete: () => {},
        onToggleDisabled: () => {},
        onCreate: () => {},
      })
    );
  const newButton = () => `<span>${i18n.t('providersPage.actions.new')}</span>`;

  test('sponsor groups offer no "New"; every other provider does', () => {
    for (const brand of SPONSOR_GROUP_BRANDS) expect(offersCreate(brand)).toBe(false);
    const others = PROVIDER_BRAND_ORDER.filter((brand) => !SPONSOR_GROUP_BRANDS.includes(brand));
    expect(others).toContain('codex');
    expect(others).toContain('openaiCompatibility');
    for (const brand of others) expect(offersCreate(brand)).toBe(true);
  });

  test('the page header shows "New" only for a group that offers it', () => {
    expect(page()).toContain('showNewAction={!fixedBrand && offersCreate(activeGroup.id)}');
    // Every way to open the create form goes through openCreate, used by exactly the header and the panel.
    expect(page().match(/mode: 'create'/g) ?? []).toHaveLength(1);
    expect(page().match(/\bopenCreate\b/g) ?? []).toHaveLength(3); // its definition, the header, the panel
    expect(page()).toContain('onNew={openCreate}');
    expect(page()).toContain('onCreate={openCreate}');
    // The other header (no group listed) has a disabled "New" that does nothing.
    expect(page()).toMatch(/onNew=\{\(\) => \{\}\}\s*isNewDisabled\s/);
  });

  test('a populated sponsor group: no "New" on an empty search; edit, delete and the switch stay', async () => {
    await i18n.changeLanguage('en');
    const sponsors = providerGroupsWithoutOffers(buildProviderGroups(configured)).filter((group) =>
      SPONSOR_GROUP_BRANDS.includes(group.id)
    );
    expect(sponsors.map((group) => group.id).sort()).toEqual([...SPONSOR_GROUP_BRANDS].sort());
    for (const group of sponsors) {
      expect(group.resources.length).toBeGreaterThan(0);
      expect(renderPanel(group, [])).not.toContain(newButton());
      const rows = renderPanel(group, group.resources);
      expect(rows).not.toContain(newButton());
      expect(rows).toContain(`aria-label="${i18n.t('providersPage.actions.view')}"`);
      expect(rows).toContain(`aria-label="${i18n.t('providersPage.actions.edit')}"`);
      expect(rows).toContain(`aria-label="${i18n.t('providersPage.actions.delete')}"`);
      expect(rows).toMatch(/<input[^>]*type="checkbox"/);
    }
  });

  test('Codex and OpenAI Compatible keep "New" on an empty list', async () => {
    await i18n.changeLanguage('en');
    for (const brand of ['codex', 'openaiCompatibility']) {
      const group = empty.find((g) => g.id === brand);
      expect(group).toBeDefined();
      expect(renderPanel(group as ProviderGroup, [])).toContain(newButton());
    }
  });
});

describe('referral links', () => {
  // The stylesheet as the browser gets it, and its link rules as matchers.
  const css = sass.compile('src/provimux/theme/_sponsors.scss').css;
  const linkRule = css.slice(0, css.indexOf('{'));
  const matchers = [...linkRule.matchAll(/a\[href(\*|\^)="([^"]+)"( i)?\]/g)].map(
    ([, op, value, flag]) => ({ op, value, insensitive: Boolean(flag) })
  );
  const hidden = (href: string) =>
    matchers.some(({ op, value, insensitive }) => {
      const subject = insensitive ? href.toLowerCase() : href;
      const needle = insensitive ? value.toLowerCase() : value;
      return op === '*' ? subject.includes(needle) : subject.startsWith(needle);
    });

  // A referral is a query parameter that pays someone for a sign-up.
  const REFERRAL =
    /[?&](aff|affiliate|ref|referral|invite|invitecode|invite_code|keyword|promo|promo_code|coupon|via)=/i;
  const isReferral = (href: string) => REFERRAL.test(href);

  test('the rule hides every referral parameter the test knows, and keeps ordinary links', () => {
    expect(matchers.length).toBeGreaterThan(20);
    for (const param of ['aff', 'ref', 'referral', 'invite', 'invitecode', 'keyword', 'promo', 'coupon', 'via']) {
      expect(hidden(`https://example.com/?${param}=x`)).toBe(true);
      expect(hidden(`https://example.com/path?a=1&${param.toUpperCase()}=x`)).toBe(true);
    }
    const ordinary = [
      ...Object.values(PROVIMUX_LINKS),
      'https://help.router-for.me/',
      'https://apikey.fan/dashboard',
      'https://platform.kimi.com/console',
      'https://github.com/router-for-me/CLIProxyAPI?tab=readme-ov-file',
    ];
    expect(ordinary.filter(hidden)).toEqual([]);
    // The line that only introduces a hidden link goes too, and so does the Kimi offer.
    expect(css).toContain('p:has(> a[href*="?aff=" i])');
    expect(css).toContain('[class*=ProviderResourcePanel-module__kimiPromo___]');
  });

  // What the pages that carry sponsor links render.
  const rendered = async () => {
    await i18n.changeLanguage('en');
    const pages: ReactElement[] = [
      createElement(MemoryRouter, null, createElement(OAuthPage)),
      ...PROVIDER_BRAND_ORDER.map((brand) =>
        createElement(ProviderResourcePanel, {
          group: { id: brand, resources: [] },
          filter: '',
          onFilterChange: () => {},
          filteredResources: [],
          selectedId: null,
          onView: () => {},
          onEdit: () => {},
          onDelete: () => {},
          onCreate: () => {},
        })
      ),
      ...OAUTH_PROVIDERS.filter(isSponsor).map((card) =>
        createElement(OAuthFlowDialog, {
          open: true,
          providerId: card.id,
          heading: { title: card.id, caption: '', icon: '' },
          state: { status: 'idle' } as never,
          text: (suffix: string) => suffix,
          supportsCallback: false,
          sponsor: { url: card.sponsor.signUpUrl, label: 'Sign up' },
          onStart: () => {},
          onCancel: () => {},
          onCallbackChange: () => {},
          onCallbackSubmit: () => {},
          onViewAuthFiles: () => {},
          onClose: () => {},
        })
      ),
    ];
    return pages.map((page) => renderToStaticMarkup(page)).join('\n');
  };

  // Affiliate addresses in the source, code and JSON: a referral parameter, or a constant named for one.
  const declared = sourceFiles('src', /\.(ts|tsx|json)$/)
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
            .filter((url) => isReferral(url) || /AFFILIATE|signUp/i.test(declaration))
            .map((url) => ({ path, url }));
        })
    );
  const affiliate = new Set(declared.map(({ url }) => url));

  test('every referral or affiliate link the pages render is hidden', async () => {
    const hrefs = links(await rendered());
    const referrals = hrefs.filter((href) => isReferral(href) || affiliate.has(href));
    // Not vacuous: the Kimi sign-up links (OAuth card, login dialog, AI Providers) and the reseller sign-ups.
    expect(referrals.some((href) => href.includes('platform.kimi'))).toBe(true);
    expect(referrals.length).toBeGreaterThanOrEqual(4);
    expect(referrals.filter((href) => !hidden(href))).toEqual([]);
  });

  test('every affiliate address in the source (code and JSON) is hidden', () => {
    const urls = declared.map(({ url }) => url);
    expect(urls).toContain('https://apikey.fan/register?aff=AKCPA');
    expect(urls).toContain('https://platform.kimi.com/?aff=cliproxyapi');
    expect(urls).toContain('https://bestproxy.com/?keyword=ayh7otlb');
    expect(urls).toContain('https://s.qiniu.com/miI73q');
    expect(declared.filter(({ url }) => !hidden(url))).toEqual([]);
  });
});

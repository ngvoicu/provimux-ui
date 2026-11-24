// Sponsors and affiliate links hidden (PUI-07, T-45, T-49): the seams, configured sponsor keys still reachable,
// and no referral link visible on the pages that carry them.
// Since upstream 1.29.0 AI Providers is a provider strip (BrandTabs), a panel of cards (BrandPanel) and an
// "Add provider" catalogue (ProviderPicker).
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { provimuxNav } from '../../src/provimux/nav';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import * as sass from 'sass';
import i18n from '../../src/i18n/index';
import { OAuthPage } from '../../src/features/oauth/OAuthPage';
import { OAuthFlowDialog } from '../../src/features/oauth/components/OAuthFlowDialog';
import { OAUTH_PROVIDERS, isSponsor } from '../../src/features/oauth/providers';
import { BrandPanel } from '../../src/features/providers/components/BrandPanel';
import { BrandTabs } from '../../src/features/providers/components/BrandTabs';
import { ProviderPicker } from '../../src/features/providers/components/ProviderPicker';
import { PROVIDER_BRAND_ORDER } from '../../src/features/providers/descriptors';
import {
  QUICK_FILL_BRAND_ORDER,
  getConnectionFormTarget,
  partitionProviderGroups,
} from '../../src/features/providers/resourceView';
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
  groupsToAdd,
  hideSponsorNav,
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
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
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

// The theme as the browser gets it.
const sponsorCss = sass.compile('src/provimux/theme/_sponsors.scss').css;
/** Whether the theme hides an element of an upstream CSS module outright. */
const hiddenByTheme = (module: string, local: string) =>
  new RegExp(
    `(^|[,}]\\s*)\\[class\\*=${module}-module__${local}___\\][^{]*\\{\\s*display: none !important;`
  ).test(sponsorCss);

// AI Providers' parts, rendered as the page renders them.
const noop = () => {};
/** The strip, with the page's order and its quick-connect invitation (ProvidersWorkbenchPage.tsx). */
const renderStrip = (groups: ProviderGroup[]) => {
  const { providers, quickFill } = partitionProviderGroups(groups);
  return renderToStaticMarkup(
    createElement(BrandTabs, {
      groups: [...providers, ...quickFill],
      activeBrand: 'gemini',
      onSelect: noop,
      tabId: (brand: ProviderBrand) => `tab-${brand}`,
      panelId: 'panel',
      onAdd: noop,
      partnerBrands: quickFill.filter((group) => group.resources.length === 0).map((g) => g.id),
    })
  );
};
const panelElement = (
  group: ProviderGroup,
  resources: ProviderGroup['resources'] = group.resources,
  filter = ''
) =>
  createElement(BrandPanel, {
    id: 'panel',
    labelledBy: `tab-${group.id}`,
    group,
    resources,
    nativeSections: group.nativeSections,
    controls: {
      filter,
      onFilterChange: noop,
      sortBy: 'name',
      sortDir: 'asc',
      onSortBy: noop,
      onSortDir: noop,
      availableModels: [],
      selectedModels: new Set<string>(),
      onSelectedModelsChange: noop,
      onClearFilters: noop,
    },
    selectedId: null,
    disableMutations: false,
    usageByProvider: new Map(),
    onView: noop,
    onEdit: noop,
    onDelete: noop,
    onToggleDisabled: noop,
    onCreate: noop,
    onEditGroup: noop,
    onToggleGroup: noop,
  });
const renderPanel = (...args: Parameters<typeof panelElement>) =>
  renderToStaticMarkup(panelElement(...args));
const renderPicker = (groups: ProviderGroup[]) =>
  renderToStaticMarkup(createElement(ProviderPicker, { groups, variant: 'page', onPick: noop }));

describe('seams', () => {
  test('Quick Start leaves the sidebar, wherever upstream puts it', () => {
    const groups = [
      { id: 'operate', items: [{ path: '/' }, { path: '/quick-start' }] },
      {
        id: 'gateway',
        items: [{ path: '/ai-providers' }, { kind: 'drawer', id: 'x', children: [] }],
      },
    ];
    hideSponsorNav(groups);
    expect(groups[0].items).toEqual([{ path: '/' }]);
    expect(groups[1].items).toHaveLength(2);
    // The sidebar's seam is Provimux's nav, which hides sponsors before adding its pages (PUI-15/16).
    expect(read('src/components/layout/MainLayout.tsx')).toMatch(
      /\];\n {2}provimuxNav\(navGroups, useProvimuxPages\(\)\);\n {2}const navItems = navGroups/
    );
    const viaNav = [{ id: 'operate', items: [{ path: '/' }, { path: '/quick-start' }] }];
    provimuxNav(viaNav, {
      modelRoutes: { status: 'unsupported', message: null },
      liveLists: { status: 'unsupported', message: null },
    });
    // Quick Start is gone; Accounts and Models, listed on every proxy, land in the only group there is.
    expect(viaNav[0].items.map((item) => (item as { path: string }).path)).toEqual([
      '/',
      '/provimux/accounts',
      '/provimux/models',
    ]);
  });

  test('the Quick Start route goes to AI Providers', () => {
    const routes = read('src/router/MainRoutes.tsx');
    expect(routes).toContain(
      '{ path: \'/quick-start\', element: <Navigate to="/ai-providers" replace /> },'
    );
    expect(routes).not.toContain('fixedBrand="apikeyFun"');
  });

  test('the proxy row shows no sponsor', () => {
    expect(hideSponsor({ name: 'x', url: 'https://example.com' })).toBeUndefined();
    expect(read('src/features/config/components/fields/sharedFields.tsx')).toContain(
      'const sponsor = hideSponsor(SPONSORS[0]);'
    );
  });

  test('AI Providers builds its groups without offers; strip, panel and catalogue draw from them', () => {
    const page = read('src/features/providers/ProvidersWorkbenchPage.tsx');
    expect(page).toContain(': providerGroupsWithoutOffers(allGroups),');
    // The strip, its invitation, the panel and both catalogues use those groups, never allGroups.
    expect(page.match(/\ballGroups\b/g) ?? []).toHaveLength(4); // its definition, the fixedBrand and Provimux filters, the deps
    expect(page).toContain('const { providers, quickFill } = partitionProviderGroups(groups);');
    expect(page).toMatch(/partitionProviderGroups\(groups\)\s*\.quickFill\.filter/);
    // The catalogues list only groups that offer "New": no sponsor, configured or not.
    expect(page).toContain('pickerGroups={groupsToAdd(groups)}');
    expect(page).toMatch(/<ProviderPicker\s+groups=\{groupsToAdd\(groups\)\}/);
  });

  test('the theme hides the "Quick Fill" divider; upstream shows no Kimi offer any more', () => {
    expect(hiddenByTheme('BrandTabs', 'divider')).toBe(true);
    // That class carries exactly that part upstream.
    const tabs = read('src/features/providers/components/BrandTabs.tsx');
    expect(tabs).toMatch(
      /className=\{styles\.divider\} aria-hidden="true">\s*\{t\('providersPage\.categories\.quickFill'\)\}/
    );
    // Upstream 1.29.2 removed the offer line, so the theme has nothing to hide there.
    const picker = read('src/features/providers/components/ProviderPicker.tsx');
    expect(picker).not.toContain('kimiPromo');
    expect(read('src/features/providers/components/BrandPanel.tsx')).not.toContain('kimiPromo');
  });
});

describe('AI Providers sponsor groups', () => {
  const groupsFor = (config: Config) => providerGroupsWithoutOffers(buildProviderGroups(config));
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
    // Upstream's quick-connect partners (strip divider, invitation, catalogue cards) are sponsor groups too.
    expect(QUICK_FILL_BRAND_ORDER.length).toBeGreaterThan(0);
    expect(QUICK_FILL_BRAND_ORDER.filter((brand) => !SPONSOR_GROUP_BRANDS.includes(brand))).toEqual(
      []
    );
  });

  test('with nothing configured, no sponsor is offered: strip, invitation or catalogue', async () => {
    await i18n.changeLanguage('en');
    const groups = groupsFor({} as Config);
    expect(
      groups.map((group) => group.id).filter((id) => SPONSOR_GROUP_BRANDS.includes(id))
    ).toEqual([]);
    const strip = renderStrip(groups);
    expect(strip).not.toContain(i18n.t('providersPage.categories.quickFill'));
    expect(strip).not.toContain(i18n.t('providersPage.picker.moreQuickConnect'));
    for (const brand of AFFILIATE_SPONSORS) expect(strip).not.toContain(name(brand));
    // The first-run catalogue (nothing connected) and the sheet's: no partner card, no sponsor.
    const picker = renderPicker(groupsToAdd(groups));
    expect(picker).not.toContain(`>${i18n.t('providersPage.picker.featuredBadge')}<`);
    for (const brand of AFFILIATE_SPONSORS) expect(picker).not.toContain(name(brand));
    // Upstream's page, unfiltered, would offer them all: the test is not vacuous.
    const offered = renderStrip(buildProviderGroups({} as Config));
    expect(offered).toContain(i18n.t('providersPage.picker.moreQuickConnect'));
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
    // Listed in the strip with the other providers (the "Quick Fill" divider is hidden by the theme), and no
    // invitation to add another.
    const html = renderStrip(shown);
    for (const brand of SPONSOR_GROUP_BRANDS) expect(html).toContain(name(brand as ProviderBrand));
    expect(html).not.toContain(i18n.t('providersPage.picker.moreQuickConnect'));
    expect(hiddenByTheme('BrandTabs', 'divider')).toBe(true);
    // The "Add provider" catalogue neither offers nor features one: a configured sponsor is reached from its tab.
    const picker = renderPicker(groupsToAdd(shown));
    expect(picker).not.toContain(`>${i18n.t('providersPage.picker.featuredBadge')}<`);
    for (const brand of SPONSOR_GROUP_BRANDS)
      expect(picker).not.toContain(name(brand as ProviderBrand));
    expect(picker).toContain(name('kimi'));
    expect(picker).toContain(name('codex'));
    // Upstream's catalogue would feature them.
    expect(renderPicker(shown)).toContain(`>${i18n.t('providersPage.picker.featuredBadge')}<`);
  });

  test('each configured sponsor key is a card with edit, delete and an on/off switch', async () => {
    await i18n.changeLanguage('en');
    for (const group of groupsFor(configured).filter((g) => SPONSOR_GROUP_BRANDS.includes(g.id))) {
      const html = renderPanel(group);
      expect(html).toContain(`aria-label="${i18n.t('providersPage.actions.edit')}"`);
      expect(html).toContain(`aria-label="${i18n.t('providersPage.actions.delete')}"`);
      expect(html).toMatch(/<input[^>]*type="checkbox"/);
    }
  });

  test('a remembered sponsor selection with nothing configured falls back as upstream does', () => {
    // The remembered brand counts only when the listed groups hold it; otherwise upstream's own choice.
    expect(read('src/features/providers/ProvidersWorkbenchPage.tsx')).toMatch(
      /groups\.some\(\(group\) => group\.id === uiState\.activeBrand\)\s*\? uiState\.activeBrand\s*: \(connectedGroups\[0\]\?\.id/
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
  const newFor = (group: ProviderGroup) =>
    i18n.t('providersPage.actions.newFor', {
      provider: i18n.t(`providersPage.providerNames.${group.id}`),
    });
  const addLabel = (group: ProviderGroup) =>
    group.nativeSections ? i18n.t('providersPage.connections.create') : newFor(group);

  test('sponsor groups offer no "New"; every other provider does', () => {
    for (const brand of SPONSOR_GROUP_BRANDS) expect(offersCreate(brand)).toBe(false);
    expect(groupsToAdd(empty).map((group) => group.id)).toEqual(
      empty.map((group) => group.id).filter((id) => !SPONSOR_GROUP_BRANDS.includes(id))
    );
    const others = PROVIDER_BRAND_ORDER.filter((brand) => !SPONSOR_GROUP_BRANDS.includes(brand));
    expect(others).toContain('codex');
    expect(others).toContain('openaiCompatibility');
    for (const brand of others) expect(offersCreate(brand)).toBe(true);
  });

  test('the page opens no blank form for a sponsor group, by any route', () => {
    // One way into a group's form, for the panel's button, the catalogue and the first-run page alike.
    expect(page()).toMatch(
      /const target = getConnectionFormTarget\(group\);\n\s*if \(target\.mode === 'create' && !offersCreate\(brand\)\) return;\n\s*setSheetState\(\{ open: true, brand, fromPicker, \.\.\.target \}\);/
    );
    expect(page().match(/\bgetConnectionFormTarget\(/g) ?? []).toHaveLength(1);
    expect(page()).not.toContain("mode: 'create'");
    expect(page().match(/\bopenConnectionForm\(/g) ?? []).toHaveLength(3); // the panel, both catalogues
    expect(page()).toContain('const openCreate = () => openConnectionForm(activeBrand, false);');
    expect(page()).toContain('onCreate={openCreate}');
    // The header's button opens the catalogue, not a form.
    expect(page()).toContain('onNew={openPicker}');
  });

  test('a populated sponsor group: its form opens to edit; its cards keep view, edit, delete and the switch', async () => {
    await i18n.changeLanguage('en');
    const sponsors = providerGroupsWithoutOffers(buildProviderGroups(configured)).filter((group) =>
      SPONSOR_GROUP_BRANDS.includes(group.id)
    );
    expect(sponsors.map((group) => group.id).sort()).toEqual([...SPONSOR_GROUP_BRANDS].sort());
    for (const group of sponsors) {
      expect(group.resources.length).toBeGreaterThan(0);
      expect(getConnectionFormTarget(group).mode).toBe('edit');
      // An empty search: no "New", and the stock text names none.
      const none = renderPanel(group, [], 'no-such-key');
      expect(none).not.toContain(newFor(group));
      expect(none).toContain(i18n.t('providersPage.table.noMatch'));
      const cards = renderPanel(group);
      expect(cards).not.toContain(newFor(group));
      expect(cards).toContain(`aria-label="${i18n.t('providersPage.actions.view')}"`);
      expect(cards).toContain(`aria-label="${i18n.t('providersPage.actions.edit')}"`);
      expect(cards).toContain(`aria-label="${i18n.t('providersPage.actions.delete')}"`);
      expect(cards).toMatch(/<input[^>]*type="checkbox"/);
    }
  });

  test('Codex and OpenAI Compatible keep their add button on an empty list', async () => {
    await i18n.changeLanguage('en');
    for (const brand of ['codex', 'openaiCompatibility']) {
      const group = empty.find((g) => g.id === brand);
      expect(group).toBeDefined();
      expect(getConnectionFormTarget(group as ProviderGroup).mode).toBe('create');
      expect(renderPanel(group as ProviderGroup)).toContain(addLabel(group as ProviderGroup));
    }
  });
});

describe('referral links', () => {
  // The stylesheet as the browser gets it, and its link rules as matchers.
  const css = sponsorCss;
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
    for (const param of [
      'aff',
      'ref',
      'referral',
      'invite',
      'invitecode',
      'keyword',
      'promo',
      'coupon',
      'via',
    ]) {
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
    // The line that only introduces a hidden link goes too, and so do AI Providers' note that only introduces
    // one (Kimi's offer, a reseller's registration) and the catalogue's Kimi offer.
    expect(css).toContain('p:has(> a[href*="?aff=" i])');
    expect(css).toContain('[class*=BrandPanel-module__note___]:has(> a[href*="?aff=" i])');
    expect(css).toContain(
      '[class*=BrandPanel-module__note___]:has(> a[href^="https://s.qiniu.com/" i])'
    );
  });

  // What the pages that carry sponsor links render.
  const rendered = async () => {
    await i18n.changeLanguage('en');
    const pages: ReactElement[] = [
      createElement(MemoryRouter, null, createElement(OAuthPage)),
      // Every provider's panel, and upstream's unfiltered catalogue (every partner card and Kimi's).
      ...buildProviderGroups({} as Config).map((group) => panelElement(group)),
      createElement(ProviderPicker, {
        groups: buildProviderGroups({} as Config),
        variant: 'page',
        onPick: noop,
      }),
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

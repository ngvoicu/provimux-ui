/**
 * The System page's "Available models" card duplicates Models: the theme hides it and one line linking to Models
 * takes its place, with no edit of SystemPage.tsx. Its catalog update stays reachable on Models: "Refresh lists
 * now" sends it with live lists on, and "Sync model catalog" stands beside it with them off.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import * as sass from 'sass';
import i18n from '../../src/i18n/index';
import { SystemPage } from '../../src/pages/SystemPage';
import {
  SYSTEM_CONTENT_SELECTOR,
  SYSTEM_MODELS_CARD_SELECTOR,
} from '@/provimux/components/ProvimuxSystemModels';
import type { ProvimuxModelListsResponse } from '@/provimux/api/types';
import type { DevinCooling } from '@/provimux/pages/modelRoutes/useDevinCooling';
import { ModelsSettings } from '@/provimux/pages/models/ModelsSettings';
import { ownerLists } from './support/models';

const read = (path: string) => readFileSync(path, 'utf8');
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

describe('System: the models card is hidden by the theme, one line takes its place', () => {
  test('the theme hides the card of the page column whose header holds the models buttons', () => {
    const css = sass.compile('src/provimux/theme/_system.scss').css;
    expect(css).toContain(
      "[class*=SystemPage-module__content___] > .card:has([class*=SystemPage-module__modelsActions___]) {\n  display: none !important;"
    );
    expect(read('src/provimux/theme/index.scss')).toContain("@use './system';");
    // The line is placed by the same selectors the theme uses.
    expect(SYSTEM_CONTENT_SELECTOR).toBe("[class*='SystemPage-module__content___']");
    expect(SYSTEM_MODELS_CARD_SELECTOR).toBe(
      ".card:has([class*='SystemPage-module__modelsActions___'])"
    );
  });

  test("upstream's page still has that card, in its column, with the buttons the rule finds", () => {
    const page = read('src/pages/SystemPage.tsx');
    const module = read('src/pages/SystemPage.module.scss');
    expect(module).toMatch(/^\.content \{/m);
    expect(module).toMatch(/^\.modelsActions \{/m);
    expect(page).toContain('<div className={styles.content}>');
    // The models card's header holds the buttons; no other card does.
    expect(page.match(/className=\{styles\.modelsActions\}/g)).toHaveLength(1);
    const card = page.slice(page.lastIndexOf('<Card', page.indexOf('styles.modelsActions')));
    expect(card.slice(0, 200)).toContain("t('system_info.models_title')");
    // Its catalog update is the request Models sends.
    expect(page).toContain('modelsApi.refreshCatalog(isCurrent)');
    // SystemPage.tsx carries no Provimux change for it: the seam is ProvimuxLinks, already there.
    expect(page).not.toContain('ProvimuxSystemModels');
    expect(read('src/provimux/components/ProvimuxLinks.tsx')).toContain('<ProvimuxSystemModels />');
  });

  test('server rendering is unchanged but for a hidden anchor: the line is placed in the browser', async () => {
    await i18n.changeLanguage('en');
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(SystemPage))
    );
    expect(html).toContain('<span hidden=""></span>');
    expect(html).not.toContain('pmx-system-models');
    expect(html).toContain(i18n.t('system_info.models_title'));
  });

  test('the line in seven languages', () => {
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const own = JSON.parse(read(`src/provimux/locales/${language}.json`)).provimux;
      expect(own.system.models_line).toBeTruthy();
      expect(own.system.models_link).toBeTruthy();
      expect(own.models.lists_off_hint).toBeTruthy();
    }
  });
});

describe("Models: the catalog update stays reachable", () => {
  const devin = {
    value: false,
    readError: null,
    logins: { enabled: 0, disabled: 0 },
    saving: false,
    read: async () => undefined,
    set: async () => ({ ok: true }),
  } as unknown as DevinCooling;
  const render = (liveLists: boolean) => {
    const lists = ownerLists() as ProvimuxModelListsResponse;
    return textOf(
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          null,
          createElement(ModelsSettings, {
            models: [],
            offsetMs: 0,
            nowMs: 0,
            devin,
            withDevin: false,
            withOpenRouter: false,
            lists: { ...lists, options: { ...lists.options, live_lists: liveLists } },
            onRoutesChanged: () => undefined,
            onListsChanged: () => undefined,
            onShowOpenRouter: () => undefined,
          })
        )
      )
    );
  };

  test('live lists on: "Refresh lists now" updates the catalog too, and says so', async () => {
    await i18n.changeLanguage('en');
    const text = render(true);
    expect(text).toContain('Refresh lists now');
    expect(text).not.toContain('Sync model catalog');
    expect(text).toContain('It updates the shared model catalog too.');
  });

  test('live lists off: "Sync model catalog" beside it, Auth Files\' own action', async () => {
    await i18n.changeLanguage('en');
    const text = render(false);
    expect(text).toContain('Refresh lists now');
    expect(text).toContain('Sync model catalog');
    expect(text).toContain('Sync model catalog updates the shared model catalog alone.');
    const source = read('src/provimux/pages/models/ModelsSettings.tsx');
    expect(source).toContain(
      "import { useModelCatalogSync } from '@/features/authFiles/hooks/useModelCatalogSync';"
    );
    expect(read('src/features/authFiles/hooks/useModelCatalogSync.ts')).toContain(
      'refreshCatalog: () => modelsApi.refreshCatalog()'
    );
  });
});

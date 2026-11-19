// Provimux's strings: an override bundle over upstream's seven locales (PUI-07).
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import i18n from '../../src/i18n/index';
import upstreamEn from '../../src/i18n/locales/en.json';
import provimuxEn from '../../src/provimux/locales/en.json';
import upstreamZhCn from '../../src/i18n/locales/zh-CN.json';

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

type Tree = { [key: string]: string | Tree };
const leaves = (tree: Tree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : leaves(value, `${prefix}${key}.`)
  );
const get = (tree: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree);

const languages = Object.keys(i18n.options.resources ?? {});

describe('override bundle', () => {
  test('covers every language upstream ships', () => {
    expect(languages.sort()).toEqual(['en', 'ko', 'ru', 'tr', 'vi', 'zh-CN', 'zh-TW']);
  });

  test('the brand reads Provimux in every language (English until translated)', async () => {
    for (const language of languages) {
      await i18n.changeLanguage(language);
      expect(i18n.t('title.abbr')).toBe('Provimux');
      expect(i18n.t('splash.title')).toBe('Provimux');
      expect(i18n.t('system_info.about_title')).toBe('Provimux');
      expect(i18n.t('footer.api_version')).toBe('Server version');
      expect(i18n.t('provimux.version_line', { version: '8.0.78-pmx.1', base: '8.0.78' })).toBe(
        'Provimux version 8.0.78-pmx.1 (based on CLIProxyAPI 8.0.78)'
      );
    }
  });

  test('keeps every other upstream string, in its language', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(i18n.t('splash.subtitle')).toBe((upstreamZhCn as Tree).splash && get(upstreamZhCn as Tree, 'splash.subtitle'));
    expect(i18n.t('nav.dashboard')).toBe(get(upstreamZhCn as Tree, 'nav.dashboard'));
  });

  test('overrides only keys upstream has (a renamed upstream key shows up here)', () => {
    const stale = leaves(provimuxEn as Tree)
      .map(([key]) => key)
      .filter((key) => !key.startsWith('provimux.'))
      .filter((key) => typeof get(upstreamEn as Tree, key) !== 'string');
    expect(stale).toEqual([]);
  });

  test('is registered right after i18next starts, in src/i18n/index.ts', () => {
    const source = readFileSync('src/i18n/index.ts', 'utf8');
    expect(source).toMatch(/\}\);\nregisterProvimuxStrings\(i18n\);\n/);
  });
});

describe('upstream brand strings', () => {
  // English strings that name CLI Proxy API, CPA or the Management Center as the product. Each is either
  // overridden, or kept on purpose because it names the technology, not the product the user runs.
  const KEPT: Record<string, string> = {
    'logs.cpa_file_logging_required': 'runtime kind (CPA vs CPA Home); Provimux is a CPA runtime',
    'logs.cpa_file_logging_required_desc': 'runtime kind, as above',
    'config_management.visual.serverExtras.discoveryServiceName.hint': 'literal server default',
    'plugin_store.cli_proxy_api_source': 'plugin source type',
    'nav.system_info': 'generic page name, translated upstream',
    'system_info.title': 'generic page name, translated upstream',
    'splash.subtitle': 'generic console name under "Provimux", translated upstream',
  };

  test('each one is overridden or kept on purpose', () => {
    const brand = /CLI ?Proxy ?API|CPAMC|\bCPA\b|Management Center/;
    const uncovered = leaves(upstreamEn as Tree)
      .filter(([, value]) => brand.test(value))
      .map(([key]) => key)
      .filter((key) => typeof get(provimuxEn as Tree, key) !== 'string' && !(key in KEPT));
    expect(uncovered).toEqual([]);
  });
});

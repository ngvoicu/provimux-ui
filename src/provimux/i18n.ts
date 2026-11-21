import type { i18n as I18n } from 'i18next';
import en from './locales/en.json';
import ko from './locales/ko.json';
import ru from './locales/ru.json';
import tr from './locales/tr.json';
import vi from './locales/vi.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';

/**
 * Provimux's strings: the brand where upstream names CLI Proxy API, and Provimux's own keys under `provimux.*`.
 * Registered over upstream's bundles right after i18next starts, so the seven upstream locale files stay
 * untouched. English is complete; a language's own file holds what is translated (the Aliases page), laid over
 * the English one, so every key it does not hold stays English.
 */
type Strings = Record<string, unknown>;

const isTree = (value: unknown): value is Strings =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `over` laid on `base`, key by key; neither is changed. */
export function overlayStrings(base: Strings, over: Strings): Strings {
  const result: Strings = { ...base };
  for (const [key, value] of Object.entries(over)) {
    result[key] = isTree(value) && isTree(base[key]) ? overlayStrings(base[key], value) : value;
  }
  return result;
}

/** Each language's own Provimux file, before the overlay. */
export const PROVIMUX_TRANSLATIONS: Readonly<Record<string, Strings>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ru,
  vi,
  ko,
  tr,
};

export const PROVIMUX_STRINGS: Readonly<Record<string, Strings>> = {
  en,
  ...Object.fromEntries(
    Object.entries(PROVIMUX_TRANSLATIONS).map(([language, own]) => [
      language,
      overlayStrings(en, own),
    ])
  ),
};

export function provimuxStringsFor(language: string): Strings {
  return PROVIMUX_STRINGS[language] ?? PROVIMUX_STRINGS.en;
}

/** Overlays Provimux's strings on every language i18next knows, keeping all other upstream keys. */
export function registerProvimuxStrings(i18n: I18n): void {
  const languages = new Set<string>([
    ...Object.keys(i18n.options.resources ?? {}),
    ...Object.keys(i18n.store?.data ?? {}),
  ]);
  for (const language of languages) {
    i18n.addResourceBundle(language, 'translation', provimuxStringsFor(language), true, true);
  }
}

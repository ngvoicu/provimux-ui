import type { i18n as I18n } from 'i18next';
import en from './locales/en.json';

/**
 * Provimux's strings: the brand where upstream names CLI Proxy API, and Provimux's own keys under `provimux.*`.
 * Registered over upstream's bundles right after i18next starts, so the seven upstream locale files stay
 * untouched. Until a language has its own Provimux file, it gets the English one.
 */
export const PROVIMUX_STRINGS: Readonly<Record<string, Record<string, unknown>>> = { en };

export function provimuxStringsFor(language: string): Record<string, unknown> {
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

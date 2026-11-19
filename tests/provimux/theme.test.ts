// The Provimux theme layer (PUI-06): every upstream token has a Provimux value or is kept on purpose, the
// selectors that reach into upstream's CSS modules still match, and the theme picker previews line up.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(path, 'utf8');
const files = (dir: string, pattern: RegExp): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, pattern) : pattern.test(name) ? [path] : [];
  });

/** The custom properties declared directly in the first `{ … }` block after `head`. */
const block = (source: string, head: string): Set<string> => {
  const start = source.indexOf(head);
  if (start === -1) throw new Error(`no block ${head}`);
  let depth = 0;
  let body = '';
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 1 && char !== '{') body += char;
    if (depth === 0) break;
  }
  return new Set([...body.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
};

const upstream = read('src/styles/themes.scss');
const tokens = read('src/provimux/theme/_tokens.scss');
const lightBase = block(tokens, '@mixin pmx-light-base');
const provimux = {
  light: new Set([...lightBase, ...block(tokens, ':root:not([data-theme])')]),
  white: new Set([...lightBase, ...block(tokens, ":root[data-theme='white']")]),
  dark: block(tokens, ":root[data-theme='dark']"),
};

// Upstream tokens that keep upstream's value in every theme, and why.
const KEPT = new Set([
  // status: success, errors, warnings, quota and charts were tuned upstream for contrast and colour blindness
  '--bg-error-light', '--success-color', '--quota-medium-color', '--warning-color', '--error-color',
  '--danger-color', '--warning-bg', '--warning-border', '--warning-text', '--success-badge-bg',
  '--success-badge-text', '--success-badge-border', '--failure-badge-bg', '--failure-badge-text',
  '--failure-badge-border', '--amber-color', '--amber-text', '--amber-10', '--amber-30',
  '--destructive-color', '--destructive-10', '--destructive-30', '--viz-success', '--viz-failure',
  // derived from tokens Provimux sets (var() / color-mix)
  '--text-muted', '--border-secondary', '--info-color', '--primary-8', '--primary-10', '--primary-30',
  '--muted-bg', '--muted-foreground', '--accent-bg', '--glass-bg', '--glass-bg-secondary', '--glass-border',
  // geometry and motion
  '--radius-md', '--glass-blur', '--glass-backdrop-filter', '--glass-filter', '--ease-out-strong',
  '--dur-press', '--dur-hover',
]);

describe('tokens', () => {
  test.each([
    ['light', ':root {'],
    ['white', "[data-theme='white'] {"],
    ['dark', "[data-theme='dark'] {"],
  ] as const)('every upstream %s token has a Provimux value or is kept on purpose', (theme, head) => {
    const missing = [...block(upstream, head)].filter(
      (token) => !provimux[theme].has(token) && !KEPT.has(token)
    );
    expect(missing).toEqual([]);
  });

  test('light, white and dark set the same tokens', () => {
    const names = (set: Set<string>) => [...set].sort();
    expect(names(provimux.white)).toEqual(names(provimux.light));
    expect(names(provimux.dark)).toEqual(names(provimux.light));
  });

  test('each block matches one theme only', () => {
    expect(tokens).not.toMatch(/^\[data-theme/m);
    expect(tokens).toContain(':root:not([data-theme]) {');
  });
});

describe('login page', () => {
  const login = read('src/provimux/theme/_login.scss');
  const palette = read('src/pages/login/_palette.scss');

  test("Vite's CSS-module names are '[name]__[local]___[hash]'", () => {
    expect(read('vite.config.ts')).toContain("generateScopedName: '[name]__[local]___[hash:base64:5]'");
  });

  test('the container and the language dropdown still carry the login palette', () => {
    const page = read('src/pages/LoginPage.module.scss');
    expect(page).toMatch(/\.container \{\s*@include login-palette;/);
    expect(page).toMatch(/\.languageDropdown \{\s*@include login-palette;/);
  });

  test('every --login-* token has a Provimux value in light and dark', () => {
    const upstreamTokens = [...block(palette, '@mixin login-tokens-light')].filter((t) =>
      t.startsWith('--login-')
    );
    const kept = new Set(['--login-error']);
    for (const mixin of ['@mixin pmx-login-light', '@mixin pmx-login-dark']) {
      const ours = block(login, mixin);
      expect(upstreamTokens.filter((t) => !ours.has(t) && !kept.has(t))).toEqual([]);
    }
  });
});

describe('selectors into upstream CSS modules', () => {
  test('each [class*="Name-module__local___"] names a class that exists', () => {
    const theme = files('src/provimux/theme', /\.scss$/).map(read).join('\n');
    const modules = files('src', /\.module\.scss$/);
    const refs = [...theme.matchAll(/\[class\*='([\w-]+)-module__(\w+)___'\]/g)].map((m) => ({
      name: m[1],
      local: m[2],
    }));
    expect(refs.length).toBeGreaterThan(0);
    const broken = refs.filter(({ name, local }) => {
      const file = modules.find((path) => path.endsWith(`/${name}.module.scss`));
      return !file || !new RegExp(`\\.${local}\\b`).test(read(file));
    });
    expect(broken).toEqual([]);
  });

  test('the global classes restyled still exist upstream', () => {
    const layout = read('src/styles/layout.scss');
    for (const name of ['sidebar-brand', 'sidebar-brand-title', 'sidebar-brand-text', 'sidebar-header']) {
      expect(layout).toContain(`.${name}`);
    }
    expect(read('src/styles/components.scss')).toMatch(/&\.btn-primary \{/);
    expect(layout).toMatch(/&\.main-content-logs \{/);
  });

  test('the theme picker lists auto, white, light, dark in that order (_overrides.scss)', () => {
    const layout = read('src/components/layout/MainLayout.tsx');
    const cards = layout.slice(layout.indexOf('const THEME_CARDS'), layout.indexOf('export function MainLayout'));
    expect([...cards.matchAll(/key: '(\w+)'/g)].map((m) => m[1])).toEqual([
      'auto',
      'white',
      'light',
      'dark',
    ]);
    for (const name of ['theme-card-preview', 'theme-card-header', 'theme-card-sidebar', 'theme-card-content', 'theme-card-line']) {
      expect(layout).toContain(`className="${name}`);
    }
  });
});

describe('fonts', () => {
  test('the vendored Geist files exist with their licence', () => {
    const fonts = read('src/provimux/theme/_fonts.scss');
    const urls = [...fonts.matchAll(/url\('@\/provimux\/theme\/fonts\/(geist-[^']*?)#\{\$subset\}([^']*)'\)/g)];
    expect(urls).toHaveLength(2);
    for (const subset of ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'vietnamese']) {
      expect(existsSync(`src/provimux/theme/fonts/geist-${subset}-wght-normal.woff2`)).toBe(true);
    }
    for (const subset of ['latin', 'latin-ext']) {
      expect(existsSync(`src/provimux/theme/fonts/geist-mono-${subset}-wght-normal.woff2`)).toBe(true);
    }
    expect(read('src/provimux/theme/fonts/OFL.txt')).toContain('SIL Open Font License, Version 1.1');
  });
});

// Provimux brand in the console: name, signature, logo, favicon and title (PUI-06).
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  INLINE_LOGO_JPEG,
  PROVIMUX_BRAND,
  PROVIMUX_LINKS,
  PROVIMUX_TILE,
  PROVIMUX_TILE_SVG,
  PROVIMUX_TILE_TYPE,
} from '../../src/provimux/brand';
import { ProvimuxTagline } from '../../src/provimux/components/ProvimuxTagline';
import { LOGIN_BRAND_NAME } from '../../src/pages/LoginPage';
import { HERO_TITLE } from '../../src/pages/login/DotMatrixHero';

const read = (path: string) => readFileSync(path, 'utf8');
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

describe('brand constants', () => {
  test('name and signature', () => {
    expect(PROVIMUX_BRAND.name).toBe('Provimux');
    expect(PROVIMUX_BRAND.tagline).toBe('by providers.dev');
    expect(PROVIMUX_BRAND.fullName).toBe('Provimux by providers.dev');
    expect(PROVIMUX_BRAND.pageTitle).toBe('Provimux by providers.dev');
  });

  test('links to Provimux, providers.dev and both originals', () => {
    expect(PROVIMUX_LINKS.provimux).toBe('https://github.com/ngvoicu/provimux');
    expect(PROVIMUX_LINKS.providersDev).toBe('https://providers.dev');
    expect(PROVIMUX_LINKS.cliProxyApi).toBe('https://github.com/router-for-me/CLIProxyAPI');
    expect(PROVIMUX_LINKS.originalConsole).toBe(
      'https://github.com/router-for-me/Cli-Proxy-API-Management-Center'
    );
  });

  test('the logo is the One key tile as a small SVG data URI', () => {
    expect(PROVIMUX_TILE).toBe(`data:image/svg+xml,${encodeURIComponent(PROVIMUX_TILE_SVG)}`);
    expect(PROVIMUX_TILE_TYPE).toBe('image/svg+xml');
    expect(PROVIMUX_TILE.length).toBeLessThan(2048);
    // The tile, the ring and stem, the two teeth and the dot (brand/provimux/final/mark.svg).
    expect(PROVIMUX_TILE_SVG).toContain('<rect width="32" height="32" rx="7" fill="url(#pmx-f)"/>');
    expect(PROVIMUX_TILE_SVG).toContain('<circle cx="18" cy="12" r="6"/><path d="M12 12v16"/>');
    expect(PROVIMUX_TILE_SVG).toContain('d="M12 22h6v2h-6zM12 26h8v2h-8z"');
    expect(PROVIMUX_TILE_SVG).toContain('<circle cx="18" cy="12" r="1.9" fill="#c7d2fe"/>');
    // Upstream's import name points at it, so the logo's use sites stay untouched.
    expect(INLINE_LOGO_JPEG).toBe(PROVIMUX_TILE);
  });

  test('no part of the console still shows the upstream logo', () => {
    const importers = sourceFiles('src').filter((path) =>
      read(path).includes("from '@/assets/logoInline'")
    );
    expect(importers).toEqual([]);
  });
});

describe('seams', () => {
  test('page title and favicon in index.html', () => {
    const html = read('index.html');
    expect(html).toContain('<title>Provimux by providers.dev</title>');
    const icon = html.match(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)"/)?.[1];
    expect(icon).toBe(PROVIMUX_TILE);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
  });

  test('main.tsx sets the title and favicon from the brand and loads the theme after the app', () => {
    const main = read('src/main.tsx');
    expect(main).toContain('document.title = PROVIMUX_BRAND.pageTitle;');
    expect(main.match(/\.type = PROVIMUX_TILE_TYPE;/g)).toHaveLength(2);
    expect(main).not.toContain("'image/jpeg'");
    const app = main.indexOf("import App from './App.tsx';");
    const theme = main.indexOf("import '@/provimux/theme/index.scss';");
    expect(app).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(app);
  });

  test('login page and hero read Provimux', () => {
    expect(LOGIN_BRAND_NAME).toBe('Provimux');
    expect(HERO_TITLE).toBe('Welcome to Provimux.');
    expect(read('src/pages/LoginPage.tsx')).toMatch(
      /\{LOGIN_BRAND_NAME\}\s*<\/span>\s*<ProvimuxTagline className="pmx-login-tagline" \/>/
    );
  });

  test('sidebar: full name in the title, Provimux alt, signature under the name, footer', () => {
    const layout = read('src/components/layout/MainLayout.tsx');
    expect(layout).toContain('const fullBrandName = PROVIMUX_BRAND.fullName;');
    expect(layout).toContain('alt={PROVIMUX_BRAND.name} className="sidebar-brand-logo"');
    expect(layout).toContain('<ProvimuxTagline className="sidebar-brand-tagline" />');
    // The footer is the main area's last child, after the routes (wrapped in upstream's plugin logos provider).
    expect(layout).toMatch(
      /<PageTransition[\s\S]*?\/>\s*<\/PluginProviderLogos\.Provider>\s*<ProvimuxFooter \/>\s*<\/main>/
    );
    expect(layout).not.toContain('CPAMC');
  });

  test('the mono font routes through Geist Mono', () => {
    expect(read('src/styles/variables.scss')).toContain(
      "$font-mono: 'Geist Mono Variable', $font-mono;"
    );
  });
});

describe('signature', () => {
  test('reads "by providers.dev", optionally linking to the site', () => {
    const plain = renderToStaticMarkup(createElement(ProvimuxTagline));
    expect(plain.replace(/<[^>]+>/g, '')).toBe('by providers.dev');
    expect(plain).not.toContain('<a');
    const linked = renderToStaticMarkup(createElement(ProvimuxTagline, { link: true }));
    expect(linked.replace(/<[^>]+>/g, '')).toBe('by providers.dev');
    expect(linked).toContain('href="https://providers.dev"');
  });
});

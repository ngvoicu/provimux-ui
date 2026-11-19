// The System page's "Provimux version <x> (based on CLIProxyAPI <base>)" (PUI-06).
import { afterAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../../src/i18n/index';
import { describeServerVersion, provimuxBaseVersion } from '../../src/provimux/version';
import { ProvimuxAbout } from '../../src/provimux/components/ProvimuxAbout';

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

// Block ends become spaces; inline tags (the signature's spans) join their text.
const text = (html: string) =>
  html
    .replace(/<\/(p|div)>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

describe('base version', () => {
  test.each([
    ['8.0.78-pmx.1', '8.0.78'],
    ['v8.0.78-pmx.12', '8.0.78'],
    ['8.0.79-PMX.3', '8.0.79'],
  ])('%s is based on CLIProxyAPI %s', (version, base) => {
    expect(provimuxBaseVersion(version)).toBe(base);
  });

  test.each([['8.0.75'], ['dev'], [''], [null], [undefined], ['8.0.78-pmx'], ['8.0.78-pmx.1-dirty']])(
    '%p is not a Provimux version',
    (version) => {
      expect(provimuxBaseVersion(version)).toBeNull();
    }
  );

  test('describes the server', () => {
    expect(describeServerVersion('8.0.78-pmx.1')).toEqual({
      kind: 'provimux',
      version: '8.0.78-pmx.1',
      base: '8.0.78',
    });
    expect(describeServerVersion(' 8.0.75 ')).toEqual({ kind: 'cliproxyapi', version: '8.0.75' });
    expect(describeServerVersion('')).toBeNull();
  });
});

describe('about lines', () => {
  test('a Provimux server', async () => {
    await i18n.changeLanguage('en');
    const html = text(renderToStaticMarkup(createElement(ProvimuxAbout, { serverVersion: '8.0.78-pmx.1' })));
    expect(html).toContain('by providers.dev');
    expect(html).toContain('Provimux version 8.0.78-pmx.1 (based on CLIProxyAPI 8.0.78)');
    expect(html).toContain('Built on CLIProxyAPI and the CLI Proxy API Management Center');
  });

  test('another CLIProxyAPI build reads as itself; an unknown version shows no line', async () => {
    await i18n.changeLanguage('zh-CN');
    const other = text(renderToStaticMarkup(createElement(ProvimuxAbout, { serverVersion: '8.0.75' })));
    expect(other).toContain('Connected to CLIProxyAPI 8.0.75');
    expect(other).not.toContain('Provimux version');
    const none = text(renderToStaticMarkup(createElement(ProvimuxAbout, { serverVersion: '' })));
    expect(none).not.toContain('version');
    expect(none).not.toContain('Connected to');
  });
});

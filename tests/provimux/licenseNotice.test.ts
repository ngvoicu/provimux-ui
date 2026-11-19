// The original's MIT notice in the built single file (PUI-10, review T-44 finding 5).
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { licenseComment, withLicenseNotice } from '../../src/provimux/licenseNotice';

const root = resolve(import.meta.dir, '../..');
const license = readFileSync(join(root, 'LICENSE'), 'utf8');
const licenseLines = license
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

/** Fails unless the page holds the whole LICENSE, line by line, in its first comment. */
function expectNotice(html: string) {
  expect(html.startsWith('<!doctype html>\n<!--\n')).toBe(true);
  const comment = html.slice(0, html.indexOf('-->') + 3);
  let at = 0;
  for (const line of licenseLines) {
    const found = comment.indexOf(line, at);
    expect({ line, found: found >= 0 }).toEqual({ line, found: true });
    at = found + line.length;
  }
}

describe('license notice', () => {
  test('LICENSE has both copyright lines and the permission notice', () => {
    expect(license).toContain('Copyright (c) 2026 Router-For.ME');
    expect(license).toContain('Copyright (c) 2026 Gabriel Voicu (provimux-ui changes)');
    expect(license).toContain('The above copyright notice and this permission notice shall be included');
  });

  test('the comment goes right after the doctype', () => {
    const html = withLicenseNotice('<!doctype html>\n<html><head></head></html>', license);
    expectNotice(html);
    expect(html.endsWith('-->\n<html><head></head></html>')).toBe(true);
  });

  test('a license that would break the comment is refused', () => {
    expect(() => licenseComment('a -- b')).toThrow();
    expect(() => licenseComment('  ')).toThrow();
  });

  test('vite.config.ts registers the plugin with LICENSE', () => {
    const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    expect(config).toContain(
      "provimuxLicenseNotice(fs.readFileSync(path.resolve(__dirname, 'LICENSE'), 'utf8'))"
    );
  });

  describe('the built file', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'provimux-ui-license-'));
    afterAll(() => rmSync(outDir, { recursive: true, force: true }));

    test(
      'carries the notice',
      async () => {
        await build({
          root,
          configFile: join(root, 'vite.config.ts'),
          logLevel: 'silent',
          build: { outDir, emptyOutDir: true },
        });
        expectNotice(readFileSync(join(outDir, 'index.html'), 'utf8'));
      },
      120_000
    );
  });
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { aliasFieldType, countAliases, shownAlias } from '@/provimux/pages/aliases/formSeams';

/* ALP-03 W6: the countAliases cases of F-4 (design aliases-page.md 5.1, 7), and aliasFieldType. */

describe('F-4 countAliases', () => {
  test('ignores empty aliases and alias == name', () => {
    expect(
      countAliases([
        { name: 'claude-opus-5-5', alias: 'opus' },
        { name: 'claude-sonnet-5', alias: '' },
        { name: 'claude-haiku-5' },
        { name: 'gemini-s', alias: 'gemini-s' },
        { name: ' gemini-t ', alias: 'gemini-t  ' },
        { name: 'gemini-y', alias: '   ' },
        { name: 'gpt-5.5', alias: ' fast ' },
      ])
    ).toBe(2);
    expect(countAliases([])).toBe(0);
  });

  test('the alias a row shows', () => {
    expect(shownAlias({ name: 'gpt-5.5', alias: ' fast ' })).toBe('fast');
    expect(shownAlias({ name: 'gpt-5.5', alias: 'gpt-5.5' })).toBeNull();
    expect(shownAlias({ name: 'gpt-5.5' })).toBeNull();
    // Compared exactly after trimming, as rows.ts reads a stored row (design 2.2 step 3).
    expect(shownAlias({ name: 'gpt-5.5', alias: 'GPT-5.5' })).toBe('GPT-5.5');
  });
});

describe('aliasFieldType', () => {
  test('hidden in a provider list, text for a login’s own aliases', () => {
    expect(aliasFieldType(false)).toBe('hidden');
    expect(aliasFieldType(undefined)).toBe('hidden');
    expect(aliasFieldType(true)).toBe('text');
  });

  test('called from ModelEntriesEditor through four inserted lines (U3)', () => {
    const editor = readFileSync(
      'src/features/providers/sheets/forms/ModelEntriesEditor.tsx',
      'utf8'
    );
    expect(editor).toContain(
      "import { ProvimuxAliasesLine, ProvimuxRowAlias, aliasFieldType } from '@/provimux';"
    );
    expect(editor).toContain('type={aliasFieldType(oauthAliasOnly)}');
    expect(editor).toContain(
      '<ProvimuxRowAlias show={!oauthAliasOnly} alias={entry.alias} name={entry.name} />'
    );
    expect(editor).toContain(
      '<ProvimuxAliasesLine show={!oauthAliasOnly} models={models} family={providerBrand} />'
    );
  });
});

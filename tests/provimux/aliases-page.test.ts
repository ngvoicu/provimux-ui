// The Aliases page, step U1 (design aliases-page.md, section 8): its filter, what it marks, what it renders
// for a draft, its route and nav item (the U1 part of F-5), and its strings in the seven languages.
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import type { AuthFilesResponse } from '@/types/authFile';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import {
  addKeyAlias,
  addLoginAlias,
  changeRow,
  removeRow,
  rowIssues,
  startDraft,
} from '@/provimux/pages/aliases/draft';
import { groupOfRow, nameGroups } from '@/provimux/pages/aliases/collisions';
import {
  EMPTY_FILTER,
  changeCount,
  initialFilter,
  removedCounts,
  rowMarks,
  visibleRows,
  type AliasFilter,
} from '@/provimux/pages/aliases/pageLogic';
import { AliasesBoard, type BoardActions } from '@/provimux/pages/aliases/AliasesBoard';
import { AliasesPage } from '@/provimux/pages/aliases/AliasesPage';
import { PROVIMUX_ROUTES } from '@/provimux/routes';
import { PROVIMUX_PAGES } from '@/provimux/nav';
import { PROVIMUX_TRANSLATIONS, overlayStrings } from '@/provimux/i18n';
import type { AliasDraft, ServedNames } from '@/provimux/pages/aliases/types';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/aliases/${name}`, 'utf8'));
const files = () =>
  normalizeAuthFilesResponse(fixture('credentials.json') as AuthFilesResponse).files;
const loaded = (etag: string | null = '"e1"') => ({
  ...readAliasState(fixture('config-full.json'), files()),
  etag,
});

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

describe('initial filter', () => {
  const of = (query: string) => initialFilter(new URLSearchParams(query));

  test('?store, ?channel and ?family open the page on a part of it', () => {
    expect(of('')).toEqual(EMPTY_FILTER);
    expect(of('store=login')).toMatchObject({ store: 'login', provider: 'all' });
    expect(of('store=api-key')).toMatchObject({ store: 'api-key', provider: 'all' });
    // The old login address's `provider` becomes `channel`, normalized as the data layer does.
    expect(of('store=login&channel=anti_gravity')).toMatchObject({
      store: 'login',
      provider: 'login:antigravity',
    });
    expect(of('family=openai-compatibility')).toMatchObject({
      store: 'api-key',
      provider: 'family:openai-compatibility',
    });
  });

  test('unknown values are ignored', () => {
    expect(of('store=everything&family=nope')).toEqual(EMPTY_FILTER);
  });
});

describe('marks and counts', () => {
  test('a change, a new row and a removed row are each one change', () => {
    let draft = startDraft(loaded());
    expect(changeCount(draft)).toBe(0);
    draft = changeRow(draft, 'gemini/0/0#0', { alias: 'g-pro-2' });
    draft = addKeyAlias(draft, 'claude/0/0', 'claude-haiku-5', 'haiku');
    const claude = draft.rows.find((row) => row.entryId === 'login/claude')!;
    draft = removeRow(draft, claude.id);
    const marks = rowMarks(draft);
    expect(marks['gemini/0/0#0']).toBe('changed');
    expect(Object.entries(marks).filter(([, mark]) => mark === 'new')).toHaveLength(1);
    expect(removedCounts(draft)).toEqual({ 'login/claude': 1 });
    expect(changeCount(draft)).toBe(3);
  });

  test('a blank new login row is no change yet', () => {
    const draft = addLoginAlias(startDraft(loaded()), 'kimi', { upstream: '', alias: '' });
    expect(changeCount(draft)).toBe(0);
  });
});

describe('visible rows', () => {
  const run = (draft: AliasDraft, filter: Partial<AliasFilter>, texts = {}) => {
    const groups = nameGroups(draft);
    return visibleRows({
      draft,
      filter: { ...EMPTY_FILTER, ...filter },
      issues: rowIssues(draft),
      groups,
      groupOfRow: groupOfRow(groups),
      marks: rowMarks(draft),
      failedEntries: new Set(),
      haystacks: {},
      texts,
    });
  };

  test('everything, entries without rows included, when nothing narrows', () => {
    const draft = startDraft(loaded());
    const all = run(draft, {});
    expect(all.shown).toBe(draft.rows.length);
    expect(all.entries.map((entry) => entry.id)).toContain('interactions/0/0');
    expect(all.entries.map((entry) => entry.id)).toContain('login/kimi');
  });

  test('"With an alias" keeps a row whose alias the user is clearing', () => {
    const draft = changeRow(startDraft(loaded()), 'gemini/0/0#0', { alias: '' });
    const ids = [...run(draft, { view: 'aliased' }).rows.values()].flat().map((row) => row.id);
    expect(ids).toContain('gemini/0/0#0');
    // A stored row that never had an alias is left out.
    expect(ids).not.toContain('claude/0/0#2');
  });

  test('"Needs a look" holds the issues and the names on several services', () => {
    const draft = startDraft(loaded());
    const ids = [...run(draft, { view: 'attention' }).rows.values()].flat().map((row) => row.id);
    const issues = rowIssues(draft);
    for (const id of Object.keys(issues)) expect(ids).toContain(id);
    expect(ids).toContain('openai-compatibility/0/g#0');
  });

  test('a name from the name check shows only its rows', () => {
    const draft = startDraft(loaded());
    const result = run(draft, { name: 'opus' });
    const group = nameGroups(draft).find((g) => g.key === 'opus')!;
    expect([...result.rows.values()].flat().map((row) => row.id)).toEqual(group.rowIds);
  });

  test('the search matches model, alias and the alias text being typed', () => {
    const draft = startDraft(loaded());
    expect(run(draft, { query: 'grok' }).shown).toBe(1);
    expect(run(draft, { query: 'zzz-typed' }, { 'xai/0/0#0': 'zzz-typed' }).shown).toBe(1);
  });
});

const noop = () => undefined;
const actions: BoardActions = {
  setAlias: noop,
  setUpstream: noop,
  setDisplayName: noop,
  setFork: noop,
  setForceMapping: noop,
  addKeyAlias: noop,
  addLoginAlias: noop,
  removeRow: noop,
  undoEntry: noop,
  wantSuggestions: noop,
};

function render(
  draft: AliasDraft,
  served: ServedNames | undefined = { known: true, byName: {} },
  extra: Partial<Parameters<typeof AliasesBoard>[0]> = {}
) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(AliasesBoard, {
        draft,
        served,
        filter: EMPTY_FILTER,
        onFilter: noop,
        texts: {},
        failures: {},
        suggestions: {},
        focusRowId: null,
        actions,
        ...extra,
      })
    )
  );
}

describe('the board', () => {
  test('shows every entry, the statement on login files and why a key without a list has no rows', async () => {
    await i18n.changeLanguage('en');
    const html = render(startDraft(loaded()));
    expect(html).toContain('A login can also carry aliases of its own.');
    expect(html).toContain('href="/auth-files"');
    expect(html).toContain('No model list: this key serves the provider');
    expect(html).toContain('Alias for gemini-2.5-pro');
    expect(html).toContain('Claude logins');
    // The stored groups hold the keys: none is rendered, only the masked preview.
    expect(html).not.toContain('fixture-key-');
  });

  test('says which names are on several services, and the issues', async () => {
    await i18n.changeLanguage('en');
    // A second "opus" on the key that already answers as opus: it never answers.
    const html = render(addKeyAlias(startDraft(loaded()), 'claude/1/0', 'claude-opus-5-5', 'opus'));
    expect(html).toContain('One name, several services');
    expect(html).toMatch(/\d services/);
    expect(html).toContain('The alias equals the model name; the proxy ignores the row.');
    expect(html).toContain('Never answers: an earlier row of this key has the same name.');
  });

  test('without an ETag, says saves are not protected; with one, does not', async () => {
    await i18n.changeLanguage('en');
    expect(render(startDraft(loaded(null)))).toContain(
      'Saves are not protected against a change made elsewhere'
    );
    expect(render(startDraft(loaded()))).not.toContain('Saves are not protected');
  });

  test('on a proxy without /provimux/model-routes, one line says native names were not checked', async () => {
    await i18n.changeLanguage('en');
    const line = 'were not checked: this proxy does not report them';
    expect(render(startDraft(loaded()), { known: false, byName: {} })).toContain(line);
    expect(render(startDraft(loaded()))).not.toContain(line);
  });

  test('a failed entry says why, and keeps its edits', async () => {
    await i18n.changeLanguage('en');
    const draft = changeRow(startDraft(loaded()), 'gemini/0/0#0', { alias: 'mine' });
    const html = render(draft, undefined, {
      texts: { 'gemini/0/0#0': 'mine' },
      failures: {
        'gemini/0/0': { entryId: 'gemini/0/0', reason: 'conflict', message: 'x' },
      },
    });
    expect(html).toContain('Not saved: this changed elsewhere');
    expect(html).toContain('value="mine"');
    expect(html).toContain('Undo changes here');
  });
});

describe('route and nav (F-5, the U1 part)', () => {
  test('/provimux/aliases is the page, not behind an endpoint gate', () => {
    const route = PROVIMUX_ROUTES.find((r) => r.path === '/provimux/aliases');
    expect(route).toBeDefined();
    expect(route!.element.type).toBe(AliasesPage);
  });

  test('the nav item needs no endpoint', () => {
    const page = PROVIMUX_PAGES.find((p) => p.path === '/provimux/aliases');
    expect(page?.endpoint).toBeNull();
    expect(PROVIMUX_PAGES[0].path).toBe('/provimux/aliases');
  });
});

describe('strings in seven languages', () => {
  type Tree = { [key: string]: string | Tree };
  const en = JSON.parse(readFileSync('src/provimux/locales/en.json', 'utf8')) as Tree;
  const enAliases = (en.provimux as Tree).aliases as Tree;
  const placeholders = (text: string) =>
    [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  const baseOf = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');
  const plural = new Set(
    Object.keys(enAliases)
      .filter((key) => baseOf(key) !== key)
      .map(baseOf)
  );

  test('every language has every key of the page, in its own plural forms, with the same placeholders', () => {
    expect(Object.keys(PROVIMUX_TRANSLATIONS).sort()).toEqual(
      ['ko', 'ru', 'tr', 'vi', 'zh-CN', 'zh-TW'].sort()
    );
    for (const [language, own] of Object.entries(PROVIMUX_TRANSLATIONS)) {
      const aliases = ((own as Tree).provimux as Tree).aliases as Record<string, string>;
      const forms = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
      const expected = new Set<string>();
      for (const key of Object.keys(enAliases)) {
        const base = baseOf(key);
        if (plural.has(base)) for (const form of forms) expected.add(`${base}_${form}`);
        else expected.add(key);
      }
      expect({ language, keys: Object.keys(aliases).sort() }).toEqual({
        language,
        keys: [...expected].sort(),
      });
      for (const [key, text] of Object.entries(aliases)) {
        const source = enAliases[key] ?? enAliases[`${baseOf(key)}_other`];
        expect({ language, key, p: placeholders(text) }).toEqual({
          language,
          key,
          p: placeholders(source as string),
        });
      }
    }
  });

  test('each language shows the page in its words, and keeps the other Provimux strings', async () => {
    for (const language of Object.keys(PROVIMUX_TRANSLATIONS)) {
      await i18n.changeLanguage(language);
      expect(i18n.t('provimux.aliases.title')).not.toBe('Aliases');
      expect(i18n.t('provimux.nav.aliases')).not.toBe('Aliases');
      expect(i18n.t('provimux.aliases.unsaved', { count: 3 })).toContain('3');
      // The shared words the page uses are translated; the other Provimux strings stay English.
      expect(i18n.t('provimux.common.reload')).not.toBe('Reload');
      expect(i18n.t('provimux.common.refresh')).toBe('Refresh');
      expect(i18n.t('provimux.nav.savings')).toBe('Savings');
    }
    await i18n.changeLanguage('en');
    expect(i18n.t('provimux.aliases.count_aliases', { count: 1 })).toBe('1 alias');
  });

  test('a language file laid over English replaces only what it holds', () => {
    expect(overlayStrings({ a: { b: '1', c: '2' }, d: '3' }, { a: { b: 'x' } })).toEqual({
      a: { b: 'x', c: '2' },
      d: '3',
    });
  });
});

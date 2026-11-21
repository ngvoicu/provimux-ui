// The Aliases page (design aliases-page.md, section 8). U1: its filter, what it marks, what it renders for
// a draft, its route and nav item (the U1 part of F-5), and its strings in the seven languages. U4: the
// page after a save (3.6), G-1 to G-4 of section 7; P-4 is in aliases-page-property.test.ts.
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, matchRoutes } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import type { AuthFilesResponse } from '@/types/authFile';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import {
  addKeyAlias,
  addLoginAlias,
  changeRow,
  editsOf,
  removeRow,
  rowIssues,
  startDraft,
} from '@/provimux/pages/aliases/draft';
import { groupOfRow, nameGroups } from '@/provimux/pages/aliases/collisions';
import {
  EMPTY_FILTER,
  INITIAL_PAGE,
  aliasesAddressFor,
  canEdit,
  changeCount,
  initialFilter,
  keyListUnread,
  leaveGuarded,
  pageStep,
  removedCounts,
  rowMarks,
  saveBarShown,
  visibleRows,
  type AliasFilter,
  type PageState,
} from '@/provimux/pages/aliases/pageLogic';
import { AliasesBoard, type BoardActions } from '@/provimux/pages/aliases/AliasesBoard';
import { AliasesBody } from '@/provimux/pages/aliases/AliasesBody';
import { LostEdits } from '@/provimux/pages/aliases/LostEdits';
import { AliasesPage } from '@/provimux/pages/aliases/AliasesPage';
import { PROVIMUX_ROUTES } from '@/provimux/routes';
import { AliasesRedirect } from '@/provimux/pages/aliases/AliasesRedirect';
import { buildModelRulesPath } from '@/features/authFiles/modelRules/useModelRulesRoute';
import { PROVIMUX_PAGES } from '@/provimux/nav';
import { PROVIMUX_TRANSLATIONS, overlayStrings } from '@/provimux/i18n';
import type {
  AliasDraft,
  AliasState,
  SaveFailure,
  ServedNames,
} from '@/provimux/pages/aliases/types';

type Tree = { [key: string]: unknown };
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
        suggestions: {},
        focusRowId: null,
        locked: false,
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

  test('on a proxy without /provimux/model-routes, one line says native names were not checked', async () => {
    await i18n.changeLanguage('en');
    const line = 'were not checked: this proxy does not report them';
    expect(render(startDraft(loaded()), { known: false, byName: {} })).toContain(line);
    expect(render(startDraft(loaded()))).not.toContain(line);
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
  const placeholders = (text: string) =>
    [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  const baseOf = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');

  // The page's strings, and the provider forms' line (U3).
  for (const block of ['aliases', 'forms'] as const) {
    test(`every language has every key of provimux.${block}, in its own plural forms, with the same placeholders`, () => {
      const source = (en.provimux as Tree)[block] as Tree;
      const plural = new Set(
        Object.keys(source)
          .filter((key) => baseOf(key) !== key)
          .map(baseOf)
      );
      expect(Object.keys(PROVIMUX_TRANSLATIONS).sort()).toEqual(
        ['ko', 'ru', 'tr', 'vi', 'zh-CN', 'zh-TW'].sort()
      );
      for (const [language, own] of Object.entries(PROVIMUX_TRANSLATIONS)) {
        const strings = ((own as Tree).provimux as Tree)[block] as Record<string, string>;
        const forms = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
        const expected = new Set<string>();
        for (const key of Object.keys(source)) {
          const base = baseOf(key);
          if (plural.has(base)) for (const form of forms) expected.add(`${base}_${form}`);
          else expected.add(key);
        }
        expect({ language, keys: Object.keys(strings).sort() }).toEqual({
          language,
          keys: [...expected].sort(),
        });
        for (const [key, text] of Object.entries(strings)) {
          const original = source[key] ?? source[`${baseOf(key)}_other`];
          expect({ language, key, p: placeholders(text) }).toEqual({
            language,
            key,
            p: placeholders(original as string),
          });
        }
      }
    });
  }

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

// --- U4: the page after a save (3.6), G-1 to G-4 of section 7 ------------------------------------

/** The page holding one read, as `read-answered` leaves it. */
const pageWith = (state: AliasState, patch: Partial<PageState> = {}): PageState => ({
  ...pageStep(INITIAL_PAGE, { type: 'read-answered', state }),
  ...patch,
});

const emptyRead = (etag: string | null = '"e2"'): AliasState => ({
  ...readAliasState(fixture('config-empty.json'), []),
  etag,
});

function renderBody(
  page: PageState,
  served: ServedNames | undefined = { known: true, byName: {} }
) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(AliasesBody, {
        page,
        served,
        filter: EMPTY_FILTER,
        onFilter: noop,
        suggestions: {},
        focusRowId: null,
        actions,
        onRetry: noop,
        onDismiss: noop,
      })
    )
  );
}

/** A typed alias on Gemini's only row, a removed Codex login alias, a save that confirms neither. */
function afterSave(reason: SaveFailure, message = '', page: PageState = pageWith(loaded())) {
  let next = pageStep(page, { type: 'alias-typed', rowId: 'gemini/0/0#0', text: 'g-pro-2' });
  const codex = next.draft!.rows.find((row) => row.entryId === 'login/codex')!;
  next = pageStep(next, { type: 'row-removed', rowId: codex.id });
  next = pageStep(next, { type: 'save-started' });
  expect(next.saving).toBe(true);
  return pageStep(next, {
    type: 'save-answered',
    outcome: {
      confirmed: [],
      unconfirmed: ['gemini/0/0', 'login/codex'],
      failure: { reason, message },
    },
  });
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe('U4 the page after a save (3.6)', () => {
  test('a save drops the draft and its texts, and lists each unconfirmed entry with its edits', () => {
    const page = afterSave('changed');
    expect(page.draft).toBeNull();
    expect(page.texts).toEqual({});
    expect(page.saving).toBe(false);
    expect(page.lost.map((notice) => notice.entry.id)).toEqual(['gemini/0/0', 'login/codex']);
    expect(new Set(page.lost.map((notice) => notice.save)).size).toBe(1);
    expect(page.lost[0].edits).toMatchObject([
      { kind: 'changed', before: { alias: 'g-pro' }, after: { alias: 'g-pro-2' } },
    ]);
    expect(page.lost[1].edits.map((edit) => edit.kind)).toEqual(['removed']);
    // The next read starts a draft of its own: nothing of the dropped one is in it.
    const fresh = loaded('"e9"');
    const next = pageStep(pageStep(page, { type: 'read-started' }), {
      type: 'read-answered',
      state: fresh,
    });
    expect(next.draft).toEqual(startDraft(fresh));
    expect(next.texts).toEqual({});
    expect(next.lost).toBe(page.lost);
  });

  test('leaving asks first while the draft has edits or the list has an item', () => {
    const clean = pageWith(loaded());
    expect(leaveGuarded(clean)).toBe(false);
    expect(
      leaveGuarded(pageStep(clean, { type: 'alias-typed', rowId: 'gemini/0/0#0', text: 'x' }))
    ).toBe(true);
    const lost = pageStep(afterSave('changed'), { type: 'read-answered', state: loaded('"e9"') });
    expect(leaveGuarded(lost)).toBe(true);
    let dismissed = lost;
    for (const notice of lost.lost) {
      dismissed = pageStep(dismissed, { type: 'dismissed', key: notice.key });
    }
    expect(dismissed.lost).toEqual([]);
    expect(leaveGuarded(dismissed)).toBe(false);
  });
});

describe('G-1 the frame: the notices stand above the body, whatever the body is', () => {
  test('a read with no entry and an item in the list: the item, then the empty state', async () => {
    await i18n.changeLanguage('en');
    // The review's fifth finding: the last entry removed elsewhere, the save refused.
    const page = pageStep(afterSave('changed'), { type: 'read-answered', state: emptyRead() });
    expect(page.draft?.base.entries).toEqual([]);
    const html = renderBody(page);
    expect(html).toContain('Not saved: type these edits again');
    expect(html).toContain('Gemini · gemini-1');
    expect(html).toContain('g-pro-2');
    expect(html).toContain('Codex logins');
    expect(html).toContain('No API key or login yet');
    expect(html.indexOf('g-pro-2')).toBeLessThan(html.indexOf('No API key or login yet'));
  });

  test('a read with no entry and a path it cannot read: the path, then the empty state', async () => {
    await i18n.changeLanguage('en');
    const state: AliasState = {
      ...readAliasState({ 'config-version': 8, 'api-keys': { claude: ['junk-group'] } }, []),
      etag: '"e3"',
    };
    expect(state.entries).toEqual([]);
    expect(state.unread.length).toBeGreaterThan(0);
    const html = renderBody(pageWith(state));
    expect(html).toContain(state.unread[0]);
    expect(html).toContain('left in it untouched');
    expect(html).toContain('No API key or login this page can read');
    expect(html.indexOf(state.unread[0])).toBeLessThan(html.indexOf('this page can read'));
  });

  test('a load error and an item: both, the item first', async () => {
    await i18n.changeLanguage('en');
    let page = pageStep(afterSave('error', 'Network Error'), { type: 'read-started' });
    page = pageStep(page, { type: 'read-failed', message: 'Network Error 2' });
    expect(page.draft).toBeNull();
    const html = renderBody(page);
    expect(html).toContain('g-pro-2');
    expect(html).toContain('Could not read the configuration');
    expect(html).toContain('Network Error 2');
    expect(html.indexOf('g-pro-2')).toBeLessThan(html.indexOf('Could not read the configuration'));
  });

  test('while reading: the item, and the skeleton', async () => {
    await i18n.changeLanguage('en');
    const html = renderBody(pageStep(afterSave('changed'), { type: 'read-started' }));
    expect(html).toContain('g-pro-2');
    expect(html).toContain('aria-busy="true"');
    expect(html.indexOf('g-pro-2')).toBeLessThan(html.indexOf('aria-busy="true"'));
  });

  test('with a board: the item above it', async () => {
    await i18n.changeLanguage('en');
    const page = pageStep(afterSave('changed'), { type: 'read-answered', state: loaded('"e9"') });
    const html = renderBody(page);
    expect(html.indexOf('g-pro-2')).toBeGreaterThan(-1);
    expect(html.indexOf('g-pro-2')).toBeLessThan(html.indexOf('<fieldset'));
  });
});

describe('G-2 not editable', () => {
  test('while a read is pending: the fieldset is disabled, no save bar, and typing changes nothing', async () => {
    await i18n.changeLanguage('en');
    const typed = pageStep(pageWith(loaded()), {
      type: 'alias-typed',
      rowId: 'gemini/0/0#0',
      text: 'mine',
    });
    expect(canEdit(typed)).toBe(true);
    expect(saveBarShown(typed)).toBe(true);
    expect(renderBody(typed)).not.toMatch(/<fieldset[^>]*disabled/);
    // The reload's confirmation was accepted: the read starts, the draft is still on screen.
    const reading = pageStep(typed, { type: 'read-started' });
    expect(canEdit(reading)).toBe(false);
    expect(saveBarShown(reading)).toBe(false);
    const html = renderBody(reading);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain('Reading the configuration');
    for (const event of [
      { type: 'alias-typed', rowId: 'gemini/0/0#0', text: 'later' },
      { type: 'row-removed', rowId: 'gemini/0/0#0' },
      { type: 'edited', change: (d: AliasDraft) => changeRow(d, 'gemini/0/0#0', { alias: 'z' }) },
      { type: 'entry-undone', entryId: 'gemini/0/0' },
      { type: 'discarded' },
      { type: 'save-started' },
    ] as const) {
      expect(pageStep(reading, event)).toBe(reading);
    }
  });

  test('a read without a tag: the line that the page cannot save, and nothing editable', async () => {
    await i18n.changeLanguage('en');
    const page = pageWith(loaded(null));
    expect(canEdit(page)).toBe(false);
    const html = renderBody(page);
    expect(html).toContain('This page cannot save');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(pageStep(page, { type: 'alias-typed', rowId: 'gemini/0/0#0', text: 'x' })).toBe(page);
    expect(saveBarShown(page)).toBe(false);
    expect(renderBody(pageWith(loaded()))).not.toContain('This page cannot save');
  });

  test('while a save runs: nothing editable; the bar stays only to say so', () => {
    const typed = pageStep(pageWith(loaded()), {
      type: 'alias-typed',
      rowId: 'gemini/0/0#0',
      text: 'mine',
    });
    const saving = pageStep(typed, { type: 'save-started' });
    expect(canEdit(saving)).toBe(false);
    expect(renderBody(saving)).toMatch(/<fieldset[^>]*disabled=""/);
    expect(pageStep(saving, { type: 'alias-typed', rowId: 'gemini/0/0#0', text: 'x' })).toBe(
      saving
    );
    expect(saveBarShown(saving)).toBe(true);
  });
});

describe('G-3 the reasons: one per save', () => {
  const lostHtml = (page: PageState) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(LostEdits, { notices: page.lost, onDismiss: noop })
      )
    );
  const UNKNOWN =
    'yaml: unmarshal errors:\n  line 54: field x-unknown not found in type config.ClaudeModel';

  test('refused: the proxy’s message, then to correct the named field first', async () => {
    await i18n.changeLanguage('en');
    const html = lostHtml(afterSave('refused', UNKNOWN));
    expect(html).toContain('The proxy refused the configuration');
    expect(html).toContain('field x-unknown not found in type config.ClaudeModel');
    expect(html).toContain('correct that field in the configuration first');
    expect(html).toContain('the proxy refuses every save');
    expect(html).toContain('href="/config"');
    // One reason for the save, though two entries are listed.
    expect(count(html, 'The proxy refused the configuration')).toBe(1);
    expect(count(html, 'Dismiss</span>')).toBe(2);
  });

  test('error: the message, and that the last write may have landed', async () => {
    await i18n.changeLanguage('en');
    const html = lostHtml(afterSave('error', 'Request failed with status code 503'));
    expect(html).toContain('Request failed with status code 503');
    expect(html).toContain('last write may have landed');
    expect(html).toContain('check each edit against what the page now shows');
  });

  test('changed and no-tag: their lines', async () => {
    await i18n.changeLanguage('en');
    expect(lostHtml(afterSave('changed'))).toContain('The file was changed elsewhere');
    expect(lostHtml(afterSave('no-tag', 'x'))).toContain('carried no version (ETag)');
  });

  test('two saves: two cards, each with its own reason', async () => {
    await i18n.changeLanguage('en');
    const first = pageStep(afterSave('changed'), { type: 'read-answered', state: loaded('"e9"') });
    const second = afterSave('refused', UNKNOWN, first);
    expect(new Set(second.lost.map((notice) => notice.save)).size).toBe(2);
    const html = lostHtml(second);
    expect(count(html, 'Not saved: type these edits again')).toBe(2);
    expect(count(html, 'The file was changed elsewhere')).toBe(1);
    expect(count(html, 'The proxy refused the configuration')).toBe(1);
    expect(html.indexOf('changed elsewhere')).toBeLessThan(html.indexOf('The proxy refused'));
  });

  test('each edit in words to type again: model, alias before and after, options', async () => {
    await i18n.changeLanguage('en');
    let page = pageWith(loaded());
    page = pageStep(page, { type: 'alias-typed', rowId: 'gemini/0/0#0', text: 'g-pro-2' });
    page = pageStep(page, {
      type: 'edited',
      change: (d) => addKeyAlias(d, 'gemini/0/0', 'gemini-2.5-pro', 'second'),
    });
    page = pageStep(page, { type: 'save-started' });
    page = pageStep(page, {
      type: 'save-answered',
      outcome: {
        confirmed: [],
        unconfirmed: ['gemini/0/0'],
        failure: { reason: 'changed', message: '' },
      },
    });
    expect(page.lost[0].edits).toEqual(editsOf(addKeyAliasDraft(), 'gemini/0/0'));
    const html = lostHtml(page);
    for (const text of ['Gemini · gemini-1', 'gemini-2.5-pro', 'g-pro', 'g-pro-2', 'second']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('>changed<');
    expect(html).toContain('>added<');
  });

  test('the value typed on the second of two rows of one model is the value listed (third review)', async () => {
    await i18n.changeLanguage('en');
    const document = {
      'api-keys': {
        claude: [
          {
            name: 'g',
            keys: [
              {
                'api-key': 'fixture-key',
                models: [
                  { name: 'm', alias: 'red' },
                  { name: 'm', alias: 'blue' },
                ],
              },
            ],
          },
        ],
      },
    };
    let page = pageWith({ ...readAliasState(document, []), etag: '"v1"' });
    page = pageStep(page, { type: 'alias-typed', rowId: 'claude/0/0#1', text: 'turquoise' });
    page = pageStep(page, { type: 'save-started' });
    page = pageStep(page, {
      type: 'save-answered',
      outcome: {
        confirmed: [],
        unconfirmed: ['claude/0/0'],
        failure: { reason: 'changed', message: '' },
      },
    });
    expect(page.lost).toHaveLength(1);
    expect(page.lost[0].edits).toEqual([
      {
        kind: 'changed',
        before: expect.objectContaining({ id: 'claude/0/0#1', alias: 'blue' }),
        after: expect.objectContaining({ id: 'claude/0/0#1', alias: 'turquoise' }),
      },
    ]);
    const html = lostHtml(page);
    expect(html).toMatch(/blue<\/code>.*turquoise<\/code>/);
    expect(html).not.toContain('>red<');
  });
});

/** The draft `G-3 each edit` builds, through the draft functions alone. */
function addKeyAliasDraft(): AliasDraft {
  const draft = changeRow(startDraft(loaded()), 'gemini/0/0#0', { alias: 'g-pro-2' });
  return addKeyAlias(draft, 'gemini/0/0', 'gemini-2.5-pro', 'second');
}

describe('G-4 the remove control', () => {
  test('after typing then removing a model’s only row, no text is kept and the box shows the draft, empty', async () => {
    await i18n.changeLanguage('en');
    // The alias box of the row, wherever React puts its `value` among the attributes.
    const box = (html: string) =>
      html
        .match(/<input[^>]*aria-label="Alias for gemini-2\.5-pro[^>]*>/)?.[0]
        .match(/ value="([^"]*)"/)?.[1];
    let page = pageWith(loaded());
    expect(box(renderBody(page))).toBe('g-pro');
    page = pageStep(page, {
      type: 'alias-typed',
      rowId: 'gemini/0/0#0',
      text: 'typed-then-removed',
    });
    expect(page.texts['gemini/0/0#0']).toBe('typed-then-removed');
    expect(box(renderBody(page))).toBe('typed-then-removed');
    page = pageStep(page, { type: 'row-removed', rowId: 'gemini/0/0#0' });
    expect('gemini/0/0#0' in page.texts).toBe(false);
    // The model's only row stays, with no alias (3.2): the box shows that.
    expect(page.draft!.rows.find((row) => row.id === 'gemini/0/0#0')?.alias).toBeNull();
    expect(box(renderBody(page))).toBe('');
  });
});

describe('what the page cannot read', () => {
  const unreadable = () => ({
    ...readAliasState(fixture('config-unreadable.json'), files()),
    etag: '"u1"',
  });

  test('one line names the parts and says they stay in the file', async () => {
    await i18n.changeLanguage('en');
    const state = unreadable();
    // The line is the frame's (3.6), above the board.
    const html = renderBody(pageWith(state));
    expect(html).toContain('cannot be read here and are left in it untouched');
    expect(html).toContain(state.unread[0]);
    expect(html).toContain(`${state.unread.length - 3} more`);
    expect(renderBody(pageWith({ ...loaded(), unread: [] }))).not.toContain('left in it untouched');
  });

  test('a key whose model list is unreadable says so, not "no model list"', async () => {
    await i18n.changeLanguage('en');
    const state = unreadable();
    const xai = state.entries.find((e) => e.store === 'api-key' && e.family === 'xai');
    expect(xai && keyListUnread(xai as never, state.unread)).toBe(true);
    expect(render(startDraft(state))).toContain('Its model list cannot be read here');
  });

  test('a login type partly unreadable shows its rows, locked, without "Add an alias"', async () => {
    await i18n.changeLanguage('en');
    const document = fixture('config-full.json') as { oauth: { 'model-alias': Tree } };
    document.oauth['model-alias'].CODEX = 'not-a-list';
    const state = { ...readAliasState(document, files()), etag: '"u2"' };
    const codex = state.entries.find((e) => e.id === 'login/codex');
    expect(codex?.store === 'login' && codex.unread).toBe(true);
    const html = render(startDraft(state));
    const card = html.slice(html.indexOf('aria-label="Codex logins"'));
    const cardEnd = card.indexOf('</article>');
    const codexCard = card.slice(0, cardEnd);
    expect(codexCard).toContain('cannot be read here, so it cannot be edited on this page');
    expect(codexCard).toContain('value="g55"');
    expect(codexCard).toMatch(/value="g55"[^>]*disabled=""|disabled=""[^>]*value="g55"/);
    expect(codexCard).not.toContain('Add an alias');
  });

  test('an unreadable login map: no login alias can be edited or added', async () => {
    await i18n.changeLanguage('en');
    const document = fixture('config-full.json') as { oauth: Tree };
    document.oauth['model-alias'] = 'junk';
    const html = render(startDraft({ ...readAliasState(document, files()), etag: '"u3"' }));
    expect(html).toContain('The login alias map cannot be read here');
    expect(html).not.toContain('Aliases for another login type');
  });
});

describe('U2: the old login alias address (F-5)', () => {
  test("/auth-files/oauth-model-alias is the redirect, and wins over upstream's route for it", () => {
    const route = PROVIMUX_ROUTES.find((r) => r.path === '/auth-files/oauth-model-alias');
    expect(route!.element.type).toBe(AliasesRedirect);
    // The table as MainRoutes builds it: Provimux's routes first, then upstream's old editor.
    const old = { path: '/auth-files/oauth-model-alias', element: 'upstream editor' };
    const matched = matchRoutes([...PROVIMUX_ROUTES, old], '/auth-files/oauth-model-alias');
    expect(matched?.[0].route.element).toBe(route!.element);
    const read = readFileSync('src/router/MainRoutes.tsx', 'utf8');
    expect(read.indexOf('...PROVIMUX_ROUTES,')).toBeLessThan(
      read.indexOf("{ path: '/auth-files/oauth-model-alias'")
    );
  });

  test('?provider= becomes &channel=, and the page opens on that login type', () => {
    expect(aliasesAddressFor('')).toBe('/provimux/aliases?store=login');
    expect(aliasesAddressFor('?provider=claude&view=graph')).toBe(
      '/provimux/aliases?store=login&channel=claude'
    );
    // The Auth Files tile's own link, through the redirect, to the page's filter.
    const tile = buildModelRulesPath('alias', 'anti_gravity');
    const target = aliasesAddressFor(tile.slice(tile.indexOf('?')));
    expect(initialFilter(new URLSearchParams(target.slice(target.indexOf('?'))))).toMatchObject({
      store: 'login',
      provider: 'login:antigravity',
    });
  });
});

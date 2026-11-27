// The page state of design aliases-page.md (section 8), which the Models page (models-page.md) now holds:
// what it marks and counts, its strings in the seven languages, the page after a save (3.6, U4), and G-1 to
// G-4 of section 7 drawn by the Models page's body; P-4 is in aliases-page-property.test.ts. The Models
// page's own list, edits, addresses and menu are in models-page.test.ts.
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
  editsOf,
  removeRow,
  startDraft,
} from '@/provimux/pages/aliases/draft';
import {
  INITIAL_PAGE,
  canEdit,
  changeCount,
  leaveGuarded,
  pageStep,
  removedCounts,
  rowMarks,
  saveBarShown,
  type PageState,
} from '@/provimux/pages/aliases/pageLogic';
import { LostEdits } from '@/provimux/pages/aliases/LostEdits';
import { ModelsBody } from '@/provimux/pages/models/ModelsBody';
import {
  EMPTY_MODELS_FILTER,
  candidatesFor,
  keyListUnread,
  listlessKeys,
  rowEditable,
} from '@/provimux/pages/models/catalog';
import { PROVIMUX_TRANSLATIONS, overlayStrings } from '@/provimux/i18n';
import type { AliasDraft, AliasState, KeyEntry, SaveFailure } from '@/provimux/pages/aliases/types';
import { pluralCategories } from '../helpers/pluralCategories';

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

describe('strings in seven languages', () => {
  type Tree = { [key: string]: string | Tree };
  const en = JSON.parse(readFileSync('src/provimux/locales/en.json', 'utf8')) as Tree;
  const placeholders = (text: string) =>
    [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  const baseOf = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');

  // The pages' strings (Aliases, Models, Restarts), the provider forms' line (U3), and Routing's "Back to the
  // first account".
  for (const block of [
    'aliases',
    'models',
    'forms',
    'names',
    'restarts',
    'session_return',
  ] as const) {
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
        const forms = pluralCategories(language);
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
      expect(i18n.t('provimux.models.lede')).not.toBe(
        'Every model name your tools can send, and what serves it, in the order Provimux tries. Give models names of your own, put several under one name, and save once.'
      );
      expect(i18n.t('provimux.nav_meta.models')).not.toBe(
        'Every model name you can send, and what serves it'
      );
      expect(i18n.t('provimux.aliases.unsaved', { count: 3 })).toContain('3');
      expect(i18n.t('provimux.models.count_names', { count: 3 })).toContain('3');
      // The shared words the page uses are translated; the other Provimux strings stay English.
      expect(i18n.t('provimux.common.reload')).not.toBe('Reload');
      expect(i18n.t('provimux.common.refresh')).toBe('Refresh');
      expect(i18n.t('provimux.nav.savings')).toBe('Savings');
    }
    await i18n.changeLanguage('en');
    expect(i18n.t('provimux.models.count_names', { count: 1 })).toBe('1 name');
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

const noop = () => undefined;

/** The Models page's body over a page state, without Provimux's endpoints (they are not read here). */
function renderBody(page: PageState) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ModelsBody, {
        page,
        routes: null,
        routesKnown: null,
        routesError: null,
        routesOffsetMs: 0,
        lists: null,
        usage: null,
        nowMs: 0,
        filter: EMPTY_MODELS_FILTER,
        onFilter: noop,
        edit: noop,
        devin: {
          value: false,
          readError: null,
          logins: null,
          saving: false,
          read: async () => undefined,
          set: async () => ({ ok: true }),
        },
        onRoutesChanged: noop,
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
    expect(html).toContain('Codex subscription');
    expect(html).toContain('No model yet');
    expect(html.indexOf('g-pro-2')).toBeLessThan(html.indexOf('No model yet'));
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
  test('after typing then removing a model’s only row, no text is kept and the draft holds no alias', () => {
    let page = pageWith(loaded());
    page = pageStep(page, {
      type: 'alias-typed',
      rowId: 'gemini/0/0#0',
      text: 'typed-then-removed',
    });
    expect(page.texts['gemini/0/0#0']).toBe('typed-then-removed');
    page = pageStep(page, { type: 'row-removed', rowId: 'gemini/0/0#0' });
    expect('gemini/0/0#0' in page.texts).toBe(false);
    // The model's only row stays, with no alias (3.2).
    expect(page.draft!.rows.find((row) => row.id === 'gemini/0/0#0')?.alias).toBeNull();
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

  test('a key whose model list is unreadable is not offered, nor called a key without a list', () => {
    const state = unreadable();
    const xai = state.entries.find((e) => e.store === 'api-key' && e.family === 'xai') as KeyEntry;
    expect(keyListUnread(xai, state.unread)).toBe(true);
    const draft = startDraft(state);
    expect(listlessKeys(draft).map((entry) => entry.id)).not.toContain(xai.id);
    expect(candidatesFor(draft, null, 'x').some((c) => c.entryId === xai.id)).toBe(false);
  });

  test('a login type partly unreadable: its rows are shown, take no edit, and nothing is added to it', () => {
    const document = fixture('config-full.json') as { oauth: { 'model-alias': Tree } };
    document.oauth['model-alias'].CODEX = 'not-a-list';
    const state = { ...readAliasState(document, files()), etag: '"u2"' };
    const codex = state.entries.find((e) => e.id === 'login/codex');
    expect(codex?.store === 'login' && codex.unread).toBe(true);
    const draft = startDraft(state);
    const rows = draft.rows.filter((row) => row.entryId === 'login/codex');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(rowEditable(draft, row.id)).toBe(false);
    expect(candidatesFor(draft, null, 'x').some((c) => c.entryId === 'login/codex')).toBe(false);
    expect(rowEditable(draft, 'gemini/0/0#0')).toBe(true);
  });

  test('an unreadable login map: no login alias can be edited or added', () => {
    const document = fixture('config-full.json') as { oauth: Tree };
    document.oauth['model-alias'] = 'junk';
    const draft = startDraft({ ...readAliasState(document, files()), etag: '"u3"' });
    expect(candidatesFor(draft, null, 'x').some((c) => c.store === 'login')).toBe(false);
    expect(addLoginAlias(draft, 'claude', { upstream: 'm', alias: 'n' })).toBe(draft);
  });
});

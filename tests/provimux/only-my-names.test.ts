// "Serve only my names" on the Models page (design models-page.md 8; the gateway's only-my-names.md, section 9's
// console tests): his names equal the gateway's on the shared fixture; the preview puts used names first and
// counts them; Keep writes the whole object with If-Match and waits while name edits are unsaved; a gateway without
// /provimux/names shows no switch; with no names the switch cannot be turned on. And the three line fixes on a
// name's card: an OpenAI-compatible entry's keys told apart, no order number on a line not served, and a pool's
// second model on its route's line.
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import type { AuthFilesResponse } from '@/types/authFile';
import { readModelRoutes, readNames, readSavings } from '@/provimux/api/normalize';
import type { ProvimuxNamesResponse } from '@/provimux/api/types';
import { presenceOf } from '@/provimux/presence';
import { nameKey } from '@/provimux/pages/aliases/collisions';
import { changeRow, draftEntries, startDraft } from '@/provimux/pages/aliases/draft';
import {
  INITIAL_PAGE,
  isDirty,
  pageStep,
  type PageState,
} from '@/provimux/pages/aliases/pageLogic';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import type { AliasDraft, AliasState } from '@/provimux/pages/aliases/types';
import {
  EMPTY_MODELS_FILTER,
  buildNames,
  sections,
  type ModelsFilter,
  type NameItem,
  type SetNames,
} from '@/provimux/pages/models/catalog';
import { NameCard } from '@/provimux/pages/models/NameCard';
import { ModelsBody } from '@/provimux/pages/models/ModelsBody';
import type { BoardNames } from '@/provimux/pages/models/ModelsBoard';
import {
  accountGroups,
  droppedBySave,
  dropIgnoredBody,
  keepBody,
  othersOf,
  previewOf,
  readSetting,
  refusedOf,
  servedCopiesOf,
  setNamesOf,
  switchBody,
  unkeepBody,
  usageStateOf,
  yourNameKeys,
} from '@/provimux/pages/models/namesSetting';
import { OnlyMyNamesSwitch, type NamesWrite } from '@/provimux/pages/models/OnlyMyNames';
import { onlyMyNamesApi, NamesRequestError } from '@/provimux/pages/models/onlyMyNamesApi';
import type { DevinCooling } from '@/provimux/pages/modelRoutes/useDevinCooling';
import { fakeProxy, restoreProxy } from './support/fakeProxy';
import {
  OWNER_NOW,
  nameOf,
  ownerFixture,
  ownerLists,
  ownerNames,
  ownerRoutes,
  ownerState,
  ownerUsage,
  renderCard,
  textOf,
} from './support/models';

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});
afterEach(restoreProxy);

type Doc = Record<string, unknown>;

/** The gateway's answer for the owner's configuration (tests/provimux/fixtures/models/owner-names.json). */
const ownerAnswer = (change?: (answer: Doc) => void): ProvimuxNamesResponse => {
  const raw = structuredClone(ownerFixture('names')) as Doc;
  change?.(raw);
  return readNames(raw);
};
const credentials = () =>
  normalizeAuthFilesResponse(ownerFixture('credentials') as AuthFilesResponse).files;
/** The owner's configuration with something changed, read as the page reads it. */
const stateWith = (
  change: (config: Doc) => void,
  etag: string | null = '"owner-1"'
): AliasState => {
  const config = structuredClone(ownerFixture('config')) as Doc;
  change(config);
  return { ...readAliasState(config, credentials()), etag };
};
const withSetting = (setting: unknown) =>
  stateWith((config) => {
    config.models = { ...(config.models as Doc), 'only-my-names': setting };
  });

const noop = () => undefined;
const devin = (): DevinCooling => ({
  value: false,
  readError: null,
  logins: { enabled: 1, disabled: 0 },
  saving: false,
  read: async () => undefined,
  set: async () => ({ ok: true }),
});
const pageWith = (state: AliasState): PageState =>
  pageStep(INITIAL_PAGE, { type: 'read-answered', state });

/** The page below its header, with "Serve only my names" as the page hands it to the board. */
function renderBody(
  page: PageState,
  names: BoardNames | undefined,
  options: { filter?: ModelsFilter; writing?: string | null; routes?: unknown } = {}
) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ModelsBody, {
        page,
        routes: options.routes === undefined ? ownerRoutes() : readModelRoutes(options.routes),
        routesKnown: true,
        routesError: null,
        routesOffsetMs: OWNER_NOW - Date.now(),
        lists: ownerLists(),
        usage: ownerUsage(),
        nowMs: OWNER_NOW,
        filter: options.filter ?? EMPTY_MODELS_FILTER,
        onFilter: noop,
        edit: noop,
        devin: devin(),
        onRoutesChanged: noop,
        onRetry: noop,
        onDismiss: noop,
        writing: options.writing ?? null,
        names,
      })
    )
  );
}
const boardNames = (
  answer: ProvimuxNamesResponse | null,
  write = async (_: NamesWrite) => true
) => ({
  answer,
  error: null,
  usage: 'known' as const,
  write,
});
/** The routes the gateway reports with the switch on: only the names in `served`. */
const routesServing = (served: readonly string[]) => {
  const raw = structuredClone(ownerFixture('model-routes')) as { models: Array<{ id: string }> };
  const keys = new Set(served.map((name) => name.toLowerCase()));
  return { ...raw, models: raw.models.filter((model) => keys.has(model.id.toLowerCase())) };
};

describe('whose names: the console and the gateway count the same ones', () => {
  test('on the shared fixture, Your names is exactly the gateway’s list of his names', () => {
    const items = ownerNames();
    const yours = sections(items)
      .yours.map((item) => item.key)
      .sort();
    const answer = ownerAnswer();
    expect(answer.names.map((own) => own.name.toLowerCase()).sort()).toEqual(yours);
    // Every other name an account offers is the gateway's "others", and nothing is in both.
    const others = othersOf(answer, yourNameKeys(answer, readSetting(ownerState().document)), null);
    expect(others).toHaveLength(28);
    expect(others.some((other) => yours.includes(other.key))).toBe(false);
    expect(items).toHaveLength(answer.names.length + others.length);
  });

  test('a name kept under its own name is his: under Your names, marked, and Stop keeping is its action', async () => {
    await i18n.changeLanguage('en');
    const state = withSetting({ enabled: false, keep: ['claude-haiku-5-5', ' Gemini-3-Flash '] });
    const setting = readSetting(state.document);
    expect(setting.keep).toEqual(['claude-haiku-5-5', 'Gemini-3-Flash']);
    const answer = ownerAnswer();
    const draft = startDraft(state);
    const items = ownerNames(draft).length;
    const kept = ownerNamesWith(draft, setNamesOf(answer, setting));
    expect(kept).toHaveLength(items);
    const haiku = nameOf(kept, 'claude-haiku-5-5');
    expect([haiku.own, haiku.kept, haiku.aliased]).toEqual([true, true, false]);
    expect(sections(kept).yours.map((item) => item.key)).toContain('gemini-3-flash');
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(CardWithUnkeep, { item: haiku, draft }))
    );
    expect(textOf(html)).toContain('kept under its own name');
    expect(textOf(html)).toContain('Stop keeping');
    // Not "Your name" as well: one mark says whose it is.
    expect(textOf(html)).not.toContain('Your name');
    // A kept name has no alias rows: nothing to rename, nothing to remove in its editor.
    const open = textOf(renderCard(haiku, draft, undefined, { open: true }));
    expect(open).not.toContain('Rename');
    expect(open).not.toContain('Remove this name');
  });

  test('a kept name no account offers now still stands under Your names, saying so', async () => {
    await i18n.changeLanguage('en');
    const state = withSetting({ enabled: true, keep: ['gpt-9-preview'] });
    const draft = startDraft(state);
    const items = ownerNamesWith(draft, setNamesOf(ownerAnswer(), readSetting(state.document)));
    const kept = nameOf(items, 'gpt-9-preview');
    expect([kept.own, kept.lines.length, kept.accounts]).toEqual([true, 0, 0]);
    expect(textOf(renderCard(kept, draft))).toContain('No account offers this name now');
  });

  test('a name kept a moment ago counts as his before the gateway’s answer catches up, and leaves it as fast', () => {
    const answer = ownerAnswer((raw) => {
      (raw.names as Doc[]).push({ name: 'gpt-6.2-sol', set_by: ['keep'], accounts: 1 });
    });
    // The read's keep no longer lists gpt-6.2-sol (Stop keeping was just written), and lists gemini-3-flash.
    const setting = readSetting(withSetting({ enabled: false, keep: ['gemini-3-flash'] }).document);
    const yours = yourNameKeys(answer, setting);
    expect(yours.has('gemini-3-flash')).toBe(true);
    expect(yours.has('gpt-6.2-sol')).toBe(false);
    expect(othersOf(answer, yours, null).map((o) => o.key)).not.toContain('gemini-3-flash');
  });
});

describe('the preview: what stops being served, used names first', () => {
  test('the names used in 30 days first, most used first, counted; the rest by name', () => {
    const answer = ownerAnswer();
    const setting = readSetting(ownerState().document);
    const preview = previewOf(othersOf(answer, yourNameKeys(answer, setting), ownerUsage()), 13);
    expect(preview.stop).toHaveLength(28);
    expect(preview.used.map((item) => [item.name, item.requests])).toEqual([
      ['claude-haiku-5-5', 90],
      ['gpt-6.1-codex', 75],
      ['gemini-3-flash', 40],
      ['gpt-6.2-sol', 30],
      ['swe-2-flash', 12],
    ]);
    expect(preview.unused).toHaveLength(23);
    expect(preview.unused.map((item) => item.name)).toEqual(
      [...preview.unused.map((item) => item.name)].sort((a, b) => a.localeCompare(b))
    );
    expect(preview.stop.slice(0, 5)).toEqual(preview.used);
  });

  test('the switch off, turned on: the preview says what will stop, with Keep, and the button says what happens', async () => {
    await i18n.changeLanguage('en');
    const html = renderPreview(pageWith(ownerState()), ownerAnswer());
    const text = textOf(html);
    expect(text).toContain(
      '28 names will stop being served. 5 of them were used in the last 30 days.'
    );
    expect(text).toContain('Stay served 13');
    expect(text).toContain('claude-haiku-5-5 90 requests in 30 days');
    expect(text).toContain('Keep all 5');
    expect(text).toContain('Show 23 names');
    // Before writing, who will serve it, and which of them is paid per token.
    expect(text).toContain(
      'claude-haiku-5-5 90 requests in 30 days Served by: Claude subscription Keep'
    );
    expect(text).toContain(
      'gemini-3-flash 40 requests in 30 days Served by: Gemini API key paid per token Keep'
    );
    expect(text).toContain('Turn on: 5 used names will be refused');
    expect(html.match(/aria-label="Keep [^"]+"/g)).toHaveLength(5);
  });

  test('used names kept: the button says how many names stay served; usage not known: one line says so', async () => {
    await i18n.changeLanguage('en');
    const state = withSetting({
      enabled: false,
      keep: ['claude-haiku-5-5', 'gpt-6.1-codex', 'gemini-3-flash', 'gpt-6.2-sol', 'swe-2-flash'],
    });
    const text = textOf(renderPreview(pageWith(state), ownerAnswer()));
    expect(text).toContain(
      '23 names will stop being served. None of them was used in the last 30 days.'
    );
    expect(text).toContain('Serve only my names (18)');
    expect(text).not.toContain('will be refused');
    const unknown = textOf(renderPreview(pageWith(ownerState()), ownerAnswer(), 'unknown'));
    expect(unknown).toContain('not in order of use');
    expect(usageStateOf(readSavings(ownerFixture('usage')), false)).toBe('known');
    expect(usageStateOf(null, true)).toBe('unknown');
    expect(usageStateOf(null, false)).toBe('loading');
    const folded = readSavings(ownerFixture('usage'));
    folded.breakdowns.find((b) => b.by[0] === 'model')!.truncated = true;
    expect(usageStateOf(folded, false)).toBe('partial');
  });

  test('with no names, it cannot be turned on: the button waits for a kept name', async () => {
    await i18n.changeLanguage('en');
    // The owner today: no alias rows at all.
    const state = stateWith((config) => {
      (config.oauth as Doc)['model-alias'] = {};
      for (const groups of Object.values(config['api-keys'] as Doc)) {
        for (const group of groups as Doc[]) {
          for (const model of (group.models as Doc[] | undefined) ?? []) delete model.alias;
          for (const key of (group.keys as Doc[]) ?? []) {
            for (const model of (key.models as Doc[] | undefined) ?? []) delete model.alias;
          }
        }
      }
    });
    const answer = ownerAnswer((raw) => {
      const others = raw.others as Doc[];
      for (const own of raw.names as Doc[]) others.push({ name: own.name, accounts: [] });
      raw.names = [];
    });
    const off = textOf(renderBody(pageWith(state), boardNames(answer)));
    expect(off).toContain('You have no names of your own yet');
    const html = renderPreview(pageWith(state), answer);
    expect(textOf(html)).toContain('Keep a name first: with none, nothing would be served.');
    expect(textOf(html)).toContain('Stay served 0');
    expect(html).toContain('disabled=""><span>Serve only my names</span></button>');
  });
});

describe('Keep: the whole object, at once, with If-Match on the page’s read', () => {
  test('keep adds the names once, at the end; the switch and every other field stay as stored', () => {
    const setting = readSetting(
      withSetting({ enabled: false, keep: ['opus-x', 'claude-*', 7], note: 'by hand' }).document
    );
    expect(keepBody(setting, ['Opus-X', 'gpt-6.2-sol', 'gpt-6.2-sol', 'gemini-*', ' '])).toEqual({
      enabled: false,
      keep: ['opus-x', 'claude-*', 7, 'gpt-6.2-sol'],
      note: 'by hand',
    });
    expect(unkeepBody(setting, 'OPUS-X')).toEqual({
      enabled: false,
      keep: ['claude-*', 7],
      note: 'by hand',
    });
    expect(switchBody(setting, true)).toEqual({
      enabled: true,
      keep: ['opus-x', 'claude-*', 7],
      note: 'by hand',
    });
    expect(dropIgnoredBody(setting, ['claude-*'])).toEqual({
      enabled: false,
      keep: ['opus-x', 7],
      note: 'by hand',
    });
    // A file without the setting: off, nothing kept, and the first write says both.
    expect(keepBody(readSetting(ownerState().document), ['gpt-6.2-sol'])).toEqual({
      enabled: false,
      keep: ['gpt-6.2-sol'],
    });
  });

  test('one PUT of /config/models/only-my-names with If-Match; the rest of the file untouched', async () => {
    const proxy = fakeProxy({ ...(ownerFixture('config') as Doc) });
    const state = { ...readAliasState(proxy.doc(), credentials()), etag: proxy.tag() };
    const tag = await onlyMyNamesApi.write(
      state,
      keepBody(readSetting(state.document), ['gpt-6.2-sol'])
    );
    expect(proxy.puts().map(({ path, ifMatch, body }) => ({ path, ifMatch, body }))).toEqual([
      {
        path: '/config/models/only-my-names',
        ifMatch: '"t1"',
        body: { enabled: false, keep: ['gpt-6.2-sol'] },
      },
    ]);
    expect(tag).toBe('"t2"');
    expect(proxy.doc().models).toEqual({
      'live-lists': true,
      'only-my-names': { enabled: false, keep: ['gpt-6.2-sol'] },
    });
    const before = structuredClone(ownerFixture('config')) as Doc;
    expect({ ...proxy.doc(), models: before.models }).toEqual(before);
    expect(proxy.unconditional).toBe(0);
  });

  test('a file changed since the read writes nothing (412); a read without a tag, or a setting not readable, sends nothing', async () => {
    const proxy = fakeProxy(ownerFixture('config'));
    const state = { ...readAliasState(proxy.doc(), credentials()), etag: proxy.tag() };
    proxy.foreign((doc) => {
      doc.routing = { strategy: 'fill-first' };
    });
    const changed = await onlyMyNamesApi
      .write(state, switchBody(readSetting(state.document), true))
      .catch((e) => e);
    expect(changed).toBeInstanceOf(NamesRequestError);
    expect(changed.reason).toBe('changed');
    expect(proxy.doc().models).toEqual({ 'live-lists': true });

    const untagged = await onlyMyNamesApi
      .write({ ...state, etag: null }, switchBody(readSetting(state.document), true))
      .catch((e) => e);
    expect(untagged.reason).toBe('no-tag');
    const odd = withSetting(['not', 'a', 'map']);
    expect(readSetting(odd.document).unreadable).toBe(true);
    const unreadable = await onlyMyNamesApi.write(odd, { enabled: true, keep: [] }).catch((e) => e);
    expect(unreadable.reason).toBe('unreadable');
    expect(proxy.puts()).toHaveLength(1);
  });

  test('while name edits are unsaved, nothing is written: every Keep waits, and one line says why', async () => {
    await i18n.changeLanguage('en');
    const page = pageWith(ownerState());
    const draft = page.draft!;
    const row = draft.rows.find((r) => r.alias === 'haiku')!;
    const dirty = pageStep(page, {
      type: 'edited',
      change: (d) => changeRow(d, row.id, { alias: 'haiku-2' }),
    });
    // The page's write is refused before it starts…
    expect(pageStep(dirty, { type: 'write-started' })).toBe(dirty);
    // …and the preview says so, every Keep disabled.
    const html = renderPreview(dirty, ownerAnswer());
    expect(textOf(html)).toContain(
      'Save or discard your name edits first: this setting is written at once.'
    );
    const keeps = html.match(/<button[^>]*aria-label="Keep [^"]+"[^>]*>/g) ?? [];
    expect(keeps).toHaveLength(5);
    expect(keeps.every((button) => button.includes('disabled=""'))).toBe(true);
    // Without edits, the same buttons take a click.
    const clean =
      renderPreview(page, ownerAnswer()).match(/<button[^>]*aria-label="Keep [^"]+"[^>]*>/g) ?? [];
    expect(clean.some((button) => button.includes('disabled=""'))).toBe(false);
  });

  test('with the switch on, a save that takes a name’s last alias away says the name will no longer be served', () => {
    const page = pageWith(withSetting({ enabled: true, keep: ['glm'] }));
    let draft = page.draft!;
    for (const alias of ['haiku', 'glm', 'sonnet']) {
      for (const row of draft.rows.filter((r) => r.alias === alias)) {
        draft = changeRow(draft, row.id, { alias: alias === 'sonnet' ? 'sonnet-5' : null });
      }
    }
    const setNames = setNamesOf(ownerAnswer(), readSetting(draft.base.document));
    // glm stays: it is kept. haiku goes; sonnet is renamed, so the old name goes.
    expect(droppedBySave(draft, setNames).sort()).toEqual(['haiku', 'sonnet']);
  });
});

describe('the switch on the page', () => {
  test('a gateway without /provimux/names (404): no switch, and nothing else changes', async () => {
    await i18n.changeLanguage('en');
    expect(presenceOf({ error: Object.assign(new Error('nope'), { status: 404 }) }).status).toBe(
      'unsupported'
    );
    const without = textOf(renderBody(pageWith(ownerState()), undefined));
    expect(without).not.toContain('Serve only my names');
    expect(without).toContain('Your names 13');
    // Not answered yet: no switch either, and no line.
    expect(textOf(renderBody(pageWith(ownerState()), boardNames(null)))).not.toContain(
      'Serve only my names'
    );
  });

  test('off: the switch, its line, and every name as before', async () => {
    await i18n.changeLanguage('en');
    const text = textOf(renderBody(pageWith(ownerState()), boardNames(ownerAnswer())));
    expect(text).toContain('Serve only my names');
    expect(text).toContain(
      'Tools can ask only for the names under Your names. Every other model is refused.'
    );
    expect(text).toContain('Off: all 41 names are served, 13 of them yours.');
    expect(text).toContain('Used in the last 30 days 5');
  });

  test('on: his names, then Not served (folded, used ones counted), and the refused strip on top', async () => {
    await i18n.changeLanguage('en');
    const kept = ['claude-haiku-5-5'];
    const state = withSetting({ enabled: true, keep: kept });
    const answer = ownerAnswer((raw) => {
      raw.only_my_names = { enabled: true, applies: true, not_applied: null };
      raw.others = (raw.others as Doc[]).filter((other) => other.name !== 'claude-haiku-5-5');
      (raw.names as Doc[]).push({ name: 'claude-haiku-5-5', set_by: ['keep'], accounts: 2 });
      raw.refused = {
        since: '2026-11-24T13:00:00Z',
        names: [
          { name: 'gpt-6.1-codex', requests: 14, last_at: '2026-11-24T13:58:00Z' },
          { name: 'claude-haiku-5-5', requests: 2, last_at: '2026-11-24T12:59:00Z' },
        ],
        truncated: false,
      };
    });
    const served = [...answer.names.map((own) => own.name)];
    const text = textOf(
      renderBody(pageWith(state), boardNames(answer), { routes: routesServing(served) })
    );
    expect(text).toContain('On: 14 names served, 27 not served.');
    expect(text).toContain("Show what isn't served");
    // A name kept since it was refused leaves the strip.
    expect(
      refusedOf(answer, yourNameKeys(answer, readSetting(state.document))).map((r) => r.name)
    ).toEqual(['gpt-6.1-codex']);
    expect(text).toContain("A tool asked for 1 name that isn't served");
    expect(text).toMatch(/gpt-6\.1-codex 14 times · last 2 minutes ago/);
    expect(text).toContain('Your names 14');
    expect(text).toContain('Not served 27');
    expect(text).toContain("Show the 27 names that aren't served (4 used in 30 days)");
    // No "used" or "other" parts while it is on: everything not his is under Not served.
    expect(text).not.toContain('Used in the last 30 days 4');
    expect(text).not.toMatch(/Show \d+ other models?/);
  });

  test('an account’s prefixed copy of his name is served: counted as served, never under Not served', async () => {
    await i18n.changeLanguage('en');
    // The gateway serves team/<his name> on an account with prefix team (only-my-names.md 3.3) and lists it in
    // neither names nor others; model-routes lists it, as it lists every served name.
    const state = withSetting({ enabled: true, keep: ['claude-haiku-5-5'] });
    const answer = ownerAnswer((raw) => {
      raw.only_my_names = { enabled: true, applies: true, not_applied: null };
      raw.others = (raw.others as Doc[]).filter((other) => other.name !== 'claude-haiku-5-5');
      (raw.names as Doc[]).push({ name: 'claude-haiku-5-5', set_by: ['keep'], accounts: 2 });
    });
    const routes = routesServing(answer.names.map((own) => own.name));
    const copy = { ...structuredClone(routes.models[0]), id: `team/${routes.models[0].id}` };
    routes.models.push(copy);
    const yours = yourNameKeys(answer, readSetting(state.document));
    expect([...servedCopiesOf(readModelRoutes(routes), answer, yours)]).toEqual([
      copy.id.toLowerCase(),
    ]);
    const text = textOf(renderBody(pageWith(state), boardNames(answer), { routes }));
    expect(text).toContain('On: 15 names served, 27 not served.');
    expect(text).toContain('Not served 27');
    expect(text).toContain("Show the 27 names that aren't served");
    // Off, the same file: every name is counted once, the copy included.
    const off = ownerAnswer((raw) => {
      raw.others = (raw.others as Doc[]).filter((other) => other.name !== 'claude-haiku-5-5');
      (raw.names as Doc[]).push({ name: 'claude-haiku-5-5', set_by: ['keep'], accounts: 2 });
    });
    const offText = textOf(
      renderBody(
        pageWith(withSetting({ enabled: false, keep: ['claude-haiku-5-5'] })),
        boardNames(off),
        { routes }
      )
    );
    expect(offText).toContain('Off: all 42 names are served, 14 of them yours.');
  });

  test('on with no names: it says nothing is served; Home: the switch is off and says why', async () => {
    await i18n.changeLanguage('en');
    const none = ownerAnswer((raw) => {
      raw.only_my_names = { enabled: true, applies: true, not_applied: null };
      raw.names = [];
    });
    const noAliases = stateWith((config) => {
      (config.oauth as Doc)['model-alias'] = {};
      delete ((config['api-keys'] as Doc)['openai-compatibility'] as Doc[])[0].models;
      ((config['api-keys'] as Doc).claude as Doc[])[0].keys = [
        { 'api-key': 'fixture-key-anthropic-1', auth_index: 'ak-anthropic-1' },
      ];
    });
    expect(
      textOf(renderBody(pageWith(noAliases), boardNames(none), { routes: routesServing([]) }))
    ).toContain('On, and you have no names: nothing is served.');
    const home = ownerAnswer((raw) => {
      raw.only_my_names = { enabled: true, applies: false, not_applied: 'home' };
    });
    const html = renderBody(pageWith(ownerState()), boardNames(home));
    expect(textOf(html)).toContain(
      "Home decides which names this gateway serves, so this setting doesn't apply here."
    );
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    // An unknown reason is read as not applying.
    expect(
      readNames({ only_my_names: { enabled: true, applies: false, not_applied: 'later' } })
        .only_my_names
    ).toEqual({ enabled: true, applies: false, not_applied: 'later' });
  });

  test('who serves a name: subscriptions and keys by kind; an OpenAI-compatible entry is one account', () => {
    const groups = accountGroups([
      {
        auth_index: 'a',
        provider: 'claude',
        kind: 'oauth',
        priority: 0,
        host: null,
        login: { name: 'x', email: null, label: null },
      },
      {
        auth_index: 'b',
        provider: 'claude',
        kind: 'oauth',
        priority: 0,
        host: null,
        login: { name: 'y', email: null, label: null },
      },
      {
        auth_index: 'c',
        provider: 'openai-compatible-openrouter',
        kind: 'apikey',
        priority: 0,
        host: 'openrouter.ai',
        login: { name: null, email: null, label: 'openrouter' },
      },
      {
        auth_index: 'd',
        provider: 'openai-compatible-openrouter',
        kind: 'apikey',
        priority: 0,
        host: 'openrouter.ai',
        login: { name: null, email: null, label: 'openrouter' },
      },
    ]);
    expect(groups.map((g) => [g.access, g.provider, g.count])).toEqual([
      ['sub', 'claude', 2],
      ['api', 'openai-compatible-openrouter', 1],
    ]);
  });
});

describe('three line problems on a name’s card', () => {
  type Config = { 'api-keys': Record<string, Array<Doc & { keys: Doc[]; models?: Doc[] }>> };
  const twoKeys = () =>
    stateWith((raw) => {
      const config = raw as unknown as Config;
      config['api-keys']['openai-compatibility'][0].keys.push({
        'api-key': 'fixture-key-openrouter-2',
        auth_index: 'ak-openrouter-2',
      });
    });
  const twoKeyRoutes = () => {
    const raw = structuredClone(ownerFixture('model-routes')) as {
      models: Array<{ id: string; routes: Array<Doc & { auth_index: string }> }>;
    };
    for (const model of raw.models) {
      const openrouter = model.routes.find((route) => route.auth_index === 'ak-openrouter-1');
      if (openrouter) model.routes.push({ ...openrouter, auth_index: 'ak-openrouter-2' });
    }
    return readModelRoutes(raw);
  };

  test('an OpenAI-compatible entry with two keys: each line names its key, so no two lines read the same', async () => {
    await i18n.changeLanguage('en');
    const draft = startDraft(twoKeys());
    const deepseek = nameOf(ownerNames(draft, twoKeyRoutes()), 'deepseek');
    expect(deepseek.lines.map((line) => [line.account, line.keyName])).toEqual([
      ['openrouter.ai', 'fi******-1'],
      ['openrouter.ai', 'fi******-2'],
    ]);
    expect(deepseek.accounts).toBe(1);
    const text = textOf(renderCard(deepseek, draft, twoKeyRoutes()));
    expect(text).toContain('openrouter.ai key fi******-1');
    expect(text).toContain('openrouter.ai key fi******-2');
    // The keys stay masked: nothing of a key beyond its ends is drawn.
    expect(renderCard(deepseek, draft, twoKeyRoutes())).not.toContain('fixture-key-');
    // An entry with one key, or a login, names no key.
    const one = nameOf(ownerNames(), 'deepseek');
    expect(one.lines.map((line) => line.keyName)).toEqual([null]);
  });

  test('a line Provimux does not serve now has no order number', async () => {
    await i18n.changeLanguage('en');
    const raw = structuredClone(ownerFixture('model-routes')) as {
      models: Array<{ id: string; routes: Array<{ auth_index: string }> }>;
    };
    const sonnet = raw.models.find((model) => model.id === 'claude-sonnet-5-5')!;
    sonnet.routes = sonnet.routes.filter((route) => route.auth_index !== 'ak-anthropic-1');
    const routes = readModelRoutes(raw);
    const draft = startDraft(ownerState());
    const item = nameOf(ownerNames(draft, routes), 'claude-sonnet-5-5');
    expect(item.lines.map((line) => [line.access, line.state, line.rank])).toEqual([
      ['sub', 'live', 1],
      ['api', 'idle', null],
    ]);
    const html = renderCard(item, draft, routes);
    expect(textOf(html)).toContain("Provimux doesn't serve this route now");
    expect(html.match(/data-tried="true"/g)).toHaveLength(1);
    // Where the proxy does not say what it serves, a row still shows the order it will be tried in.
    expect(
      nameOf(ownerNames(draft, null, null), 'claude-sonnet-5-5').lines.some((l) => l.rank !== null)
    ).toBe(true);
  });

  test('a pool’s second model is drawn on its route’s line, served, without a line or a number of its own', async () => {
    await i18n.changeLanguage('en');
    const state = stateWith((raw) => {
      const config = raw as unknown as Config;
      config['api-keys']['openai-compatibility'][0].models!.push({
        name: 'deepseek/deepseek-v4-pro',
        alias: 'deepseek',
      });
    });
    const draft = startDraft(state);
    const deepseek = nameOf(ownerNames(draft), 'deepseek');
    expect(
      deepseek.lines.map((line) => [line.upstream, line.state, line.rank, line.poolOf !== null])
    ).toEqual([
      ['deepseek/deepseek-v4', 'live', 1, false],
      ['deepseek/deepseek-v4-pro', 'live', null, true],
    ]);
    expect(deepseek.accounts).toBe(1);
    const html = renderCard(deepseek, draft);
    const text = textOf(html);
    expect(text).not.toContain("doesn't serve");
    expect(text).toMatch(/deepseek\/deepseek-v4 or deepseek\/deepseek-v4-pro/);
    expect(html.match(/<li[^>]*data-state=/g)).toHaveLength(1);
    // The editor still lists both models, each on its own row.
    const editor = renderCard(deepseek, draft, undefined, { open: true });
    expect(editor.match(/data-state="live"[^>]*>/g)?.length).toBeGreaterThanOrEqual(2);
    expect(textOf(editor)).toMatch(
      /OpenRouter deepseek\/deepseek-v4 .*OpenRouter deepseek\/deepseek-v4-pro/
    );
    // Taking the second model out: it is drawn struck through on the route's line until the save.
    const removed = nameOf(
      ownerNames(changeRow(draft, deepseek.lines[1].rowId!, { alias: null })),
      'deepseek'
    );
    expect(removed.lines.map((line) => [line.upstream, line.state])).toEqual([
      ['deepseek/deepseek-v4', 'live'],
      ['deepseek/deepseek-v4-pro', 'removed'],
    ]);
  });
});

// --- helpers ------------------------------------------------------------------------------------------------

function ownerNamesWith(draft: AliasDraft, setNames: SetNames): NameItem[] {
  return buildNames({
    draft,
    routes: ownerRoutes(),
    lists: ownerLists(),
    usage: ownerUsage(),
    nowMs: OWNER_NOW,
    setNames,
  });
}

function CardWithUnkeep({ item, draft }: { item: NameItem; draft: AliasDraft }) {
  return createElement(NameCard, {
    id: 'card',
    item,
    draft,
    entries: draftEntries(draft),
    routes: ownerRoutes(),
    routesKnown: true,
    offsetMs: 0,
    locked: false,
    open: false,
    onToggle: noop,
    onRenamed: noop,
    onNewName: noop,
    edit: noop,
    onUnkeep: noop,
    keepBlocked: null,
  });
}

/** The page with the switch off and its preview open (the board keeps the preview's state; it opens here). */
function renderPreview(
  page: PageState,
  answer: ProvimuxNamesResponse,
  usage: 'known' | 'unknown' = 'known'
) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(PreviewHarness, { page, answer, usage }))
  );
}

function PreviewHarness({
  page,
  answer,
  usage,
}: {
  page: PageState;
  answer: ProvimuxNamesResponse;
  usage: 'known' | 'unknown';
}) {
  const draft = page.draft!;
  const setting = readSetting(draft.base.document);
  const yours = yourNameKeys(answer, setting);
  const others = othersOf(answer, yours, usage === 'known' ? ownerUsage() : null);
  const kept = new Set(setting.keep.map(nameKey));
  const yourNames = [
    ...answer.names.map((own) => ({
      key: nameKey(own.name),
      name: own.name,
      kept: kept.has(nameKey(own.name)),
    })),
    ...setting.keep
      .filter((name) => !answer.names.some((own) => nameKey(own.name) === nameKey(name)))
      .map((name) => ({ key: nameKey(name), name, kept: true })),
  ];
  return createElement(OnlyMyNamesSwitch, {
    state: {
      answer,
      setting,
      yours,
      others,
      usage,
      blocked: isDirty(page) ? i18n.t('provimux.names.blocked_dirty') : null,
      busy: false,
      writing: null,
      write: async () => true,
      nowMs: OWNER_NOW,
    },
    yourNames,
    previewOpen: true,
    onPreview: noop,
    onShowNotServed: noop,
  });
}

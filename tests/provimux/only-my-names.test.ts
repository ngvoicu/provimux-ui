// "Serve only my names" on the Models page (design models-page.md 8; the gateway's only-my-names.md, section 9's
// console tests): his names equal the gateway's on the shared fixture; the preview puts used names first and
// counts them; Keep writes the whole object with If-Match and waits while name edits are unsaved; a gateway without
// /provimux/names shows no switch; with no names the switch cannot be turned on. And the three line fixes on a
// name's card: an OpenAI-compatible entry's keys told apart, no order number on a line not served, and a pool's
// second model on its route's line.
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import type { AuthFilesResponse } from '@/types/authFile';
import { readModelRoutes, readNames, readSavings } from '@/provimux/api/normalize';
import { dayBefore, provimuxApi } from '@/provimux/api/provimuxApi';
import type { ProvimuxModelUsage, ProvimuxNamesResponse } from '@/provimux/api/types';
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
  usageByName,
  sections,
  type ModelsFilter,
  type NameItem,
  type SetNames,
} from '@/provimux/pages/models/catalog';
import { NameCard } from '@/provimux/pages/models/NameCard';
import {
  APPLIED_LIMIT_MS,
  applyingOf,
  waitApplied,
  type MarkerRead,
} from '@/provimux/pages/models/namesApplied';
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
  copyKeysOf,
  levelCopiesOf,
  servedCopiesOf,
  thinkingBase,
  setNamesOf,
  switchBody,
  unkeepBody,
  usageSinceOf,
  usageStateOf,
  yourNameKeys,
  yourNamesOf,
} from '@/provimux/pages/models/namesSetting';
import {
  OnlyMyNamesSwitch,
  RefusedStrip,
  type NamesState,
  type NamesWrite,
} from '@/provimux/pages/models/OnlyMyNames';
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
/** The answer once the gateway applied `keep`: each kept name is his (set_by keep), no longer another's. */
const keptAnswer = (kept: readonly string[], change?: (answer: Doc) => void) =>
  ownerAnswer((raw) => {
    for (const name of kept) {
      const other = (raw.others as Doc[]).find((o) => nameKey(o.name as string) === nameKey(name));
      raw.others = (raw.others as Doc[]).filter((o) => o !== other);
      const accounts = other ? (other.accounts as unknown[]).length : 0;
      (raw.names as Doc[]).push({ name, set_by: ['keep'], accounts, copies: [] });
    }
    change?.(raw);
  });
/** The same answer from a gateway older than the `applied` marker. */
const unmarked = (answer: ProvimuxNamesResponse): ProvimuxNamesResponse => ({
  ...answer,
  applied: null,
});
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
  options: {
    filter?: ModelsFilter;
    writing?: string | null;
    routes?: unknown;
    usage?: Record<string, number>;
    held?: AliasDraft | null;
  } = {}
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
        usage: options.usage ?? ownerUsage(),
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
        held: options.held,
      })
    )
  );
}
const boardNames = (
  answer: ProvimuxNamesResponse | null,
  write = async (_: NamesWrite) => true,
  extra: Partial<BoardNames> = {}
): BoardNames => ({
  answer,
  error: null,
  usage: 'known' as const,
  write,
  ...extra,
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
    expect(answer.names.map((own) => own.name).sort()).toEqual(yours);
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
    const answer = keptAnswer(['claude-haiku-5-5', 'gemini-3-flash']);
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
    // Its accessible name says which name, as Keep's does.
    expect(html).toContain('aria-label="Stop keeping claude-haiku-5-5"');
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
    const answer = keptAnswer(['gpt-9-preview']);
    expect(answer.names.find((own) => own.name === 'gpt-9-preview')?.accounts).toBe(0);
    const items = ownerNamesWith(draft, setNamesOf(answer, readSetting(state.document)));
    const kept = nameOf(items, 'gpt-9-preview');
    expect([kept.own, kept.lines.length, kept.accounts]).toEqual([true, 0, 0]);
    expect(textOf(renderCard(kept, draft))).toContain('No account offers this name now');
  });

  test('a write not applied yet: his names are the gateway’s (the rule it serves now), not the read’s', () => {
    // gpt-6.2-sol was kept and Stop keeping was just written; gemini-3-flash was just kept. The gateway still
    // applies the rule before: its answer is what it serves now.
    const answer = keptAnswer(['gpt-6.2-sol']);
    const setting = readSetting(withSetting({ enabled: false, keep: ['gemini-3-flash'] }).document);
    const yours = yourNameKeys(answer, setting);
    expect(yours.has('gpt-6.2-sol')).toBe(true);
    expect(yours.has('gemini-3-flash')).toBe(false);
    expect(othersOf(answer, yours, null).map((o) => o.key)).toContain('gemini-3-flash');
    expect([...setNamesOf(answer, setting).kept]).toEqual(['gpt-6.2-sol']);
    // A save of the file keeps what the file keeps: the read's.
    expect([...setNamesOf(answer, setting, 'config').kept]).toEqual(['gemini-3-flash']);
  });

  test('a gateway without the applied marker: a name kept a moment ago counts as his at once, as before', () => {
    const answer = unmarked(keptAnswer(['gpt-6.2-sol']));
    const setting = readSetting(withSetting({ enabled: false, keep: ['gemini-3-flash'] }).document);
    const yours = yourNameKeys(answer, setting);
    expect(yours.has('gemini-3-flash')).toBe(true);
    expect(yours.has('gpt-6.2-sol')).toBe(false);
    expect(othersOf(answer, yours, null).map((o) => o.key)).not.toContain('gemini-3-flash');
    expect(
      yourNamesOf(answer, setNamesOf(answer, setting), yours).find(
        (n) => n.key === 'gemini-3-flash'
      )
    ).toEqual({ key: 'gemini-3-flash', name: 'gemini-3-flash', kept: true });
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
    const kept = [
      'claude-haiku-5-5',
      'gpt-6.1-codex',
      'gemini-3-flash',
      'gpt-6.2-sol',
      'swe-2-flash',
    ];
    const state = withSetting({ enabled: false, keep: kept });
    const text = textOf(renderPreview(pageWith(state), keptAnswer(kept)));
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
    // Names are compared exactly (only-my-names.md 17.1 B): Opus-X is another name than opus-x, and is added;
    // opus-x, already kept, is not; `auto` is never a name.
    expect(
      keepBody(setting, [
        'Opus-X',
        ' opus-x ',
        'gpt-6.2-sol',
        'gpt-6.2-sol',
        'gemini-*',
        ' ',
        'auto',
      ])
    ).toEqual({
      enabled: false,
      keep: ['opus-x', 'claude-*', 7, 'Opus-X', 'gpt-6.2-sol'],
      note: 'by hand',
    });
    // Stop keeping takes out that name only, not another case of it.
    expect(unkeepBody(setting, 'OPUS-X')).toEqual({
      enabled: false,
      keep: ['opus-x', 'claude-*', 7],
      note: 'by hand',
    });
    expect(unkeepBody(setting, 'opus-x')).toEqual({
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
    const setNames = setNamesOf(ownerAnswer(), readSetting(draft.base.document), 'config');
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
    // The gateway serves team/<his name> on an account with prefix team (only-my-names.md 3.3) and lists it
    // under the name (copies); model-routes lists it, as it lists every served name.
    const state = withSetting({ enabled: true, keep: ['claude-haiku-5-5'] });
    const routes = routesServing([
      ...ownerAnswer().names.map((own) => own.name),
      'claude-haiku-5-5',
    ]);
    const base = routes.models[0].id;
    const copy = { ...structuredClone(routes.models[0]), id: `team/${base}` };
    routes.models.push(copy);
    const withCopy = (raw: Doc) => {
      const own = (raw.names as Doc[]).find((name) => name.name === base)!;
      own.copies = [{ id: copy.id, accounts: 1 }];
    };
    const answer = keptAnswer(['claude-haiku-5-5'], (raw) => {
      raw.only_my_names = { enabled: true, applies: true, not_applied: null };
      withCopy(raw);
    });
    expect(answer.names.find((own) => own.name === base)?.copies).toEqual([
      { id: copy.id, accounts: 1 },
    ]);
    expect([...copyKeysOf(answer)]).toEqual([copy.id.toLowerCase()]);
    const html = renderBody(pageWith(state), boardNames(answer), { routes });
    const text = textOf(html);
    expect(text).toContain('On: 15 names served, 27 not served.');
    expect(text).toContain('Not served 27');
    // The copy is drawn with the served names, in a section of its own after his names (8.4): neither "Used in the
    // last 30 days" nor "Other models" is drawn while the switch is on.
    expect(text).toContain(`Your names under a prefix 1`);
    expect(text.indexOf(copy.id)).toBeGreaterThan(text.indexOf('Your names under a prefix'));
    expect(text.indexOf('Your names under a prefix')).toBeLessThan(text.indexOf('Not served 27'));
    expect(text).not.toContain('Other models');
    // Used in the last 30 days (the run's `team/gpt-5.5`): still with the copies, not under "Used".
    const used = textOf(
      renderBody(pageWith(state), boardNames(answer), {
        routes,
        usage: { ...ownerUsage(), [copy.id]: 7 },
      })
    );
    expect(used).toContain(`Your names under a prefix 1`);
    expect(used).not.toContain('Used in the last 30 days');
    expect(used).not.toContain('Other models');
    expect(used).toContain(`${copy.id} 1 account · 7 requests in 30 days`);
    // Off, the same file: every name is counted once, the copy included.
    const off = keptAnswer(['claude-haiku-5-5'], withCopy);
    const offText = textOf(
      renderBody(
        pageWith(withSetting({ enabled: false, keep: ['claude-haiku-5-5'] })),
        boardNames(off),
        { routes }
      )
    );
    expect(offText).toContain('Off: all 42 names are served, 14 of them yours.');
    // A name the routes list that the gateway names nowhere is not guessed to be a copy: with the switch on, it
    // is not his, so it is under Not served.
    const unlisted = keptAnswer(['claude-haiku-5-5'], (raw) => {
      raw.only_my_names = { enabled: true, applies: true, not_applied: null };
    });
    expect(copyKeysOf(unlisted).size).toBe(0);
    expect(textOf(renderBody(pageWith(state), boardNames(unlisted), { routes }))).toContain(
      'Not served 28'
    );
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

describe('after a write: the gateway says when it serves it (applied)', () => {
  const marker = (config_etag: string | null, applying = false, generation = 8) => ({
    generation,
    config_etag,
    applying,
  });

  test('the marker is read from the names and the routes; a gateway without it gives null, and no copies', () => {
    expect(ownerAnswer().applied).toEqual({
      generation: 7,
      config_etag: '"owner-1"',
      applying: false,
    });
    expect(ownerAnswer((raw) => delete raw.applied).applied).toBeNull();
    expect(ownerAnswer((raw) => (raw.applied = { config_etag: '"x"' })).applied).toBeNull();
    const old = ownerAnswer((raw) => {
      for (const own of raw.names as Doc[]) delete own.copies;
    });
    expect(old.names.every((own) => own.copies.length === 0)).toBe(true);
    expect(readModelRoutes({ models: [], applied: marker('"t2"', true) }).applied).toEqual(
      marker('"t2"', true)
    );
    expect(readModelRoutes({ models: [] }).applied).toBeNull();
  });

  test('applied once the marker is the write’s tag and nothing is on its way; late past the limit', () => {
    const pending = { target: '"t2"', late: false };
    expect(applyingOf(marker('"t2"'), null)).toBeNull();
    expect(applyingOf(marker('"t1"'), pending)).toBe('applying');
    // The new config read, its accounts not all registered again yet.
    expect(applyingOf(marker('"t2"', true), pending)).toBe('applying');
    expect(applyingOf(marker('"t2"'), pending)).toBeNull();
    expect(applyingOf(marker('"t1"'), { ...pending, late: true })).toBe('late');
    // A gateway that does not say: nothing to wait for.
    expect(applyingOf(null, pending)).toBeNull();
  });

  /** waitApplied against a scripted gateway and a clock that only moves when the loop sleeps. */
  async function run(
    markers: MarkerRead[],
    cancelAfter?: number,
    current?: () => Promise<string | null>
  ) {
    let now = 0;
    const at: number[] = [];
    let reads = 0;
    const outcome = await waitApplied({
      target: '"t2"',
      read: async () => {
        at.push(now);
        const next = markers[Math.min(reads, markers.length - 1)];
        reads += 1;
        return next;
      },
      sleepUntil: async (ms) => {
        now = ms;
      },
      cancelled: () => cancelAfter !== undefined && reads >= cancelAfter,
      current,
    });
    return { outcome, at, reads };
  }

  test('another writer changed the file after the write: applied once the gateway applies the file as it is now', async () => {
    // The write left "t2"; another writer then left "t3" and the gateway applies "t3", which holds the write.
    let asked = 0;
    const now = async () => {
      asked += 1;
      return '"t3"';
    };
    expect(await run([marker('"t3"')], undefined, now)).toEqual({
      outcome: 'applied',
      at: [0],
      reads: 1,
    });
    expect(asked).toBe(1);
    // Not yet committed (the gateway still applies "t1", the file is at "t2"): it waits, as before.
    const waiting = await run([marker('"t1"'), marker('"t2"')], undefined, async () => '"t2"');
    expect(waiting.outcome).toBe('applied');
    expect(waiting.reads).toBe(2);
    // The file unknown (the read failed, or it is back at the tag the write was conditional on): late, as before.
    expect((await run([marker('"t3"')], undefined, async () => null)).outcome).toBe('late');
  });

  test('reads at once, then soon and more slowly, until the answer reflects the write', async () => {
    const applied = await run([marker('"t1"'), marker('"t2"', true), marker('"t2"')]);
    expect(applied).toEqual({ outcome: 'applied', at: [0, 150, 300], reads: 3 });
    // Failed reads are tried again.
    expect((await run([undefined, marker('"t2"')])).outcome).toBe('applied');
  });

  test('never applied: late at the limit, after about one read a second', async () => {
    const late = await run([marker('"t1"')]);
    expect(late.outcome).toBe('late');
    expect(late.at[late.at.length - 1]).toBe(APPLIED_LIMIT_MS);
    expect(late.reads).toBeLessThanOrEqual(25);
    expect(late.at.slice(0, 4)).toEqual([0, 150, 300, 600]);
  });

  test('a gateway without the marker: one read, and the page falls back to its fixed reads', async () => {
    expect(await run([null])).toEqual({ outcome: 'unsupported', at: [0], reads: 1 });
    // A newer write took over: this wait stops.
    expect((await run([marker('"t1"')], 2)).outcome).toBe('cancelled');
  });

  test('turned on, not applied yet: the switch says so, and no count of the rule before is shown as the new', async () => {
    await i18n.changeLanguage('en');
    // The file says on; the gateway still applies off.
    const page = pageWith(withSetting({ enabled: true, keep: [] }));
    const html = renderPreview(page, ownerAnswer(), 'known', { applying: 'applying', open: false });
    const text = textOf(html);
    expect(text).toContain('Applying…');
    expect(text).toContain(
      'Applying your change. Until the gateway has, it serves the names as before.'
    );
    expect(text).not.toContain('Off: all');
    expect(text).not.toContain('On:');
    // The switch stands where the file puts it, and waits.
    const input = html.match(/<input[^>]*type="checkbox"[^>]*>/)![0];
    expect(input).toContain('checked=""');
    expect(input).toContain('disabled=""');
  });

  test('not applied in time: the switch says plainly the gateway still serves the names as before', async () => {
    await i18n.changeLanguage('en');
    const page = pageWith(withSetting({ enabled: true, keep: [] }));
    const html = renderPreview(page, ownerAnswer(), 'known', { applying: 'late', open: false });
    const text = textOf(html);
    expect(text).toContain(
      "The gateway hasn't applied your change yet, so it still serves the names as before."
    );
    expect(text).not.toContain('Applying…');
    // Not "On": the switch stands where the file puts it, and says it is not applied yet.
    expect(text).toContain('Not applied yet');
    expect(text).not.toMatch(/\bOn\b/);
    expect(text).not.toContain("Show what isn't served");
    // Late, the switch can be used again (to turn it off, for one).
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(html).toMatch(/data-tone="warning"/);
  });

  test('turned off, not applied yet: what is refused is still drawn as not served, as it still is', async () => {
    await i18n.changeLanguage('en');
    const state = withSetting({ enabled: false, keep: [] });
    const answer = ownerAnswer((raw) => {
      raw.only_my_names = { enabled: true, applies: true, not_applied: null };
    });
    const served = answer.names.map((own) => own.name);
    const text = textOf(
      renderBody(pageWith(state), boardNames(answer, undefined, { applying: 'applying' }), {
        routes: routesServing(served),
      })
    );
    expect(text).toContain('Applying your change.');
    expect(text).toContain('Not served 28');
    expect(text).not.toContain('On: 13 names served');
  });

  test('a name kept while on, not applied yet, stays under Not served until the gateway serves it', async () => {
    await i18n.changeLanguage('en');
    const state = withSetting({ enabled: true, keep: ['gpt-6.1-codex'] });
    const before = ownerAnswer((raw) => {
      raw.only_my_names = { enabled: true, applies: true, not_applied: null };
    });
    const served = before.names.map((own) => own.name);
    const pendingText = textOf(
      renderBody(pageWith(state), boardNames(before, undefined, { applying: 'applying' }), {
        routes: routesServing(served),
      })
    );
    expect(pendingText).toContain('Your names 13');
    expect(pendingText).toContain('Not served 28');
    const after = keptAnswer(['gpt-6.1-codex'], (raw) => {
      raw.only_my_names = { enabled: true, applies: true, not_applied: null };
    });
    const appliedText = textOf(
      renderBody(pageWith(state), boardNames(after), {
        routes: routesServing([...served, 'gpt-6.1-codex']),
      })
    );
    expect(appliedText).toContain('Your names 14');
    expect(appliedText).toContain('Not served 27');
    expect(appliedText).toContain('On: 14 names served, 27 not served.');
  });
});

describe('usage by the name tools sent (requested_models)', () => {
  /** The owner's 30 days, with names as the clients sent them from `from`. */
  const usageWith = (
    requested: Doc | null,
    before?: ProvimuxModelUsage['before'],
    beforeFailed?: boolean
  ): ProvimuxModelUsage => {
    const raw = structuredClone(ownerFixture('usage')) as Doc;
    if (requested) raw.requested_models = requested;
    const answer: ProvimuxModelUsage = readSavings(raw);
    if (before !== undefined) answer.before = before;
    if (beforeFailed) answer.before_failed = true;
    return answer;
  };
  const sent = [
    { model: 'opus', requests: 1500, failures: 0, tokens: 1 },
    { model: 'team-a/opus', requests: 40, failures: 0, tokens: 1 },
    { model: 'gpt-6.1-codex', requests: 9, failures: 0, tokens: 1 },
  ];

  test('the whole range covered: an alias counts under the alias, a prefixed name with its prefix, nothing else', () => {
    const usage = usageWith({ from: '2026-10-26', models: sent, truncated: false });
    expect(usageByName(usage)).toEqual({ opus: 1500, 'team-a/opus': 40, 'gpt-6.1-codex': 9 });
    expect(usageStateOf(usage, false)).toBe('known');
    expect(usageSinceOf(usage)).toBeNull();
    // The preview's used names follow: claude-haiku-5-5 ran 90 times, but under an alias, so no tool sent it.
    const answer = ownerAnswer();
    const preview = previewOf(
      othersOf(
        answer,
        yourNameKeys(answer, readSetting(ownerState().document)),
        usageByName(usage)
      ),
      13
    );
    expect(preview.used.map((item) => [item.name, item.requests])).toEqual([['gpt-6.1-codex', 9]]);
  });

  test('a name’s card counts the requests sent under that name', async () => {
    await i18n.changeLanguage('en');
    const usage = usageByName(usageWith({ from: '2026-10-26', models: sent, truncated: false }));
    const opus = nameOf(ownerNames(undefined, undefined, usage), 'opus');
    expect(opus.requests).toBe(1500);
    expect(textOf(renderCard(opus, startDraft(ownerState())))).toContain(
      '1500 requests in 30 days'
    );
  });

  test('names counted since a day inside the range: the days before count by model, and one line says so', async () => {
    await i18n.changeLanguage('en');
    const beforeRows = readSavings(ownerFixture('usage')).breakdowns[0];
    const usage = usageWith({ from: '2026-11-20', models: sent, truncated: false }, beforeRows);
    expect(usageSinceOf(usage)).toBe('2026-11-20');
    const map = usageByName(usage)!;
    // gpt-6.1-codex: 9 sent since the 20th, and 75 by model before it.
    expect(map['gpt-6.1-codex']).toBe(84);
    expect(map['team-a/opus']).toBe(40);
    expect(usageStateOf(usage, false)).toBe('known');
    const text = textOf(
      renderPreview(pageWith(ownerState()), ownerAnswer(), 'known', {
        usageSince: '2026-11-20',
        usageMap: map,
      })
    );
    expect(text).toContain(
      'Names are counted as your tools sent them since Nov 20; before that, under the model that answered.'
    );
    // The days before, when they could not be read: the order by use is not complete.
    expect(
      usageStateOf(
        usageWith({ from: '2026-11-20', models: sent, truncated: false }, null, true),
        false
      )
    ).toBe('partial');
  });

  test('names folded into ~other, or left out: the preview says its order by use is not complete', async () => {
    await i18n.changeLanguage('en');
    const folded = usageWith({
      from: '2026-10-26',
      models: [...sent, { model: '~other', requests: 3, failures: 0, tokens: 0 }],
      truncated: false,
    });
    expect(usageStateOf(folded, false)).toBe('partial');
    expect(usageByName(folded)).not.toHaveProperty('~other');
    expect(
      usageStateOf(usageWith({ from: '2026-10-26', models: sent, truncated: true }), false)
    ).toBe('partial');
    const text = textOf(
      renderPreview(pageWith(ownerState()), ownerAnswer(), 'known', { usage: 'partial' })
    );
    expect(text).toContain('so the order by use is not complete');
  });

  test('a gateway without it, or without names in the range: the rows by model, as before', () => {
    const rows = usageByName(readSavings(ownerFixture('usage')));
    expect(usageByName(usageWith(null))).toEqual(rows);
    expect(usageByName(usageWith({ from: null, models: [], truncated: false }))).toEqual(rows);
    expect(usageSinceOf(usageWith(null))).toBeNull();
  });

  test('the page asks for the names; for the days before them, by model', async () => {
    const asked: string[] = [];
    const answers = (requested: Doc | null, failBefore = false) => ({
      get: async (path: string) => {
        asked.push(path);
        if (path.includes('from=')) {
          if (failBefore) throw Object.assign(new Error('boom'), { status: 500 });
          return ownerFixture('usage');
        }
        const raw = structuredClone(ownerFixture('usage')) as Doc;
        if (requested) raw.requested_models = requested;
        return raw;
      },
      post: async () => undefined,
      put: async () => undefined,
    });
    type Client = Parameters<typeof provimuxApi.modelUsage>[0];
    const whole = await provimuxApi.modelUsage(
      answers({ from: '2026-10-26', models: sent, truncated: false }) as unknown as Client
    );
    expect(asked).toEqual(['/provimux/savings?period=30d&group=model&include=requested_models']);
    expect(whole.before).toBeUndefined();
    asked.length = 0;
    const part = await provimuxApi.modelUsage(
      answers({ from: '2026-11-20', models: sent, truncated: false }) as unknown as Client
    );
    expect(asked[1]).toBe('/provimux/savings?from=2026-10-26&to=2026-11-19&group=model');
    expect(part.before?.rows.length).toBeGreaterThan(0);
    const failed = await provimuxApi.modelUsage(
      answers({ from: '2026-11-20', models: sent, truncated: false }, true) as unknown as Client
    );
    expect([failed.before, failed.before_failed]).toEqual([null, true]);
    // A gateway without the field asks once.
    asked.length = 0;
    await provimuxApi.modelUsage(answers(null) as unknown as Client);
    expect(asked).toHaveLength(1);
    expect([dayBefore('2026-03-01'), dayBefore('2026-01-01')]).toEqual([
      '2026-02-28',
      '2025-12-31',
    ]);
  });
});

describe('after a save: the panel stays while the page reads again', () => {
  test('the draft it had is drawn, locked, until the read answers; never the skeleton', async () => {
    await i18n.changeLanguage('en');
    const shown = pageWith(ownerState());
    const sent = shown.draft!;
    // A save drops the draft (it carries nothing); the read after it is under way.
    const saving = pageStep(shown, { type: 'save-started' });
    const saved = pageStep(saving, {
      type: 'save-answered',
      outcome: { confirmed: [], unconfirmed: [], failure: null },
    });
    const reading = pageStep(saved, { type: 'read-started' });
    expect(reading.draft).toBeNull();
    expect(reading.reading).toBe(true);
    const held = renderBody(reading, boardNames(ownerAnswer()), { held: sent });
    expect(held).not.toContain('aria-busy="true" aria-label="Loading');
    expect(textOf(held)).toContain('Your names 13');
    expect(textOf(held)).toContain('Reading');
    // Locked while it reads: nothing can be edited.
    expect(held).toMatch(/<fieldset[^>]*disabled/);
    // Without a draft held (the page's first read), the skeleton as before; and once the read failed, its error.
    expect(renderBody(reading, boardNames(ownerAnswer()))).toContain('aria-busy="true"');
    const failed = pageStep(reading, { type: 'read-failed', message: 'down' });
    expect(textOf(renderBody(failed, boardNames(ownerAnswer()), { held: sent }))).not.toContain(
      'Your names 13'
    );
  });
});

describe('the refused strip', () => {
  test('most refused first, then by name; the name is the one the gateway resolved', async () => {
    await i18n.changeLanguage('en');
    const answer = ownerAnswer((raw) => {
      raw.only_my_names = { enabled: true, applies: true, not_applied: null };
      raw.refused = {
        since: '2026-11-24T13:00:00Z',
        names: [
          { name: 'gpt-6.2-sol', requests: 2, last_at: '2026-11-24T13:59:00Z' },
          { name: 'grok-tts', requests: 7, last_at: '2026-11-24T13:58:00Z' },
          { name: 'gemini-3-flash', requests: 2, last_at: '2026-11-24T13:57:00Z' },
        ],
        truncated: false,
      };
    });
    const yours = yourNameKeys(answer, readSetting(ownerState().document));
    const refused = refusedOf(answer, yours);
    expect(refused.map((r) => [r.name, r.requests])).toEqual([
      ['grok-tts', 7],
      ['gemini-3-flash', 2],
      ['gpt-6.2-sol', 2],
    ]);
    const text = textOf(
      renderToStaticMarkup(
        createElement(RefusedStrip, {
          state: {
            answer,
            setting: readSetting(ownerState().document),
            yours,
            others: othersOf(answer, yours, null),
            alsoServed: 0,
            usage: 'known',
            blocked: null,
            busy: false,
            writing: null,
            write: async () => true,
            nowMs: OWNER_NOW,
          },
          refused,
        })
      )
    );
    expect(text.indexOf('grok-tts')).toBeLessThan(text.indexOf('gemini-3-flash'));
    // No string promises the name was the one the tool sent.
    expect(text).not.toMatch(/sent|your tool asked for/i);
  });

  // The gateway's check reads no registration (only-my-names.md 18.2): a typo is refused and counted like any name.
  const stripOf = (names: Array<{ name: string; requests: number }>) => {
    const answer = ownerAnswer((raw) => {
      raw.only_my_names = { enabled: true, applies: true, not_applied: null };
      raw.refused = {
        since: '2026-11-24T13:00:00Z',
        names: names.map((n) => ({ ...n, last_at: '2026-11-24T13:59:00Z' })),
        truncated: false,
      };
    });
    const setting = readSetting(ownerState().document);
    const yours = yourNameKeys(answer, setting);
    const html = renderToStaticMarkup(
      createElement(RefusedStrip, {
        state: {
          answer,
          setting,
          yours,
          others: othersOf(answer, yours, null),
          alsoServed: 0,
          usage: 'known',
          blocked: null,
          busy: false,
          writing: null,
          write: async () => true,
          nowMs: OWNER_NOW,
        },
        refused: refusedOf(answer, yours),
      })
    );
    return html;
  };
  const rowOf = (html: string, name: string) =>
    textOf(html.split('<li').find((li) => li.includes(`>${name}</code>`)) ?? '');

  test('a name no account offers in any case says so and has no Keep', async () => {
    await i18n.changeLanguage('en');
    const html = stripOf([
      { name: 'gemni-3-flsh', requests: 3 },
      { name: 'gemini-3-flash', requests: 1 },
    ]);
    const typo = rowOf(html, 'gemni-3-flsh');
    expect(typo).toContain(
      'No account offers this name, in any case: keeping it would serve nothing.'
    );
    expect(typo).not.toContain('Keep');
    expect(html).not.toContain('aria-label="Keep gemni-3-flsh');
    // An offered name keeps its Keep.
    expect(rowOf(html, 'gemini-3-flash')).toContain('Keep');
  });

  test('a spelling an account offers only in another case keeps its Keep and says what it reaches', async () => {
    await i18n.changeLanguage('en');
    const row = rowOf(stripOf([{ name: 'Gemini-3-Flash', requests: 2 }]), 'Gemini-3-Flash');
    expect(row).toContain('Reaches gemini-3-flash, the same name in another case');
    expect(row).toContain('Keep');
  });

  test('every language has both lines', async () => {
    for (const lang of ['en', 'ko', 'ru', 'tr', 'vi', 'zh-CN', 'zh-TW']) {
      await i18n.changeLanguage(lang);
      for (const key of ['provimux.names.who_unoffered', 'provimux.names.who_reaches']) {
        expect(i18n.exists(key, { lng: lang, fallbackLng: [] })).toBe(true);
      }
    }
    await i18n.changeLanguage('en');
  });
});

describe('used names in the case they were sent (only-my-names.md 18.5)', () => {
  test('a sent spelling no account registers but one offers in another case is used, not served once on, and kept exactly', () => {
    const answer = ownerAnswer();
    const setting = readSetting(ownerState().document);
    const yours = yourNameKeys(answer, setting);
    // Gemini-3-Flash reaches gemini-3-flash through upstream's lower-case lookup; gemni-3-flsh reaches nothing.
    const usage = { 'Gemini-3-Flash': 4, 'gemni-3-flsh': 2, 'gemini-3-flash': 1 };
    const others = othersOf(answer, yours, usage);
    const sent = others.find((o) => o.name === 'Gemini-3-Flash');
    expect(sent).toBeDefined();
    expect(sent?.reaches).toBe('gemini-3-flash');
    expect(sent?.accounts).toEqual(others.find((o) => o.name === 'gemini-3-flash')?.accounts ?? []);
    expect(others.map((o) => o.name)).not.toContain('gemni-3-flsh');
    const preview = previewOf(others, 0);
    expect(preview.used.map((o) => o.name).slice(0, 2)).toEqual([
      'Gemini-3-Flash',
      'gemini-3-flash',
    ]);
    // Keep all used writes the spelling as sent.
    const body = keepBody(
      setting,
      preview.used.map((o) => o.name)
    );
    expect(body.keep as string[]).toContain('Gemini-3-Flash');
    expect(body.keep as string[]).not.toContain('gemni-3-flsh');
  });

  test('a sent spelling that is his, or a registered one, adds no row', () => {
    const answer = ownerAnswer();
    const setting = readSetting(ownerState().document);
    const yours = yourNameKeys(answer, setting);
    const mine = [...yours][0];
    const base = othersOf(answer, yours, {}).length;
    expect(othersOf(answer, yours, { [mine]: 3, 'gemini-3-flash': 2 }).length).toBe(base);
    expect(othersOf(answer, yours, { auto: 5 }).length).toBe(base);
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
  usage: 'known' | 'unknown' = 'known',
  extra: Partial<NamesState> & { open?: boolean; usageMap?: Record<string, number> } = {}
) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(PreviewHarness, { page, answer, usage, extra }))
  );
}

function PreviewHarness({
  page,
  answer,
  usage,
  extra,
}: {
  page: PageState;
  answer: ProvimuxNamesResponse;
  usage: 'known' | 'unknown';
  extra: Partial<NamesState> & { open?: boolean; usageMap?: Record<string, number> };
}) {
  const draft = page.draft!;
  const setting = readSetting(draft.base.document);
  const yours = yourNameKeys(answer, setting);
  const { open = true, usageMap, ...state } = extra;
  const others = othersOf(answer, yours, usage === 'known' ? (usageMap ?? ownerUsage()) : null);
  const yourNames = yourNamesOf(answer, setNamesOf(answer, setting), yours);
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
      alsoServed: 0,
      ...state,
    },
    yourNames,
    previewOpen: open,
    onPreview: noop,
    onShowNotServed: noop,
  });
}

// --- only-my-names.md section 17: names his only if the config says so, compared exactly ---------------------------

describe('exact names, as the gateway compares them (only-my-names.md 17)', () => {
  /** The gateway's shared fixture and example (pui13/examples), copied as they are. */
  const gatewayFixture = () => {
    const config = parseYaml(
      readFileSync('tests/provimux/fixtures/models/gateway-names-fixture.yaml', 'utf8')
    ) as Doc;
    // The fixture writes the login aliases under the legacy key; the config API gives the v8 layout, where they
    // are oauth.model-alias (the gateway's config_v8.go maps one to the other).
    const { 'oauth-model-alias': loginAliases, ...rest } = config;
    return { ...rest, oauth: { 'model-alias': loginAliases } } as Doc;
  };
  const gatewayExample = () =>
    readNames(
      JSON.parse(readFileSync('tests/provimux/fixtures/models/gateway-names.json', 'utf8'))
    );

  test('the gateway’s shared fixture: Your names are exactly the names it lists, GPT-5.5 and gpt-5.5 apart', () => {
    const config = gatewayFixture();
    const state = { ...readAliasState(config, []), etag: '"f"' };
    const setting = readSetting(config);
    // "claude-*", "" and "auto" are ignored; the rest trimmed, in their case.
    expect(setting.keep).toEqual(['claude-opus-5-5', 'devin/claude-opus-4.6', 'GPT-5.5']);
    const items = buildNames({
      draft: startDraft(state),
      routes: null,
      lists: null,
      usage: null,
      nowMs: 0,
      setNames: setNamesOf(null, setting, 'config'),
    });
    const yours = sections(items)
      .yours.map((item) => item.name)
      .sort();
    // The fixture's own comment: alias names, then kept names; two spellings of gpt-5.5.
    expect(yours).toEqual(
      [
        'Fast',
        'gpt-5.5',
        'my-opus',
        'team-sonnet',
        'vertex-flash',
        'work-fast',
        'claude-opus-5-5',
        'devin/claude-opus-4.6',
        'GPT-5.5',
      ].sort()
    );
    const upper = nameOf(items, 'GPT-5.5');
    const lower = nameOf(items, 'gpt-5.5');
    expect([upper.kept, upper.aliased]).toEqual([true, false]);
    expect([lower.kept, lower.aliased]).toEqual([false, true]);
  });

  test('the gateway’s example answer: kept names, copies, and a spelling with a thinking level', () => {
    const answer = gatewayExample();
    const setting = readSetting({ models: { 'only-my-names': { enabled: true, keep: [] } } });
    expect([...setNamesOf(answer, setting).kept].sort()).toEqual(['claude-opus-5-5', 'work-fast']);
    // set_by login-file is no longer given: nothing is a login-file name.
    expect(setNamesOf(answer, setting).loginFile.size).toBe(0);
    expect([...copyKeysOf(answer)].sort()).toEqual(['opus(high)', 'team-a/opus']);
    expect([...levelCopiesOf(answer)]).toEqual([['opus(high)', 'opus']]);
    // A spelling with a thinking level is not a name: only the prefixed copy is counted as served.
    expect(servedCopiesOf(answer)).toBe(1);
    expect(thinkingBase('opus(high)')).toBe('opus');
    expect(thinkingBase('team-a/opus(high)')).toBe('team-a/opus');
    expect(thinkingBase('opus')).toBe('opus');
  });

  /** The owner's answer with GPT-6.1-CODEX kept: an account offers gpt-6.1-codex, which stays another's. */
  const caseAnswer = (enabled: boolean) =>
    ownerAnswer((raw) => {
      raw.only_my_names = { enabled, applies: true, not_applied: null };
      (raw.names as Doc[]).push({
        name: 'GPT-6.1-CODEX',
        set_by: ['keep'],
        accounts: 0,
        copies: [],
      });
      raw.refused = enabled
        ? {
            since: '2026-11-24T13:00:00Z',
            names: [{ name: 'gpt-6.1-codex', requests: 3, last_at: '2026-11-24T13:58:00Z' }],
            truncated: false,
          }
        : null;
    });

  test('a name kept in one case while an account offers another: the page never shows the other as his', async () => {
    await i18n.changeLanguage('en');
    const state = withSetting({ enabled: true, keep: ['GPT-6.1-CODEX'] });
    const setting = readSetting(state.document);
    const answer = caseAnswer(true);
    const yours = yourNameKeys(answer, setting);
    expect(yours.has('GPT-6.1-CODEX')).toBe(true);
    expect(yours.has('gpt-6.1-codex')).toBe(false);
    expect(othersOf(answer, yours, null).map((o) => o.name)).toContain('gpt-6.1-codex');
    // Refused as sent: the strip keeps it, with Keep, which writes that spelling.
    expect(refusedOf(answer, yours).map((r) => r.name)).toEqual(['gpt-6.1-codex']);
    expect(keepBody(setting, ['gpt-6.1-codex']).keep).toEqual(['GPT-6.1-CODEX', 'gpt-6.1-codex']);
    // Two cards: the kept spelling (no account offers it), the offered one not his.
    const items = ownerNamesWith(startDraft(state), setNamesOf(answer, setting));
    expect(nameOf(items, 'GPT-6.1-CODEX')).toMatchObject({ own: true, kept: true, accounts: 0 });
    expect(nameOf(items, 'gpt-6.1-codex').own).toBe(false);
    const served = answer.names.map((own) => own.name);
    const text = textOf(
      renderBody(pageWith(state), boardNames(answer), { routes: routesServing(served) })
    );
    // His 14, the offered spelling among the 28 not served, and in the refused strip.
    expect(text).toContain('On: 14 names served, 28 not served.');
    expect(text).toContain('Your names 14');
    expect(text).toContain("A tool asked for 1 name that isn't served");
    expect(text).toContain('gpt-6.1-codex 3 times');
  });

  test('auto on keep is ignored, and the switch says why in plain words', async () => {
    await i18n.changeLanguage('en');
    const state = withSetting({ enabled: false, keep: ['auto', 'claude-*', 'opus'] });
    expect(readSetting(state.document).keep).toEqual(['opus']);
    const answer = ownerAnswer((raw) => {
      raw.keep_ignored = [
        { value: 'auto', reason: 'reserved' },
        { value: 'claude-*', reason: 'pattern' },
      ];
    });
    expect(answer.keep_ignored.map((entry) => entry.reason)).toEqual(['reserved', 'pattern']);
    const text = textOf(renderBody(pageWith(state), boardNames(answer)));
    expect(text).toContain('Provimux ignores 2 entries of your kept names: auto, claude-*.');
    expect(text).toContain(
      "auto isn't a name: tools send it to mean any model an account offers, so it can't be kept."
    );
    expect(text).toContain('Remove them');
    // Remove them takes both out, as written.
    expect(dropIgnoredBody(readSetting(state.document), ['auto', 'claude-*']).keep).toEqual([
      'opus',
    ]);
    // No card says auto is kept.
    expect(text).not.toMatch(/auto\s+Kept/);
  });

  test('a spelling with a thinking level is shown on its name’s card and never counted as a name', async () => {
    await i18n.changeLanguage('en');
    const state = withSetting({ enabled: true, keep: ['claude-haiku-5-5'] });
    const routes = routesServing([
      ...ownerAnswer().names.map((own) => own.name),
      'claude-haiku-5-5',
    ]);
    const base = routes.models[0].id;
    const level = { ...structuredClone(routes.models[0]), id: `${base}(high)` };
    routes.models.push(level);
    const withLevel = (raw: Doc) => {
      const own = (raw.names as Doc[]).find((name) => name.name === base)!;
      own.copies = [{ id: level.id, accounts: 1 }];
    };
    const answer = keptAnswer(['claude-haiku-5-5'], (raw) => {
      raw.only_my_names = { enabled: true, applies: true, not_applied: null };
      withLevel(raw);
    });
    const text = textOf(renderBody(pageWith(state), boardNames(answer), { routes }));
    // As many as without it (the "on" case above): not a name served, not a copy section of its own.
    expect(text).toContain('On: 14 names served, 27 not served.');
    expect(text).toContain('Your names 14');
    expect(text).not.toContain('Your names under a prefix');
    expect(text).toContain(
      `Also served as ${level.id}: an account offers ${base} with a thinking level`
    );
    // Off, the same: every name counted once.
    const off = keptAnswer(['claude-haiku-5-5'], withLevel);
    expect(
      textOf(
        renderBody(
          pageWith(withSetting({ enabled: false, keep: ['claude-haiku-5-5'] })),
          boardNames(off),
          { routes }
        )
      )
    ).toContain('Off: all 41 names are served, 14 of them yours.');
  });

  test('a save that only changes a name’s case stops serving the old spelling while on', () => {
    const page = pageWith(withSetting({ enabled: true, keep: [] }));
    let draft = page.draft!;
    for (const row of draft.rows.filter((r) => r.alias === 'haiku')) {
      draft = changeRow(draft, row.id, { alias: 'Haiku' });
    }
    const setNames = setNamesOf(ownerAnswer(), readSetting(draft.base.document), 'config');
    expect(droppedBySave(draft, setNames)).toEqual(['haiku']);
  });
});

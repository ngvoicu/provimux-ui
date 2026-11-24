// The Models page (design models-page.md): one list of every name a client can send, with its routes in the
// order they are tried, built from the configuration's draft and Provimux's endpoints; the edits it makes, all
// through the Aliases data layer; its redirects, its menu item and its settings cards.
import { afterAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, matchRoutes } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { readModelLists } from '@/provimux/api/normalize';
import { buildNames } from '@/provimux/pages/models/catalog';
import { startDraft } from '@/provimux/pages/aliases/draft';
import {
  INITIAL_PAGE,
  changeCount,
  pageStep,
  type PageState,
} from '@/provimux/pages/aliases/pageLogic';
import { planCommit, planWrites } from '@/provimux/pages/aliases/plan';
import { setKeyPriority, storedPriority } from '@/provimux/pages/aliases/priority';
import { familyGroups, readAliasState } from '@/provimux/pages/aliases/rows';
import type { AliasState, KeyEntry } from '@/provimux/pages/aliases/types';
import {
  EMPTY_MODELS_FILTER,
  addToName,
  candidatesFor,
  initialModelsFilter,
  learnedByLogin,
  listlessKeys,
  loginsWithLearned,
  matches,
  removable,
  removeName,
  renameName,
  sections,
  summarizeNames,
  type Candidate,
  type ModelsFilter,
} from '@/provimux/pages/models/catalog';
import { ModelsBody } from '@/provimux/pages/models/ModelsBody';
import { ModelsPage } from '@/provimux/pages/models/ModelsPage';
import { modelsAddressFor } from '@/provimux/pages/models/address';
import { ModelsRedirect } from '@/provimux/pages/models/ModelsRedirect';
import { ModelsSettings } from '@/provimux/pages/models/ModelsSettings';
import type { DevinCooling } from '@/provimux/pages/modelRoutes/useDevinCooling';
import { PROVIMUX_PAGES } from '@/provimux/nav';
import { PROVIMUX_ROUTES } from '@/provimux/routes';
import { buildModelRulesPath } from '@/features/authFiles/modelRules/useModelRulesRoute';
import {
  OWNER_NOW,
  nameOf,
  ownerFixture,
  ownerLists,
  ownerNames,
  ownerRoutes,
  ownerState,
  renderCard,
  textOf,
} from './support/models';

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

const keys = (items: { key: string }[]) => items.map((item) => item.key);
const candidate = (draft: ReturnType<typeof startDraft>, target: string, key: string): Candidate =>
  candidatesFor(draft, ownerRoutes(), target).find((c) => c.key === key)!;

describe('the list', () => {
  test('every name the proxy serves: his names first, then the ones used in 30 days, then the rest', () => {
    const items = ownerNames();
    const parts = sections(items);
    expect(items).toHaveLength(41);
    // His names: the aliases of the configuration, most used first, then by name.
    expect(keys(parts.yours)).toEqual([
      'opus',
      'claude-opus-5-5',
      'terra',
      'sonnet',
      'haiku',
      'swe',
      'deepseek',
      'codex',
      'glm',
      'gpt-6.1-terra',
      'grok',
      'kimi',
      'qwen-coder',
    ]);
    // Then the models used under their own names, most used first.
    expect(keys(parts.used)).toEqual([
      'claude-haiku-5-5',
      'gpt-6.1-codex',
      'gemini-3-flash',
      'gpt-6.2-sol',
      'swe-2-flash',
    ]);
    expect(parts.rest).toHaveLength(23);
    expect(summarizeNames(items)).toMatchObject({ names: 41, yours: 13, cooling: 2, problems: 1 });
    expect(nameOf(items, 'opus').requests).toBe(1840);
  });

  test('a pool: its routes in the order they are tried, what each sends, its priority and cooldown', () => {
    const opus = nameOf(ownerNames(), 'claude-opus-5-5');
    expect(
      opus.lines.map((l) => [l.rank, l.sharesRank, l.access, l.provider, l.upstream, l.priority])
    ).toEqual([
      [1, false, 'sub', 'claude', 'claude-opus-5-5', 10],
      [2, false, 'sub', 'devin', 'devin/claude-opus-5-5', 5],
      [3, true, 'api', 'claude', 'claude-opus-5-5', 0],
      [3, true, 'api', 'openai-compatible-openrouter', 'anthropic/claude-opus-5.5', 0],
    ]);
    // The Claude login serves it as a built-in model: no row of the configuration is behind it.
    expect(opus.lines.map((l) => l.rowId)).toEqual([
      null,
      'login/devin#0',
      'claude/0/0#0',
      'openai-compatibility/0/g#0',
    ]);
    expect(opus.lines[1].cooldown).toMatchObject({ reason: 'quota', http_status: 429 });
    expect(opus.lines.map((l) => l.list?.source ?? null)).toEqual(['live', 'live', null, null]);
    expect(opus).toMatchObject({ own: true, active: 4, problems: [], edited: false });
  });

  test('a row Provimux ignores is a problem, in one plain sentence', async () => {
    await i18n.changeLanguage('en');
    const draft = startDraft(ownerState());
    const sonnet = nameOf(ownerNames(draft), 'sonnet');
    expect(sonnet.problems).toEqual(['ignored']);
    expect(sonnet.active).toBe(1);
    const ignored = sonnet.lines.find((line) => line.issue === 'duplicate')!;
    expect(ignored).toMatchObject({ upstream: 'claude-sonnet-4-5', rank: null, state: 'idle' });
    const text = textOf(renderCard(sonnet, draft));
    expect(text).toContain('Needs a look');
    expect(text).toContain(
      'Provimux ignores this route: your Claude subscription already uses this name for another model.'
    );
  });

  test('without Provimux’s endpoints: the configuration’s names only, and no order that is not known', () => {
    const items = ownerNames(startDraft(ownerState()), null, null);
    // A login's built-in models are not in the configuration: only names a row gives are listed.
    expect(items.some((item) => item.key === 'claude-haiku-5-5')).toBe(false);
    const opus = nameOf(items, 'claude-opus-5-5');
    // The Devin login's priority is in its file, which the page does not read: no order for the name.
    expect(opus.lines.map((l) => [l.provider, l.rank, l.priority])).toEqual([
      ['claude', null, 0],
      ['openai-compatible-openrouter', null, 0],
      ['devin', null, null],
    ]);
    // A name only API keys serve: their priorities are in the configuration, so its order is known.
    expect(nameOf(items, 'deepseek').lines[0]).toMatchObject({ rank: 1, priority: 0 });
    expect(nameOf(items, 'opus').requests).toBeNull();
  });
});

describe('a model only the login’s own list has (owner: “wtf is this”)', () => {
  const learned = () => learnedByLogin([readModelLists(ownerFixture('model-lists-codex'))]);

  test('the logins to ask, and what they answer', () => {
    expect(loginsWithLearned(ownerLists()).map((login) => login.authIndex)).toEqual(['li-codex-1']);
    expect(learned()).toEqual({ 'li-codex-1': ['gpt-6.2-sol'] });
  });

  test('its route says so in plain words, with one line on why', async () => {
    await i18n.changeLanguage('en');
    const draft = startDraft(ownerState());
    const items = buildNames({
      draft,
      routes: ownerRoutes(),
      lists: ownerLists(),
      usage: null,
      nowMs: OWNER_NOW,
      learned: learned(),
    });
    expect(nameOf(items, 'gpt-6.2-sol').lines[0].estimated).toBe(true);
    expect(nameOf(items, 'terra').lines[0].estimated).toBe(false);
    const html = renderCard(nameOf(items, 'gpt-6.2-sol'), draft);
    expect(textOf(html)).toContain('new: limits estimated');
    expect(html).toContain(
      'title="Codex&#x27;s own list offers this model, but Provimux&#x27;s built-in list doesn&#x27;t have it yet, so its context, output and reasoning limits come from Codex&#x27;s list or from defaults."'
    );
    expect(textOf(html)).not.toMatch(/catalog/i);
  });
});

describe('editing', () => {
  test('a new name: shown at once with the order its routes will be tried in, then saved in one action', () => {
    let draft = startDraft(ownerState());
    draft = addToName(draft, candidate(draft, 'fast', 'login/codex\ngpt-6.1-codex-mini'), 'fast');
    draft = addToName(draft, candidate(draft, 'fast', 'claude/0/0\nclaude-haiku-5-5'), 'fast');
    const fast = nameOf(ownerNames(draft), 'fast');
    expect(fast).toMatchObject({ own: true, fresh: true, edited: true, active: 2 });
    expect(fast.lines.map((l) => [l.state, l.rank, l.provider, l.upstream])).toEqual([
      ['new', 1, 'codex', 'gpt-6.1-codex-mini'],
      ['new', 2, 'claude', 'claude-haiku-5-5'],
    ]);
    expect(sections(ownerNames(draft)).yours[0].key).toBe('fast');
    // The same writes as the Aliases page: the family and the login map, nothing else.
    expect(planWrites(draft).map((w) => w.path)).toEqual([
      '/config/api-keys/claude',
      '/config/oauth/model-alias',
    ]);
    const map = planWrites(draft)[1].body as Record<string, unknown[]>;
    expect(map.codex.at(-1)).toEqual({ name: 'gpt-6.1-codex-mini', alias: 'fast', fork: true });
    const claude = planWrites(draft)[0].body as Array<{ keys: Array<{ models: unknown[] }> }>;
    expect(claude[0].keys[0].models.at(-1)).toEqual({ name: 'claude-haiku-5-5', alias: 'fast' });
  });

  test('removing a name: its routes stay, marked, until the save; a key keeps the model under its own name', () => {
    const draft = removeName(startDraft(ownerState()), 'grok');
    const items = ownerNames(draft);
    const grok = nameOf(items, 'grok');
    expect(grok.lines.map((l) => l.state)).toEqual(['removed']);
    expect(grok.active).toBe(0);
    expect(draft.rows.find((r) => r.id === 'openai-compatibility/0/g#6')?.alias).toBeNull();
    expect(nameOf(items, 'x-ai/grok-5').lines[0].state).toBe('new');
    expect(planCommit(draft).map((u) => u.store)).toEqual(['api-key']);
  });

  test('renaming moves the alias rows; routes under the model’s own name keep the old name', () => {
    const draft = renameName(startDraft(ownerState()), 'claude-opus-5-5', 'opus55');
    const items = ownerNames(draft);
    expect(nameOf(items, 'opus55').lines.map((l) => [l.provider, l.state])).toEqual([
      ['devin', 'new'],
      ['openai-compatible-openrouter', 'new'],
    ]);
    expect(nameOf(items, 'claude-opus-5-5').lines.map((l) => [l.provider, l.state])).toEqual([
      ['claude', 'live'],
      ['claude', 'live'],
      ['devin', 'removed'],
      ['openai-compatible-openrouter', 'removed'],
    ]);
  });

  test('what can go under a name, and why not when it cannot', () => {
    const draft = startDraft(ownerState());
    const offered = (target: string) =>
      Object.fromEntries(
        candidatesFor(draft, ownerRoutes(), target).map((c) => [c.key, c.blocked])
      );
    const opus = offered('opus');
    // The Claude login type already answers "opus" with claude-opus-5-5: a second row would be ignored.
    expect(opus['login/claude\nclaude-opus-4-5']).toBe('taken');
    expect(opus['login/claude\nclaude-opus-5-5']).toBe('in-name');
    expect(opus['login/devin\ndevin/claude-opus-5-5']).toBeNull();
    expect(opus['claude/0/0\nclaude-opus-5-5']).toBeNull();
    // A login offers its models, not its aliases.
    expect(Object.keys(opus)).not.toContain('login/claude\nopus');
    expect(offered('claude-opus-5-5')['login/claude\nclaude-opus-5-5']).toBe('own-name');
    // An OpenAI-compatible entry pools several models under one name: allowed.
    const kimi = offered('kimi');
    expect(kimi['openai-compatibility/0/g\ndeepseek/deepseek-v4']).toBeNull();
    expect(kimi['openai-compatibility/0/g\nmoonshotai/kimi-k3']).toBe('in-name');
    // A key without a model list offers nothing; the picker names it instead.
    expect(Object.keys(opus).some((key) => key.startsWith('gemini/'))).toBe(false);
    expect(listlessKeys(draft).map((entry) => entry.id)).toEqual(['gemini/0/0']);
  });

  test('a key’s model under its own name is not taken out here: that is its list, on AI Providers', () => {
    const draft = startDraft(ownerState());
    const opus = nameOf(ownerNames(draft), 'claude-opus-5-5');
    expect(opus.lines.map((line) => removable(draft, line))).toEqual([false, true, false, true]);
  });
});

describe('API keys’ priority (stored in api-keys.<family>, which the page already writes)', () => {
  const withPriorities = (): AliasState => {
    const document = ownerFixture('config') as {
      'api-keys': Record<string, Array<Record<string, unknown>>>;
    };
    const claude = document['api-keys'].claude[0];
    claude.priority = 7;
    claude.models = [{ name: 'claude-opus-5-5' }];
    // The key inherits the group's list and its priority (null inherits).
    const key = (claude.keys as Array<Record<string, unknown>>)[0];
    delete key.models;
    key.priority = null;
    document['api-keys'].gemini[0].keys = [
      { 'api-key': 'fixture-key-gemini-1', auth_index: 'ak-gemini-1', priority: 3 },
    ];
    return { ...readAliasState(document, []), etag: '"p1"' };
  };
  const entry = (state: AliasState, id: string) =>
    state.entries.find((e) => e.id === id) as KeyEntry;

  test('read as the proxy reads it: the key’s own, else its group’s, else 0', () => {
    const state = withPriorities();
    expect(storedPriority(state, entry(state, 'claude/0/0'))).toEqual({ value: 7, from: 'group' });
    expect(storedPriority(state, entry(state, 'gemini/0/0'))).toEqual({ value: 3, from: 'key' });
    const owner = ownerState();
    expect(storedPriority(owner, entry(owner, 'openai-compatibility/0/g'))).toEqual({
      value: 0,
      from: 'none',
    });
  });

  test('a change is set on the key; its model list stays where it is stored', () => {
    const state = withPriorities();
    const draft = setKeyPriority(startDraft(state), 'claude/0/0', 20);
    expect(changeCount(draft)).toBe(1);
    const [write] = planWrites(draft);
    expect(write.path).toBe('/config/api-keys/claude');
    const groups = write.body as Array<Record<string, unknown>>;
    const stored = familyGroups(state.document, 'claude') as Array<Record<string, unknown>>;
    const key = (groups[0].keys as Array<Record<string, unknown>>)[0];
    expect(key.priority).toBe(20);
    expect('models' in key).toBe(false);
    expect(groups[0].priority).toBe(7);
    expect({ ...groups[0], keys: null }).toEqual({ ...stored[0], keys: null });
  });

  test('an OpenAI-compatible entry’s priority is its own; the same value as stored is no edit', () => {
    const owner = ownerState();
    const draft = setKeyPriority(startDraft(owner), 'openai-compatibility/0/g', 20);
    const groups = planWrites(draft)[0].body as Array<Record<string, unknown>>;
    expect(groups[0].priority).toBe(20);
    expect(setKeyPriority(draft, 'openai-compatibility/0/g', 0).priorities).toEqual({});
    expect(planCommit(setKeyPriority(draft, 'openai-compatibility/0/g', 0))).toEqual([]);
    // A login's priority is in its file: not here.
    expect(setKeyPriority(startDraft(owner), 'login/claude', 3)).toEqual(startDraft(owner));
    expect(setKeyPriority(startDraft(owner), 'claude/0/0', 1.5)).toEqual(startDraft(owner));
  });

  test('the list shows the new order at once, the edited priority marked', () => {
    const draft = setKeyPriority(startDraft(ownerState()), 'openai-compatibility/0/g', 20);
    const opus = nameOf(ownerNames(draft), 'claude-opus-5-5');
    expect(opus.lines.map((l) => [l.rank, l.provider, l.priority, l.priorityEdited])).toEqual([
      [1, 'openai-compatible-openrouter', 20, true],
      [2, 'claude', 10, false],
      [3, 'devin', 5, false],
      [4, 'claude', 0, false],
    ]);
  });

  test('a priority the save did not confirm is listed to type again', () => {
    let page = pageStep(INITIAL_PAGE, { type: 'read-answered', state: ownerState() });
    page = pageStep(page, {
      type: 'edited',
      change: (d) => setKeyPriority(d, 'openai-compatibility/0/g', 20),
    });
    page = pageStep(page, { type: 'save-started' });
    page = pageStep(page, {
      type: 'save-answered',
      outcome: {
        confirmed: [],
        unconfirmed: ['openai-compatibility/0/g'],
        failure: { reason: 'changed', message: '' },
      },
    });
    expect(page.lost).toHaveLength(1);
    expect(page.lost[0].priority).toEqual({ before: 0, after: 20 });
    expect(page.lost[0].edits).toEqual([]);
  });
});

describe('the filter', () => {
  const items = ownerNames();
  const draft = startDraft(ownerState());
  const shown = (patch: Partial<ModelsFilter>) =>
    keys(
      items.filter((item) =>
        matches(item, { ...EMPTY_MODELS_FILTER, ...patch }, draft.base.entries)
      )
    );

  test('by what serves a name, by view, and by words', () => {
    expect(shown({ provider: 'login:devin' })).toContain('claude-opus-5-5');
    expect(shown({ provider: 'login:devin' })).not.toContain('terra');
    expect(shown({ provider: 'openrouter' }).sort()).toEqual(
      ['claude-opus-5-5', 'deepseek', 'glm', 'gpt-6.1-terra', 'grok', 'kimi', 'qwen-coder'].sort()
    );
    expect(shown({ provider: 'keys' })).toContain('gemini-3-flash');
    expect(shown({ provider: 'id:codex' })).toContain('terra');
    expect(shown({ view: 'several' })).toEqual(
      expect.arrayContaining(['claude-opus-5-5', 'gpt-6.1-terra', 'kimi'])
    );
    expect(shown({ view: 'cooling' }).sort()).toEqual(['claude-opus-5-5', 'devin/claude-opus-5-5']);
    expect(shown({ view: 'problems' })).toEqual(['sonnet']);
    expect(shown({ query: 'openrouter grok' })).toEqual(['grok']);
  });

  test('the old pages’ addresses open the list on what they showed', () => {
    const filter = (search: string) => initialModelsFilter(new URLSearchParams(search));
    expect(filter('family=claude').provider).toBe('family:claude');
    expect(filter('channel=Anti_Gravity').provider).toBe('login:antigravity');
    expect(filter('store=login').provider).toBe('logins');
    expect(filter('provider=openrouter').provider).toBe('openrouter');
    expect(filter('provider=claude').provider).toBe('id:claude');
    expect(filter('q=opus&view=cooling')).toEqual({
      query: 'opus',
      provider: 'all',
      view: 'cooling',
    });
    expect(filter('family=nonsense&view=x')).toEqual(EMPTY_MODELS_FILTER);
  });
});

describe('addresses and the menu', () => {
  test('the old pages lead to Models with their filter', () => {
    expect(modelsAddressFor('/provimux/aliases', '?family=claude&view=x')).toBe(
      '/provimux/models?family=claude'
    );
    expect(modelsAddressFor('/provimux/model-routes', '?provider=openrouter')).toBe(
      '/provimux/models?provider=openrouter'
    );
    expect(modelsAddressFor('/provimux/live-lists', '')).toBe('/provimux/models');
    expect(modelsAddressFor('/auth-files/oauth-model-alias', '?provider=claude')).toBe(
      '/provimux/models?channel=claude'
    );
    expect(modelsAddressFor('/auth-files/oauth-model-alias', '')).toBe(
      '/provimux/models?store=login'
    );
    // The Auth Files tile and the exclusions page's switch still arrive there.
    const tile = buildModelRulesPath('alias', 'claude');
    expect(modelsAddressFor(tile.split('?')[0], tile.slice(tile.indexOf('?')))).toBe(
      '/provimux/models?channel=claude'
    );
  });

  test('Models is the page, not behind an endpoint gate; the old paths are redirects that win', () => {
    const models = PROVIMUX_ROUTES.find((route) => route.path === '/provimux/models');
    expect(models?.element.type).toBe(ModelsPage);
    for (const path of [
      '/provimux/aliases',
      '/provimux/model-routes',
      '/provimux/live-lists',
      '/auth-files/oauth-model-alias',
    ]) {
      const matched = matchRoutes([...PROVIMUX_ROUTES, { path, element: null }], path);
      expect(matched?.[0].route.element?.type).toBe(ModelsRedirect);
    }
    expect(PROVIMUX_PAGES.map((page) => [page.path, page.endpoint])).toEqual([
      ['/provimux/models', null],
      ['/provimux/savings', 'savings'],
    ]);
  });
});

// --- what the page draws -------------------------------------------------------------------------

const noop = () => undefined;
const devin = (logins: DevinCooling['logins']): DevinCooling => ({
  value: false,
  readError: null,
  logins,
  saving: false,
  read: async () => undefined,
  set: async () => ({ ok: true }),
});

function renderBody(
  page: PageState,
  options: { routesKnown?: boolean | null; filter?: ModelsFilter } = {}
) {
  const known = options.routesKnown === undefined ? true : options.routesKnown;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ModelsBody, {
        page,
        routes: known ? ownerRoutes() : null,
        routesKnown: known,
        routesError: null,
        routesOffsetMs: OWNER_NOW - Date.now(),
        lists: ownerLists(),
        usage: null,
        nowMs: OWNER_NOW,
        filter: options.filter ?? EMPTY_MODELS_FILTER,
        onFilter: noop,
        edit: noop,
        devin: devin({ enabled: 1, disabled: 0 }),
        onRoutesChanged: noop,
        onRetry: noop,
        onDismiss: noop,
      })
    )
  );
}
const pageWith = (state: AliasState): PageState =>
  pageStep(INITIAL_PAGE, { type: 'read-answered', state });

describe('the page', () => {
  test('his names, then the other models folded with their count, then the settings and the order note', async () => {
    await i18n.changeLanguage('en');
    const text = textOf(renderBody(pageWith(ownerState())));
    expect(text).toContain('Your names 13');
    expect(text).toContain('Show 28 other models');
    expect(text).toContain('Settings');
    expect(text).toContain('Devin: quota pause per model');
    expect(text).toContain('OpenRouter, built in');
    expect(text).toContain("Each login's own model list");
    expect(text).toContain('among the routes that can take a new request');
    // The stored groups hold the keys: none is rendered.
    expect(renderBody(pageWith(ownerState()))).not.toContain('fixture-key-');
  });

  test('a search shows every part it matches, the other models unfolded', async () => {
    await i18n.changeLanguage('en');
    const text = textOf(
      renderBody(pageWith(ownerState()), { filter: { ...EMPTY_MODELS_FILTER, query: 'gemini' } })
    );
    expect(text).toContain('gemini-2.5-pro');
    expect(text).not.toMatch(/Show \d+ other model/);
  });

  test('not editable while reading or without a tag; the line that the page cannot save', async () => {
    await i18n.changeLanguage('en');
    const reading = pageStep(pageWith(ownerState()), { type: 'read-started' });
    expect(renderBody(reading)).toMatch(/<fieldset[^>]*disabled=""/);
    expect(textOf(renderBody(reading))).toContain('Reading the configuration');
    const untagged = renderBody(pageWith(ownerState(null)));
    expect(untagged).toMatch(/<fieldset[^>]*disabled=""/);
    expect(textOf(untagged)).toContain('This page cannot save');
    expect(renderBody(pageWith(ownerState()))).not.toMatch(/<fieldset[^>]*disabled/);
  });

  test('on a proxy without the endpoints, one line says what is missing', async () => {
    await i18n.changeLanguage('en');
    const text = textOf(renderBody(pageWith(ownerState()), { routesKnown: false }));
    expect(text).toContain("This proxy doesn't report what it serves");
    expect(text).not.toContain('Devin: quota pause per model');
  });

  test('a route: sub or API key, the account (a login opens on Auth Files), what it sends, its priority', async () => {
    await i18n.changeLanguage('en');
    const draft = startDraft(ownerState());
    const html = renderCard(nameOf(ownerNames(draft), 'claude-opus-5-5'), draft);
    const text = textOf(html);
    expect(html).toContain('data-access="sub"');
    expect(html).toContain('data-access="api"');
    expect(html).toContain(
      'title="Open claude-office@providers.dev.json on Auth Files (auth_index li-claude-1)"'
    );
    // Only logins open on Auth Files; a key's priority is a button that edits it here.
    expect(html.match(/title="Open [^"]* on Auth Files/g)).toHaveLength(2);
    expect(html.match(/title="This API key[^"]*"/g)).toHaveLength(2);
    expect(text).toContain('devin/claude-opus-5-5');
    expect(text).toContain('priority 10');
    expect(text).toContain("Claude's model list, 2 hours ago");
    expect(text).toMatch(/cooling down, [^,(]+ left \(quota\)/);
    expect(html).toContain('quota · HTTP 429 · this model · retry step 3');
    expect(text).not.toMatch(/\b(available|unavailable)\b/i);
  });

  test('the editor of a name: rename, what is under it, and what can be added', async () => {
    await i18n.changeLanguage('en');
    const draft = startDraft(ownerState());
    const text = textOf(
      renderCard(nameOf(ownerNames(draft), 'claude-opus-5-5'), draft, undefined, { open: true })
    );
    expect(text).toContain('Rename');
    expect(text).toContain("Routes that serve the model's own name keep claude-opus-5-5.");
    expect(text).toContain('Under claude-opus-5-5');
    expect(text).toContain("in the key's list");
    expect(text).toContain('Add a model to claude-opus-5-5');
    expect(text).toContain('Remove this name');
    expect(text).toContain('Gemini API key');
    // The Claude subscription serves the name by itself: plain words, no "built in".
    expect(text).toContain("can't be taken out here");
  });
});

describe('the settings cards (Devin and OpenRouter only when configured)', () => {
  const render = (withDevin: boolean, withOpenRouter: boolean, lists = true) =>
    textOf(
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          null,
          createElement(ModelsSettings, {
            models: ownerRoutes().models,
            offsetMs: 0,
            nowMs: OWNER_NOW,
            devin: devin({ enabled: withDevin ? 1 : 0, disabled: 0 }),
            withDevin,
            withOpenRouter,
            lists: lists ? ownerLists() : null,
            onRoutesChanged: noop,
            onListsChanged: noop,
            onShowOpenRouter: noop,
          })
        )
      )
    );

  test('both, only Devin, none', async () => {
    await i18n.changeLanguage('en');
    const both = render(true, true);
    expect(both).toContain('Devin: quota pause per model');
    expect(both).toContain('OpenRouter, built in');
    const onlyDevin = render(true, false);
    expect(onlyDevin).toContain('Devin: quota pause per model');
    expect(onlyDevin).not.toContain('OpenRouter, built in');
    const none = render(false, false);
    expect(none).not.toContain('Devin');
    expect(none).not.toContain('OpenRouter');
    expect(none).toContain("Each login's own model list");
    expect(render(false, false, false)).toBe('');
  });
});

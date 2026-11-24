/**
 * Excluded models (design models-page.md, section 6): every model an account never serves, read from the
 * Models page's read of the configuration, and each change written at once as one request with If-Match,
 * the request the original pages make for that field (run here against a stand-in for the proxy):
 * `PUT /config/api-keys/<family>` for a key, `PUT /config/oauth/excluded-models` for every subscription of a
 * login type. No login file is read.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { readModelRoutes } from '@/provimux/api/normalize';
import type { ProvimuxModelRoutesResponse } from '@/provimux/api/types';
import { INITIAL_PAGE, pageStep, type PageState } from '@/provimux/pages/aliases/pageLogic';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import type { AliasState } from '@/provimux/pages/aliases/types';
import { EMPTY_MODELS_FILTER } from '@/provimux/pages/models/catalog';
import { ModelsBody } from '@/provimux/pages/models/ModelsBody';
import { excludedAddress, tabOf } from '@/provimux/pages/models/address';
import {
  excludedModels,
  familyExcludes,
  filterExcluded,
  placesExcluding,
  placesToOffer,
  readExclusions,
  ruleProblem,
  servicesWithExclusions,
  stillServedWithout,
  type KeyPlace,
  type LoginsPlace,
  type Place,
} from '@/provimux/pages/excluded/exclusions';
import { ExclusionRequestError, exclusionsApi } from '@/provimux/pages/excluded/exclusionsApi';
import { ExcludedView } from '@/provimux/pages/excluded/ExcludedView';
import {
  EXCLUDED_LOGINS_PATH,
  ExclusionWriteError,
  planExclusion,
} from '@/provimux/pages/excluded/writes';
import { fakeProxy, restoreProxy } from './support/fakeProxy';
import { OWNER_NOW, ownerFixture, ownerLists, ownerRoutes } from './support/models';

afterEach(restoreProxy);

type Doc = Record<string, unknown>;

/** A configuration with exclusions of every kind: a connection's, a key's own, the off switch, logins'. */
const config = (): Doc => ({
  'config-version': 8,
  'api-keys': {
    claude: [
      {
        name: 'anthropic',
        'excluded-models': ['claude-3-*'],
        keys: [
          { 'api-key': 'fixture-anthropic-key-0000a1b2', auth_index: 'ak-claude-1' },
          { 'api-key': 'fixture-anthropic-key-0000c9d0', auth_index: 'ak-claude-2' },
          {
            'api-key': 'fixture-anthropic-key-0000e1f2',
            auth_index: 'ak-claude-3',
            'excluded-models': ['claude-opus-4-1'],
          },
        ],
      },
      {
        name: 'claude-2',
        keys: [{ 'api-key': 'fixture-anthropic-key-00003344', auth_index: 'ak-claude-4' }],
      },
    ],
    codex: [
      {
        name: 'openai',
        'base-url': 'https://api.openai.com/v1',
        keys: [
          {
            'api-key': 'fixture-openai-key-00000c3d4',
            auth_index: 'ak-openai-1',
            'excluded-models': ['gpt-5-nano', '*', 42],
          },
        ],
      },
    ],
    gemini: [
      { name: 'gemini', keys: [{ 'api-key': 'fixture-gemini-key-0000e5f6', auth_index: 'ak-gemini-1' }] },
    ],
    'openai-compatibility': [
      {
        name: 'openrouter',
        'base-url': 'https://openrouter.ai/api/v1',
        keys: [{ 'api-key': 'fixture-openrouter-key-00g7h8', auth_index: 'ak-or-1' }],
        models: [{ name: 'deepseek/deepseek-v3.2', alias: 'deepseek' }],
      },
    ],
  },
  oauth: {
    'model-alias': {},
    'excluded-models': {
      Claude: ['claude-opus-4-1'],
      codex: ['gpt-5-codex-mini', 'gpt-4*'],
      kimi: ['kimi-k2'],
    },
  },
});

const FILES = [{ type: 'claude' }, { type: 'codex' }, { type: 'codex' }, { type: 'antigravity' }];

const stateOf = (doc: unknown, etag: string | null = '"t1"'): AliasState => ({
  ...readAliasState(doc, FILES),
  etag,
});

const place = (state: AliasState, id: string): Place => {
  const found = readExclusions(state).places.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no place ${id}`);
  return found;
};

/** A routes answer: each model with the accounts that serve it. */
const routes = (models: Record<string, Array<[string, 'oauth' | 'apikey', string]>>) =>
  ({
    observed_at: null,
    models: Object.entries(models).map(([id, list]) => ({
      id,
      display_name: null,
      owned_by: null,
      limits: { context: null, output: null },
      routes: list.map(([authIndex, kind, provider]) => ({
        auth_index: authIndex,
        provider,
        kind,
        priority: null,
        host: kind === 'apikey' ? 'api.anthropic.com' : null,
        login: { name: null, email: kind === 'oauth' ? 'alex@example.com' : null, label: null },
        limits: { context: null, output: null },
        reasoning: null,
        recorded_cooldown: null,
      })),
    })),
  }) as unknown as ProvimuxModelRoutesResponse;

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');

describe('reading where models are excluded', () => {
  test('every native key and every login type with a subscription is a place; OpenAI-compatible entries are not', () => {
    const read = readExclusions(stateOf(config()));
    expect(read.places.map((p) => p.id)).toEqual([
      'logins:claude',
      'claude/0/0',
      'claude/0/1',
      'claude/0/2',
      'claude/1/0',
      'logins:codex',
      'codex/0/0',
      'gemini/0/0',
      'logins:antigravity',
      'logins:kimi',
    ]);
    expect(read.loginMapWritable).toBe(true);
    expect(read.unread).toEqual([]);
  });

  test('OpenAI-compatible entries have no exclusions yet: one switch, no place, no write, named in one line', () => {
    // The proxy has no excluded-models for them yet; a coming release adds it, and `familyExcludes` is the switch.
    expect(familyExcludes('openai-compatibility')).toBe(false);
    for (const family of ['claude', 'codex', 'gemini', 'interactions', 'vertex', 'xai', 'meta'] as const) {
      expect(familyExcludes(family)).toBe(true);
    }
    const state = stateOf(config());
    const read = readExclusions(state);
    expect(read.withoutExclusions.map((entry) => entry.groupName)).toEqual(['openrouter']);
    expect(read.places.some((p) => p.kind === 'key' && p.entry.family === 'openai-compatibility')).toBe(false);
    const entry = read.withoutExclusions[0];
    const asPlace: KeyPlace = {
      kind: 'key',
      id: entry.id,
      entry,
      service: 'openrouter',
      storedOn: 'group',
      sharing: 1,
      rules: [],
      off: false,
    };
    expect(() => planExclusion(config(), { place: asPlace, rule: 'x', excluded: true })).toThrow(
      ExclusionWriteError
    );
  });

  test("a key's list is its own when it has one, else its connection's, shared with the keys that use it", () => {
    const state = stateOf(config());
    const inherits = place(state, 'claude/0/0') as KeyPlace;
    expect(inherits).toMatchObject({ storedOn: 'group', sharing: 2, rules: ['claude-3-*'], off: false });
    const own = place(state, 'claude/0/2') as KeyPlace;
    expect(own).toMatchObject({ storedOn: 'key', sharing: 0, rules: ['claude-opus-4-1'] });
    // `*` alone is the key's off switch, not an exclusion; what is not a string is not a rule.
    const off = place(state, 'codex/0/0') as KeyPlace;
    expect(off).toMatchObject({ storedOn: 'key', rules: ['gpt-5-nano'], off: true });
  });

  test('every subscription of a type: the map under any spelling, with the count of its logins', () => {
    const state = stateOf(config());
    expect(place(state, 'logins:claude')).toMatchObject({
      type: 'claude',
      spellings: ['Claude'],
      loginCount: 1,
      rules: ['claude-opus-4-1'],
      service: 'claude',
    });
    expect(place(state, 'logins:codex')).toMatchObject({ loginCount: 2, service: 'openai' });
    // A type with rules and no subscription is listed, not offered; one with logins and no rule is offered.
    expect(place(state, 'logins:kimi')).toMatchObject({ loginCount: 0, rules: ['kimi-k2'] });
    const offered = placesToOffer(readExclusions(state).places).map((p) => p.id);
    expect(offered).toContain('logins:antigravity');
    expect(offered).not.toContain('logins:kimi');
  });

  test('one item per model or pattern, with every place excluding it; served nowhere is said', () => {
    const state = stateOf(config());
    const served = routes({
      'claude-3-5-haiku': [['ak-claude-4', 'apikey', 'claude']],
      'gpt-5-codex-mini': [['li-codex-9', 'oauth', 'codex']],
    });
    const items = excludedModels(readExclusions(state).exclusions, served);
    const opus = items.find((item) => item.key === 'claude-opus-4-1')!;
    expect(opus.exclusions.map((e) => e.place.id)).toEqual(['logins:claude', 'claude/0/2']);
    expect(opus.stillServed).toEqual([]);
    const pattern = items.find((item) => item.key === 'claude-3-*')!;
    expect(pattern.wildcard).toBe(true);
    expect(pattern.exclusions.map((e) => e.place.id)).toEqual(['claude/0/0', 'claude/0/1']);
    // The pattern still lets the other connection's key serve a Claude 3 model.
    expect(pattern.stillServed!.map((s) => s.model)).toEqual(['claude-3-5-haiku']);
    // Without the routes, nothing is claimed either way.
    expect(excludedModels(readExclusions(state).exclusions, null)[0].stillServed).toBeNull();
  });

  test('a map the browser cannot hold exactly is not read, not offered and never written', () => {
    const doc = config();
    (doc.oauth as Doc)['excluded-models'] = { claude: ['x'], codex: [2 ** 60] };
    const state = stateOf(doc);
    const read = readExclusions(state);
    expect(read.loginMapWritable).toBe(false);
    expect(read.places.some((p) => p.kind === 'logins')).toBe(false);
    expect(read.unread).toEqual(['oauth.excluded-models.codex[0]']);
    const logins: LoginsPlace = {
      kind: 'logins',
      id: 'logins:claude',
      type: 'claude',
      spellings: ['claude'],
      service: 'claude',
      loginCount: 1,
      rules: [],
    };
    expect(() => planExclusion(doc, { place: logins, rule: 'y', excluded: true })).toThrow(
      ExclusionWriteError
    );
  });

  test('filtering by service and by a model name: a pattern answers the models it takes out', () => {
    const items = excludedModels(readExclusions(stateOf(config())).exclusions, null);
    const claude = filterExcluded(items, { query: '', service: 'claude' });
    expect(claude.map((item) => item.key)).toEqual(['claude-3-*', 'claude-opus-4-1']);
    const byModel = filterExcluded(items, { query: 'claude-3-opus', service: 'all' });
    expect(byModel.map((item) => item.key)).toEqual(['claude-3-*']);
    const openai = filterExcluded(items, { query: 'gpt', service: 'openai' });
    expect(openai.map((item) => item.key)).toEqual(['gpt-4*', 'gpt-5-codex-mini', 'gpt-5-nano']);
    expect(servicesWithExclusions(readExclusions(stateOf(config())).exclusions)).toEqual([
      { service: 'claude', count: 4 },
      { service: 'openai', count: 3 },
      { service: 'kimi', count: 1 },
    ]);
  });

  test("a name on Models is marked where a rule takes it out, by its name or the model it sends", () => {
    const { exclusions } = readExclusions(stateOf(config()));
    expect(placesExcluding(exclusions, ['opus', 'claude-opus-4-1']).map((e) => e.place.id)).toEqual([
      'logins:claude',
      'claude/0/2',
    ]);
    expect(placesExcluding(exclusions, ['claude-3-opus']).map((e) => e.place.id)).toEqual([
      'claude/0/0',
      'claude/0/1',
    ]);
    expect(placesExcluding(exclusions, ['sonnet', 'claude-sonnet-4-5'])).toEqual([]);
  });
});

describe('adding one: what can be added, and what it will mean', () => {
  test('refused with why: empty, the off switch, a space or comma, already there, covered by a pattern', () => {
    const state = stateOf(config());
    const inherits = place(state, 'claude/0/0');
    expect(ruleProblem(inherits, ' ')).toEqual({ problem: 'empty' });
    expect(ruleProblem(inherits, '*')).toEqual({ problem: 'reserved' });
    expect(ruleProblem(inherits, 'a b')).toEqual({ problem: 'invalid' });
    expect(ruleProblem(inherits, 'a,b')).toEqual({ problem: 'invalid' });
    expect(ruleProblem(inherits, 'CLAUDE-3-*')).toEqual({ problem: 'exists' });
    expect(ruleProblem(inherits, 'claude-3-opus')).toEqual({ problem: 'covered', pattern: 'claude-3-*' });
    expect(ruleProblem(inherits, 'claude-sonnet-4-5')).toBeNull();
  });

  test('who would still serve it: the routes of the names it matches, less the place’s own', () => {
    const state = stateOf(config());
    const served = routes({
      'claude-sonnet-4-5': [
        ['li-claude-1', 'oauth', 'claude'],
        ['ak-claude-1', 'apikey', 'claude'],
      ],
    });
    const logins = place(state, 'logins:claude');
    expect(stillServedWithout(logins, 'claude-sonnet-4-5', served)!.map((s) => s.route.auth_index)).toEqual([
      'ak-claude-1',
    ]);
    const key = place(state, 'claude/0/0');
    expect(stillServedWithout(key, 'claude-sonnet-4-5', served)!.map((s) => s.route.auth_index)).toEqual([
      'li-claude-1',
    ]);
    expect(stillServedWithout(key, 'claude-sonnet-4-5', null)).toBeNull();
  });
});

describe('the writes: one request each, the original pages’ own, with If-Match on the read', () => {
  test('every subscription of a type: PUT /config/oauth/excluded-models, the map as read with that list changed', async () => {
    const proxy = fakeProxy(config());
    const state = stateOf(proxy.doc(), proxy.tag());
    const tag = await exclusionsApi.write(state, {
      place: place(state, 'logins:antigravity'),
      rule: 'gemini-3-pro',
      excluded: true,
    });
    expect(proxy.puts().map(({ path, ifMatch }) => ({ path, ifMatch }))).toEqual([
      { path: EXCLUDED_LOGINS_PATH, ifMatch: '"t1"' },
    ]);
    expect(tag).toBe('"t2"');
    // The other types stay exactly as stored, their spelling included.
    expect((proxy.doc().oauth as Doc)['excluded-models']).toEqual({
      Claude: ['claude-opus-4-1'],
      codex: ['gpt-5-codex-mini', 'gpt-4*'],
      kimi: ['kimi-k2'],
      antigravity: ['gemini-3-pro'],
    });
    // The alias map, the other half of `oauth`, is not touched.
    expect((proxy.doc().oauth as Doc)['model-alias']).toEqual({});
    expect(proxy.unconditional).toBe(0);
  });

  test('taking out the last rule of a type removes its list; another spelling is folded in, as Auth Files writes it', async () => {
    const proxy = fakeProxy(config());
    const state = stateOf(proxy.doc(), proxy.tag());
    await exclusionsApi.write(state, {
      place: place(state, 'logins:claude'),
      rule: 'claude-opus-4-1',
      excluded: false,
    });
    expect((proxy.doc().oauth as Doc)['excluded-models']).toEqual({
      codex: ['gpt-5-codex-mini', 'gpt-4*'],
      kimi: ['kimi-k2'],
    });
    const again = stateOf(proxy.doc(), proxy.tag());
    await exclusionsApi.write(again, { place: place(again, 'logins:codex'), rule: 'GPT-4*', excluded: false });
    expect(((proxy.doc().oauth as Doc)['excluded-models'] as Doc).codex).toEqual(['gpt-5-codex-mini']);
  });

  test("a key: PUT /config/api-keys/<family>, one list changed, the rest of the family as read", async () => {
    const proxy = fakeProxy(config());
    let state = stateOf(proxy.doc(), proxy.tag());
    const claude = () => ((proxy.doc()['api-keys'] as Doc).claude as Doc[]);

    // A key sharing its connection's list with another key gets its own: the connection's plus the rule.
    await exclusionsApi.write(state, {
      place: place(state, 'claude/0/0'),
      rule: 'claude-sonnet-4-5',
      excluded: true,
    });
    expect(proxy.puts()[0].path).toBe('/config/api-keys/claude');
    expect(proxy.puts()[0].ifMatch).toBe('"t1"');
    expect(claude()[0]['excluded-models']).toEqual(['claude-3-*']);
    expect((claude()[0].keys as Doc[])[0]['excluded-models']).toEqual(['claude-3-*', 'claude-sonnet-4-5']);
    expect((claude()[0].keys as Doc[])[1]['excluded-models']).toBeUndefined();

    // A key alone on its connection: the connection's list.
    state = stateOf(proxy.doc(), proxy.tag());
    await exclusionsApi.write(state, { place: place(state, 'claude/1/0'), rule: 'claude-opus-4-1', excluded: true });
    expect(claude()[1]['excluded-models']).toEqual(['claude-opus-4-1']);
    expect((claude()[1].keys as Doc[])[0]['excluded-models']).toBeUndefined();

    // Its own list: the rule leaves it, and the empty list stays, so it still does not use the connection's.
    state = stateOf(proxy.doc(), proxy.tag());
    await exclusionsApi.write(state, { place: place(state, 'claude/0/2'), rule: 'claude-opus-4-1', excluded: false });
    expect((claude()[0].keys as Doc[])[2]['excluded-models']).toEqual([]);

    // The off switch and anything not a string stay.
    state = stateOf(proxy.doc(), proxy.tag());
    await exclusionsApi.write(state, { place: place(state, 'codex/0/0'), rule: 'gpt-5-nano', excluded: false });
    const codex = (proxy.doc()['api-keys'] as Doc).codex as Doc[];
    expect((codex[0].keys as Doc[])[0]['excluded-models']).toEqual(['*', 42]);

    // Nothing else of the file moved: the other families and the login map are as they were.
    const before = config();
    expect((proxy.doc()['api-keys'] as Doc).gemini).toEqual((before['api-keys'] as Doc).gemini);
    expect((proxy.doc()['api-keys'] as Doc)['openai-compatibility']).toEqual(
      (before['api-keys'] as Doc)['openai-compatibility']
    );
    expect(proxy.doc().oauth).toEqual(before.oauth);
    expect(proxy.puts().every((put) => put.ifMatch !== undefined)).toBe(true);
    expect(proxy.unconditional).toBe(0);
  });

  test('a file changed since the read: 412, nothing written; a read without a tag sends nothing', async () => {
    const proxy = fakeProxy(config());
    const state = stateOf(proxy.doc(), proxy.tag());
    proxy.foreign((doc) => {
      (doc as Doc)['config-version'] = 8;
    });
    const after = structuredClone(proxy.doc());
    const failed = await exclusionsApi
      .write(state, { place: place(state, 'logins:claude'), rule: 'x', excluded: true })
      .catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(ExclusionRequestError);
    expect((failed as ExclusionRequestError).reason).toBe('changed');
    expect(proxy.doc()).toEqual(after);
    expect(proxy.puts()[0].status).toBe(412);

    const untagged = stateOf(proxy.doc(), null);
    const refused = await exclusionsApi
      .write(untagged, { place: place(untagged, 'logins:claude'), rule: 'x', excluded: true })
      .catch((error: unknown) => error);
    expect((refused as ExclusionRequestError).reason).toBe('no-tag');
    expect(proxy.puts()).toHaveLength(1);
  });

  test('a refusal of the proxy is said with its words', async () => {
    const proxy = fakeProxy(config());
    proxy.failPut(1, { status: 422, message: 'excluded-models must be a list' });
    const state = stateOf(proxy.doc(), proxy.tag());
    const failed = await exclusionsApi
      .write(state, { place: place(state, 'claude/0/0'), rule: 'x', excluded: true })
      .catch((error: unknown) => error);
    expect((failed as ExclusionRequestError).reason).toBe('refused');
    expect((failed as Error).message).toContain('excluded-models must be a list');
  });

  test('the page never reads a login file, and writes only the two paths', () => {
    const sources = ['exclusions.ts', 'writes.ts', 'exclusionsApi.ts', 'ExcludedView.tsx', 'ExclusionComposer.tsx']
      .map((file) => readFileSync(`src/provimux/pages/excluded/${file}`, 'utf8'))
      .join('\n');
    expect(sources).not.toContain('/credentials/download');
    expect(sources).not.toContain('downloadText');
    expect(sources).not.toMatch(/apiClient\.(put|patch|post|delete)\(/);
  });
});

describe('the page while a write runs', () => {
  const read = (state: AliasState): PageState => pageStep(INITIAL_PAGE, { type: 'read-answered', state });

  test('a write starts only over a draft without edits, locks the page, and ends; a read landing meanwhile is dropped', () => {
    const page = read(stateOf(config()));
    const writing = pageStep(page, { type: 'write-started' });
    expect(writing).toMatchObject({ saving: true, writing: true });
    expect(pageStep(writing, { type: 'write-started' })).toBe(writing);
    // A read that answers during the write is dropped; the page reads again when it ends.
    const dropped = pageStep(pageStep(writing, { type: 'read-started' }), {
      type: 'read-answered',
      state: stateOf(config(), '"t9"'),
    });
    expect(dropped.draft!.base.etag).toBe('"t1"');
    expect(pageStep(writing, { type: 'write-ended' })).toMatchObject({ saving: false, writing: false });
    // A names save in progress is not ended by a write's end.
    const saving = pageStep(page, { type: 'save-started' });
    expect(pageStep(saving, { type: 'write-ended' })).toBe(saving);
  });

  test('with names edited and not saved, no write starts', () => {
    const page = read(stateOf(config()));
    const edited = pageStep(page, {
      type: 'edited',
      change: (draft) => ({ ...draft, priorities: { 'claude/0/0': 7 } }),
    });
    expect(pageStep(edited, { type: 'write-started' })).toBe(edited);
  });
});

describe('the view', () => {
  const ownerWithExclusions = (): Doc => {
    const doc = structuredClone(ownerFixture('config')) as Doc;
    doc.oauth = {
      ...(doc.oauth as Doc),
      'excluded-models': { claude: ['claude-opus-4-1'], codex: ['gpt-6-*'] },
    };
    return doc;
  };
  const ownerState = (): AliasState => ({ ...readAliasState(ownerWithExclusions(), FILES), etag: '"o1"' });

  const renderView = (state: AliasState, served: ProvimuxModelRoutesResponse | null, dirty = false) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ExcludedView, {
          state,
          locked: false,
          dirty,
          writing: null,
          routes: served,
          routesKnown: served !== null,
          filter: { query: '', service: 'all' },
          onFilter: () => undefined,
          onWrite: async () => true,
        })
      )
    );

  test('one card per model: where, which kind, served nowhere or by whom; the login files and OpenAI-compatible lines', async () => {
    await i18n.changeLanguage('en');
    const served = routes({ 'gpt-6-mini': [['li-codex-1', 'oauth', 'codex']] });
    const html = renderView(stateOf(config()), served);
    const text = textOf(html);
    expect(text).toContain('8 exclusions');
    expect(text).toContain('claude-opus-4-1');
    expect(text).toContain('Every Claude subscription');
    expect(text).toContain('1 login now');
    expect(text).toContain('Claude API key');
    expect(text).toContain('from its connection “anthropic”, shared by 2 keys');
    expect(text).toContain('turned off');
    expect(text).toContain('Served nowhere now');
    expect(text).toContain('pattern');
    expect(text).toContain('No subscription now');
    // The one line on what is in login files, with the link to Subscriptions; OpenAI-compatible entries named.
    expect(text).toContain('That file is never downloaded here');
    expect(text).toContain('See them in Subscriptions');
    expect(text).toContain('OpenAI-compatible entries (openrouter) have no exclusions');
    // A key's place links to its account on Accounts.
    expect(html).toContain('href="/provimux/accounts?account=ak-claude-3"');
    // No stored key is rendered.
    expect(html).not.toContain('fixture-anthropic-key');
  });

  test('with names edited and not saved, it says why nothing can be changed; an empty install says what exclusions are', async () => {
    await i18n.changeLanguage('en');
    const html = renderView(stateOf(config()), null, true);
    expect(textOf(html)).toContain("Your changes to names aren't saved yet");
    expect(html).toMatch(/disabled=""><span><svg[^]*?<\/svg>Exclude a model/);
    expect(textOf(html)).toContain('Whether another account still serves it isn');
    const empty = config();
    delete (empty.oauth as Doc)['excluded-models'];
    (empty['api-keys'] as Doc).claude = [];
    (empty['api-keys'] as Doc).codex = [];
    expect(textOf(renderView(stateOf(empty), null))).toContain('No model is excluded');
  });

  test("Models: the tab is the address's, and a name excluded somewhere links there", async () => {
    await i18n.changeLanguage('en');
    expect(tabOf(new URLSearchParams('tab=excluded'))).toBe('excluded');
    expect(tabOf(new URLSearchParams('view=problems'))).toBe('names');
    expect(excludedAddress('claude-opus-4-1')).toBe('/provimux/models?tab=excluded&model=claude-opus-4-1');

    const page = pageStep(INITIAL_PAGE, { type: 'read-answered', state: ownerState() });
    const body = (tab: 'names' | 'excluded', query = '') =>
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          null,
          createElement(ModelsBody, {
            tab,
            page,
            routes: ownerRoutes(),
            routesKnown: true,
            routesError: null,
            routesOffsetMs: OWNER_NOW - Date.now(),
            lists: ownerLists(),
            usage: null,
            nowMs: OWNER_NOW,
            filter: { ...EMPTY_MODELS_FILTER, query },
            onFilter: () => undefined,
            edit: () => undefined,
            devin: {
              logins: { enabled: 0, disabled: 0 },
              read: () => undefined,
            } as never,
            onRoutesChanged: () => undefined,
            onRetry: () => undefined,
            onDismiss: () => undefined,
          })
        )
      );
    const names = body('names', 'claude-opus-4-1');
    expect(names).toContain('href="/provimux/models?tab=excluded&amp;model=claude-opus-4-1"');
    expect(textOf(names)).toContain('Excluded in 1 place');
    // A name a pattern takes out is marked too; one no rule matches is not.
    expect(textOf(body('names', 'gpt-6-mini'))).toContain('Excluded in 1 place');
    expect(textOf(body('names', 'gemini-3-pro'))).not.toContain('Excluded in');
    // The other tab shows the exclusions, not the names.
    const excluded = textOf(body('excluded'));
    expect(excluded).toContain('Every Claude subscription');
    expect(excluded).toContain('gpt-6-*');
    expect(excluded).not.toContain('Your names');
  });

  test('routes read from a real answer: a model still served elsewhere is named', async () => {
    await i18n.changeLanguage('en');
    const state = ownerState();
    const items = excludedModels(readExclusions(state).exclusions, ownerRoutes());
    const opus = items.find((item) => item.key === 'claude-opus-4-1')!;
    // The owner's routes still list claude-opus-4-1: something else serves it, and the card says who.
    expect(opus.stillServed!.length).toBeGreaterThan(0);
    const html = renderView(state, readModelRoutes(ownerFixture('model-routes')));
    expect(textOf(html)).toMatch(/Still served by \d+ accounts?/);
  });
});

describe('strings in seven languages', () => {
  test('every language has the excluded view, the tabs, the mark and the menu drawer', () => {
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const own = JSON.parse(readFileSync(`src/provimux/locales/${language}.json`, 'utf8')).provimux;
      expect(own.nav.advanced_settings).toBeTruthy();
      expect(own.nav_meta.advanced_settings).toBeTruthy();
      expect(own.models.tab_excluded).toBeTruthy();
      expect(own.models.excluded_mark_other).toContain('{{count}}');
      expect(own.excluded.login_files).toBeTruthy();
      expect(own.excluded.composer.problem_covered).toContain('{{pattern}}');
      // The menu's old group name is gone from Accounts' lines too.
      expect(JSON.stringify(own.accounts)).not.toMatch(
        /All settings|全部设置|全部設定|Все настройки|Mọi cài đặt|전체 설정|Tüm ayarlar/
      );
    }
  });
});

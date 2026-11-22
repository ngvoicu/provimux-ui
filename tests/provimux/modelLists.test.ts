// The Model lists page (Provimux model-lists.md 5.5) and its fallback to the live-lists page.
// Fixtures: the contract's example responses, Provimux branch model-lists-live,
// .github/provimux/design/pui13/examples/model-lists{,-login,-live}.json, copied verbatim.
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { apiClient } from '../../src/services/api/client';
import { PROVIMUX_PATHS, provimuxApi } from '../../src/provimux/api/provimuxApi';
import { readModelLists } from '../../src/provimux/api/normalize';
import type { ProvimuxModelListLogin } from '../../src/provimux/api/types';
import { provimuxNav } from '../../src/provimux/nav';
import {
  useProvimuxPresence,
  type PresenceEntry,
  type PresenceStatus,
} from '../../src/provimux/presence';
import {
  LIVE_LIST_MAX_AGE_MS,
  fieldSourceKind,
  listAge,
  modelListsPageFor,
  modelListsSummary,
  modelOrigin,
  modelRowState,
  publishedLine,
  sortModels,
  sourceKind,
} from '../../src/provimux/pages/modelLists/logic';
import {
  LoginRows,
  ModelsPanel,
  PublishedStatus,
} from '../../src/provimux/pages/modelLists/ModelListsPage';
import { ModelListsRoute } from '../../src/provimux/pages/modelLists/ModelListsRoute';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/${name}.json`, 'utf8'));
const lists = readModelLists(fixture('model-lists'));
const one = readModelLists(fixture('model-lists-login'));
const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-11-22T18:04:11.482Z');
const entry = (status: PresenceStatus): PresenceEntry => ({ status, message: null });

const initialLanguage = i18n.language;
beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

const login = (
  patch: Partial<ProvimuxModelListLogin> = {},
  live: Partial<ProvimuxModelListLogin['live']> = {}
) => {
  const base = lists.logins[0];
  return { ...base, ...patch, live: { ...base.live, ...live } };
};

describe('reading the answer', () => {
  test('the contract example, every field', () => {
    expect(lists.options).toEqual({ live_lists: true, published_lists: false });
    expect(lists.published.state).toBe('off');
    expect(lists.login_types).toContain('devin');
    const devin = lists.logins[0];
    expect(devin.provider).toBe('devin');
    expect(devin.source).toBe('live');
    expect(devin.live).toMatchObject({
      supported: true,
      held: true,
      expired: false,
      listed_models: 53,
    });
    expect(devin.learned_models).toBe(1);
    expect(devin.models).toBeNull();
    const geminiKey = lists.logins[1];
    expect(geminiKey.provider).toBe('gemini');
    expect(geminiKey.live.from_cache).toBe(true);
    expect(geminiKey.live.last_failure).toEqual({
      at: '2026-11-22T17:58:02Z',
      category: 'http_status',
      http_status: 401,
    });
    expect(lists.logins[2].live.supported).toBe(false);
  });

  test("one login's models, with the source of each value", () => {
    const models = one.logins[0].models!;
    expect(models.map((model) => model.id)).toEqual([
      'devin/gemini-4-neon',
      'devin/swe-1-6-slow',
      'devin/swe-2',
    ]);
    expect(models[0]).toMatchObject({
      learned: true,
      source: 'live',
      reasoning_levels: ['low', 'medium', 'high'],
    });
    expect(models[2].sources.reasoning_levels).toBe('built-in');
    expect(models[1].sources.context).toBeNull();
  });

  test('a newer or broken answer degrades to unknowns, never to an error', () => {
    const answer = readModelLists({
      options: { live_lists: 'yes' },
      published: { state: 'syncing' },
      logins: [
        {
          provider: 'devin',
          source: 'vendor-v2',
          live: { held: 1, fetched_at: 'not a time' },
          extra: true,
        },
        'not a row',
        {
          source: 'live',
          models: [{ display_name: 'no id' }, { id: 'x', sources: { context: 'groundtruth' } }],
        },
      ],
    });
    expect(answer.options.live_lists).toBeNull();
    expect(answer.published.state).toBe('syncing');
    expect(publishedLine(answer)).toBe('unknown');
    expect(answer.logins).toHaveLength(2);
    expect(answer.logins[0].source).toBe('vendor-v2');
    expect(answer.logins[0].live).toMatchObject({
      held: false,
      fetched_at: null,
      supported: false,
    });
    expect(answer.logins[1].provider).toBe('unknown');
    expect(answer.logins[1].models!.map((model) => model.id)).toEqual(['x']);
    expect(fieldSourceKind(answer.logins[1].models![0].sources.context)).toBe('unknown');
    expect(readModelLists(null).logins).toEqual([]);
  });

  test('the client: the whole list, and one login by its auth index', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue(fixture('model-lists'));
    try {
      await provimuxApi.modelLists();
      expect(get).toHaveBeenLastCalledWith('/provimux/model-lists');
      await provimuxApi.modelLists(apiClient, 'a8d1 67');
      expect(get).toHaveBeenLastCalledWith('/provimux/model-lists?auth_index=a8d1%2067');
      expect(PROVIMUX_PATHS.modelLists).toBe('/provimux/model-lists');
    } finally {
      get.mockRestore();
    }
  });
});

describe('what a row says', () => {
  test('from the recorded facts only', () => {
    expect(modelRowState(login(), true, NOW)).toBe('live');
    expect(modelRowState(login({ disabled: true }), true, NOW)).toBe('disabled');
    expect(
      modelRowState(
        login(
          {},
          { last_failure: { at: '2026-11-22T17:00:00Z', category: 'network', http_status: null } }
        ),
        true,
        NOW
      )
    ).toBe('live_failing');
    expect(modelRowState(login({}, { fetched_at: '2026-11-21T10:00:00Z' }), true, NOW)).toBe(
      'live_old'
    );
    expect(
      modelRowState(login({ source: 'built-in' }, { held: false, expired: true }), true, NOW)
    ).toBe('expired');
    expect(
      modelRowState(login({ source: 'built-in' }, { held: false, fetched_at: null }), true, NOW)
    ).toBe('waiting');
    expect(
      modelRowState(login({ source: 'built-in' }, { held: false, fetching: true }), true, NOW)
    ).toBe('fetching');
    expect(modelRowState(login({ source: 'built-in' }, { held: false }), false, NOW)).toBe('off');
    expect(modelRowState(lists.logins[2], true, NOW)).toBe('no_vendor_list');
    expect(modelRowState(login({ source: 'vendor-v2' }), true, NOW)).toBe('unknown');
  });

  test('a list is marked once it is a day old, and expired after 7 days', () => {
    expect(listAge(login({}, { fetched_at: '2026-11-22T16:10:44Z' }), NOW)).toBe('fresh');
    expect(listAge(login({}, { fetched_at: '2026-11-21T18:04:11.482Z' }), NOW)).toBe('old');
    expect(listAge(login({}, { expired: true }), NOW)).toBe('expired');
    expect(listAge(login({}, { fetched_at: null }), NOW)).toBe('none');
    expect(LIVE_LIST_MAX_AGE_MS).toBe(7 * 24 * 3600 * 1000);
  });

  test('the summary counts sources apart, and the models the catalog lacks', () => {
    const summary = modelListsSummary(lists.logins, NOW);
    expect(summary).toMatchObject({
      live: 2,
      builtIn: 1,
      none: 0,
      unknown: 0,
      failing: 1,
      learned: 1,
      old: 1,
    });
    expect(modelListsSummary([login({ source: 'vendor-v2' })], NOW).unknown).toBe(1);
    expect(sourceKind('published')).toBe('published');
  });

  test('the providers.dev line', () => {
    expect(publishedLine(lists)).toBe('off');
    const failure = { at: '2026-11-22T12:00:00Z', category: 'network', http_status: null };
    expect(
      publishedLine({ published: { ...lists.published, state: 'held', last_failure: failure } })
    ).toBe('held_failing');
    expect(publishedLine({ published: { ...lists.published, state: 'none' } })).toBe('none');
  });

  test('learned models first, then by id', () => {
    const models = one.logins[0].models!;
    expect(sortModels([...models].reverse()).map((model) => model.id)[0]).toBe(
      'devin/gemini-4-neon'
    );
    expect(models.map(modelOrigin)).toEqual(['learned', 'provimux', 'live']);
  });
});

describe('rendering', () => {
  const render = (node: Parameters<typeof createElement>[0], props: object) =>
    renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement('table', null, createElement(node, props)))
    );

  test('a row: its source, its age mark, the disk cache, the models the catalog lacks', () => {
    const html = render(LoginRows, {
      login: login({}, { fetched_at: '2026-11-21T09:00:12Z', from_cache: true }),
      state: 'live_old',
      nowMs: NOW,
    });
    expect(html).toContain('Live list');
    expect(html).toContain('Getting old');
    expect(html).toContain('From disk');
    expect(html).toContain('1 not in the catalog yet');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('provimux.lists');
  });

  test("a login's models, with where each value came from", () => {
    const html = renderToStaticMarkup(
      createElement(ModelsPanel, {
        state: { phase: 'ready', models: sortModels(one.logins[0].models!) },
        provider: 'devin',
      })
    );
    expect(html).toContain('devin/gemini-4-neon');
    expect(html).toContain('not in the catalog yet');
    expect(html).toContain('data-field-source="live"');
    expect(html).toContain('data-field-source="built-in"');
    expect(html).toContain('Added by Provimux');
    expect(html).not.toContain('provimux.lists');
  });

  test('the line at the top says the published lists are not used, or which dataset is held', () => {
    expect(
      renderToStaticMarkup(createElement(PublishedStatus, { data: lists, nowMs: NOW }))
    ).toContain('Published lists are not used by this Provimux');
    const held = {
      ...lists,
      published: {
        ...lists.published,
        state: 'held',
        dataset_version: '3f9c0a1b2c3d4e5f',
        generated_at: '2026-11-22T04:20:11Z',
      },
    };
    expect(
      renderToStaticMarkup(createElement(PublishedStatus, { data: held, nowMs: NOW }))
    ).toContain('providers.dev dataset 3f9c0a1b2c3d');
  });

  test('every state, source and origin has its words', () => {
    for (const key of [
      'live',
      'live_failing',
      'live_old',
      'fetching',
      'off',
      'disabled',
      'expired',
      'failed',
      'waiting',
      'no_vendor_list',
      'unknown',
    ]) {
      expect(i18n.t(`provimux.lists.state.${key}`)).not.toContain('provimux.');
    }
    for (const key of ['live', 'published', 'built-in', 'none']) {
      expect(i18n.t(`provimux.lists.source.${key}`)).not.toContain('provimux.');
    }
    for (const key of ['learned', 'live', 'built-in', 'provimux', 'other', 'unknown']) {
      expect(i18n.t(`provimux.lists.origin.${key}`, { provider: 'Devin' })).not.toContain(
        'provimux.'
      );
    }
  });
});

describe('old and new servers (05-console-contract.md section 4)', () => {
  const groups = () => [{ id: 'gateway', items: [{ path: '/routing' }] as object[] }];
  const items = (pages: Record<string, PresenceEntry>) =>
    provimuxNav(groups(), pages)[0].items.filter(
      (item) => (item as { path: string }).path === '/provimux/live-lists'
    ) as Array<{ labelKey: string }>;

  test('a new server: one item, named Model lists, on the same path', () => {
    const found = items({
      modelRoutes: entry('ready'),
      liveLists: entry('ready'),
      modelLists: entry('ready'),
      savings: entry('ready'),
    });
    expect(found).toHaveLength(1);
    expect(found[0].labelKey).toBe('provimux.nav.model_lists');
  });

  test('an older Provimux (model-lists 404): the live-lists item as before', () => {
    const found = items({
      modelRoutes: entry('ready'),
      liveLists: entry('ready'),
      modelLists: entry('unsupported'),
      savings: entry('ready'),
    });
    expect(found).toHaveLength(1);
    expect(found[0].labelKey).toBe('provimux.nav.live_lists');
  });

  test('stock CLIProxyAPI: no item', () => {
    expect(
      items({
        modelRoutes: entry('unsupported'),
        liveLists: entry('unsupported'),
        modelLists: entry('unsupported'),
        savings: entry('unsupported'),
      })
    ).toHaveLength(0);
  });

  test('the route shows Model lists until the server says it has none, then the live-lists page', () => {
    const route = () =>
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          null,
          createElement(ModelListsRoute, {
            fallback: createElement('p', null, 'old live-lists page'),
          })
        )
      );
    // Before any probe the new page renders, and its own load reports a 404 if the server has none.
    expect(route()).toContain('Model lists');
    expect(route()).not.toContain('old live-lists page');
    expect(modelListsPageFor('unknown')).toBe('model-lists');
    expect(modelListsPageFor('probing')).toBe('model-lists');
    expect(modelListsPageFor('ready')).toBe('model-lists');
    expect(modelListsPageFor('error')).toBe('model-lists');
    expect(modelListsPageFor('unsupported')).toBe('live-lists');
    expect(useProvimuxPresence.getState().modelLists.status).toBe('unknown');
  });
});

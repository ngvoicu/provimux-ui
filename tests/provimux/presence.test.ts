// Hide on 404 (05-console-contract.md, section 2): a Provimux page exists while its endpoint answers, and is
// shown with its error on anything else; a 404 (stock CLIProxyAPI, an older Provimux) removes it.
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { apiClient } from '../../src/services/api/client';
import { ProvimuxPageGate } from '../../src/provimux/components/ProvimuxPageGate';
import { ProvimuxOpenRouterTag } from '../../src/provimux/components/ProvimuxOpenRouterTag';
import { PROVIMUX_PAGES, provimuxNav } from '../../src/provimux/nav';
import {
  isListed,
  isProvimuxServer,
  presenceOf,
  useProvimuxPresence,
  type PresenceEntry,
  type PresenceStatus,
} from '../../src/provimux/presence';

const read = (path: string) => readFileSync(path, 'utf8');
const apiError = (status: number | undefined, message = `HTTP ${status}`) =>
  Object.assign(new Error(message), { name: 'ApiError', status });
const entry = (status: PresenceStatus): PresenceEntry => ({ status, message: null });
// Probes run through apiClient.captureConnection(), a fresh client per connection: spy on the class.
const clientClass = Object.getPrototypeOf(apiClient) as typeof apiClient;

afterEach(() => {
  useProvimuxPresence.getState().reset();
});

describe('what an answer means', () => {
  test('200 shows, 404 hides, anything else shows the error', () => {
    expect(presenceOf({})).toEqual({ status: 'ready', message: null });
    expect(presenceOf({ error: apiError(404) })).toEqual({ status: 'unsupported', message: null });
    expect(presenceOf({ error: apiError(503, 'live-list status unavailable') })).toEqual({
      status: 'error',
      message: 'live-list status unavailable',
    });
    expect(presenceOf({ error: apiError(403, 'remote management disabled') }).status).toBe('error');
    // No answer at all (a restarting server) never hides the page.
    expect(presenceOf({ error: new Error('Network Error') }).status).toBe('error');
  });

  test('listed while ready or failing, not while absent or unknown', () => {
    expect(isListed(entry('ready'))).toBe(true);
    expect(isListed(entry('error'))).toBe(true);
    expect(isListed(entry('unsupported'))).toBe(false);
    expect(isListed(entry('probing'))).toBe(false);
    expect(isListed(entry('unknown'))).toBe(false);
  });
});

describe('probes', () => {
  test('stock CLIProxyAPI: every endpoint answers 404, every page is absent', async () => {
    const get = spyOn(clientClass, 'get').mockRejectedValue(apiError(404));
    try {
      await useProvimuxPresence.getState().probe('1|http://cpa|8.0.78');
      const state = useProvimuxPresence.getState();
      expect(state.modelRoutes.status).toBe('unsupported');
      expect(state.liveLists.status).toBe('unsupported');
      expect(state.savings.status).toBe('unsupported');
      expect(isProvimuxServer(state)).toBe(false);
      expect(get.mock.calls.map((call) => call[0]).sort()).toEqual([
        '/provimux/live-lists',
        '/provimux/model-routes?model=',
        '/provimux/savings?period=today',
      ]);
    } finally {
      get.mockRestore();
    }
  });

  test('Provimux: each endpoint on its own, once per connection', async () => {
    const get = spyOn(clientClass, 'get').mockImplementation(async (url: string) => {
      if (url.startsWith('/provimux/live-lists'))
        throw apiError(503, 'live-list status unavailable');
      return { observed_at: null, models: [] };
    });
    try {
      const presence = useProvimuxPresence.getState();
      await presence.probe('1|http://pmx|8.0.78-pmx.2');
      await presence.probe('1|http://pmx|8.0.78-pmx.2');
      const state = useProvimuxPresence.getState();
      expect(state.modelRoutes.status).toBe('ready');
      expect(state.liveLists).toEqual({ status: 'error', message: 'live-list status unavailable' });
      expect(state.savings.status).toBe('ready');
      expect(isProvimuxServer(state)).toBe(true);
      expect(get).toHaveBeenCalledTimes(3);
    } finally {
      get.mockRestore();
    }
  });

  test('a probe for an earlier connection does not land on the next one', async () => {
    const pending: Array<(value: unknown) => void> = [];
    const get = spyOn(clientClass, 'get').mockImplementation(
      () => new Promise((resolve) => pending.push(resolve))
    );
    try {
      const presence = useProvimuxPresence.getState();
      const first = presence.probe('1|http://old|8.0.78-pmx.1');
      presence.reset();
      pending.forEach((resolve) => resolve({ observed_at: null, models: [], logins: [] }));
      await first;
      expect(useProvimuxPresence.getState().modelRoutes.status).toBe('unknown');
    } finally {
      get.mockRestore();
    }
  });

  test("a page's own load reports back: a later 404 hides it, a success shows it", async () => {
    const get = spyOn(clientClass, 'get').mockResolvedValue({
      observed_at: null,
      models: [],
      logins: [],
    });
    try {
      const presence = useProvimuxPresence.getState();
      await presence.probe('2|http://pmx|8.0.78-pmx.2');
      presence.report('modelRoutes', { error: apiError(404) });
      expect(useProvimuxPresence.getState().modelRoutes.status).toBe('unsupported');
      presence.report('modelRoutes', {});
      expect(useProvimuxPresence.getState().modelRoutes.status).toBe('ready');
    } finally {
      get.mockRestore();
    }
  });
});

describe('Savings presence', () => {
  test('404 hides the page and its nav item; 503 and a network error keep it, with the error; a later 200 clears it', async () => {
    const get = spyOn(clientClass, 'get').mockImplementation(async (url: string) => {
      if (url.startsWith('/provimux/savings')) throw apiError(404);
      return { observed_at: null, models: [], logins: [] };
    });
    try {
      const presence = useProvimuxPresence.getState();
      await presence.probe('3|http://pmx|8.0.80-pmx.1');
      expect(useProvimuxPresence.getState().savings.status).toBe('unsupported');
      const hidden = provimuxNav([{ id: 'gateway', items: [{ path: '/routing' }] }], {
        modelRoutes: entry('ready'),
        liveLists: entry('ready'),
        savings: useProvimuxPresence.getState().savings,
      });
      expect(hidden[0].items.map((item) => (item as { path: string }).path)).not.toContain(
        '/provimux/savings'
      );

      presence.report('savings', { error: apiError(503, 'savings store unavailable') });
      expect(useProvimuxPresence.getState().savings).toEqual({
        status: 'error',
        message: 'savings store unavailable',
      });
      presence.report('savings', { error: new Error('Network Error') });
      expect(useProvimuxPresence.getState().savings).toEqual({
        status: 'error',
        message: 'Network Error',
      });
      expect(isListed(useProvimuxPresence.getState().savings)).toBe(true);
      presence.report('savings', {});
      expect(useProvimuxPresence.getState().savings).toEqual({ status: 'ready', message: null });
    } finally {
      get.mockRestore();
    }
  });
});

describe('sidebar', () => {
  const groups = () => [
    { id: 'operate', items: [{ path: '/' }, { path: '/quick-start' }] },
    { id: 'gateway', items: [{ path: '/ai-providers' }, { path: '/routing' }, { path: '/later' }] },
    { id: 'control', items: [{ path: '/system' }] },
  ];
  const paths = (list: ReturnType<typeof groups>) =>
    list.map((group) => group.items.map((item) => (item as { path: string }).path));

  test('pages go after Routing, Aliases first, the others where their endpoint answers or fails', () => {
    const result = provimuxNav(groups(), {
      modelRoutes: entry('ready'),
      liveLists: entry('error'),
      savings: entry('ready'),
    });
    expect(paths(result)).toEqual([
      ['/'],
      [
        '/ai-providers',
        '/routing',
        '/provimux/aliases',
        '/provimux/model-routes',
        '/provimux/live-lists',
        '/provimux/savings',
        '/later',
      ],
      ['/system'],
    ]);
    const item = result[1].items[3] as { labelKey: string; metaKey: string };
    expect(item.labelKey).toBe('provimux.nav.model_routes');
    expect(item.metaKey).toBe('provimux.nav_meta.model_routes');
    const aliases = result[1].items[2] as { labelKey: string; metaKey: string };
    expect(aliases.labelKey).toBe('provimux.nav.aliases');
    expect(aliases.metaKey).toBe('provimux.nav_meta.aliases');
  });

  test('absent (404) or not yet probed: no item but Aliases, which needs no endpoint; Quick Start stays hidden', () => {
    for (const status of ['unsupported', 'unknown', 'probing'] as const) {
      const result = provimuxNav(groups(), {
        modelRoutes: entry(status),
        liveLists: entry(status),
        savings: entry(status),
      });
      expect(paths(result)).toEqual([
        ['/'],
        ['/ai-providers', '/routing', '/provimux/aliases', '/later'],
        ['/system'],
      ]);
    }
    const one = provimuxNav(groups(), {
      modelRoutes: entry('unsupported'),
      liveLists: entry('ready'),
      savings: entry('unsupported'),
    });
    expect(paths(one)[1]).toEqual([
      '/ai-providers',
      '/routing',
      '/provimux/aliases',
      '/provimux/live-lists',
      '/later',
    ]);
    // An older presence record that knows no endpoint at all still lists Aliases (F-5).
    expect(paths(provimuxNav(groups(), {}))[1]).toEqual([
      '/ai-providers',
      '/routing',
      '/provimux/aliases',
      '/later',
    ]);
  });

  test('every page has a route, and the routes table carries them', () => {
    const routes = read('src/provimux/routes.tsx');
    for (const page of PROVIMUX_PAGES) expect(routes).toContain(`path: '${page.path}'`);
  });
});

// Server rendering reads a zustand store's initial state (its server snapshot), not setState: give the initial
// state object the values under test for one render, then put it back.
const withPresence = <T>(
  state: Partial<
    Pick<ReturnType<typeof useProvimuxPresence.getState>, 'modelRoutes' | 'liveLists' | 'savings'>
  >,
  render: () => T
): T => {
  const initial = useProvimuxPresence.getInitialState();
  const saved = {
    key: initial.key,
    modelRoutes: initial.modelRoutes,
    liveLists: initial.liveLists,
    savings: initial.savings,
  };
  Object.assign(initial, { key: 'k', ...state });
  try {
    return render();
  } finally {
    Object.assign(initial, saved);
  }
};

describe('route gate', () => {
  const render = (status: PresenceStatus) =>
    withPresence({ modelRoutes: entry(status) }, () =>
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          { initialEntries: ['/provimux/model-routes'] },
          createElement(ProvimuxPageGate, {
            endpoint: 'modelRoutes',
            children: createElement('h1', null, 'Model routes'),
          })
        )
      )
    );

  test('a page whose endpoint answered 404 is not rendered (it redirects to the dashboard)', () => {
    expect(render('unsupported')).not.toContain('Model routes');
  });

  test('ready, failing and still probing pages render (the page shows its own state)', () => {
    for (const status of ['ready', 'error', 'probing', 'unknown'] as const) {
      expect(render(status)).toContain('<h1>Model routes</h1>');
    }
  });
});

describe('OpenRouter tag on AI Providers', () => {
  const render = (baseUrl: string, provimux: boolean) =>
    withPresence(
      {
        modelRoutes: entry(provimux ? 'ready' : 'unsupported'),
        liveLists: entry(provimux ? 'ready' : 'unsupported'),
      },
      () =>
        renderToStaticMarkup(
          createElement(MemoryRouter, null, createElement(ProvimuxOpenRouterTag, { baseUrl }))
        )
    );

  test('only for an entry on openrouter.ai, and only on a server with the endpoints', () => {
    expect(render('https://openrouter.ai/api/v1', true)).toContain(
      'href="/provimux/model-routes?provider=openrouter"'
    );
    expect(render('https://openrouter.ai/api/v1', false)).toBe('');
    expect(render('https://llm.lab.example/v1', true)).toBe('');
    expect(render('https://openrouter.ai.evil.example/v1', true)).toBe('');
  });
});

describe('seams', () => {
  test('one line each in upstream files', () => {
    expect(read('src/components/layout/MainLayout.tsx')).toMatch(
      /\];\n {2}provimuxNav\(navGroups, useProvimuxPages\(\)\);\n {2}const navItems = navGroups/
    );
    expect(read('src/router/MainRoutes.tsx')).toMatch(
      /\{ path: '\/quota', element: <QuotaPage \/> \},\n {2}\.\.\.PROVIMUX_ROUTES,\n/
    );
    expect(read('src/features/providers/components/ProviderResourceTable.tsx')).toContain(
      '<ProvimuxOpenRouterTag baseUrl={r.baseUrl} />'
    );
  });
});

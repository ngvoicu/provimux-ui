// Regressions for the critical review T-74 (PUI-17) of the Provimux pages, one block per finding. Where the old code
// had the same entry point, the test calls it the same way, so it fails on 68e1c60b and passes now. The refresh
// follow-up (finding 1) and the update source (finding 3) have their own files: refreshFollower.test.ts and
// consoleSource.test.ts.
import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { apiClient } from '../../src/services/api/client';
import { provimuxApi } from '../../src/provimux/api/provimuxApi';
import { readModelRoutes } from '../../src/provimux/api/normalize';
import type { ProvimuxLiveListLogin, ProvimuxModel } from '../../src/provimux/api/types';
import { ProvimuxOpenRouterTag } from '../../src/provimux/components/ProvimuxOpenRouterTag';
import { failureHint, liveSummary } from '../../src/provimux/pages/liveLists/logic';
import { DevinCoolingCard } from '../../src/provimux/pages/modelRoutes/DevinCoolingCard';
import { ModelCard } from '../../src/provimux/pages/modelRoutes/ModelCard';
import { useProvimuxResource } from '../../src/provimux/pages/shared/useProvimuxResource';
import { useProvimuxPresence, type PresenceStatus } from '../../src/provimux/presence';

const read = (path: string) => readFileSync(path, 'utf8');
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const apiError = (status: number, data?: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    name: 'ApiError',
    status,
    data,
  });

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});
afterEach(() => {
  useProvimuxPresence.getState().reset();
});

// Server rendering reads a zustand store's initial state: give it the values under test for one render.
function withPresence<T>(
  state: { modelRoutes: PresenceStatus; liveLists: PresenceStatus },
  render: () => T
): T {
  const initial = useProvimuxPresence.getInitialState();
  const saved = {
    key: initial.key,
    modelRoutes: initial.modelRoutes,
    liveLists: initial.liveLists,
  };
  Object.assign(initial, {
    key: 'k',
    modelRoutes: { status: state.modelRoutes, message: null },
    liveLists: { status: state.liveLists, message: null },
  });
  try {
    return render();
  } finally {
    Object.assign(initial, saved);
  }
}

describe('2. a catalog failure does not stop the refresh', () => {
  test("Provimux's 502 (unreadable catalog) resolves with the catalog's error: the logins are being asked", async () => {
    // The body Provimux sends (model_definitions.go): the fetcher was woken before this answer.
    const body = {
      ok: false,
      error: 'no valid model catalog source',
      catalog: '/tmp/unavailable-catalog.json',
      catalogs: { catalog: { refreshed: false, error: 'no valid model catalog source' } },
      sources: { catalog: '/tmp/unavailable-catalog.json' },
      changed_providers: [],
    };
    const post = spyOn(apiClient, 'post').mockRejectedValue(apiError(502, body));
    try {
      expect(await provimuxApi.refreshModels()).toEqual({
        catalogError: 'no valid model catalog source',
      });
    } finally {
      post.mockRestore();
    }
  });

  test('anything else that fails started nothing and still rejects', async () => {
    const post = spyOn(apiClient, 'post');
    try {
      post.mockRejectedValueOnce(apiError(400, { ok: false, error: 'invalid catalog source' }));
      await expect(provimuxApi.refreshModels()).rejects.toThrow();
      post.mockRejectedValueOnce(apiError(502, '<html>Bad Gateway</html>'));
      await expect(provimuxApi.refreshModels()).rejects.toThrow();
      post.mockResolvedValueOnce({ ok: true });
      expect(await provimuxApi.refreshModels()).toEqual({ catalogError: null });
    } finally {
      post.mockRestore();
    }
  });

  test('the page reports it and keeps following the logins', () => {
    const page = read('src/provimux/pages/liveLists/LiveListsPage.tsx');
    expect(page).toContain("t('provimux.live.catalog_failed'");
    expect(page).toMatch(/\(\{ catalogError \} = await provimuxApi\.refreshModels\(\)\);/);
    expect(page).toContain('followRefresh({');
  });
});

describe('4. Refresh on Model routes reads the Devin switch again', () => {
  test('a manual refresh runs the page loader and what the page reads beside it, together', async () => {
    const fetcher = async () => ({ observed_at: null, models: [] });
    let fetched = 0;
    let alsoRead = 0;
    let captured: { refresh?: () => Promise<void> } = {};
    function Probe() {
      captured = useProvimuxResource(
        'modelRoutes',
        async () => {
          fetched += 1;
          return fetcher();
        },
        null,
        async () => {
          alsoRead += 1;
        }
      ) as { refresh?: () => Promise<void> };
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(typeof captured.refresh).toBe('function');
    await captured.refresh!();
    expect([fetched, alsoRead]).toEqual([1, 1]);
  });

  test('Model routes passes the Devin read to it, and its button and the header use it', () => {
    const page = read('src/provimux/pages/modelRoutes/ModelRoutesPage.tsx');
    expect(page).toContain("useProvimuxResource('modelRoutes', fetchRoutes, POLL_MS, devin.read)");
    expect(page).toContain('onClick={() => void resource.refresh()}');
    expect(page).not.toContain('onClick={() => void resource.load()}');
  });
});

describe('5. a Devin login without routes is not "no login"', () => {
  const devin = (logins: { enabled: number; disabled: number } | null) => ({
    value: false,
    readError: null,
    logins,
    saving: false,
    read: async () => undefined,
    set: async () => ({ ok: true as const }),
  });
  const render = (logins: { enabled: number; disabled: number } | null) =>
    text(
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          null,
          createElement(DevinCoolingCard, {
            models: [] as ProvimuxModel[],
            offsetMs: 0,
            nowMs: 0,
            devin: devin(logins),
            onChanged: () => undefined,
          })
        )
      )
    );

  test('an enabled login whose models are all excluded: no registered routes, not "add one"', async () => {
    await i18n.changeLanguage('en');
    const card = render({ enabled: 1, disabled: 0 });
    expect(card).toContain('No registered Devin routes');
    expect(card).toContain('Check it on Auth Files');
    expect(card).not.toContain('add one');
  });

  test('a disabled login, and a list that could not be read, say no routes too', async () => {
    await i18n.changeLanguage('en');
    expect(render({ enabled: 0, disabled: 1 })).toContain('the Devin login is disabled');
    expect(render(null)).toContain('No registered Devin routes');
    expect(render(null)).not.toContain('add one');
  });

  test('only an empty credentials list says no Devin login', async () => {
    await i18n.changeLanguage('en');
    expect(render({ enabled: 0, disabled: 0 })).toContain(
      'No Devin login. The switch applies when you add one.'
    );
  });

  test('the credentials list is read with the switch', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({
      files: [
        { name: 'devin-a.json', provider: 'devin', disabled: false },
        { name: 'devin-b.json', type: 'devin', disabled: true },
        { name: 'claude.json', provider: 'claude' },
      ],
    });
    try {
      expect(await provimuxApi.devinLogins()).toEqual({ enabled: 1, disabled: 1 });
      expect(get).toHaveBeenCalledWith('/credentials');
    } finally {
      get.mockRestore();
    }
  });
});

describe('6. a provider 403 is not "sign in again"', () => {
  test('401 asks to sign in; 403 says access was denied', async () => {
    await i18n.changeLanguage('en');
    expect(failureHint({ category: 'http_status', http_status: 401 })).toBe('signin');
    expect(failureHint({ category: 'http_status', http_status: 403 })).toBe('denied');
    expect(i18n.t('provimux.live.hint.denied')).toContain('denied');
    expect(i18n.t('provimux.live.hint.denied')).not.toMatch(/sign it in again/);
  });
});

describe('7. unknown values stay unknown', () => {
  const row = (source: string): ProvimuxLiveListLogin => ({
    auth_index: 'a',
    provider: 'claude',
    login: { name: 'a.json', email: null, label: null },
    disabled: false,
    source,
    fetching: false,
    fetched_at: null,
    listed_models: null,
    registered_models: 1,
    last_failure: null,
  });

  test('a source this console does not know is not counted as catalog', () => {
    const summary = liveSummary([row('federated'), row('catalog')]) as { catalog: number };
    expect(summary.catalog).toBe(1);
    expect(summary).toMatchObject({ unknown: 1 });
  });

  test('a missing priority is not priority 0', () => {
    const answer = readModelRoutes({
      models: [{ id: 'm', routes: [{ provider: 'claude' }, { provider: 'codex', priority: -5 }] }],
    });
    expect(answer.models[0].routes.map((route) => route.priority)).toEqual([null, -5]);
  });

  test('an unknown live-lists switch is not described as on', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('provimux.live.unknown_text')).not.toMatch(/^On/);
    const page = read('src/provimux/pages/liveLists/LiveListsPage.tsx');
    expect(page).toContain("t('provimux.live.unknown_text')");
  });
});

describe('8. the OpenRouter tag only where Model routes exists', () => {
  test('a server with live lists but no model routes: no tag (it would land on the dashboard)', () => {
    const tag = (state: { modelRoutes: PresenceStatus; liveLists: PresenceStatus }) =>
      withPresence(state, () =>
        renderToStaticMarkup(
          createElement(
            MemoryRouter,
            null,
            createElement(ProvimuxOpenRouterTag, { baseUrl: 'https://openrouter.ai/api/v1' })
          )
        )
      );
    expect(tag({ modelRoutes: 'unsupported', liveLists: 'ready' })).toBe('');
    expect(tag({ modelRoutes: 'error', liveLists: 'ready' })).toBe('');
    expect(tag({ modelRoutes: 'ready', liveLists: 'unsupported' })).toContain(
      'href="/provimux/model-routes?provider=openrouter"'
    );
  });
});

describe('9. a route links to its login on Auth Files', () => {
  test('a login the credentials page lists opens it there; a key does not pretend to', async () => {
    await i18n.changeLanguage('en');
    const model = readModelRoutes(
      JSON.parse(read('tests/provimux/fixtures/model-routes.json'))
    ).models.find((candidate) => candidate.id === 'claude-opus-5-5')!;
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(ModelCard, { model, offsetMs: 0, nowMs: 0 }))
    );
    expect(html).toContain(
      'title="Open claude-ada@example.com.json on Auth Files (auth_index a8d167b7d82c8c15)"'
    );
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

describe('10. the priority wording', () => {
  test('higher priority first only among the routes that can serve a new request', async () => {
    await i18n.changeLanguage('en');
    const note = i18n.t('provimux.routes.note');
    expect(note).toContain('Among the routes that can serve a new request');
    expect(note).toContain('a session already on a route may stay there');
  });
});

describe('11. a fresh event never reads as in the future', () => {
  test('the time on screen is never older than the answer on screen', async () => {
    const { screenNow } = (await import('../../src/provimux/pages/time')) as {
      screenNow?: (clock: number, loadedAt: number | null, offset: number) => number;
    };
    expect(typeof screenNow).toBe('function');
    // Page clock ticked at 10:00:00; the answer arrived at 10:00:12 with an event at 10:00:09.
    expect(
      screenNow!(Date.parse('2026-11-19T10:00:00Z'), Date.parse('2026-11-19T10:00:12Z'), 0)
    ).toBe(Date.parse('2026-11-19T10:00:12Z'));
  });
});

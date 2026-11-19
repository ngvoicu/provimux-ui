// Provimux's console endpoints (PUI-15/16): the API clients and how answers are read.
// Fixtures: the contract's example responses, Provimux main 8b943f74,
// .github/provimux/design/pui13/examples/{model-routes,live-lists}.json, copied verbatim.
import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiClient } from '../../src/services/api/client';
import { PROVIMUX_PATHS, errorStatus, provimuxApi } from '../../src/provimux/api/provimuxApi';
import { readLiveLists, readModelRoutes } from '../../src/provimux/api/normalize';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/${name}.json`, 'utf8'));

const apiError = (status: number | undefined, message = `HTTP ${status}`) =>
  Object.assign(new Error(message), { name: 'ApiError', status });

describe('API clients', () => {
  test('model routes: the whole list, a narrowed one, and the cheap probe', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue(fixture('model-routes'));
    try {
      const all = await provimuxApi.modelRoutes();
      expect(get).toHaveBeenLastCalledWith('/provimux/model-routes');
      expect(all.models.map((model) => model.id)).toEqual([
        'anthropic/claude-opus-5.5',
        'claude-opus-5-5',
        'devin-opus-5-5',
        'gpt-6.1-terra',
      ]);

      // The contract's repeatable parameter, not axios's model[]=
      await provimuxApi.modelRoutes(apiClient, ['claude-opus-5-5', 'anthropic/claude-opus-5.5']);
      expect(get).toHaveBeenLastCalledWith(
        '/provimux/model-routes?model=claude-opus-5-5&model=anthropic%2Fclaude-opus-5.5'
      );

      await provimuxApi.probeModelRoutes();
      expect(get).toHaveBeenLastCalledWith('/provimux/model-routes?model=');
    } finally {
      get.mockRestore();
    }
  });

  test('live lists, the refresh and the switch use the paths upstream and Provimux define', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue(fixture('live-lists'));
    const post = spyOn(apiClient, 'post').mockResolvedValue({ changed_providers: null });
    const put = spyOn(apiClient, 'put').mockResolvedValue({ status: 'ok' });
    try {
      const lists = await provimuxApi.liveLists();
      expect(get).toHaveBeenLastCalledWith('/provimux/live-lists');
      expect(lists.enabled).toBe(true);
      expect(lists.logins).toHaveLength(5);

      await provimuxApi.refreshModels();
      expect(post).toHaveBeenCalledWith('/models/refresh');

      await provimuxApi.setLiveLists(false);
      expect(put).toHaveBeenLastCalledWith('/config/models/live-lists', false);

      await provimuxApi.setDevinModelLevelCooling(true);
      expect(put).toHaveBeenLastCalledWith(
        '/config/oauth/providers/devin/model-level-cooling',
        true
      );
    } finally {
      get.mockRestore();
      post.mockRestore();
      put.mockRestore();
    }
  });

  test('a config key the file does not set (404) reads as unset; other errors are thrown', async () => {
    const get = spyOn(apiClient, 'get');
    try {
      get.mockResolvedValueOnce(true);
      expect(await provimuxApi.devinModelLevelCooling()).toBe(true);
      expect(get).toHaveBeenLastCalledWith(PROVIMUX_PATHS.devinModelLevelCooling);

      get.mockRejectedValueOnce(apiError(404));
      expect(await provimuxApi.devinModelLevelCooling()).toBeNull();

      get.mockRejectedValueOnce(apiError(500, 'read_failed'));
      await expect(provimuxApi.devinModelLevelCooling()).rejects.toThrow('read_failed');
    } finally {
      get.mockRestore();
    }
  });

  test('the console source comes from the management section', async () => {
    const get = spyOn(apiClient, 'get');
    try {
      get.mockResolvedValueOnce({
        'panel-github-repository': ' https://github.com/ngvoicu/provimux-ui ',
        'disable-auto-update-panel': true,
        'secret-key': '$2a$…',
      });
      expect(await provimuxApi.consoleSource()).toEqual({
        repository: 'https://github.com/ngvoicu/provimux-ui',
        autoUpdateOff: true,
      });
      expect(get).toHaveBeenLastCalledWith('/config/management');

      get.mockRejectedValueOnce(apiError(404));
      expect(await provimuxApi.consoleSource()).toEqual({ repository: null, autoUpdateOff: null });
    } finally {
      get.mockRestore();
    }
  });

  test('errorStatus reads the status an apiClient error carries', () => {
    expect(errorStatus(apiError(404))).toBe(404);
    expect(errorStatus(new Error('network'))).toBeNull();
    expect(errorStatus('nope')).toBeNull();
  });
});

describe('reading answers (05-console-contract.md, section 4)', () => {
  test('the example model routes, with fractions of a second kept', () => {
    const answer = readModelRoutes(fixture('model-routes'));
    expect(answer.observed_at).toBe('2026-11-19T18:04:11.482Z');
    const opus = answer.models.find((model) => model.id === 'claude-opus-5-5')!;
    expect(opus.limits).toEqual({ context: 200000, output: 64000 });
    expect(opus.routes.map((route) => [route.kind, route.priority, route.host])).toEqual([
      ['oauth', 10, null],
      ['apikey', 0, 'api.anthropic.com'],
    ]);
    expect(opus.routes[0].login).toEqual({
      name: 'claude-ada@example.com.json',
      email: 'ada@example.com',
      label: 'ada@example.com',
    });
    expect(opus.routes[1].recorded_cooldown).toEqual({
      scope: 'model',
      model: 'claude-opus-5-5',
      reason: 'quota',
      until: '2026-11-19T18:31:00.731Z',
      http_status: 429,
      backoff_level: 2,
    });
    expect(Date.parse(opus.routes[1].recorded_cooldown!.until) % 1000).toBe(731);
    const terra = answer.models.find((model) => model.id === 'gpt-6.1-terra')!;
    expect(terra.limits.context).toBeNull();
    expect(terra.routes[1].reasoning).toBeNull();
  });

  test('unknown fields are ignored, missing ones are null, unknown enum values are kept', () => {
    const answer = readModelRoutes({
      observed_at: '2026-11-19T18:04:11.5Z',
      future_field: { x: 1 },
      models: [
        {
          id: 'm',
          routes: [
            {
              provider: 'claude',
              kind: 'sponsored',
              priority: 3,
              available: true,
              recorded_cooldown: {
                scope: 'region',
                reason: 'solar_flare',
                until: '2026-11-19T19:00:00Z',
              },
            },
            {
              provider: 'codex',
              recorded_cooldown: { scope: 'model', reason: 'quota', until: 'tomorrow' },
            },
          ],
        },
        { display_name: 'no id: left out' },
        'garbage',
      ],
    });
    expect(answer.models).toHaveLength(1);
    const [first, second] = answer.models[0].routes;
    expect(answer.models[0]).toMatchObject({ display_name: null, owned_by: null });
    expect(answer.models[0].limits).toEqual({ context: null, output: null });
    expect(first).toMatchObject({ kind: 'sponsored', priority: 3, host: null, auth_index: null });
    expect(first).not.toHaveProperty('available');
    expect(first.login).toEqual({ name: null, email: null, label: null });
    expect(first.recorded_cooldown).toMatchObject({
      scope: 'region',
      reason: 'solar_flare',
      model: null,
      http_status: null,
    });
    // A cooldown without a usable time is not shown as one.
    expect(second.recorded_cooldown).toBeNull();
    // Not reported: unknown, never priority 0 (T-74, finding 7).
    expect(second.priority).toBeNull();
  });

  test('the example live lists', () => {
    const answer = readLiveLists(fixture('live-lists'));
    expect(answer.providers).toEqual(['claude', 'codex', 'meta']);
    const grace = answer.logins[1];
    expect(grace).toMatchObject({ source: 'live', fetching: false, listed_models: 11 });
    expect(grace.last_failure).toEqual({
      at: '2026-11-19T18:02:20.207Z',
      category: 'http_status',
      http_status: 529,
    });
    expect(answer.logins[4]).toMatchObject({ provider: 'meta', fetching: true, fetched_at: null });
    expect(answer.logins[3].disabled).toBe(true);
  });

  test('a live-lists answer from a newer or broken server degrades to unknowns', () => {
    const answer = readLiveLists({
      logins: [{ provider: 'claude', source: 'mirror', last_failure: { category: 'network' } }],
    });
    expect(answer.enabled).toBeNull();
    expect(answer.observed_at).toBeNull();
    expect(answer.logins[0]).toMatchObject({
      source: 'mirror',
      disabled: false,
      fetching: false,
      registered_models: null,
      last_failure: null,
    });
  });
});

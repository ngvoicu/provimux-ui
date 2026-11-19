// Provimux's pages (PUI-15/16): what they derive from the endpoints, and their wording.
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../../src/i18n/index';
import { readLiveLists, readModelRoutes } from '../../src/provimux/api/normalize';
import type { ProvimuxLiveListLogin } from '../../src/provimux/api/types';
import {
  describeConsoleBuild,
  describeConsoleSource,
  githubRepositoryOf,
} from '../../src/provimux/consoleSource';
import {
  failureHint,
  liveRowState,
  liveSummary,
  refreshProgress,
} from '../../src/provimux/pages/liveLists/logic';
import { ModelCard } from '../../src/provimux/pages/modelRoutes/ModelCard';
import {
  devinState,
  filterModels,
  isCoolingAt,
  loginText,
  openRouterEntries,
  providerCounts,
  providerKeyOf,
  summarize,
  tiersOf,
} from '../../src/provimux/pages/modelRoutes/logic';
import { clockOffset, formatDuration, serverNow } from '../../src/provimux/pages/time';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/${name}.json`, 'utf8'));
const routes = readModelRoutes(fixture('model-routes'));
const lists = readLiveLists(fixture('live-lists'));
const at = (iso: string) => Date.parse(iso);
const OBSERVED = at('2026-11-19T18:04:11.482Z');

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

describe('model routes', () => {
  test('routes stand in priority tiers, highest first; a tier holds routes that share a priority', () => {
    const opus = routes.models.find((model) => model.id === 'claude-opus-5-5')!;
    expect(tiersOf(opus.routes).map((tier) => [tier.priority, tier.routes.length])).toEqual([
      [10, 1],
      [0, 1],
    ]);
    const shuffled = [opus.routes[1], opus.routes[0], { ...opus.routes[0], auth_index: 'x' }];
    expect(tiersOf(shuffled).map((tier) => [tier.priority, tier.routes.length])).toEqual([
      [10, 2],
      [0, 1],
    ]);
  });

  test('cooldowns are compared as times, fractions of a second included', () => {
    const cooldown = routes.models[1].routes[1].recorded_cooldown;
    expect(isCoolingAt(cooldown, at('2026-11-19T18:31:00.730Z'))).toBe(true);
    expect(isCoolingAt(cooldown, at('2026-11-19T18:31:00.731Z'))).toBe(false);
    expect(isCoolingAt(null, OBSERVED)).toBe(false);
  });

  test('a countdown runs on the server clock', () => {
    // The answer arrived when the browser read 18:04:01.482: the browser is 10 s behind the server.
    const offset = clockOffset('2026-11-19T18:04:11.482Z', at('2026-11-19T18:04:01.482Z'));
    expect(offset).toBe(10_000);
    const until = at('2026-11-19T18:31:00.731Z');
    expect(formatDuration(until - serverNow(at('2026-11-19T18:04:01.482Z'), offset))).toBe(
      '26 min'
    );
    expect(formatDuration(95_200)).toBe('1 min 36 s');
    expect(formatDuration(44_100)).toBe('45 s');
    expect(formatDuration(3_900_000)).toBe('1 h 05 min');
    expect(clockOffset(null, 5)).toBe(0);
  });

  test('summary, provider filter and views', () => {
    expect(summarize(routes.models, OBSERVED)).toEqual({
      models: 4,
      subscriptions: 3,
      apiKeys: 3,
      cooldowns: 2,
    });
    // Once both recorded cooldowns ended, none counts.
    expect(summarize(routes.models, at('2026-11-19T19:00:00.731Z')).cooldowns).toBe(0);
    expect(providerCounts(routes.models)).toEqual([
      { key: 'claude', count: 1 },
      { key: 'codex', count: 1 },
      { key: 'devin', count: 1 },
      { key: 'openai-compatible-lab', count: 1 },
      { key: 'openrouter', count: 1 },
    ]);
    const ids = (filter: Parameters<typeof filterModels>[1]) =>
      filterModels(routes.models, filter, OBSERVED).map((model) => model.id);
    expect(ids({ query: '', provider: 'openrouter', view: 'all' })).toEqual([
      'anthropic/claude-opus-5.5',
    ]);
    expect(ids({ query: '', provider: 'all', view: 'cooldown' })).toEqual([
      'claude-opus-5-5',
      'devin-opus-5-5',
    ]);
    expect(ids({ query: '', provider: 'all', view: 'several' })).toEqual([
      'claude-opus-5-5',
      'gpt-6.1-terra',
    ]);
    expect(ids({ query: 'llm.lab', provider: 'all', view: 'all' })).toEqual(['gpt-6.1-terra']);
    expect(ids({ query: 'ADA codex', provider: 'all', view: 'all' })).toEqual(['gpt-6.1-terra']);
  });

  test('an OpenRouter entry is OpenRouter whatever its name', () => {
    expect(providerKeyOf({ provider: 'openai-compatible-my-router', host: 'openrouter.ai' })).toBe(
      'openrouter'
    );
    expect(providerKeyOf({ provider: 'openai-compatible-lab', host: 'llm.lab.example' })).toBe(
      'openai-compatible-lab'
    );
    const entries = openRouterEntries([
      { name: 'my-router', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEntries: [] },
      { name: 'eu', baseUrl: 'https://eu.openrouter.ai/api/v1', apiKeyEntries: [] },
      { name: 'lab', baseUrl: 'https://llm.lab.example/v1', apiKeyEntries: [] },
      { name: 'fake', baseUrl: 'https://openrouter.ai.example/v1', apiKeyEntries: [] },
    ]);
    expect(entries.map((entry) => entry.name)).toEqual(['my-router', 'eu']);
  });

  test('a login is named as the credentials page names it; a key by its host and label', () => {
    const [oauth, key] = routes.models[1].routes;
    expect(loginText(oauth)).toEqual({
      primary: 'ada@example.com',
      secondary: 'claude-ada@example.com.json',
    });
    expect(loginText(key)).toEqual({ primary: 'api.anthropic.com', secondary: 'claude-apikey' });
    expect(
      loginText({ kind: 'oauth', host: null, login: { name: null, email: null, label: null } })
    ).toEqual({ primary: null, secondary: null });
  });

  test('Devin: its logins and the cooldowns recorded on them', () => {
    const state = devinState(routes.models, OBSERVED);
    expect(state.logins).toBe(1);
    expect(state.cooling.map(({ model }) => model.id)).toEqual(['devin-opus-5-5']);
    expect(devinState(routes.models, at('2026-11-19T19:00:01Z')).cooling).toEqual([]);
  });

  test('a model card says what clients are told, the tiers, and a cooldown as a record', async () => {
    await i18n.changeLanguage('en');
    const opus = routes.models.find((model) => model.id === 'claude-opus-5-5')!;
    const html = renderToStaticMarkup(
      createElement(ModelCard, { model: opus, offsetMs: 0, nowMs: OBSERVED })
    );
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Clients are told');
    expect(text).toContain('Subscription');
    expect(text).toContain('API key');
    expect(text).toContain('ada@example.com');
    expect(text).toContain('api.anthropic.com');
    expect(text).toContain('Cooldown recorded until');
    expect(text).toContain('quota · HTTP 429 · this model · backoff level 2');
    expect(html).toContain('data-access="sub"');
    expect(html).toContain('data-access="api"');
    expect(html).toContain('title="Priority 10"');
  });

  test('the wording never presents a recorded cooldown as availability', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('provimux.routes.note')).toContain('It is not an availability verdict');
    const strings = JSON.stringify(
      JSON.parse(readFileSync('src/provimux/locales/en.json', 'utf8')).provimux
    );
    expect(strings).not.toMatch(/\b(available|unavailable|last served)\b/i);
  });
});

describe('live lists', () => {
  const login = (patch: Partial<ProvimuxLiveListLogin>): ProvimuxLiveListLogin => ({
    ...lists.logins[0],
    ...patch,
  });

  test('each row states what was recorded', () => {
    expect(lists.logins.map((row) => liveRowState(row, lists.enabled))).toEqual([
      'live',
      'live_failing',
      'failed',
      'disabled',
      'fetching',
    ]);
    expect(liveRowState(lists.logins[0], false)).toBe('off');
    expect(
      liveRowState(login({ source: 'catalog', fetched_at: null, last_failure: null }), true)
    ).toBe('waiting');
    expect(liveRowState(login({ source: 'mirror' }), true)).toBe('unknown');
    expect(liveSummary(lists.logins)).toEqual({ live: 2, catalog: 3, failing: 2, fetching: 1 });
  });

  test('a refresh is done when every enabled login reported back after the click', () => {
    const click = at('2026-11-19T18:05:00.000Z');
    expect(refreshProgress(lists.logins, click)).toEqual({ done: 0, total: 4, settled: false });
    const after = lists.logins.map((row) =>
      row.disabled
        ? row
        : row.provider === 'codex'
          ? {
              ...row,
              last_failure: {
                at: '2026-11-19T18:05:03.100Z',
                category: 'http_status',
                http_status: 401,
              },
            }
          : { ...row, fetching: false, fetched_at: '2026-11-19T18:05:02.250Z' }
    );
    expect(refreshProgress(after, click)).toEqual({ done: 4, total: 4, settled: true });
    // Still fetching is not done, even with a newer time.
    expect(refreshProgress([{ ...after[0], fetching: true }], click).settled).toBe(false);
    // Fractions of a second count: a list from just before the click is the old one.
    expect(
      refreshProgress([{ ...after[0], fetched_at: '2026-11-19T18:04:59.999Z' }], click).settled
    ).toBe(false);
  });

  test('a failure reads from its codes', () => {
    expect(failureHint({ category: 'http_status', http_status: 401 })).toBe('signin');
    expect(failureHint({ category: 'http_status', http_status: 429 })).toBe('rate_limited');
    expect(failureHint({ category: 'http_status', http_status: 529 })).toBe('provider_error');
    expect(failureHint({ category: 'http_status', http_status: 404 })).toBe('http_other');
    expect(failureHint({ category: 'network', http_status: null })).toBe('network');
    expect(failureHint({ category: 'cosmic_ray', http_status: null })).toBe('other');
  });
});

describe('console release and source (System page)', () => {
  test('a release names its Management Center base; anything else is a development build', () => {
    expect(describeConsoleBuild('v1.28.3-pmx.1')).toEqual({
      kind: 'release',
      version: 'v1.28.3-pmx.1',
      base: 'v1.28.3',
    });
    expect(describeConsoleBuild('v1.28.3-pmx.1-1-ga8aa588e')).toEqual({
      kind: 'dev',
      version: 'v1.28.3-pmx.1-1-ga8aa588e',
    });
    expect(describeConsoleBuild('')).toEqual({ kind: 'dev', version: 'dev' });
  });

  test('GitHub addresses, as the updaters read them', () => {
    expect(githubRepositoryOf('https://github.com/ngvoicu/provimux-ui')).toBe(
      'ngvoicu/provimux-ui'
    );
    expect(githubRepositoryOf('https://github.com/ngvoicu/provimux-ui.git/')).toBe(
      'ngvoicu/provimux-ui'
    );
    expect(githubRepositoryOf('https://api.github.com/repos/me/console/releases/latest')).toBe(
      'me/console'
    );
    expect(githubRepositoryOf('https://api.github.com/repositories/1051566067')).toBe(
      'router-for-me/Cli-Proxy-API-Management-Center'
    );
    expect(githubRepositoryOf('https://gitlab.com/me/console')).toBeNull();
    expect(githubRepositoryOf('not a url')).toBeNull();
  });

  test("Provimux's rules: empty, provimux-ui or the original console mean provimux-ui", () => {
    expect(describeConsoleSource(null, 'provimux')).toEqual({
      repository: 'ngvoicu/provimux-ui',
      reason: 'default',
    });
    expect(
      describeConsoleSource(
        'https://github.com/router-for-me/cli-proxy-api-management-center',
        'provimux'
      )
    ).toEqual({ repository: 'ngvoicu/provimux-ui', reason: 'original_as_default' });
    expect(describeConsoleSource('https://github.com/me/console', 'provimux')).toEqual({
      repository: 'me/console',
      reason: 'configured',
    });
    expect(describeConsoleSource('https://gitlab.com/me/console', 'provimux')).toEqual({
      repository: 'ngvoicu/provimux-ui',
      reason: 'invalid_as_default',
    });
  });

  test("stock CLIProxyAPI's rules: empty means the original console", () => {
    expect(describeConsoleSource(null, 'cliproxyapi')).toEqual({
      repository: 'router-for-me/Cli-Proxy-API-Management-Center',
      reason: 'default',
    });
    expect(describeConsoleSource('https://github.com/ngvoicu/provimux-ui', 'cliproxyapi')).toEqual({
      repository: 'ngvoicu/provimux-ui',
      reason: 'configured',
    });
  });
});

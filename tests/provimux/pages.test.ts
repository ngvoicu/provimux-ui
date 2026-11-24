// Provimux's pages (PUI-15/16): what they derive from the endpoints, and their wording.
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import i18n from '../../src/i18n/index';
import { readModelRoutes } from '../../src/provimux/api/normalize';
import { buildNames } from '../../src/provimux/pages/models/catalog';
import { startDraft } from '../../src/provimux/pages/aliases/draft';
import { readAliasState } from '../../src/provimux/pages/aliases/rows';
import { renderCard } from './support/models';
import {
  devinState,
  isCoolingAt,
  openRouterEntries,
} from '../../src/provimux/pages/modelRoutes/logic';
import { clockOffset, formatDuration, serverNow } from '../../src/provimux/pages/time';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/${name}.json`, 'utf8'));
const routes = readModelRoutes(fixture('model-routes'));
const at = (iso: string) => Date.parse(iso);
const OBSERVED = at('2026-11-19T18:04:11.482Z');

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

describe('model routes', () => {
  test('routes are ranked by priority, highest first; routes that share a priority share a rank', () => {
    const opus = routes.models.find((model) => model.id === 'claude-opus-5-5')!;
    const draft = startDraft({ ...readAliasState({ 'config-version': 8 }, []), etag: '"t"' });
    const ranks = (list: typeof opus.routes) =>
      buildNames({
        draft,
        routes: { observed_at: null, models: [{ ...opus, routes: list }] },
        lists: null,
        usage: null,
        nowMs: OBSERVED,
      })[0].lines.map((line) => [line.rank, line.priority, line.sharesRank]);
    expect(ranks(opus.routes)).toEqual([
      [1, 10, false],
      [2, 0, false],
    ]);
    const shuffled = [opus.routes[1], opus.routes[0], { ...opus.routes[0], auth_index: 'x' }];
    expect(ranks(shuffled)).toEqual([
      [1, 10, true],
      [1, 10, true],
      [2, 0, false],
    ]);
    // A priority the server did not report is not 0: the name then has no order on screen.
    expect(ranks([opus.routes[0], { ...opus.routes[1], priority: null }])).toEqual([
      [null, 10, false],
      [null, null, false],
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

  test('an OpenRouter entry is OpenRouter whatever its name', () => {
    const entries = openRouterEntries([
      { name: 'my-router', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEntries: [] },
      { name: 'eu', baseUrl: 'https://eu.openrouter.ai/api/v1', apiKeyEntries: [] },
      { name: 'lab', baseUrl: 'https://llm.lab.example/v1', apiKeyEntries: [] },
      { name: 'fake', baseUrl: 'https://openrouter.ai.example/v1', apiKeyEntries: [] },
    ]);
    expect(entries.map((entry) => entry.name)).toEqual(['my-router', 'eu']);
  });

  test('Devin: its logins and the cooldowns recorded on them', () => {
    const state = devinState(routes.models, OBSERVED);
    expect(state.logins).toBe(1);
    expect(state.cooling.map(({ model }) => model.id)).toEqual(['devin-opus-5-5']);
    expect(devinState(routes.models, at('2026-11-19T19:00:01Z')).cooling).toEqual([]);
  });

  test('a model on the Models page: its routes by priority, each a subscription or an API key, a cooldown as a record', async () => {
    await i18n.changeLanguage('en');
    const draft = startDraft({ ...readAliasState({ 'config-version': 8 }, []), etag: '"t"' });
    const [opus] = buildNames({
      draft,
      routes: { observed_at: null, models: routes.models.filter((m) => m.id === 'claude-opus-5-5') },
      lists: null,
      usage: null,
      nowMs: OBSERVED,
    });
    const html = renderCard(opus, draft, routes, { offsetMs: OBSERVED - Date.now() });
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Subscription');
    expect(text).toContain('API key');
    expect(text).toContain('ada@example.com');
    expect(text).toContain('api.anthropic.com');
    expect(text).toContain('priority 10');
    expect(html).toContain('Cooldown recorded until');
    expect(html).toContain('quota · HTTP 429 · this model · backoff level 2');
    expect(html).toContain('data-access="sub"');
    expect(html).toContain('data-access="api"');
    expect(opus.lines.map((line) => line.rank)).toEqual([1, 2]);
  });

  test('the wording never presents a recorded cooldown as availability', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('provimux.models.order_note')).toContain(
      'A cooldown is the timer Provimux recorded after a refused request'
    );
    const strings = JSON.stringify(
      JSON.parse(readFileSync('src/provimux/locales/en.json', 'utf8')).provimux
    );
    expect(strings).not.toMatch(/\b(available|unavailable|last served)\b/i);
  });
});

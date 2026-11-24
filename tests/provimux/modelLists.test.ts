// Model lists (Provimux model-lists.md 5.5): reading the answer, and what the Models page shows of it on a
// login's routes (its source and age).
// Fixtures: the contract's example responses, Provimux branch model-lists-live,
// .github/provimux/design/pui13/examples/model-lists{,-login,-live}.json, copied verbatim.
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import i18n from '../../src/i18n/index';
import { apiClient } from '../../src/services/api/client';
import { PROVIMUX_PATHS, provimuxApi } from '../../src/provimux/api/provimuxApi';
import { readModelLists } from '../../src/provimux/api/normalize';
import type { ProvimuxModelListLogin } from '../../src/provimux/api/types';
import { LIVE_LIST_MAX_AGE_MS, listAge, sourceKind } from '../../src/provimux/pages/modelLists/logic';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/${name}.json`, 'utf8'));
const lists = readModelLists(fixture('model-lists'));
const one = readModelLists(fixture('model-lists-login'));
const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-11-22T18:04:11.482Z');

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
    expect(answer.logins).toHaveLength(2);
    expect(answer.logins[0].source).toBe('vendor-v2');
    expect(answer.logins[0].live).toMatchObject({
      held: false,
      fetched_at: null,
      supported: false,
    });
    expect(answer.logins[1].provider).toBe('unknown');
    expect(answer.logins[1].models!.map((model) => model.id)).toEqual(['x']);
    expect(answer.logins[1].models![0].sources.context).toBe('groundtruth');
    expect(sourceKind(answer.logins[0].source)).toBe('unknown');
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

describe('what the routes of a login say of its list', () => {
  test('a list is marked once it is a day old, and expired after 7 days', () => {
    expect(listAge(login({}, { fetched_at: '2026-11-22T16:10:44Z' }), NOW)).toBe('fresh');
    expect(listAge(login({}, { fetched_at: '2026-11-21T18:04:11.482Z' }), NOW)).toBe('old');
    expect(listAge(login({}, { expired: true }), NOW)).toBe('expired');
    expect(listAge(login({}, { fetched_at: null }), NOW)).toBe('none');
    expect(LIVE_LIST_MAX_AGE_MS).toBe(7 * 24 * 3600 * 1000);
  });

  test('a source this console does not know stays unknown', () => {
    expect(sourceKind('published')).toBe('published');
    expect(sourceKind('built-in')).toBe('built-in');
    expect(sourceKind('vendor-v2')).toBe('unknown');
  });
});

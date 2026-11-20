// The Savings page (T-108): what it derives from the endpoint's answer, and what it must say and never claim.
// Fixtures: the contract's example answers, Provimux main 08e59960,
// .github/provimux/design/savings/examples/{savings-month,savings-empty}.json, copied byte for byte.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { readSavings } from '../../src/provimux/api/normalize';
import type { ProvimuxSavingsResponse, ProvimuxSavingsRow } from '../../src/provimux/api/types';
import { ProvimuxPageGate } from '../../src/provimux/components/ProvimuxPageGate';
import { useProvimuxPresence } from '../../src/provimux/presence';
import { SavingsView } from '../../src/provimux/pages/savings/SavingsPage';
import { trendGeometry } from '../../src/provimux/pages/savings/trend';
import { Sparkline } from '../../src/features/dashboard/components/Sparkline';
import {
  apiKeyCostOf,
  copyAmount,
  copyLine,
  dayPoints,
  dayValue,
  floorAmount,
  isBaseRates,
  headlineOf,
  partValue,
  trendValues,
  hitRateOf,
  keyLabel,
  savingsStates,
  unpricedModels,
  zoneLabel,
} from '../../src/provimux/pages/savings/logic';

const raw = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/${name}.json`, 'utf8'));
const month = readSavings(raw('savings-month'));
const empty = readSavings(raw('savings-empty'));
/** A deep copy of an answer to change for one state. */
const changed = (
  base: ProvimuxSavingsResponse,
  change: (data: ProvimuxSavingsResponse) => void
) => {
  const copy = structuredClone(base);
  change(copy);
  return copy;
};
const en = () => i18n.getFixedT('en');
/** The month with every request priced (the unpriced swe-2 requests counted as priced). */
const fullyPriced = (base: ProvimuxSavingsResponse) =>
  changed(base, (data) => {
    data.totals.estimate.priced_requests = data.totals.requests;
    data.totals.estimate.unpriced_requests = 0;
    data.totals.estimate.unpriced_tokens = 0;
  });

const render = (data: ProvimuxSavingsResponse) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SavingsView, { data })));
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const initialLanguage = i18n.language;
beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

describe('reading the answer', () => {
  test('both fixtures keep every number', () => {
    expect(month.totals.requests).toBe(2245);
    expect(month.totals.tokens.input.total).toBe(503302500);
    expect(month.totals.cache_hit_rate).toBe(0.9352);
    expect(month.totals.estimate.saved_by_caching_usd).toBe(1429.74);
    expect(month.totals.estimate.unpriced_tokens).toBe(877500);
    expect(month.totals.reported_cost).toEqual({
      usd: 22.145526,
      byok_upstream_usd: 0,
      requests: 208,
    });
    expect(month.breakdowns.map((b) => b.by)).toEqual([
      ['kind'],
      ['key'],
      ['kind', 'provider', 'host'],
    ]);
    expect(month.models.map((m) => [m.model, m.price?.id ?? null])).toEqual([
      ['claude-opus-5-5', 'anthropic/claude-opus-5.5'],
      ['gpt-6.2-sol', 'openai/gpt-6.2-sol'],
      ['anthropic/claude-sonnet-5.5', 'anthropic/claude-sonnet-5.5'],
      ['swe-2', null],
      ['claude-haiku-5-5', 'anthropic/claude-haiku-5.5'],
    ]);
    expect(month.models[1].price?.cache_write_1h_per_mtok).toBeNull();
    expect(month.recording).toEqual({
      since: '2026-11-18',
      persistent: true,
      saved_at: '2026-11-20T09:14:01.004Z',
      folded_days: 0,
    });
    expect(month.reported_cost_hosts).toEqual(['openrouter.ai']);

    expect(empty.totals.requests).toBe(0);
    expect(empty.totals.cache_hit_rate).toBeNull();
    expect(empty.recording.since).toBeNull();
    expect(empty.prices.openrouter.fetched_at).toBeNull();
    expect(empty.breakdowns).toEqual([]);
    expect(empty.models).toEqual([]);
  });

  test('a missing number is 0 where the contract says "0 when", else null; a missing list is empty', () => {
    const answer = raw('savings-month');
    const totals = structuredClone(answer.totals) as Record<string, Record<string, unknown>>;
    delete totals.estimate.floating_requests;
    delete totals.cache_hit_rate;
    delete (totals.reported_cost as Record<string, unknown>).requests;
    const read = readSavings({ ...answer, totals, models: undefined, reported_cost_hosts: null });
    expect(read.totals.estimate.floating_requests).toBe(0);
    expect(read.totals.reported_cost.requests).toBe(0);
    expect(read.totals.cache_hit_rate).toBeNull();
    expect(read.models).toEqual([]);
    expect(read.reported_cost_hosts).toEqual([]);
    const bare = readSavings({});
    expect(bare.recording.since).toBeNull();
    expect(bare.totals.requests).toBe(0);
    expect(bare.breakdowns).toEqual([]);
  });

  test('an unknown kind, source, match or basis survives as a string', () => {
    const answer = structuredClone(raw('savings-month')) as {
      breakdowns: Array<{ rows: Array<Record<string, unknown>> }>;
      models: Array<{ price: Record<string, unknown> | null }>;
    };
    answer.breakdowns[0].rows[0].kind = 'service_account';
    Object.assign(answer.models[0].price!, { source: 'litellm', match: 'fuzzy', basis: 'blended' });
    const read = readSavings(answer);
    expect(read.breakdowns[0].rows[0].kind).toBe('service_account');
    expect(read.models[0].price).toMatchObject({
      source: 'litellm',
      match: 'fuzzy',
      basis: 'blended',
    });
    // Shown as "other", not dropped and not an error.
    const html = render(read);
    expect(textOf(html)).toContain('other source (litellm)');
    expect(textOf(html)).toContain('match fuzzy');
  });
});

describe('the headline', () => {
  test('the amount and its API-key and subscription parts, from the kind rows', () => {
    expect(headlineOf(month)).toEqual({
      total: 1429.74,
      apikey: { saved: 40.545, requests: 239, priced: 239 },
      oauth: { saved: 1389.195, requests: 2006, priced: 1916 },
      other: null,
    });
  });

  test('found by `by`, not by position; a missing kind breakdown shows the total alone', () => {
    const reordered = changed(month, (data) => data.breakdowns.reverse());
    expect(headlineOf(reordered)).toEqual(headlineOf(month));
    const noKind = changed(month, (data) => {
      data.breakdowns = data.breakdowns.filter((b) => b.by.join() !== 'kind');
    });
    expect(headlineOf(noKind)).toEqual({ total: 1429.74, apikey: null, oauth: null, other: null });
    expect(textOf(render(noKind))).toContain('$1,429.74');
  });

  test('an unknown kind is "other", never folded into a subscription or a key', () => {
    const other = changed(month, (data) => {
      const row = data.breakdowns[0].rows[1] as ProvimuxSavingsRow;
      data.breakdowns[0].rows.push({ ...structuredClone(row), kind: 'unknown' });
    });
    expect(headlineOf(other).other?.saved).toBe(40.545);
    expect(headlineOf(other).apikey?.saved).toBe(40.545);
  });

  test('what the API keys cost: reported beside the estimate, and who reported it', () => {
    expect(apiKeyCostOf(month)).toEqual({
      requests: 239,
      reportedUsd: 22.145526,
      reportedRequests: 208,
      estimateUsd: 22.2705,
      pricedRequests: 239,
      unreported: { requests: 26, pricedRequests: 26, estimateUsd: 0.0405 },
    });
    const text = textOf(render(month));
    expect(text).toContain('Reported by OpenRouter for 208 of 239 API-key requests');
    expect(text).toContain('not an estimate');
  });

  test('hit rate: null input is "No input yet", never 0%', () => {
    expect(hitRateOf(month.totals)).toBe(0.9352);
    expect(hitRateOf(empty.totals)).toBeNull();
    const none = changed(month, (data) => {
      data.recording.since = '2026-11-18';
      data.totals = structuredClone(empty.totals);
    });
    expect(textOf(render(none))).toContain('No input yet');
    expect(textOf(render(none))).not.toContain('0%');
  });
});

describe('key labels', () => {
  test('the tail; the first 4 of the id without a tail; no key; other keys; a name when sent', () => {
    expect(keyLabel({ id: '3f9a1c2b7d4e5f60', tail: 'x9Qz', name: null })).toEqual({
      kind: 'tail',
      text: 'x9Qz',
    });
    expect(keyLabel({ id: '8c41d0e2a7b35f19', tail: null, name: null })).toEqual({
      kind: 'id',
      text: '8c41',
    });
    expect(keyLabel({ id: '', tail: null, name: null })).toEqual({ kind: 'none' });
    expect(keyLabel({ id: '~other', tail: null, name: null })).toEqual({ kind: 'other' });
    expect(keyLabel({ id: '3f9a1c2b7d4e5f60', tail: 'x9Qz', name: 'laptop' })).toEqual({
      kind: 'name',
      text: 'laptop',
    });
  });

  test('the markup holds no more than 4 characters of any fixture id', () => {
    const html = render(month);
    for (const breakdown of month.breakdowns) {
      for (const row of breakdown.rows) {
        const id = row.key?.id ?? '';
        if (id.length <= 4) continue;
        for (let start = 0; start + 5 <= id.length; start += 1) {
          expect(html).not.toContain(id.slice(start, start + 5));
        }
      }
    }
    const text = textOf(html);
    expect(text).toContain('…x9Qz');
    expect(text).toContain('id 8c41…');
    expect(text).toContain('no key');
  });
});

describe('states', () => {
  test('the month fixture: only the unpriced model', () => {
    expect(savingsStates(month)).toEqual(['unpriced']);
  });

  test('each state from a fixture changed for it', () => {
    const states = (change: (data: ProvimuxSavingsResponse) => void) =>
      savingsStates(changed(month, change));
    expect(savingsStates(empty)).toEqual(['nothing_recorded']);
    expect(
      states((data) => {
        data.totals = structuredClone(empty.totals);
      })
    ).toContain('nothing_in_period');
    expect(states((data) => (data.totals.estimate.floating_requests = 4))).toContain('floating');
    expect(states((data) => (data.prices.openrouter.fetched_at = null))).toContain('no_price_list');
    expect(
      states((data) => {
        data.prices.openrouter.fetched_at = null;
        data.prices.openrouter.remote = false;
      })
    ).toContain('no_price_list_local');
    expect(
      states((data) => (data.prices.openrouter.fetched_at = '2026-11-19T09:14:07.000Z'))
    ).toContain('old_price_list');
    expect(
      states((data) => (data.prices.openrouter.fetched_at = '2026-11-19T09:14:08.000Z'))
    ).not.toContain('old_price_list');
    expect(states((data) => (data.totals.estimate.saved_by_caching_usd = -3.2))).toContain(
      'negative_saving'
    );
    expect(states((data) => (data.recording.persistent = false))).toContain('not_persistent');
    expect(states((data) => (data.recording.folded_days = 2))).toContain('folded_days');
  });

  test('each state says what it means on the page', () => {
    const text = (change: (data: ProvimuxSavingsResponse) => void) =>
      textOf(render(changed(month, change)));
    expect(
      text((data) => {
        data.totals = structuredClone(empty.totals);
      })
    ).toContain('No requests in this period. Data exists since Nov 18, 2026.');
    expect(text((data) => (data.totals.estimate.floating_requests = 4))).toContain(
      "4 requests are valued with today's list: their day has no recorded price yet (recorded without one, or not saved yet), so their amounts can still move."
    );
    expect(text((data) => (data.prices.openrouter.fetched_at = null))).toContain(
      'No price list yet, so nothing can be valued'
    );
    expect(
      text((data) => {
        data.prices.openrouter.fetched_at = null;
        data.prices.openrouter.remote = false;
      })
    ).toContain('runs with --local-model');
    expect(text((data) => (data.prices.openrouter.fetched_at = '2026-11-17T08:00:00Z'))).toContain(
      'The price list is from Nov 17, 2026'
    );
    expect(text((data) => (data.totals.estimate.saved_by_caching_usd = -3.2))).toContain(
      'Caching cost more than it was worth'
    );
    expect(text((data) => (data.recording.persistent = false))).toContain(
      'in memory only and end with the next restart'
    );
    expect(text((data) => (data.recording.folded_days = 2))).toContain(
      'On 2 days the row limit was reached'
    );
  });

  test('a negative saving shows as it is, with no copy line', () => {
    const negative = changed(month, (data) => (data.totals.estimate.saved_by_caching_usd = -3.2));
    const text = textOf(render(negative));
    expect(text).toContain('-$3.20');
    expect(text).not.toContain('Prompt caching through Provimux was worth');
  });

  test('the unpriced list: models without a price, most tokens first; ~other is not a model', () => {
    expect(unpricedModels(month).map((model) => model.model)).toEqual(['swe-2']);
    const folded = changed(month, (data) =>
      data.models.push({
        provider: 'claude',
        model: '~other',
        requests: 3,
        tokens: 9e9,
        price: null,
      })
    );
    expect(unpricedModels(folded).map((model) => model.model)).toEqual(['swe-2']);
  });
});

describe('the copy line', () => {
  test('rounded down: whole dollars from $100, cents below', () => {
    expect(floorAmount(1429.74)).toBe(1429);
    expect(copyAmount(1429.74)).toBe('$1,429');
    expect(copyAmount(42.189)).toBe('$42.18');
    expect(copyAmount(0.29)).toBe('$0.29');
    expect(copyAmount(99.999)).toBe('$99.99');
    expect(copyAmount(100)).toBe('$100');
  });

  test("the month fixture gives the owner's line (T-110: worth, not saved)", () => {
    expect(copyLine(fullyPriced(month), en())).toEqual({
      line: 'Prompt caching through Provimux was worth $1,429 this month at base API list prices.',
      block: null,
    });
  });

  test('the period words', () => {
    const words: Record<string, string> = {
      today: 'today',
      yesterday: 'yesterday',
      '7d': 'in the last 7 days',
      '30d': 'in the last 30 days',
      month: 'this month',
      last_month: 'last month',
      year: 'this year',
      all: 'so far',
    };
    for (const [period, phrase] of Object.entries(words)) {
      const line = copyLine(
        changed(fullyPriced(month), (data) => (data.range.period = period)),
        en()
      ).line;
      expect(line).toBe(
        `Prompt caching through Provimux was worth $1,429 ${phrase} at base API list prices.`
      );
    }
  });

  test('the line says API list prices, whichever list priced the models', () => {
    const table = changed(
      fullyPriced(month),
      (data) => (data.models[4].price!.source = 'provimux')
    );
    expect(copyLine(table, en()).line).toBe(
      'Prompt caching through Provimux was worth $1,429 this month at base API list prices.'
    );
  });

  test('no line, and a reason, when under a cent, negative, or nothing priced', () => {
    const block = (change: (data: ProvimuxSavingsResponse) => void) =>
      copyLine(changed(month, change), en());
    expect(block((data) => (data.totals.estimate.saved_by_caching_usd = 0.004))).toEqual({
      line: null,
      block: 'under_cent',
    });
    expect(block((data) => (data.totals.estimate.saved_by_caching_usd = 0))).toEqual({
      line: null,
      block: 'under_cent',
    });
    expect(block((data) => (data.totals.estimate.saved_by_caching_usd = -1))).toEqual({
      line: null,
      block: 'negative',
    });
    expect(block((data) => (data.totals.estimate.priced_requests = 0))).toEqual({
      line: null,
      block: 'nothing_priced',
    });
    const html = render(changed(month, (data) => (data.totals.estimate.priced_requests = 0)));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Copy the line/);
    expect(textOf(html)).toContain('Nothing in this period has a price');
  });

  test('the line names no key, host, model or account, and is always English', async () => {
    const { line } = copyLine(month, en());
    for (const word of ['x9Qz', '8c41', 'openrouter.ai', 'claude', 'swe-2', 'oauth', 'apikey']) {
      expect(line).not.toContain(word);
    }
    await i18n.changeLanguage('zh-CN');
    try {
      expect(copyLine(month, i18n.getFixedT('en')).line).toContain(
        'Prompt caching through Provimux was worth $1,429'
      );
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

describe('the words that keep it honest', () => {
  // Rendered in each test, after the language is English.
  let html = '';
  let text = '';
  beforeAll(() => {
    html = render(month);
    text = textOf(html);
  });

  test('"estimate" is with every estimated amount', () => {
    // Every money figure outside a table cell (the cells' columns say "estimate" in their head) carries the word.
    const outside = html.replace(/<table[\s\S]*?<\/table>/g, '');
    const amounts =
      outside.match(
        /<span[^>]*data-amount=""[^>]*>[^<]*<\/span>(\s|&nbsp;)*(<span[^>]*>[^<]*<\/span>)?/g
      ) ?? [];
    expect(amounts.length).toBeGreaterThan(4);
    for (const amount of amounts) expect(amount).toMatch(/estimate|reported/);
    expect(text).toMatch(/Worth of prompt caching estimate \$1,429\.74/);
    expect(text).toContain('Valued at base API list prices');
  });

  test('the price list and its date are there', () => {
    expect(text).toContain("Prices: OpenRouter's public list of Nov 20, 2026");
    expect(text).toContain('Europe/Bucharest');
    expect(text).toContain('Nov 1, 2026 – Nov 20, 2026');
    expect(text).toContain('recording since Nov 18, 2026');
  });

  test('the unpriced model swe-2 is named near the headline', () => {
    expect(text).toContain('90 requests (877.5K tokens) are of models without a price: swe-2');
    expect(text).not.toMatch(/at least/i);
  });

  test('requests are attempts', () => {
    expect(text).toContain('a request retried on another account counts twice');
  });

  test("the headline items come in the owner's order", () => {
    const order = [
      'Worth of prompt caching',
      'Subscription and API key',
      'Subscription requests at API prices',
      'What the API keys cost',
      'Cache hit rate',
      'Per client key',
    ].map((title) => text.indexOf(title));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('the subscription figure is never called a saving; no percentage saving is claimed', () => {
    expect(text).toContain('Not what the subscription saved');
    const strings = readFileSync('src/provimux/locales/en.json', 'utf8');
    expect(strings).not.toMatch(
      /save[sd]? \d+ ?%|\d+ ?% (saved|cheaper)|cheapest|subscription first|saved me/i
    );
    expect(text).not.toMatch(/subscription (saved|saves) (you )?\$/i);
    // T-110: the headline sums subscription value, so nothing that sums it says "saved".
    expect(text).not.toMatch(/saved by caching|saved me|caching saved/i);
    expect(text).toContain('on API keys');
    expect(text).toContain('money that would have been paid');
    expect(text).toContain('saves quota, not dollars; value at list price');
  });
});

describe('the empty fixture', () => {
  test('no amount, no copy button, and when recording starts', () => {
    const html = render(empty);
    const text = textOf(html);
    expect(text).toContain('Nothing recorded yet');
    expect(text).toContain('Provimux records from the moment this version started');
    expect(text).not.toContain('$');
    expect(text).not.toContain('Copy the line');
    expect(html).not.toContain('<button');
  });
});

describe('days', () => {
  const withDays = changed(month, (data) => {
    data.breakdowns.push({
      by: ['day'],
      truncated: false,
      rows: [
        { ...structuredClone(data.totals), day: '2026-11-18' },
        { ...structuredClone(data.totals), day: '2026-11-20' },
      ],
    });
  });

  test("missing days are zero; the range is the answer's from and to", () => {
    const days = dayPoints(withDays)!;
    expect(days).toHaveLength(20);
    expect(days[0]).toEqual({ label: '2026-11-01', requests: 0, priced: 0, saved: 0 });
    expect(days[17]).toEqual({
      label: '2026-11-18',
      requests: 2245,
      priced: 2155,
      saved: 1429.74,
    });
    expect(days[18]).toEqual({ label: '2026-11-19', requests: 0, priced: 0, saved: 0 });
    expect(days[19].label).toBe('2026-11-20');
    // Never the browser's date: the answer's range, even across a daylight-saving change.
    const dst = changed(withDays, (data) => {
      data.range = { period: 'month', from: '2026-10-24', to: '2026-10-27' };
    });
    expect(dayPoints(dst)!.map((point) => point.label)).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
  });

  test('a long range is summed by month; no day breakdown is null', () => {
    const year = changed(withDays, (data) => {
      data.range = { period: 'year', from: '2026-01-01', to: '2026-11-20' };
    });
    const months = dayPoints(year)!;
    expect(months.map((point) => point.label)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    expect(months[10].requests).toBe(4490);
    expect(dayPoints(month)).toBeNull();
  });
});

describe('zone', () => {
  test('the name, or the offset when the name is Local', () => {
    expect(zoneLabel(month)).toBe('Europe/Bucharest');
    expect(zoneLabel({ timezone: 'Local', utc_offset_seconds: 19800 })).toBe('UTC+05:30');
    expect(zoneLabel({ timezone: 'Local', utc_offset_seconds: -14400 })).toBe('UTC-04:00');
  });
});

describe('route gate', () => {
  test('a 404 removes the page; anything else renders it', () => {
    const initial = useProvimuxPresence.getInitialState();
    const saved = { key: initial.key, savings: initial.savings };
    const renderGate = (status: 'unsupported' | 'error' | 'ready') => {
      Object.assign(initial, { key: 'k', savings: { status, message: null } });
      try {
        return renderToStaticMarkup(
          createElement(
            MemoryRouter,
            { initialEntries: ['/provimux/savings'] },
            createElement(ProvimuxPageGate, {
              endpoint: 'savings',
              children: createElement('h1', null, 'Savings'),
            })
          )
        );
      } finally {
        Object.assign(initial, saved);
      }
    };
    expect(renderGate('unsupported')).not.toContain('Savings');
    expect(renderGate('error')).toContain('<h1>Savings</h1>');
    expect(renderGate('ready')).toContain('<h1>Savings</h1>');
  });
});

describe('strings', () => {
  test('every key the page uses exists in en.json', () => {
    const strings = JSON.parse(readFileSync('src/provimux/locales/en.json', 'utf8'));
    const has = (key: string) =>
      key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          strings
        ) !== undefined;
    const sources = ['SavingsPage.tsx', 'logic.ts']
      .map((file) => readFileSync(`src/provimux/pages/savings/${file}`, 'utf8'))
      .join('\n');
    const literal = [...sources.matchAll(/'(provimux\.[a-z0-9_.]+)'/g)].map((match) => match[1]);
    expect(literal.length).toBeGreaterThan(60);
    const missing = literal.filter((key) => !key.endsWith('.') && !has(key));
    expect(missing).toEqual([]);
    // Keys made from a value: every value the page can put there.
    const prefixes: Record<string, string[]> = {
      'provimux.savings.period': ['today', '7d', '30d', 'month', 'last_month', 'year', 'all'],
      'provimux.savings.copy.period': [
        'today',
        'yesterday',
        '7d',
        '30d',
        'month',
        'last_month',
        'year',
        'all',
      ],
      'provimux.savings.copy.block': ['nothing_priced', 'negative', 'under_cent'],
      'provimux.savings.models.source': ['openrouter', 'provimux', 'other'],
      'provimux.savings.models.match': ['exact', 'variant', 'normalized', 'table', 'other'],
      'provimux.savings.models.basis': ['recorded', 'current', 'mixed', 'other'],
      'provimux.savings.tokens': [
        'uncached',
        'cache_read',
        'cache_write',
        'cache_write_5m',
        'cache_write_1h',
        'output',
        'reasoning',
        'unclassified',
      ],
      'provimux.savings.state': [
        'nothing_in_period',
        'floating',
        'no_price_list',
        'no_price_list_local',
        'old_price_list',
        'not_persistent',
        'folded_days',
      ],
    };
    for (const [prefix, values] of Object.entries(prefixes)) {
      for (const value of values) expect(has(`${prefix}.${value}`)).toBe(true);
    }
    expect(has('provimux.nav.savings')).toBe(true);
    expect(has('provimux.nav_meta.savings')).toBe(true);
  });
});

describe('nothing priced', () => {
  test('no amount dressed as $0.00: the headline says nothing can be valued', () => {
    const none = changed(month, (data) => {
      data.prices.openrouter.fetched_at = null;
      const zero = (m: ProvimuxSavingsResponse['totals']) => {
        m.estimate.unpriced_requests = m.requests;
        m.estimate.priced_requests = 0;
        m.estimate.cost_usd = 0;
        m.estimate.cost_without_cache_usd = 0;
        m.estimate.saved_by_caching_usd = 0;
      };
      zero(data.totals);
      data.breakdowns.forEach((b) => b.rows.forEach(zero));
      data.models.forEach((m) => (m.price = null));
    });
    const text = textOf(render(none));
    expect(text).toContain('No amount: nothing in this period has a price');
    expect(text).not.toContain('$0.00');
    expect(text).toContain('not valued');
    expect(text).toContain('No price list yet.');
    // Requests and the hit rate as usual.
    expect(text).toContain('93.5%');
    expect(text).toContain('2,006');
  });
});

// Review T-112 (task T-117): one test per console finding.
describe('review T-112', () => {
  test('3. a partial sum is not a lower bound: it names how many requests it covers, on the page and in the line', () => {
    // The review's case: one priced request worth +$0.114, one write-heavy request without a price.
    const partial = changed(empty, (data) => {
      data.recording.since = '2026-11-20';
      data.prices = structuredClone(month.prices);
      data.totals.requests = 2;
      data.totals.estimate = {
        ...data.totals.estimate,
        saved_by_caching_usd: 0.114,
        priced_requests: 1,
        unpriced_requests: 1,
        unpriced_tokens: 53000,
      };
      data.models = [
        { provider: 'claude', model: 'claude-x', requests: 1, tokens: 53000, price: null },
        structuredClone(month.models[0]),
      ];
    });
    expect(copyLine(partial, en()).line).toBe(
      'Prompt caching through Provimux was worth $0.11 today at base API list prices, for the 1 of 2 requests with a price.'
    );
    const text = textOf(render(partial));
    expect(text).toContain('Only the 1 of 2 requests with a price are in this amount');
    expect(text).toContain('It is not a lower bound');
    expect(text).not.toMatch(/at least/i);
    expect(readFileSync('src/provimux/locales/en.json', 'utf8')).not.toMatch(/at least/i);
    // Once every request is priced, the line carries no qualifier.
    expect(copyLine(fullyPriced(partial), en()).line).toBe(
      'Prompt caching through Provimux was worth $0.11 today at base API list prices.'
    );
  });

  test('3. the API-key and subscription estimates say they cover only the priced requests', () => {
    const apikeyPartial = changed(month, (data) => {
      for (const breakdown of data.breakdowns) {
        for (const row of breakdown.rows) {
          if (row.kind !== 'apikey') continue;
          row.estimate.priced_requests = Math.max(0, row.estimate.priced_requests - 13);
          row.estimate.unpriced_requests += 13;
        }
      }
    });
    expect(apiKeyCostOf(apikeyPartial)?.pricedRequests).toBe(226);
    const text = textOf(render(apikeyPartial));
    expect(text).toContain('Estimate for the 226 of 239 API-key requests with a price');
    expect(text).not.toContain('Estimate for all API-key requests');
    expect(text).toContain(
      'Estimate for the 13 of 26 requests with a price, on hosts that reported no cost'
    );
    // The month fixture's subscription row has 90 unpriced requests.
    expect(textOf(render(month))).toContain(
      'For the 1,916 of 2,006 subscription requests with a price.'
    );
    expect(textOf(render(fullyPriced(month)))).toContain('Estimate for all API-key requests');
    // Per key: the key whose requests include the unpriced ones says so beside its amount.
    expect(textOf(render(month))).toMatch(/…x9Qz 2,006 \$1,389\.20 1,916 of 2,006 priced/);
  });

  test('4. a day with requests and none priced is "not valued", never $0.00; a partial day says so', () => {
    const withDays = changed(month, (data) => {
      const row = (day: string, requests: number, priced: number, saved: number) => {
        const metrics = structuredClone(empty.totals);
        metrics.requests = requests;
        metrics.estimate.priced_requests = priced;
        metrics.estimate.unpriced_requests = requests - priced;
        metrics.estimate.saved_by_caching_usd = saved;
        return { ...metrics, day };
      };
      data.breakdowns.push({
        by: ['day'],
        truncated: false,
        rows: [
          row('2026-11-18', 3, 3, 1.5),
          row('2026-11-19', 4, 2, 0.4),
          row('2026-11-20', 1, 0, 0),
        ],
      });
    });
    const days = dayPoints(withDays)!;
    expect(days.slice(17).map(dayValue)).toEqual(['known', 'partial', 'none']);
    expect(dayValue(days[0])).toBe('known');
    const html = render(withDays);
    const rows = html.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*<\/tr>/g) ?? [];
    const row20 = textOf(rows.find((row) => row.includes('Nov 20<')) ?? '');
    expect(row20).toContain('not valued');
    expect(row20).not.toContain('$0.00');
    const row19 = textOf(rows.find((row) => row.includes('Nov 19<')) ?? '');
    expect(row19).toContain('2 of 4 priced');
    // A month of such days keeps the counts.
    const year = changed(withDays, (data) => {
      data.range = { period: 'year', from: '2026-01-01', to: '2026-11-20' };
    });
    expect(dayPoints(year)!.at(-1)).toMatchObject({ label: '2026-11', requests: 8, priced: 5 });
  });

  test('10. base rates: the price source and the line say long-context tiers are not applied', () => {
    const text = textOf(render(month));
    expect(text).toContain('at base rates (long-context tiers not applied)');
    expect(text).toContain('Valued at base API list prices');
    expect(copyLine(fullyPriced(month), en()).line).toContain('at base API list prices.');
    // Still one sentence.
    expect((copyLine(month, en()).line ?? '').match(/\./g)?.length).toBe(1);
  });
});

// Task T-120: the backend's T-116 answers (provimux main 5adbfccc).
describe('T-116 answers', () => {
  test('1. "base rates" comes from prices.rates; absent or unknown says nothing about tiers', () => {
    expect(month.prices.rates).toBe('base');
    expect(empty.prices.rates).toBe('base');
    expect(isBaseRates(month)).toBe(true);
    const base = textOf(render(month));
    expect(base).toContain(
      "Prices: OpenRouter's public list of Nov 20, 2026 at 07:02 AM, at base rates (long-context tiers not applied)"
    );
    expect(base).toContain('Valued at base API list prices');
    expect(base).toContain('Estimates are at base list prices');
    expect(copyLine(fullyPriced(month), en()).line).toBe(
      'Prompt caching through Provimux was worth $1,429 this month at base API list prices.'
    );

    for (const rates of [undefined, 'tiered']) {
      const answer = structuredClone(raw('savings-month')) as { prices: Record<string, unknown> };
      if (rates === undefined) delete answer.prices.rates;
      else answer.prices.rates = rates;
      const read = readSavings(answer);
      expect(read.prices.rates).toBe(rates ?? null);
      expect(isBaseRates(read)).toBe(false);
      const text = textOf(render(read));
      expect(text).not.toMatch(/\bbase\b|long-context|tiers/i);
      expect(text).toContain('Valued at API list prices');
      expect(copyLine(fullyPriced(read), en()).line).toBe(
        'Prompt caching through Provimux was worth $1,429 this month at API list prices.'
      );
      expect(copyLine(read, en()).line).toBe(
        'Prompt caching through Provimux was worth $1,429 this month at API list prices, for the 2,155 of 2,245 requests with a price.'
      );
    }
  });

  test('2. rows only in memory: basis current and floating, shown as amounts that can still move', () => {
    const memory = changed(month, (data) => {
      data.totals.estimate.floating_requests = 26;
      data.models[4].price!.basis = 'current';
      data.models[0].price!.basis = 'mixed';
    });
    expect(savingsStates(memory)).toContain('floating');
    const text = textOf(render(memory));
    expect(text).toContain(
      "26 requests are valued with today's list: their day has no recorded price yet (recorded without one, or not saved yet), so their amounts can still move."
    );
    // The per-model table says which prices are today's, never "prices of the day".
    expect(text).toMatch(
      /anthropic\/claude-haiku-5\.5 OpenRouter · matched by name · today's prices/
    );
    expect(text).toMatch(
      /anthropic\/claude-opus-5\.5 OpenRouter · matched by name · partly today's prices/
    );
    expect(text).not.toMatch(/claude-haiku-5\.5 OpenRouter · matched by name · prices of the day/);
    const one = changed(memory, (data) => (data.totals.estimate.floating_requests = 1));
    expect(textOf(render(one))).toContain(
      "1 request is valued with today's list: its day has no recorded price yet"
    );
  });
});

// Task T-123: review T-121, findings 3 and 4. The answers are the review's own (val/t121/wire-*.json).
describe('review T-121', () => {
  const split = readSavings(raw('savings-t121-split'));
  const splitRepriced = readSavings(raw('savings-t121-split-repriced'));
  const unpricedOnly = readSavings(raw('savings-t121-unpriced-only'));
  /** The text of one headline part, by its data-access. */
  const partText = (html: string, access: 'api' | 'sub' | 'other') => {
    const start = html.indexOf(`data-access="${access}"`);
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf('</dd>', start);
    return textOf(html.slice(start, end));
  };

  test('3. a part with no priced request is "not valued" with its count, never $0.00', () => {
    expect(headlineOf(split)).toEqual({
      total: 0.02,
      apikey: { saved: 0, requests: 1, priced: 0 },
      oauth: { saved: 0.02, requests: 1, priced: 1 },
      other: null,
    });
    expect(partValue(headlineOf(split).apikey!)).toBe('none');
    const html = render(split);
    const api = partText(html, 'api');
    expect(api).toContain('not valued');
    expect(api).toContain('1 request, without a price');
    expect(api).not.toContain('$0.00');
    expect(api).not.toContain('estimate');
    // The subscription part is fully priced: its amount, without a qualifier.
    const sub = partText(html, 'sub');
    expect(sub).toContain('$0.02');
    expect(sub).not.toMatch(/with a price|not valued/);
    // The same records once the missing price is applied: the API-key part was worth less than nothing.
    expect(headlineOf(splitRepriced).apikey).toEqual({ saved: -0.2125, requests: 1, priced: 1 });
    const repriced = partText(render(splitRepriced), 'api');
    expect(repriced).toMatch(/[-−]\$0\.21/);
    expect(repriced).not.toMatch(/not valued|with a price/);
  });

  test('3. a partly priced part says how many requests its amount covers', () => {
    expect(headlineOf(unpricedOnly).apikey).toEqual({ saved: 0.228, requests: 5, priced: 2 });
    const html = render(unpricedOnly);
    const api = partText(html, 'api');
    expect(api).toContain('$0.23');
    expect(api).toContain('2 of 5 with a price');
    expect(partText(html, 'sub')).not.toContain('with a price');
    // Several unpriced requests, and a part without requests.
    const many = changed(split, (data) => {
      const row = data.breakdowns[0].rows.find((r) => r.kind === 'apikey')!;
      row.requests = 3;
      row.estimate.unpriced_requests = 3;
    });
    expect(partText(render(many), 'api')).toContain('3 requests, none with a price');
    const noKeys = changed(split, (data) => {
      const row = data.breakdowns[0].rows.find((r) => r.kind === 'apikey')!;
      row.requests = 0;
      row.estimate.unpriced_requests = 0;
    });
    const none = partText(render(noKeys), 'api');
    expect(none).toContain('no requests');
    expect(none).not.toContain('$0.00');
    // An unknown kind with requests is its own part, by the same rule.
    const other = changed(split, (data) => {
      data.breakdowns[0].rows.push({ ...structuredClone(data.breakdowns[0].rows[0]), kind: 'x' });
    });
    expect(headlineOf(other).other).toEqual({ saved: 0, requests: 1, priced: 0 });
    expect(partText(render(other), 'other')).toContain('not valued');
  });

  test('4. a day with requests and none priced is a gap in the trend, never a point at zero', () => {
    const days = dayPoints(unpricedOnly)!.slice(-3);
    expect(days.map((d) => d.label)).toEqual(['2026-11-19', '2026-11-20', '2026-11-21']);
    expect(days.map(dayValue)).toEqual(['known', 'partial', 'none']);
    // The partial day is its priced subset's amount, as in the table; the unknown day has no value.
    expect(trendValues(days)).toEqual([0.134, 0.114, null]);
    const geometry = trendGeometry(trendValues(days))!;
    expect(geometry.segments).toHaveLength(1);
    expect(geometry.dots).toEqual([]);
    // The line ends at the Nov 20 point (x = 50), not at the baseline (100,32) as in the review.
    expect(geometry.segments[0].line).toMatch(/ 50\.00 [\d.]+$/);
    expect(geometry.segments[0].line).not.toContain('100.00');

    const html = render(unpricedOnly);
    const svg =
      html.match(/<svg[^>]*aria-label="Worth of caching per day[\s\S]*?<\/svg>/)?.[0] ?? '';
    expect(svg).toContain('data-gaps="true"');
    expect(svg).toContain('a day with no priced request is left out of the line');
    expect(svg).not.toMatch(/100\.00 32\.00/);
    // The daily table says the same of that day.
    const rows = html.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*<\/tr>/g) ?? [];
    expect(textOf(rows.find((row) => row.includes('Nov 21<')) ?? '')).toContain('not valued');
    expect(textOf(rows.find((row) => row.includes('Nov 20<')) ?? '')).toContain('1 of 3 priced');
  });

  test('4. gaps keep every day in its place; a lone valued day is a dot; no gap draws as before', () => {
    const geometry = trendGeometry([1, null, 2, 1, null, 0.5])!;
    expect(geometry.segments).toHaveLength(1);
    expect(geometry.segments[0].line.startsWith('M40.00 ')).toBe(true);
    expect(geometry.segments[0].line).toMatch(/ 60\.00 [\d.]+$/);
    expect(geometry.dots.map((dot) => dot.x)).toEqual([0, 100]);
    expect(trendGeometry([null, null])).toBeNull();
    // Without a gap: the same line as the dashboard sparkline.
    const values = [0.134, 0.114, 0.2];
    const sparkline = renderToStaticMarkup(
      createElement(Sparkline, { points: values, ariaLabel: 'x' })
    );
    const line = trendGeometry(values)!.segments[0].line;
    expect(sparkline).toContain(`d="${line}"`);
    expect(render(month)).not.toContain('data-gaps');
  });
});

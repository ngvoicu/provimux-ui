// "Serve only my names" on upstream's Routing page (design models-page.md 8.9): the page shows what an account offers,
// so with the switch on it says that a name that isn't his is refused before routing, plainly for a typed name, and
// beside every tier line that says the tier serves; for one of his names it says it is served. Off, absent or Home:
// the page is upstream's.
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { readNames } from '@/provimux/api/normalize';
import type { ProvimuxNamesResponse } from '@/provimux/api/types';
import { routingModelsAddress, routingNameVerdict } from '@/provimux/routing/nameVerdict';
import { ProvimuxRoutingNamesNote, ProvimuxRoutingTierNote } from '@/provimux/routing/RoutingNames';
import { buildRoutingBoard } from '@/services/api/routing';
import { draftFromBoard, resolveRoute } from '@/features/routing/logic';
import { TierLadder } from '@/features/routing/components/TierLadder';
import type { AuthFileItem } from '@/types/authFile';
import { ownerFixture } from './support/models';

type Raw = Record<string, unknown>;

/** The owner's names answer (owner-names.json), changed by `change`, read as the page reads it. */
function answerWith(change: (raw: Raw) => void = () => undefined): ProvimuxNamesResponse {
  const raw = structuredClone(ownerFixture('names')) as Raw;
  change(raw);
  return readNames(raw);
}
const on = (raw: Raw) => {
  raw.only_my_names = { enabled: true, applies: true, not_applied: null };
};
const withCopy = (raw: Raw) => {
  on(raw);
  const own = (raw.names as Raw[]).find((name) => name.name === 'opus')!;
  own.copies = [{ id: 'team/opus', accounts: 1 }];
};

const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

describe('the verdict for the typed name', () => {
  test('nothing while the switch is off, does not apply (Home), or there is no answer', () => {
    expect(routingNameVerdict(null, 'gpt-4o')).toBeNull();
    expect(routingNameVerdict(answerWith(), 'gpt-4o')).toBeNull();
    expect(routingNameVerdict(answerWith(), null)).toBeNull();
    const home = answerWith((raw) => {
      raw.only_my_names = { enabled: true, applies: false, not_applied: 'home' };
    });
    expect(routingNameVerdict(home, 'gpt-4o')).toBeNull();
  });

  test('on: the rule with no name typed; a name his accounts offer but not his is refused', () => {
    const answer = answerWith(on);
    expect(routingNameVerdict(answer, null)).toEqual({ kind: 'rule' });
    expect(routingNameVerdict(answer, '  ')).toEqual({ kind: 'rule' });
    // claude-opus-4-5 is under `others`: an account offers it, it is not his.
    expect(routingNameVerdict(answer, 'claude-opus-4-5')).toEqual({
      kind: 'refused',
      name: 'claude-opus-4-5',
    });
    // A name nobody offers is refused too: the gateway answers it as an unknown model.
    expect(routingNameVerdict(answer, 'nobody-offers-this')?.kind).toBe('refused');
  });

  test('his names, by alias or kept, and their prefixed copies are served; compared exactly', () => {
    const answer = answerWith(withCopy);
    expect(routingNameVerdict(answer, 'opus')).toEqual({
      kind: 'yours',
      name: 'opus',
      accounts: 1,
      copyOf: null,
    });
    expect(routingNameVerdict(answer, ' opus ')?.kind).toBe('yours');
    expect(routingNameVerdict(answer, 'team/opus')).toEqual({
      kind: 'yours',
      name: 'team/opus',
      accounts: 1,
      copyOf: 'opus',
    });
    // A thinking suffix: the gateway checks the name without it too; said as a level of the name.
    expect(routingNameVerdict(answer, 'opus(high)')).toEqual({
      kind: 'yours',
      name: 'opus(high)',
      accounts: 1,
      copyOf: null,
      levelOf: 'opus',
    });
    expect(routingNameVerdict(answer, 'team/opus(high)')).toMatchObject({
      kind: 'yours',
      copyOf: 'opus',
      levelOf: 'team/opus',
    });
    // Exactly as the config has it: another spelling is not his, with a level or not.
    expect(routingNameVerdict(answer, 'Opus')?.kind).toBe('refused');
    expect(routingNameVerdict(answer, 'Opus(high)')?.kind).toBe('refused');
    // auto is never a name.
    expect(routingNameVerdict(answer, 'auto')?.kind).toBe('refused');
    expect(routingNameVerdict(answer, 'auto(high)')?.kind).toBe('refused');
  });

  test('what made a name his is not read: an answer without set_by, or with only a value that is gone', () => {
    const answer = answerWith((raw) => {
      on(raw);
      for (const name of raw.names as Raw[]) name.set_by = [];
      (raw.names as Raw[]).push({ name: 'kept-model', set_by: ['keep'], accounts: 0, copies: [] });
    });
    expect(routingNameVerdict(answer, 'opus')?.kind).toBe('yours');
    expect(routingNameVerdict(answer, 'kept-model')).toMatchObject({ kind: 'yours', accounts: 0 });
  });

  test('the link leads to Models, searched for the typed name', () => {
    expect(routingModelsAddress({ kind: 'rule' })).toBe('/provimux/models');
    expect(routingModelsAddress({ kind: 'refused', name: 'team/gpt 5' })).toBe(
      '/provimux/models?q=team%2Fgpt+5'
    );
  });
});

describe('the words', () => {
  test('in English, as they show', async () => {
    await i18n.changeLanguage('en');
    const answer = answerWith(withCopy);
    const note = (model: string | null) =>
      textOf(
        render(
          createElement(ProvimuxRoutingNamesNote, { verdict: routingNameVerdict(answer, model) })
        )
      );
    expect(note(null)).toBe(
      "Serve only my names is on: a name that isn't yours is refused before routing. See Models"
    );
    expect(note('claude-opus-4-5')).toBe(
      "claude-opus-4-5 isn't one of your names, so the gateway refuses it before routing. The tiers below only show which accounts offer it. Keep it on Models"
    );
    expect(note('opus')).toBe(
      'opus is one of your names, so it is served while Serve only my names is on. See which accounts answer it on Models'
    );
    expect(note('opus(high)')).toBe(
      'opus(high) is served: it is opus with a thinking level. See which accounts answer it on Models'
    );
    expect(note('team/opus')).toBe(
      "team/opus is served: it is opus, one of your names, under an account's prefix. See which accounts answer it on Models"
    );
    const none = answerWith((raw) => {
      on(raw);
      (raw.names as Raw[]).push({ name: 'kept-model', set_by: ['keep'], accounts: 0, copies: [] });
    });
    expect(
      textOf(
        render(
          createElement(ProvimuxRoutingNamesNote, {
            verdict: routingNameVerdict(none, 'kept-model'),
          })
        )
      )
    ).toBe('kept-model is one of your names, but no account offers it now. See Models');
    // The refusal is an alert in the warning tone; the others are status lines.
    const refused = render(
      createElement(ProvimuxRoutingNamesNote, {
        verdict: routingNameVerdict(answer, 'claude-opus-4-5'),
      })
    );
    expect(refused).toContain('role="alert"');
    expect(refused).toContain('data-tone="refused"');
    expect(refused).toContain('href="/provimux/models?q=claude-opus-4-5"');
    expect(
      render(createElement(ProvimuxRoutingNamesNote, { verdict: routingNameVerdict(answer, null) }))
    ).toContain('role="status"');
  });

  test('off: nothing at all', async () => {
    await i18n.changeLanguage('en');
    const off = routingNameVerdict(answerWith(), 'claude-opus-4-5');
    expect(render(createElement(ProvimuxRoutingNamesNote, { verdict: off }))).toBe('');
    expect(render(createElement(ProvimuxRoutingTierNote, { verdict: off }))).toBe('');
  });

  test('every language has the strings, with the same names to fill in', () => {
    const read = (language: string) =>
      JSON.parse(
        readFileSync(
          new URL(`../../src/provimux/locales/${language}.json`, import.meta.url),
          'utf8'
        )
      ) as { provimux: { routing: Record<string, string>; names: Record<string, string> } };
    const en = read('en').provimux;
    const tokens = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const language of ['zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const own = read(language).provimux;
      for (const [key, text] of Object.entries(en.routing)) {
        expect(own.routing[key], `${language} routing.${key}`).toBeString();
        expect(own.routing[key] === text, `${language} routing.${key} translated`).toBe(false);
        expect(tokens(own.routing[key])).toEqual(tokens(text));
      }
      for (const key of ['section_copies', 'section_copies_hint']) {
        expect(own.names[key], `${language} names.${key}`).toBeString();
      }
    }
  });
});

describe('on the tiers', () => {
  const RAW = {
    routing: { strategy: 'round-robin' },
    'api-keys': {
      codex: [{ name: 'opencode', priority: 20, keys: [{ 'api-key': 'sk-codex-aaaa' }] }],
    },
  };
  const FILES: AuthFileItem[] = [
    { name: 'main.json', type: 'codex', email: 'main@example.com', priority: 0 },
  ];
  const ladder = (model: string, stateNote: ReactElement | null) => {
    const board = buildRoutingBoard(RAW, FILES);
    const draft = draftFromBoard(board);
    const catalog = { channels: { codex: [model] }, credentials: { 'main.json': [model] } };
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(TierLadder, {
          members: new Map(board.members.map((member) => [member.key, member])),
          draft,
          preview: resolveRoute(board, draft, catalog, model, 0),
          priorities: {},
          model,
          nowMs: 0,
          theme: 'light',
          entryControl: null,
          stateNote,
          onMove: () => {},
          onStep: () => {},
          onEditWeights: () => {},
        })
      )
    );
  };

  test('a refused name: "Serving requests" never stands alone', async () => {
    await i18n.changeLanguage('en');
    const verdict = routingNameVerdict(answerWith(on), 'claude-opus-4-5');
    const text = textOf(
      ladder('claude-opus-4-5', createElement(ProvimuxRoutingTierNote, { verdict }))
    );
    expect(text).toContain('Serving requests Not for claude-opus-4-5: refused before routing');
    // The standby tier says it may serve too: the note is beside it as well.
    expect(text).toContain(
      'Standby, used when every tier above is unavailable Not for claude-opus-4-5: refused before routing'
    );
  });

  test("his name, the switch off, or no answer: upstream's line alone", async () => {
    await i18n.changeLanguage('en');
    const yours = routingNameVerdict(answerWith(on), 'opus');
    const off = routingNameVerdict(answerWith(), 'claude-opus-4-5');
    for (const verdict of [yours, off, null]) {
      const text = textOf(ladder('opus', createElement(ProvimuxRoutingTierNote, { verdict })));
      expect(text).toContain('Serving requests');
      expect(text).not.toContain('refused before routing');
    }
    expect(textOf(ladder('opus', null))).toContain('Serving requests');
  });

  test("upstream's page takes them in three places, and nothing else of it changes", () => {
    const page = readFileSync(
      new URL('../../src/features/routing/RoutingPage.tsx', import.meta.url),
      'utf8'
    );
    expect(page).toContain('const provimuxNames = useProvimuxRoutingNames(selectedModel);');
    expect(page).toContain('<ProvimuxRoutingNamesNote verdict={provimuxNames} />');
    expect(page).toContain('stateNote={<ProvimuxRoutingTierNote verdict={provimuxNames} />}');
  });
});

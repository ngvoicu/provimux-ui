// "Back to the first account" on the Routing page (Provimux): routing.session-affinity-return.cold-after, as
// GET /provimux/session-return reports it. The answers below are the gateway's own, as its tests print them for each
// state; the fixture gateway answers the config path as the real one was seen to (200, 412, 422, 404 not_found).
import { afterAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { PolicyPanel } from '@/features/routing/components/PolicyPanel';
import { runWrite } from '@/provimux/pages/restarts/restartsWrite';
import { ProvimuxSessionReturn, Ready } from '@/provimux/routing/SessionReturn';
import { sessionReturnApi, type Client } from '@/provimux/routing/sessionReturnApi';
import {
  draftMinutes,
  durationValue,
  fieldValue,
  normalizeReturn,
  reachesTtl,
  returnMode,
  timeParts,
  type ReturnSnapshot,
  type ReturnState,
} from '@/provimux/routing/sessionReturnLogic';
import {
  describeReturnWrite,
  reasonLink,
  reasonText,
  timeText,
} from '@/provimux/routing/sessionReturnWords';
import { offSpec, saveSpec } from '@/provimux/routing/sessionReturnWrite';

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});
await i18n.changeLanguage('en');
const t = i18n.t.bind(i18n);

type Doc = Record<string, unknown>;

const AFFINITY = {
  enabled: true,
  ttl_s: 3600,
  strategy: 'round-robin',
  subagents: true,
  rebind_on: 'any',
};
const COUNTS = { returned: 0, last_returned_at: null, since: '2026-11-27T13:21:30Z' };
const answer = (setting: number | null, reason: string | null, more: Doc = {}): Doc => ({
  observed_at: '2026-11-27T13:21:30Z',
  setting: { cold_after_s: setting },
  in_effect: reason === null,
  reason,
  affinity: AFFINITY,
  counts: COUNTS,
  ...more,
});
/** The gateway's answers, one per state it reports. */
const ANSWERS = {
  notSet: answer(null, 'not-set'),
  inEffect: answer(360, null),
  notBelowTtl: answer(7200, 'not-below-ttl'),
  rebindNever: answer(360, 'rebind-never', { affinity: { ...AFFINITY, rebind_on: 'never' } }),
  affinityOff: answer(360, 'session-affinity-off', { affinity: { ...AFFINITY, enabled: false } }),
  asInstalled: answer(null, 'session-affinity-off', { affinity: { ...AFFINITY, enabled: false } }),
  pluginScheduler: answer(360, 'plugin-scheduler'),
  homeMode: answer(360, 'home-mode'),
  counted: answer(360, null, {
    counts: {
      returned: 12,
      last_returned_at: '2026-11-27T09:58:30Z',
      since: '2026-11-27T06:00:11Z',
    },
  }),
} as const;
const stateOf = (raw: Doc): ReturnState => normalizeReturn(raw)!;

// --- a gateway: the config path and the state path, as the branch with the rule answers --------------------------------

const DURATION = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/;
const secondsOf = (value: unknown): number | null => {
  if (typeof value !== 'string' || value === '') return null;
  const match = DURATION.exec(value);
  if (!match) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
};

function gateway(initial: Doc = {}, options: { path?: boolean; dropNextReply?: boolean } = {}) {
  let routing: Doc = { 'session-affinity': true, ...initial };
  let tag = 1;
  let path = options.path ?? true;
  let dropNextReply = options.dropNextReply ?? false;
  let stateFails = false;
  const requests: Array<{ method: string; path: string; ifMatch?: string; body?: unknown }> = [];
  const error = (status: number | undefined, apiCode?: string, message?: string) =>
    Object.assign(new Error(message ?? apiCode ?? 'Network Error'), { status, apiCode });
  const state = () => {
    const setting = routing['session-affinity-return'] as Doc | null | undefined;
    const cold = secondsOf(setting?.['cold-after']);
    const reason =
      routing['session-affinity'] !== true
        ? 'session-affinity-off'
        : cold === null
          ? 'not-set'
          : routing['session-affinity-rebind-on'] === 'never'
            ? 'rebind-never'
            : cold >= 3600
              ? 'not-below-ttl'
              : null;
    return answer(cold, reason);
  };
  const client = {
    async getRaw(at: string) {
      requests.push({ method: 'GET', path: at });
      return { data: { routing: structuredClone(routing) }, headers: { etag: `"${tag}"` } };
    },
    async get(at: string) {
      requests.push({ method: 'GET', path: at });
      if (stateFails) throw error(500, 'internal', 'boom');
      if (at === '/provimux/session-return' && path) return state();
      throw error(404);
    },
    async put(at: string, body: unknown, config?: { headers?: Record<string, string> }) {
      const ifMatch = config?.headers?.['If-Match'];
      requests.push({ method: 'PUT', path: at, ifMatch, body });
      if (ifMatch !== `"${tag}"`) throw error(412, 'precondition_failed');
      const value = (body as Doc | null)?.['cold-after'];
      if (body !== null && value !== undefined && (secondsOf(value) ?? 0) < 60) {
        throw error(
          422,
          'invalid_config',
          `parse config payload: routing.session-affinity-return.cold-after must be a duration of at least one minute ("6m", "1h30m"), got ${JSON.stringify(String(value))}`
        );
      }
      routing = { ...routing, 'session-affinity-return': body };
      tag += 1;
      if (dropNextReply) {
        dropNextReply = false;
        throw error(undefined);
      }
      return { status: 'ok' };
    },
    async delete(at: string, config?: { headers?: Record<string, string> }) {
      const ifMatch = config?.headers?.['If-Match'];
      requests.push({ method: 'DELETE', path: at, ifMatch });
      if (ifMatch !== `"${tag}"`) throw error(412, 'precondition_failed');
      if (!('session-affinity-return' in routing)) throw error(404, 'not_found');
      const next = { ...routing };
      delete next['session-affinity-return'];
      routing = next;
      tag += 1;
      return { status: 'ok' };
    },
  };
  return {
    client: client as unknown as Client,
    requests,
    writes: () => requests.filter((request) => request.method !== 'GET'),
    file: () => routing,
    /** Another writer changes the file. */
    touch: () => {
      tag += 1;
    },
    setRouting: (patch: Doc) => {
      routing = { ...routing, ...patch };
      tag += 1;
    },
    replaceWithOlder: () => {
      path = false;
    },
    failState: () => {
      stateFails = true;
    },
  };
}

const run = async (
  gw: ReturnType<typeof gateway>,
  spec: (drawn: ReturnState) => ReturnType<typeof saveSpec>,
  before?: (current: ReturnSnapshot) => void
) => {
  const current = await sessionReturnApi.read(gw.client);
  if (current.state.kind !== 'ready') throw new Error('the fixture has the path');
  before?.(current);
  return runWrite(spec(current.state.state), {
    client: gw.client,
    current,
    read: sessionReturnApi.read,
    isCurrent: () => true,
    wait: async () => undefined,
    polls: 2,
  });
};

// --- the state --------------------------------------------------------------------------------------------------------

describe('the state, as the gateway reports it', () => {
  test("each of the gateway's answers: in effect, off, or a time that does not run", () => {
    const modes = Object.fromEntries(
      Object.entries(ANSWERS).map(([name, raw]) => [name, returnMode(stateOf(raw))])
    );
    expect(modes).toEqual({
      notSet: 'off',
      inEffect: 'on',
      notBelowTtl: 'blocked',
      rebindNever: 'blocked',
      affinityOff: 'blocked',
      asInstalled: 'off',
      pluginScheduler: 'blocked',
      homeMode: 'blocked',
      counted: 'on',
    });
    expect(stateOf(ANSWERS.counted)).toMatchObject({
      coldAfterS: 360,
      inEffect: true,
      reason: null,
      ttlS: 3600,
      returned: 12,
      lastReturnedAt: '2026-11-27T09:58:30Z',
      since: '2026-11-27T06:00:11Z',
    });
  });

  test("in effect is the gateway's word alone: a time in the answer does not make it so", () => {
    expect(returnMode(stateOf(answer(360, 'a-reason-of-a-later-gateway')))).toBe('blocked');
    expect(reasonText(t, stateOf(answer(360, 'a-reason-of-a-later-gateway')))).toBe(
      'The gateway gives this reason: a-reason-of-a-later-gateway.'
    );
  });

  test('an answer that is not the state is an error, never "off"', async () => {
    expect(normalizeReturn({ setting: { cold_after_s: null } })).toBeNull();
    expect(normalizeReturn({ in_effect: false })).toBeNull();
    expect(normalizeReturn('ok')).toBeNull();
    const gw = gateway();
    gw.failState();
    expect(await sessionReturnApi.state(gw.client)).toEqual({ kind: 'error', message: 'boom' });
  });

  test('a gateway without the path (404) is absent, and its configuration is not asked for', async () => {
    const gw = gateway({}, { path: false });
    const read = await sessionReturnApi.read(gw.client);
    expect(read.state).toEqual({ kind: 'absent' });
    expect(gw.requests.map((request) => request.path)).toEqual(['/provimux/session-return']);
  });
});

describe('times', () => {
  test('a time in words: the parts that are not zero, the fraction kept', () => {
    expect(timeText(t, 360)).toBe('6 min');
    expect(timeText(t, 3900)).toBe('1 h 5 min');
    expect(timeText(t, 3600)).toBe('1 h');
    expect(timeText(t, 90)).toBe('1 min 30 s');
    expect(timeText(t, 60.9)).toBe('1 min 0.9 s');
    expect(timeParts(7265)).toEqual({ h: 2, m: 1, s: 5 });
  });

  test('the field is whole minutes; what the file gets is a duration', () => {
    expect(draftMinutes(' 6 ')).toBe(6);
    expect(draftMinutes('0')).toBe(0);
    for (const bad of ['', '6m', '1.5', '-3', 'six', '123456'])
      expect(draftMinutes(bad)).toBeNull();
    expect([6, 60, 65, 90, 120].map(durationValue)).toEqual(['6m', '1h', '1h5m', '1h30m', '2h']);
    expect(fieldValue(stateOf(ANSWERS.inEffect))).toBe('6');
    expect(fieldValue(stateOf(ANSWERS.notSet))).toBe('');
    // A time the file holds with seconds is said above the field, not rounded into it.
    expect(fieldValue(stateOf(answer(60.9, null)))).toBe('');
  });

  test("a time not shorter than session affinity's lifetime, as the gateway reports that lifetime", () => {
    const state = stateOf(ANSWERS.inEffect);
    expect(reachesTtl(59, state)).toBe(false);
    expect(reachesTtl(60, state)).toBe(true);
    expect(reachesTtl(65, state)).toBe(true);
    expect(reachesTtl(null, state)).toBe(false);
    expect(reachesTtl(65, { ...state, ttlS: null })).toBe(false);
  });
});

// --- the writes -------------------------------------------------------------------------------------------------------

describe('a change', () => {
  test('a time is one conditional PUT of the key, and the gateway then reports it', async () => {
    const gw = gateway();
    const { result, snapshot } = await run(gw, (drawn) => saveSpec(drawn, 6));
    expect(gw.writes()).toEqual([
      {
        method: 'PUT',
        path: '/config/routing/session-affinity-return',
        ifMatch: '"1"',
        body: { 'cold-after': '6m' },
      },
    ]);
    expect(result).toEqual({ kind: 'saved', shown: true });
    expect(describeReturnWrite(t, result, snapshot!)).toEqual({
      tone: 'ok',
      text: 'Saved. The gateway reports it in effect.',
    });
  });

  test('a time the gateway accepts and does not run is saved, and said not to be in effect', async () => {
    const gw = gateway();
    const { result, snapshot } = await run(gw, (drawn) => saveSpec(drawn, 65));
    expect(gw.file()['session-affinity-return']).toEqual({ 'cold-after': '1h5m' });
    expect(result).toEqual({ kind: 'saved', shown: true });
    expect(describeReturnWrite(t, result, snapshot!)).toEqual({
      tone: 'warning',
      text: 'Saved. The gateway reports it not in effect, for the reason above.',
    });
  });

  test("a refused value (422) writes nothing, and the gateway's words are shown", async () => {
    const gw = gateway({ 'session-affinity-return': { 'cold-after': '6m' } });
    const { result, snapshot } = await run(gw, (drawn) => saveSpec(drawn, 0));
    expect(result.kind).toBe('refused');
    expect(gw.file()['session-affinity-return']).toEqual({ 'cold-after': '6m' });
    const line = describeReturnWrite(t, result, snapshot!);
    expect(line.tone).toBe('error');
    expect(line.text).toContain('routing.session-affinity-return.cold-after');
    expect(line.text).toContain('"0m"');
  });

  test('off removes the key; a key that is not there is off already', async () => {
    const gw = gateway({ 'session-affinity-return': { 'cold-after': '6m' } });
    const { result, snapshot } = await run(gw, offSpec);
    expect(gw.writes()).toEqual([
      { method: 'DELETE', path: '/config/routing/session-affinity-return', ifMatch: '"1"' },
    ]);
    expect('session-affinity-return' in gw.file()).toBe(false);
    expect(result).toEqual({ kind: 'saved', shown: true });
    expect(describeReturnWrite(t, result, snapshot!).text).toBe(
      'Saved. The gateway reports it off.'
    );
    // 404 not_found on the key: done.
    await expect(sessionReturnApi.off('"2"', gw.client)).resolves.toBeUndefined();
  });

  test('a file another writer changed since the read (412) is not written', async () => {
    const gw = gateway();
    const { result, snapshot } = await run(
      gw,
      (drawn) => saveSpec(drawn, 6),
      () => gw.touch()
    );
    expect(result).toEqual({ kind: 'changed', reread: true });
    expect('session-affinity-return' in gw.file()).toBe(false);
    expect(describeReturnWrite(t, result, snapshot!).tone).toBe('warning');
  });

  test('nothing is sent when the gateway no longer reports what the controls were drawn from', async () => {
    const changed = gateway();
    const first = await run(
      changed,
      (drawn) => saveSpec(drawn, 6),
      () => changed.setRouting({ 'session-affinity': false })
    );
    expect(first.result).toEqual({ kind: 'stale', why: 'changed' });
    expect(changed.writes()).toEqual([]);

    const replaced = gateway();
    const second = await run(
      replaced,
      (drawn) => saveSpec(drawn, 6),
      () => replaced.replaceWithOlder()
    );
    expect(second.result).toEqual({ kind: 'stale', why: 'absent' });
    expect(replaced.writes()).toEqual([]);
    expect(second.snapshot?.state).toEqual({ kind: 'absent' });
  });

  test('a lost reply is "unconfirmed", and the line says what the gateway reports now', async () => {
    const gw = gateway({}, { dropNextReply: true });
    const { result, snapshot } = await run(gw, (drawn) => saveSpec(drawn, 6));
    expect(result).toEqual({ kind: 'unconfirmed' });
    expect(describeReturnWrite(t, result, snapshot!)).toEqual({
      tone: 'warning',
      text: 'The gateway did not confirm the save. It now reports it in effect, after 6 min.',
    });
  });
});

// --- the card ---------------------------------------------------------------------------------------------------------

const html = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const never = async () => false;
const card = (raw: Doc, more: Partial<Parameters<typeof Ready>[0]> = {}) =>
  html(
    createElement(Ready, {
      id: 'x',
      state: stateOf(raw),
      writable: true,
      configError: null,
      busy: false,
      message: null,
      onSave: never,
      onTurnOff: never,
      ...more,
    })
  );

describe('the card', () => {
  test('in effect: the statement, then the condition with the time, then the count', () => {
    const shown = text(card(ANSWERS.counted));
    expect(shown).toContain('Back to the first account In effect');
    expect(shown).toContain(
      'A conversation that fell back to a lower tier, which may cost more, goes back to the highest one by itself.'
    );
    expect(shown).toContain(
      'A conversation goes back at its next message after 6 min without one.'
    );
    expect(shown).toContain('Sent back 12 times since the gateway started.');
    expect(shown).toContain('Change');
    expect(shown).toContain('Turn off');
    expect(text(card(answer(360, null, { counts: { ...COUNTS, returned: 1 } })))).toContain(
      'Sent back 1 time since the gateway started.'
    );
    expect(text(card(ANSWERS.inEffect))).toContain('None sent back since the gateway started.');
  });

  test('off: says so, offers a time, and no count of a rule that never ran', () => {
    const shown = text(card(ANSWERS.notSet));
    expect(shown).toContain('Back to the first account Off');
    expect(shown).toContain(
      'No time is set, so a conversation stays on the account it fell back to.'
    );
    expect(shown).toContain('Set a time');
    expect(shown).not.toContain('Turn off');
    expect(shown).not.toContain('since the gateway started');
    expect(shown).not.toContain('A time alone');
  });

  test('as installed (no time, session affinity off): off, and a time alone would not turn it on', () => {
    const shown = text(card(ANSWERS.asInstalled));
    expect(shown).toContain('Back to the first account Off');
    expect(shown).toContain(
      'A time alone would not turn it on: Session affinity is off, so no conversation is tied to an account. Turn it on above and save.'
    );
  });

  test('a time that does not run: the one reason, and where to change it', () => {
    const cases: Array<[Doc, string, string | null]> = [
      [
        ANSWERS.affinityOff,
        'Session affinity is off, so no conversation is tied to an account.',
        null,
      ],
      [ANSWERS.notBelowTtl, "2 h is not shorter than session affinity's lifetime (1 h)", '/config'],
      [ANSWERS.rebindNever, 'session-affinity-rebind-on is "never"', '/config'],
      [ANSWERS.homeMode, 'The gateway is in Home mode, where this does not apply.', null],
      [ANSWERS.pluginScheduler, 'A scheduling plugin chooses the accounts', '/plugins'],
    ];
    for (const [raw, words, link] of cases) {
      const markup = card(raw);
      const shown = text(markup);
      expect(shown).toContain('Back to the first account Not in effect');
      expect(shown).toContain(words);
      expect(shown).not.toContain('A conversation goes back at its next message');
      expect(reasonLink(stateOf(raw).reason)).toBe(link);
      if (link) expect(markup).toContain(`href="${link}"`);
      else expect(markup).not.toContain('href=');
    }
  });

  test('a configuration that could not be read: shown, and nothing can be changed', () => {
    const markup = card(ANSWERS.inEffect, { writable: false, configError: 'read failed' });
    expect(text(markup)).toContain('Could not read the configuration file');
    expect(markup.match(/<button[^>]*disabled/g)?.length).toBe(2);
  });

  test("the conditions sit behind a details control, with the setting's name", () => {
    const markup = card(ANSWERS.inEffect);
    const details = markup.slice(markup.indexOf('<details'));
    expect(text(details)).toContain('How it decides');
    expect(text(details)).toContain(
      'It never moves a conversation that had a message within the time you set.'
    );
    expect(details).toContain('<code>routing.session-affinity-return.cold-after</code>');
    expect(details).not.toContain('open=""');
  });

  test('nothing is drawn before the gateway answers: a gateway without the rule never shows the card', () => {
    expect(html(createElement(ProvimuxSessionReturn, null))).toBe('');
  });

  test('the Routing page draws it right under Session affinity', () => {
    const markup = html(
      createElement(PolicyPanel, {
        settings: {
          strategy: 'round-robin',
          sessionAffinity: true,
          requestRetry: 0,
          maxRetryCredentials: 0,
        },
        onChange: () => undefined,
        afterAffinity: createElement('div', { id: 'the-seam' }),
      })
    );
    const affinity = markup.indexOf('Session affinity');
    const seam = markup.indexOf('id="the-seam"');
    const failover = markup.indexOf('Failover');
    expect(affinity).toBeGreaterThan(-1);
    expect(seam).toBeGreaterThan(affinity);
    expect(failover).toBeGreaterThan(seam);
  });
});

describe('the English', () => {
  test('no sentence of the card carries a board number, an address or a credential', () => {
    const strings = i18n.getResourceBundle('en', 'translation').provimux.session_return as Record<
      string,
      string
    >;
    for (const value of Object.values(strings)) {
      expect(value).not.toMatch(/\b[TmM]-\d{2,}\b|@|https?:/);
    }
  });
});

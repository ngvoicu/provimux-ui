// "Back to the first account" on the Routing page (Provimux): routing.session-affinity-return.cold-after, as
// GET /provimux/session-return reports it. The card's buttons each call one plain function (sessionReturnActions.ts):
// those are run here against a fixture gateway that answers the state path and the config path as the real one does
// (200, 404 not_found, 412, 422). What the card shows is drawn from the gateway's answers as static markup.
import { afterAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { PolicyPanel } from '@/features/routing/components/PolicyPanel';
import { ProvimuxSessionReturn, SessionReturnView } from '@/provimux/routing/SessionReturn';
import { saveTime, turnOff, type Drawn } from '@/provimux/routing/sessionReturnActions';
import { sessionReturnApi, type Client } from '@/provimux/routing/sessionReturnApi';
import {
  fieldValue,
  normalizeReturn,
  type ReturnLoad,
  type ReturnSnapshot,
} from '@/provimux/routing/sessionReturnLogic';
import { timeText } from '@/provimux/routing/sessionReturnWords';

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});
await i18n.changeLanguage('en');
const t = i18n.t.bind(i18n);

type Doc = Record<string, unknown>;

// --- a gateway: the state path and the config path --------------------------------------------------------------------

const DURATION = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/;
const secondsOf = (value: unknown): number | null => {
  const match = typeof value === 'string' && value !== '' ? DURATION.exec(value) : null;
  if (!match) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
};

interface GatewayOptions {
  /** The state path exists (false: a gateway from before the rule). */
  path?: boolean;
  /** What the gateway itself decides and no file of this fixture can make: Home mode, a plugin's scheduler. */
  reason?: string;
  returned?: number;
}

function gateway(initial: Doc = {}, options: GatewayOptions = {}) {
  let routing: Doc = { 'session-affinity': true, ...initial };
  let tag = 1;
  let dropNextReply = false;
  const requests: Array<{ method: string; path: string; ifMatch?: string; body?: unknown }> = [];
  const error = (status: number | undefined, apiCode?: string, message?: string) =>
    Object.assign(new Error(message ?? apiCode ?? 'Network Error'), { status, apiCode });
  const state = () => {
    const setting = routing['session-affinity-return'] as Doc | undefined;
    const cold = secondsOf(setting?.['cold-after']);
    const affinity = routing['session-affinity'] === true;
    const reason =
      options.reason ??
      (!affinity
        ? 'session-affinity-off'
        : cold === null
          ? 'not-set'
          : routing['session-affinity-rebind-on'] === 'never'
            ? 'rebind-never'
            : cold >= 3600
              ? 'not-below-ttl'
              : null);
    return {
      observed_at: '2026-11-28T08:00:00Z',
      setting: { cold_after_s: cold },
      in_effect: reason === null,
      reason,
      ttl_s: affinity ? 3600 : null,
      counts: {
        returned: options.returned ?? 0,
        last_returned_at: null,
        since: '2026-11-28T06:00:00Z',
      },
    };
  };
  const client = {
    async getRaw(at: string) {
      requests.push({ method: 'GET', path: at });
      return { data: { routing: structuredClone(routing) }, headers: { etag: `"${tag}"` } };
    },
    async get(at: string) {
      requests.push({ method: 'GET', path: at });
      if (at === '/provimux/session-return' && options.path !== false) return state();
      throw error(404);
    },
    async put(at: string, body: Doc, config?: { headers?: Record<string, string> }) {
      const ifMatch = config?.headers?.['If-Match'];
      requests.push({ method: 'PUT', path: at, ifMatch, body });
      if (ifMatch !== `"${tag}"`) throw error(412, 'precondition_failed');
      if ((secondsOf(body['cold-after']) ?? 0) < 60) {
        throw error(
          422,
          'invalid_config',
          `parse config payload: routing.session-affinity-return.cold-after must be a duration of at least one minute ("6m", "1h30m"), got "${String(body['cold-after'])}"`
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
  const io = {
    client: client as unknown as Client,
    isCurrent: () => true,
    t,
    wait: async () => {},
  };
  return {
    io,
    requests,
    writes: () => requests.filter((request) => request.method !== 'GET'),
    file: () => routing['session-affinity-return'],
    /** The card as the page drew it: what the gateway reports now. */
    drawn: async () => (await sessionReturnApi.read(io.client)) as Drawn,
    /** Another writer changes the file. */
    setRouting: (patch: Doc) => {
      routing = { ...routing, ...patch };
      tag += 1;
    },
    dropNextReply: () => {
      dropNextReply = true;
    },
  };
}

const time = (cold: string): Doc => ({ 'session-affinity-return': { 'cold-after': cold } });
const SETTING = '/config/routing/session-affinity-return';
const stateOf = (snapshot: ReturnSnapshot) =>
  snapshot.state.kind === 'ready' ? snapshot.state.state : null;

// --- the buttons ------------------------------------------------------------------------------------------------------

describe('Save time', () => {
  test('6: one conditional PUT of {"cold-after":"6m"}, then what the gateway reports', async () => {
    const gw = gateway();
    const outcome = await saveTime('6', await gw.drawn(), gw.io);
    expect(gw.writes()).toEqual([
      { method: 'PUT', path: SETTING, ifMatch: '"1"', body: { 'cold-after': '6m' } },
    ]);
    expect(stateOf(outcome.snapshot)).toMatchObject({ coldAfterS: 360, inEffect: true });
    expect(outcome.line).toEqual({ tone: 'ok', text: 'Saved.' });
    expect(outcome.landed).toBe(true);
  });

  test('60 is written as 1h, and the gateway then reports it not below its lifetime', async () => {
    const gw = gateway(time('6m'));
    const outcome = await saveTime('60', await gw.drawn(), gw.io);
    expect(gw.file()).toEqual({ 'cold-after': '1h' });
    expect(stateOf(outcome.snapshot)).toMatchObject({
      coldAfterS: 3600,
      inEffect: false,
      reason: 'not-below-ttl',
      ttlS: 3600,
    });
    expect(outcome.landed).toBe(true);
  });

  test('an existing 90s: the field starts at 2, and saving that writes 2m', async () => {
    const gw = gateway(time('90s'));
    const drawn = await gw.drawn();
    expect(drawn.state.state.coldAfterS).toBe(90);
    expect(fieldValue(drawn.state.state)).toBe('2');
    const outcome = await saveTime(fieldValue(drawn.state.state), drawn, gw.io);
    expect(gw.file()).toEqual({ 'cold-after': '2m' });
    expect(stateOf(outcome.snapshot)?.coldAfterS).toBe(120);
  });

  test('an empty field, or anything but whole minutes, sends nothing and says what to enter', async () => {
    const gw = gateway(time('6m'));
    const drawn = await gw.drawn();
    for (const text of ['', '  ', '6m', '90s', '1.5', 'six']) {
      const outcome = await saveTime(text, drawn, gw.io);
      expect(outcome.line.text).toBe('Enter a whole number of minutes.');
      expect(outcome.landed).toBe(false);
      expect(outcome.snapshot).toBe(drawn);
    }
    expect(gw.writes()).toEqual([]);
  });

  test('a value the gateway refuses (422) writes nothing, and its own words are the line', async () => {
    const gw = gateway(time('6m'));
    const outcome = await saveTime('0', await gw.drawn(), gw.io);
    expect(gw.file()).toEqual({ 'cold-after': '6m' });
    expect(outcome.line.tone).toBe('error');
    expect(outcome.line.text).toContain('The gateway refused the change:');
    expect(outcome.line.text).toContain('routing.session-affinity-return.cold-after must be a');
    expect(outcome.landed).toBe(false);
  });

  test('a file another writer changed since the read (412) is not written', async () => {
    const gw = gateway(time('6m'));
    const drawn = await gw.drawn();
    gw.setRouting({ 'request-retry': 2 });
    const outcome = await saveTime('8', drawn, gw.io);
    expect(gw.file()).toEqual({ 'cold-after': '6m' });
    expect(outcome.line.text).toContain('The configuration file changed since this page read it');
    expect(outcome.landed).toBe(false);
  });

  test('nothing is sent when the gateway no longer reports what the card showed', async () => {
    const gw = gateway(time('6m'));
    const drawn = await gw.drawn();
    gw.setRouting({ 'session-affinity': false });
    const outcome = await saveTime('8', drawn, gw.io);
    expect(gw.writes()).toEqual([]);
    expect(outcome.line.text).toContain("Nothing was sent: the gateway's setting changed");
    expect(stateOf(outcome.snapshot)?.reason).toBe('session-affinity-off');
  });

  test('a lost reply: said so, with what the gateway reports now, and the field can close', async () => {
    const gw = gateway();
    const drawn = await gw.drawn();
    gw.dropNextReply();
    const outcome = await saveTime('6', drawn, gw.io);
    expect(outcome.line.text).toBe(
      'The gateway did not confirm the save. The card shows what it reports now.'
    );
    expect(stateOf(outcome.snapshot)).toMatchObject({ coldAfterS: 360, inEffect: true });
    expect(outcome.landed).toBe(true);
  });
});

describe('Turn off', () => {
  test('one conditional DELETE of the key, then off', async () => {
    const gw = gateway(time('6m'));
    const outcome = await turnOff(await gw.drawn(), gw.io);
    expect(gw.writes()).toEqual([{ method: 'DELETE', path: SETTING, ifMatch: '"1"' }]);
    expect(gw.file()).toBeUndefined();
    expect(stateOf(outcome.snapshot)).toMatchObject({ coldAfterS: null, inEffect: false });
    expect(outcome.line).toEqual({ tone: 'ok', text: 'Saved.' });
    expect(outcome.landed).toBe(true);
  });
});

describe('reading', () => {
  test('a gateway without the path (404) is asked once: no configuration, nothing more', async () => {
    const gw = gateway({}, { path: false });
    expect((await sessionReturnApi.read(gw.io.client)).state).toEqual({ kind: 'absent' });
    expect(gw.requests).toEqual([{ method: 'GET', path: '/provimux/session-return' }]);
  });

  test('an answer that is not the state is a failed read, never "off"', () => {
    expect(normalizeReturn({ setting: { cold_after_s: null } })).toBeNull();
    expect(normalizeReturn({ in_effect: false })).toBeNull();
    expect(normalizeReturn('ok')).toBeNull();
  });
});

// --- what the card shows ----------------------------------------------------------------------------------------------

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/⁠/g, '')
    .replace(/\s+/g, ' ');
const nothing = () => undefined;
const view = (load: ReturnLoad, draft: string | null = null) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(SessionReturnView, {
        id: 'x',
        load,
        draft,
        busy: false,
        message: null,
        onRead: nothing,
        onOpen: nothing,
        onDraft: nothing,
        onSave: nothing,
        onTurnOff: nothing,
      })
    )
  );
/** The card for a gateway with this file: closed, or with the field open on `draft`. */
const card = async (file: Doc, options: GatewayOptions = {}, draft: string | null = null) =>
  view((await gateway(file, options).drawn()).state, draft);

describe('the card', () => {
  test('in effect: what the gateway decides, with the saved time, and the counter by its name', async () => {
    const shown = text(await card(time('6m'), { returned: 12 }));
    expect(shown).toContain('Back to the first account In effect');
    expect(shown).toContain(
      'After 6 min without a message routed to an account, the gateway can try a higher-priority account on the next message.'
    );
    expect(shown).toContain('Automatic returns attempted since startup: 12');
    expect(shown).toContain('Change Turn off');
    // A saved time that is not whole minutes is shown as it is.
    expect(text(await card(time('90s')))).toContain('After 1 min 30 s without a message routed');
  });

  test('no time: one sentence, also as installed with session affinity off', async () => {
    for (const file of [{}, { 'session-affinity': false }]) {
      const shown = text(await card(file));
      expect(shown).toContain('Back to the first account Off');
      expect(shown).toContain('No automatic return time is set.');
      expect(shown).toContain('Set a time');
      expect(shown).not.toContain('Turn off');
      expect(shown).not.toContain('Session affinity is off');
      expect(shown).not.toContain('Automatic returns attempted');
    }
  });

  test('the saved time stays beside every reason it does not run, also while the field is open', async () => {
    const cases: Array<[Doc, GatewayOptions, string, string | null]> = [
      [
        { ...time('90s'), 'session-affinity': false },
        {},
        'Session affinity is off. Turn it on above and save.',
        null,
      ],
      [
        { ...time('90s'), 'session-affinity-rebind-on': 'never' },
        {},
        'session-affinity-rebind-on is "never", and automatic return does not run with that setting.',
        '/config',
      ],
      [
        time('90s'),
        { reason: 'home-mode' },
        'The gateway is in Home mode, where automatic return does not run.',
        null,
      ],
      [
        time('90s'),
        { reason: 'plugin-scheduler' },
        "A plugin's scheduler is in use, and automatic return does not run with one.",
        '/plugins',
      ],
      [
        time('90s'),
        { reason: 'a-reason-of-a-later-gateway' },
        'The gateway gives this reason: a-reason-of-a-later-gateway.',
        null,
      ],
    ];
    for (const [file, options, words, link] of cases) {
      const markup = await card(file, options);
      expect(text(markup)).toContain('Back to the first account Not in effect');
      expect(text(markup)).toContain('Saved time: 1 min 30 s');
      expect(text(markup)).toContain(words);
      expect(/href="([^"]+)"/.exec(markup)?.[1] ?? null).toBe(link);
      expect(text(await card(file, options, '2'))).toContain('Saved time: 1 min 30 s');
    }
    const long = text(await card(time('1h5m')));
    expect(long).toContain('Saved time: 1 h 5 min');
    expect(long).toContain("1 h 5 min is not shorter than session affinity's lifetime (1 h)");
  });

  test('the field open: an empty one says what to enter and cannot be saved; Turn off stays in reach', async () => {
    const empty = await card(time('6m'), {}, '');
    expect(text(empty)).toContain('Automatic return time');
    expect(text(empty)).toContain('Enter a whole number of minutes.');
    expect(empty).toMatch(/<button[^>]*disabled=""[^>]*type="submit"/);
    expect(text(empty)).toContain('Save time Cancel Turn off');

    const filled = await card({}, {}, '6');
    expect(text(filled)).not.toContain('Enter a whole number of minutes.');
    expect(filled).not.toMatch(/<button[^>]*disabled=""[^>]*type="submit"/);
    // Nothing to turn off while no time is set.
    expect(text(filled)).toContain('Save time Cancel');
    expect(text(filled)).not.toContain('Turn off');
  });

  test('the field open on a saved 90s says where it starts', async () => {
    const shown = text(await card(time('90s'), {}, '2'));
    expect(shown).toContain(
      'The saved time is 1 min 30 s. The field takes whole minutes, so it starts at 2.'
    );
    expect(text(await card(time('6m'), {}, '6'))).not.toContain('The field takes whole minutes');
  });

  test("a time that reaches session affinity's lifetime is said to do nothing before it is saved", async () => {
    const words =
      'Session affinity releases an unused conversation after 1 h, so 1 h 5 min would do nothing.';
    expect(text(await card(time('6m'), {}, '65'))).toContain(words);
    expect(text(await card(time('6m'), {}, '59'))).not.toContain('would do nothing');
    // With session affinity off the gateway reports no lifetime: nothing to compare with.
    expect(text(await card({ ...time('6m'), 'session-affinity': false }, {}, '65'))).not.toContain(
      'would do nothing'
    );
  });

  test('the conditions sit behind "How it decides", closed, with the setting\'s name', async () => {
    const markup = await card(time('6m'));
    const details = markup.slice(markup.indexOf('<details'));
    expect(details).not.toContain('open=""');
    expect(text(details)).toContain('How it decides');
    expect(text(details)).toContain('A pinned turn stays on its account.');
    expect(text(details)).toContain(
      'A message refused before an account was chosen does not restart the wait.'
    );
    expect(details).toContain('<code>routing.session-affinity-return.cold-after</code>');
  });

  test('a read that failed says so, with Read again', () => {
    const shown = text(view({ kind: 'error', message: 'boom' }));
    expect(shown).toContain('Could not read this setting from the gateway: boom');
    expect(shown).toContain('Read again');
  });

  test('times in words keep the seconds and the fraction the file holds', () => {
    expect([360, 3900, 3600, 90, 60.9].map((seconds) => timeText(t, seconds))).toEqual([
      '6 min',
      '1 h 5 min',
      '1 h',
      '1 min 30 s',
      '1 min 0.9 s',
    ]);
  });
});

describe('on the Routing page', () => {
  const panel = (afterAffinity: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(PolicyPanel, {
          settings: {
            strategy: 'round-robin',
            sessionAffinity: true,
            requestRetry: 0,
            maxRetryCredentials: 0,
          },
          onChange: nothing,
          afterAffinity,
        })
      )
    );
  const inPanel = (load: ReturnLoad) =>
    panel(
      createElement(SessionReturnView, {
        id: 'x',
        load,
        draft: null,
        busy: false,
        message: null,
        onRead: nothing,
        onOpen: nothing,
        onDraft: nothing,
        onSave: nothing,
        onTurnOff: nothing,
      })
    );

  test('the card sits right under Session affinity, before Failover', async () => {
    const shown = text(inPanel((await gateway(time('6m')).drawn()).state));
    expect(shown.indexOf('Session affinity')).toBeLessThan(shown.indexOf('Back to the first'));
    expect(shown.indexOf('Back to the first')).toBeLessThan(shown.indexOf('Failover'));
  });

  test('a gateway without the path (404): one line beside the other controls, nothing else of the card', () => {
    const markup = inPanel({ kind: 'absent' });
    expect(text(markup)).toContain('Automatic return needs Provimux v8.1.7-pmx.5 or later.');
    expect(text(markup)).not.toContain('Back to the first account');
    expect(text(markup)).not.toContain('Set a time');
    // The page's own controls are all there.
    expect(text(markup)).toContain('Session affinity');
    expect(text(markup)).toContain('Failover');
    expect(markup.match(/type="number"/g)?.length).toBe(2);
  });

  test('nothing is drawn before the gateway answers', () => {
    expect(text(panel(createElement(ProvimuxSessionReturn)))).not.toMatch(
      /Back to the first|Automatic return/
    );
  });
});

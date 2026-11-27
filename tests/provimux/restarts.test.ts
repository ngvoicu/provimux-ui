// Restarts (Provimux): what a restart does to the answers in flight (server.restart-drain-seconds) and to the
// conversations under way (routing.session-affinity-persist), as the gateway's two state paths report them:
// GET /provimux/restart-drain (design/restart-drain-state.md) and GET /provimux/session-affinity-persist. The page keeps
// no copy of the gateway's rules and is a control only where a path answers. The five findings of the review of
// 7e9108ee each have a test below ("finding 1" to "finding 5"), on the review's own cases.
import { afterAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { PROVIMUX_PAGES, provimuxNav } from '@/provimux/nav';
import { provimuxEntry, type PresenceEntry } from '@/provimux/presence';
import { DrainCard } from '@/provimux/pages/restarts/DrainCard';
import { NextRestart } from '@/provimux/pages/restarts/NextRestart';
import { PersistCard } from '@/provimux/pages/restarts/PersistCard';
import {
  describeDrainWrite,
  describePersistWrite,
  messagesAfterRead,
  messagesAfterWrite,
  type OnWrite,
} from '@/provimux/pages/restarts/restartsWords';

import { restartsApi, type Client } from '@/provimux/pages/restarts/restartsApi';
import {
  DRAIN_IN_FILE_SINCE,
  STATE_SINCE,
  STEP_TONES,
  conversationsStep,
  gatewayKind,
  lastError,
  normalizeDrain,
  normalizePersist,
  probesSay,
  startOutcome,
  supportSince,
  type DrainLoad,
  type PersistLoad,
} from '@/provimux/pages/restarts/restartsLogic';
import {
  readAll,
  runWrite,
  type Snapshot,
  type WriteSpec,
} from '@/provimux/pages/restarts/restartsWrite';

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

type Doc = Record<string, unknown>;

// --- a gateway: the generic config path, the two state paths, as the branch session-persist-on-pmx3 answers ----------

interface GatewayOptions {
  /** The two state paths exist (false: v8.1.7-pmx.3 and older). */
  paths?: boolean;
  /** The reply to the next write is lost after the write lands (finding 5). */
  dropNextReply?: boolean;
}

/**
 * One configuration file and the process that runs it. A write lands in the file, then the process reloads it unless it
 * refuses the value (anything but a whole number): it then keeps the configuration before. The drain state and the
 * persist state are computed as the gateway computes them (the fixture is the gateway, so it holds its rules).
 */
function gateway(initial: Doc, options: GatewayOptions = {}) {
  let file = structuredClone(initial);
  let running = structuredClone(initial);
  let tag = 1;
  let paths = options.paths ?? true;
  let dropNextReply = options.dropNextReply ?? false;
  const requests: Array<{ method: string; path: string; ifMatch?: string; body?: unknown }> = [];
  const error = (status: number | undefined, apiCode?: string) =>
    Object.assign(new Error(apiCode ?? 'Network Error'), { status, apiCode });
  const section = (doc: Doc, key: string) => (doc[key] ?? {}) as Doc;
  const reload = () => {
    const drain = section(file, 'server')['restart-drain-seconds'];
    if (drain === undefined || Number.isInteger(drain)) running = structuredClone(file);
  };
  const drainState = () => {
    const server = section(running, 'server');
    const shutdown = Number(server['shutdown-timeout'] ?? 0);
    const fallback = Math.max(25, shutdown);
    const value = server['restart-drain-seconds'];
    const seconds = Number.isInteger(value) ? Math.min(30, Math.max(0, value as number)) : fallback;
    const written = section(file, 'server')['restart-drain-seconds'];
    const set = written !== undefined;
    const accepted = set && Number.isInteger(written);
    return {
      seconds,
      waits_at_most: Math.min(seconds, 30),
      set,
      ...(set
        ? {
            written: typeof written === 'string' ? JSON.stringify(written) : String(written),
            written_accepted: accepted,
            ...(accepted
              ? { written_seconds: Math.min(30, Math.max(0, written as number)) }
              : {
                  written_error:
                    'server.restart-drain-seconds must be a whole number of seconds from 0 to 30',
                }),
          }
        : {}),
      default: fallback,
      shutdown_timeout: shutdown,
      min: 0,
      max: 30,
      stop_limit: 30,
    };
  };
  const persistState = () => {
    const routing = section(running, 'routing');
    const set = routing['session-affinity-persist'] !== undefined;
    const setting = set ? routing['session-affinity-persist'] === true : true;
    const reason =
      routing['session-affinity'] !== true ? 'session-affinity-off' : !setting ? 'switch-off' : '';
    return {
      setting,
      set,
      in_effect: reason === '',
      ...(reason ? { reason } : {}),
      last_bindings: 0,
      left_out_account_unverified: 0,
      left_out_no_account_identity: 0,
      start_note: 'no snapshot',
    };
  };
  const keyOf = (path: string) => path.replace(/^\/config\//, '').split('/');
  const client = {
    async getRaw(path: string) {
      requests.push({ method: 'GET', path });
      return { data: structuredClone(file), headers: { etag: `"${tag}"` } };
    },
    async get(path: string) {
      requests.push({ method: 'GET', path });
      if (path === '/provimux/restart-drain' && paths) return drainState();
      if (path === '/provimux/session-affinity-persist' && paths) return persistState();
      throw error(404);
    },
    async put(path: string, body: unknown, config?: { headers?: Record<string, string> }) {
      const ifMatch = config?.headers?.['If-Match'];
      requests.push({ method: 'PUT', path, ifMatch, body });
      if (!paths) throw error(400, 'invalid_config');
      if (ifMatch !== `"${tag}"`) throw error(412, 'precondition_failed');
      const [name, key] = keyOf(path);
      file = { ...file, [name]: { ...section(file, name), [key]: body } };
      tag += 1;
      reload();
      if (dropNextReply) {
        dropNextReply = false;
        throw error(undefined);
      }
      return { status: 'ok' };
    },
    async delete(path: string, config?: { headers?: Record<string, string> }) {
      const ifMatch = config?.headers?.['If-Match'];
      requests.push({ method: 'DELETE', path, ifMatch });
      if (ifMatch !== `"${tag}"`) throw error(412, 'precondition_failed');
      const [name, key] = keyOf(path);
      const node = { ...section(file, name) };
      if (!(key in node)) throw error(404, 'not_found');
      delete node[key];
      file = { ...file, [name]: node };
      tag += 1;
      reload();
      return { status: 'ok' };
    },
  };
  return {
    client: client as unknown as Client,
    requests,
    writes: () => requests.filter((request) => request.method !== 'GET'),
    file: () => file,
    /** The file edited by hand, then the process's reload (refused for a value that is not a whole number). */
    edit(change: (doc: Doc) => void) {
      change(file);
      tag += 1;
      reload();
    },
    /** The gateway behind the same address replaced by one without the state paths, with the same file. */
    rollBack() {
      paths = false;
    },
  };
}

const deps = (gw: ReturnType<typeof gateway>, current: Snapshot) => ({
  client: gw.client,
  current,
  read: readAll,
  isCurrent: () => true,
  wait: async () => undefined,
});

const drainSpec = (
  current: Snapshot,
  send: WriteSpec['send'],
  shows: (state: { seconds: number; set: boolean }) => boolean
): WriteSpec => ({
  check: async (client) => {
    const now = await restartsApi.drain(client);
    if (now.kind === 'absent') return 'absent';
    if (now.kind !== 'ready' || current.drain.kind !== 'ready') return 'unreadable';
    return now.state.seconds === current.drain.state.seconds &&
      now.state.written === current.drain.state.written
      ? 'same'
      : 'changed';
  },
  send,
  shows: (snapshot) => snapshot.drain.kind === 'ready' && shows(snapshot.drain.state),
});

const noWrite: OnWrite = () => undefined;
const html = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const drainOf = (raw: Doc): DrainLoad => ({ kind: 'ready', state: normalizeDrain(raw)! });
const persistOf = (raw: Doc): PersistLoad => ({ kind: 'ready', state: normalizePersist(raw)! });
const drainCard = (
  drain: DrainLoad,
  version = 'dev',
  kind: 'provimux' | 'not-provimux' | 'unknown' = 'provimux'
) =>
  html(
    createElement(DrainCard, {
      drain,
      writable: true,
      kind,
      version,
      busy: false,
      message: null,
      onWrite: noWrite,
    })
  );
const persistCard = (persist: PersistLoad) =>
  html(
    createElement(PersistCard, {
      persist,
      writable: true,
      kind: 'provimux',
      version: 'dev',
      busy: false,
      message: null,
      onWrite: noWrite,
    })
  );

/** The design note's examples (design/restart-drain-state.md). */
const DRAIN = {
  unset: {
    seconds: 25,
    waits_at_most: 25,
    set: false,
    default: 25,
    shutdown_timeout: 0,
    min: 0,
    max: 30,
    stop_limit: 30,
  },
  zero: {
    seconds: 0,
    waits_at_most: 0,
    set: true,
    written: '0',
    written_accepted: true,
    written_seconds: 0,
    default: 25,
    shutdown_timeout: 0,
    min: 0,
    max: 30,
    stop_limit: 30,
  },
  ten: {
    seconds: 10,
    waits_at_most: 10,
    set: true,
    written: '10',
    written_accepted: true,
    written_seconds: 10,
    default: 25,
    shutdown_timeout: 0,
    min: 0,
    max: 30,
    stop_limit: 30,
  },
  clamped: {
    seconds: 30,
    waits_at_most: 30,
    set: true,
    written: '45',
    written_accepted: true,
    written_seconds: 30,
    written_clamped: true,
    default: 25,
    shutdown_timeout: 0,
    min: 0,
    max: 30,
    stop_limit: 30,
  },
  quoted: {
    seconds: 10,
    waits_at_most: 10,
    set: true,
    written: '"10"',
    written_accepted: false,
    written_error:
      'server.restart-drain-seconds must be a whole number of seconds from 0 to 30, got "10"',
    default: 25,
    shutdown_timeout: 0,
    min: 0,
    max: 30,
    stop_limit: 30,
  },
  float: {
    seconds: 10,
    waits_at_most: 10,
    set: true,
    written: '30.0',
    written_accepted: false,
    written_error:
      'server.restart-drain-seconds must be a whole number of seconds from 0 to 30, got "30.0"',
    default: 25,
    shutdown_timeout: 0,
    min: 0,
    max: 30,
    stop_limit: 30,
  },
  shutdown28: {
    seconds: 28,
    waits_at_most: 28,
    set: false,
    default: 28,
    shutdown_timeout: 28,
    min: 0,
    max: 30,
    stop_limit: 30,
  },
  shutdown60: {
    seconds: 60,
    waits_at_most: 30,
    set: false,
    default: 60,
    shutdown_timeout: 60,
    min: 0,
    max: 30,
    stop_limit: 30,
  },
};

const UNSET_ON = {
  setting: true,
  set: false,
  in_effect: true,
  snapshot: '/data/kv.db.affinity',
  key: '/data/kv.db.affinity-key',
  last_bindings: 0,
  left_out_account_unverified: 0,
  left_out_no_account_identity: 0,
  start_note: 'no snapshot',
};

describe('the drain card shows only what GET /provimux/restart-drain reports', () => {
  test('the wait in use, its source and the default mark come from the path', async () => {
    await i18n.changeLanguage('en');
    expect(text(drainCard(drainOf(DRAIN.unset)))).toContain('Up to 25 seconds');
    expect(text(drainCard(drainOf(DRAIN.zero)))).toContain('No wait');
    expect(text(drainCard(drainOf(DRAIN.ten)))).toContain('Up to 10 seconds');
    const clamped = text(drainCard(drainOf(DRAIN.clamped)));
    expect(clamped).toContain('Up to 30 seconds');
    expect(clamped).toContain('The configuration file says 45; the gateway uses 30');
    const long = text(drainCard(drainOf(DRAIN.shutdown60)));
    expect(long).toContain('Up to 30 seconds');
    expect(long).toContain(
      'The gateway ends a stop after at most 30 seconds, so it waits 30 seconds at most.'
    );
    // The slider's "default" mark stands at the default the path reports (28), not at a fixed 25.
    const card28 = drainCard(drainOf(DRAIN.shutdown28));
    expect(text(card28)).toContain('Up to 28 seconds');
    expect(text(card28)).toContain('server.shutdown-timeout: 28');
    const mark = /<span(?: class="[^"]*")? style="left:([\d.]+)%;--at:[\d.]+">default<\/span>/.exec(
      card28
    );
    expect(Number(mark?.[1])).toBeCloseTo(((28 - 1) / 29) * 100, 5);
  });

  test('finding 1: a value the gateway refuses is shown as written, with the wait still in use, never as "No wait"', async () => {
    await i18n.changeLanguage('en');
    for (const refused of [DRAIN.quoted, DRAIN.float]) {
      const card = text(drainCard(drainOf(refused)));
      expect(card).toContain(
        `The configuration file says ${refused.written}, which the gateway refuses.`
      );
      expect(card).toContain(
        'While the file holds it, the gateway keeps its last valid wait, shown above, and a restart with this file fails to start.'
      );
      expect(card).not.toContain('until it restarts');
      expect(card).toContain('Up to 10 seconds');
      expect(card).not.toContain('No wait');
      expect(card).not.toContain('Off ');
    }
    // The review's case on a gateway: started with 10, the file edited to "10" by hand; the reload is refused.
    const gw = gateway({ server: { 'restart-drain-seconds': 10 } });
    gw.edit((doc) => {
      (doc.server as Doc)['restart-drain-seconds'] = '10';
    });
    const read = await restartsApi.drain(gw.client);
    expect(read.kind === 'ready' && read.state).toMatchObject({
      seconds: 10,
      written: '"10"',
      writtenAccepted: false,
    });
  });

  test('a gateway without the path gets no control and no value; 8.1.7-pmx.3 is told where the setting is', async () => {
    await i18n.changeLanguage('en');
    expect(DRAIN_IN_FILE_SINCE.label).toBe('8.1.7-pmx.3');
    // The release that brings both state paths (restartsLogic.ts, STATE_SINCE).
    expect(STATE_SINCE?.label).toBe('8.1.7-pmx.4');
    const tag = drainCard({ kind: 'absent' }, '8.1.7-pmx.3');
    expect(tag).not.toContain('type="checkbox"');
    expect(tag).not.toContain('type="range"');
    const words = text(tag);
    expect(words).toContain('This Provimux (8.1.7-⁠pmx.3) has this setting but does not report it');
    expect(words).toContain('set server.restart-drain-seconds in its configuration file');
    expect(words).toContain('The console shows and changes it from Provimux 8.1.7-\u2060pmx.4.');
    expect(words).not.toMatch(/\d+ seconds?/);
    expect(text(drainCard({ kind: 'absent' }, '8.1.7-pmx.2'))).toContain(
      'This Provimux (8.1.7-⁠pmx.2) does not have this setting.'
    );
    expect(text(drainCard({ kind: 'absent' }, '8.1.7', 'not-provimux'))).toContain(
      'is not Provimux'
    );
    expect(text(drainCard({ kind: 'absent' }, 'dev'))).toContain(
      'This gateway does not report this setting'
    );
  });

  test('a bare version is "not Provimux" only when no Provimux endpoint answers', () => {
    expect(gatewayKind('8.1.7', 'unsupported', false)).toBe('not-provimux');
    expect(gatewayKind('8.1.7', 'ready', false)).toBe('provimux');
    expect(gatewayKind('8.1.7', 'unknown', false)).toBe('unknown');
    expect(gatewayKind('dev', 'unknown', true)).toBe('provimux');
    expect(gatewayKind('8.1.7-pmx.2', 'unsupported', false)).toBe('provimux');
    // Probes say "unsupported" only when every one answered 404; a failed probe says nothing about absence.
    expect(probesSay(['unsupported', 'unsupported', 'unsupported', 'unsupported'])).toBe(
      'unsupported'
    );
    expect(probesSay(['unsupported', 'error', 'unsupported', 'unsupported'])).toBe('unknown');
    expect(probesSay(['unsupported', 'probing'])).toBe('unknown');
    expect(probesSay(['error', 'ready'])).toBe('ready');
    expect(supportSince('8.1.7-pmx.3', DRAIN_IN_FILE_SINCE)).toEqual({ kind: 'yes' });
    expect(supportSince('8.1.7-pmx.2', DRAIN_IN_FILE_SINCE).kind).toBe('older');
  });
});

describe('conversations: the card and the summary say what the state reports, never more', () => {
  test('finding 2: a save says what was saved, then what the gateway reports', async () => {
    await i18n.changeLanguage('en');
    // The review's case: session affinity off, the switch turned off, then back to its default.
    const gw = gateway({ routing: { 'session-affinity': false } });
    let current = await readAll(gw.client);
    const persistSpec = (
      send: WriteSpec['send'],
      shows: (s: { set: boolean; setting: boolean }) => boolean
    ): WriteSpec => ({
      check: async () => 'same',
      send,
      shows: (snapshot) => snapshot.persist.kind === 'ready' && shows(snapshot.persist.state),
    });
    let run = await runWrite(
      persistSpec(
        (etag, client) => restartsApi.persistOff(etag, client),
        (s) => s.set && !s.setting
      ),
      deps(gw, current)
    );
    current = run.snapshot!;
    run = await runWrite(
      persistSpec(
        (etag, client) => restartsApi.persistToDefault(etag, client),
        (s) => !s.set
      ),
      deps(gw, current)
    );
    expect(run.result).toEqual({ kind: 'saved', shown: true });
    expect(run.snapshot!.persist).toMatchObject({
      kind: 'ready',
      state: { setting: true, set: false, inEffect: false, reason: 'session-affinity-off' },
    });
    const line = describePersistWrite(i18n.t.bind(i18n), run.result, run.snapshot!).text;
    expect(line).toBe('Saved. The gateway reports it not in effect, for the reason above.');
    expect(line).not.toContain('go back');
    // In effect: only then may the card say so, and it never promises a cache hit or every conversation.
    const inEffect = describePersistWrite(i18n.t.bind(i18n), run.result, {
      ...run.snapshot!,
      persist: persistOf(UNSET_ON),
    }).text;
    expect(inEffect).toBe('Saved. The gateway reports it in effect.');
    const card = text(persistCard(persistOf(UNSET_ON)));
    expect(card).toContain(
      'At the next start, conversations that send their own session id go back to the account they were on, if the gateway still recognises it'
    );
    expect(card).toContain(
      'so the provider can read their prompt cache again, if it still holds it'
    );
    expect(card).not.toContain('usually');
    expect(card).toContain(
      'for the conversations and accounts it can recognise; the counts below say how many were left out'
    );
    expect(card).toContain(
      'Not restored: a conversation without its own session id on a gateway with client keys'
    );
    expect(card).not.toMatch(/each conversation goes back/i);
  });

  test('finding 3: the summary claims only what the page could read', async () => {
    await i18n.changeLanguage('en');
    // A persist 404 is "cannot tell", whatever else was or was not read.
    expect(conversationsStep({ kind: 'absent' })).toBe('unreported');
    expect(conversationsStep({ kind: 'error', message: 'timeout' })).toBe('unread');
    // in-use still restores an authenticated snapshot: not "routing picks again", and never green.
    const inUse = persistOf({ ...UNSET_ON, in_effect: false, reason: 'in-use' });
    expect(conversationsStep(inUse)).toBe('in-use');
    expect(STEP_TONES['in-use']).not.toBe('ok');
    expect(STEP_TONES.unread).not.toBe('ok');
    const summary = text(
      html(
        createElement(NextRestart, {
          drain: { kind: 'absent' },
          persist: { kind: 'absent' },
        })
      )
    );
    expect(summary).toContain(
      'The page cannot tell: this gateway does not report what it keeps across a restart.'
    );
    expect(summary).toContain('This gateway does not report how long it waits.');
    expect(summary).not.toContain('Session affinity');
    const busy = text(
      html(createElement(NextRestart, { drain: drainOf(DRAIN.ten), persist: inUse }))
    );
    expect(busy).toContain("Another Provimux on the same store holds the snapshot's lock");
    expect(busy).not.toContain('routing picks');
    // A file the gateway could not remove after the switch was turned off: the card says so.
    const leftover = normalizePersist({
      ...UNSET_ON,
      setting: false,
      set: true,
      in_effect: false,
      reason: 'switch-off',
      last_error:
        'files of an earlier run not removed: remove /data/kv.db.affinity: permission denied',
    })!;
    expect(lastError(leftover)).toEqual({
      kind: 'not-removed',
      message: 'remove /data/kv.db.affinity: permission denied',
    });
    expect(text(persistCard({ kind: 'ready', state: leftover }))).toContain(
      'The gateway could not remove its own files from an earlier run: remove /data/kv.db.affinity: permission denied'
    );
  });

  test('session affinity is never read from the file: yes, on, true and false all leave the page unable to tell', async () => {
    await i18n.changeLanguage('en');
    // 8.1.7-pmx.3 has no persist state path; the generic config read hands back the file's raw YAML value.
    for (const value of ['yes', 'on', true, false]) {
      const gw = gateway({ routing: { 'session-affinity': value } }, { paths: false });
      const snapshot = await readAll(gw.client);
      expect(snapshot.config.kind).toBe('ready');
      expect(snapshot.persist).toEqual({ kind: 'absent' });
      expect(conversationsStep(snapshot.persist)).toBe('unreported');
      const summary = text(
        html(createElement(NextRestart, { drain: snapshot.drain, persist: snapshot.persist }))
      );
      expect(summary).toContain(
        'The page cannot tell: this gateway does not report what it keeps across a restart.'
      );
      expect(summary).not.toContain('Session affinity');
      expect(summary).not.toContain('routing picks');
      expect(text(persistCard(snapshot.persist))).not.toContain('routing picks');
    }
  });

  test('the start note: "no snapshot" is the normal first state; a disk that did not answer is a failure', () => {
    expect(startOutcome(normalizePersist(UNSET_ON)!)).toEqual({ kind: 'no-snapshot' });
    expect(
      startOutcome(normalizePersist({ ...UNSET_ON, start_note: 'nothing restored: switch-off' })!)
    ).toEqual({
      kind: 'not-in-effect',
    });
    expect(
      startOutcome(
        normalizePersist({
          ...UNSET_ON,
          start_note: 'nothing restored: the disk did not answer within 1.5s',
        })!
      )
    ).toEqual({ kind: 'failed', message: 'the disk did not answer within 1.5s' });
    const counted = normalizePersist({ ...UNSET_ON, left_out_no_account_identity: 3 })!;
    expect(counted.leftOutNoIdentity).toBe(3);
    expect(text(persistCard({ kind: 'ready', state: counted }))).toContain(
      '3 left out: their accounts have no identity the gateway can recognise after a restart.'
    );
  });

  test('every control names a description that is on the page', async () => {
    await i18n.changeLanguage('en');
    const notInEffect = persistOf({ ...UNSET_ON, in_effect: false, reason: 'kv-store-off' });
    for (const markup of [
      persistCard(notInEffect),
      persistCard(persistOf(UNSET_ON)),
      drainCard(drainOf(DRAIN.zero)),
    ]) {
      for (const [, ids] of markup.matchAll(/aria-describedby="([^"]+)"/g)) {
        for (const id of ids.split(' ')) expect(markup).toContain(`id="${id}"`);
      }
    }
  });
});

describe('writes: one key each, asked again first, and said as the gateway reports it', () => {
  test('finding 4: a tab left open across a switch to a gateway without the path sends nothing', async () => {
    await i18n.changeLanguage('en');
    const gw = gateway({ server: { 'restart-drain-seconds': 10 } });
    const current = await readAll(gw.client);
    gw.rollBack();
    const run = await runWrite(
      drainSpec(
        current,
        (etag, client) => restartsApi.setDrain(etag, 0, client),
        (s) => s.seconds === 0
      ),
      deps(gw, current)
    );
    expect(run.result).toEqual({ kind: 'stale', why: 'absent' });
    expect(gw.writes()).toEqual([]);
    expect(run.snapshot!.drain).toEqual({ kind: 'absent' });
    expect(describeDrainWrite(i18n.t.bind(i18n), run.result, run.snapshot!).text).toBe(
      'Nothing was sent: the gateway no longer reports this setting; it may have been replaced by another version. The page shows what it reports now.'
    );
    // The value changed by hand since the card was drawn: nothing is sent either.
    const other = gateway({ server: { 'restart-drain-seconds': 10 } });
    const drawn = await readAll(other.client);
    other.edit((doc) => {
      (doc.server as Doc)['restart-drain-seconds'] = 20;
    });
    const changed = await runWrite(
      drainSpec(
        drawn,
        (etag, client) => restartsApi.setDrain(etag, 0, client),
        (s) => s.seconds === 0
      ),
      deps(other, drawn)
    );
    expect(changed.result).toEqual({ kind: 'stale', why: 'changed' });
    expect(other.writes()).toEqual([]);
  });

  test('finding 5: a reply lost after the write landed is "not confirmed", with what the gateway reports now', async () => {
    await i18n.changeLanguage('en');
    const gw = gateway({ server: { 'shutdown-timeout': 0 } }, { dropNextReply: true });
    const current = await readAll(gw.client);
    const run = await runWrite(
      drainSpec(
        current,
        (etag, client) => restartsApi.setDrain(etag, 0, client),
        (s) => s.seconds === 0
      ),
      deps(gw, current)
    );
    expect(run.result).toEqual({ kind: 'unconfirmed' });
    expect((gw.file().server as Doc)['restart-drain-seconds']).toBe(0);
    const line = describeDrainWrite(i18n.t.bind(i18n), run.result, run.snapshot!);
    expect(line.text).toBe('The gateway did not confirm the save. It now reports no wait.');
    expect(line.text).not.toContain('Not saved');
  });

  test('a "Saved…" line goes with the next read: two tabs, a change in the second, a reload in the first', async () => {
    await i18n.changeLanguage('en');
    const t = i18n.t.bind(i18n);
    const gw = gateway({
      server: { 'shutdown-timeout': 60 },
      routing: { 'session-affinity': true },
    });
    // Tab A turns the wait off: its card says so, from the read after the save.
    let a = { snapshot: await readAll(gw.client), messages: messagesAfterRead() };
    const off = await runWrite(
      drainSpec(
        a.snapshot,
        (e, c) => restartsApi.setDrain(e, 0, c),
        (s) => s.seconds === 0
      ),
      deps(gw, a.snapshot)
    );
    a = {
      snapshot: off.snapshot!,
      messages: messagesAfterWrite('drain', describeDrainWrite(t, off.result, off.snapshot!)),
    };
    expect(a.messages.drain?.text).toBe(
      'Saved. The gateway now stops without waiting for answers in flight.'
    );
    // Tab B puts the default back (60 s, so a stop waits 30 at most).
    const b = await readAll(gw.client);
    await runWrite(
      drainSpec(
        b,
        (e, c) => restartsApi.drainToDefault(e, c),
        (s) => !s.set
      ),
      deps(gw, b)
    );
    // Tab A reloads: the card shows the gateway's 30 seconds, and no line from the earlier read.
    a = { snapshot: await readAll(gw.client), messages: messagesAfterRead() };
    const card = text(
      html(
        createElement(DrainCard, {
          drain: a.snapshot.drain,
          writable: true,
          kind: 'provimux',
          version: 'dev',
          busy: false,
          message: a.messages.drain,
          onWrite: noWrite,
        })
      )
    );
    expect(card).toContain('Up to 30 seconds');
    expect(card).not.toContain('Saved.');
    // The same for the conversations' card: A turns it off, B puts the default back, A reloads.
    const persistSpec = (send: WriteSpec['send']): WriteSpec => ({
      check: async () => 'same',
      send,
      shows: () => true,
    });
    const persistOff = await runWrite(
      persistSpec((e, c) => restartsApi.persistOff(e, c)),
      deps(gw, a.snapshot)
    );
    a = {
      snapshot: persistOff.snapshot!,
      messages: messagesAfterWrite(
        'persist',
        describePersistWrite(t, persistOff.result, persistOff.snapshot!)
      ),
    };
    expect(a.messages.persist?.text).toBe('Saved. The gateway reports it off.');
    const b2 = await readAll(gw.client);
    await runWrite(
      persistSpec((e, c) => restartsApi.persistToDefault(e, c)),
      deps(gw, b2)
    );
    a = { snapshot: await readAll(gw.client), messages: messagesAfterRead() };
    const persistText = text(
      html(
        createElement(PersistCard, {
          persist: a.snapshot.persist,
          writable: true,
          kind: 'provimux',
          version: 'dev',
          busy: false,
          message: a.messages.persist,
          onWrite: noWrite,
        })
      )
    );
    expect(persistText).toContain('In effect');
    expect(persistText).not.toContain('Saved.');
    // A change in one card takes the other card's line away too: it described an earlier read.
    expect(messagesAfterWrite('persist', { tone: 'ok', text: 'x' }).drain).toBeNull();
  });

  test("each write is one key with the read's tag; a removal of an absent key is done; 412 writes nothing", async () => {
    const gw = gateway({ server: {}, routing: { 'session-affinity': true } });
    let current = await readAll(gw.client);
    const send = async (spec: WriteSpec) => {
      const run = await runWrite(spec, deps(gw, current));
      current = run.snapshot ?? current;
      return run.result;
    };
    expect(
      await send(
        drainSpec(
          current,
          (e, c) => restartsApi.setDrain(e, 15, c),
          (s) => s.seconds === 15
        )
      )
    ).toEqual({
      kind: 'saved',
      shown: true,
    });
    expect(
      await send(
        drainSpec(
          current,
          (e, c) => restartsApi.drainToDefault(e, c),
          (s) => !s.set
        )
      )
    ).toEqual({
      kind: 'saved',
      shown: true,
    });
    expect(
      await send(
        drainSpec(
          current,
          (e, c) => restartsApi.drainToDefault(e, c),
          (s) => !s.set
        )
      )
    ).toEqual({
      kind: 'saved',
      shown: true,
    });
    expect(gw.writes().map((write) => [write.method, write.path, write.body])).toEqual([
      ['PUT', '/config/server/restart-drain-seconds', 15],
      ['DELETE', '/config/server/restart-drain-seconds', undefined],
      ['DELETE', '/config/server/restart-drain-seconds', undefined],
    ]);
    expect(
      gw
        .writes()
        .every(
          (write) => write.ifMatch === '"1"' || write.ifMatch === '"2"' || write.ifMatch === '"3"'
        )
    ).toBe(true);
    // Another writer changed the file after the read: 412, nothing written, the page reads again.
    const stale = current;
    gw.edit((doc) => {
      doc.management = { 'allow-remote': false };
    });
    const before = gw.writes().length;
    const run = await runWrite(
      drainSpec(
        stale,
        (e, c) => restartsApi.setDrain(e, 5, c),
        (s) => s.seconds === 5
      ),
      deps(gw, stale)
    );
    expect(run.result).toEqual({ kind: 'changed', reread: true });
    expect((gw.file().server as Doc)['restart-drain-seconds']).toBeUndefined();
    expect(gw.writes().length).toBe(before + 1);
    // No tag: nothing is sent.
    const untagged = { ...current, config: { kind: 'ready' as const, document: {}, etag: null } };
    const none = await runWrite(
      drainSpec(
        untagged,
        (e, c) => restartsApi.setDrain(e, 5, c),
        () => true
      ),
      deps(gw, untagged)
    );
    expect(none.result).toEqual({ kind: 'no-tag' });
    expect(gw.writes().length).toBe(before + 1);
  });
});

describe('the sidebar', () => {
  const groups = () => [{ id: 'gateway', items: [{ path: '/routing' }] as object[] }];
  const ready: PresenceEntry = { status: 'ready', message: null };
  const absent: PresenceEntry = { status: 'unsupported', message: null };
  const paths = (list: ReturnType<typeof groups>) =>
    list[0].items.map((item) => (item as { path: string }).path);

  test('Restarts is listed for Provimux, after Models and Savings, and not for CLIProxyAPI', () => {
    expect(PROVIMUX_PAGES.map((page) => page.path)).toContain('/provimux/restarts');
    expect(paths(provimuxNav(groups(), { savings: ready, provimux: ready }))).toEqual([
      '/provimux/accounts',
      '/routing',
      '/provimux/models',
      '/provimux/savings',
      '/provimux/restarts',
    ]);
    expect(paths(provimuxNav(groups(), { provimux: absent }))).not.toContain('/provimux/restarts');
    expect(paths(provimuxNav(groups(), {}))).not.toContain('/provimux/restarts');
  });

  test('Provimux by its version, or by an endpoint only Provimux has', () => {
    const probes = (status: PresenceEntry['status']) => ({
      modelRoutes: { status, message: null },
      liveLists: { status, message: null },
      modelLists: { status, message: null },
      savings: { status, message: null },
    });
    expect(provimuxEntry('8.1.7-pmx.3', probes('probing')).status).toBe('ready');
    expect(provimuxEntry('dev', probes('ready')).status).toBe('ready');
    expect(provimuxEntry('8.1.7', probes('unsupported')).status).toBe('unsupported');
    expect(provimuxEntry('8.1.7', probes('probing')).status).toBe('unknown');
  });
});

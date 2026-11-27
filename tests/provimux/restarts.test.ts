// Restarts (Provimux): what a restart does to the answers being written (server.restart-drain-seconds) and to the
// conversations under way (routing.session-affinity-persist). The gateway's contract: the drain has no endpoint of its
// own (the generic config path, which writes any key on any gateway, so the version decides: 8.1.7-pmx.3 or newer).
// The persist switch is on when the file does not set it, its config path then answers 404, and only the state path
// says what is in use; a gateway without that path does not have it yet.
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
import type { Client, Write } from '@/provimux/pages/restarts/parts';
import { restartsApi, RestartsWriteError } from '@/provimux/pages/restarts/restartsApi';
import {
  DRAIN_SINCE,
  PERSIST_SINCE,
  conversationsAfter,
  drainSupport,
  nextWait,
  normalizePersist,
  persistAbsence,
  readDrain,
  startOutcome,
  type PersistAbsence,
  type PersistLoad,
} from '@/provimux/pages/restarts/restartsLogic';

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

type Doc = Record<string, unknown>;

/** The gateway's answer with nothing set and session affinity on (the gateway's worker, 2026-11-27). */
const UNSET_ON = {
  setting: true,
  set: false,
  in_effect: true,
  snapshot: '/data/kv.db.affinity',
  key: '/data/kv.db.affinity-key',
  last_bindings: 0,
  left_out_account_unverified: 0,
  start_note: 'no snapshot',
};

describe('the drain, by version and by the file', () => {
  test('only a Provimux from the first release with the setting may write it', () => {
    expect(DRAIN_SINCE.label).toBe('8.1.7-pmx.3');
    expect(drainSupport('8.1.7-pmx.3')).toEqual({ kind: 'yes' });
    expect(drainSupport('v8.1.7-pmx.12')).toEqual({ kind: 'yes' });
    expect(drainSupport('8.1.8-pmx.1')).toEqual({ kind: 'yes' });
    expect(drainSupport('8.1.7-pmx.3-2-g7f7b617b2')).toEqual({ kind: 'yes' });
    expect(drainSupport('8.1.7-pmx.2')).toEqual({ kind: 'older', version: '8.1.7-pmx.2' });
    expect(drainSupport('8.0.79-pmx.1')).toEqual({ kind: 'older', version: '8.0.79-pmx.1' });
    // A build between two releases before the first one with it may or may not carry it.
    expect(drainSupport('8.1.7-pmx.2-5-g9d0786d95').kind).toBe('unknown');
    expect(drainSupport('dev')).toEqual({ kind: 'unknown', version: 'dev' });
    expect(drainSupport(null)).toEqual({ kind: 'unknown', version: '?' });
    // CLIProxyAPI: a version without Provimux's suffix.
    expect(drainSupport('8.1.7')).toEqual({ kind: 'other', version: '8.1.7' });
  });

  test('the persist release is not known yet: a 404 says "not yet", or "not Provimux"', () => {
    expect(PERSIST_SINCE).toBeNull();
    expect(persistAbsence('8.1.7-pmx.3')).toEqual({ kind: 'not-yet' });
    expect(persistAbsence('dev')).toEqual({ kind: 'not-yet' });
    expect(persistAbsence('8.1.7')).toEqual({ kind: 'not-provimux', version: '8.1.7' });
    // Once known, an older Provimux is told which release brings it.
    const since = { base: [8, 1, 8] as const, pmx: 1, label: '8.1.8-pmx.1' };
    expect(persistAbsence('8.1.7-pmx.3', since)).toEqual({
      kind: 'older',
      version: '8.1.7-pmx.3',
      since: '8.1.8-pmx.1',
    });
    expect(persistAbsence('8.1.8-pmx.1', since)).toEqual({ kind: 'not-yet' });
  });

  test('not set: 25 seconds, or shutdown-timeout when larger, never past the 30 a stop takes', () => {
    expect(readDrain({ server: { port: 8317 } })).toMatchObject({
      set: false,
      inUse: 25,
      byDefault: 25,
    });
    expect(readDrain({ server: { 'shutdown-timeout': 0 } }).inUse).toBe(25);
    expect(readDrain({ server: { 'shutdown-timeout': 28 } }).inUse).toBe(28);
    expect(readDrain({ server: { 'shutdown-timeout': 60 } }).inUse).toBe(30);
    expect(readDrain({ server: { 'restart-drain-seconds': null } }).set).toBe(false);
    expect(readDrain({}).inUse).toBe(25);
  });

  test('set: used as written, 0 turns it off, out of range is its bound, anything else is not in use', () => {
    expect(
      readDrain({ server: { 'restart-drain-seconds': 10, 'shutdown-timeout': 20 } })
    ).toMatchObject({
      set: true,
      inUse: 10,
      clamped: false,
    });
    expect(readDrain({ server: { 'restart-drain-seconds': 0 } }).inUse).toBe(0);
    expect(readDrain({ server: { 'restart-drain-seconds': 45 } })).toMatchObject({
      inUse: 30,
      clamped: true,
    });
    expect(readDrain({ server: { 'restart-drain-seconds': -1 } })).toMatchObject({
      inUse: 0,
      clamped: true,
    });
    expect(readDrain({ server: { 'restart-drain-seconds': '10' } })).toMatchObject({
      unreadable: true,
    });
    expect(readDrain({ server: { 'restart-drain-seconds': 2.75 } })).toMatchObject({
      unreadable: true,
    });
  });

  test('the next wait: the setting where the gateway has it, upstream shutdown-timeout where not', () => {
    const doc = { server: { 'shutdown-timeout': 0 } };
    expect(nextWait({ kind: 'yes' }, readDrain(doc))).toBe(25);
    expect(nextWait({ kind: 'older', version: '8.1.7-pmx.2' }, readDrain(doc))).toBe(0);
    expect(
      nextWait(
        { kind: 'other', version: '8.1.7' },
        readDrain({ server: { 'shutdown-timeout': 15 } })
      )
    ).toBe(15);
    expect(nextWait({ kind: 'unknown', version: 'dev' }, readDrain(doc))).toBeNull();
    expect(nextWait({ kind: 'yes' }, null)).toBeNull();
  });
});

describe('the persist state', () => {
  test('an unset switch is on: the state path says so, and the page reads only it', () => {
    const state = normalizePersist(UNSET_ON)!;
    expect(state).toMatchObject({ setting: true, set: false, inEffect: true, reason: null });
    expect(conversationsAfter({ kind: 'ready', state }, true)).toBe('back');
  });

  test('"no snapshot" is the normal first start, not a failure; the start note says the rest', () => {
    expect(startOutcome(normalizePersist(UNSET_ON)!)).toEqual({ kind: 'no-snapshot' });
    expect(
      startOutcome(normalizePersist({ ...UNSET_ON, start_note: 'nothing restored: switch-off' })!)
    ).toEqual({ kind: 'not-in-effect' });
    expect(
      startOutcome(
        normalizePersist({
          ...UNSET_ON,
          start_note: undefined,
          restored_at_start: { sessions: 11, expired: 2, unknown_accounts: 1, other_build: 0 },
        })!
      )
    ).toEqual({
      kind: 'restored',
      restored: { sessions: 11, expired: 2, unknownAccounts: 1, otherBuild: 0 },
    });
    expect(
      startOutcome(
        normalizePersist({ ...UNSET_ON, start_note: 'cipher: message authentication failed' })!
      )
    ).toEqual({
      kind: 'failed',
      message: 'cipher: message authentication failed',
    });
  });

  test('what the next restart does to conversations, by state', () => {
    const off = normalizePersist({
      ...UNSET_ON,
      setting: false,
      set: true,
      in_effect: false,
      reason: 'switch-off',
    })!;
    expect(conversationsAfter({ kind: 'ready', state: off }, true)).toBe('afresh');
    const noAffinity = normalizePersist({
      ...UNSET_ON,
      in_effect: false,
      reason: 'session-affinity-off',
    })!;
    expect(conversationsAfter({ kind: 'ready', state: noAffinity }, false)).toBe('no-affinity');
    expect(conversationsAfter({ kind: 'absent' }, true)).toBe('not-kept');
    expect(conversationsAfter({ kind: 'absent' }, false)).toBe('no-affinity');
    expect(conversationsAfter({ kind: 'error', message: 'x' }, true)).toBe('unknown');
    expect(normalizePersist({ error: 'not available' })).toBeNull();
  });
});

/** A gateway's generic config path and persist state over one document, with a tag that changes on each write. */
function fakeGateway(initial: Doc, { persist = true } = {}) {
  let doc = structuredClone(initial);
  let tag = 1;
  const requests: Array<{ method: string; path: string; ifMatch?: string; body?: unknown }> = [];
  const error = (status: number, apiCode?: string) =>
    Object.assign(new Error(apiCode ?? String(status)), { status, apiCode });
  const parts = (path: string) =>
    path
      .replace(/^\/config\/?/, '')
      .split('/')
      .filter(Boolean);
  const headersOf = (config?: { headers?: Record<string, string> }) => config?.headers ?? {};
  const client = {
    async getRaw(path: string) {
      requests.push({ method: 'GET', path });
      return { data: structuredClone(doc), headers: { etag: `"${tag}"` } };
    },
    async get(path: string) {
      requests.push({ method: 'GET', path });
      if (path === '/provimux/session-affinity-persist') {
        if (!persist) throw error(404);
        const routing = (doc.routing ?? {}) as Doc;
        const set = routing['session-affinity-persist'] !== undefined;
        const setting = set ? routing['session-affinity-persist'] === true : true;
        return {
          ...UNSET_ON,
          setting,
          set,
          in_effect: setting,
          reason: setting ? undefined : 'switch-off',
        };
      }
      throw error(404, 'not_found');
    },
    async put(path: string, body: unknown, config?: { headers?: Record<string, string> }) {
      const ifMatch = headersOf(config)['If-Match'];
      requests.push({ method: 'PUT', path, ifMatch, body });
      if (ifMatch !== `"${tag}"`) throw error(412, 'precondition_failed');
      const [section, key] = parts(path);
      doc = { ...doc, [section]: { ...((doc[section] as Doc) ?? {}), [key]: body } };
      tag += 1;
      return { status: 'ok' };
    },
    async delete(path: string, config?: { headers?: Record<string, string> }) {
      const ifMatch = headersOf(config)['If-Match'];
      requests.push({ method: 'DELETE', path, ifMatch });
      if (ifMatch !== `"${tag}"`) throw error(412, 'precondition_failed');
      const [section, key] = parts(path);
      const node = { ...((doc[section] as Doc) ?? {}) };
      if (!(key in node)) throw error(404, 'not_found');
      delete node[key];
      doc = { ...doc, [section]: node };
      tag += 1;
      return { status: 'ok' };
    },
    /** Another writer changes the file. */
    touch() {
      tag += 1;
    },
  };
  return { client, requests, doc: () => doc };
}

describe('writes: one key each, conditional on the read', () => {
  test('the wait is a number at server.restart-drain-seconds, the default its removal', async () => {
    const gateway = fakeGateway({ server: { port: 8317 }, routing: { 'session-affinity': true } });
    const client = gateway.client as unknown as Client;
    let read = await restartsApi.config(client);
    await restartsApi.setDrain(read, 15, client);
    expect(gateway.doc().server).toEqual({ port: 8317, 'restart-drain-seconds': 15 });
    read = await restartsApi.config(client);
    await restartsApi.setDrain(read, 0, client);
    read = await restartsApi.config(client);
    await restartsApi.drainToDefault(read, client);
    expect(gateway.doc().server).toEqual({ port: 8317 });
    // Removing a key the file does not hold: the default applies already.
    read = await restartsApi.config(client);
    await restartsApi.drainToDefault(read, client);
    const writes = gateway.requests.filter((request) => request.method !== 'GET');
    expect(writes.map((request) => [request.method, request.path, request.body])).toEqual([
      ['PUT', '/config/server/restart-drain-seconds', 15],
      ['PUT', '/config/server/restart-drain-seconds', 0],
      ['DELETE', '/config/server/restart-drain-seconds', undefined],
      ['DELETE', '/config/server/restart-drain-seconds', undefined],
    ]);
    expect(writes.every((request) => request.ifMatch !== undefined)).toBe(true);
  });

  test('turning conversations off writes false; on is the key removed, and the state shows it', async () => {
    const gateway = fakeGateway({ routing: { 'session-affinity': true } });
    const client = gateway.client as unknown as Client;
    let read = await restartsApi.config(client);
    await restartsApi.persistOff(read, client);
    expect((gateway.doc().routing as Doc)['session-affinity-persist']).toBe(false);
    let state = (await restartsApi.persist(client)) as Extract<PersistLoad, { kind: 'ready' }>;
    expect(state.state).toMatchObject({ setting: false, set: true });
    read = await restartsApi.config(client);
    await restartsApi.persistToDefault(read, client);
    expect('session-affinity-persist' in (gateway.doc().routing as Doc)).toBe(false);
    state = (await restartsApi.persist(client)) as Extract<PersistLoad, { kind: 'ready' }>;
    expect(state.state).toMatchObject({ setting: true, set: false });
    // The persist switch is never read from its config path, which answers 404 when unset.
    expect(
      gateway.requests.some(
        (request) =>
          request.path === '/config/routing/session-affinity-persist' && request.method === 'GET'
      )
    ).toBe(false);
  });

  test('a file changed since the read is refused and nothing is written; no tag writes nothing', async () => {
    const gateway = fakeGateway({ server: {} });
    const client = gateway.client as unknown as Client;
    const read = await restartsApi.config(client);
    gateway.client.touch();
    const changed = await restartsApi.setDrain(read, 10, client).catch((error) => error);
    expect(changed).toBeInstanceOf(RestartsWriteError);
    expect((changed as RestartsWriteError).reason).toBe('changed');
    expect(gateway.doc().server).toEqual({});
    const untagged = await restartsApi
      .setDrain({ document: read.document, etag: null }, 10, client)
      .catch((error) => error);
    expect((untagged as RestartsWriteError).reason).toBe('no-tag');
    expect(gateway.requests.filter((request) => request.method === 'PUT')).toHaveLength(1);
  });

  test('a gateway without the state path is "absent", never "off"', async () => {
    const gateway = fakeGateway({}, { persist: false });
    expect(await restartsApi.persist(gateway.client as unknown as Client)).toEqual({
      kind: 'absent',
    });
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

describe('what the page says', () => {
  const noWrite: Write = async () => ({ ok: true });
  const render = (element: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, element))
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');

  test('the next restart in words, from the settings in use', async () => {
    await i18n.changeLanguage('en');
    const on = render(createElement(NextRestart, { wait: 25, conversations: 'back' }));
    expect(on).toContain('Get up to 25 seconds to finish.');
    expect(on).toContain('Each conversation goes back to the account it was on');
    const off = render(createElement(NextRestart, { wait: 0, conversations: 'afresh' }));
    expect(off).toContain('Are cut at once');
    expect(off).toContain('whichever account routing picks');
  });

  test('an older gateway gets no control, and the card says what its restart does', async () => {
    await i18n.changeLanguage('en');
    const html = renderToStaticMarkup(
      createElement(DrainCard, {
        support: { kind: 'older', version: '8.1.7-pmx.2' },
        config: { kind: 'ready', read: { document: {}, etag: '"1"' } },
        reading: readDrain({ server: { 'shutdown-timeout': 0 } }),
        write: noWrite,
      })
    );
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('type="range"');
    expect(html).toContain('does not have this setting; it comes with Provimux 8.1.7-⁠pmx.3');
    expect(html).toContain('Today a restart cuts the answers being written at once.');
    const absent = (absence: PersistAbsence, affinityOn = true) =>
      render(
        createElement(PersistCard, {
          persist: { kind: 'absent' },
          absence,
          affinityOn,
          write: noWrite,
        })
      );
    const notYet = absent({ kind: 'not-yet' });
    expect(notYet).toContain('This gateway does not have this setting yet');
    expect(notYet).toContain(
      'Today, after a restart, each conversation goes to whichever account routing picks.'
    );
    expect(notYet).not.toContain('type="checkbox"');
    expect(absent({ kind: 'not-yet' }, false)).not.toContain('Today, after a restart');
    expect(absent({ kind: 'not-provimux', version: '8.1.7' })).toContain('is not Provimux');
    expect(absent({ kind: 'older', version: '8.1.7-pmx.3', since: '8.1.8-pmx.1' })).toContain(
      'does not have this setting yet; it comes with Provimux 8.1.8-⁠pmx.1'
    );
  });

  test('an unset switch shows on and Default; the first start after an upgrade is no error', async () => {
    await i18n.changeLanguage('en');
    const html = render(
      createElement(PersistCard, {
        persist: { kind: 'ready', state: normalizePersist(UNSET_ON)! },
        absence: { kind: 'not-yet' },
        affinityOn: true,
        write: noWrite,
      })
    );
    expect(html).toContain('In effect');
    expect(html).toContain('Default');
    expect(html).toContain(
      'Nothing had been noted yet. That is normal for the first start after an upgrade'
    );
    expect(html).not.toContain('could not be read back');
  });

  test("a reason in the gateway's words, and the way to fix it", async () => {
    await i18n.changeLanguage('en');
    const html = render(
      createElement(PersistCard, {
        persist: {
          kind: 'ready',
          state: normalizePersist({
            ...UNSET_ON,
            in_effect: false,
            reason: 'session-affinity-off',
          })!,
        },
        absence: { kind: 'not-yet' },
        affinityOn: false,
        write: noWrite,
      })
    );
    expect(html).toContain('Not in effect');
    expect(html).toContain('Session affinity is off');
    expect(html).toContain('Open Routing');
  });
});

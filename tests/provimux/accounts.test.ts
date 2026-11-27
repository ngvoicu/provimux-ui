// The Accounts page (design accounts-page.md): every subscription and API key in one list, whether each works
// now, its priority; the writes it makes, each one the call the original page makes for the same change; the
// menu item that replaces AI Providers, Auth Files and OAuth Login; the Models page's `?account=` filter.
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AxiosHeaders } from 'axios';
import i18n from '../../src/i18n/index';
import { apiClient } from '@/services/api/client';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import type { AuthFilesResponse } from '@/types/authFile';
import { PROVIMUX_TRANSLATIONS } from '@/provimux/i18n';
import { readModelRoutes } from '@/provimux/api/normalize';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import { draftEntries } from '@/provimux/pages/aliases/draft';
import { startDraft } from '@/provimux/pages/aliases/draft';
import type { KeyEntry } from '@/provimux/pages/aliases/types';
import {
  EMPTY_ACCOUNTS_FILTER,
  accountFromParams,
  buildAccounts,
  groupByService,
  matchesFilter,
  summarize,
  type Account,
  type KeyAccount,
  type LoginAccount,
} from '@/provimux/pages/accounts/accounts';
import { AccountsWriteError, accountsApi } from '@/provimux/pages/accounts/accountsApi';
import { AccountsBoard } from '@/provimux/pages/accounts/AccountsBoard';
import { AccountSheet } from '@/provimux/pages/accounts/AccountSheet';
import { parsePriority, statusSentence } from '@/provimux/pages/accounts/sheetLogic';
import { AddAccountSheet } from '@/provimux/pages/accounts/AddAccountSheet';
import { firstStep } from '@/provimux/pages/accounts/addSteps';
import {
  KeyWriteError,
  familyWithKeyAdded,
  familyWithKeyOn,
  familyWithKeyReplaced,
  familyWithPriority,
  familyWithoutKey,
  validBaseUrl,
} from '@/provimux/pages/accounts/keyWrites';
import { fixOf } from '@/provimux/pages/accounts/labels';
import { modelsAddressOf } from '@/provimux/pages/accounts/links';
import {
  OPENROUTER_BASE_URL,
  SERVICES,
  serviceById,
  serviceOfKey,
  serviceOfLogin,
  signInFlowOf,
} from '@/provimux/pages/accounts/services';
import { keyState, loginState } from '@/provimux/pages/accounts/state';
import {
  accountNameOf,
  initialModelsFilter,
  lineProviderKeys,
  type RouteLine,
} from '@/provimux/pages/models/catalog';
import { accountsAddressOfLogin } from '@/provimux/pages/shared/accountsLink';
import { openProvidersState } from '@/provimux/pages/shared/providersLink';
import { PROVIMUX_ROUTES } from '@/provimux/routes';
import { textOf } from './support/models';
import { pluralCategories } from '../helpers/pluralCategories';

const read = (path: string) => readFileSync(path, 'utf8');
const fixture = (name: string) => JSON.parse(read(`tests/provimux/fixtures/accounts/${name}`));

/** The fixtures' clock: the credentials list was received at 14:00:00 UTC, the routes observed then. */
const NOW = Date.parse('2026-11-24T14:00:00Z');
const config = () => readAliasState(fixture('config.json'), null);
const files = () =>
  normalizeAuthFilesResponse(fixture('credentials.json') as AuthFilesResponse, NOW).files;
const routes = () => readModelRoutes(fixture('model-routes.json'));
const accounts = (nowMs = NOW) =>
  buildAccounts({ config: config(), files: files(), routes: routes(), nowMs, serverNowMs: nowMs });
const login = (list: Account[], fileName: string) =>
  list.find((a) => a.kind === 'sub' && a.fileName === fileName) as LoginAccount;
const key = (list: Account[], service: string) =>
  list.find((a) => a.kind === 'api' && a.service === service) as KeyAccount;

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

describe('one list of accounts', () => {
  test('6 subscriptions and 4 API keys, each with its service, who it is and its priority', () => {
    const list = accounts();
    expect(list.filter((a) => a.kind === 'sub')).toHaveLength(6);
    expect(list.filter((a) => a.kind === 'api')).toHaveLength(4);
    expect(
      list.map((a) => [a.kind, a.service, a.who, a.priority, a.reading.state])
    ).toEqual([
      ['sub', 'antigravity', 'alex@example.com', 0, 'working'],
      ['sub', 'claude', 'alex@example.com', 10, 'working'],
      ['sub', 'openai', 'alex@example.com', 10, 'signed-out'],
      ['sub', 'openai', 'team@example.com', 5, 'working'],
      ['sub', 'devin', 'alex@example.com', 5, 'cooling'],
      ['sub', 'meta', 'alex@example.com', 0, 'working'],
      ['api', 'gemini', 'generativelanguage.googleapis.com', 2, 'off'],
      ['api', 'openai', 'api.openai.com', 5, 'working'],
      ['api', 'claude', 'api.anthropic.com', 0, 'working'],
      ['api', 'openrouter', 'openrouter.ai', 0, 'working'],
    ]);
  });

  test('a key shows masked, never whole; an OpenAI-compatible entry counts its keys', () => {
    const list = accounts();
    const anthropic = key(list, 'claude');
    expect(anthropic.detail).toBe('fi******b2');
    expect(JSON.stringify(list.map(({ detail, who }) => [detail, who]))).not.toContain(
      'fixture-anthropic-key'
    );
    expect(key(list, 'openrouter').detail).toBeNull();
    expect(key(list, 'openrouter').entry.keyCount).toBe(1);
  });

  test('grouped by service in the catalog order, the one tried first on top, logins before keys', () => {
    const groups = groupByService(accounts());
    expect(groups.map((g) => g.service)).toEqual([
      'claude',
      'openai',
      'gemini',
      'openrouter',
      'antigravity',
      'devin',
      'meta',
    ]);
    const openai = groups[1].accounts.map((a) => `${a.kind}:${a.who}:${a.priority}`);
    expect(openai).toEqual([
      'sub:alex@example.com:10',
      'sub:team@example.com:5',
      'api:api.openai.com:5',
    ]);
    expect(groups[0].accounts.map((a) => a.kind)).toEqual(['sub', 'api']);
  });

  test('the summary counts each state; "needs you" is signed out or a problem, not off or cooling', () => {
    const list = accounts();
    expect(summarize(list)).toEqual({
      total: 10,
      working: 7,
      signedOut: 1,
      problem: 0,
      cooling: 1,
      off: 1,
    });
    const label = (a: Account) => a.service;
    const view = (v: 'sub' | 'api' | 'attention') =>
      list.filter((a) => matchesFilter(a, { ...EMPTY_ACCOUNTS_FILTER, view: v }, label(a)));
    expect(view('sub')).toHaveLength(6);
    expect(view('api')).toHaveLength(4);
    expect(view('attention').map((a) => a.id)).toEqual(['login:codex-alex@example.com-plus.json']);
    // Search: the service's label, who it is, an entry's name.
    const found = list.filter((a) =>
      matchesFilter(a, { query: 'team@', view: 'all' }, label(a))
    );
    expect(found.map((a) => a.who)).toEqual(['team@example.com']);
    expect(
      list.filter((a) => matchesFilter(a, { query: 'openrouter', view: 'all' }, label(a)))
    ).toHaveLength(1);
  });

  test('a link opens the page on an account: by its login file, or by its auth index', () => {
    const list = accounts();
    const params = new URLSearchParams(accountsAddressOfLogin('devin-alex@example.com.json').split('?')[1]);
    expect(accountFromParams(list, params)?.id).toBe('login:devin-alex@example.com.json');
    expect(accountFromParams(list, new URLSearchParams('account=ak-openai-1'))?.who).toBe(
      'api.openai.com'
    );
    expect(accountFromParams(list, new URLSearchParams('login=nope.json'))).toBeNull();
  });

  test('without the login list, the keys are still listed', () => {
    const list = buildAccounts({
      config: config(),
      files: null,
      routes: null,
      nowMs: NOW,
      serverNowMs: NOW,
    });
    expect(list.map((a) => a.kind)).toEqual(['api', 'api', 'api', 'api']);
  });
});

describe('whether an account works now', () => {
  const base = { name: 'x.json', type: 'claude', status: 'active' };

  test('a login: off, signed out, cooling down, a problem, or working', () => {
    expect(loginState({ ...base, disabled: true }, NOW).state).toBe('off');
    expect(loginState({ ...base, status: 'disabled' }, NOW).state).toBe('off');
    expect(loginState({ ...base, requires_sign_in: true }, NOW).state).toBe('signed-out');
    expect(loginState({ ...base, renewal_state: 'sign_in_required' }, NOW).state).toBe(
      'signed-out'
    );
    expect(loginState({ ...base, status: 'error', status_message: 'boom' }, NOW)).toMatchObject({
      state: 'problem',
      message: 'boom',
    });
    expect(loginState(base, NOW)).toMatchObject({ state: 'working', modelsCooling: 0 });
  });

  test('a login cooling down: until when, counted from when the list was received', () => {
    const devin = login(accounts(), 'devin-alex@example.com.json');
    expect(devin.reading).toMatchObject({
      state: 'cooling',
      reason: 'credential_quota',
      until: Date.parse('2026-11-24T14:47:00Z'),
    });
    // Ten minutes later, the same end: the countdown runs on the receipt, not on a new read.
    const later = login(accounts(NOW + 600_000), 'devin-alex@example.com.json');
    expect(later.reading.until).toBe(Date.parse('2026-11-24T14:47:00Z'));
    // After the end it is no longer cooling down; the proxy's own error then shows as a problem.
    const after = login(accounts(NOW + 3_000_000), 'devin-alex@example.com.json');
    expect(after.reading.state).toBe('problem');
  });

  test('a server without cooldown snapshots: its next retry while the login is held', () => {
    const reading = loginState(
      { ...base, unavailable: true, next_retry_after: '2026-11-24T14:30:00Z' },
      NOW
    );
    expect(reading).toMatchObject({ state: 'cooling', until: Date.parse('2026-11-24T14:30:00Z') });
  });

  test('a login with a few models cooling down still works, and says how many', () => {
    const team = login(accounts(), 'codex-team@example.com-team.json');
    expect(team.reading).toMatchObject({ state: 'working', modelsCooling: 1 });
  });

  test("a key: off from the configuration, refused or cooling down from its routes' cooldowns", () => {
    const until = '2026-11-24T15:00:00Z';
    const cooldown = (scope: string, reason: string) => ({
      scope,
      model: scope === 'model' ? 'm' : null,
      reason,
      until,
      http_status: 429,
      backoff_level: 1,
    });
    expect(keyState(true, [cooldown('credential', 'quota')], NOW).state).toBe('off');
    expect(keyState(false, [cooldown('credential', 'quota')], NOW)).toMatchObject({
      state: 'cooling',
      until: Date.parse(until),
    });
    expect(keyState(false, [cooldown('credential', 'unauthorized')], NOW)).toMatchObject({
      state: 'problem',
      rejected: true,
    });
    expect(keyState(false, [cooldown('model', 'quota')], NOW)).toMatchObject({
      state: 'working',
      modelsCooling: 1,
    });
    expect(keyState(false, [cooldown('credential', 'quota')], Date.parse(until) + 1).state).toBe(
      'working'
    );
    expect(keyState(false, [], NOW).state).toBe('working');
  });

  test('the fix a row offers: sign in again (a login with a flow), replace (a refused key)', () => {
    const list = accounts();
    const codex = login(list, 'codex-alex@example.com-plus.json');
    expect(codex.signIn).toBe('codex');
    expect(fixOf(codex)).toBe('sign-in');
    expect(fixOf(login(list, 'devin-alex@example.com.json'))).toBeNull();
    const refused: KeyAccount = {
      ...key(list, 'claude'),
      reading: { ...key(list, 'claude').reading, state: 'problem', rejected: true },
    };
    expect(fixOf(refused)).toBe('replace');
    // A login no OAuth Login flow signs in (gemini-cli): its file is replaced on Auth Files.
    expect(signInFlowOf('gemini-cli', null)).toBeNull();
    expect(signInFlowOf('claude', null)).toBe('anthropic');
    expect(signInFlowOf('kimi', 'kimi-ai')).toBe('kimi-ai');
  });
});

describe('services', () => {
  test("a login type or a key's family and address name the company", () => {
    expect(serviceOfLogin('codex')).toBe('openai');
    expect(serviceOfLogin('claude')).toBe('claude');
    expect(serviceOfLogin('my-plugin')).toBeNull();
    expect(serviceOfKey('claude', null, null)).toBe('claude');
    expect(serviceOfKey('codex', 'api.openai.com', null)).toBe('openai');
    expect(serviceOfKey('interactions', null, null)).toBe('gemini');
    expect(serviceOfKey('openai-compatibility', 'openrouter.ai', 'or')).toBe('openrouter');
    expect(serviceOfKey('openai-compatibility', 'api.example.com', 'acme')).toBe('compatible:acme');
  });

  test('the add sheet: the service first, then how (both kinds), which site, the key, or sign in', () => {
    expect(firstStep(serviceById('claude')!)).toEqual({ kind: 'how', service: 'claude' });
    expect(firstStep(serviceById('kimi')!)).toEqual({ kind: 'site', service: 'kimi' });
    expect(firstStep(serviceById('devin')!)).toEqual({ kind: 'sign-in', flow: 'devin' });
    expect(firstStep(serviceById('openrouter')!)).toEqual({ kind: 'key', service: 'openrouter' });
    // Every sign-in the catalog offers is one of OAuth Login's flows.
    const flows = read('src/features/oauth/providers.ts');
    for (const service of SERVICES) {
      for (const flow of service.signIn) expect(flows).toContain(`id: '${flow}'`);
    }
  });
});

describe("an API key's writes: the family's list as read, one key changed", () => {
  const doc = () => fixture('config.json');
  const entryOf = (family: string) =>
    (config().entries as KeyEntry[]).find((e) => e.store === 'api-key' && e.family === family)!;

  test('off and on: excluded-models "*" on a native key, disabled on an OpenAI-compatible entry', () => {
    const anthropic = entryOf('claude');
    const off = familyWithKeyOn(doc(), anthropic, false) as Array<Record<string, unknown>>;
    expect(off[0].keys).toEqual([
      {
        'api-key': 'fixture-anthropic-key-0000a1b2',
        auth_index: 'ak-anthropic-1',
        'excluded-models': ['*'],
      },
    ]);
    expect(off[0].name).toBe('anthropic');
    const gemini = entryOf('gemini');
    const on = familyWithKeyOn(doc(), gemini, true) as Array<Record<string, unknown>>;
    expect((on[0].keys as Array<Record<string, unknown>>)[0]['excluded-models']).toEqual([]);
    expect(on[0].priority).toBe(2);
    const openrouter = entryOf('openai-compatibility');
    const orOff = familyWithKeyOn(doc(), openrouter, false) as Array<Record<string, unknown>>;
    expect(orOff[0].disabled).toBe(true);
    expect(orOff[0].models).toEqual(doc()['api-keys']['openai-compatibility'][0].models);
    const orOn = familyWithKeyOn(
      { 'api-keys': { 'openai-compatibility': orOff } },
      openrouter,
      true
    ) as Array<Record<string, unknown>>;
    expect('disabled' in orOn[0]).toBe(false);
  });

  test("priority on the key itself (the entry for OpenAI-compatible), as Models sets it", () => {
    const gemini = familyWithPriority(doc(), entryOf('gemini'), 7) as Array<Record<string, unknown>>;
    expect(gemini[0].priority).toBe(2);
    expect((gemini[0].keys as Array<Record<string, unknown>>)[0].priority).toBe(7);
    const or = familyWithPriority(doc(), entryOf('openai-compatibility'), -3) as Array<
      Record<string, unknown>
    >;
    expect(or[0].priority).toBe(-3);
    expect(() => familyWithPriority(doc(), entryOf('gemini'), 1.5)).toThrow(KeyWriteError);
  });

  test('removed: a native key leaves its group; an OpenAI-compatible entry goes whole', () => {
    const gone = familyWithoutKey(doc(), entryOf('claude')) as Array<Record<string, unknown>>;
    expect(gone).toEqual([{ name: 'anthropic', keys: [] }]);
    expect(familyWithoutKey(doc(), entryOf('openai-compatibility'))).toEqual([]);
  });

  test('replaced: only the key changes; its priority, models and settings stay', () => {
    const next = familyWithKeyReplaced(doc(), entryOf('codex'), '  new-key  ') as Array<
      Record<string, unknown>
    >;
    expect(next[0]).toEqual({
      name: 'openai',
      'base-url': 'https://api.openai.com/v1',
      keys: [{ 'api-key': 'new-key', auth_index: 'ak-openai-1', priority: 5 }],
    });
    expect(() => familyWithKeyReplaced(doc(), entryOf('codex'), ' ')).toThrow(KeyWriteError);
    const two = structuredClone(doc());
    two['api-keys']['openai-compatibility'][0].keys.push({ 'api-key': 'second' });
    const entry = (readAliasState(two, null).entries as KeyEntry[]).find(
      (e) => e.family === 'openai-compatibility'
    )!;
    expect(() => familyWithKeyReplaced(two, entry, 'x')).toThrow('several-keys');
  });

  test('added: a native key gets a group of its own, as AI Providers names it', () => {
    const { family, groups } = familyWithKeyAdded(doc(), serviceById('claude')!.key!, {
      apiKey: 'k2',
    });
    expect(family).toBe('claude');
    expect(groups[1]).toEqual({ name: 'claude-2', keys: [{ 'api-key': 'k2' }] });
    const openai = familyWithKeyAdded(doc(), serviceById('openai')!.key!, { apiKey: 'k3' });
    expect(openai.groups[1]).toEqual({
      name: 'codex-2',
      'base-url': 'https://api.openai.com/v1',
      keys: [{ 'api-key': 'k3' }],
    });
  });

  test("added to OpenRouter: it joins the entry already there, so it shares that entry's models", () => {
    const { family, groups } = familyWithKeyAdded(doc(), serviceById('openrouter')!.key!, {
      apiKey: 'or-2',
    });
    expect(family).toBe('openai-compatibility');
    expect(groups).toHaveLength(1);
    expect((groups[0] as Record<string, unknown>).keys).toEqual([
      { 'api-key': 'fixture-openrouter-key-00g7h8', auth_index: 'ak-openrouter-1' },
      { 'api-key': 'or-2' },
    ]);
    const empty = familyWithKeyAdded({}, serviceById('openrouter')!.key!, { apiKey: 'or-1' });
    expect(empty.groups).toEqual([
      { name: 'openrouter', 'base-url': OPENROUTER_BASE_URL, keys: [{ 'api-key': 'or-1' }] },
    ]);
  });

  test('a service of its own: a name and an http(s) address, the name not taken', () => {
    const target = serviceById('compatible')!.key!;
    const { groups } = familyWithKeyAdded(doc(), target, {
      apiKey: 'k',
      name: 'acme',
      baseUrl: 'https://api.acme.example/v1',
    });
    expect(groups[1]).toEqual({
      name: 'acme',
      'base-url': 'https://api.acme.example/v1',
      keys: [{ 'api-key': 'k' }],
    });
    expect(() =>
      familyWithKeyAdded(doc(), target, { apiKey: 'k', name: 'openrouter', baseUrl: 'https://x.example' })
    ).toThrow('duplicate-name');
    expect(() => familyWithKeyAdded(doc(), target, { apiKey: 'k', name: 'a', baseUrl: 'x' })).toThrow(
      KeyWriteError
    );
    expect(validBaseUrl('https://api.example.com/v1')).toBe(true);
    expect(validBaseUrl('ftp://api.example.com')).toBe(false);
    expect(validBaseUrl('api.example.com')).toBe(false);
  });

  test('an entry no longer where the read put it is refused, not written somewhere else', () => {
    const entry = { ...entryOf('claude'), groupIndex: 4 };
    expect(() => familyWithKeyOn(doc(), entry, false)).toThrow('not-found');
  });
});

describe("the requests: the original pages' calls, nothing else", () => {
  const original = {
    put: apiClient.put,
    patch: apiClient.patch,
    delete: apiClient.delete,
    post: apiClient.post,
    get: apiClient.get,
  };
  afterEach(() => {
    Object.assign(apiClient, original);
  });
  type Sent = { method: string; path: string; body?: unknown; ifMatch?: unknown };

  function record(options: { putStatus?: number } = {}) {
    const sent: Sent[] = [];
    apiClient.put = (async (
      path: string,
      body: unknown,
      config?: { headers?: Record<string, unknown>; transformResponse?: unknown }
    ) => {
      sent.push({ method: 'PUT', path, body, ifMatch: config?.headers?.['If-Match'] });
      if (options.putStatus && options.putStatus !== 200) {
        throw Object.assign(new Error('precondition_failed'), { status: options.putStatus });
      }
      let data: unknown = JSON.stringify({ status: 'ok' });
      const headers = new AxiosHeaders({ etag: '"v2"' });
      type Fn = (this: unknown, d: unknown, h: AxiosHeaders, s: number) => unknown;
      for (const fn of [config?.transformResponse ?? []].flat() as Fn[]) {
        data = fn.call(config, data, headers, 200);
      }
      return data;
    }) as typeof apiClient.put;
    apiClient.patch = (async (path: string, body: unknown) => {
      sent.push({ method: 'PATCH', path, body });
      return { status: 'ok', disabled: false };
    }) as typeof apiClient.patch;
    apiClient.delete = (async (path: string, config?: { data?: unknown }) => {
      sent.push({ method: 'DELETE', path, body: config?.data });
      return { status: 'ok' };
    }) as typeof apiClient.delete;
    apiClient.post = (async (path: string, body: unknown) => {
      sent.push({ method: 'POST', path, body });
      return { status: 'ok', auth_index: 'li-devin-1', models: [] };
    }) as typeof apiClient.post;
    apiClient.get = (async (path: string) => {
      sent.push({ method: 'GET', path });
      throw new Error(`unexpected GET ${path}`);
    }) as typeof apiClient.get;
    return sent;
  }

  test("a key's family is written back with If-Match, to /config/api-keys/<family>", async () => {
    const sent = record();
    await accountsApi.writeFamily('claude', [{ name: 'a', keys: [] }], '"v1"');
    expect(sent).toEqual([
      {
        method: 'PUT',
        path: '/config/api-keys/claude',
        body: [{ name: 'a', keys: [] }],
        ifMatch: '"v1"',
      },
    ]);
  });

  test('a list changed since the read (412) is refused, and so is a read without a tag', async () => {
    record({ putStatus: 412 });
    const changed = await accountsApi.writeFamily('claude', [], '"old"').catch((e) => e);
    expect(changed).toBeInstanceOf(AccountsWriteError);
    expect(changed.reason).toBe('changed');
    const sent = record();
    const noTag = await accountsApi.writeFamily('claude', [], null).catch((e) => e);
    expect(noTag.reason).toBe('no-tag');
    expect(sent).toEqual([]);
  });

  test("a login's writes: Auth Files' status, fields (priority), delete and cooldown reset", async () => {
    const sent = record();
    await accountsApi.setLoginOn({ name: 'devin-alex@example.com.json', authIndex: 'li-devin-1' }, false);
    await accountsApi.setLoginPriority('devin-alex@example.com.json', 12);
    await accountsApi.removeLogin('devin-alex@example.com.json');
    await accountsApi.tryLoginNow('li-devin-1');
    expect(sent).toEqual([
      {
        method: 'PATCH',
        path: '/credentials/status',
        body: { name: 'devin-alex@example.com.json', disabled: true, auth_index: 'li-devin-1' },
      },
      {
        method: 'PATCH',
        path: '/credentials/fields',
        body: { name: 'devin-alex@example.com.json', priority: 12 },
      },
      {
        method: 'DELETE',
        path: '/credentials',
        body: { names: ['devin-alex@example.com.json'] },
      },
      { method: 'POST', path: '/routing/cooldown/reset', body: { auth_index: 'li-devin-1' } },
    ]);
  });

  test('the priority field is the one the Auth Files editor writes (PATCH /credentials/fields)', () => {
    const editor = read('src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts');
    expect(editor).toContain('await authFilesApi.patchFields(name, payload);');
    expect(editor).toContain('patch.priority = nextPriority;');
  });

  test('the page never downloads a login file, and never shows a whole key', () => {
    const dir = 'src/provimux/pages/accounts';
    for (const file of [
      'AccountsPage.tsx',
      'AccountsBoard.tsx',
      'AccountSheet.tsx',
      'AddAccountSheet.tsx',
      'ReplaceKeyDialog.tsx',
      'accountsApi.ts',
      'accounts.ts',
    ]) {
      const source = read(`${dir}/${file}`);
      expect({ file, download: /\.download(Text)?\(|credentials\/download/.test(source) }).toEqual({
        file,
        download: false,
      });
      expect({ file, apiKey: /apiKey\b(?!:)/.test(source) && /\.apiKey/.test(source) }).toEqual({
        file,
        apiKey: false,
      });
    }
  });
});

describe('what the page draws', () => {
  const render = (list: Account[], overrides: Partial<Parameters<typeof AccountsBoard>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(AccountsBoard, {
          accounts: list,
          filter: EMPTY_ACCOUNTS_FILTER,
          onFilter: () => undefined,
          nowMs: NOW,
          serverNowMs: NOW,
          busy: new Set<string>(),
          routesKnown: true,
          loginsFailed: false,
          onAdd: () => undefined,
          onOpen: () => undefined,
          onToggle: () => undefined,
          onFix: () => undefined,
          ...overrides,
        })
      )
    );

  test('each service with its accounts: kind, who, the state in a word, the priority, the fix', async () => {
    await i18n.changeLanguage('en');
    const html = render(accounts());
    const text = textOf(html);
    expect(text).toContain('10 accounts');
    expect(text).toContain('7 working');
    expect(text).toContain('1 signed out');
    expect(text).toContain('1 cooling down');
    expect(text).toContain('1 off');
    for (const service of ['Claude', 'ChatGPT · OpenAI', 'Gemini', 'OpenRouter', 'Devin']) {
      expect(text).toContain(service);
    }
    expect(text).toContain('Signed out');
    expect(text).toContain('Sign in again');
    expect(text).toMatch(/Cooling down until [^·]+ · 47 min left/);
    expect(text).toContain('1 model cooling down');
    expect(text).toContain('Priority 10');
    expect(html.match(/data-access="sub"/g)).toHaveLength(6);
    expect(html.match(/data-access="api"/g)).toHaveLength(4);
    expect(html).toContain('fi******b2');
    expect(html).not.toContain('fixture-anthropic-key');
    // One switch per account, each named for it.
    expect(html.match(/aria-label="Use /g)).toHaveLength(10);
    expect(html).toContain('aria-label="Use ChatGPT · OpenAI · alex@example.com"');
    // A problem row carries the attention mark; cooling and off ones do not.
    expect(html.match(/data-attention="true"/g)).toHaveLength(1);
  });

  test('a refused key offers "Replace key"; without routes the page says a key shows on or off only', async () => {
    await i18n.changeLanguage('en');
    const list = accounts().map((a) =>
      a.kind === 'api' && a.service === 'claude'
        ? { ...a, reading: { ...a.reading, state: 'problem' as const, rejected: true, reason: 'unauthorized' } }
        : a
    );
    const text = textOf(render(list, { routesKnown: false }));
    expect(text).toContain('Key refused');
    expect(text).toContain('Replace key');
    expect(text).toContain("This proxy doesn't report cooldowns on API keys");
    expect(text).toContain('1 signed out · 1 with a problem');
  });

  test('no account yet: one way forward', async () => {
    await i18n.changeLanguage('en');
    const text = textOf(render([]));
    expect(text).toContain('No accounts yet');
    expect(text).toContain('Add account');
  });

  test('what a state means, in a sentence, with what to do', async () => {
    await i18n.changeLanguage('en');
    const list = accounts();
    const t = i18n.t.bind(i18n) as unknown as Parameters<typeof statusSentence>[0];
    expect(statusSentence(t, login(list, 'codex-alex@example.com-plus.json'), 'en', NOW)).toContain(
      'Sign in again with the same account'
    );
    expect(statusSentence(t, login(list, 'devin-alex@example.com.json'), 'en', NOW)).toMatch(
      /It hit a limit \(account quota\)\. Provimux tries it again at .+, in 47 min/
    );
    expect(statusSentence(t, key(list, 'gemini'), 'en', NOW)).toContain('Turned off');
    expect(statusSentence(t, login(list, 'codex-team@example.com-team.json'), 'en', NOW)).toContain(
      '1 of its models is cooling down on its own'
    );
  });

  test('the priority field takes a whole number the proxy can hold', () => {
    expect(parsePriority(' 12 ')).toBe(12);
    expect(parsePriority('-5')).toBe(-5);
    expect(parsePriority('1.5')).toBeNull();
    expect(parsePriority('')).toBeNull();
    expect(parsePriority('99999999999')).toBeNull();
  });

  test('the panels render closed without an account, and the add sheet starts on the services', async () => {
    await i18n.changeLanguage('en');
    const closed = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(AccountSheet, {
          account: null,
          open: false,
          nowMs: NOW,
          serverNowMs: NOW,
          busy: false,
          document: fixture('config.json'),
          file: null,
          onClose: () => undefined,
          onToggle: () => undefined,
          onFix: () => undefined,
          onTryNow: () => undefined,
          onSavePriority: async () => true,
          onSaveKeySettings: async () => true,
          onSaveLoginSettings: async () => true,
          onSiwc: () => undefined,
          onRemove: () => undefined,
          onShowModels: () => undefined,
          onMoreSettings: () => undefined,
        }),
        createElement(AddAccountSheet, {
          open: false,
          initialService: null,
          pluginFlows: [],
          document: fixture('config.json'),
          loginProxy: { value: '', rejected: null, onChange: () => undefined },
          onClose: () => undefined,
          onSignIn: () => undefined,
          onServiceAccount: () => undefined,
          onSiwc: () => undefined,
          onAddKey: async () => true,
        })
      )
    );
    expect(closed).toBe('');
  });
});

describe('links between the pages', () => {
  test("Models filtered to the account: its auth index when routes are known, else its type or family", () => {
    const list = accounts();
    const devin = login(list, 'devin-alex@example.com.json');
    expect(modelsAddressOf(devin, true)).toBe('/provimux/models?account=li-devin-1');
    expect(modelsAddressOf(devin, false)).toBe('/provimux/models?channel=devin');
    expect(modelsAddressOf(key(list, 'claude'), false)).toBe('/provimux/models?family=claude');
    expect(modelsAddressOf(key(list, 'openrouter'), false)).toBe('/provimux/models?provider=openrouter');
  });

  test('Models reads ?account= and its lines answer to their account', () => {
    expect(initialModelsFilter(new URLSearchParams('account=li-devin-1')).provider).toBe(
      'account:li-devin-1'
    );
    // ?account= wins over the older parameters.
    expect(initialModelsFilter(new URLSearchParams('account=a&channel=claude')).provider).toBe(
      'account:a'
    );
    const entries = draftEntries(startDraft({ ...config(), etag: '"t"' }));
    const line = { provider: 'devin', access: 'sub', entryId: null, host: null, authIndex: 'li-devin-1' };
    expect(lineProviderKeys(line as unknown as RouteLine, entries)).toContain('account:li-devin-1');
    // An OpenAI-compatible entry is one account: a line of any of its keys answers to all its indexes.
    const or = entries.find((e) => e.store === 'api-key' && e.family === 'openai-compatibility')!;
    const orLine = {
      provider: 'openai-compatible-openrouter',
      access: 'api',
      entryId: or.id,
      host: 'openrouter.ai',
      authIndex: 'ak-openrouter-1',
    };
    expect(lineProviderKeys(orLine as unknown as RouteLine, entries)).toContain(
      'account:ak-openrouter-1'
    );
    expect(accountNameOf(routes(), entries, 'li-devin-1')).toBe('alex@example.com');
    expect(accountNameOf(routes(), entries, 'ak-openrouter-1')).toBe('openrouter.ai');
    expect(accountNameOf(null, entries, 'ak-anthropic-1')).toBe('anthropic');
    expect(accountNameOf(null, entries, 'zz')).toBe('zz');
  });

  test("More settings: AI Providers opened on the key's family and connection (upstream's own state)", () => {
    const state = openProvidersState(
      { activeBrand: 'gemini', filtersByBrand: {} },
      'openai-compatibility',
      'openrouter'
    );
    expect(state.activeBrand).toBe('openaiCompatibility');
    expect(state.filtersByBrand.openaiCompatibility?.filter).toBe('openrouter');
  });

  test('the original pages keep their routes; Accounts has its own, not behind an endpoint gate', () => {
    const routes = read('src/router/MainRoutes.tsx');
    for (const path of ['/ai-providers', '/auth-files', '/oauth']) {
      expect(routes).toContain(`{ path: '${path}', element: <`);
    }
    const accountsRoute = PROVIMUX_ROUTES.find((route) => route.path === '/provimux/accounts');
    expect(accountsRoute?.element.type.name).toBe('AccountsPage');
    // No upstream page file is changed by the menu: the seam is provimuxNav, already in MainLayout.
    expect(read('src/components/layout/MainLayout.tsx')).not.toContain('/provimux/accounts');
  });
});

describe('strings in seven languages', () => {
  type Tree = { [key: string]: string | Tree };
  const en = JSON.parse(read('src/provimux/locales/en.json')) as Tree;
  const placeholders = (text: string) =>
    [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  const baseOf = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');
  const flat = (tree: Tree, prefix = ''): Record<string, string> =>
    Object.fromEntries(
      Object.entries(tree).flatMap(([key, value]) =>
        typeof value === 'string'
          ? [[`${prefix}${key}`, value]]
          : Object.entries(flat(value, `${prefix}${key}.`))
      )
    );

  test('every language has every key of provimux.accounts, in its own plural forms, with the same placeholders', () => {
    const source = flat((en.provimux as Tree).accounts as Tree);
    const plural = new Set(
      Object.keys(source)
        .filter((key) => baseOf(key) !== key)
        .map(baseOf)
    );
    for (const [language, own] of Object.entries(PROVIMUX_TRANSLATIONS)) {
      const strings = flat(((own as Tree).provimux as Tree).accounts as Tree);
      const forms = pluralCategories(language);
      const expected = new Set<string>();
      for (const key of Object.keys(source)) {
        const base = baseOf(key);
        if (plural.has(base)) for (const form of forms) expected.add(`${base}_${form}`);
        else expected.add(key);
      }
      expect({ language, keys: Object.keys(strings).sort() }).toEqual({
        language,
        keys: [...expected].sort(),
      });
      for (const [key, text] of Object.entries(strings)) {
        const original = source[key] ?? source[`${baseOf(key)}_other`];
        expect({ language, key, p: placeholders(text) }).toEqual({
          language,
          key,
          p: placeholders(original),
        });
      }
    }
  });

  test('every key the page asks for exists in English', () => {
    const strings = flat((en.provimux as Tree).accounts as Tree);
    const dir = 'src/provimux/pages/accounts';
    const used = new Set<string>();
    for (const file of [
      'AccountsPage.tsx',
      'AccountsBoard.tsx',
      'AccountSheet.tsx',
      'AddAccountSheet.tsx',
      'ReplaceKeyDialog.tsx',
      'labels.ts',
      'services.ts',
      'AdvancedSettings.tsx',
      'KeySettingsFields.tsx',
      'LoginSettingsFields.tsx',
      'settingsSummary.ts',
    ]) {
      for (const match of read(`${dir}/${file}`).matchAll(/'provimux\.accounts\.([a-z_.]+)'/g)) {
        used.add(match[1]);
      }
    }
    for (const key of used) {
      const known = key in strings || `${key}_other` in strings;
      expect({ key, known }).toEqual({ key, known: true });
    }
    for (const state of ['working', 'signed_out', 'off', 'cooling', 'problem', 'refused']) {
      expect(strings[`state.${state}`]).toBeTruthy();
    }
  });

  test('the menu item and the page read in each language', async () => {
    for (const language of Object.keys(PROVIMUX_TRANSLATIONS)) {
      await i18n.changeLanguage(language);
      expect(i18n.t('provimux.nav.accounts')).not.toBe('Accounts');
      expect(i18n.t('provimux.accounts.count_accounts', { count: 3 })).toContain('3');
      expect(i18n.t('provimux.accounts.state.signed_out')).not.toBe('Signed out');
    }
    await i18n.changeLanguage('en');
    expect(i18n.t('provimux.nav.accounts')).toBe('Accounts');
  });

  test('no e-mail but example.com addresses in the fixtures, no home paths', () => {
    for (const name of ['config.json', 'credentials.json', 'model-routes.json']) {
      const text = read(`tests/provimux/fixtures/accounts/${name}`);
      // Every address is at example.com (file names carry it: claude-alex@example.com.json).
      expect(text).not.toMatch(/@(?!example\.com)/);
      expect(text).not.toMatch(/\/(Users|home)\/\w/);
    }
  });
});

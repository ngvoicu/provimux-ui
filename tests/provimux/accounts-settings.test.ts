/**
 * Accounts' settings (design accounts-page.md, section 7): every setting of AI Providers, Auth Files and
 * OAuth Login reachable from Accounts. A key's settings are AI Providers' own form model, saved with AI
 * Providers' own calls (run here against a stand-in for the proxy); a login's are Auth Files' field patch,
 * without reading its file; the other ways in are OAuth Login's dialogs, offered by the add sheet.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { apiClient } from '@/services/api/client';
import { providersApi } from '@/services/api/providers';
import type { AuthFileItem } from '@/types';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import type { KeyEntry } from '@/provimux/pages/aliases/types';
import { firstStep, stepOf, waysOf } from '@/provimux/pages/accounts/addSteps';
import { AddAccountSheet } from '@/provimux/pages/accounts/AddAccountSheet';
import {
  compatibleConfig,
  draftOf,
  draftProblem,
  joiningDraft,
  locateKey,
  nativeSave,
  newCompatibleDraft,
  newNativeDraft,
  ownerOf,
  retargeted,
  settingsTouched,
  sharedWithOthers,
  summaryOf,
  valueOf,
  withMember,
  withShared,
  withTyped,
  withValue,
  type CompatibleDraft,
  type NativeDraft,
} from '@/provimux/pages/accounts/keySettings';
import {
  loginDraftOf,
  loginPatch,
  loginProblem,
  type LoginDraft,
} from '@/provimux/pages/accounts/loginSettings';
import { SERVICES, serviceById } from '@/provimux/pages/accounts/services';
import { settingsStatus } from '@/provimux/pages/accounts/settingsSummary';
import { isChangedError, writeErrorMessage } from '@/provimux/pages/accounts/writeErrors';

const read = (path: string) => readFileSync(path, 'utf8');
const fixture = (name: string) => JSON.parse(read(`tests/provimux/fixtures/accounts/${name}`));
type Doc = Record<string, unknown>;

/** The fixtures' configuration, with the Anthropic key sharing its connection with a second key. */
const shared = (): Doc => {
  const doc = fixture('config.json') as Doc;
  const claude = (doc['api-keys'] as Doc).claude as Doc[];
  claude[0] = {
    ...claude[0],
    'proxy-url': 'socks5://127.0.0.1:1080',
    models: [{ name: 'claude-sonnet-4-6', alias: 'sonnet' }],
    keys: [
      ...(claude[0].keys as Doc[]),
      { 'api-key': 'fixture-anthropic-key-0000c9d0', auth_index: 'ak-anthropic-2', weight: 2 },
    ],
  };
  return doc;
};
const entryOf = (doc: unknown, family: string, keyIndex: number | null): KeyEntry =>
  readAliasState(doc, null).entries.find(
    (entry): entry is KeyEntry =>
      entry.store === 'api-key' && entry.family === family && entry.keyIndex === keyIndex
  )!;

// --- a stand-in for the proxy's configuration, as AI Providers' writes see it -----------------------------
const original = {
  get: apiClient.get,
  getRaw: apiClient.getRaw,
  put: apiClient.put,
  captureConnection: apiClient.captureConnection,
};
afterEach(() => Object.assign(apiClient, original));

function proxy(initial: Doc) {
  apiClient.captureConnection = () => apiClient;
  let doc = structuredClone(initial);
  let version = 1;
  const puts: Array<{ path: string; body: unknown; ifMatch: unknown }> = [];
  apiClient.get = (async (path: string) => {
    expect(path).toBe('/config');
    return structuredClone(doc);
  }) as typeof apiClient.get;
  apiClient.getRaw = (async (path: string) => {
    expect(path).toBe('/config');
    return { data: structuredClone(doc), headers: { etag: `"v${version}"` } };
  }) as typeof apiClient.getRaw;
  apiClient.put = (async (path: string, body: unknown, options?: { headers?: Doc }) => {
    const family = path.match(/^\/config\/api-keys\/(.+)$/)?.[1];
    expect(family).toBeTruthy();
    puts.push({ path, body, ifMatch: options?.headers?.['If-Match'] });
    doc = { ...doc, 'api-keys': { ...(doc['api-keys'] as Doc), [family!]: structuredClone(body) } };
    version += 1;
  }) as typeof apiClient.put;
  return { doc: () => doc, puts };
}
const groupsOf = (doc: Doc, family: string) => (doc['api-keys'] as Doc)[family] as Doc[];

describe('the other ways in are choices of "Add account"', () => {
  test('Gemini and Vertex AI: an API key or a service account file; ChatGPT: Sign in with ChatGPT too', () => {
    expect(waysOf(serviceById('gemini')!)).toEqual(['key', 'service-account']);
    expect(waysOf(serviceById('vertex')!)).toEqual(['key', 'service-account']);
    expect(serviceById('vertex')!.offered).toBe(true);
    expect(waysOf(serviceById('openai')!)).toEqual(['sub', 'key', 'siwc']);
    expect(waysOf(serviceById('meta')!)).toEqual(['sub', 'key']);
    expect(firstStep(serviceById('gemini')!)).toEqual({ kind: 'how', service: 'gemini' });
    expect(stepOf(serviceById('gemini')!, 'service-account')).toEqual({ kind: 'service-account' });
    expect(stepOf(serviceById('openai')!, 'siwc')).toEqual({ kind: 'siwc' });
    expect(stepOf(serviceById('kimi')!, 'sub')).toEqual({ kind: 'site', service: 'kimi' });
    // The keys of the rarer families go where AI Providers stores them.
    expect(serviceById('vertex')!.key).toEqual({ family: 'vertex', baseUrl: null });
    expect(serviceById('meta')!.key).toEqual({ family: 'meta', baseUrl: 'https://api.meta.ai/v1' });
  });

  test('OpenAI-compatible is offered by that name, with a hint; no line sends him to another page', async () => {
    await i18n.changeLanguage('en');
    expect(serviceById('compatible')!.label).toBe('OpenAI-compatible (any other provider)');
    expect(i18n.t('provimux.accounts.service_custom')).toBe('OpenAI-compatible (any other provider)');
    expect(i18n.t('provimux.accounts.compatible_hint')).toMatch(/OpenAI-style API/);
    expect(SERVICES.filter((service) => service.offered).map((s) => s.id)).toContain('compatible');
    const sheet = read('src/provimux/pages/accounts/AddAccountSheet.tsx');
    expect(sheet).not.toContain("to=\"/oauth\"");
    expect(sheet).not.toContain('add_other_ways');
    // The other ways are OAuth Login's own pieces, imported as they are.
    const page = read('src/provimux/pages/accounts/AccountsPage.tsx');
    expect(page).toContain("from '@/features/oauth/components/VertexImportDialog'");
    expect(page).toContain("from '@/features/oauth/components/SiwcBindDialog'");
    expect(page).toContain("from '@/features/oauth/hooks/useVertexImport'");
    expect(page).toContain('flows.setLoginProxy');
  });

  test('the add sheet renders closed; it is given the login proxy and the dialogs', async () => {
    await i18n.changeLanguage('en');
    const closed = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
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

describe("a key's settings: AI Providers' form model and its save", () => {
  test('a key is found as AI Providers lists it: its connection and its key, or an OpenAI entry', () => {
    const doc = shared();
    const native = locateKey(doc, entryOf(doc, 'claude', 1));
    expect(native?.kind).toBe('native');
    if (native?.kind !== 'native') return;
    expect(native.section.name).toBe('anthropic');
    expect(native.section.keyCount).toBe(2);
    const compatible = locateKey(doc, entryOf(doc, 'openai-compatibility', null));
    expect(compatible?.kind).toBe('compatible');
    expect(locateKey(doc, { family: 'claude', groupIndex: 9, keyIndex: 0 })).toBeNull();
  });

  test("a setting is the key's own when it sets one, else its connection's, shared with its other keys", () => {
    const doc = shared();
    const draft = draftOf(locateKey(doc, entryOf(doc, 'claude', 0))!) as NativeDraft;
    expect(draft.siblings).toBe(1);
    expect(ownerOf(draft, 'proxyUrl')).toBe('shared');
    expect(valueOf(draft, 'proxyUrl')).toBe('socks5://127.0.0.1:1080');
    expect(valueOf(draft, 'models').map((model) => model.alias)).toEqual(['sonnet']);
    expect(sharedWithOthers(draft, 'proxyUrl')).toBe(true);
    expect(sharedWithOthers(draft, 'baseUrl')).toBe(true);
    // The second key sets its own weight; weight is always the key's.
    const second = draftOf(locateKey(doc, entryOf(doc, 'claude', 1))!) as NativeDraft;
    expect(second.member.weight).toBe(2);
    // A key alone in its connection shares nothing.
    const alone = draftOf(locateKey(doc, entryOf(doc, 'codex', 0))!) as NativeDraft;
    expect(sharedWithOthers(alone, 'proxyUrl')).toBe(false);
  });

  test("a key turned off holds '*' as its own exclusions: an edit there becomes the key's own list", () => {
    const doc = fixture('config.json');
    const draft = draftOf(locateKey(doc, entryOf(doc, 'gemini', 0))!) as NativeDraft;
    expect(draft.member.memberModes?.excludedModelsText).toBe('empty');
    expect(ownerOf(draft, 'excludedModelsText')).toBe('member');
    const next = withValue(draft, 'excludedModelsText', 'gemini-*-lite') as NativeDraft;
    expect(next.member.memberModes?.excludedModelsText).toBe('override');
    expect(next.member.excludedModelsText).toBe('gemini-*-lite');
  });

  test('editing one key writes its connection with every other key as it was, with If-Match', async () => {
    const doc = shared();
    const stand = proxy(doc);
    let draft = draftOf(locateKey(doc, entryOf(doc, 'claude', 0))!) as NativeDraft;
    draft = withMember(draft, { weight: 4 }) as NativeDraft;
    draft = withValue(draft, 'headers', [{ key: 'X-Team', value: 'platform' }]) as NativeDraft;
    const { source, settings, members } = nativeSave(draft);
    await providersApi.saveNativeConnection('claude', source, settings, members);
    expect(stand.puts).toHaveLength(1);
    expect(stand.puts[0].path).toBe('/config/api-keys/claude');
    expect(stand.puts[0].ifMatch).toBe('"v1"');
    const [group] = groupsOf(stand.doc(), 'claude');
    expect(group.headers).toEqual({ 'X-Team': 'platform' });
    expect(group['proxy-url']).toBe('socks5://127.0.0.1:1080');
    expect(group.models).toEqual([{ name: 'claude-sonnet-4-6', alias: 'sonnet' }]);
    const keys = group.keys as Doc[];
    expect(keys[0]).toMatchObject({ 'api-key': 'fixture-anthropic-key-0000a1b2', weight: 4 });
    expect(keys[1]).toEqual({
      'api-key': 'fixture-anthropic-key-0000c9d0',
      auth_index: 'ak-anthropic-2',
      weight: 2,
    });
  });

  test('a key is replaced from its settings; its other settings and the other key stay', async () => {
    const doc = shared();
    const stand = proxy(doc);
    const draft = withMember(
      draftOf(locateKey(doc, entryOf(doc, 'claude', 1))!),
      { apiKey: 'fixture-anthropic-key-new-0001' }
    ) as NativeDraft;
    const { source, settings, members } = nativeSave(draft);
    await providersApi.saveNativeConnection('claude', source, settings, members);
    const keys = groupsOf(stand.doc(), 'claude')[0].keys as Doc[];
    expect(keys[0]).toEqual((groupsOf(doc, 'claude')[0].keys as Doc[])[0]);
    expect(keys[1]).toMatchObject({ 'api-key': 'fixture-anthropic-key-new-0001', weight: 2 });
  });

  test("a new key with settings: a connection of its own, named as AI Providers names it, with them", async () => {
    const doc = fixture('config.json');
    const stand = proxy(doc);
    let draft: NativeDraft = newNativeDraft(doc, 'claude', null);
    expect(draft.shared.name).toBe('claude-2');
    expect(settingsTouched(withTyped(draft, { apiKey: 'sk-new' }))).toBe(false);
    draft = withValue(draft, 'proxyUrl', 'socks5://127.0.0.1:1080') as NativeDraft;
    draft = withValue(draft, 'priority', 7) as NativeDraft;
    draft = withTyped(draft, { apiKey: ' sk-new ' }) as NativeDraft;
    expect(settingsTouched(draft)).toBe(true);
    const { source, settings, members } = nativeSave(draft);
    expect(source).toBeUndefined();
    await providersApi.saveNativeConnection('claude', source, settings, members);
    const groups = groupsOf(stand.doc(), 'claude');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(groupsOf(doc, 'claude')[0]);
    expect(groups[1]).toMatchObject({
      name: 'claude-2',
      'proxy-url': 'socks5://127.0.0.1:1080',
      priority: 7,
      keys: [{ 'api-key': 'sk-new' }],
    });
    expect(stand.puts[0].ifMatch).toBe('"v1"');
  });

  test("ChatGPT's key keeps OpenAI's address; the address it needs is checked before saving", () => {
    const doc = fixture('config.json');
    const draft = newNativeDraft(doc, 'codex', 'https://api.openai.com/v1');
    expect(draft.shared.baseUrl).toBe('https://api.openai.com/v1');
    expect(draft.shared.name).toBe('codex-2');
    expect(draftProblem(withShared(draft, { baseUrl: '' }))?.key).toBe(
      'providersPage.form.validation.baseUrlRequired'
    );
    expect(draftProblem(withMember(draft, { weight: MAX_CREDENTIAL_WEIGHT + 1 }))?.key).toBe(
      'providersPage.form.validation.weightMax'
    );
    expect(draftProblem(draft)).toBeNull();
  });

  test("Gemini's key can be for the Interactions API: the same settings, in that family's list", () => {
    const doc = fixture('config.json');
    let draft = newNativeDraft(doc, 'gemini', null);
    draft = withValue(draft, 'prefix', 'g') as NativeDraft;
    const moved = retargeted(doc, draft, 'interactions');
    expect(moved.family).toBe('interactions');
    expect(moved.shared.name).toBe('interactions-1');
    expect(moved.shared.prefix).toBe('g');
  });

  test('a new OpenAI-compatible entry: its name, address, key with its proxy and weight, its models', async () => {
    const doc = fixture('config.json');
    const stand = proxy(doc);
    let draft: CompatibleDraft = newCompatibleDraft('', '');
    draft = withShared(draft, {
      apiKeyEntries: [{ apiKey: '', proxyUrl: 'http://127.0.0.1:7890', weight: 3 }],
    }) as CompatibleDraft;
    draft = withValue(draft, 'models', [{ name: 'example-large-2', alias: '' }]) as CompatibleDraft;
    draft = withTyped(draft, {
      apiKey: 'sk-example',
      name: 'example-ai',
      baseUrl: 'https://api.example.com/v1',
    }) as CompatibleDraft;
    expect(settingsTouched(draft)).toBe(true);
    expect(summaryOf(draft)).toMatchObject({ proxy: true, models: 1, weight: 3 });
    await providersApi.createOpenAIProvider(compatibleConfig(draft));
    const groups = groupsOf(stand.doc(), 'openai-compatibility');
    expect(groups[0]).toEqual(groupsOf(doc, 'openai-compatibility')[0]);
    expect(groups[1]).toMatchObject({
      name: 'example-ai',
      'base-url': 'https://api.example.com/v1',
      keys: [{ 'api-key': 'sk-example', 'proxy-url': 'http://127.0.0.1:7890', weight: 3 }],
      models: [{ name: 'example-large-2' }],
    });
  });

  test("an OpenRouter key joins the entry there: its settings are that entry's, and a save appends it", async () => {
    const doc = fixture('config.json');
    const joining = joiningDraft(doc, 'https://openrouter.ai/api/v1')!;
    expect(joining.resource).not.toBeNull();
    expect(joining.form.apiKeyEntries).toHaveLength(2);
    expect(settingsTouched(withTyped(joining, { apiKey: 'or-2' }))).toBe(false);
    const stand = proxy(doc);
    const draft = withTyped(withValue(joining, 'prefix', 'or'), { apiKey: 'or-2' }) as CompatibleDraft;
    await providersApi.updateOpenAIProvider(
      'openrouter',
      draft.resource!.originalIndex,
      compatibleConfig(draft)
    );
    const [entry] = groupsOf(stand.doc(), 'openai-compatibility');
    expect(entry.prefix).toBe('or');
    expect((entry.keys as Doc[]).map((key) => key['api-key'])).toEqual([
      'fixture-openrouter-key-00g7h8',
      'or-2',
    ]);
    expect(entry.models).toEqual(groupsOf(doc, 'openai-compatibility')[0].models);
    expect(joiningDraft(doc, 'https://api.example.com/v1')).toBeNull();
  });

  test('the panel says in a line what is set', async () => {
    await i18n.changeLanguage('en');
    const doc = shared();
    const draft = draftOf(locateKey(doc, entryOf(doc, 'claude', 1))!);
    expect(settingsStatus(i18n.t, summaryOf(draft), true, false)).toBe('proxy · 1 model · weight 2');
    const plain = draftOf(locateKey(doc, entryOf(doc, 'codex', 0))!);
    expect(settingsStatus(i18n.t, summaryOf(plain), true, true)).toBe('api.openai.com');
    expect(settingsStatus(i18n.t, summaryOf(plain), false)).toBeNull();
  });
});

describe("a login's settings: Auth Files' field patch, without its file", () => {
  const file = (over: Record<string, unknown> = {}): AuthFileItem =>
    ({ name: 'codex-team@example.com.json', type: 'codex', provider: 'codex', ...over }) as AuthFileItem;

  test('what the list shows is read: note, retries, WebSockets, Sign in with ChatGPT when bound', () => {
    const draft = loginDraftOf(
      file({ note: 'team', request_retry: 2, websockets: true, siwcBound: true, useSiwc: false })
    );
    expect(draft).toEqual({
      note: 'team',
      retry: { mode: 'custom', value: '2' },
      websockets: true,
      useSiwc: false,
      replace: {},
    });
    const claude = loginDraftOf(file({ type: 'claude', provider: 'claude' }));
    expect(claude.websockets).toBeNull();
    expect(claude.useSiwc).toBeNull();
    expect(claude.retry.mode).toBe('inherit');
  });

  test('a save sends only what changed; a field kept in the file is written only when set', () => {
    const stored = file({ note: 'team', request_retry: 2, websockets: true });
    const draft: LoginDraft = { ...loginDraftOf(stored) };
    expect(loginPatch(stored, draft)).toEqual({});
    const next: LoginDraft = {
      ...draft,
      note: ' team plan ',
      retry: { mode: 'inherit', value: '' },
      websockets: false,
      replace: {
        proxyUrl: ' socks5://127.0.0.1:1080 ',
        prefix: '',
        weight: '',
        headers: [
          { key: 'X-Team', value: 'platform' },
          { key: 'X-Old', value: '' },
          { key: ' ', value: 'ignored' },
        ],
        excludedModelsText: 'gpt-5-mini\n gpt-5-mini \n*-nano',
        modelAliases: [
          { name: 'gpt-5.2', alias: 'fast' },
          { name: '', alias: '' },
        ],
        disableCooling: true,
      },
    };
    expect(loginPatch(stored, next)).toEqual({
      note: 'team plan',
      request_retry: null,
      websockets: false,
      proxy_url: 'socks5://127.0.0.1:1080',
      prefix: '',
      weight: null,
      headers: { 'X-Team': 'platform', 'X-Old': '' },
      excluded_models: ['gpt-5-mini', '*-nano'],
      model_aliases: [{ name: 'gpt-5.2', alias: 'fast' }],
      disable_cooling: true,
    });
  });

  test('a retry count, a weight and a name are checked before saving', () => {
    const draft = loginDraftOf(file());
    expect(loginProblem({ ...draft, retry: { mode: 'custom', value: '-1' } })).toBe(
      'auth_files.policy_retry_invalid'
    );
    expect(loginProblem({ ...draft, replace: { weight: '1.5' } })).toBe(
      'auth_files.weight_invalid_integer'
    );
    expect(loginProblem({ ...draft, replace: { modelAliases: [{ name: 'a', alias: ' ' }] } })).toBe(
      'auth_files.policy_aliases_invalid'
    );
    expect(loginProblem({ ...draft, replace: { weight: '3' } })).toBeNull();
  });
});

describe('writes that fail', () => {
  test("AI Providers' refusal of a connection that changed, and a 412, read again", async () => {
    await i18n.changeLanguage('en');
    const conflict = new Error('Provider configuration changed or is ambiguous; refresh and try again.');
    expect(isChangedError(conflict)).toBe(true);
    expect(isChangedError(Object.assign(new Error('x'), { status: 412 }))).toBe(true);
    expect(isChangedError(new Error('boom'))).toBe(false);
    expect(writeErrorMessage(i18n.t, conflict)).toBe(i18n.t('provimux.accounts.write_changed'));
    expect(writeErrorMessage(i18n.t, new Error('providersPage.form.validation.baseUrlRequired'))).toBe(
      i18n.t('providersPage.form.validation.baseUrlRequired')
    );
  });
});

describe('what the page does not do', () => {
  const dir = 'src/provimux/pages/accounts';
  const files = [
    'KeySettingsFields.tsx',
    'LoginSettingsFields.tsx',
    'AdvancedSettings.tsx',
    'loginSettings.ts',
    'settingsSummary.ts',
  ];

  test('it never downloads a login file; the settings views never hold a key', () => {
    for (const name of [...files, 'keySettings.ts']) {
      const source = read(`${dir}/${name}`);
      expect({ name, download: /\.download(Text)?\(|credentials\/download/.test(source) }).toEqual({
        name,
        download: false,
      });
    }
    for (const name of files) {
      const source = read(`${dir}/${name}`);
      expect({ name, apiKey: /\.apiKey\b/.test(source) }).toEqual({ name, apiKey: false });
    }
  });

  test('the only upstream file changed for it exports the form reader AI Providers already had', () => {
    const form = read('src/features/providers/sheets/forms/BaseProviderForm.tsx');
    expect(form).toContain('export function buildInitialForm(');
  });
});

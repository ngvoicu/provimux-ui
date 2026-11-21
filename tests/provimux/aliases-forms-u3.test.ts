// ALP-04 U3 (design aliases-page.md 5.1, 6.2, 7): the provider forms lose the alias field and keep a
// read-only line and a link; their saves still keep every alias. Tests F-2 and F-4.
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index';
import { apiClient } from '@/services/api/client';
import { providersApi, type ProviderFamily } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import { readModelOptions } from '@/features/providers/modelOptions';
import {
  buildOpenAIConfig,
  buildProviderKeyConfig,
} from '@/features/providers/useProviderWorkbench';
import { ModelEntriesEditor } from '@/features/providers/sheets/forms/ModelEntriesEditor';
import type { ModelEntryInput, ProviderEntryFormInput } from '@/features/providers/types';
import { aliasesPageFor, familyOfBrand } from '@/provimux/components/aliasLinks';
import type { GeminiKeyConfig, ModelAlias, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';

const initialLanguage = i18n.language;
const originalGet = apiClient.get;
const originalPut = apiClient.put;
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

const noop = () => undefined;
const editor = (models: ModelEntryInput[], extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ModelEntriesEditor, {
        models,
        providerBrand: 'claude',
        supportsImage: false,
        supportsThinking: true,
        mutating: false,
        removeDisabled: false,
        onUpdate: noop,
        onAdd: noop,
        onRemove: noop,
        ...extra,
      })
    )
  );

describe('F-4 the editor', () => {
  const rows: ModelEntryInput[] = [
    { name: 'claude-opus-5-5', alias: 'opus' },
    { name: 'claude-haiku-5-5', alias: '' },
    { name: 'claude-sonnet-5', alias: 'claude-sonnet-5' },
  ];

  test("a provider's list: the alias input is hidden, the alias shows as text, with the line and its link", async () => {
    await i18n.changeLanguage('en');
    const html = editor(rows);
    const aliasInputs = [...html.matchAll(/<input[^>]*placeholder="Alias[^"]*"[^>]*>/gi)].map(
      (m) => m[0]
    );
    expect(aliasInputs.length).toBe(3);
    for (const input of aliasInputs) expect(input).toContain('type="hidden"');
    expect(html).toContain('1 alias');
    expect(html).toContain('href="/provimux/aliases?family=claude"');
    expect(html).toContain('Set aliases on the Aliases page');
    expect(html).toMatch(/→<\/span>opus</);
    // A row without an alias, or with its own name, shows no alias text.
    expect(html).not.toMatch(/→<\/span>claude-sonnet-5</);
  });

  test("without a router (as upstream's own static tests render it), the link is a plain hash link", async () => {
    await i18n.changeLanguage('en');
    const html = renderToStaticMarkup(
      createElement(ModelEntriesEditor, {
        models: rows,
        providerBrand: 'claude',
        supportsImage: false,
        supportsThinking: true,
        mutating: false,
        removeDisabled: false,
        onUpdate: noop,
        onAdd: noop,
        onRemove: noop,
      })
    );
    expect(html).toContain('href="#/provimux/aliases?family=claude"');
  });

  test("a login's own aliases: the input stays, no line, no alias text", async () => {
    await i18n.changeLanguage('en');
    const html = editor(rows, { oauthAliasOnly: true, providerBrand: undefined });
    expect(html).not.toContain('type="hidden"');
    expect(html).toMatch(/<input[^>]*type="text"[^>]*value="opus"/);
    expect(html).not.toContain('/provimux/aliases');
    expect(html).not.toContain('Set aliases on the Aliases page');
  });

  test('no aliases: "No aliases"; the link carries the family, none for a brand that is no family', async () => {
    await i18n.changeLanguage('en');
    expect(editor([{ name: 'm', alias: '' }])).toContain('No aliases');
    expect(familyOfBrand('openaiCompatibility')).toBe('openai-compatibility');
    expect(familyOfBrand('vertex')).toBe('vertex');
    expect(familyOfBrand('apikeyFun')).toBeNull();
    expect(aliasesPageFor('apikeyFun')).toBe('/provimux/aliases');
    expect(aliasesPageFor('openaiCompatibility')).toBe(
      '/provimux/aliases?family=openai-compatibility'
    );
  });
});

/** A store of one family: GET /config answers it, PUT /config/api-keys/<family> replaces it. */
function backend(family: ProviderFamily, group: Record<string, unknown>) {
  let stored = [structuredClone(group)];
  const writes: unknown[] = [];
  apiClient.get = (async () => ({
    'api-keys': { [family]: structuredClone(stored) },
  })) as typeof apiClient.get;
  apiClient.put = (async (path: string, value: Record<string, unknown>[]) => {
    expect(path).toBe(`/config/api-keys/${family}`);
    writes.push(structuredClone(value));
    stored = structuredClone(value);
  }) as typeof apiClient.put;
  return { stored: () => stored, writes };
}

/** The form's model inputs as BaseProviderForm builds them from a stored config. */
const formModels = (models: ModelAlias[] | undefined): ModelEntryInput[] =>
  (models ?? []).map((m) => ({
    sourceIndex: m.sourceIndex,
    name: m.name,
    alias: m.alias ?? '',
    priority: m.priority,
    ...readModelOptions(m),
  }));

const emptyForm = (): ProviderEntryFormInput => ({
  apiKey: '',
  name: '',
  baseUrl: '',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  models: [],
  headers: [],
  excludedModelsText: '',
});

const STORED_MODELS = [
  { name: 'm-one', alias: 'one' },
  { name: 'm-two', alias: 'two', 'force-mapping': true },
  { name: 'm-three' },
];
const aliasesOf = (models: unknown) =>
  (models as Record<string, unknown>[]).filter((m) => m.alias).map((m) => [m.name, m.alias]);

type KeyBrand = 'gemini' | 'interactions' | 'codex' | 'meta' | 'xai' | 'claude' | 'vertex';
const UPDATE: Record<KeyBrand, (config: ProviderKeyConfig) => Promise<unknown>> = {
  gemini: (c) => providersApi.updateGeminiKey(c.apiKey, c.baseUrl, c as GeminiKeyConfig),
  interactions: (c) =>
    providersApi.updateInteractionsKey(c.apiKey, c.baseUrl, c as GeminiKeyConfig),
  codex: (c) => providersApi.updateCodexConfig(c.apiKey, c.baseUrl, c),
  meta: (c) => providersApi.updateMetaConfig(c.apiKey, c.baseUrl, c),
  xai: (c) => providersApi.updateXAIConfig(c.apiKey, c.baseUrl, c),
  claude: (c) => providersApi.updateClaudeConfig(c.apiKey, c.baseUrl, c),
  vertex: (c) => providersApi.updateVertexConfig(c.apiKey, c.baseUrl, c),
};

describe('F-2 a form save keeps every alias, with the alias field gone', () => {
  for (const brand of Object.keys(UPDATE) as KeyBrand[]) {
    for (const edit of ['add', 'remove'] as const) {
      test(`${brand}: ${edit} a model row`, async () => {
        const b = backend(brand, {
          name: `${brand}-1`,
          'base-url': 'https://relay.example.invalid/v1',
          keys: [{ 'api-key': `fixture-key-${brand}`, models: STORED_MODELS }],
        });
        const config = (normalizeProviderGroups(b.stored()) as ProviderKeyConfig[])[0];
        const loaded = formModels(config.models);
        const models =
          edit === 'add'
            ? [...loaded, { sourceIndex: undefined, name: 'm-new', alias: '' }]
            : loaded.filter((m) => m.name !== 'm-three');
        const next = buildProviderKeyConfig(brand, { ...emptyForm(), models }, config);
        await UPDATE[brand](next as ProviderKeyConfig);
        expect(b.writes).toHaveLength(1);
        const key = (b.stored()[0].keys as Record<string, unknown>[])[0];
        expect(aliasesOf(key.models)).toEqual([
          ['m-one', 'one'],
          ['m-two', 'two'],
        ]);
        const names = (key.models as { name: string }[]).map((m) => m.name);
        expect(names).toEqual(
          edit === 'add' ? ['m-one', 'm-two', 'm-three', 'm-new'] : ['m-one', 'm-two']
        );
      });
    }
  }

  for (const edit of ['add', 'remove'] as const) {
    test(`openai-compatibility: ${edit} a model row`, async () => {
      const b = backend('openai-compatibility', {
        name: 'relay',
        'base-url': 'https://relay.example.invalid/v1',
        keys: [{ 'api-key': 'fixture-key-openai' }],
        models: STORED_MODELS,
      });
      const config = (normalizeProviderGroups(b.stored(), true) as OpenAIProviderConfig[])[0];
      const loaded = formModels(config.models);
      const models =
        edit === 'add'
          ? [...loaded, { sourceIndex: undefined, name: 'm-new', alias: '' }]
          : loaded.filter((m) => m.name !== 'm-three');
      const next = buildOpenAIConfig(
        {
          ...emptyForm(),
          name: config.name,
          baseUrl: config.baseUrl,
          apiKeyEntries: config.apiKeyEntries.map((entry) => ({
            apiKey: '',
            existingApiKey: entry.apiKey,
            sourceIndex: entry.sourceIndex,
            proxyUrl: '',
          })),
          models,
        },
        config
      );
      await providersApi.updateOpenAIProvider(next.name, 0, next);
      expect(b.writes).toHaveLength(1);
      expect(aliasesOf(b.stored()[0].models)).toEqual([
        ['m-one', 'one'],
        ['m-two', 'two'],
      ]);
    });
  }
});

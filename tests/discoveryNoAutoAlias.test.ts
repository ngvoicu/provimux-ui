import { afterEach, describe, expect, test } from 'bun:test';
import { apiCallApi, type ApiCallRequest, type ApiCallResult } from '@/services/api';
import { apiClient } from '@/services/api/client';
import { modelsApi } from '@/services/api/models';
import { providersApi, type ProviderFamily } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import {
  claudeToResource,
  codexToResource,
  geminiToResource,
  interactionsToResource,
  metaToResource,
  openaiToResource,
  xaiToResource,
} from '@/features/providers/adapters';
import { syncDiscoveredModels } from '@/features/providers/discoverySelection';
import { discoveryBrandForSponsorProtocol } from '@/features/providers/sponsorDefinitions';
import { mergeDiscoveredModels } from '@/features/providers/modelEntries';
import {
  buildOpenAIConfig,
  buildProviderKeyConfig,
} from '@/features/providers/useProviderWorkbench';
import type {
  ProviderBrand,
  ProviderEntryFormInput,
  ProviderResource,
} from '@/features/providers/types';
import type { ModelAlias, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { ModelInfo } from '@/utils/models';

/*
 * A fetch from a provider's endpoint adds model names only. Canned endpoint answers
 * carry everything an endpoint may send next to a name (display names, descriptions and
 * an explicit `alias` field); none of it may become an alias. An alias typed earlier stays.
 */

const originalRequest = apiCallApi.request;
const originalGet = apiClient.get;
const originalPut = apiClient.put;
afterEach(() => {
  apiCallApi.request = originalRequest;
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});

const reply = (body: unknown): ApiCallResult => ({
  statusCode: 200,
  header: {},
  bodyText: JSON.stringify(body),
  body,
});

// Shapes of the real list answers, with an extra `alias` field on one entry each.
const openAIList = {
  object: 'list',
  data: [
    { id: 'plain-model', object: 'model', owned_by: 'fixture' },
    { id: 'labelled-model', object: 'model', display_name: 'Labelled Model' },
    { id: 'relay-model', object: 'model', alias: 'relay-alias', name: 'Relay Model' },
  ],
};
const claudeList = {
  data: [
    { type: 'model', id: 'plain-model', display_name: 'Plain Model' },
    { type: 'model', id: 'labelled-model', display_name: 'Labelled Model' },
    { type: 'model', id: 'relay-model', display_name: 'Relay Model', alias: 'relay-alias' },
  ],
  has_more: false,
};
const geminiList = {
  models: [
    { name: 'models/plain-model', displayName: 'Plain Model', description: 'Fixture' },
    { name: 'models/labelled-model', displayName: 'Labelled Model' },
    { name: 'models/relay-model', displayName: 'Relay Model', alias: 'relay-alias' },
  ],
};
const FETCHED = ['plain-model', 'labelled-model', 'relay-model'];

type KeyBrand = 'gemini' | 'interactions' | 'codex' | 'meta' | 'xai' | 'claude';
interface Kind {
  brand: KeyBrand | 'openaiCompatibility';
  family: ProviderFamily;
  answer: unknown;
  fetch: () => Promise<ModelInfo[]>;
  toResource: (config: never, index: number) => ProviderResource;
  update: (config: never) => Promise<void>;
}

const keyKind = (
  brand: KeyBrand,
  answer: unknown,
  fetch: () => Promise<ModelInfo[]>,
  toResource: (config: ProviderKeyConfig, index: number) => ProviderResource,
  update: (apiKey: string, baseUrl: string | undefined, config: ProviderKeyConfig) => Promise<void>
): Kind => ({
  brand,
  family: brand,
  answer,
  fetch,
  toResource: toResource as Kind['toResource'],
  update: ((config: ProviderKeyConfig) =>
    update(config.apiKey, config.baseUrl, config)) as Kind['update'],
});

const BASE = 'https://endpoint.invalid';
const KEY = 'fixture-key';
const KINDS: Kind[] = [
  keyKind(
    'gemini',
    geminiList,
    () => modelsApi.fetchGeminiModelsViaApiCall(BASE, KEY),
    geminiToResource,
    providersApi.updateGeminiKey
  ),
  keyKind(
    'interactions',
    geminiList,
    () => modelsApi.fetchGeminiModelsViaApiCall(`${BASE}/interactions`, KEY),
    interactionsToResource,
    providersApi.updateInteractionsKey
  ),
  keyKind(
    'codex',
    openAIList,
    () => modelsApi.fetchV1ModelsViaApiCall(BASE, KEY),
    codexToResource,
    providersApi.updateCodexConfig
  ),
  keyKind(
    'meta',
    openAIList,
    () => modelsApi.fetchV1ModelsViaApiCall(`${BASE}/meta`, KEY),
    metaToResource,
    providersApi.updateMetaConfig
  ),
  keyKind(
    'xai',
    openAIList,
    () => modelsApi.fetchV1ModelsViaApiCall(`${BASE}/xai`, KEY),
    xaiToResource,
    providersApi.updateXAIConfig
  ),
  keyKind(
    'claude',
    claudeList,
    () => modelsApi.fetchClaudeModelsViaApiCall(BASE, KEY),
    claudeToResource,
    providersApi.updateClaudeConfig
  ),
  {
    brand: 'openaiCompatibility',
    family: 'openai-compatibility',
    answer: openAIList,
    fetch: () => modelsApi.fetchModelsViaApiCall(`${BASE}/v1`, KEY),
    toResource: openaiToResource as Kind['toResource'],
    update: ((config: OpenAIProviderConfig) =>
      providersApi.updateOpenAIProvider(config.name, 0, config)) as Kind['update'],
  },
];

/** The provider as the Management API stores it: one model row with a typed alias. */
function storedGroup(kind: Kind): Record<string, unknown> {
  const models = [{ name: 'kept-model', alias: 'typed-alias' }];
  if (kind.family === 'openai-compatibility') {
    return { name: 'fixture', 'base-url': BASE, keys: [{ 'api-key': KEY }], models };
  }
  return { name: 'fixture', keys: [{ 'api-key': KEY, models }] };
}

function mockBackend(kind: Kind) {
  let stored = structuredClone(storedGroup(kind));
  const answers: string[] = [];
  apiClient.get = (async () => ({
    'api-keys': { [kind.family]: [stored] },
  })) as typeof apiClient.get;
  apiClient.put = (async (_path: string, value: Record<string, unknown>[]) => {
    stored = structuredClone(value[0]);
  }) as typeof apiClient.put;
  apiCallApi.request = (async (request: ApiCallRequest) => {
    answers.push(request.url);
    return reply(kind.answer);
  }) as typeof apiCallApi.request;
  return { stored: () => stored, answers };
}

const emptyForm = (brand: ProviderBrand): ProviderEntryFormInput => ({
  apiKey: '',
  name: brand === 'openaiCompatibility' ? 'fixture' : '',
  baseUrl: brand === 'openaiCompatibility' ? BASE : '',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  models: [],
  headers: [],
  excludedModelsText: '',
  apiKeyEntries:
    brand === 'openaiCompatibility'
      ? [{ apiKey: '', existingApiKey: KEY, sourceIndex: 0, proxyUrl: '' }]
      : undefined,
});

const loadForm = (kind: Kind, stored: Record<string, unknown>) => {
  const config = normalizeProviderGroups([stored], kind.family === 'openai-compatibility')[0];
  // The edit form reads `resource.raw.models` and shows `alias ?? ''` for each row.
  const resource = kind.toResource(config as never, 0);
  const models = ((resource.raw as { models?: ModelAlias[] }).models ?? []).map((model) => ({
    ...model,
    alias: model.alias ?? '',
  }));
  return { config, form: { ...emptyForm(kind.brand), models } };
};

const savedModels = (kind: Kind, stored: Record<string, unknown>) =>
  (kind.family === 'openai-compatibility'
    ? stored.models
    : (stored.keys as Record<string, unknown>[])[0].models) as Record<string, unknown>[];

describe('a fetch from the endpoint never sets an alias', () => {
  test.each(KINDS.map((kind) => [kind.brand, kind] as const))(
    '%s: fetch adds bare names, keeps the typed alias, saves and reloads without new aliases',
    async (_brand, kind) => {
      const backend = mockBackend(kind);
      const before = loadForm(kind, backend.stored());

      const catalog = await kind.fetch();
      expect(backend.answers).toHaveLength(1);
      expect(catalog.map(({ name }) => name)).toEqual(FETCHED);

      const rows = syncDiscoveredModels(before.form.models, catalog, catalog);
      expect(rows.map(({ name, alias }) => ({ name, alias }))).toEqual([
        { name: 'kept-model', alias: 'typed-alias' },
        ...FETCHED.map((name) => ({ name, alias: '' })),
      ]);

      const form = { ...before.form, models: rows };
      const next =
        kind.brand === 'openaiCompatibility'
          ? buildOpenAIConfig(form, before.config as OpenAIProviderConfig)
          : buildProviderKeyConfig(kind.brand, form, before.config as ProviderKeyConfig);
      await kind.update(next as never);

      expect(savedModels(kind, backend.stored())).toEqual([
        { name: 'kept-model', alias: 'typed-alias' },
        ...FETCHED.map((name) => ({ name })),
      ]);

      const after = loadForm(kind, backend.stored());
      expect(after.form.models.map(({ name, alias }) => ({ name, alias }))).toEqual([
        { name: 'kept-model', alias: 'typed-alias' },
        ...FETCHED.map((name) => ({ name, alias: '' })),
      ]);
    }
  );

  test('sponsor providers fetch through the same kinds', () => {
    const tested = new Set<string>(KINDS.map((kind) => kind.brand));
    for (const protocol of ['openai', 'codex', 'claude', 'gemini'] as const) {
      expect(tested.has(discoveryBrandForSponsorProtocol(protocol))).toBe(true);
    }
  });

  test('a fetched name that is already a row keeps that row and its alias', () => {
    const current = [
      { name: 'relay-model', alias: 'typed-alias', priority: 3 },
      { name: 'outside', alias: 'other-alias' },
    ];
    const catalog: ModelInfo[] = [
      { name: 'relay-model', alias: 'relay-alias', displayName: 'Relay Model' },
      { name: 'new-model', alias: 'endpoint-alias' },
    ];
    const rows = syncDiscoveredModels(current, catalog, catalog);
    expect(rows).toEqual([...current, { name: 'new-model', alias: '' }]);
    expect(rows[0]).toBe(current[0]);
  });

  test('the older merge helper adds bare names too', () => {
    const current = [{ name: 'kept-model', alias: 'typed-alias' }];
    expect(
      mergeDiscoveredModels(current, [
        { name: 'kept-model', alias: 'endpoint-alias' },
        { name: ' new-model ', alias: 'endpoint-alias', displayName: 'New Model' },
      ])
    ).toEqual([...current, { name: 'new-model', alias: '' }]);
  });
});

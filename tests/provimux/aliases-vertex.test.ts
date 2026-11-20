import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { providersApi } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import { vertexToResource } from '@/features/providers/adapters';
import { buildProviderKeyConfig } from '@/features/providers/useProviderWorkbench';
import type { ProviderEntryFormInput } from '@/features/providers/types';
import type { ModelAlias, ProviderKeyConfig } from '@/types';

/*
 * ALP-03 W1 (design aliases-page.md 5.2): the proxy serves a Vertex row with a name alone
 * under its name; the console's Vertex serializer used to leave such rows out of the
 * request. Tests F-1 and F-3.
 */

const originalGet = apiClient.get;
const originalPut = apiClient.put;
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});

function backend(group: Record<string, unknown>) {
  let stored = structuredClone(group);
  const writes: unknown[] = [];
  apiClient.get = (async () => ({
    'api-keys': { vertex: [structuredClone(stored)] },
  })) as typeof apiClient.get;
  apiClient.put = (async (path: string, value: Record<string, unknown>[]) => {
    expect(path).toBe('/config/api-keys/vertex');
    writes.push(structuredClone(value));
    stored = structuredClone(value[0]);
  }) as typeof apiClient.put;
  return { stored: () => stored, writes };
}
const row = (group: Record<string, unknown>) =>
  (normalizeProviderGroups([group]) as ProviderKeyConfig[])[0];
const models = (group: Record<string, unknown>) =>
  (group.keys as Record<string, unknown>[])[0].models;

describe('F-1 the Vertex writer keeps a row with a name alone', () => {
  test('name-only row with options, aliased row, same-name row; a nameless row is left out', async () => {
    const sameName = { name: 'gemini-s', alias: 'gemini-s', thinking: { levels: ['high'] } };
    const aliased = { name: 'gemini-y', alias: 'why' };
    const b = backend({
      name: 'vertex-1',
      keys: [{ 'api-key': 'fixture-key-1', models: [sameName, aliased] }],
    });
    const config = row(b.stored());
    await providersApi.updateVertexConfig(config.apiKey, undefined, {
      ...config,
      models: [
        ...config.models!,
        { sourceIndex: null, name: 'gemini-x', displayName: 'Gemini X', forceMapping: true },
        { sourceIndex: null, name: '  ', alias: 'orphan' },
      ],
    });
    expect(models(b.stored())).toEqual([
      sameName,
      aliased,
      { name: 'gemini-x', 'display-name': 'Gemini X', 'force-mapping': true },
    ]);
  });

  test('a stored name-only row survives an edit of another field', async () => {
    const stored = [{ name: 'gemini-x' }, { name: 'gemini-y', alias: 'why' }];
    const b = backend({
      name: 'vertex-1',
      keys: [{ 'api-key': 'fixture-key-1', models: stored }],
    });
    const config = row(b.stored());
    expect(config.models!.map(({ name, alias }) => ({ name, alias }))).toEqual([
      { name: 'gemini-x', alias: undefined },
      { name: 'gemini-y', alias: 'why' },
    ]);
    await providersApi.updateVertexConfig(config.apiKey, undefined, { ...config, weight: 3 });
    expect((b.stored().keys as Record<string, unknown>[])[0]).toEqual({
      'api-key': 'fixture-key-1',
      models: stored,
      weight: 3,
    });
  });

  test('changing one model keeps the key’s other name-only rows', async () => {
    const b = backend({
      name: 'vertex-1',
      keys: [
        {
          'api-key': 'fixture-key-1',
          models: [{ name: 'gemini-x' }, { name: 'gemini-y', alias: 'why' }],
        },
      ],
    });
    const config = row(b.stored());
    await providersApi.updateVertexConfig(config.apiKey, undefined, {
      ...config,
      models: config.models!.map((model) =>
        model.name === 'gemini-y' ? { ...model, alias: 'why-not' } : model
      ),
    });
    expect(models(b.stored())).toEqual([
      { name: 'gemini-x' },
      { name: 'gemini-y', alias: 'why-not' },
    ]);
  });
});

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

describe('F-3 a Vertex form save with a new name-only row', () => {
  test('writes that row', async () => {
    const b = backend({
      name: 'vertex-1',
      keys: [{ 'api-key': 'fixture-key-1', models: [{ name: 'gemini-y', alias: 'why' }] }],
    });
    // As the form loads it: `resource.raw.models`, each row's alias shown as `alias ?? ''`.
    const config = row(b.stored());
    const resource = vertexToResource(config, 0);
    const loaded = ((resource.raw as { models?: ModelAlias[] }).models ?? []).map((model) => ({
      ...model,
      alias: model.alias ?? '',
    }));
    const form = {
      ...emptyForm(),
      models: [...loaded, { sourceIndex: null, name: 'gemini-x', alias: '' }],
    };
    const next = buildProviderKeyConfig('vertex', form, config) as ProviderKeyConfig;
    await providersApi.updateVertexConfig(next.apiKey, next.baseUrl, next);
    expect(b.writes).toHaveLength(1);
    expect(models(b.stored())).toEqual([{ name: 'gemini-y', alias: 'why' }, { name: 'gemini-x' }]);
  });
});

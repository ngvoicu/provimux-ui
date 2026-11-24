import { describe, expect, test } from 'bun:test';
import { familyWithKeyOn } from '@/provimux/pages/accounts/keyWrites';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import type { KeyEntry } from '@/provimux/pages/aliases/types';

/*
 * Upstream 1.29.2: a native key without `api-key` in a group with a base URL is a key the proxy
 * serves (it makes a native auth for it) for gemini, interactions, codex, claude and xai, and AI
 * Providers lists it. Models, Accounts and the alias rows read it the same way, and switch it on
 * and off with the same `excluded-models` shape as any other native key.
 */

const document = {
  'api-keys': {
    codex: [
      {
        'base-url': 'https://relay.example.com/v1',
        keys: [{ models: [{ name: 'gpt-5', alias: 'fast' }] }],
      },
    ],
    // meta has no endpoint-only keys upstream: a keyless meta key stays unread.
    meta: [{ 'base-url': 'https://meta.example.com/v1', keys: [{}] }],
  },
};

describe('endpoint-only native keys', () => {
  const state = readAliasState(document, []);
  const keys = state.entries.filter((e): e is KeyEntry => e.store === 'api-key');

  test('a keyless codex key under a base URL is an entry with its host and rows', () => {
    const codex = keys.find((e) => e.family === 'codex');
    expect(codex).toBeDefined();
    expect(codex?.id).toBe('codex/0/0');
    expect(codex?.host).toBe('relay.example.com');
    expect(codex?.keyPreview).toBe('');
    expect(codex?.disabled).toBe(false);
    expect(state.rows.filter((r) => r.entryId === 'codex/0/0').map((r) => r.alias)).toEqual([
      'fast',
    ]);
  });

  test('a keyless key of a family without endpoint-only keys stays unread', () => {
    expect(keys.some((e) => e.family === 'meta')).toBe(false);
    expect([...state.unread]).toContain('api-keys.meta[0].keys[0]');
  });

  test('off and on write excluded-models ["*"] on that key, as AI Providers does', () => {
    const codex = keys.find((e) => e.family === 'codex')!;
    const off = familyWithKeyOn(document, codex, false) as Array<Record<string, unknown>>;
    const offKey = (off[0].keys as Array<Record<string, unknown>>)[0];
    expect(offKey['excluded-models']).toEqual(['*']);
    expect(offKey.models).toEqual([{ name: 'gpt-5', alias: 'fast' }]);
    const offDoc = { 'api-keys': { ...document['api-keys'], codex: off } };
    const offEntry = readAliasState(offDoc, []).entries.find(
      (e): e is KeyEntry => e.store === 'api-key' && e.family === 'codex'
    )!;
    expect(offEntry.disabled).toBe(true);
    const on = familyWithKeyOn(offDoc, offEntry, true) as Array<Record<string, unknown>>;
    const onKey = (on[0].keys as Array<Record<string, unknown>>)[0];
    expect(onKey['excluded-models'] ?? []).toEqual([]);
  });
});

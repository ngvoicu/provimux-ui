import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readModelRoutes } from '@/provimux/api/normalize';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import { changeRow, startDraft } from '@/provimux/pages/aliases/draft';
import { nameGroups } from '@/provimux/pages/aliases/collisions';
import { servedOf } from '@/provimux/pages/models/catalog';
import type { AliasDraft, ServedNames } from '@/provimux/pages/aliases/types';

/*
 * ALP-03 W5, test N-3 (design aliases-page.md 4.4, as corrected: authIndexes, auth_index). The Models page
 * reads every route at once (`/provimux/model-routes` without names); `servedOf` turns that answer into the
 * served names the name check takes.
 */

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/aliases/${name}`, 'utf8'));
const loaded = () => readAliasState(fixture('config-full.json'), [{ type: 'claude' }]);
const served = (): ServedNames => servedOf(readModelRoutes(fixture('model-routes.json')));
const group = (draft: AliasDraft, known: ServedNames | undefined, key: string) =>
  nameGroups(draft, known).find((g) => g.key === key)!;

describe('N-3 native names, with /provimux/model-routes', () => {
  test('the stored indexes are the proxy’s auth_index; an OpenAI-compatible entry has its keys’', () => {
    const byId = new Map(loaded().entries.map((e) => [e.id, e]));
    const indexes = (id: string) => {
      const entry = byId.get(id)!;
      return entry.store === 'api-key' ? entry.authIndexes : null;
    };
    expect(indexes('claude/1/0')).toEqual(['ai-claude-3']);
    expect(indexes('xai/0/0')).toEqual(['ai-xai-1']);
    expect(indexes('openai-compatibility/0/g')).toEqual(['ai-openrouter-1', 'ai-openrouter-2']);
    expect(indexes('openai-compatibility/2/g')).toEqual(['ai-local-nokeys']);
  });

  test('the answer, by name: every route of each model, compared as names are', () => {
    const known = served();
    expect(known.known).toBe(true);
    expect(Object.keys(known.byName)).toContain('claude-opus-5-5');
    expect(known.byName['claude-opus-5-5'].map((r) => r.kind)).toEqual(['oauth', 'apikey']);
  });

  test('an alias equal to a login’s built-in name: several-services, that login native', () => {
    const known = served();
    const draft = changeRow(startDraft(loaded()), 'xai/0/0#0', { alias: 'claude-opus-5-5' });
    const g = group(draft, known, 'claude-opus-5-5');
    expect(g.rowIds).toEqual(['claude/1/0#3', 'xai/0/0#0']);
    expect(g.nativeServices).toEqual(['login:claude']);
    expect(g.services).toEqual(['key:claude', 'key:xai', 'login:claude']);
    expect(g.verdict).toBe('several-services');
    // Without the edit the stored row alone collides with the login's built-in name.
    expect(group(startDraft(loaded()), known, 'claude-opus-5-5').verdict).toBe('several-services');
    expect(group(startDraft(loaded()), undefined, 'claude-opus-5-5').verdict).toBe('single');
  });

  test('a route of the row’s own entry is not native, OpenAI-compatible keys included', () => {
    const known = served();
    const draft = startDraft(loaded());
    expect(group(draft, known, 'opus').nativeServices).toEqual([]);
    expect(group(draft, known, 'or/opus')).toMatchObject({
      nativeServices: [],
      verdict: 'several-models',
      pool: true,
    });
    // The ai-claude-3 route of claude-opus-5-5 is the stored row's own.
    expect(group(draft, known, 'claude-opus-5-5').nativeServices).toEqual(['login:claude']);
  });

  test('a key without a model list serves a name natively; a route of unknown kind is ignored', () => {
    const draft = changeRow(startDraft(loaded()), 'xai/0/0#0', { alias: 'gemini-2.5-flash' });
    const g = group(draft, served(), 'gemini-2.5-flash');
    expect(g.nativeServices).toEqual(['key:interactions']);
    expect(g.services).toEqual(['key:interactions', 'key:xai']);
    expect(g.verdict).toBe('several-services');
  });
});

describe('N-3 the fallback, a proxy without the endpoint', () => {
  test('no answer gives known: false and the verdict from rows only', () => {
    const none = servedOf(null);
    expect(none).toEqual({ known: false, byName: {} });
    const draft = changeRow(startDraft(loaded()), 'xai/0/0#0', { alias: 'gemini-2.5-flash' });
    expect(group(draft, none, 'gemini-2.5-flash')).toMatchObject({
      nativeServices: [],
      services: ['key:xai'],
      verdict: 'single',
    });
    expect(group(draft, none, 'claude-opus-5-5').verdict).toBe('single');
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiClient } from '@/services/api/client';
import { useProvimuxPresence } from '@/provimux/presence';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import { changeRow, startDraft } from '@/provimux/pages/aliases/draft';
import { draftClientNames, nameGroups } from '@/provimux/pages/aliases/collisions';
import {
  createServedNamesSource,
  loadServedNames,
  UNKNOWN_SERVED,
} from '@/provimux/pages/aliases/aliasesApi';
import type { AliasDraft, ServedNames } from '@/provimux/pages/aliases/types';

/* ALP-03 W5, test N-3 (design aliases-page.md 4.4, as corrected: authIndexes, auth_index). */

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/aliases/${name}`, 'utf8'));
const loaded = () => readAliasState(fixture('config-full.json'), [{ type: 'claude' }]);

const originalGet = apiClient.get;
afterEach(() => {
  apiClient.get = originalGet;
  useProvimuxPresence.getState().reset();
});

/** GET /provimux/model-routes answers the fixture; every URL asked is recorded. */
function routes(answer: () => unknown = () => fixture('model-routes.json')) {
  const asked: string[] = [];
  apiClient.get = (async (url: string) => {
    asked.push(url);
    if (!url.startsWith('/provimux/model-routes')) throw new Error(`unexpected GET ${url}`);
    return answer();
  }) as typeof apiClient.get;
  return asked;
}
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const group = (draft: AliasDraft, served: ServedNames | undefined, key: string) =>
  nameGroups(draft, served).find((g) => g.key === key)!;

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

  test('asks for the draft’s client names, as written, in one request', async () => {
    const asked = routes();
    const draft = startDraft(loaded());
    await loadServedNames(draftClientNames(draft));
    expect(asked).toHaveLength(1);
    const query = new URLSearchParams(asked[0].split('?')[1]).getAll('model');
    expect(asked[0].startsWith('/provimux/model-routes?model=')).toBe(true);
    expect(query).toContain('opus');
    expect(query).toContain('or/opus');
    expect(query).toContain('relay/fast');
    expect(new Set(query).size).toBe(query.length);
  });

  test('an alias equal to a login’s built-in name: several-services, that login native', async () => {
    routes();
    const draft = changeRow(startDraft(loaded()), 'xai/0/0#0', { alias: 'claude-opus-5-5' });
    const served = await loadServedNames(draftClientNames(draft));
    expect(served.known).toBe(true);
    const g = group(draft, served, 'claude-opus-5-5');
    expect(g.rowIds).toEqual(['claude/1/0#3', 'xai/0/0#0']);
    expect(g.nativeServices).toEqual(['login:claude']);
    expect(g.services).toEqual(['key:claude', 'key:xai', 'login:claude']);
    expect(g.verdict).toBe('several-services');
    // Without the edit the stored row alone collides with the login's built-in name.
    const base = group(startDraft(loaded()), served, 'claude-opus-5-5');
    expect(base.verdict).toBe('several-services');
    expect(group(startDraft(loaded()), undefined, 'claude-opus-5-5').verdict).toBe('single');
  });

  test('a route of the row’s own entry is not native, OpenAI-compatible keys included', async () => {
    routes();
    const draft = startDraft(loaded());
    const served = await loadServedNames(draftClientNames(draft));
    const opus = group(draft, served, 'opus');
    expect(opus.nativeServices).toEqual([]);
    const orOpus = group(draft, served, 'or/opus');
    expect(orOpus).toMatchObject({ nativeServices: [], verdict: 'several-models', pool: true });
    // The ai-claude-3 route of claude-opus-5-5 is the stored row's own.
    expect(group(draft, served, 'claude-opus-5-5').nativeServices).toEqual(['login:claude']);
  });

  test('a key without a model list serves a name natively; a route of unknown kind is ignored', async () => {
    routes();
    const draft = changeRow(startDraft(loaded()), 'xai/0/0#0', { alias: 'gemini-2.5-flash' });
    const g = group(draft, await loadServedNames(draftClientNames(draft)), 'gemini-2.5-flash');
    expect(g.nativeServices).toEqual(['key:interactions']);
    expect(g.services).toEqual(['key:interactions', 'key:xai']);
    expect(g.verdict).toBe('several-services');
  });

  test('a changed set of names asks again; an answer for an older set is dropped', async () => {
    const pending: { names: readonly string[]; resolve: (s: ServedNames) => void }[] = [];
    const source = createServedNamesSource(
      (names) => new Promise<ServedNames>((resolve) => pending.push({ names, resolve }))
    );
    const first = source.ask(['opus', 'fast']);
    const second = source.ask(['opus', 'fast', 'claude-opus-5-5']);
    expect(pending.map((p) => p.names.length)).toEqual([2, 3]);
    const answer: ServedNames = { known: true, byName: { opus: [] } };
    pending[1].resolve(answer);
    pending[0].resolve({ known: true, byName: {} });
    expect(await first).toBeNull();
    expect(await second).toBe(answer);
    // The same set, in another order: no new request; forced (after a commit): asked again.
    expect(await source.ask(['claude-opus-5-5', 'fast', 'opus', 'opus'])).toBe(answer);
    expect(pending).toHaveLength(2);
    const forced = source.ask(['opus', 'fast', 'claude-opus-5-5'], { force: true });
    expect(pending).toHaveLength(3);
    pending[2].resolve(answer);
    expect(await forced).toBe(answer);
  });
});

describe('N-3 the fallback, a proxy without the endpoint', () => {
  test('a 404 gives known: false and the verdict from rows only', async () => {
    const asked = routes(() => {
      throw httpError(404);
    });
    const draft = changeRow(startDraft(loaded()), 'xai/0/0#0', { alias: 'gemini-2.5-flash' });
    const served = await loadServedNames(draftClientNames(draft));
    expect(asked).toHaveLength(1);
    expect(served).toEqual(UNKNOWN_SERVED);
    const g = group(draft, served, 'gemini-2.5-flash');
    expect(g).toMatchObject({ nativeServices: [], services: ['key:xai'], verdict: 'single' });
    expect(group(draft, served, 'claude-opus-5-5').verdict).toBe('single');
  });

  test('any other failure gives the same', async () => {
    routes(() => {
      throw httpError(502);
    });
    expect(await loadServedNames(['opus'])).toEqual(UNKNOWN_SERVED);
  });

  test('presence unsupported: no request', async () => {
    const asked = routes();
    useProvimuxPresence.setState({ modelRoutes: { status: 'unsupported', message: null } });
    expect(await loadServedNames(['opus'])).toEqual(UNKNOWN_SERVED);
    expect(asked).toEqual([]);
  });

  test('no names: no request', async () => {
    const asked = routes();
    expect(await loadServedNames([' ', ''])).toEqual({ known: true, byName: {} });
    expect(asked).toEqual([]);
  });
});

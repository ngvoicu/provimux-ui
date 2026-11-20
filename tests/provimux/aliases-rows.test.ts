import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import type { AuthFilesResponse } from '@/types/authFile';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import type { KeyEntry, LoginEntry } from '@/provimux/pages/aliases/types';

/* ALP-03 W2, test R-1 (design aliases-page.md 2.2, 2.3). */

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/aliases/${name}`, 'utf8'));
const files = () =>
  normalizeAuthFilesResponse(fixture('credentials.json') as AuthFilesResponse).files;

describe('R-1 rows', () => {
  const state = readAliasState(fixture('config-full.json'), files());
  const keyEntries = state.entries.filter((e): e is KeyEntry => e.store === 'api-key');
  const loginEntries = state.entries.filter((e): e is LoginEntry => e.store === 'login');
  const pick = (entry: KeyEntry) => {
    const rest: Partial<KeyEntry> = { ...entry };
    delete rest.storedGroup;
    return rest;
  };
  const rowsOf = (entryId: string) =>
    state.rows
      .filter((row) => row.entryId === entryId)
      .map(({ id, sourceIndex, upstream, alias, fork, forceMapping, displayName }) => ({
        id,
        sourceIndex,
        upstream,
        alias,
        fork,
        forceMapping,
        displayName,
      }));

  test('API-key entries: ids, order, list source, host, service, disabled', () => {
    expect(keyEntries.map(pick)).toEqual([
      {
        store: 'api-key',
        id: 'gemini/0/0',
        family: 'gemini',
        groupIndex: 0,
        keyIndex: 0,
        groupName: 'gemini-1',
        keyPreview: 'fi******-1',
        keyCount: 1,
        authIndex: 'ai-gemini-1',
        host: null,
        prefix: null,
        disabled: false,
        listSource: 'key',
        service: 'key:gemini',
      },
      {
        store: 'api-key',
        id: 'interactions/0/0',
        family: 'interactions',
        groupIndex: 0,
        keyIndex: 0,
        groupName: 'interactions-1',
        keyPreview: 'fi******-1',
        keyCount: 1,
        authIndex: 'ai-interactions-1',
        host: null,
        prefix: null,
        disabled: false,
        listSource: 'none',
        service: 'key:interactions',
      },
      {
        store: 'api-key',
        id: 'codex/0/0',
        family: 'codex',
        groupIndex: 0,
        keyIndex: 0,
        groupName: 'codex-relay',
        keyPreview: 'fi******-1',
        keyCount: 1,
        authIndex: 'ai-codex-1',
        host: 'relay.example.invalid',
        prefix: 'relay',
        disabled: false,
        listSource: 'key',
        service: 'key:relay.example.invalid',
      },
      ...[0, 1].map((keyIndex) => ({
        store: 'api-key',
        id: `claude/0/${keyIndex}`,
        family: 'claude',
        groupIndex: 0,
        keyIndex,
        groupName: 'claude-team',
        keyPreview: `fi******-${keyIndex + 1}`,
        keyCount: 1,
        authIndex: `ai-claude-${keyIndex + 1}`,
        host: 'claude.example.invalid',
        prefix: null,
        disabled: false,
        listSource: 'group',
        service: 'key:claude.example.invalid',
      })),
      ...[0, 1].map((keyIndex) => ({
        store: 'api-key',
        id: `claude/1/${keyIndex}`,
        family: 'claude',
        groupIndex: 1,
        keyIndex,
        groupName: 'claude-own',
        keyPreview: `fi******-${keyIndex + 3}`,
        keyCount: 1,
        authIndex: `ai-claude-${keyIndex + 3}`,
        host: null,
        prefix: null,
        disabled: keyIndex === 1,
        listSource: 'key',
        service: 'key:claude',
      })),
      {
        store: 'api-key',
        id: 'xai/0/0',
        family: 'xai',
        groupIndex: 0,
        keyIndex: 0,
        groupName: 'xai-1',
        keyPreview: 'fi******-1',
        keyCount: 1,
        authIndex: 'ai-xai-1',
        host: null,
        prefix: null,
        disabled: false,
        listSource: 'key',
        service: 'key:xai',
      },
      {
        store: 'api-key',
        id: 'meta/0/0',
        family: 'meta',
        groupIndex: 0,
        keyIndex: 0,
        groupName: 'meta-1',
        keyPreview: 'fi******-1',
        keyCount: 1,
        authIndex: 'ai-meta-1',
        host: null,
        prefix: null,
        disabled: false,
        listSource: 'key',
        service: 'key:meta',
      },
      {
        store: 'api-key',
        id: 'vertex/0/0',
        family: 'vertex',
        groupIndex: 0,
        keyIndex: 0,
        groupName: 'vertex-1',
        keyPreview: 'fi******-1',
        keyCount: 1,
        authIndex: 'ai-vertex-1',
        host: 'vertex.example.invalid',
        prefix: null,
        disabled: false,
        listSource: 'key',
        service: 'key:vertex.example.invalid',
      },
      {
        store: 'api-key',
        id: 'openai-compatibility/0/g',
        family: 'openai-compatibility',
        groupIndex: 0,
        keyIndex: null,
        groupName: 'openrouter',
        keyPreview: null,
        keyCount: 2,
        authIndex: 'ai-openrouter',
        host: 'openrouter.ai',
        prefix: 'or',
        disabled: false,
        listSource: 'group',
        service: 'key:openrouter.ai',
      },
      {
        store: 'api-key',
        id: 'openai-compatibility/1/g',
        family: 'openai-compatibility',
        groupIndex: 1,
        keyIndex: null,
        groupName: 'local-off',
        keyPreview: null,
        keyCount: 1,
        authIndex: 'ai-local-off',
        host: 'localhost',
        prefix: null,
        disabled: true,
        listSource: 'group',
        service: 'key:localhost',
      },
    ]);
  });

  test('storedGroup is the stored group itself, keys included', () => {
    const document = fixture('config-full.json') as {
      'api-keys': Record<string, Record<string, unknown>[]>;
    };
    const claude = keyEntries.find((entry) => entry.id === 'claude/0/1')!;
    expect(claude.storedGroup).toEqual(document['api-keys'].claude[0]);
  });

  test('API-key rows: alias null when empty or equal to the name; options; non-rows skipped', () => {
    expect(rowsOf('claude/0/0')).toEqual([
      {
        id: 'claude/0/0#0',
        sourceIndex: 0,
        upstream: 'claude-opus-5-5',
        alias: 'opus',
        fork: null,
        forceMapping: true,
        displayName: 'Opus 5.5',
      },
      {
        id: 'claude/0/0#1',
        sourceIndex: 1,
        upstream: 'claude-sonnet-5',
        alias: null,
        fork: null,
        forceMapping: null,
        displayName: null,
      },
      {
        id: 'claude/0/0#2',
        sourceIndex: 2,
        upstream: 'claude-haiku-5',
        alias: null,
        fork: null,
        forceMapping: null,
        displayName: null,
      },
    ]);
    // models: null on the key inherits the group's list.
    expect(rowsOf('claude/0/1').map((row) => row.id)).toEqual([
      'claude/0/1#0',
      'claude/0/1#1',
      'claude/0/1#2',
    ]);
    // A string and a nameless object are not rows; their positions are kept.
    expect(rowsOf('claude/1/0')).toEqual([
      {
        id: 'claude/1/0#0',
        sourceIndex: 0,
        upstream: 'claude-opus-5-5',
        alias: 'opus',
        fork: null,
        forceMapping: null,
        displayName: null,
      },
      {
        id: 'claude/1/0#3',
        sourceIndex: 3,
        upstream: 'claude-opus-5-5',
        alias: null,
        fork: null,
        forceMapping: null,
        displayName: null,
      },
    ]);
    expect(rowsOf('xai/0/0')[0].forceMapping).toBe(false);
    expect(rowsOf('interactions/0/0')).toEqual([]);
    expect(rowsOf('vertex/0/0').map(({ upstream, alias }) => [upstream, alias])).toEqual([
      ['gemini-x', null],
      ['gemini-s', null],
      ['gemini-y', 'why'],
    ]);
    expect(
      rowsOf('openai-compatibility/0/g').map(({ upstream, alias }) => [upstream, alias])
    ).toEqual([
      ['anthropic/claude-opus-5.5', 'opus'],
      ['openai/gpt-5.5', 'opus'],
    ]);
    expect(state.rows.every((row) => (row.store === 'api-key') === (row.fork === null))).toBe(true);
  });

  test('login entries: spellings grouped, ordered by channel, login types without aliases added', () => {
    const withoutList = (entry: LoginEntry) => {
      const rest: Partial<LoginEntry> = { ...entry };
      delete rest.storedList;
      return rest;
    };
    expect(loginEntries.map(withoutList)).toEqual([
      {
        store: 'login',
        id: 'login/antigravity',
        channel: 'antigravity',
        spellings: [],
        loginCount: 1,
        service: 'login:antigravity',
      },
      {
        store: 'login',
        id: 'login/claude',
        channel: 'claude',
        spellings: ['claude'],
        loginCount: 2,
        service: 'login:claude',
      },
      {
        store: 'login',
        id: 'login/codex',
        channel: 'codex',
        spellings: ['codex', 'CODEX'],
        loginCount: 1,
        service: 'login:codex',
      },
      {
        store: 'login',
        id: 'login/kimi',
        channel: 'kimi',
        spellings: [],
        loginCount: 1,
        service: 'login:kimi',
      },
    ]);
    const codex = loginEntries.find((entry) => entry.channel === 'codex')!;
    expect(codex.storedList).toEqual([
      { name: 'gpt-5.5', alias: 'g55', openapi: true },
      { name: 'gpt-5.4', alias: 'g54', fork: true },
    ]);
  });

  test('login rows: every object, the ignored kinds included', () => {
    expect(rowsOf('login/claude')).toEqual([
      {
        id: 'login/claude#0',
        sourceIndex: 0,
        upstream: 'claude-opus-5-5',
        alias: 'opus-login',
        fork: true,
        forceMapping: false,
        displayName: 'Opus (login)',
      },
      {
        id: 'login/claude#1',
        sourceIndex: 1,
        upstream: 'claude-sonnet-5',
        alias: 'claude-sonnet-5',
        fork: false,
        forceMapping: null,
        displayName: null,
      },
      {
        id: 'login/claude#2',
        sourceIndex: 2,
        upstream: 'claude-haiku-5',
        alias: null,
        fork: false,
        forceMapping: null,
        displayName: null,
      },
      {
        id: 'login/claude#3',
        sourceIndex: 3,
        upstream: 'claude-opus-5-5',
        alias: 'OPUS-LOGIN',
        fork: false,
        forceMapping: null,
        displayName: null,
      },
    ]);
    expect(rowsOf('login/codex').map((row) => [row.id, row.alias, row.fork])).toEqual([
      ['login/codex#0', 'g55', false],
      ['login/codex#1', 'g54', true],
    ]);
  });

  test('force-model-prefix and etag', () => {
    expect(state.forceModelPrefix).toBe(false);
    expect(state.etag).toBeNull();
    expect(readAliasState({ routing: { 'force-model-prefix': true } }, []).forceModelPrefix).toBe(
      true
    );
  });

  test('without the credentials list, login counts are null', () => {
    const withoutFiles = readAliasState(fixture('config-full.json'), null);
    const logins = withoutFiles.entries.filter((e): e is LoginEntry => e.store === 'login');
    expect(logins.map((entry) => [entry.channel, entry.loginCount])).toEqual([
      ['claude', null],
      ['codex', null],
    ]);
  });

  test('config-empty gives nothing and does not throw', () => {
    expect(readAliasState(fixture('config-empty.json'), [])).toEqual({
      entries: [],
      rows: [],
      forceModelPrefix: false,
      etag: null,
    });
    expect(readAliasState(null, null).entries).toEqual([]);
  });

  test('no secret outside storedGroup', () => {
    const shown = JSON.stringify({
      entries: state.entries.map((entry) =>
        entry.store === 'api-key' ? pick(entry) : { ...entry, storedList: [] }
      ),
      rows: state.rows,
    });
    expect(shown).not.toContain('fixture-key');
  });
});

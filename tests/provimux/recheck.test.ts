// The re-check T-79 of the Provimux pages (fixed in T-83): the refresh is one request that says only what its answer
// says, and a late answer from another connection or a closed page changes nothing (findings 1, 2); the update source
// never shows credentials (3); the OpenRouter tag hides only on Model routes' 404 (8). T-87 (review T-84): a lost
// answer is "could not confirm", never "not requested" (2); a route's login opens Auth Files with its file name as
// the ordinary search, with no exact-auth_index filter (9); "(credentials hidden)" follows the configured address (3).
import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../../src/i18n/index';
import { apiClient } from '../../src/services/api/client';
import { UpdateSourceLine } from '../../src/provimux/components/ProvimuxConsoleSource';
import { describeUpdateSource, displayAddress } from '../../src/provimux/consoleSource';
import {
  requestRefresh,
  type RefreshOutcome,
} from '../../src/provimux/pages/liveLists/refreshRequest';
import { openAuthFilesState } from '../../src/provimux/pages/shared/authFilesLink';
import { createRequestGuard } from '../../src/provimux/pages/shared/requestGuard';
import { useProvimuxResource } from '../../src/provimux/pages/shared/useProvimuxResource';
import { useProvimuxPresence } from '../../src/provimux/presence';

const read = (path: string) => readFileSync(path, 'utf8');
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// Requests go through apiClient.captureConnection(), a fresh client per action: spy on the class.
const clientClass = Object.getPrototypeOf(apiClient) as typeof apiClient;

/** A request whose answer the test releases. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Switching servers (or signing out and in): what changes the client's connection revision. */
const switchConnection = (base: string) =>
  apiClient.setConfig({ apiBase: base, managementKey: `key-for-${base}` });

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

describe('1, 2. Refresh lists now: one request, its answer, nothing followed', () => {
  test('a 2xx says the refresh was requested', async () => {
    const post = spyOn(clientClass, 'post').mockResolvedValue({ ok: true });
    try {
      const outcomes: RefreshOutcome[] = [];
      const applied = await requestRefresh(
        createRequestGuard(),
        (outcome) => outcomes.push(outcome),
        () => 1_000
      );
      expect(applied).toBe(true);
      expect(outcomes).toEqual([{ kind: 'requested', atMs: 1_000 }]);
      expect(post).toHaveBeenCalledWith('/models/refresh');
    } finally {
      post.mockRestore();
    }
  });

  test("Provimux's 502 says the catalog failed; another HTTP error says not requested; no answer is unconfirmed", async () => {
    const post = spyOn(clientClass, 'post');
    try {
      post.mockRejectedValueOnce(
        Object.assign(new Error('Request failed with status code 502'), {
          status: 502,
          data: { ok: false, error: 'no valid model catalog source', catalogs: {}, sources: {} },
        })
      );
      post.mockRejectedValueOnce(
        Object.assign(new Error('invalid sources'), { status: 400, data: { error: 'x' } })
      );
      // The browser lost the reply: no HTTP status, the server may have accepted it (review T-84, finding 2).
      post.mockRejectedValueOnce(
        Object.assign(new Error('Network Error'), { status: undefined, code: 'ERR_NETWORK' })
      );
      post.mockRejectedValueOnce(
        Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' })
      );
      const outcomes: RefreshOutcome[] = [];
      const guard = createRequestGuard();
      for (let i = 0; i < 4; i++) await requestRefresh(guard, (outcome) => outcomes.push(outcome));
      expect(outcomes).toEqual([
        { kind: 'catalog_failed', message: 'no valid model catalog source' },
        { kind: 'failed', message: 'invalid sources' },
        { kind: 'unconfirmed' },
        { kind: 'unconfirmed' },
      ]);
    } finally {
      post.mockRestore();
    }
  });

  test('a late answer from a previous connection changes nothing', async () => {
    switchConnection('http://127.0.0.1:1001'); // Provimux A
    const answer = deferred<unknown>();
    const post = spyOn(clientClass, 'post').mockReturnValue(answer.promise as never);
    try {
      const outcomes: RefreshOutcome[] = [];
      const pending = requestRefresh(createRequestGuard(), (outcome) => outcomes.push(outcome));
      switchConnection('http://127.0.0.1:1002'); // signed into Provimux B meanwhile
      answer.resolve({ ok: true }); // A's answer arrives now
      expect(await pending).toBe(false);
      expect(outcomes).toEqual([]);
    } finally {
      post.mockRestore();
    }
  });

  test('a late failure from a previous connection changes nothing either', async () => {
    switchConnection('http://127.0.0.1:1003');
    const answer = deferred<unknown>();
    const post = spyOn(clientClass, 'post').mockReturnValue(answer.promise as never);
    try {
      const outcomes: RefreshOutcome[] = [];
      const pending = requestRefresh(createRequestGuard(), (outcome) => outcomes.push(outcome));
      switchConnection('http://127.0.0.1:1004');
      answer.reject(Object.assign(new Error('boom'), { status: 500 }));
      expect(await pending).toBe(false);
      expect(outcomes).toEqual([]);
    } finally {
      post.mockRestore();
    }
  });

  test('an answer after the page closed, or after a newer refresh, changes nothing', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const post = spyOn(clientClass, 'post')
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);
    try {
      const outcomes: string[] = [];
      const guard = createRequestGuard();
      const older = requestRefresh(guard, () => outcomes.push('older'));
      const newer = requestRefresh(guard, () => outcomes.push('newer'));
      first.resolve({ ok: true });
      expect(await older).toBe(false);
      guard.dispose(); // the page closed before the newer answer
      second.resolve({ ok: true });
      expect(await newer).toBe(false);
      expect(outcomes).toEqual([]);
    } finally {
      post.mockRestore();
    }
  });

  test("a status read that answers after the connection changed is dropped (the page's own loads)", async () => {
    switchConnection('http://127.0.0.1:1005');
    const answer = deferred<{ observed_at: string | null }>();
    let captured: { load?: () => Promise<unknown> } = {};
    function Probe() {
      captured = useProvimuxResource('liveLists', () => answer.promise, null) as {
        load?: () => Promise<unknown>;
      };
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    const report = spyOn(useProvimuxPresence.getState(), 'report');
    try {
      const pending = captured.load!();
      switchConnection('http://127.0.0.1:1006');
      answer.resolve({ observed_at: null });
      expect(await pending).toBeNull();
      expect(report).not.toHaveBeenCalled();
    } finally {
      report.mockRestore();
    }
  });

  test('the page has no follower, no success claim and no "being fetched" claim', () => {
    // Refresh lists now lives in the Models page's settings; the page reads the lists every 30 s.
    const page = read('src/provimux/pages/models/ModelsSettings.tsx');
    expect(page).not.toMatch(/followRefresh|refreshFollower|refresh_done|refresh_stopped/);
    expect(page).toContain('requestRefresh(refreshGuard');
    const models = read('src/provimux/pages/models/ModelsPage.tsx');
    expect(models).toContain('const POLL_MS = 30_000;');
    expect(models).toContain("useProvimuxResource('modelLists', fetchLists, POLL_MS");
    const strings = JSON.stringify(JSON.parse(read('src/provimux/locales/en.json')).provimux.live);
    expect(strings).not.toMatch(/reported back|being fetched|keep fetching|Waiting for the logins/);
    expect(read('tests/provimux/review.test.ts')).not.toContain("from './refreshFollower'");
  });

  test('a lost answer says "could not confirm", never "not requested"', async () => {
    await i18n.changeLanguage('en');
    const page = read('src/provimux/pages/models/ModelsSettings.tsx');
    expect(page).toMatch(
      /outcome\.kind === 'unconfirmed'[\s\S]*?t\('provimux\.live\.refresh_unconfirmed'\)/
    );
    expect(i18n.t('provimux.live.refresh_unconfirmed')).toBe(
      "Could not confirm the request: the server may still be refreshing. Each login's list on its routes updates on the next read."
    );
    expect(i18n.t('provimux.live.refresh_failed', { message: 'x' })).toBe(
      'Refresh not requested: x'
    );
  });

  test('the switch write is bound to the page and connection too', () => {
    const page = read('src/provimux/pages/models/ModelsSettings.tsx');
    expect(page).toMatch(/const \{ client, isCurrent \} = switchGuard\.begin\(\);/);
    expect(page).toContain('await provimuxApi.setLiveLists(next, client);');
  });
});

describe('3. the update source shows no credentials', () => {
  const secret =
    'https://user:p4ssw0rd@api.github.com/repos/someone/my-panel?access_token=t0k3n#frag';

  test('the exact resolution keeps the address; what is shown is scheme, host and path', () => {
    const source = describeUpdateSource(secret, 'provimux');
    expect(source.releaseUrl).toBe(
      'https://user:p4ssw0rd@api.github.com/repos/someone/my-panel/releases/latest?access_token=t0k3n#frag'
    );
    expect(source).toMatchObject({
      repository: 'someone/my-panel',
      address: 'https://api.github.com/repos/someone/my-panel/releases/latest',
      hidden: true,
      reason: 'configured',
    });
  });

  test('a repository id with a token in the user info, or in the query', () => {
    expect(
      describeUpdateSource(
        'https://x-access-token:ghp_t0k3n@api.github.com/repositories/1296269',
        'provimux'
      )
    ).toMatchObject({
      repository: null,
      address: 'https://api.github.com/repositories/1296269/releases/latest',
      hidden: true,
    });
    expect(
      displayAddress('https://api.github.com/repositories/1296269/releases/latest?token=t0k3n')
    ).toEqual({
      address: 'https://api.github.com/repositories/1296269/releases/latest',
      hidden: true,
    });
    expect(displayAddress('https://api.github.com/repositories/1296269/releases/latest')).toEqual({
      address: 'https://api.github.com/repositories/1296269/releases/latest',
      hidden: false,
    });
  });

  test('the System line renders neither the password nor the token, and says they are hidden', async () => {
    await i18n.changeLanguage('en');
    for (const configured of [
      secret,
      'https://x-access-token:ghp_t0k3n@api.github.com/repositories/1296269?token=t0k3n#frag',
    ]) {
      const html = renderToStaticMarkup(
        createElement(UpdateSourceLine, {
          source: describeUpdateSource(configured, 'provimux'),
          server: 'provimux',
          autoUpdateOff: true,
        })
      );
      expect(html).not.toMatch(/p4ssw0rd|t0k3n|ghp_|access_token|user:|#frag|frag/);
      expect(text(html)).toContain('(credentials hidden)');
    }
    const plain = renderToStaticMarkup(
      createElement(UpdateSourceLine, {
        source: describeUpdateSource('https://api.github.com/repositories/1296269', 'provimux'),
        server: 'provimux',
        autoUpdateOff: false,
      })
    );
    expect(text(plain)).not.toContain('(credentials hidden)');
    expect(text(plain)).toContain('https://api.github.com/repositories/1296269/releases/latest');
  });

  test('a github.com address whose credentials resolution already dropped still says they are hidden', async () => {
    await i18n.changeLanguage('en');
    for (const configured of [
      'https://user:p4ssw0rd@github.com/someone/my-panel',
      'https://github.com/someone/my-panel?access_token=t0k3n',
      'https://github.com/someone/my-panel#frag',
      'https://github.com/someone/my-panel?',
    ]) {
      const source = describeUpdateSource(configured, 'provimux');
      expect(source).toMatchObject({
        releaseUrl: 'https://api.github.com/repos/someone/my-panel/releases/latest',
        repository: 'someone/my-panel',
        hidden: true,
      });
      const html = renderToStaticMarkup(
        createElement(UpdateSourceLine, { source, server: 'provimux', autoUpdateOff: false })
      );
      expect(html).not.toMatch(/p4ssw0rd|t0k3n|access_token|user:|frag/);
      expect(text(html)).toContain('(credentials hidden)');
    }
    expect(describeUpdateSource('https://github.com/someone/my-panel', 'provimux').hidden).toBe(
      false
    );
    expect(describeUpdateSource('someone/my-panel', 'cliproxyapi').hidden).toBe(false);
    expect(describeUpdateSource('', 'provimux').hidden).toBe(false);
  });
});

describe('9. a route opens Auth Files with its file name as the ordinary search', () => {
  test('the link sets the search to the file name, every provider and state, first page', () => {
    expect(openAuthFilesState('review-cl.json')).toMatchObject({
      search: 'review-cl.json',
      filter: 'all',
      statusFilterMode: 'all',
      page: 1,
    });
  });

  test('no exact-auth_index target: Auth Files keeps its upstream filter, no Provimux seam', () => {
    const page = read('src/features/authFiles/AuthFilesPage.tsx');
    expect(page).not.toMatch(/provimux/i);
    expect(page).toContain(
      'return matchType && matchesAuthFileSearch(item, normalizedSearch, wildcardSearch);'
    );
    const link = read('src/provimux/pages/shared/authFilesLink.ts');
    expect(link).not.toMatch(/provimuxAuthTarget|setAuthFilesTarget|authIndex/);
    expect(read('src/provimux/pages/models/NameCard.tsx')).toContain(
      'openInAuthFiles(line.loginFile!)'
    );
  });
});

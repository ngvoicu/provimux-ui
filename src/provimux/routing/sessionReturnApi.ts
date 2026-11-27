/**
 * The requests of "Back to the first account". Read: `GET /provimux/session-return`. Writes, each conditional on the
 * configuration's tag (`If-Match`), so a file another writer changed since the read is refused (412):
 *
 * | Change        | Request                                                                |
 * | a time        | `PUT /config/routing/session-affinity-return` with `{"cold-after":"6m"}` |
 * | off           | `DELETE /config/routing/session-affinity-return` (the key removed)      |
 *
 * A value the gateway refuses answers 422 with the key named, and the file stays as it was. Removing a key the file
 * does not hold answers 404 `not_found`: off already, so that is a success.
 */
import { apiClient } from '@/services/api/client';
import { isMissingConfigValue } from '@/services/api/configValue';
import { errorStatus } from '../api/provimuxApi';
import { RestartsWriteError, restartsApi, writeFailure } from '../pages/restarts/restartsApi';
import {
  durationValue,
  normalizeReturn,
  type ReturnLoad,
  type ReturnSnapshot,
} from './sessionReturnLogic';

export type Client = typeof apiClient;

export const SESSION_RETURN_PATHS = {
  state: '/provimux/session-return',
  setting: '/config/routing/session-affinity-return',
} as const;

/** The setting's name in the configuration file. */
export const SESSION_RETURN_SETTING = 'routing.session-affinity-return.cold-after';

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error ?? '');

async function conditional(
  etag: string | null,
  send: (headers: Record<string, string>) => Promise<unknown>,
  { absentIsDone = false } = {}
): Promise<void> {
  if (!etag) throw new RestartsWriteError('no-tag', 'no-tag');
  try {
    await send({ 'If-Match': etag });
  } catch (error) {
    if (isAbort(error)) throw error;
    if (absentIsDone && isMissingConfigValue(error)) return;
    throw writeFailure(error);
  }
}

export const sessionReturnApi = {
  /** A 404 is a gateway without the rule, never "off". */
  async state(client: Client = apiClient): Promise<ReturnLoad> {
    try {
      const value = normalizeReturn(await client.get<unknown>(SESSION_RETURN_PATHS.state));
      return value
        ? { kind: 'ready', state: value }
        : { kind: 'error', message: 'unexpected answer' };
    } catch (error) {
      if (isAbort(error)) throw error;
      if (errorStatus(error) === 404) return { kind: 'absent' };
      return { kind: 'error', message: messageOf(error) };
    }
  },

  setMinutes(etag: string | null, minutes: number, client: Client = apiClient): Promise<void> {
    return conditional(etag, (headers) =>
      client.put(
        SESSION_RETURN_PATHS.setting,
        { 'cold-after': durationValue(minutes) },
        { headers }
      )
    );
  },

  off(etag: string | null, client: Client = apiClient): Promise<void> {
    return conditional(
      etag,
      (headers) => client.delete(SESSION_RETURN_PATHS.setting, { headers }),
      { absentIsDone: true }
    );
  },

  /** Everything the card reads, together. The configuration is not asked of a gateway without the rule. */
  async read(client: Client = apiClient): Promise<ReturnSnapshot> {
    const state = await sessionReturnApi.state(client);
    const config =
      state.kind === 'absent' ? ({ kind: 'loading' } as const) : await restartsApi.config(client);
    return { config, state, loadedAt: Date.now() };
  },
};

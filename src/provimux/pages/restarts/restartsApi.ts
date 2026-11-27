/**
 * The Restarts page's requests. It reads the whole configuration (`GET /config`, with its `ETag`) and the state of
 * `routing.session-affinity-persist`; every write is one key at the generic config path, conditional on the read's
 * tag (`If-Match`), so a file another writer changed since the read is refused (412) and nothing is written:
 *
 * | Change                                  | Request                                                  |
 * | the wait, in seconds                    | `PUT /config/server/restart-drain-seconds` with a number |
 * | the wait back to its default            | `DELETE /config/server/restart-drain-seconds`            |
 * | conversations' accounts not kept        | `PUT /config/routing/session-affinity-persist` `false`   |
 * | kept again (its default, on)            | `DELETE /config/routing/session-affinity-persist`        |
 *
 * Removing a key the file does not hold answers 404 `not_found`: the default applies already, so that is a success.
 */
import { apiClient } from '@/services/api/client';
import { isMissingConfigValue } from '@/services/api/configValue';
import { errorStatus } from '../../api/provimuxApi';
import { etagOf } from '../aliases/aliasesApi';
import { normalizePersist, type PersistLoad } from './restartsLogic';

type Client = typeof apiClient;

export const RESTARTS_PATHS = {
  config: '/config',
  drain: '/config/server/restart-drain-seconds',
  persist: '/config/routing/session-affinity-persist',
  persistState: '/provimux/session-affinity-persist',
} as const;

export interface ConfigRead {
  document: unknown;
  /** The file's tag; null when the gateway sent none (nothing is written then). */
  etag: string | null;
}

export class RestartsWriteError extends Error {
  constructor(
    readonly reason: 'changed' | 'no-tag' | 'refused' | 'error',
    message: string
  ) {
    super(message);
    this.name = 'RestartsWriteError';
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error ?? '');

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

async function conditional(
  read: ConfigRead,
  send: (headers: Record<string, string>) => Promise<unknown>,
  { absentIsDone = false } = {}
): Promise<void> {
  if (!read.etag) throw new RestartsWriteError('no-tag', 'no-tag');
  try {
    await send({ 'If-Match': read.etag });
  } catch (error) {
    if (isAbort(error)) throw error;
    if (absentIsDone && isMissingConfigValue(error)) return;
    const status = errorStatus(error);
    if (status === 412) throw new RestartsWriteError('changed', messageOf(error));
    if (status === 400 || status === 422) throw new RestartsWriteError('refused', messageOf(error));
    throw new RestartsWriteError('error', messageOf(error));
  }
}

export const restartsApi = {
  async config(client: Client = apiClient): Promise<ConfigRead> {
    const answer = await client.getRaw(RESTARTS_PATHS.config);
    return { document: answer.data, etag: etagOf(answer.headers) };
  },

  /** The persist state; a 404 is a gateway without the setting, never "off". */
  async persist(client: Client = apiClient): Promise<PersistLoad> {
    try {
      const state = normalizePersist(await client.get<unknown>(RESTARTS_PATHS.persistState));
      return state ? { kind: 'ready', state } : { kind: 'error', message: 'unexpected answer' };
    } catch (error) {
      if (isAbort(error)) throw error;
      if (errorStatus(error) === 404) return { kind: 'absent' };
      return { kind: 'error', message: messageOf(error) };
    }
  },

  setDrain(read: ConfigRead, seconds: number, client: Client = apiClient): Promise<void> {
    return conditional(read, (headers) => client.put(RESTARTS_PATHS.drain, seconds, { headers }));
  },

  drainToDefault(read: ConfigRead, client: Client = apiClient): Promise<void> {
    return conditional(read, (headers) => client.delete(RESTARTS_PATHS.drain, { headers }), {
      absentIsDone: true,
    });
  },

  persistOff(read: ConfigRead, client: Client = apiClient): Promise<void> {
    return conditional(read, (headers) => client.put(RESTARTS_PATHS.persist, false, { headers }));
  },

  persistToDefault(read: ConfigRead, client: Client = apiClient): Promise<void> {
    return conditional(read, (headers) => client.delete(RESTARTS_PATHS.persist, { headers }), {
      absentIsDone: true,
    });
  },
};

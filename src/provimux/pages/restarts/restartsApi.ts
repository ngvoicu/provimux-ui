/**
 * The Restarts page's requests. Reads: the two state paths, and the configuration (`GET /config`) for its tag and for
 * `routing.session-affinity`. Every write is one key at the generic config path, conditional on the configuration's
 * tag (`If-Match`): a file another writer changed since the read is refused (412) and nothing is written.
 *
 * | Change                                  | Request                                                  |
 * | the wait, in seconds                    | `PUT /config/server/restart-drain-seconds` with a number |
 * | the wait back to its default            | `DELETE /config/server/restart-drain-seconds`            |
 * | conversations' accounts not kept        | `PUT /config/routing/session-affinity-persist` `false`   |
 * | kept again (its default, on)            | `DELETE /config/routing/session-affinity-persist`        |
 *
 * Removing a key the file does not hold answers 404 `not_found`: the default applies already, so that is a success.
 * A write whose reply never arrived (no answer, or a gateway or proxy timeout) is "unconfirmed", never "not saved":
 * it may have landed, and only a read says.
 */
import { apiClient } from '@/services/api/client';
import { isMissingConfigValue } from '@/services/api/configValue';
import { errorStatus } from '../../api/provimuxApi';
import { etagOf } from '../aliases/aliasesApi';
import {
  normalizeDrain,
  normalizePersist,
  type ConfigLoad,
  type DrainLoad,
  type PersistLoad,
} from './restartsLogic';

export type Client = typeof apiClient;

export const RESTARTS_PATHS = {
  config: '/config',
  drainState: '/provimux/restart-drain',
  persistState: '/provimux/session-affinity-persist',
  drain: '/config/server/restart-drain-seconds',
  persist: '/config/routing/session-affinity-persist',
} as const;

export type WriteFailure =
  /** 412: the file changed since the page read it; nothing was written. */
  | 'changed'
  /** The read carried no tag: nothing was sent. */
  | 'no-tag'
  /** 400 or 422: the gateway refused the value. */
  | 'refused'
  /** No reply, or a timeout on the way: the write may have landed. */
  | 'unconfirmed'
  /** Any other answer that says the write was not made. */
  | 'error';

export class RestartsWriteError extends Error {
  constructor(
    readonly reason: WriteFailure,
    message: string
  ) {
    super(message);
    this.name = 'RestartsWriteError';
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error ?? '');

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** Statuses that say nothing about whether the write landed: the reply was lost or timed out on the way. */
const UNCONFIRMED = new Set([408, 502, 503, 504]);

export function writeFailure(error: unknown): RestartsWriteError {
  if (error instanceof RestartsWriteError) return error;
  const status = errorStatus(error);
  const message = messageOf(error);
  if (status === 412) return new RestartsWriteError('changed', message);
  if (status === 400 || status === 422) return new RestartsWriteError('refused', message);
  if (status === null || UNCONFIRMED.has(status)) {
    return new RestartsWriteError('unconfirmed', message);
  }
  return new RestartsWriteError('error', message);
}

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

/** A state path's answer: ready, 404 (the gateway has no such path), or an error. */
async function state<T>(
  client: Client,
  path: string,
  normalize: (raw: unknown) => T | null
): Promise<{ kind: 'ready'; state: T } | { kind: 'absent' } | { kind: 'error'; message: string }> {
  try {
    const value = normalize(await client.get<unknown>(path));
    return value
      ? { kind: 'ready', state: value }
      : { kind: 'error', message: 'unexpected answer' };
  } catch (error) {
    if (isAbort(error)) throw error;
    if (errorStatus(error) === 404) return { kind: 'absent' };
    return { kind: 'error', message: messageOf(error) };
  }
}

export const restartsApi = {
  async config(client: Client = apiClient): Promise<ConfigLoad> {
    try {
      const answer = await client.getRaw(RESTARTS_PATHS.config);
      return { kind: 'ready', document: answer.data, etag: etagOf(answer.headers) };
    } catch (error) {
      if (isAbort(error)) throw error;
      return { kind: 'error', message: messageOf(error) };
    }
  },

  drain(client: Client = apiClient): Promise<DrainLoad> {
    return state(client, RESTARTS_PATHS.drainState, normalizeDrain);
  },

  /** A 404 is a gateway without the setting, never "off". */
  persist(client: Client = apiClient): Promise<PersistLoad> {
    return state(client, RESTARTS_PATHS.persistState, normalizePersist);
  },

  setDrain(etag: string | null, seconds: number, client: Client = apiClient): Promise<void> {
    return conditional(etag, (headers) => client.put(RESTARTS_PATHS.drain, seconds, { headers }));
  },

  drainToDefault(etag: string | null, client: Client = apiClient): Promise<void> {
    return conditional(etag, (headers) => client.delete(RESTARTS_PATHS.drain, { headers }), {
      absentIsDone: true,
    });
  },

  persistOff(etag: string | null, client: Client = apiClient): Promise<void> {
    return conditional(etag, (headers) => client.put(RESTARTS_PATHS.persist, false, { headers }));
  },

  persistToDefault(etag: string | null, client: Client = apiClient): Promise<void> {
    return conditional(etag, (headers) => client.delete(RESTARTS_PATHS.persist, { headers }), {
      absentIsDone: true,
    });
  },
};

/**
 * One change on the Restarts page, from the click to what the gateway reports after it:
 *
 * 1. The card's state path is read again. When it is gone (the gateway behind the address was replaced by one without
 *    it), unreadable, or no longer says what the control was drawn from, nothing is sent and the page reads again.
 * 2. The write is sent once, conditional on the configuration's tag.
 * 3. Whatever the answer, the page reads again. A save the gateway does not report yet is read a few more times (the
 *    drain is taken up at the configuration's reload, the conversations' switch at the gateway's check, about every
 *    five seconds).
 *
 * The result says what happened and carries the last read, from which the card says what the gateway reports.
 */
import { RestartsWriteError, restartsApi, writeFailure, type Client } from './restartsApi';
import type { ConfigLoad, DrainLoad, PersistLoad } from './restartsLogic';

export interface Snapshot {
  config: ConfigLoad;
  drain: DrainLoad;
  persist: PersistLoad;
  loadedAt: number;
}

export type Check = 'same' | 'changed' | 'absent' | 'unreadable';

/** What a page reads together: the configuration, for the tag a write is conditional on, and its state paths. */
export interface Readable {
  config: ConfigLoad;
}

export interface WriteSpec<S extends Readable = Snapshot> {
  /** Reads the card's state path again and compares it with what the control was drawn from. */
  check: (client: Client) => Promise<Check>;
  /** The request, conditional on the tag of the page's configuration read. */
  send: (etag: string | null, client: Client) => Promise<void>;
  /** The gateway reports the change. */
  shows: (snapshot: S) => boolean;
}

export type WriteResult =
  /** Nothing was sent: the gateway's state was not what the control was drawn from. */
  | { kind: 'stale'; why: Exclude<Check, 'same'> }
  | { kind: 'no-tag' }
  /** 412: nothing was written. `reread`: the page read the configuration again. */
  | { kind: 'changed'; reread: boolean }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string }
  /** The reply never arrived: the page says what the gateway reports now. */
  | { kind: 'unconfirmed' }
  /** Saved. `shown`: the gateway reports it. */
  | { kind: 'saved'; shown: boolean };

export interface WriteDeps<S extends Readable = Snapshot> {
  client: Client;
  /** The page's current read: the configuration's tag comes from it. */
  current: S;
  read: (client: Client) => Promise<S>;
  /** Whether the page and the connection are still the ones the write began on. */
  isCurrent: () => boolean;
  wait: (ms: number) => Promise<void>;
  /** The save landed and the page waits for the gateway to report it. */
  onPending?: () => void;
  polls?: number;
  everyMs?: number;
}

export async function runWrite<S extends Readable = Snapshot>(
  spec: WriteSpec<S>,
  deps: WriteDeps<S>
): Promise<{ result: WriteResult; snapshot: S | null }> {
  const { client, current, read, isCurrent, wait } = deps;
  const reread = async () => (isCurrent() ? await read(client).catch(() => null) : null);

  const check = await spec.check(client).catch((): Check => 'unreadable');
  if (check !== 'same') {
    return { result: { kind: 'stale', why: check }, snapshot: await reread() };
  }
  const etag = current.config.kind === 'ready' ? current.config.etag : null;
  if (!etag) return { result: { kind: 'no-tag' }, snapshot: null };

  let failure: RestartsWriteError | null = null;
  try {
    await spec.send(etag, client);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    failure = writeFailure(error);
  }
  let snapshot = await reread();
  if (failure) {
    const read = snapshot !== null && snapshot.config.kind === 'ready';
    const result: WriteResult =
      failure.reason === 'changed'
        ? { kind: 'changed', reread: read }
        : failure.reason === 'refused'
          ? { kind: 'refused', message: failure.message }
          : failure.reason === 'unconfirmed'
            ? { kind: 'unconfirmed' }
            : failure.reason === 'no-tag'
              ? { kind: 'no-tag' }
              : { kind: 'failed', message: failure.message };
    return { result, snapshot };
  }
  if (snapshot && spec.shows(snapshot)) return { result: { kind: 'saved', shown: true }, snapshot };
  deps.onPending?.();
  for (let poll = 0; poll < (deps.polls ?? 4); poll += 1) {
    await wait(deps.everyMs ?? 2500);
    if (!isCurrent()) return { result: { kind: 'saved', shown: false }, snapshot };
    const next = await reread();
    if (next) snapshot = next;
    if (next && spec.shows(next)) return { result: { kind: 'saved', shown: true }, snapshot };
  }
  return { result: { kind: 'saved', shown: false }, snapshot };
}

/** Every read the page makes, together. */
export async function readAll(client: Client): Promise<Snapshot> {
  const [config, drain, persist] = await Promise.all([
    restartsApi.config(client),
    restartsApi.drain(client),
    restartsApi.persist(client),
  ]);
  return { config, drain, persist, loadedAt: Date.now() };
}

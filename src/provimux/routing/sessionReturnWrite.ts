/**
 * The two changes of "Back to the first account", as the Restarts page's write runs them (restartsWrite.ts): the
 * state is read again first and nothing is sent when it is gone or no longer what the controls were drawn from; the
 * write is sent once, conditional on the configuration's tag; then the state is read until the gateway reports it.
 */
import type { Check, WriteSpec } from '../pages/restarts/restartsWrite';
import { sessionReturnApi, type Client } from './sessionReturnApi';
import { sameReturn, type ReturnSnapshot, type ReturnState } from './sessionReturnLogic';

export const stateOf = (snapshot: ReturnSnapshot): ReturnState | null =>
  snapshot.state.kind === 'ready' ? snapshot.state.state : null;

/** Before a write: the gateway still reports the state the controls were drawn from. */
const check =
  (drawn: ReturnState) =>
  async (client: Client): Promise<Check> => {
    const now = await sessionReturnApi.state(client);
    if (now.kind === 'absent') return 'absent';
    if (now.kind !== 'ready') return 'unreadable';
    return sameReturn(now.state, drawn) ? 'same' : 'changed';
  };

/** A time in whole minutes. */
export const saveSpec = (drawn: ReturnState, minutes: number): WriteSpec<ReturnSnapshot> => ({
  check: check(drawn),
  send: (etag, client) => sessionReturnApi.setMinutes(etag, minutes, client),
  shows: (now) => stateOf(now)?.coldAfterS === minutes * 60,
});

/** Off: the key removed. */
export const offSpec = (drawn: ReturnState): WriteSpec<ReturnSnapshot> => ({
  check: check(drawn),
  send: (etag, client) => sessionReturnApi.off(etag, client),
  shows: (now) => {
    const state = stateOf(now);
    return state !== null && state.coldAfterS === null;
  },
});

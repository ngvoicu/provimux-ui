/**
 * What the card's buttons do, as plain functions: the field's text or nothing in, one conditional write, the
 * gateway read again, and what to show out. Each runs as the Restarts page's change does (restartsWrite.ts): the
 * state is read again first and nothing is sent when it is gone or no longer what the card showed; the write is
 * sent once, conditional on the configuration's tag; then the state is read until the gateway reports it.
 */
import type { TFunction } from 'i18next';
import { commonMessage, type CardMessage } from '../pages/restarts/restartsWords';
import { runWrite, type Check, type WriteSpec } from '../pages/restarts/restartsWrite';
import { sessionReturnApi, type Client } from './sessionReturnApi';
import {
  draftMinutes,
  sameReturn,
  type ReturnSnapshot,
  type ReturnState,
} from './sessionReturnLogic';

const K = 'provimux.session_return';

/** The card as it was drawn: a state the gateway reported, and the configuration read with it. */
export type Drawn = ReturnSnapshot & { state: { kind: 'ready'; state: ReturnState } };

export interface Io {
  /** The connection the click was made on, and whether it is still the page's. */
  client: Client;
  isCurrent: () => boolean;
  t: TFunction;
  wait?: (ms: number) => Promise<void>;
}

export interface Outcome {
  /** What the gateway reports after it: the card. Null when nothing was read. */
  snapshot: ReturnSnapshot | null;
  /** The line under the buttons. */
  line: CardMessage;
  /** The change is in the file, so the field closes even when nothing could be read after it. */
  landed: boolean;
}

const stateOf = (snapshot: ReturnSnapshot): ReturnState | null =>
  snapshot.state.kind === 'ready' ? snapshot.state.state : null;

async function change(drawn: Drawn, io: Io, write: Omit<WriteSpec<ReturnSnapshot>, 'check'>) {
  const spec: WriteSpec<ReturnSnapshot> = {
    ...write,
    check: async (client): Promise<Check> => {
      const now = await sessionReturnApi.state(client);
      if (now.kind === 'absent') return 'absent';
      if (now.kind !== 'ready') return 'unreadable';
      return sameReturn(now.state, drawn.state.state) ? 'same' : 'changed';
    },
  };
  const { result, snapshot } = await runWrite(spec, {
    client: io.client,
    current: drawn,
    read: sessionReturnApi.read,
    isCurrent: io.isCurrent,
    wait: io.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  });
  const shown = snapshot !== null && spec.shows(snapshot);
  const line: CardMessage =
    commonMessage(io.t, result) ??
    (result.kind === 'saved' && shown
      ? { tone: 'ok', text: io.t(`${K}.saved`) }
      : {
          tone: 'warning',
          text: io.t(result.kind === 'saved' ? `${K}.saved_not_shown` : `${K}.unconfirmed`),
        });
  return {
    snapshot,
    line,
    // Saved, or a lost reply after which the gateway reports the change.
    landed: result.kind === 'saved' || (result.kind === 'unconfirmed' && shown),
  };
}

/** "Save time": the field's text, in whole minutes. Anything else sends nothing and says what to enter. */
export async function saveTime(text: string, drawn: Drawn, io: Io): Promise<Outcome> {
  const minutes = draftMinutes(text);
  if (minutes === null) {
    return {
      snapshot: null,
      line: { tone: 'warning', text: io.t(`${K}.field_help`) },
      landed: false,
    };
  }
  return change(drawn, io, {
    send: (etag, client) => sessionReturnApi.setMinutes(etag, minutes, client),
    shows: (now) => stateOf(now)?.coldAfterS === minutes * 60,
  });
}

/** "Turn off": the key removed. */
export function turnOff(drawn: Drawn, io: Io): Promise<Outcome> {
  return change(drawn, io, {
    send: (etag, client) => sessionReturnApi.off(etag, client),
    shows: (now) => stateOf(now)?.coldAfterS === null,
  });
}

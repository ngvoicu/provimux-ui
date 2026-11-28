import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '@/stores';
import { useRequestGuard } from '../pages/shared/requestGuard';
import type { CardMessage } from '../pages/restarts/restartsWords';
import { sessionReturnApi } from './sessionReturnApi';
import type { Io, Outcome } from './sessionReturnActions';
import type { ReturnSnapshot } from './sessionReturnLogic';

const LOADING: ReturnSnapshot = { config: { kind: 'loading' }, state: { kind: 'loading' } };
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * What the card holds: the gateway's last answer, read on open and whenever `readAgainWhen` changes (the Routing
 * page read the gateway again: its own save, or its refresh), and one change at a time (sessionReturnActions.ts),
 * whose outcome becomes the card and the line under its buttons.
 */
export function useSessionReturn(readAgainWhen: unknown) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<ReturnSnapshot>(LOADING);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<CardMessage | null>(null);
  const writing = useRef(false);
  const guard = useRequestGuard();
  const writeGuard = useRequestGuard();

  const load = useCallback(async () => {
    if (writing.current) return;
    const { client, isCurrent } = guard.begin();
    try {
      const next = await sessionReturnApi.read(client);
      if (!isCurrent() || writing.current) return;
      setSnapshot(next);
      // A line describes the read made with it, never a later one.
      setMessage(null);
    } catch (error) {
      if (!isAbort(error)) throw error;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load, readAgainWhen]);

  /** Runs one change. Resolves true when it landed. */
  const run = async (action: (io: Io) => Promise<Outcome>): Promise<boolean> => {
    if (writing.current) return false;
    const { client, isCurrent } = writeGuard.begin();
    writing.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await action({ client, isCurrent, t });
      if (!isCurrent()) return false;
      setSnapshot(outcome.snapshot);
      setMessage(outcome.line);
      // The configuration may have changed: the console's copy of it is read again when next needed.
      useConfigStore.getState().clearCache();
      return outcome.landed;
    } catch (error) {
      if (!isAbort(error)) throw error;
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  return { snapshot, busy, message, load, run };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '@/stores';
import { useRequestGuard } from '../pages/shared/requestGuard';
import type { CardMessage } from '../pages/restarts/restartsWords';
import { sessionReturnApi } from './sessionReturnApi';
import type { Io, Outcome } from './sessionReturnActions';
import { freshRead, type ReturnCard } from './sessionReturnLogic';

const LOADING: ReturnCard = freshRead({ config: { kind: 'loading' }, state: { kind: 'loading' } });
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * What the card holds: the gateway's last answer, read on open and whenever `readAgainWhen` changes (the Routing
 * page read the gateway again: its own save, or its refresh), and one change at a time (sessionReturnActions.ts),
 * whose outcome becomes the card and the line under its buttons. Any fresh read closes the field.
 */
export function useSessionReturn(readAgainWhen: unknown) {
  const { t } = useTranslation();
  const [card, setCard] = useState<ReturnCard>(LOADING);
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
      setCard(freshRead(next));
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

  /** The field: its text while open, null to close it. */
  const setDraft = (draft: string | null) => setCard((now) => ({ ...now, draft }));

  /** Runs one change. */
  const run = async (action: (io: Io) => Promise<Outcome>) => {
    if (writing.current) return;
    const { client, isCurrent } = writeGuard.begin();
    writing.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await action({ client, isCurrent, t });
      if (!isCurrent()) return;
      if (outcome.snapshot) setCard(freshRead(outcome.snapshot));
      else if (outcome.landed) setDraft(null);
      setMessage(outcome.line);
      // The configuration may have changed: the console's copy of it is read again when next needed.
      useConfigStore.getState().clearCache();
    } catch (error) {
      if (!isAbort(error)) throw error;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  return { card, busy, message, load, run, setDraft };
}

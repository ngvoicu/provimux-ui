import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useConfigStore } from '@/stores';
import { useRequestGuard } from '../pages/shared/requestGuard';
import type { CardMessage } from '../pages/restarts/restartsWords';
import { runWrite, type WriteSpec } from '../pages/restarts/restartsWrite';
import { sessionReturnApi } from './sessionReturnApi';
import { describeReturnWrite } from './sessionReturnWords';
import { sameReturn, type ReturnSnapshot, type ReturnState } from './sessionReturnLogic';
import { offSpec, saveSpec, stateOf } from './sessionReturnWrite';

const LOADING: ReturnSnapshot = {
  config: { kind: 'loading' },
  state: { kind: 'loading' },
  loadedAt: 0,
};

/** The count moves while the gateway serves: read again this often while the tab is visible. */
const POLL_MS = 30_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * The state of "Back to the first account" and its two changes. Read on open, whenever `readAgainWhen` changes (the
 * Routing page read the gateway again, so Session affinity may have changed), every 30 s while visible, and around
 * every write (restartsWrite.ts: the state is read before, and until the gateway reports the change after). A
 * gateway without the path (404) is asked once and never polled.
 */
export function useSessionReturn(readAgainWhen: unknown) {
  const { t } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [snapshot, setSnapshot] = useState<ReturnSnapshot>(LOADING);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<CardMessage | null>(null);
  const current = useRef(snapshot);
  const writing = useRef(false);
  useEffect(() => {
    current.current = snapshot;
  }, [snapshot]);
  const guard = useRequestGuard();
  const writeGuard = useRequestGuard();

  /** `quiet`: a poll. Its line stays while the gateway still reports what the line described. */
  const load = useCallback(async (quiet = false) => {
    if (writing.current) return;
    const { client, isCurrent } = guard.begin();
    try {
      const next = await sessionReturnApi.read(client);
      if (!isCurrent() || writing.current) return;
      const before = stateOf(current.current);
      const after = stateOf(next);
      const unchanged = before !== null && after !== null && sameReturn(before, after);
      setSnapshot(next);
      if (!quiet || !unchanged) setMessage(null);
    } catch (error) {
      if (!isAbort(error)) throw error;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (connected) void load();
  }, [connected, load, readAgainWhen]);

  const absent = snapshot.state.kind === 'absent';
  useEffect(() => {
    if (!connected || absent) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
    // A write's own reads restart the wait, so its line is not taken away a moment later.
  }, [connected, absent, load, snapshot.loadedAt]);

  const change = useCallback(
    async (spec: WriteSpec<ReturnSnapshot>): Promise<boolean> => {
      if (writing.current) return false;
      const { client, isCurrent } = writeGuard.begin();
      writing.current = true;
      setBusy(true);
      // The change reads the gateway again: no line from an earlier read stays.
      setMessage(null);
      try {
        const { result, snapshot: after } = await runWrite(spec, {
          client,
          current: current.current,
          read: sessionReturnApi.read,
          isCurrent,
          wait,
          onPending: () => setMessage({ tone: 'pending', text: t('provimux.restarts.applying') }),
        });
        if (!isCurrent()) return false;
        if (after) setSnapshot(after);
        if (result.kind === 'saved' || result.kind === 'unconfirmed') {
          useConfigStore.getState().clearCache();
        }
        setMessage(describeReturnWrite(t, result, after ?? current.current));
        // Done when it landed: saved, or a lost reply after which the gateway reports the change.
        return (
          result.kind === 'saved' ||
          (result.kind === 'unconfirmed' && after !== null && spec.shows(after))
        );
      } catch (error) {
        if (!isAbort(error)) throw error;
        return false;
      } finally {
        writing.current = false;
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  /** Saves a time in whole minutes. Resolves true when the change landed. */
  const save = useCallback(
    (drawn: ReturnState, minutes: number) => change(saveSpec(drawn, minutes)),
    [change]
  );
  const turnOff = useCallback((drawn: ReturnState) => change(offSpec(drawn)), [change]);

  return { snapshot, busy, message, load, save, turnOff };
}

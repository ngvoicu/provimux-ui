import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { useAuthStore, useConfigStore } from '@/stores';
import { useProvimuxPresence } from '../../presence';
import { useRequestGuard } from '../shared/requestGuard';
import { formatClock, formatExact } from '../time';
import shared from '../shared/Shared.module.scss';
import { DrainCard } from './DrainCard';
import { NextRestart } from './NextRestart';
import { PersistCard } from './PersistCard';
import {
  messagesAfterRead,
  messagesAfterWrite,
  type Card,
  type Messages,
  type OnWrite,
} from './restartsWords';
import { restartsApi } from './restartsApi';
import { gatewayKind, probesSay } from './restartsLogic';
import { readAll, runWrite, type Snapshot } from './restartsWrite';
import styles from './RestartsPage.module.scss';

const LOADING: Snapshot = {
  config: { kind: 'loading' },
  drain: { kind: 'loading' },
  persist: { kind: 'loading' },
  loadedAt: 0,
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Restarts (Provimux): what a stop, restart or upgrade does to the answers in flight
 * (`server.restart-drain-seconds`) and to the conversations under way (`routing.session-affinity-persist`), as the
 * gateway's two state paths report them, and the two settings. One change at a time: every control waits while a
 * change or a reload is under way. Each card shows its own read as it arrives.
 */
export function RestartsPage() {
  const { t, i18n } = useTranslation();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const probes = {
    modelRoutes: useProvimuxPresence((state) => state.modelRoutes),
    liveLists: useProvimuxPresence((state) => state.liveLists),
    modelLists: useProvimuxPresence((state) => state.modelLists),
    savings: useProvimuxPresence((state) => state.savings),
  };
  const [snapshot, setSnapshot] = useState<Snapshot>(LOADING);
  const [busy, setBusy] = useState<Card | 'reload' | null>(null);
  const [messages, setMessages] = useState<Messages>(messagesAfterRead());
  // The latest read and the change under way, for the handlers (set after each render, read only in events).
  const current = useRef(snapshot);
  const busyRef = useRef(busy);
  useEffect(() => {
    current.current = snapshot;
  }, [snapshot]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const guard = useRequestGuard();
  const writeGuard = useRequestGuard();

  const load = useCallback(async () => {
    if (busyRef.current && busyRef.current !== 'reload') return;
    const { client, isCurrent } = guard.begin();
    setBusy('reload');
    setMessages(messagesAfterRead());
    const parts = {
      config: restartsApi.config(client),
      drain: restartsApi.drain(client),
      persist: restartsApi.persist(client),
    };
    // Each card shows its read as it arrives: a slow one does not hold the others.
    for (const [name, promise] of Object.entries(parts)) {
      void promise.then((value) => {
        if (isCurrent()) setSnapshot((previous) => ({ ...previous, [name]: value }));
      });
    }
    await Promise.allSettled(Object.values(parts));
    if (isCurrent()) {
      setSnapshot((previous) => ({ ...previous, loadedAt: Date.now() }));
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load, serverVersion]);

  const change = async (
    card: Card,
    spec: Parameters<OnWrite>[0],
    describe: Parameters<OnWrite>[1]
  ) => {
    const { client, isCurrent } = writeGuard.begin();
    setBusy(card);
    busyRef.current = card;
    // The change reads the gateway again: no line from an earlier read stays.
    setMessages(messagesAfterRead());
    try {
      const { result, snapshot: after } = await runWrite(spec, {
        client,
        current: current.current,
        read: readAll,
        isCurrent,
        wait,
        onPending: () =>
          setMessages(
            messagesAfterWrite(card, { tone: 'pending', text: t('provimux.restarts.applying') })
          ),
      });
      if (!isCurrent()) return;
      if (after) setSnapshot(after);
      if (result.kind === 'saved' || result.kind === 'unconfirmed') {
        useConfigStore.getState().clearCache();
      }
      setMessages(messagesAfterWrite(card, describe(result, after ?? current.current)));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
    } finally {
      if (isCurrent()) {
        setBusy(null);
        busyRef.current = null;
      }
    }
  };

  // Each card has its own handler: the line after a change goes to the card that made it.
  const onDrainWrite: OnWrite = (spec, describe) => {
    if (!busyRef.current) void change('drain', spec, describe);
  };
  const onPersistWrite: OnWrite = (spec, describe) => {
    if (!busyRef.current) void change('persist', spec, describe);
  };

  const pathAnswered = snapshot.drain.kind === 'ready' || snapshot.persist.kind === 'ready';
  const kind = gatewayKind(
    serverVersion,
    probesSay(Object.values(probes).map((probe) => probe.status)),
    pathAnswered
  );
  const writable = snapshot.config.kind === 'ready' && snapshot.config.etag !== null;
  const loadedAt = snapshot.loadedAt || null;

  return (
    <div className={`${shared.page} ${styles.page}`}>
      <header className={shared.header}>
        <div className={shared.headerText}>
          <h1 className={shared.title}>{t('provimux.restarts.title')}</h1>
          <p className={shared.lede}>{t('provimux.restarts.lede')}</p>
        </div>
        <div className={shared.headerActions}>
          {loadedAt ? (
            <span className={shared.updated} title={formatExact(loadedAt, i18n.language)}>
              {t('provimux.restarts.updated', {
                time: formatClock(loadedAt, i18n.language, loadedAt),
              })}
            </span>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => void load()}
            loading={busy === 'reload'}
            disabled={busy !== null}
          >
            {busy !== 'reload' ? <IconRefreshCw size={15} /> : null}
            {t('provimux.common.reload')}
          </Button>
        </div>
      </header>

      {snapshot.config.kind === 'error' ? (
        <p className={shared.featureError} role="alert">
          {t('provimux.restarts.config_failed', { message: snapshot.config.message })}
        </p>
      ) : null}

      <NextRestart drain={snapshot.drain} persist={snapshot.persist} />
      <div className={styles.cards}>
        <DrainCard
          drain={snapshot.drain}
          writable={writable}
          kind={kind}
          version={serverVersion}
          busy={busy !== null}
          message={messages.drain}
          onWrite={onDrainWrite}
        />
        <PersistCard
          persist={snapshot.persist}
          writable={writable}
          kind={kind}
          version={serverVersion}
          busy={busy !== null}
          message={messages.persist}
          onWrite={onPersistWrite}
        />
      </div>
    </div>
  );
}

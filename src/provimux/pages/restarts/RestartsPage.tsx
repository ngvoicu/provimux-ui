import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { useAuthStore, useConfigStore } from '@/stores';
import { useRequestGuard } from '../shared/requestGuard';
import { formatClock, formatExact } from '../time';
import shared from '../shared/Shared.module.scss';
import { DrainCard } from './DrainCard';
import { NextRestart } from './NextRestart';
import { PersistCard } from './PersistCard';
import type { CardMessage, Client, ConfigLoad, Send, Write, WriteOutcome } from './parts';
import { restartsApi, RestartsWriteError } from './restartsApi';
import {
  conversationsAfter,
  drainSupport,
  nextWait,
  persistAbsence,
  readDrain,
  sessionAffinityOn,
  type PersistLoad,
} from './restartsLogic';
import styles from './RestartsPage.module.scss';

interface Loaded {
  config: ConfigLoad;
  persist: PersistLoad;
  loadedAt: number;
}

/** How long the page waits for the gateway to show a persist change, and how often it reads (its check is 5 s). */
const APPLY_POLLS = 4;
const APPLY_EVERY_MS = 2500;

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error ?? '');

/**
 * Restarts (Provimux): what a stop, restart or upgrade does to the answers being written
 * (`server.restart-drain-seconds`) and to the conversations under way (`routing.session-affinity-persist`), and the
 * two settings, each written alone, conditional on the read's tag. Every answer the gateway gives is shown as it is;
 * a gateway without a setting says so on its card, and the other card still works.
 */
export function RestartsPage() {
  const { t, i18n } = useTranslation();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const guard = useRequestGuard();
  const writeGuard = useRequestGuard();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async (client: Client): Promise<Loaded> => {
    const [config, persist] = await Promise.all([
      restartsApi
        .config(client)
        .then((answer): ConfigLoad => ({ kind: 'ready', read: answer }))
        .catch((error): ConfigLoad => ({ kind: 'error', message: messageOf(error) })),
      restartsApi.persist(client),
    ]);
    return { config, persist, loadedAt: Date.now() };
  }, []);

  const load = useCallback(async () => {
    const { client, isCurrent } = guard.begin();
    setLoading(true);
    try {
      const next = await read(client);
      if (isCurrent()) setLoaded(next);
    } catch (error) {
      if (isCurrent()) {
        setLoaded({
          config: { kind: 'error', message: messageOf(error) },
          persist: { kind: 'error', message: messageOf(error) },
          loadedAt: Date.now(),
        });
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read]);

  useEffect(() => {
    void load();
  }, [load, serverVersion]);

  const failure = (error: unknown): CardMessage => {
    if (error instanceof RestartsWriteError) {
      if (error.reason === 'changed')
        return { tone: 'warning', text: t('provimux.restarts.err_changed') };
      if (error.reason === 'no-tag')
        return { tone: 'error', text: t('provimux.restarts.err_no_tag') };
      if (error.reason === 'refused') {
        return {
          tone: 'error',
          text: t('provimux.restarts.err_refused', { message: error.message }),
        };
      }
    }
    return {
      tone: 'error',
      text: t('provimux.restarts.save_failed', { message: messageOf(error) }),
    };
  };

  /**
   * One write, then a fresh read whatever its answer (a 412 means another writer changed the file). `applied`, for
   * the persist switch, says when the gateway's state shows the change: the page reads it again a few times.
   */
  const write: Write = async (send: Send, applied, onPending): Promise<WriteOutcome> => {
    if (loaded?.config.kind !== 'ready') {
      return { ok: false, message: { tone: 'error', text: t('provimux.restarts.err_no_tag') } };
    }
    const { client, isCurrent } = writeGuard.begin();
    let outcome: WriteOutcome = { ok: true };
    try {
      await send(loaded.config.read, client);
      useConfigStore.getState().clearCache();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { ok: false, message: failure(error) };
      }
      outcome = { ok: false, message: failure(error) };
    }
    if (!isCurrent()) return outcome;
    let next = await read(client).catch(() => null);
    if (!isCurrent()) return outcome;
    if (next) setLoaded(next);
    if (outcome.ok && applied && next && !applied(next.persist)) {
      onPending?.();
      for (let poll = 0; poll < APPLY_POLLS; poll += 1) {
        await new Promise((resolve) => setTimeout(resolve, APPLY_EVERY_MS));
        if (!isCurrent() || !alive.current) return outcome;
        next = await read(client).catch(() => null);
        if (!isCurrent()) return outcome;
        if (next) setLoaded(next);
        if (next && applied(next.persist)) return outcome;
      }
      return { ok: false, message: { tone: 'warning', text: t('provimux.restarts.not_applied') } };
    }
    return outcome;
  };

  const document = loaded?.config.kind === 'ready' ? loaded.config.read.document : null;
  const drain = loaded?.config.kind === 'ready' ? readDrain(document) : null;
  const support = drainSupport(serverVersion);
  const affinityOn = sessionAffinityOn(document);
  const persist: PersistLoad | null = loaded?.persist ?? null;

  return (
    <div className={`${shared.page} ${styles.page}`}>
      <header className={shared.header}>
        <div className={shared.headerText}>
          <h1 className={shared.title}>{t('provimux.restarts.title')}</h1>
          <p className={shared.lede}>{t('provimux.restarts.lede')}</p>
        </div>
        <div className={shared.headerActions}>
          {loaded ? (
            <span className={shared.updated} title={formatExact(loaded.loadedAt, i18n.language)}>
              {t('provimux.restarts.updated', {
                time: formatClock(loaded.loadedAt, i18n.language, loaded.loadedAt),
              })}
            </span>
          ) : null}
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            {!loading ? <IconRefreshCw size={15} /> : null}
            {t('provimux.common.reload')}
          </Button>
        </div>
      </header>

      {!loaded ? (
        <div className={styles.loading} role="status">
          {t('provimux.common.loading')}
        </div>
      ) : (
        <>
          <NextRestart
            wait={nextWait(support, drain)}
            conversations={persist ? conversationsAfter(persist, affinityOn) : 'unknown'}
          />
          <div className={styles.cards}>
            <DrainCard support={support} config={loaded.config} reading={drain} write={write} />
            <PersistCard
              persist={loaded.persist}
              absence={persistAbsence(serverVersion)}
              affinityOn={affinityOn}
              write={write}
            />
          </div>
        </>
      )}
    </div>
  );
}

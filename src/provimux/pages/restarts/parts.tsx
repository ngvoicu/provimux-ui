import { useTranslation } from 'react-i18next';
import type { apiClient } from '@/services/api/client';
import type { ConfigRead } from './restartsApi';
import type { PersistLoad } from './restartsLogic';
import styles from './RestartsPage.module.scss';

export type Client = typeof apiClient;

export type ConfigLoad = { kind: 'ready'; read: ConfigRead } | { kind: 'error'; message: string };

/** A card's line under its controls: what a save did, or why it did not. */
export interface CardMessage {
  tone: 'ok' | 'error' | 'pending' | 'warning';
  text: string;
}

export type WriteOutcome = { ok: true } | { ok: false; message: CardMessage };

/** One request against the page's read, sent with the page's guarded client. */
export type Send = (read: ConfigRead, client: Client) => Promise<void>;

/**
 * Sends one write, then reads everything again. `applied` (persist only): the gateway's state shows the change; until
 * it does, `onPending` runs and the page reads again a few times.
 */
export type Write = (
  send: Send,
  applied?: (persist: PersistLoad) => boolean,
  onPending?: () => void
) => Promise<WriteOutcome>;

/** Whether the configuration file sets the value, or its default applies. */
export function Provenance({ set }: { set: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={styles.provenance} data-set={set}>
      {set ? t('provimux.restarts.badge_set') : t('provimux.restarts.badge_default')}
    </span>
  );
}

export function CardStatus({ message }: { message: CardMessage | null }) {
  return (
    <p
      className={styles.status}
      data-tone={message?.tone}
      role={message?.tone === 'error' ? 'alert' : 'status'}
      aria-live={message?.tone === 'error' ? undefined : 'polite'}
      hidden={!message}
    >
      {message?.text ?? ''}
    </p>
  );
}

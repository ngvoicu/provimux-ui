import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import shared from '../shared/Shared.module.scss';
import type { CardMessage } from './restartsWords';
import styles from './RestartsPage.module.scss';

/** Whether the configuration file sets the value, or the gateway's default applies. */
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

/** A card's head: its title, the setting's name, and its control where there is one. */
export function CardHead({
  id,
  title,
  setting,
  control,
}: {
  id: string;
  title: string;
  setting: string;
  control?: ReactNode;
}) {
  return (
    <div className={shared.featureHead}>
      <div className={shared.featureTitles}>
        <h2 id={`${id}-title`} className={styles.cardTitle}>
          {title}
        </h2>
        <p className={shared.featureEyebrow}>
          <code>{setting}</code>
        </p>
      </div>
      {control ? <div className={shared.featureControl}>{control}</div> : null}
    </div>
  );
}

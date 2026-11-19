import { useTranslation } from 'react-i18next';
import type { Access } from '../modelRoutes/logic';
import styles from './Shared.module.scss';

/** Subscription green, API key amber (owner, 2026-11-19); always with the word, never colour alone. */
export function AccessBadge({ access, kind }: { access: Access; kind: string | null }) {
  const { t } = useTranslation();
  const label =
    access === 'sub'
      ? t('provimux.access.sub')
      : access === 'api'
        ? t('provimux.access.api')
        : t('provimux.access.other', { kind: kind ?? '?' });
  return (
    <span className={styles.access} data-access={access}>
      <span className={styles.accessDot} aria-hidden="true" />
      {label}
    </span>
  );
}

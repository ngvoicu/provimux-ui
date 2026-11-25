import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconAlertTriangle, IconInfo } from '@/components/ui/icons';
import { routingModelsAddress, type RoutingNameVerdict } from './nameVerdict';
import styles from './RoutingNames.module.scss';

/**
 * Under the Routing page's model field (models-page.md 8.9): with "Serve only my names" on, the rule in one line;
 * for a typed name, whether the gateway serves it, the refusal in the warning tone. Nothing otherwise.
 */
export function ProvimuxRoutingNamesNote({ verdict }: { verdict: RoutingNameVerdict | null }) {
  const { t } = useTranslation();
  if (!verdict) return null;
  const refused = verdict.kind === 'refused';
  const text =
    verdict.kind === 'rule'
      ? t('provimux.routing.names_rule')
      : verdict.kind === 'refused'
        ? t('provimux.routing.names_refused', { name: verdict.name })
        : verdict.accounts === 0
          ? t('provimux.routing.names_yours_none', { name: verdict.name })
          : verdict.levelOf
            ? t('provimux.routing.names_yours_level', { name: verdict.name, base: verdict.levelOf })
            : verdict.copyOf !== null
              ? t('provimux.routing.names_yours_copy', { name: verdict.name, base: verdict.copyOf })
              : t('provimux.routing.names_yours', { name: verdict.name });
  return (
    <p
      className={styles.note}
      data-tone={refused ? 'refused' : verdict.kind === 'yours' ? 'served' : undefined}
      role={refused ? 'alert' : 'status'}
    >
      {refused ? (
        <IconAlertTriangle size={13} aria-hidden="true" />
      ) : (
        <IconInfo size={13} aria-hidden="true" />
      )}
      <span>
        {text}{' '}
        <Link to={routingModelsAddress(verdict)} className={styles.link}>
          {refused
            ? t('provimux.routing.names_keep_link')
            : verdict.kind === 'yours' && verdict.accounts > 0
              ? t('provimux.routing.names_who_link')
              : t('provimux.routing.names_link')}
        </Link>
      </span>
    </p>
  );
}

/**
 * Beside a tier's "Serving requests" (and the other states that say a tier may serve): for a refused name, that
 * no request for it gets there.
 */
export function ProvimuxRoutingTierNote({ verdict }: { verdict: RoutingNameVerdict | null }) {
  const { t } = useTranslation();
  if (verdict?.kind !== 'refused') return null;
  return (
    <span className={styles.tierNote}>
      <IconAlertTriangle size={12} aria-hidden="true" />
      {t('provimux.routing.names_tier_refused', { name: verdict.name })}
    </span>
  );
}

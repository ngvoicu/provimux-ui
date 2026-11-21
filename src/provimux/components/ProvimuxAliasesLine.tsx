import { useTranslation } from 'react-i18next';
import { Link, useInRouterContext } from 'react-router-dom';
import { countAliases } from '../pages/aliases/formSeams';
import { aliasesPageFor } from './aliasLinks';
import styles from './ProvimuxAliasFields.module.scss';

/**
 * Above a provider's model list (design 5.1): "N aliases" ("No aliases" for none) and a link to the
 * Aliases page on the form's family, in the same tab (a router link; leaving a form with unsaved input
 * behaves as any navigation away from it). Nothing for a login's own aliases.
 */
export function ProvimuxAliasesLine({
  show,
  models,
  family,
}: {
  show: boolean;
  models: readonly { name: string; alias?: string }[];
  family?: string;
}) {
  const { t } = useTranslation();
  // The editor is rendered inside the app's hash router; a render without one (a static test) gets the
  // same address as a plain hash link.
  const inRouter = useInRouterContext();
  if (!show) return null;
  const count = countAliases(models);
  const to = aliasesPageFor(family);
  return (
    <p className={styles.line}>
      <span>
        {count ? t('provimux.forms.aliases_count', { count }) : t('provimux.forms.aliases_none')}
      </span>
      {inRouter ? (
        <Link to={to} className={styles.link}>
          {t('provimux.forms.aliases_link')}
        </Link>
      ) : (
        <a href={`#${to}`} className={styles.link}>
          {t('provimux.forms.aliases_link')}
        </a>
      )}
    </p>
  );
}

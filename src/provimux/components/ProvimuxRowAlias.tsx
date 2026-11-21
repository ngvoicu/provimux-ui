import { useTranslation } from 'react-i18next';
import { shownAlias } from '../pages/aliases/formSeams';
import styles from './ProvimuxAliasFields.module.scss';

/**
 * A provider form row's alias as text, where the alias input was (design 5.1). Exactly one element when
 * `show`, empty when the row has no alias, so the row's three-column grid keeps its shape; nothing when
 * `show` is false (a login's own aliases keep their input).
 */
export function ProvimuxRowAlias({
  show,
  alias,
  name,
}: {
  show: boolean;
  alias?: string;
  name: string;
}) {
  const { t } = useTranslation();
  if (!show) return null;
  const text = shownAlias({ name, alias });
  return (
    <span
      className={styles.rowAlias}
      title={text ? t('provimux.forms.row_alias_title') : undefined}
    >
      {text ? (
        <>
          <span className="visually-hidden">{t('provimux.forms.row_alias_label')} </span>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
          {text}
        </>
      ) : null}
    </span>
  );
}

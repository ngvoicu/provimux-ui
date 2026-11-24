import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { IconExternalLink } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { CheckboxField } from '@/features/providers/sheets/forms/CheckboxField';
import formStyles from '@/features/providers/sheets/forms/sharedForm.module.scss';
import type { LoginDraft } from './loginSettings';
import styles from './AccountsPage.module.scss';

export interface LoginSettingsFieldsProps {
  draft: LoginDraft;
  onChange: (draft: LoginDraft) => void;
  disabled: boolean;
  /** Opens this login on the original page, where the settings its file keeps are. */
  onOpenOriginal: () => void;
}

/**
 * A subscription's settings: what the proxy's list shows, edited in place. What the login file keeps next to
 * its tokens is never shown here, so it is not edited here either: one line says where it is and opens it.
 */
export function LoginSettingsFields({ draft, onChange, disabled, onOpenOriginal }: LoginSettingsFieldsProps) {
  const { t } = useTranslation();
  const id = useId();

  return (
    <div className={`${formStyles.form} ${styles.settingsForm}`}>
      <section className={formStyles.section}>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor={`${id}-note`}>
            {t('provimux.accounts.login.note')}
          </label>
          <input
            id={`${id}-note`}
            className={formStyles.input}
            value={draft.note}
            disabled={disabled}
            aria-describedby={`${id}-note-hint`}
            onChange={(event) => onChange({ ...draft, note: event.target.value })}
          />
          <p id={`${id}-note-hint`} className={formStyles.sectionDesc}>
            {t('provimux.accounts.login.note_hint')}
          </p>
        </div>
        <div className={formStyles.field}>
          <span className={formStyles.label} id={`${id}-retry`}>
            {t('provimux.accounts.login.retries')}
          </span>
          <div className={styles.retryRow}>
            <Select
              value={draft.retry.mode}
              ariaLabelledBy={`${id}-retry`}
              options={[
                { value: 'inherit', label: t('provimux.accounts.login.retries_inherit') },
                { value: 'custom', label: t('provimux.accounts.login.retries_custom') },
              ]}
              disabled={disabled}
              onChange={(mode) =>
                onChange({
                  ...draft,
                  retry: { mode: mode as 'inherit' | 'custom', value: draft.retry.value || '1' },
                })
              }
            />
            {draft.retry.mode === 'custom' ? (
              <input
                className={`${formStyles.input} ${styles.retryCount}`}
                type="number"
                min={0}
                step={1}
                value={draft.retry.value}
                aria-label={t('provimux.accounts.login.retries_count')}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...draft, retry: { mode: 'custom', value: event.target.value } })
                }
              />
            ) : null}
          </div>
          <p className={formStyles.sectionDesc}>{t('provimux.accounts.login.retries_hint')}</p>
        </div>
        {draft.websockets !== null || draft.useSiwc !== null ? (
          <div className={formStyles.switchList}>
            {draft.websockets !== null ? (
              <CheckboxField
                label={t('provimux.accounts.settings.websockets')}
                hint={t('provimux.accounts.settings.websockets_hint')}
                checked={draft.websockets}
                disabled={disabled}
                onChange={(checked) => onChange({ ...draft, websockets: checked })}
              />
            ) : null}
            {draft.useSiwc !== null ? (
              <CheckboxField
                label={t('provimux.accounts.login.use_siwc')}
                hint={t('provimux.accounts.login.use_siwc_hint')}
                checked={draft.useSiwc}
                disabled={disabled}
                onChange={(checked) => onChange({ ...draft, useSiwc: checked })}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      <p className={styles.elsewhere}>
        {t('provimux.accounts.login.elsewhere')}{' '}
        <button type="button" className={styles.sheetLink} onClick={onOpenOriginal}>
          {t('provimux.accounts.login.elsewhere_link')}
          <IconExternalLink size={13} />
        </button>
      </p>
    </div>
  );
}

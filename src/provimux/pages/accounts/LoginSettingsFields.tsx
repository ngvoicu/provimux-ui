import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconX } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import {
  ExcludedModelsPicker,
  formatExcludedRulesText,
  parseExcludedRulesText,
} from '@/components/excludedModels';
import { ErrorRulesEditor } from '@/features/providers/sheets/forms/ErrorRulesEditor';
import { CheckboxField } from '@/features/providers/sheets/forms/CheckboxField';
import { ModelEntriesEditor } from '@/features/providers/sheets/forms/ModelEntriesEditor';
import formStyles from '@/features/providers/sheets/forms/sharedForm.module.scss';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import type { LoginDraft, LoginFacts, LoginReplacements, ReplaceField } from './loginSettings';
import styles from './AccountsPage.module.scss';

export interface LoginSettingsFieldsProps {
  draft: LoginDraft;
  facts: LoginFacts;
  onChange: (draft: LoginDraft) => void;
  disabled: boolean;
}

/** A value to start from when the owner chooses to set a field kept in the login file. */
const START: { [K in ReplaceField]-?: NonNullable<LoginReplacements[K]> } = {
  proxyUrl: '',
  prefix: '',
  weight: '',
  headers: [{ key: '', value: '' }],
  excludedModelsText: '',
  modelAliases: [{ name: '', alias: '' }],
  errorRules: [],
  disableCooling: false,
  usingApi: true,
};

/**
 * A subscription's settings: what the proxy lists shows its value and is edited in place; what the login
 * file keeps next to its tokens is set without being shown ("Set a new value"), and left alone otherwise.
 */
export function LoginSettingsFields({ draft, facts, onChange, disabled }: LoginSettingsFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  const replace = <K extends ReplaceField>(field: K, value: LoginReplacements[K]) =>
    onChange({ ...draft, replace: { ...draft.replace, [field]: value } });

  const row = <K extends ReplaceField>(
    field: K,
    title: string,
    hint: string,
    editor: (value: NonNullable<LoginReplacements[K]>) => ReactNode
  ) => {
    const value = draft.replace[field];
    const setting = value !== undefined;
    return (
      <div className={styles.replaceRow} data-setting={setting || undefined}>
        <div className={styles.replaceHead}>
          <span className={styles.replaceTitle} id={`${id}-${field}`}>
            {title}
          </span>
          {setting ? (
            <button
              type="button"
              className={styles.replaceKeep}
              disabled={disabled}
              onClick={() => replace(field, undefined)}
            >
              {t('provimux.accounts.login.keep')}
            </button>
          ) : (
            <>
              <span className={styles.replaceNow}>{t('provimux.accounts.login.not_shown')}</span>
              <button
                type="button"
                className={styles.replaceSet}
                disabled={disabled}
                aria-describedby={`${id}-${field}`}
                onClick={() => replace(field, START[field] as LoginReplacements[K])}
              >
                {t('provimux.accounts.login.set')}
              </button>
            </>
          )}
        </div>
        {setting ? (
          <div className={styles.replaceBody} role="group" aria-labelledby={`${id}-${field}`}>
            {editor(value as NonNullable<LoginReplacements[K]>)}
            <p className={formStyles.sectionDesc}>{hint}</p>
          </div>
        ) : null}
      </div>
    );
  };

  const textInput = (field: 'proxyUrl' | 'prefix', placeholder: string) => (value: string) => (
    <input
      className={formStyles.input}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      aria-labelledby={`${id}-${field}`}
      disabled={disabled}
      onChange={(event) => replace(field, event.target.value)}
    />
  );

  return (
    <div className={`${formStyles.form} ${styles.settingsForm}`}>
      <section className={formStyles.section}>
        <h3 className={formStyles.sectionHeading}>{t('provimux.accounts.login.section_here')}</h3>
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
                  retry: {
                    mode: mode as 'inherit' | 'custom',
                    value: draft.retry.value || '1',
                  },
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

      <section className={formStyles.section}>
        <h3 className={formStyles.sectionHeading}>{t('provimux.accounts.login.section_file')}</h3>
        <p className={styles.sharedNote}>{t('provimux.accounts.login.file_note')}</p>
        <div className={styles.replaceList}>
          {row(
            'proxyUrl',
            t('provimux.accounts.settings.proxy'),
            t('provimux.accounts.login.proxy_hint'),
            textInput('proxyUrl', 'socks5://host:port')
          )}
          {row(
            'prefix',
            t('provimux.accounts.settings.prefix'),
            t('provimux.accounts.login.prefix_hint'),
            textInput('prefix', '')
          )}
          {row('weight', t('provimux.accounts.settings.weight'), t('provimux.accounts.login.weight_hint'), (value) => (
            <input
              className={`${formStyles.input} ${styles.retryCount}`}
              type="number"
              step={1}
              min={0}
              max={MAX_CREDENTIAL_WEIGHT}
              value={value}
              placeholder="1"
              aria-labelledby={`${id}-weight`}
              disabled={disabled}
              onChange={(event) => replace('weight', event.target.value)}
            />
          ))}
          {row('headers', t('provimux.accounts.settings.headers'), t('provimux.accounts.login.headers_hint'), (rows) => (
            <div className={formStyles.entriesList}>
              {rows.map((header, index) => (
                <div key={index} className={formStyles.headerRow}>
                  <input
                    className={`${formStyles.input} ${formStyles.mono}`}
                    placeholder="X-Custom-Header"
                    aria-label={t('provimux.accounts.settings.header_name')}
                    value={header.key}
                    disabled={disabled}
                    onChange={(event) =>
                      replace(
                        'headers',
                        rows.map((it, i) => (i === index ? { ...it, key: event.target.value } : it))
                      )
                    }
                  />
                  <input
                    className={formStyles.input}
                    placeholder={t('provimux.accounts.settings.header_value')}
                    aria-label={t('provimux.accounts.settings.header_value')}
                    value={header.value}
                    disabled={disabled}
                    onChange={(event) =>
                      replace(
                        'headers',
                        rows.map((it, i) => (i === index ? { ...it, value: event.target.value } : it))
                      )
                    }
                  />
                  <button
                    type="button"
                    className={formStyles.removeBtn}
                    aria-label={t('provimux.accounts.settings.header_remove')}
                    disabled={disabled || rows.length <= 1}
                    onClick={() => replace('headers', rows.filter((_, i) => i !== index))}
                  >
                    <IconX size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={formStyles.addBtn}
                disabled={disabled}
                onClick={() => replace('headers', [...rows, { key: '', value: '' }])}
              >
                <IconPlus size={13} />
                <span>{t('provimux.accounts.settings.header_add')}</span>
              </button>
            </div>
          ))}
          {row(
            'excludedModelsText',
            t('provimux.accounts.settings.excluded'),
            t('provimux.accounts.login.excluded_hint'),
            (text) => (
              <ExcludedModelsPicker
                value={parseExcludedRulesText(text)}
                onChange={(next) => replace('excludedModelsText', formatExcludedRulesText(next))}
                candidates={[]}
                catalogState="unavailable"
                disabled={disabled}
                labelledBy={`${id}-excludedModelsText`}
              />
            )
          )}
          {row(
            'modelAliases',
            t('provimux.accounts.login.aliases'),
            t('provimux.accounts.login.aliases_hint'),
            (rows) => (
              <ModelEntriesEditor
                oauthAliasOnly
                models={rows}
                supportsImage={false}
                supportsThinking={false}
                mutating={disabled}
                removeDisabled={false}
                onUpdate={(index, patch) =>
                  replace(
                    'modelAliases',
                    rows.map((it, i) => (i === index ? { ...it, ...patch, alias: patch.alias ?? it.alias } : it))
                  )
                }
                onAdd={() => replace('modelAliases', [...rows, { name: '', alias: '' }])}
                onRemove={(index) => replace('modelAliases', rows.filter((_, i) => i !== index))}
              />
            )
          )}
          {row(
            'errorRules',
            t('provimux.accounts.login.errors'),
            t('provimux.accounts.login.errors_hint'),
            (rules) => (
              <ErrorRulesEditor
                rules={rules}
                disabled={disabled}
                onChange={(next) => replace('errorRules', next)}
              />
            )
          )}
          {row(
            'disableCooling',
            t('provimux.accounts.login.cooling'),
            t('provimux.accounts.login.cooling_hint'),
            (value) => (
              <Select
                value={value ? 'off' : 'on'}
                ariaLabelledBy={`${id}-disableCooling`}
                options={[
                  { value: 'on', label: t('provimux.accounts.login.cooling_on') },
                  { value: 'off', label: t('provimux.accounts.login.cooling_off') },
                ]}
                disabled={disabled}
                onChange={(next) => replace('disableCooling', next === 'off')}
              />
            )
          )}
          {facts.usingApi
            ? row(
                'usingApi',
                t('provimux.accounts.login.using_api'),
                t('provimux.accounts.login.using_api_hint'),
                (value) => (
                  <Select
                    value={value ? 'on' : 'off'}
                    ariaLabelledBy={`${id}-usingApi`}
                    options={[
                      { value: 'on', label: t('provimux.accounts.login.using_api_on') },
                      { value: 'off', label: t('provimux.accounts.login.using_api_off') },
                    ]}
                    disabled={disabled}
                    onChange={(next) => replace('usingApi', next === 'on')}
                  />
                )
              )
            : null}
        </div>
      </section>
    </div>
  );
}

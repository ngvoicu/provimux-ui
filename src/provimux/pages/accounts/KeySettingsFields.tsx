import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconDownload, IconPlus, IconX } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { FieldLabel } from '@/components/ui/FieldLabel';
import {
  DISABLE_ALL_RULE,
  ExcludedModelsPicker,
  formatExcludedRulesText,
  parseExcludedRulesText,
  type ExcludedModelsCatalogState,
} from '@/components/excludedModels';
import {
  LiteralReplacementEditor,
  PatternReplacementEditor,
} from '@/components/providers/SensitiveReplacementEditor';
import { syncDiscoveredModels } from '@/features/providers/discoverySelection';
import { removeModelAt } from '@/features/providers/modelEntries';
import { readRuntimePolicy } from '@/features/providers/runtimePolicy';
import { CheckboxField } from '@/features/providers/sheets/forms/CheckboxField';
import { FormDisclosure } from '@/features/providers/sheets/forms/FormSection';
import { ModelDiscoveryPanel } from '@/features/providers/sheets/forms/ModelDiscoveryPanel';
import { ModelEntriesEditor } from '@/features/providers/sheets/forms/ModelEntriesEditor';
import {
  ConnectionPoolEditor,
  OptionalBooleanField,
} from '@/features/providers/sheets/forms/NativeKeyFields';
import { ProviderBehaviorEditor } from '@/features/providers/sheets/forms/ProviderBehaviorEditor';
import { RuntimePolicyEditor } from '@/features/providers/sheets/forms/RuntimePolicyEditor';
import { useModelDiscovery } from '@/features/providers/sheets/forms/useModelDiscovery';
import formStyles from '@/features/providers/sheets/forms/sharedForm.module.scss';
import type { ModelEntryInput, ProviderEntryFormInput } from '@/features/providers/types';
import { PROVIDER_DESCRIPTORS } from '@/features/providers/descriptors';
import type { ApiKeyEntryInput } from '@/features/providers/types';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import { maskApiKey } from '@/utils/format';
import type { ModelInfo } from '@/utils/models';
import {
  memberForm,
  probeKeyOf,
  sharedForm,
  sharedWithOthers,
  valueOf,
  withLists,
  withMember,
  withShared,
  withValue,
  type BothField,
  type KeyDraft,
} from './keySettings';
import { familyAsked } from './keyListSettings';
import styles from './AccountsPage.module.scss';

const DISABLE_ALL = [DISABLE_ALL_RULE];
const emptyHeader = () => ({ key: '', value: '' });
const emptyModel = (): ModelEntryInput => ({ name: '', alias: '' });
const numberOrUndefined = (value: string) => (value.trim() === '' ? undefined : Number(value));

export interface KeySettingsFieldsProps {
  draft: KeyDraft;
  onChange: (draft: KeyDraft) => void;
  /** The service as the owner knows it ("Claude"). */
  service: string;
  mode: 'add' | 'edit';
  disabled: boolean;
  /**
   * The server has self-refreshing key lists (key-model-lists.md 7.2): the "Fixed list" switch, and an
   * OpenAI-compatible entry's "Models it never serves", are shown. A server without them drops the fields.
   */
  listsShown?: boolean;
  /** Models the key learned from its service's list: offered when picking a model it never serves. */
  learned?: readonly string[];
  /** Brings a part into view when the form opens: the switch, or the models it never serves. */
  focus?: 'lists' | 'excluded' | null;
}

/**
 * Every setting AI Providers has for a key, in the owner's words: where it connects, the models it serves
 * and what he calls them, how requests reach it, then the service's own extras and the rare ones, each
 * one level deeper. The editors of lists (models, exclusions, cloaking, retries) are AI Providers' own.
 */
export function KeySettingsFields({
  draft,
  onChange,
  service,
  mode,
  disabled,
  listsShown = false,
  learned,
  focus = null,
}: KeySettingsFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  // A panel's "Use a fixed list" or "Exclude them" opens the form on that part.
  useEffect(() => {
    if (!focus) return;
    const target = document.getElementById(`${id}-${focus}`);
    target?.scrollIntoView({ block: 'center' });
  }, [focus, id, listsShown]);
  const compatible = draft.kind === 'compatible';
  const brand = compatible ? 'openaiCompatibility' : draft.family;
  const descriptor = PROVIDER_DESCRIPTORS[brand];
  const shared = sharedForm(draft);
  const member = memberForm(draft);

  const set = <K extends BothField>(field: K, value: ProviderEntryFormInput[K]) =>
    onChange(withValue(draft, field, value));
  const setShared = (patch: Partial<ProviderEntryFormInput>) => onChange(withShared(draft, patch));
  const setMember = (patch: Partial<ProviderEntryFormInput>) => onChange(withMember(draft, patch));

  const sharedTag = (field: BothField | 'baseUrl') =>
    sharedWithOthers(draft, field) ? (
      <span className={styles.sharedTag} title={t('provimux.accounts.settings.shared_title')}>
        {t('provimux.accounts.settings.shared_tag')}
      </span>
    ) : null;

  const label = (field: BothField | 'baseUrl' | null, htmlFor: string, text: string, hint?: string) => (
    <div className={styles.fieldHead}>
      <label className={formStyles.label} htmlFor={htmlFor}>
        {text}
      </label>
      {field ? sharedTag(field) : null}
      {hint ? <span className={styles.fieldHintInline}>{hint}</span> : null}
    </div>
  );

  // --- the models: AI Providers' list, and its "get the list from the service" ---------------------------
  const models = valueOf(draft, 'models');
  const modelRows = models.length ? models : [emptyModel()];
  const headers = valueOf(draft, 'headers');
  const headerRows = headers.length ? headers : [emptyHeader()];
  const probeEntries: ApiKeyEntryInput[] | undefined = compatible ? shared.apiKeyEntries : undefined;
  const discovery = useModelDiscovery({
    brand,
    baseUrl: shared.baseUrl,
    proxyUrl: compatible ? undefined : valueOf(draft, 'proxyUrl'),
    formHeaders: headers,
    apiKeyEntries: probeEntries,
    // The key typed in the form, else the one stored: the list is asked for the way AI Providers asks it.
    apiKey: compatible ? undefined : probeKeyOf(draft),
    fallbackApiKey: compatible ? probeKeyOf(draft) : undefined,
  });
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const existingNames = useMemo(
    () => new Set(models.map((model) => model.name.trim()).filter(Boolean)),
    [models]
  );
  const openDiscovery = () => {
    setDiscoveryOpen(true);
    if (!discovery.loading && !discovery.hasFetched) void discovery.fetch();
  };
  const applyDiscovered = (picked: ModelInfo[], catalog: ModelInfo[]) =>
    set('models', syncDiscoveredModels(models, picked, catalog));

  // --- exclusions: AI Providers' picker; '*' stays the on/off switch's ----------------------------------
  // An OpenAI-compatible entry's are Provimux's own field (key-model-lists.md 6.1), held with the list settings.
  const excludedText = compatible ? '' : valueOf(draft, 'excludedModelsText');
  const nativeRules = useMemo(() => parseExcludedRulesText(excludedText), [excludedText]);
  const excludedRules = compatible ? (draft.lists.excluded ?? []) : nativeRules;
  const setExcluded = (next: string[]) =>
    onChange(
      compatible
        ? withLists(draft, { excluded: next })
        : withValue(draft, 'excludedModelsText', formatExcludedRulesText(next))
    );
  const candidates = useMemo(() => {
    const byKey = new Map<string, { id: string; displayName?: string }>();
    discovery.models.forEach((model) => {
      const name = model.name?.trim();
      if (name) byKey.set(name.toLowerCase(), { id: name, displayName: model.alias || model.displayName });
    });
    models.forEach((model) => {
      const name = model.name?.trim();
      if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), { id: name });
    });
    learned?.forEach((model) => {
      const name = model.trim();
      if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), { id: name });
    });
    return [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [discovery.models, models, learned]);
  const rowsListed = models.some((model) => model.name.trim());
  const fixedShown = listsShown && (compatible || familyAsked(draft.family));
  const excludedShown = compatible ? listsShown : descriptor.supportsExcludedModels;
  const catalogState: ExcludedModelsCatalogState = discovery.loading
    ? 'loading'
    : discovery.error
      ? 'error'
      : candidates.length
        ? 'ready'
        : 'unavailable';

  const updateCloak = (patch: Partial<NonNullable<ProviderEntryFormInput['cloak']>>) =>
    setMember({
      cloak: {
        mode: '',
        strictMode: false,
        sensitiveWordsText: '',
        sensitiveWordsReplace: {},
        sensitivePatternsReplace: [],
        cacheUserId: false,
        ...member.cloak,
        ...patch,
      },
    });

  const section = (title: string, children: ReactNode) => (
    <section className={formStyles.section}>
      <h3 className={formStyles.sectionHeading}>{title}</h3>
      {children}
    </section>
  );

  return (
    <div className={`${formStyles.form} ${styles.settingsForm}`}>
      {draft.kind === 'native' && draft.siblings > 0 ? (
        <p className={styles.sharedNote}>
          {t('provimux.accounts.settings.shared_note', {
            name: draft.groupName,
            count: draft.siblings,
          })}
        </p>
      ) : null}

      {section(
        t('provimux.accounts.settings.section_connection'),
        <>
          {compatible && mode === 'edit' ? (
            <div className={formStyles.field}>
              {label(null, `${id}-name`, t('provimux.accounts.name_label'))}
              <input
                id={`${id}-name`}
                className={formStyles.input}
                value={shared.name}
                disabled={disabled}
                onChange={(event) => setShared({ name: event.target.value })}
              />
            </div>
          ) : null}
          {!compatible && mode === 'edit' ? (
            <div className={formStyles.field}>
              {label(null, `${id}-key`, t('provimux.accounts.settings.replace_key'))}
              {/* Uncontrolled: the page never puts a stored key back into a field. */}
              <input
                id={`${id}-key`}
                className={formStyles.input}
                type="password"
                defaultValue=""
                autoComplete="new-password"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                placeholder={t('provimux.accounts.settings.replace_key_placeholder')}
                aria-describedby={`${id}-key-hint`}
                disabled={disabled}
                onChange={(event) => setMember({ apiKey: event.target.value })}
              />
              <p id={`${id}-key-hint`} className={formStyles.sectionDesc}>
                {t('provimux.accounts.settings.replace_key_hint')}
              </p>
            </div>
          ) : null}
          {!compatible || mode === 'edit' ? (
            <div className={formStyles.field}>
              {label('baseUrl', `${id}-base`, t('provimux.accounts.settings.base_url'))}
              <input
                id={`${id}-base`}
                className={formStyles.input}
                value={shared.baseUrl}
                inputMode="url"
                spellCheck={false}
                placeholder={
                  descriptor.baseUrlRequired
                    ? 'https://api.example.com/v1'
                    : t('provimux.accounts.settings.base_url_default', { service })
                }
                aria-describedby={`${id}-base-hint`}
                disabled={disabled}
                onChange={(event) => setShared({ baseUrl: event.target.value })}
              />
              <p id={`${id}-base-hint`} className={formStyles.sectionDesc}>
                {descriptor.baseUrlRequired
                  ? t('provimux.accounts.settings.base_url_hint_required')
                  : t('provimux.accounts.settings.base_url_hint', { service })}
              </p>
            </div>
          ) : null}

          {compatible ? (
            <CompatibleKeys
              entries={shared.apiKeyEntries ?? []}
              replaceable={mode === 'edit'}
              disabled={disabled}
              onChange={(apiKeyEntries) => setShared({ apiKeyEntries })}
            />
          ) : (
            <div className={formStyles.field}>
              {label('proxyUrl', `${id}-proxy`, t('provimux.accounts.settings.proxy'))}
              <input
                id={`${id}-proxy`}
                className={formStyles.input}
                value={valueOf(draft, 'proxyUrl')}
                placeholder="http://127.0.0.1:7890"
                spellCheck={false}
                aria-describedby={`${id}-proxy-hint`}
                disabled={disabled}
                onChange={(event) => set('proxyUrl', event.target.value)}
              />
              <p id={`${id}-proxy-hint`} className={formStyles.sectionDesc}>
                {t('provimux.accounts.settings.proxy_hint')}
              </p>
            </div>
          )}

          <div className={formStyles.field} role="group" aria-labelledby={`${id}-headers`}>
            <div className={styles.fieldHead}>
              <span className={formStyles.label} id={`${id}-headers`}>
                {t('provimux.accounts.settings.headers')}
              </span>
              {sharedTag('headers')}
            </div>
            <div className={formStyles.entriesList}>
              {headerRows.map((row, index) => (
                <div key={index} className={formStyles.headerRow}>
                  <input
                    className={`${formStyles.input} ${formStyles.mono}`}
                    placeholder="X-Custom-Header"
                    aria-label={t('provimux.accounts.settings.header_name')}
                    value={row.key}
                    disabled={disabled}
                    onChange={(event) =>
                      set(
                        'headers',
                        headerRows.map((it, i) => (i === index ? { ...it, key: event.target.value } : it))
                      )
                    }
                  />
                  <input
                    className={formStyles.input}
                    placeholder={t('provimux.accounts.settings.header_value')}
                    aria-label={t('provimux.accounts.settings.header_value')}
                    value={row.value}
                    disabled={disabled}
                    onChange={(event) =>
                      set(
                        'headers',
                        headerRows.map((it, i) =>
                          i === index ? { ...it, value: event.target.value } : it
                        )
                      )
                    }
                  />
                  <button
                    type="button"
                    className={formStyles.removeBtn}
                    aria-label={t('provimux.accounts.settings.header_remove')}
                    title={t('provimux.accounts.settings.header_remove')}
                    disabled={disabled || (headerRows.length <= 1 && !row.key && !row.value)}
                    onClick={() =>
                      set(
                        'headers',
                        headerRows.filter((_, i) => i !== index)
                      )
                    }
                  >
                    <IconX size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={formStyles.addBtn}
                disabled={disabled}
                onClick={() => set('headers', [...headerRows, emptyHeader()])}
              >
                <IconPlus size={13} />
                <span>{t('provimux.accounts.settings.header_add')}</span>
              </button>
            </div>
            <p className={formStyles.sectionDesc}>{t('provimux.accounts.settings.headers_hint')}</p>
          </div>
        </>
      )}

      {section(
        t('provimux.accounts.settings.section_models'),
        <>
          <div className={formStyles.field} role="group" aria-labelledby={`${id}-models`}>
            <div className={styles.fieldHead}>
              <span className={formStyles.label} id={`${id}-models`}>
                {t('provimux.accounts.settings.models')}
              </span>
              {sharedTag('models')}
            </div>
            <p className={formStyles.sectionDesc}>
              {t('provimux.accounts.settings.models_hint', { service })}
            </p>
            {discovery.available ? (
              <div className={formStyles.entriesToolbar}>
                <button
                  type="button"
                  className={formStyles.connectivityBtn}
                  onClick={openDiscovery}
                  disabled={disabled}
                >
                  <IconDownload size={13} />
                  <span>{t('provimux.accounts.settings.models_fetch', { service })}</span>
                </button>
              </div>
            ) : null}
            {discovery.available && discoveryOpen ? (
              <ModelDiscoveryPanel
                loading={discovery.loading}
                error={discovery.error}
                models={discovery.models}
                hasFetched={discovery.hasFetched}
                existingNames={existingNames}
                mutating={disabled}
                onApply={applyDiscovered}
                onReload={() => void discovery.fetch()}
                onClose={() => setDiscoveryOpen(false)}
              />
            ) : null}
            <ModelEntriesEditor
              providerBrand={brand}
              models={modelRows}
              supportsImage={compatible}
              supportsThinking
              mutating={disabled}
              removeDisabled={false}
              onUpdate={(index, patch) =>
                set(
                  'models',
                  modelRows.map((row, i) => (i === index ? { ...row, ...patch } : row))
                )
              }
              onAdd={() => set('models', [...modelRows, emptyModel()])}
              onRemove={(index) => set('models', removeModelAt(modelRows, index))}
            />
          </div>

          {fixedShown ? (
            <div className={`${formStyles.field} ${styles.fixedField}`} id={`${id}-lists`}>
              <div className={styles.fixedRow}>
                <div className={styles.fixedText}>
                  <span className={formStyles.label} id={`${id}-fixed`}>
                    {t('provimux.accounts.settings.fixed')}
                  </span>
                  <p className={formStyles.sectionDesc} id={`${id}-fixed-hint`}>
                    {!compatible && !rowsListed
                      ? t('provimux.accounts.settings.fixed_catalog_text', { service })
                      : draft.lists.fixed
                        ? t('provimux.accounts.settings.fixed_on_text', { service })
                        : t('provimux.accounts.settings.fixed_off_text', { service })}
                  </p>
                </div>
                <ToggleSwitch
                  checked={draft.lists.fixed}
                  disabled={disabled}
                  onChange={(fixed) => onChange(withLists(draft, { fixed }))}
                  ariaLabel={t('provimux.accounts.settings.fixed')}
                />
              </div>
              {compatible && draft.lists.fixed && !rowsListed ? (
                <p className={styles.fixedWarning} role="note">
                  <IconAlertTriangle size={13} />
                  <span>{t('provimux.accounts.settings.fixed_empty', { service })}</span>
                </p>
              ) : null}
            </div>
          ) : listsShown ? (
            // Vertex and Interactions keys are never asked for a list: no switch, the reason in a line.
            <p className={styles.fieldHint} id={`${id}-lists`}>
              {t('provimux.accounts.settings.fixed_never_asked', { service })}
            </p>
          ) : null}

          {excludedShown ? (
            <div className={formStyles.field} id={`${id}-excluded-field`}>
              <div className={styles.fieldHead}>
                <span className={formStyles.label} id={`${id}-excluded`}>
                  {t('provimux.accounts.settings.excluded')}
                </span>
                {compatible ? null : sharedTag('excludedModelsText')}
              </div>
              <p className={formStyles.sectionDesc}>
                {compatible
                  ? t('provimux.accounts.settings.excluded_hint_compatible')
                  : t('provimux.accounts.settings.excluded_hint')}
              </p>
              <ExcludedModelsPicker
                value={excludedRules}
                onChange={setExcluded}
                candidates={candidates}
                catalogState={catalogState}
                onRetryCatalog={discovery.available ? () => void discovery.fetch() : undefined}
                disabled={disabled}
                reservedRules={DISABLE_ALL}
                reservedRuleMessage={
                  compatible
                    ? t('provimux.accounts.settings.excluded_reserved_compatible')
                    : t('provimux.accounts.settings.excluded_reserved')
                }
                labelledBy={`${id}-excluded`}
              />
            </div>
          ) : null}
        </>
      )}

      {section(
        t('provimux.accounts.settings.section_routing'),
        <>
          <div className={formStyles.fieldRow}>
            <div className={formStyles.field}>
              {label('prefix', `${id}-prefix`, t('provimux.accounts.settings.prefix'))}
              <input
                id={`${id}-prefix`}
                className={formStyles.input}
                value={valueOf(draft, 'prefix')}
                spellCheck={false}
                disabled={disabled}
                onChange={(event) => set('prefix', event.target.value)}
              />
            </div>
            {mode === 'add' ? (
              <div className={formStyles.field}>
                {label('priority', `${id}-priority`, t('provimux.accounts.settings.priority'))}
                <input
                  id={`${id}-priority`}
                  className={formStyles.input}
                  type="number"
                  step={1}
                  placeholder="0"
                  value={valueOf(draft, 'priority') ?? ''}
                  disabled={disabled}
                  onChange={(event) => set('priority', numberOrUndefined(event.target.value))}
                />
              </div>
            ) : null}
            {!compatible ? (
              <div className={formStyles.field}>
                {label(null, `${id}-weight`, t('provimux.accounts.settings.weight'))}
                <input
                  id={`${id}-weight`}
                  className={formStyles.input}
                  type="number"
                  step={1}
                  max={MAX_CREDENTIAL_WEIGHT}
                  placeholder="1"
                  value={member.weight ?? ''}
                  disabled={disabled}
                  onChange={(event) => setMember({ weight: numberOrUndefined(event.target.value) })}
                />
              </div>
            ) : null}
          </div>
          <p className={formStyles.sectionDesc}>
            {mode === 'add'
              ? t('provimux.accounts.settings.routing_hint_add')
              : t('provimux.accounts.settings.routing_hint')}
          </p>
          {!compatible && descriptor.supportsWebsockets ? (
            <CheckboxField
              label={t('provimux.accounts.settings.websockets')}
              hint={t('provimux.accounts.settings.websockets_hint')}
              checked={member.websockets === true}
              disabled={disabled}
              onChange={(checked) => setMember({ websockets: checked })}
            />
          ) : null}
        </>
      )}

      <div className={formStyles.disclosureGroup}>
        {!compatible && descriptor.supportsCloak ? (
          <FormDisclosure label={t('provimux.accounts.settings.cloaking')}>
            <p className={formStyles.sectionDesc}>{t('provimux.accounts.settings.cloaking_hint')}</p>
            <div className={formStyles.field}>
              <label className={formStyles.label} htmlFor={`${id}-cloak-mode`}>
                {t('providersPage.form.cloakMode')}
              </label>
              <Select
                id={`${id}-cloak-mode`}
                value={member.cloak?.mode ?? ''}
                options={[
                  { value: '', label: t('provimux.accounts.settings.cloak_default') },
                  { value: 'auto', label: t('provimux.accounts.settings.cloak_auto') },
                  { value: 'always', label: t('provimux.accounts.settings.cloak_always') },
                  { value: 'never', label: t('provimux.accounts.settings.cloak_never') },
                ]}
                disabled={disabled}
                onChange={(value) => updateCloak({ mode: value })}
              />
            </div>
            <div className={formStyles.switchList}>
              <CheckboxField
                label={t('providersPage.form.cloakStrict')}
                checked={member.cloak?.strictMode === true}
                disabled={disabled}
                onChange={(checked) => updateCloak({ strictMode: checked })}
              />
              <CheckboxField
                label={t('providersPage.form.cloakCacheUserId')}
                hint={t('providersPage.form.cloakCacheUserIdHint')}
                checked={member.cloak?.cacheUserId === true}
                disabled={disabled}
                onChange={(checked) => updateCloak({ cacheUserId: checked })}
              />
            </div>
            <div className={formStyles.field}>
              <label className={formStyles.label} htmlFor={`${id}-cloak-words`}>
                {t('providersPage.form.cloakSensitiveWords')}
              </label>
              <textarea
                id={`${id}-cloak-words`}
                className={formStyles.textarea}
                rows={3}
                value={member.cloak?.sensitiveWordsText ?? ''}
                disabled={disabled}
                onChange={(event) => updateCloak({ sensitiveWordsText: event.target.value })}
              />
            </div>
            <div className={formStyles.field} role="group" aria-labelledby={`${id}-literal`}>
              <FieldLabel
                className={formStyles.labelLine}
                labelClassName={formStyles.label}
                id={`${id}-literal`}
                label={t('sensitive_replacements.literal_title')}
                hint={t('sensitive_replacements.literal_hint')}
                hintId={`${id}-literal-hint`}
              />
              <LiteralReplacementEditor
                value={member.cloak?.sensitiveWordsReplace ?? {}}
                onChange={(value) => updateCloak({ sensitiveWordsReplace: value })}
                disabled={disabled}
                describedBy={`${id}-literal-hint`}
                inputClassName={formStyles.input}
                addButtonClassName={formStyles.addBtn}
                addButtonIcon
              />
            </div>
            <div className={formStyles.field} role="group" aria-labelledby={`${id}-pattern`}>
              <FieldLabel
                className={formStyles.labelLine}
                labelClassName={formStyles.label}
                id={`${id}-pattern`}
                label={t('sensitive_replacements.pattern_title')}
              />
              <p id={`${id}-pattern-hint`} className={formStyles.sectionDesc}>
                {t('sensitive_replacements.pattern_hint')}
              </p>
              <PatternReplacementEditor
                value={member.cloak?.sensitivePatternsReplace ?? []}
                onChange={(value) => updateCloak({ sensitivePatternsReplace: value })}
                disabled={disabled}
                describedBy={`${id}-pattern-hint`}
                inputClassName={formStyles.input}
                addButtonClassName={formStyles.addBtn}
                addButtonIcon
              />
            </div>
          </FormDisclosure>
        ) : null}

        {!compatible && brand === 'claude' ? (
          <FormDisclosure label={t('provimux.accounts.settings.claude_client')}>
            <div className={formStyles.field}>
              <FieldLabel
                className={formStyles.labelLine}
                labelClassName={formStyles.label}
                id={`${id}-fingerprint-label`}
                label={t('providersPage.form.fingerprintProfile')}
                hint={t('providersPage.form.fingerprintProfileHint')}
                hintId={`${id}-fingerprint-hint`}
              />
              <Select
                id={`${id}-fingerprint`}
                value={member.fingerprintProfile ?? ''}
                options={[
                  { value: '', label: t('providersPage.form.fingerprintProfileDefault') },
                  {
                    value: 'claude-code-cli',
                    label: t('providersPage.form.fingerprintProfileClaudeCodeCli'),
                  },
                ]}
                disabled={disabled}
                ariaLabelledBy={`${id}-fingerprint-label`}
                ariaDescribedBy={`${id}-fingerprint-hint`}
                onChange={(value) => setMember({ fingerprintProfile: value })}
              />
            </div>
            <OptionalBooleanField
              label={t('providersPage.nativeKey.nativeToolSearch')}
              value={member.nativeToolSearch}
              disabled={disabled}
              onChange={(value) => setMember({ nativeToolSearch: value })}
            />
          </FormDisclosure>
        ) : null}

        {!compatible && brand === 'vertex' ? (
          <FormDisclosure label={t('providersPage.nativeKey.routing')}>
            {(['interactions', 'openapi'] as const).map((key) => (
              <OptionalBooleanField
                key={key}
                label={t(`providersPage.nativeKey.${key}`)}
                value={member[key]}
                disabled={disabled}
                onChange={(value) => setMember({ [key]: value })}
              />
            ))}
            <label className={formStyles.field}>
              <span className={formStyles.label}>{t('providersPage.nativeKey.location')}</span>
              <input
                className={formStyles.input}
                value={member.openapiLocation ?? ''}
                disabled={disabled}
                onChange={(event) => setMember({ openapiLocation: event.target.value })}
              />
            </label>
          </FormDisclosure>
        ) : null}

        <ProviderBehaviorEditor
          brand={brand}
          value={member}
          onChange={(patch) => setMember(patch)}
          disabled={disabled}
        />
        {!compatible ? (
          <ConnectionPoolEditor
            value={shared.connectionPool}
            onChange={(connectionPool) => setShared({ connectionPool })}
            disabled={disabled}
          />
        ) : null}
        <RuntimePolicyEditor
          value={shared.runtimePolicy ?? readRuntimePolicy()}
          onChange={(runtimePolicy) => setShared({ runtimePolicy })}
          disabled={disabled}
          supportsErrors={descriptor.supportsRequestScopedErrors}
        />
      </div>
    </div>
  );
}

/** An OpenAI-compatible entry's keys: each one's proxy and weight (the keys themselves stay masked). */
function CompatibleKeys({
  entries,
  replaceable,
  disabled,
  onChange,
}: {
  entries: ApiKeyEntryInput[];
  /** Stored keys can be replaced (managing an entry); a new one is typed above (adding). */
  replaceable: boolean;
  disabled: boolean;
  onChange: (entries: ApiKeyEntryInput[]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const rows = entries.length ? entries : [{ apiKey: '', proxyUrl: '' }];
  const update = (index: number, patch: Partial<ApiKeyEntryInput>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className={formStyles.field} role="group" aria-labelledby={`${id}-keys`}>
      <span className={formStyles.label} id={`${id}-keys`}>
        {rows.length > 1
          ? t('provimux.accounts.settings.compat_keys')
          : t('provimux.accounts.settings.compat_key_single')}
      </span>
      <div className={styles.compatKeys}>
        {rows.map((row, index) => {
          const stored = row.existingApiKey?.trim();
          const name = stored
            ? maskApiKey(stored)
            : t('provimux.accounts.settings.compat_key_new', { index: index + 1 });
          return (
            <div key={index} className={styles.compatKey} data-replace={(replaceable && stored) || undefined}>
              {rows.length > 1 ? <span className={styles.compatKeyName}>{name}</span> : null}
              {replaceable && stored ? (
                <input
                  className={formStyles.input}
                  type="password"
                  defaultValue=""
                  autoComplete="new-password"
                  spellCheck={false}
                  data-1p-ignore="true"
                  data-lpignore="true"
                  placeholder={t('provimux.accounts.settings.replace_key_placeholder')}
                  aria-label={`${t('provimux.accounts.settings.replace_key')} · ${name}`}
                  disabled={disabled}
                  onChange={(event) => update(index, { apiKey: event.target.value })}
                />
              ) : null}
              <input
                className={formStyles.input}
                value={row.proxyUrl}
                placeholder="http://127.0.0.1:7890"
                spellCheck={false}
                aria-label={`${t('provimux.accounts.settings.proxy')} · ${name}`}
                disabled={disabled}
                onChange={(event) => update(index, { proxyUrl: event.target.value })}
              />
              <input
                className={`${formStyles.input} ${styles.compatWeight}`}
                type="number"
                step={1}
                max={MAX_CREDENTIAL_WEIGHT}
                placeholder={t('provimux.accounts.settings.weight')}
                value={row.weight ?? ''}
                aria-label={`${t('provimux.accounts.settings.weight')} · ${name}`}
                disabled={disabled}
                onChange={(event) => update(index, { weight: numberOrUndefined(event.target.value) })}
              />
            </div>
          );
        })}
      </div>
      <p className={formStyles.sectionDesc}>
        {replaceable
          ? `${t('provimux.accounts.settings.compat_keys_hint')} ${t('provimux.accounts.settings.replace_key_hint')}`
          : t('provimux.accounts.settings.compat_keys_hint')}
      </p>
    </div>
  );
}

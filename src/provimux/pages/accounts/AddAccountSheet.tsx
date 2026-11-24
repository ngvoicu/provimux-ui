import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  IconChevronLeft,
  IconFileText,
  IconKey,
  IconLock,
  IconSidebarOauth,
} from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Sheet } from '@/components/ui/Sheet';
import { OAUTH_PROVIDERS } from '@/features/oauth/providers';
import {
  checkLoginProxyUrl,
  maskProxyUrl,
  shouldShowLoginProxyError,
} from '@/features/oauth/loginProxy';
import type { NativeProviderFamily } from '@/services/api/providers';
import { keyIssuerLabel, serviceLabel } from './labels';
import { SERVICES, serviceById, type Service } from './services';
import { validBaseUrl, type NewKey } from './keyWrites';
import { ServiceIcon } from './ServiceIcon';
import { firstStep, stepOf, waysOf, type Start, type Step, type Way } from './addSteps';
import { AdvancedSettings } from './AdvancedSettings';
import { KeySettingsFields } from './KeySettingsFields';
import {
  draftProblem,
  joiningDraft,
  newCompatibleDraft,
  newNativeDraft,
  retargeted,
  settingsTouched,
  summaryOf,
  withTyped,
  type KeyDraft,
} from './keySettings';
import { settingsStatus } from './settingsSummary';
import styles from './AccountsPage.module.scss';

/** A sign-in flow a plugin adds (OAuth Login lists it the same way): a service of its own. */
export interface PluginFlow {
  id: string;
  title: string;
}

/** OAuth Login's proxy for new logins (its `useOAuthFlows` state). */
export interface LoginProxy {
  value: string;
  rejected: string | null;
  onChange: (value: string) => void;
}

export interface AddAccountSheetProps {
  open: boolean;
  /** A service to start on (the "+" of its group, or `?add=<service>`). */
  initialService: string | null;
  pluginFlows: readonly PluginFlow[];
  /** The configuration as read (new connections are named after what is there). */
  document: unknown;
  loginProxy: LoginProxy;
  onClose: () => void;
  /** Starts a sign-in flow (the add sheet closes; the sign-in dialog opens). */
  onSignIn: (flow: string, service: string) => void;
  /** OAuth Login's Vertex service account import. */
  onServiceAccount: () => void;
  /** OAuth Login's Sign in with ChatGPT binding. */
  onSiwc: () => void;
  /**
   * Resolves true when the key was written: with `settings` null as Accounts writes a key, else with AI
   * Providers' own save of the settings.
   */
  onAddKey: (service: string, input: NewKey, settings: KeyDraft | null) => Promise<boolean>;
}

/**
 * Adding an account (design accounts-page.md, section 5): the service first, then how, when it has several
 * ways in (a subscription, an API key, a service account file, Sign in with ChatGPT). A subscription signs
 * in with OAuth Login's own flow; a key is pasted and written where AI Providers writes it. What else can
 * be set waits under "Advanced settings", closed.
 */
export function AddAccountSheet(props: AddAccountSheetProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ kind: 'service' });

  const start = (next: Step | Start, service: Service) => {
    if (next.kind === 'sign-in') props.onSignIn(next.flow, service.id);
    else if (next.kind === 'service-account') props.onServiceAccount();
    else if (next.kind === 'siwc') props.onSiwc();
    else setStep(next);
  };

  const choose = (id: string) => {
    const service = serviceById(id);
    if (!service) {
      props.onSignIn(id, `login:${id}`);
      return;
    }
    start(firstStep(service), service);
  };

  useEffect(() => {
    if (!props.open) return;
    const service = props.initialService ? serviceById(props.initialService) : undefined;
    const next = service ? firstStep(service) : null;
    // A service with one way that starts at once: show the services with it ready, rather than leave.
    setStep(next && 'service' in next ? next : { kind: 'service' });
  }, [props.open, props.initialService]);

  const back = () => setStep({ kind: 'service' });
  const title =
    step.kind === 'service'
      ? t('provimux.accounts.add_title')
      : step.kind === 'how'
        ? t('provimux.accounts.add_how', { service: serviceLabel(t, step.service) })
        : step.kind === 'site'
          ? t('provimux.accounts.add_site', { service: serviceLabel(t, step.service) })
          : serviceById(step.service)?.key?.custom
            ? t('provimux.accounts.add_key_heading_custom')
            : t('provimux.accounts.add_key_heading', { service: keyIssuerLabel(t, step.service) });
  const signsIn =
    step.kind === 'service' ||
    step.kind === 'site' ||
    (step.kind === 'how' && waysOf(serviceById(step.service)!).includes('sub'));

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      size="md"
      viewKey={`${step.kind}:${'service' in step ? step.service : ''}`}
      eyebrow={step.kind === 'service' ? undefined : t('provimux.accounts.add_title')}
      title={title}
      description={step.kind === 'service' ? t('provimux.accounts.add_lede') : undefined}
    >
      {step.kind !== 'service' ? (
        <button type="button" className={styles.back} onClick={back}>
          <IconChevronLeft size={14} />
          {t('provimux.accounts.back')}
        </button>
      ) : null}

      {step.kind === 'service' ? (
        <ServicePicker pluginFlows={props.pluginFlows} onChoose={choose} />
      ) : null}

      {step.kind === 'how' ? (
        <WayChoices
          service={serviceById(step.service)!}
          onChoose={(way) => {
            const service = serviceById(step.service)!;
            start(stepOf(service, way), service);
          }}
        />
      ) : null}

      {step.kind === 'site' ? (
        <div className={styles.choices}>
          {serviceById(step.service)!.signIn.map((flow) => {
            const card = OAUTH_PROVIDERS.find((provider) => provider.id === flow);
            return (
              <button
                key={flow}
                type="button"
                className={styles.choice}
                onClick={() => props.onSignIn(flow, step.service)}
              >
                <ServiceIcon service={step.service} />
                <span className={styles.choiceText}>
                  <span className={styles.choiceTitle}>{card?.domain ?? flow}</span>
                  <span className={styles.choiceCaption}>
                    {card?.sponsor ? t(card.sponsor.siteKey) : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {signsIn ? <SignInAdvanced proxy={props.loginProxy} /> : null}

      {step.kind === 'key' ? (
        <KeyForm
          key={step.service}
          service={serviceById(step.service)!}
          document={props.document}
          onSubmit={(input, settings) => props.onAddKey(step.service, input, settings)}
          onCancel={props.onClose}
        />
      ) : null}
    </Sheet>
  );
}

/** A service's tile caption: the ways it comes in, in a few words. */
function waysCaption(t: (key: string) => string, service: Service): string {
  if (service.id === 'compatible') return t('provimux.accounts.compatible_hint');
  return waysOf(service)
    .map((way) => t(`provimux.accounts.way.${way.replace('-', '_')}`))
    .join(' · ');
}

function ServicePicker({
  pluginFlows,
  onChoose,
}: {
  pluginFlows: readonly PluginFlow[];
  onChoose: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.servicePicker}>
      {SERVICES.filter((service) => service.offered).map((service) => (
        <button
          key={service.id}
          type="button"
          className={styles.serviceTile}
          data-wide={service.id === 'compatible' || undefined}
          onClick={() => onChoose(service.id)}
        >
          <ServiceIcon service={service.id} />
          <span className={styles.choiceText}>
            <span className={styles.choiceTitle}>{serviceLabel(t, service.id)}</span>
            <span className={styles.choiceCaption}>{waysCaption(t, service)}</span>
          </span>
        </button>
      ))}
      {pluginFlows.map((flow) => (
        <button
          key={flow.id}
          type="button"
          className={styles.serviceTile}
          onClick={() => onChoose(flow.id)}
        >
          <ServiceIcon service={`login:${flow.id}`} provider={flow.id} />
          <span className={styles.choiceText}>
            <span className={styles.choiceTitle}>{flow.title}</span>
            <span className={styles.choiceCaption}>{t('provimux.accounts.way.sub')}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const WAY_ICON: Record<Way, ReactNode> = {
  sub: <IconSidebarOauth size={18} />,
  key: <IconKey size={18} />,
  'service-account': <IconFileText size={18} />,
  siwc: <IconLock size={18} />,
};
const WAY_ACCESS: Record<Way, string> = {
  sub: 'sub',
  key: 'api',
  'service-account': 'sub',
  siwc: 'sub',
};

function WayChoices({ service, onChoose }: { service: Service; onChoose: (way: Way) => void }) {
  const { t } = useTranslation();
  const name = serviceLabel(t, service.id);
  const text: Record<Way, { title: string; caption: string }> = {
    sub: {
      title: t('provimux.accounts.add_sub_title'),
      caption: t('provimux.accounts.add_sub_text', { service: name }),
    },
    key: {
      title: t('provimux.accounts.add_key_title'),
      caption: t('provimux.accounts.add_key_text', { service: keyIssuerLabel(t, service.id) }),
    },
    'service-account': {
      title: t('provimux.accounts.add_file_title'),
      caption: t('provimux.accounts.add_file_text'),
    },
    siwc: {
      title: t('provimux.accounts.add_siwc_title'),
      caption: t('provimux.accounts.add_siwc_text'),
    },
  };
  return (
    <div className={styles.choices}>
      {waysOf(service).map((way) => (
        <button key={way} type="button" className={styles.choice} onClick={() => onChoose(way)}>
          <span className={styles.choiceIcon} data-access={WAY_ACCESS[way]}>
            {WAY_ICON[way]}
          </span>
          <span className={styles.choiceText}>
            <span className={styles.choiceTitle}>{text[way].title}</span>
            <span className={styles.choiceCaption}>{text[way].caption}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** The login proxy of OAuth Login, as the advanced option of a sign-in. */
function SignInAdvanced({ proxy }: { proxy: LoginProxy }) {
  const { t } = useTranslation();
  const id = useId();
  const [touched, setTouched] = useState(false);
  const check = checkLoginProxyUrl(proxy.value);
  const showError = shouldShowLoginProxyError(proxy.value, {
    touched,
    rejectedValue: proxy.rejected,
  });
  const status =
    check.kind === 'empty'
      ? null
      : check.kind === 'invalid' || showError
        ? t('auth_login.login_proxy_status_invalid')
        : t('provimux.accounts.signin_proxy_status', {
            proxy: maskProxyUrl(check.kind === 'valid' ? check.url : proxy.value),
          });
  return (
    <div className={styles.signInAdvanced}>
      <AdvancedSettings
        caption={t('provimux.accounts.signin_advanced_caption')}
        status={status}
        defaultOpen={proxy.rejected !== null}
      >
        <div className={styles.keyForm}>
          <Input
            id={id}
            label={t('provimux.accounts.signin_proxy_label')}
            placeholder={t('auth_login.login_proxy_placeholder')}
            value={proxy.value}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            error={showError ? t('auth_login.login_proxy_invalid') : undefined}
            onBlur={() => setTouched(true)}
            onChange={(event) => proxy.onChange(event.target.value)}
          />
          <p className={styles.fieldHint}>{t('provimux.accounts.signin_proxy_hint')}</p>
        </div>
      </AdvancedSettings>
    </div>
  );
}

const GOOGLE_APIS: readonly NativeProviderFamily[] = ['gemini', 'interactions'];

function KeyForm({
  service,
  document,
  onSubmit,
  onCancel,
}: {
  service: Service;
  document: unknown;
  onSubmit: (input: NewKey, settings: KeyDraft | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const target = service.key!;
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const custom = target.custom === true;

  // Built once, when the form opens (it is keyed by the service): a read of the configuration while the
  // owner types must not reset what he set.
  const [draft, setDraft] = useState<KeyDraft>(() => {
    if (target.family !== 'openai-compatibility') {
      return newNativeDraft(document, target.family, target.baseUrl);
    }
    if (custom) return newCompatibleDraft('', '');
    return (
      joiningDraft(document, target.baseUrl!) ??
      newCompatibleDraft(target.entryName ?? 'compatible', target.baseUrl!)
    );
  });

  const keyError = tried && !apiKey.trim() ? t('provimux.accounts.invalid_key') : undefined;
  const nameError = custom && tried && !name.trim() ? t('provimux.accounts.invalid_name') : undefined;
  const urlError =
    custom && tried && !validBaseUrl(baseUrl) ? t('provimux.accounts.invalid_url') : undefined;
  const googleApi =
    draft.kind === 'native' && GOOGLE_APIS.includes(draft.family) && service.id === 'gemini';
  const joining = draft.kind === 'compatible' && draft.resource !== null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!apiKey.trim() || (custom && (!name.trim() || !validBaseUrl(baseUrl)))) return;
    const typed = withTyped(draft, { apiKey, name, baseUrl });
    const ownFamily = draft.kind === 'native' && draft.family !== target.family;
    const settings = settingsTouched(typed) || ownFamily ? typed : null;
    if (settings) {
      const issue = draftProblem(settings);
      if (issue) {
        setProblem(t(issue.key, issue.values));
        return;
      }
    }
    setProblem(null);
    setSaving(true);
    try {
      await onSubmit(custom ? { apiKey, name, baseUrl } : { apiKey }, settings);
    } finally {
      setSaving(false);
    }
  };

  const note =
    service.id === 'openrouter'
      ? t('provimux.accounts.openrouter_note')
      : custom
        ? t('provimux.accounts.compatible_note')
        : null;
  const summary = settingsStatus(t, summaryOf(draft), settingsTouched(draft));

  return (
    <form className={styles.keyForm} onSubmit={(event) => void submit(event)} noValidate>
      {custom ? (
        <>
          <Input
            label={t('provimux.accounts.name_label')}
            placeholder={t('provimux.accounts.name_placeholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={nameError}
            autoComplete="off"
          />
          <Input
            label={t('provimux.accounts.base_url_label')}
            placeholder="https://api.example.com/v1"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            error={urlError}
            autoComplete="off"
            inputMode="url"
          />
        </>
      ) : null}
      <Input
        label={t('provimux.accounts.key_label')}
        placeholder={t('provimux.accounts.key_placeholder')}
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        error={keyError}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        note={t('provimux.accounts.key_note')}
      />
      {note ? <p className={styles.fieldHint}>{note}</p> : null}

      <AdvancedSettings
        caption={t(
          draft.kind === 'native' && draft.family === 'claude'
            ? 'provimux.accounts.settings.caption_claude'
            : 'provimux.accounts.settings.caption_key'
        )}
        status={summary}
      >
        {googleApi && draft.kind === 'native' ? (
          <div className={styles.googleApi}>
            <Select
              value={draft.family}
              ariaLabel={t('provimux.accounts.settings.google_api')}
              options={[
                { value: 'gemini', label: t('provimux.accounts.settings.google_api_gemini') },
                {
                  value: 'interactions',
                  label: t('provimux.accounts.settings.google_api_interactions'),
                },
              ]}
              onChange={(value) =>
                setDraft(retargeted(document, draft, value as NativeProviderFamily))
              }
            />
            <p className={styles.fieldHint}>{t('provimux.accounts.settings.google_api_hint')}</p>
          </div>
        ) : null}
        {joining ? (
          <p className={styles.sharedNote}>
            {t('provimux.accounts.settings.joining_note', { service: serviceLabel(t, service.id) })}
          </p>
        ) : null}
        <KeySettingsFields
          draft={withTyped(draft, { apiKey, name, baseUrl })}
          onChange={setDraft}
          service={
            custom ? name.trim() || t('provimux.accounts.settings.the_provider') : keyIssuerLabel(t, service.id)
          }
          mode="add"
          disabled={saving}
        />
      </AdvancedSettings>

      {problem ? (
        <div className={styles.formProblem} role="alert">
          {problem}
        </div>
      ) : null}
      <div className={styles.formActions}>
        <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
          {t('provimux.accounts.cancel')}
        </Button>
        <Button size="sm" type="submit" loading={saving}>
          {t('provimux.accounts.add_key_save')}
        </Button>
      </div>
    </form>
  );
}

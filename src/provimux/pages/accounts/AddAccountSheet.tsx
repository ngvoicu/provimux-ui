import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { IconChevronLeft, IconKey, IconSidebarOauth } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { OAUTH_PROVIDERS } from '@/features/oauth/providers';
import { keyIssuerLabel, serviceLabel } from './labels';
import { SERVICES, serviceById, type Service } from './services';
import { validBaseUrl, type NewKey } from './keyWrites';
import { ServiceIcon } from './ServiceIcon';
import { firstStep, type Step } from './addSteps';
import styles from './AccountsPage.module.scss';

/** A sign-in flow a plugin adds (OAuth Login lists it the same way): a service of its own. */
export interface PluginFlow {
  id: string;
  title: string;
}

export interface AddAccountSheetProps {
  open: boolean;
  /** A service to start on (the "+" of its group, or `?add=<service>`). */
  initialService: string | null;
  pluginFlows: readonly PluginFlow[];
  onClose: () => void;
  /** Starts a sign-in flow (the add sheet closes; the sign-in dialog opens). */
  onSignIn: (flow: string, service: string) => void;
  /** Resolves true when the key was written. */
  onAddKey: (service: string, input: NewKey) => Promise<boolean>;
}

/**
 * Adding an account (design accounts-page.md, section 5): the service first, then, where it takes both, a
 * subscription or an API key. A subscription signs in with OAuth Login's own flow; a key is pasted and
 * written where AI Providers writes it.
 */
export function AddAccountSheet(props: AddAccountSheetProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ kind: 'service' });

  const choose = (id: string) => {
    const service = serviceById(id);
    if (!service) {
      props.onSignIn(id, `login:${id}`);
      return;
    }
    const next = firstStep(service);
    if (next.kind === 'sign-in') props.onSignIn(next.flow, service.id);
    else setStep(next);
  };

  useEffect(() => {
    if (!props.open) return;
    const service = props.initialService ? serviceById(props.initialService) : undefined;
    if (!service) {
      setStep({ kind: 'service' });
      return;
    }
    const next = firstStep(service);
    // One sign-in only: show the choice of services with it ready, rather than leave at once.
    setStep(next.kind === 'sign-in' ? { kind: 'service' } : next);
  }, [props.open, props.initialService]);

  const back = () => setStep({ kind: 'service' });
  const title =
    step.kind === 'service'
      ? t('provimux.accounts.add_title')
      : step.kind === 'how'
        ? t('provimux.accounts.add_how', { service: serviceLabel(t, step.service) })
        : step.kind === 'site'
          ? t('provimux.accounts.add_site', { service: serviceLabel(t, step.service) })
          : t('provimux.accounts.add_key_heading', { service: keyIssuerLabel(t, step.service) });

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
        <div className={styles.choices}>
          <button
            type="button"
            className={styles.choice}
            onClick={() => {
              const service = serviceById(step.service)!;
              if (service.signIn.length > 1) setStep({ kind: 'site', service: service.id });
              else props.onSignIn(service.signIn[0], service.id);
            }}
          >
            <span className={styles.choiceIcon} data-access="sub">
              <IconSidebarOauth size={18} />
            </span>
            <span className={styles.choiceText}>
              <span className={styles.choiceTitle}>{t('provimux.accounts.add_sub_title')}</span>
              <span className={styles.choiceCaption}>
                {t('provimux.accounts.add_sub_text', { service: serviceLabel(t, step.service) })}
              </span>
            </span>
          </button>
          <button
            type="button"
            className={styles.choice}
            onClick={() => setStep({ kind: 'key', service: step.service })}
          >
            <span className={styles.choiceIcon} data-access="api">
              <IconKey size={18} />
            </span>
            <span className={styles.choiceText}>
              <span className={styles.choiceTitle}>{t('provimux.accounts.add_key_title')}</span>
              <span className={styles.choiceCaption}>
                {t('provimux.accounts.add_key_text', { service: keyIssuerLabel(t, step.service) })}
              </span>
            </span>
          </button>
        </div>
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

      {step.kind === 'key' ? (
        <KeyForm
          service={serviceById(step.service)!}
          onSubmit={(input) => props.onAddKey(step.service, input)}
          onCancel={props.onClose}
        />
      ) : null}
    </Sheet>
  );
}

function ServicePicker({
  pluginFlows,
  onChoose,
}: {
  pluginFlows: readonly PluginFlow[];
  onChoose: (id: string) => void;
}) {
  const { t } = useTranslation();
  const caption = (service: Service) =>
    service.signIn.length && service.key
      ? t('provimux.accounts.kind_both')
      : service.signIn.length
        ? t('provimux.accounts.kind_sub')
        : t('provimux.accounts.kind_key');
  return (
    <>
      <div className={styles.servicePicker}>
        {SERVICES.filter((service) => service.offered).map((service) => (
          <button
            key={service.id}
            type="button"
            className={styles.serviceTile}
            onClick={() => onChoose(service.id)}
          >
            <ServiceIcon service={service.id} />
            <span className={styles.choiceText}>
              <span className={styles.choiceTitle}>{serviceLabel(t, service.id)}</span>
              <span className={styles.choiceCaption}>{caption(service)}</span>
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
              <span className={styles.choiceCaption}>{t('provimux.accounts.kind_sub')}</span>
            </span>
          </button>
        ))}
      </div>
      <p className={styles.fieldHint}>
        {t('provimux.accounts.add_other_ways')}{' '}
        <Link to="/oauth" className={styles.inlineLink}>
          {t('provimux.accounts.add_other_ways_link')}
        </Link>
      </p>
    </>
  );
}

function KeyForm({
  service,
  onSubmit,
  onCancel,
}: {
  service: Service;
  onSubmit: (input: NewKey) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const custom = service.key?.custom === true;
  const keyError = tried && !apiKey.trim() ? t('provimux.accounts.invalid_key') : undefined;
  const nameError = custom && tried && !name.trim() ? t('provimux.accounts.invalid_name') : undefined;
  const urlError =
    custom && tried && !validBaseUrl(baseUrl) ? t('provimux.accounts.invalid_url') : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!apiKey.trim() || (custom && (!name.trim() || !validBaseUrl(baseUrl)))) return;
    setSaving(true);
    try {
      await onSubmit(custom ? { apiKey, name, baseUrl } : { apiKey });
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

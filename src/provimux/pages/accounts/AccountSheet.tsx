import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconChevronLeft, IconExternalLink, IconTrash2 } from '@/components/ui/icons';
import { Sheet } from '@/components/ui/Sheet';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { AuthFileFieldsPatch } from '@/services/api/authFiles';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { AccessBadge } from '../shared/AccessBadge';
import type { Account } from './accounts';
import { fixOf, keyIssuerLabel, serviceLabel, stateLabel } from './labels';
import { parsePriority, statusSentence } from './sheetLogic';
import { ServiceIcon } from './ServiceIcon';
import { KeySettingsFields } from './KeySettingsFields';
import { LoginSettingsFields } from './LoginSettingsFields';
import {
  draftChanged,
  draftOf,
  draftProblem,
  locateKey,
  summaryOf,
  type KeyDraft,
} from './keySettings';
import {
  loginChanged,
  loginDraftOf,
  loginPatch,
  loginProblem,
  type LoginDraft,
} from './loginSettings';
import { settingsStatus } from './settingsSummary';
import styles from './AccountsPage.module.scss';

export interface AccountSheetProps {
  account: Account | null;
  open: boolean;
  nowMs: number;
  serverNowMs: number;
  busy: boolean;
  /** The configuration as read: a key's settings are read from it. */
  document: unknown;
  /** A subscription's entry of the login list (never its file's content). */
  file: AuthFileItem | null;
  onClose: () => void;
  onToggle: (account: Account, on: boolean) => void;
  onFix: (account: Account) => void;
  onTryNow: (account: Account) => void;
  /** Resolves true when the priority was saved. */
  onSavePriority: (account: Account, value: number) => Promise<boolean>;
  /** Resolves true when the settings were saved. */
  onSaveKeySettings: (account: Account, draft: KeyDraft) => Promise<boolean>;
  onSaveLoginSettings: (account: Account, patch: AuthFileFieldsPatch) => Promise<boolean>;
  /** OAuth Login's Sign in with ChatGPT binding. */
  onSiwc: () => void;
  onRemove: (account: Account) => void;
  onShowModels: (account: Account) => void;
  onMoreSettings: (account: Account) => void;
}

type Settings =
  | { kind: 'key'; draft: KeyDraft }
  | { kind: 'login'; file: AuthFileItem; draft: LoginDraft }
  | { kind: 'none' };

/**
 * One account, managed (design accounts-page.md, section 4): what its state means and the fix for it, on or
 * off, its priority, its settings (a view of its own, every setting the original pages have), the models it
 * serves, what is still only on the original page, and removing it.
 */
export function AccountSheet(props: AccountSheetProps) {
  const { t, i18n } = useTranslation();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const { account } = props;
  const priorityId = useId();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'overview' | 'settings'>('overview');
  const [settings, setSettings] = useState<Settings>({ kind: 'none' });
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (account) setText(String(account.priority));
  }, [account?.id, account?.priority]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another account, or the panel closed: back to the overview.
  useEffect(() => {
    setView('overview');
    setProblem(null);
  }, [account?.id, props.open]);

  /** The settings as stored now (the configuration and the login list as last read). */
  const stored = useMemo<Settings>(() => {
    if (!account) return { kind: 'none' };
    if (account.kind === 'sub') {
      return props.file ? { kind: 'login', file: props.file, draft: loginDraftOf(props.file) } : { kind: 'none' };
    }
    const located = locateKey(props.document, account.entry);
    return located ? { kind: 'key', draft: draftOf(located) } : { kind: 'none' };
  }, [account, props.document, props.file]);

  const dirty =
    view === 'settings' &&
    ((settings.kind === 'key' && draftChanged(settings.draft)) ||
      (settings.kind === 'login' && loginChanged(settings.file, settings.draft)));

  const confirmDiscard = useCallback(
    (): Promise<boolean> =>
      dirty
        ? new Promise((resolve) =>
            showConfirmation({
              title: t('providersPage.unsavedChanges.title'),
              message: t('providersPage.unsavedChanges.message'),
              variant: 'danger',
              confirmText: t('providersPage.unsavedChanges.discard'),
              cancelText: t('providersPage.unsavedChanges.keepEditing'),
              onConfirm: () => resolve(true),
              onCancel: () => resolve(false),
            })
          )
        : Promise.resolve(true),
    [dirty, showConfirmation, t]
  );

  if (!account) return <Sheet open={false} onClose={props.onClose} />;

  const service = serviceLabel(t, account.service);
  const parsed = parsePriority(text);
  const changed = parsed !== null && parsed !== account.priority;
  const nowMs = account.kind === 'sub' ? props.nowMs : props.serverNowMs;
  const fix = fixOf(account);
  const switchable = !(account.kind === 'sub' && account.runtimeOnly);
  const removable = switchable;

  const save = async () => {
    if (parsed === null || !changed) return;
    setSaving(true);
    try {
      await props.onSavePriority(account, parsed);
    } finally {
      setSaving(false);
    }
  };
  const step = (delta: number) => {
    const base = parsePriority(text) ?? account.priority;
    setText(String(base + delta));
  };

  const openSettings = () => {
    setSettings(stored);
    setProblem(null);
    setView('settings');
  };
  const leaveSettings = () =>
    void confirmDiscard().then((ok) => {
      if (ok) setView('overview');
    });

  const saveSettings = async () => {
    let ok = false;
    if (settings.kind === 'key') {
      const issue = draftProblem(settings.draft);
      if (issue) {
        setProblem(t(issue.key, issue.values));
        return;
      }
      setProblem(null);
      setSaving(true);
      try {
        ok = await props.onSaveKeySettings(account, settings.draft);
      } finally {
        setSaving(false);
      }
    } else if (settings.kind === 'login') {
      const issue = loginProblem(settings.draft);
      if (issue) {
        setProblem(t(issue));
        return;
      }
      setProblem(null);
      setSaving(true);
      try {
        ok = await props.onSaveLoginSettings(account, loginPatch(settings.file, settings.draft));
      } finally {
        setSaving(false);
      }
    }
    if (ok) setView('overview');
  };

  const header = {
    eyebrow: (
      <span className={styles.sheetEyebrow}>
        <ServiceIcon service={account.service} provider={account.provider} />
        {view === 'settings' ? t('provimux.accounts.settings.eyebrow', { service }) : service}
      </span>
    ),
    title: account.who,
    description: (
      <span className={styles.sheetDescription}>
        <AccessBadge access={account.kind} kind={null} />
        {account.kind === 'api' && account.detail ? (
          <span className={styles.mono}>{account.detail}</span>
        ) : null}
        {account.kind === 'api' && account.entryName ? (
          <span className={styles.mono}>{account.entryName}</span>
        ) : null}
      </span>
    ),
  };

  if (view === 'settings') {
    const changedNow = dirty;
    return (
      <Sheet
        open={props.open}
        onClose={props.onClose}
        size="lg"
        viewKey={`${account.id}:settings`}
        {...header}
        confirmClose={confirmDiscard}
        closeDisabled={saving}
        footer={
          <div className={styles.sheetFooter}>
            <Button variant="secondary" size="sm" onClick={leaveSettings} disabled={saving}>
              {t('provimux.accounts.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => void saveSettings()}
              disabled={!changedNow || props.busy}
              loading={saving}
            >
              {t('provimux.accounts.settings.save')}
            </Button>
          </div>
        }
      >
        <button type="button" className={styles.back} onClick={leaveSettings}>
          <IconChevronLeft size={14} />
          {t('provimux.accounts.settings.back')}
        </button>
        {settings.kind === 'key' ? (
          <KeySettingsFields
            draft={settings.draft}
            onChange={(draft) => setSettings({ kind: 'key', draft })}
            service={keyIssuerLabel(t, account.service)}
            mode="edit"
            disabled={saving || props.busy}
          />
        ) : settings.kind === 'login' ? (
          <LoginSettingsFields
            draft={settings.draft}
            onChange={(draft) => setSettings({ ...settings, draft })}
            disabled={saving || props.busy}
            onOpenOriginal={() =>
              void confirmDiscard().then((ok) => {
                if (ok) props.onMoreSettings(account);
              })
            }
          />
        ) : (
          <p className={styles.fieldHint}>{t('provimux.accounts.settings.partner')}</p>
        )}
        {problem ? (
          <div className={styles.formProblem} role="alert">
            {problem}
          </div>
        ) : null}
      </Sheet>
    );
  }

  const summary =
    stored.kind === 'key'
      ? settingsStatus(t, summaryOf(stored.draft), true, true)
      : stored.kind === 'login'
        ? loginSummary(t, stored.draft)
        : null;
  const siwc = account.kind === 'sub' && props.file ? siwcState(props.file) : null;

  return (
    <Sheet open={props.open} onClose={props.onClose} size="md" viewKey={account.id} {...header}>
      <div className={styles.sheetBody} aria-busy={props.busy || undefined}>
        <section className={styles.statusCard} data-state={account.reading.state}>
          <div className={styles.statusHead}>
            <span className={styles.stateDot} data-state={account.reading.state} aria-hidden="true" />
            <span className={styles.statusWord}>{stateLabel(t, account)}</span>
          </div>
          <p className={styles.statusText}>{statusSentence(t, account, i18n.language, nowMs)}</p>
          {fix || (account.kind === 'sub' && account.reading.state === 'cooling') ? (
            <div className={styles.statusActions}>
              {fix ? (
                <Button size="sm" disabled={props.busy} onClick={() => props.onFix(account)}>
                  {fix === 'sign-in'
                    ? t('provimux.accounts.fix.sign_in')
                    : t('provimux.accounts.fix.replace')}
                </Button>
              ) : null}
              {account.kind === 'sub' &&
              account.reading.state === 'cooling' &&
              account.authIndexes.length ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={props.busy}
                  onClick={() => props.onTryNow(account)}
                >
                  {t('provimux.accounts.fix.try_now')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {account.kind === 'sub' && account.reading.state === 'cooling' ? (
            <p className={styles.fieldHint}>{t('provimux.accounts.sheet.try_now_hint')}</p>
          ) : null}
        </section>

        {switchable ? (
          <section className={styles.sheetSection}>
            <div className={styles.sheetRow}>
              <div>
                <h3 className={styles.sheetHeading}>{t('provimux.accounts.sheet.on_heading')}</h3>
                <p className={styles.fieldHint}>{t('provimux.accounts.sheet.on_hint')}</p>
              </div>
              <ToggleSwitch
                checked={account.reading.state !== 'off'}
                disabled={props.busy}
                onChange={(on) => props.onToggle(account, on)}
                ariaLabel={t('provimux.accounts.sheet.on_heading')}
              />
            </div>
          </section>
        ) : (
          <p className={styles.fieldHint}>{t('provimux.accounts.sheet.runtime_only')}</p>
        )}

        {switchable ? (
          <section className={styles.sheetSection}>
            <label className={styles.sheetHeading} htmlFor={priorityId}>
              {t('provimux.accounts.sheet.priority_heading')}
            </label>
            <div className={styles.priorityField}>
              <button
                type="button"
                className={styles.stepper}
                onClick={() => step(-1)}
                aria-label={t('provimux.accounts.sheet.priority_down')}
                disabled={props.busy || saving}
              >
                <span aria-hidden="true">−</span>
              </button>
              <input
                id={priorityId}
                className={styles.priorityInput}
                value={text}
                inputMode="numeric"
                aria-invalid={parsed === null || undefined}
                aria-describedby={`${priorityId}-hint`}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void save();
                }}
                disabled={props.busy || saving}
              />
              <button
                type="button"
                className={styles.stepper}
                onClick={() => step(1)}
                aria-label={t('provimux.accounts.sheet.priority_up')}
                disabled={props.busy || saving}
              >
                <span aria-hidden="true">+</span>
              </button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void save()}
                disabled={!changed || props.busy}
                loading={saving}
              >
                {t('provimux.accounts.sheet.priority_save')}
              </Button>
            </div>
            <p className={styles.fieldHint} id={`${priorityId}-hint`}>
              {parsed === null
                ? t('provimux.accounts.sheet.priority_invalid')
                : t('provimux.accounts.sheet.priority_hint')}
            </p>
            {account.kind === 'api' && account.priorityFrom === 'group' ? (
              <p className={styles.fieldHint}>
                {t('provimux.accounts.sheet.priority_from_group', { value: account.priority })}
              </p>
            ) : null}
          </section>
        ) : null}

        {switchable ? (
          <section className={styles.sheetSection}>
            <div className={styles.sheetRow}>
              <div className={styles.settingsSummary}>
                <h3 className={styles.sheetHeading}>{t('provimux.accounts.settings.heading')}</h3>
                <p className={styles.fieldHint}>
                  {account.kind === 'sub'
                    ? t('provimux.accounts.settings.lede_login')
                    : t('provimux.accounts.settings.lede_key')}
                </p>
                {summary ? <p className={styles.settingsLine}>{summary}</p> : null}
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={props.busy || stored.kind === 'none'}
                onClick={openSettings}
              >
                {t('provimux.accounts.settings.open')}
              </Button>
            </div>
            {stored.kind === 'none' ? (
              <p className={styles.fieldHint}>{t('provimux.accounts.settings.partner')}</p>
            ) : null}
          </section>
        ) : null}

        {siwc ? (
          <section className={styles.sheetSection}>
            <div className={styles.sheetRow}>
              <div>
                <h3 className={styles.sheetHeading}>{t('provimux.accounts.add_siwc_title')}</h3>
                <p className={styles.fieldHint}>{t(`provimux.accounts.siwc.${siwc}`)}</p>
              </div>
              <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onSiwc}>
                {siwc === 'unbound' ? t('provimux.accounts.siwc.bind') : t('provimux.accounts.siwc.rebind')}
              </Button>
            </div>
          </section>
        ) : null}

        <section className={styles.sheetSection}>
          <h3 className={styles.sheetHeading}>{t('provimux.accounts.sheet.models_heading')}</h3>
          <button type="button" className={styles.sheetLink} onClick={() => props.onShowModels(account)}>
            {t('provimux.accounts.sheet.models_link')}
            <span aria-hidden="true">→</span>
          </button>
          <p className={styles.fieldHint}>{t('provimux.accounts.sheet.models_hint')}</p>
        </section>

        <section className={styles.sheetSection}>
          <h3 className={styles.sheetHeading}>{t('provimux.accounts.sheet.more_heading')}</h3>
          <p className={styles.fieldHint}>
            {account.kind === 'sub'
              ? t('provimux.accounts.sheet.more_login_only')
              : t('provimux.accounts.sheet.more_key_only')}
          </p>
          <button
            type="button"
            className={styles.sheetLink}
            onClick={() => props.onMoreSettings(account)}
          >
            {account.kind === 'sub'
              ? t('provimux.accounts.sheet.more_login')
              : t('provimux.accounts.sheet.more_key')}
            <IconExternalLink size={13} />
          </button>
        </section>

        {removable ? (
          <section className={`${styles.sheetSection} ${styles.danger}`}>
            <Button
              size="sm"
              variant="danger"
              disabled={props.busy}
              onClick={() => props.onRemove(account)}
            >
              <IconTrash2 size={14} />
              {t('provimux.accounts.sheet.remove')}
            </Button>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}

type T = (key: string, options?: Record<string, unknown>) => string;

/** A login's settings in a line: what the list shows of them. */
function loginSummary(t: T, draft: LoginDraft): string {
  const parts: string[] = [];
  if (draft.note.trim()) parts.push(t('provimux.accounts.settings.sum_note', { note: draft.note.trim() }));
  parts.push(
    draft.retry.mode === 'custom'
      ? t('provimux.accounts.settings.sum_retries', { count: Number(draft.retry.value) })
      : t('provimux.accounts.settings.sum_retries_inherit')
  );
  if (draft.websockets) parts.push(t('provimux.accounts.settings.sum_websockets'));
  return parts.join(' · ');
}

/** Sign in with ChatGPT on a ChatGPT login: null when the login cannot be bound. */
function siwcState(file: AuthFileItem): 'active' | 'bound' | 'unbound' | null {
  if (file.siwcBindSupported !== true && file.siwcBound !== true) return null;
  return file.useSiwc && file.siwcBound ? 'active' : file.siwcBound ? 'bound' : 'unbound';
}

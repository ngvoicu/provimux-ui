import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconExternalLink, IconTrash2 } from '@/components/ui/icons';
import { Sheet } from '@/components/ui/Sheet';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { AccessBadge } from '../shared/AccessBadge';
import type { Account } from './accounts';
import { fixOf, serviceLabel, stateLabel } from './labels';
import { parsePriority, statusSentence } from './sheetLogic';
import { ServiceIcon } from './ServiceIcon';
import styles from './AccountsPage.module.scss';

export interface AccountSheetProps {
  account: Account | null;
  open: boolean;
  nowMs: number;
  serverNowMs: number;
  busy: boolean;
  onClose: () => void;
  onToggle: (account: Account, on: boolean) => void;
  onFix: (account: Account) => void;
  onTryNow: (account: Account) => void;
  /** Resolves true when the priority was saved. */
  onSavePriority: (account: Account, value: number) => Promise<boolean>;
  onRemove: (account: Account) => void;
  onShowModels: (account: Account) => void;
  onMoreSettings: (account: Account) => void;
}

/**
 * One account, managed (design accounts-page.md, section 4): what its state means and the fix for it, on or
 * off, its priority, the models it serves, its other settings on the original page, and removing it.
 */
export function AccountSheet(props: AccountSheetProps) {
  const { t, i18n } = useTranslation();
  const { account } = props;
  const priorityId = useId();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (account) setText(String(account.priority));
  }, [account?.id, account?.priority]); // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      size="md"
      viewKey={account.id}
      eyebrow={
        <span className={styles.sheetEyebrow}>
          <ServiceIcon service={account.service} provider={account.provider} />
          {service}
        </span>
      }
      title={account.who}
      description={
        <span className={styles.sheetDescription}>
          <AccessBadge access={account.kind} kind={null} />
          {account.kind === 'api' && account.detail ? (
            <span className={styles.mono}>{account.detail}</span>
          ) : null}
          {account.kind === 'api' && account.entryName ? (
            <span className={styles.mono}>{account.entryName}</span>
          ) : null}
        </span>
      }
    >
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

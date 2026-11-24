import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { KeyAccount } from './accounts';
import { keyIssuerLabel } from './labels';
import styles from './AccountsPage.module.scss';

/** A key replaced by a new one, in place: its priority, models and settings stay (design section 5). */
export function ReplaceKeyDialog({
  account,
  open,
  onClose,
  onReplace,
}: {
  account: KeyAccount | null;
  open: boolean;
  onClose: () => void;
  /** Resolves true when the key was written. */
  onReplace: (account: KeyAccount, apiKey: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue('');
      setTried(false);
    }
  }, [open, account?.id]);

  if (!account) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!value.trim()) return;
    setSaving(true);
    try {
      if (await onReplace(account, value)) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={460}
      title={t('provimux.accounts.replace_title', { service: keyIssuerLabel(t, account.service) })}
    >
      <form className={styles.keyForm} onSubmit={(event) => void submit(event)} noValidate>
        <p className={styles.fieldHint}>
          {t('provimux.accounts.replace_text', { who: account.who, key: account.detail ?? '' })}
        </p>
        <Input
          label={t('provimux.accounts.replace_label')}
          placeholder={t('provimux.accounts.key_placeholder')}
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          error={tried && !value.trim() ? t('provimux.accounts.invalid_key') : undefined}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <div className={styles.formActions}>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            {t('provimux.accounts.cancel')}
          </Button>
          <Button size="sm" type="submit" loading={saving}>
            {t('provimux.accounts.replace_save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

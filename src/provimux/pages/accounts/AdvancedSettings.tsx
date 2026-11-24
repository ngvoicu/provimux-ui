import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconSlidersHorizontal } from '@/components/ui/icons';
import styles from './AccountsPage.module.scss';

export interface AdvancedSettingsProps {
  /** What it holds, in a few words ("Address, proxy, models…"). */
  caption: string;
  /** What is set in it now, shown while closed so a setting is never hidden ("Proxy · 3 models"). */
  status?: string | null;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * "Advanced settings": closed by default so the simple path stays one step, and naming what it holds so it
 * can be found. While closed it says what is set in it, so a proxy cannot be forgotten.
 */
export function AdvancedSettings({ caption, status, defaultOpen = false, children }: AdvancedSettingsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <section className={styles.advanced} data-open={open || undefined}>
      <button
        type="button"
        className={styles.advancedToggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.advancedIcon} aria-hidden="true">
          <IconSlidersHorizontal size={15} />
        </span>
        <span className={styles.advancedText}>
          <span className={styles.advancedTitle}>{t('provimux.accounts.settings.advanced')}</span>
          <span className={styles.advancedCaption}>{caption}</span>
        </span>
        {status ? <span className={styles.advancedStatus}>{status}</span> : null}
        <IconChevronDown size={15} className={styles.advancedChevron} aria-hidden="true" />
      </button>
      <div id={panelId} className={styles.advancedBody} hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}

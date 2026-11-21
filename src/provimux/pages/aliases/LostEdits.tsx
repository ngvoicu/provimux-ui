import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconX } from '@/components/ui/icons';
import { entryLabelOf } from './labels';
import type { LostEdit } from './rebase';
import type { AliasEntry, AliasRow } from './types';
import styles from './AliasesPage.module.scss';

/** An entry changed elsewhere whose edits were not saved (design 3.6): kept on screen until dismissed. */
export interface LostNotice {
  key: number;
  entry: AliasEntry;
  edits: LostEdit[];
}

/** What else an edit set or changed besides the alias, in words. */
function optionNotes(t: TFunction, edit: LostEdit): string[] {
  const { before, after } = edit;
  const notes: string[] = [];
  if (!after) return notes;
  const onOff = (value: boolean, on: string, off: string) =>
    t(`provimux.aliases.${value ? on : off}`);
  const changed = <K extends keyof AliasRow>(key: K) => !before || before[key] !== after[key];
  if (before && before.upstream.trim() !== after.upstream.trim()) {
    notes.push(t('provimux.aliases.lost_model_was', { model: before.upstream.trim() }));
  }
  if (after.store === 'login' && changed('fork') && (before || after.fork === false)) {
    notes.push(onOff(after.fork === true, 'lost_fork_on', 'lost_fork_off'));
  }
  if (changed('forceMapping') && (before || after.forceMapping === true)) {
    notes.push(onOff(after.forceMapping === true, 'lost_force_on', 'lost_force_off'));
  }
  const display = (row: AliasRow | null) => (row?.displayName ?? '').trim();
  if (after.store === 'login' && display(before) !== display(after)) {
    notes.push(
      display(after)
        ? t('provimux.aliases.lost_display', { name: display(after) })
        : t('provimux.aliases.lost_display_none')
    );
  }
  return notes;
}

function AliasWord({ row }: { row: AliasRow | null }) {
  const { t } = useTranslation();
  const alias = row?.alias?.trim();
  return alias ? (
    <code className={styles.lostName}>{alias}</code>
  ) : (
    <span className={styles.lostNone}>{t('provimux.aliases.lost_no_alias')}</span>
  );
}

/** One edit, in words a person can type again from: "changed claude-opus-5-5: opus → opus-2". */
function EditLine({ edit }: { edit: LostEdit }) {
  const { t } = useTranslation();
  const row = edit.after ?? edit.before;
  const model = row?.upstream.trim() || t('provimux.aliases.model_unnamed');
  const notes = optionNotes(t, edit);
  return (
    <li className={styles.lostEdit}>
      <span className={styles.lostKind} data-kind={edit.kind}>
        {t(`provimux.aliases.lost_${edit.kind}`)}
      </span>
      <span className={styles.lostText}>
        <code className={styles.lostName}>{model}</code>
        {edit.kind === 'changed' ? (
          <>
            {': '}
            <AliasWord row={edit.before} />
            <span aria-hidden="true"> → </span>
            <span className="visually-hidden"> {t('provimux.aliases.lost_to')} </span>
            <AliasWord row={edit.after} />
          </>
        ) : (
          <>
            <span aria-hidden="true"> → </span>
            <span className="visually-hidden"> {t('provimux.aliases.lost_as')} </span>
            <AliasWord row={row} />
          </>
        )}
        {notes.length ? <span className={styles.lostNotes}> ({notes.join(', ')})</span> : null}
      </span>
    </li>
  );
}

/**
 * The edits that were not saved because their entry changed elsewhere. The page does not merge: the entry
 * shows what the file holds now, and these lines say what to type again.
 */
export function LostEdits({
  notices,
  onDismiss,
}: {
  notices: readonly LostNotice[];
  onDismiss: (key: number) => void;
}) {
  const { t } = useTranslation();
  if (!notices.length) return null;
  return (
    <div className={styles.lostList}>
      {notices.map((notice) => {
        const label = entryLabelOf(t, notice.entry);
        return (
          <section
            key={notice.key}
            className={styles.lost}
            role="alert"
            aria-label={t('provimux.aliases.lost_title', { entry: label })}
          >
            <div className={styles.lostHead}>
              <IconAlertTriangle size={15} />
              <h2 className={styles.lostTitle}>
                {t('provimux.aliases.lost_title', { entry: label })}
              </h2>
              <button
                type="button"
                className={styles.lostDismiss}
                onClick={() => onDismiss(notice.key)}
                aria-label={t('provimux.aliases.lost_dismiss_label', { entry: label })}
              >
                <IconX size={14} />
                <span>{t('provimux.aliases.lost_dismiss')}</span>
              </button>
            </div>
            <p className={styles.lostLede}>{t('provimux.aliases.lost_text')}</p>
            <ul className={styles.lostEdits}>
              {notice.edits.map((edit, index) => (
                <EditLine key={index} edit={edit} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

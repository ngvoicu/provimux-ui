import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconAlertTriangle, IconX } from '@/components/ui/icons';
import { entryLabelOf } from './labels';
import type { LostEdit } from './draft';
import type { LostNotice } from './pageLogic';
import type { AliasRow, CommitOutcome } from './types';
import styles from './LostEdits.module.scss';

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

/** Why the save ended, said once for the save (3.6). */
function Reason({ failure }: { failure: CommitOutcome['failure'] }) {
  const { t } = useTranslation();
  if (!failure) return null;
  const message = failure.message.trim();
  const quoted = message ? <pre className={styles.lostMessage}>{message}</pre> : null;
  switch (failure.reason) {
    case 'refused':
      return (
        <>
          <p className={styles.lostReason}>{t('provimux.aliases.lost_reason_refused')}</p>
          {quoted}
          <p className={styles.lostFix}>
            {t('provimux.aliases.lost_refused_fix')}{' '}
            <Link to="/config" className={styles.link}>
              {t('nav.config_management')}
            </Link>
          </p>
        </>
      );
    case 'error':
      return (
        <>
          <p className={styles.lostReason}>{t('provimux.aliases.lost_reason_error')}</p>
          {quoted}
          <p className={styles.lostFix}>{t('provimux.aliases.lost_error_check')}</p>
        </>
      );
    case 'changed':
      return <p className={styles.lostReason}>{t('provimux.aliases.lost_reason_changed')}</p>;
    case 'no-tag':
      return <p className={styles.lostReason}>{t('provimux.aliases.lost_reason_no_tag')}</p>;
    case 'blocked':
      return <p className={styles.lostReason}>{t('provimux.aliases.lost_reason_blocked')}</p>;
  }
}

/** The notices of one save, in order. */
function bySave(notices: readonly LostNotice[]): LostNotice[][] {
  const saves = new Map<number, LostNotice[]>();
  for (const notice of notices) saves.set(notice.save, [...(saves.get(notice.save) ?? []), notice]);
  return [...saves.values()];
}

/**
 * The edits a save did not confirm (3.6). The page carries nothing: the board shows the file as it is,
 * and these lines say what to type again. One card per save, its reason once; one item per entry, kept
 * until dismissed. Shown above whatever the page's body is, the empty state included.
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
      {bySave(notices).map((items) => {
        const save = items[0].save;
        const headingId = `pmx-aliases-lost-${save}`;
        return (
          <section
            key={save}
            className={styles.lost}
            data-reason={items[0].failure?.reason}
            aria-labelledby={headingId}
          >
            <div className={styles.lostHead}>
              <IconAlertTriangle size={16} />
              <h2 id={headingId} className={styles.lostTitle}>
                {t('provimux.aliases.lost_heading')}
              </h2>
            </div>
            <div className={styles.lostWhy}>
              <Reason failure={items[0].failure} />
            </div>
            <ul className={styles.lostEntries}>
              {items.map((notice) => {
                const label = entryLabelOf(t, notice.entry);
                return (
                  <li key={notice.key} className={styles.lostEntry}>
                    <div className={styles.lostEntryHead}>
                      <h3 className={styles.lostEntryName}>{label}</h3>
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
                    <ul className={styles.lostEdits}>
                      {notice.edits.map((edit, index) => (
                        <EditLine key={index} edit={edit} />
                      ))}
                      {notice.priority ? (
                        <li className={styles.lostEdit}>
                          <span className={styles.lostKind} data-kind="changed">
                            {t('provimux.aliases.lost_changed')}
                          </span>
                          <span className={styles.lostText}>
                            {t('provimux.aliases.lost_priority', notice.priority)}
                          </span>
                        </li>
                      ) : null}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

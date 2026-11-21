import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconAlertTriangle, IconInfo } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { AliasesBoard, type BoardActions } from './AliasesBoard';
import { LostEdits } from './LostEdits';
import { canEdit, type AliasFilter, type PageState } from './pageLogic';
import type { AliasDraft, ServedNames } from './types';
import shared from '../shared/Shared.module.scss';
import styles from './AliasesPage.module.scss';

export interface AliasesBodyProps {
  page: PageState;
  /** undefined while the first answer is awaited. */
  served: ServedNames | undefined;
  filter: AliasFilter;
  onFilter: (next: AliasFilter) => void;
  suggestions: Record<string, string[]>;
  focusRowId: string | null;
  actions: BoardActions;
  /** The load error's retry. */
  onRetry: () => void;
  onDismiss: (key: number) => void;
}

const isEmpty = (draft: AliasDraft) => draft.base.entries.length === 0 && draft.rows.length === 0;

/**
 * What the page shows below its header (design 3.6), always in this order, each part independent of the
 * others:
 *
 * 1. the edits not confirmed saved, in every phase (reading, load error, empty, board);
 * 2. while a read is held: the line that the page cannot save (a read without a tag), and the line
 *    naming what the page cannot read (2.5);
 * 3. the body: the skeleton, the load error with its retry, the empty state, or the board.
 *
 * The empty state stands in for the board and for nothing else. Plain values only, so it renders in a
 * test without a request.
 */
export function AliasesBody({
  page,
  served,
  filter,
  onFilter,
  suggestions,
  focusRowId,
  actions,
  onRetry,
  onDismiss,
}: AliasesBodyProps) {
  const { t } = useTranslation();
  const { draft } = page;
  return (
    <>
      <LostEdits notices={page.lost} onDismiss={onDismiss} />

      {draft && draft.base.etag === null ? (
        <p className={styles.cannotSave} role="note">
          <IconAlertTriangle size={14} />
          <span>{t('provimux.aliases.cannot_save')}</span>
        </p>
      ) : null}
      {draft ? <UnreadLine paths={draft.base.unread} /> : null}

      {draft === null ? (
        page.loadError !== null && !page.reading ? (
          <EmptyState
            title={t('provimux.aliases.load_failed')}
            description={page.loadError}
            action={
              <Button variant="secondary" onClick={onRetry}>
                {t('provimux.common.retry')}
              </Button>
            }
          />
        ) : (
          <div
            className={shared.skeletons}
            aria-busy="true"
            aria-label={t('provimux.common.loading')}
          >
            <Skeleton height={44} />
            <Skeleton height={120} />
            <Skeleton height={260} />
          </div>
        )
      ) : (
        <>
          {page.reading ? (
            <p className={styles.reading} role="status">
              <span className={styles.readingDot} aria-hidden="true" />
              <span>{t('provimux.aliases.reading')}</span>
            </p>
          ) : page.loadError !== null ? (
            <p className={shared.inlineError} role="alert">
              {t('provimux.aliases.reload_failed', { message: page.loadError })}
            </p>
          ) : null}
          {isEmpty(draft) ? (
            <EmptyState
              title={
                draft.base.unread.length
                  ? t('provimux.aliases.empty_title_unread')
                  : t('provimux.aliases.empty_title')
              }
              description={t('provimux.aliases.empty_text')}
              action={
                <div className={styles.emptyLinks}>
                  <Link to="/ai-providers" className={styles.link}>
                    {t('provimux.aliases.empty_link_providers')}
                  </Link>
                  <Link to="/oauth" className={styles.link}>
                    {t('provimux.aliases.empty_link_logins')}
                  </Link>
                </div>
              }
            />
          ) : (
            <div className={styles.board} aria-busy={page.reading || page.saving || undefined}>
              <AliasesBoard
                draft={draft}
                served={served}
                filter={filter}
                onFilter={onFilter}
                texts={page.texts}
                suggestions={suggestions}
                focusRowId={focusRowId}
                locked={!canEdit(page)}
                actions={actions}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}

/** How many unread paths the line names before "N more". */
const UNREAD_SHOWN = 3;

/**
 * 2.5: the parts of the file the page cannot read, in one line. They give no entry or row here and are
 * left in the file as they are.
 */
function UnreadLine({ paths }: { paths: readonly string[] }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  if (!paths.length) return null;
  const shown = all ? paths : paths.slice(0, UNREAD_SHOWN);
  const more = paths.length - shown.length;
  return (
    <p className={`${shared.note} ${styles.unread}`}>
      <IconInfo size={13} />
      <span>
        {t('provimux.aliases.unread_line', { count: paths.length })}{' '}
        {shown.map((path, index) => (
          <Fragment key={path}>
            {index ? ', ' : null}
            <code className={styles.unreadPath}>{path}</code>
          </Fragment>
        ))}
        {more > 0 || all ? (
          <>
            {' '}
            <button
              type="button"
              className={styles.unreadMore}
              aria-expanded={all}
              onClick={() => setAll((prev) => !prev)}
            >
              {all
                ? t('provimux.aliases.unread_fewer')
                : t('provimux.aliases.unread_more', { count: more })}
            </button>
          </>
        ) : null}
      </span>
    </p>
  );
}

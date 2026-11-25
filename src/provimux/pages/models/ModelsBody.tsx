import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconAlertTriangle, IconInfo } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import type { ProvimuxModelListsResponse, ProvimuxModelRoutesResponse } from '../../api/types';
import { LostEdits } from '../aliases/LostEdits';
import { canEdit, isDirty, type PageState } from '../aliases/pageLogic';
import type { AliasDraft } from '../aliases/types';
import type { DevinCooling } from '../modelRoutes/useDevinCooling';
import type { ExcludedFilter } from '../excluded/exclusions';
import { ExcludedView, type ExclusionWriteRequest } from '../excluded/ExcludedView';
import type { ModelDetail, ModelsFilter } from './catalog';
import { ModelsBoard, type BoardNames } from './ModelsBoard';
import shared from '../shared/Shared.module.scss';
import styles from './ModelsPage.module.scss';

/** The page's two views: its names, and the models accounts never serve. */
export type ModelsTab = 'names' | 'excluded';

export interface ModelsBodyProps {
  /** Which view is shown; names when not given. */
  tab?: ModelsTab;
  excludedFilter?: ExcludedFilter;
  onExcludedFilter?: (next: ExcludedFilter) => void;
  /** The exclusion being written: its id, or 'new'. */
  writing?: string | null;
  /** OpenAI-compatible entries have exclusions of their own (a server with self-refreshing key lists). */
  compatibleExclusions?: boolean;
  onWriteExclusion?: (request: ExclusionWriteRequest, writing: string) => Promise<boolean>;
  /** A name's "excluded" mark: Excluded models, searched for that name. */
  onShowExcluded?: (model: string) => void;
  page: PageState;
  routes: ProvimuxModelRoutesResponse | null;
  /** true: the proxy reports its routes; false: it has no such endpoint; null: not answered yet. */
  routesKnown: boolean | null;
  routesError: string | null;
  routesOffsetMs: number;
  lists: ProvimuxModelListsResponse | null;
  usage: Record<string, number> | null;
  /** Per login, its models with where their limits come from. */
  details?: Record<string, Record<string, ModelDetail>>;
  nowMs: number;
  filter: ModelsFilter;
  onFilter: (next: ModelsFilter) => void;
  edit: (change: (draft: AliasDraft) => AliasDraft) => void;
  devin: DevinCooling;
  onRoutesChanged: () => void;
  /** The load error's retry. */
  onRetry: () => void;
  onDismiss: (key: number) => void;
  /** "Serve only my names"; absent where the gateway has no such setting. */
  names?: BoardNames;
  /**
   * The last draft the page held: drawn, locked, while the read after a save or a write runs, so the panel stays
   * in place instead of giving way to the skeleton for the moment the read takes.
   */
  held?: AliasDraft | null;
}

/**
 * What the page shows below its header, always in this order (aliases-page.md 3.6): the edits not
 * confirmed saved, in every phase; while a read is held, the line that the page cannot save and the line
 * naming what it cannot read; then the skeleton, the load error with its retry, or the board. Plain values
 * only, so it renders in a test without a request.
 */
export function ModelsBody(props: ModelsBodyProps) {
  const { t } = useTranslation();
  const { page, onRetry, onDismiss } = props;
  // A save drops the page's draft (it carries nothing, aliases-page.md 3.6); until the read after it answers, the
  // panel shows the draft it had, locked.
  const draft = page.draft ?? (page.reading ? (props.held ?? null) : null);
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
            <Skeleton height={140} />
            <Skeleton height={320} />
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
          {props.tab === 'excluded' ? (
            <div id="pmx-models-panel" role="tabpanel" aria-labelledby="pmx-models-tab-excluded">
              <ExcludedView
                state={draft.base}
                locked={!canEdit(page)}
                dirty={isDirty(page)}
                writing={props.writing ?? null}
                compatible={props.compatibleExclusions === true}
                routes={props.routes}
                routesKnown={props.routesKnown}
                filter={props.excludedFilter ?? { query: '', service: 'all' }}
                onFilter={props.onExcludedFilter ?? (() => undefined)}
                onWrite={props.onWriteExclusion ?? (async () => false)}
              />
            </div>
          ) : (
            <div id="pmx-models-panel" role="tabpanel" aria-labelledby="pmx-models-tab-names">
              <ModelsBoard
                draft={draft}
                locked={!canEdit(page)}
                busy={page.reading || page.saving}
                routes={props.routes}
                routesKnown={props.routesKnown}
                routesError={props.routesError}
                routesOffsetMs={props.routesOffsetMs}
                lists={props.lists}
                usage={props.usage}
                details={props.details}
                nowMs={props.nowMs}
                filter={props.filter}
                onFilter={props.onFilter}
                edit={props.edit}
                devin={props.devin}
                onRoutesChanged={props.onRoutesChanged}
                onShowExcluded={props.onShowExcluded}
                compatibleExclusions={props.compatibleExclusions === true}
                dirty={isDirty(page)}
                writing={props.writing ?? null}
                onWriteExclusion={props.onWriteExclusion}
                names={props.names}
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

/** aliases-page.md 2.5: the parts of the file the page cannot read, in one line; the file keeps them. */
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
              className={styles.textButton}
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

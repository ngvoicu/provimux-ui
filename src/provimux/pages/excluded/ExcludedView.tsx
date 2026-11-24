import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  IconAlertTriangle,
  IconInfo,
  IconLoader2,
  IconPlus,
  IconSearch,
  IconX,
} from '@/components/ui/icons';
import type { ProvimuxModelRoutesResponse } from '../../api/types';
import { IconExcluded } from '../../components/ProvimuxIcons';
import type { AliasState, KeyEntry } from '../aliases/types';
import { serviceLabel } from '../accounts/labels';
import { ServiceIcon } from '../accounts/ServiceIcon';
import { ACCOUNTS_PATH } from '../shared/accountsLink';
import { AccessBadge } from '../shared/AccessBadge';
import { useOpenAuthFilesOfType } from '../shared/authFilesLink';
import {
  excludedModels,
  filterExcluded,
  readExclusions,
  servicesWithExclusions,
  servingAccounts,
  type ExcludedFilter,
  type ExcludedModel,
  type Exclusion,
  type LoginsPlace,
} from './exclusions';
import { ExclusionComposer } from './ExclusionComposer';
import { placeDetail, placeInline, placeTitle, routeName } from './labels';
import type { ExclusionChange } from './writes';
import shared from '../shared/Shared.module.scss';
import styles from './Excluded.module.scss';

/** What the page reports back about one change, to say it in a notice. */
export interface ExclusionWriteRequest {
  change: ExclusionChange;
  /** For the notice: the model and the place, in words. */
  model: string;
  place: string;
}

export interface ExcludedViewProps {
  /** The page's read of the configuration (the draft's base). */
  state: AliasState;
  /** Nothing can be changed: a read or a write is pending, or the read has no tag. */
  locked: boolean;
  /** The names have edits not saved: exclusions wait until they are saved or discarded. */
  dirty: boolean;
  /** The change being written: an exclusion's id, or 'new'; null when none. */
  writing: string | null;
  routes: ProvimuxModelRoutesResponse | null;
  /** true: the proxy reports its routes; false: it has no such endpoint; null: not answered yet. */
  routesKnown: boolean | null;
  filter: ExcludedFilter;
  onFilter: (next: ExcludedFilter) => void;
  /** Resolves true when the change was written. */
  onWrite: (request: ExclusionWriteRequest, writing: string) => Promise<boolean>;
}

/** How many accounts that still serve a model are named before "and N more". */
const NAMED = 2;
/** How many unread paths the line names. */
const UNREAD_SHOWN = 3;

/**
 * Excluded models (design models-page.md, section 6): every model an account never serves, one card per model
 * (or pattern) with every place that excludes it, whether another account still serves it, and the way to add
 * and remove one. Each change is written at once, as one request with If-Match. Plain values only, so it
 * renders in a test without a request.
 */
export function ExcludedView(props: ExcludedViewProps) {
  const { t } = useTranslation();
  const { state, locked, dirty, writing, routes, filter, onFilter } = props;
  const [adding, setAdding] = useState<{ model: string } | null>(null);
  const openAuthFiles = useOpenAuthFilesOfType();

  const read = useMemo(() => readExclusions(state), [state]);
  const items = useMemo(() => excludedModels(read.exclusions, routes), [read.exclusions, routes]);
  const visible = useMemo(() => filterExcluded(items, filter), [items, filter]);
  const services = useMemo(() => servicesWithExclusions(read.exclusions), [read.exclusions]);
  const nowhere = items.filter(
    (item) => item.stillServed !== null && item.stillServed.length === 0
  );
  const narrowed = filter.query.trim() !== '' || filter.service !== 'all';
  const blocked = locked || dirty;

  const keys = useMemo(
    () => state.entries.filter((entry): entry is KeyEntry => entry.store === 'api-key'),
    [state.entries]
  );
  // Keys of a family the proxy has no exclusions for (OpenAI-compatible, for now): one line names them.
  const compatible = read.withoutExclusions;
  const loginTypes = read.places.filter(
    (place): place is LoginsPlace => place.kind === 'logins' && (place.loginCount ?? 1) > 0
  );
  const filteredLogins =
    filter.service === 'all'
      ? null
      : (loginTypes.find((place) => place.service === filter.service) ?? null);

  const set = (patch: Partial<ExcludedFilter>) => onFilter({ ...filter, ...patch });
  const remove = (item: ExcludedModel, exclusion: Exclusion) =>
    void props.onWrite(
      {
        change: { place: exclusion.place, rule: exclusion.rule, excluded: false },
        model: item.rule,
        place: placeInline(t, exclusion.place),
      },
      exclusion.id
    );

  const startAdding = () => {
    const query = filter.query.trim();
    setAdding({ model: query && !/\s/.test(query) ? query : '' });
  };

  return (
    <div className={styles.view}>
      <p className={styles.intro}>{t('provimux.excluded.intro')}</p>

      <div className={shared.chips} aria-label={t('provimux.excluded.summary_label')}>
        <span className={shared.chip}>
          {t('provimux.excluded.count_exclusions', { count: read.exclusions.length })}
        </span>
        <span className={shared.chip}>
          {t('provimux.excluded.count_models', { count: items.length })}
        </span>
        {nowhere.length ? (
          <span className={`${shared.chip} ${styles.chipNowhere}`}>
            <IconExcluded size={13} />
            {t('provimux.excluded.count_nowhere', { count: nowhere.length })}
          </span>
        ) : null}
      </div>

      {dirty ? (
        <p className={styles.waiting} role="note">
          <IconAlertTriangle size={14} />
          <span>{t('provimux.excluded.dirty')}</span>
        </p>
      ) : null}

      <div className={`${shared.toolbar} ${styles.toolbar}`} role="search">
        <label className={shared.search}>
          <IconSearch size={15} className={shared.searchIcon} />
          <input
            type="search"
            value={filter.query}
            placeholder={t('provimux.excluded.search_placeholder')}
            aria-label={t('provimux.excluded.search_placeholder')}
            onChange={(event) => set({ query: event.target.value })}
          />
        </label>
        <div
          className={`${shared.segmented} ${styles.services}`}
          role="group"
          aria-label={t('provimux.excluded.service_label')}
        >
          <button
            type="button"
            aria-pressed={filter.service === 'all'}
            onClick={() => set({ service: 'all' })}
          >
            {t('provimux.excluded.service_all')}
            <span className={styles.segCount}>{read.exclusions.length}</span>
          </button>
          {services.map(({ service, count }) => (
            <button
              key={service}
              type="button"
              aria-pressed={filter.service === service}
              onClick={() => set({ service })}
            >
              {serviceLabel(t, service)}
              <span className={styles.segCount}>{count}</span>
            </button>
          ))}
        </div>
        {narrowed ? (
          <button
            type="button"
            className={shared.clear}
            onClick={() => onFilter({ query: '', service: 'all' })}
          >
            <IconX size={12} />
            {t('provimux.common.clear_filters')}
          </button>
        ) : null}
        <span className={styles.spacer} />
        <Button
          size="sm"
          className={styles.withIcon}
          onClick={startAdding}
          disabled={blocked || adding !== null}
        >
          <IconPlus size={14} />
          {t('provimux.excluded.add')}
        </Button>
      </div>

      {adding ? (
        <ExclusionComposer
          places={read.places}
          routes={routes}
          initialModel={adding.model}
          initialService={filter.service === 'all' ? null : filter.service}
          locked={blocked}
          writing={writing === 'new'}
          onCancel={() => setAdding(null)}
          onSubmit={async (change, words) => {
            const done = await props.onWrite({ change, ...words }, 'new');
            if (done) setAdding(null);
          }}
        />
      ) : null}

      {items.length === 0 && !adding ? (
        <EmptyState
          title={t('provimux.excluded.empty_title')}
          description={t('provimux.excluded.empty_text')}
          action={
            <Button
              variant="secondary"
              className={styles.withIcon}
              onClick={startAdding}
              disabled={blocked}
            >
              <IconPlus size={14} />
              {t('provimux.excluded.add')}
            </Button>
          }
        />
      ) : null}

      {items.length > 0 && visible.length === 0 ? (
        <p className={styles.noMatch}>{t('provimux.excluded.no_match')}</p>
      ) : null}

      {visible.length ? (
        <div className={styles.models} aria-busy={writing !== null || undefined}>
          {visible.map((item) => (
            <ExcludedCard
              key={item.key}
              item={item}
              keys={keys}
              routesKnown={props.routesKnown}
              blocked={blocked}
              writing={writing}
              onRemove={(exclusion) => remove(item, exclusion)}
            />
          ))}
        </div>
      ) : null}

      {read.unread.length ? (
        <p className={shared.note}>
          <IconInfo size={13} />
          <span>
            {t('provimux.excluded.unread', { count: read.unread.length })}{' '}
            {read.unread.slice(0, UNREAD_SHOWN).map((path, index) => (
              <Fragment key={path}>
                {index ? ', ' : null}
                <code className={styles.path}>{path}</code>
              </Fragment>
            ))}
            {read.unread.length > UNREAD_SHOWN ? ', …' : null}
          </span>
        </p>
      ) : null}

      {loginTypes.length ? (
        <p className={shared.note}>
          <IconInfo size={13} />
          <span>
            {t('provimux.excluded.login_files')}{' '}
            <button
              type="button"
              className={styles.inlineLink}
              onClick={() => openAuthFiles(filteredLogins?.type ?? null)}
            >
              {filteredLogins
                ? t('provimux.excluded.login_files_link_service', {
                    service: serviceLabel(t, filteredLogins.service),
                  })
                : t('provimux.excluded.login_files_link')}
            </button>
          </span>
        </p>
      ) : null}

      {compatible.length ? (
        <p className={shared.note}>
          <IconInfo size={13} />
          <span>
            {t('provimux.excluded.compatible_note', {
              names: compatible.map((entry) => entry.groupName ?? entry.host ?? '?').join(', '),
            })}
          </span>
        </p>
      ) : null}
    </div>
  );
}

interface ExcludedCardProps {
  item: ExcludedModel;
  /** The configuration's keys, to name a key that still serves the model by its masked tail. */
  keys: readonly KeyEntry[];
  routesKnown: boolean | null;
  blocked: boolean;
  writing: string | null;
  onRemove: (exclusion: Exclusion) => void;
}

/** One model or pattern: where it is excluded, and whether anything still serves it. */
export function ExcludedCard({
  item,
  keys,
  routesKnown,
  blocked,
  writing,
  onRemove,
}: ExcludedCardProps) {
  const { t } = useTranslation();
  const served = item.stillServed;
  const nowhere = served !== null && served.length === 0;
  const accounts = served ? servingAccounts(served) : 0;
  const names = served ? [...new Set(served.map(({ route }) => routeName(t, route, keys)))] : [];
  const shown = names.slice(0, NAMED).join(', ');

  return (
    <article
      className={styles.model}
      data-nowhere={nowhere || undefined}
      aria-label={item.rule}
      id={`pmx-excluded-${item.key.replace(/[^a-z0-9-]/g, '_')}`}
    >
      <header className={styles.modelHead}>
        <span className={styles.modelIcon} aria-hidden="true">
          <IconExcluded size={15} />
        </span>
        <h3 className={styles.modelName}>{item.rule}</h3>
        {item.wildcard ? (
          <span className={styles.pattern} title={t('provimux.excluded.pattern_title')}>
            {t('provimux.excluded.pattern')}
          </span>
        ) : null}
        <span className={styles.spacer} />
        {nowhere ? (
          <span className={styles.nowhere} title={t('provimux.excluded.served_nowhere_title')}>
            {t('provimux.excluded.served_nowhere')}
          </span>
        ) : served && served.length ? (
          <span className={styles.stillServed}>
            {t('provimux.excluded.still_served', { count: accounts })}
          </span>
        ) : null}
      </header>

      <ul className={styles.places}>
        {item.exclusions.map((exclusion) => {
          const { place } = exclusion;
          const busy = writing === exclusion.id;
          const title = placeTitle(t, place);
          return (
            <li key={exclusion.id} className={styles.place} data-busy={busy || undefined}>
              <ServiceIcon
                service={place.service}
                provider={place.kind === 'logins' ? place.type : place.entry.family}
              />
              <div className={styles.placeText}>
                {place.kind === 'key' && place.entry.authIndex ? (
                  <Link
                    className={styles.placeTitle}
                    to={`${ACCOUNTS_PATH}?account=${encodeURIComponent(place.entry.authIndex)}`}
                  >
                    {title}
                  </Link>
                ) : (
                  <span className={styles.placeTitle}>{title}</span>
                )}
                <span className={styles.placeDetail}>{placeDetail(t, place)}</span>
              </div>
              <AccessBadge access={place.kind === 'logins' ? 'sub' : 'api'} kind={null} />
              <button
                type="button"
                className={styles.remove}
                disabled={blocked}
                aria-label={t('provimux.excluded.remove_label', {
                  model: item.rule,
                  place: placeInline(t, place),
                })}
                onClick={() => onRemove(exclusion)}
              >
                {busy ? <IconLoader2 size={13} className={styles.spin} /> : <IconX size={13} />}
                {t('provimux.excluded.remove')}
              </button>
            </li>
          );
        })}
      </ul>

      {served && served.length ? (
        <p className={styles.servedLine}>
          {names.length > NAMED
            ? t('provimux.excluded.served_by_more', {
                names: shown,
                count: names.length - NAMED,
              })
            : t('provimux.excluded.served_by', { names: shown })}
        </p>
      ) : routesKnown === false ? (
        <p className={styles.servedLine}>{t('provimux.excluded.routes_unknown')}</p>
      ) : null}
    </article>
  );
}

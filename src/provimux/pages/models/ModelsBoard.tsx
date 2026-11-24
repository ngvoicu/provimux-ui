import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconAlertTriangle, IconInfo, IconPlus, IconSearch, IconX } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { ProvimuxModelListsResponse, ProvimuxModelRoutesResponse } from '../../api/types';
import { familyLabel } from '../aliases/labels';
import { draftEntries } from '../aliases/draft';
import type { AliasDraft } from '../aliases/types';
import { compatibleEntryOf, isOpenRouterHost } from '../modelRoutes/logic';
import type { DevinCooling } from '../modelRoutes/useDevinCooling';
import {
  EMPTY_MODELS_FILTER,
  buildNames,
  candidatesFor,
  matches,
  nameKey,
  sections,
  summarizeNames,
  type ModelsFilter,
  type NameItem,
  type NameView,
  type Section,
} from './catalog';
import { NameCard } from './NameCard';
import { NameComposer } from './NameEditor';
import { ModelsSettings } from './ModelsSettings';
import shared from '../shared/Shared.module.scss';
import styles from './ModelsPage.module.scss';

export interface ModelsBoardProps {
  draft: AliasDraft;
  /** Nothing can be edited (`!canEdit`): the names' fieldset is disabled; filters still work. */
  locked: boolean;
  busy: boolean;
  routes: ProvimuxModelRoutesResponse | null;
  routesKnown: boolean | null;
  routesError: string | null;
  routesOffsetMs: number;
  lists: ProvimuxModelListsResponse | null;
  usage: Record<string, number> | null;
  learned?: Record<string, readonly string[]>;
  nowMs: number;
  filter: ModelsFilter;
  onFilter: (next: ModelsFilter) => void;
  edit: (change: (draft: AliasDraft) => AliasDraft) => void;
  devin: DevinCooling;
  onRoutesChanged: () => void;
}

/** How many of the other models are drawn at once; the rest on "Show more". */
const OTHER_PAGE = 60;

/**
 * The names, in three parts: the owner's own names, the models used in the last 30 days, and every other
 * model (folded until asked for, or until a search or filter narrows the list). Above them the summary,
 * the filters and "New name"; below them the settings. Exported for static rendering in tests.
 */
export function ModelsBoard(props: ModelsBoardProps) {
  const { t } = useTranslation();
  const { draft, locked, routes, routesKnown, lists, usage, nowMs, filter, onFilter, edit } = props;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [composing, setComposing] = useState<{ name: string; seed: string | null } | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherLimit, setOtherLimit] = useState(OTHER_PAGE);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const entries = useMemo(() => draftEntries(draft), [draft]);
  const { learned } = props;
  const items = useMemo(
    () => buildNames({ draft, routes, lists, usage, nowMs, learned }),
    [draft, routes, lists, usage, nowMs, learned]
  );
  const summary = useMemo(() => summarizeNames(items), [items]);
  const visible = useMemo(
    () => items.filter((item) => matches(item, filter, entries)),
    [items, filter, entries]
  );
  const parts = useMemo(() => sections(visible), [visible]);
  const narrowed = filter.query.trim() !== '' || filter.provider !== 'all' || filter.view !== 'all';
  const set = (patch: Partial<ModelsFilter>) => onFilter({ ...filter, ...patch });
  const toggleView = (view: NameView) => set({ view: filter.view === view ? 'all' : view });

  // A name made in the composer: open its card and bring it into view once it is drawn.
  useEffect(() => {
    if (!focusKey) return;
    const element = document.getElementById(cardIdOf(focusKey));
    if (element) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFocusKey(null);
    }
  }, [focusKey, items]);

  const providerOptions = useMemo(() => {
    const options = [
      { value: 'all', label: t('provimux.models.provider_all') },
      { value: 'logins', label: t('provimux.models.provider_logins') },
      { value: 'keys', label: t('provimux.models.provider_keys') },
    ];
    const seen = new Set(options.map((o) => o.value));
    const push = (value: string, label: string) => {
      if (seen.has(value)) return;
      seen.add(value);
      options.push({ value, label });
    };
    for (const entry of entries) {
      if (entry.store === 'login') {
        push(
          `login:${entry.channel}`,
          t('provimux.models.source_login', { name: getTypeLabel(t, entry.channel) })
        );
      } else if (isOpenRouterHost(entry.host)) {
        push('openrouter', 'OpenRouter');
      } else {
        push(
          `family:${entry.family}`,
          t('provimux.models.source_keys', { name: familyLabel(t, entry.family) })
        );
      }
    }
    if (!seen.has(filter.provider)) {
      const raw = filter.provider.replace(/^[a-z]+:/, '');
      push(filter.provider, compatibleEntryOf(raw) ?? getTypeLabel(t, raw));
    }
    return options;
  }, [entries, filter.provider, t]);

  const views: Array<{ value: NameView; label: string }> = [
    { value: 'all', label: t('provimux.models.view_all') },
    { value: 'several', label: t('provimux.models.view_several') },
    { value: 'cooling', label: t('provimux.models.view_cooling') },
    { value: 'problems', label: t('provimux.models.view_problems') },
  ];

  // Devin's pause and OpenRouter's support are Provimux's: shown only where Provimux answers, and only
  // when the install has a Devin login, or an OpenRouter entry.
  const withDevin =
    routesKnown === true &&
    (props.devin.logins?.enabled ?? 0) + (props.devin.logins?.disabled ?? 0) > 0;
  const withOpenRouter =
    routesKnown === true &&
    entries.some((entry) => entry.store === 'api-key' && isOpenRouterHost(entry.host));

  /** The model "Name it" starts the composer with: the name's first route that has a source here. */
  const seedOf = (named: NameItem): string | null =>
    candidatesFor(draft, routes, '').find((candidate) =>
      named.lines.some(
        (line) =>
          line.entryId === candidate.entryId && line.upstream === candidate.upstream && !line.off
      )
    )?.key ?? null;

  const card = (item: NameItem) => (
    <NameCard
      key={item.key}
      id={cardIdOf(item.key)}
      item={item}
      draft={draft}
      entries={entries}
      routes={routes}
      routesKnown={routesKnown === true}
      offsetMs={props.routesOffsetMs}
      locked={locked}
      open={openKey === item.key}
      onToggle={() => setOpenKey((prev) => (prev === item.key ? null : item.key))}
      onRenamed={(to) => setOpenKey(nameKey(to))}
      onNewName={(named) => setComposing({ name: '', seed: seedOf(named) })}
      edit={edit}
    />
  );

  const section = (id: Section, list: NameItem[], body?: ReactNode) => (
    <section className={styles.section} aria-labelledby={`pmx-models-${id}`}>
      <div className={styles.sectionHead}>
        <h2 id={`pmx-models-${id}`} className={styles.sectionTitle}>
          {t(`provimux.models.section_${id}`)}
          <span className={styles.sectionCount}>{list.length}</span>
        </h2>
        <p className={styles.sectionHint}>{t(`provimux.models.section_${id}_hint`)}</p>
      </div>
      {body ?? <div className={styles.cards}>{list.map(card)}</div>}
    </section>
  );

  const showOther = narrowed || otherOpen;
  const otherShown = parts.rest.slice(0, otherLimit);

  return (
    <>
      <div className={shared.chips} aria-label={t('provimux.models.summary_label')}>
        <span className={shared.chip}>
          {t('provimux.models.count_names', { count: summary.names })}
        </span>
        <span className={shared.chip} data-tone="brand">
          {t('provimux.models.count_yours', { count: summary.yours })}
        </span>
        <button
          type="button"
          className={shared.chip}
          aria-pressed={filter.view === 'several'}
          disabled={summary.several === 0}
          onClick={() => toggleView('several')}
        >
          {t('provimux.models.count_several', { count: summary.several })}
        </button>
        {summary.cooling > 0 ? (
          <button
            type="button"
            className={shared.chip}
            data-tone="cooling"
            aria-pressed={filter.view === 'cooling'}
            onClick={() => toggleView('cooling')}
          >
            {t('provimux.models.count_cooling', { count: summary.cooling })}
          </button>
        ) : null}
        {summary.problems > 0 ? (
          <button
            type="button"
            className={`${shared.chip} ${styles.chipProblem}`}
            aria-pressed={filter.view === 'problems'}
            onClick={() => toggleView('problems')}
          >
            <IconAlertTriangle size={13} />
            {t('provimux.models.count_problems', { count: summary.problems })}
          </button>
        ) : null}
      </div>

      {routesKnown === false ? (
        <p className={shared.note}>
          <IconInfo size={13} />
          <span>{t('provimux.models.routes_unknown')}</span>
        </p>
      ) : props.routesError && !routes ? (
        <p className={shared.inlineError} role="alert">
          {t('provimux.models.routes_failed', { message: props.routesError })}
        </p>
      ) : null}

      <div className={`${shared.toolbar} ${styles.toolbar}`} role="search">
        <label className={shared.search}>
          <IconSearch size={15} className={shared.searchIcon} />
          <input
            type="search"
            value={filter.query}
            placeholder={t('provimux.models.search_placeholder')}
            aria-label={t('provimux.models.search_placeholder')}
            onChange={(event) => set({ query: event.target.value })}
          />
        </label>
        <Select
          value={filter.provider}
          options={providerOptions}
          onChange={(value) => set({ provider: value })}
          ariaLabel={t('provimux.models.provider_label')}
          size="sm"
          fullWidth={false}
          className={shared.providerSelect}
        />
        <div className={shared.segmented} role="group" aria-label={t('provimux.models.view_label')}>
          {views.map((view) => (
            <button
              key={view.value}
              type="button"
              aria-pressed={filter.view === view.value}
              onClick={() => set({ view: view.value })}
            >
              {view.label}
            </button>
          ))}
        </div>
        {narrowed ? (
          <button
            type="button"
            className={shared.clear}
            onClick={() => onFilter(EMPTY_MODELS_FILTER)}
          >
            <IconX size={12} />
            {t('provimux.common.clear_filters')}
          </button>
        ) : null}
        <span className={styles.toolbarSpacer} />
        <Button
          size="sm"
          className={styles.newName}
          onClick={() => setComposing({ name: '', seed: null })}
          disabled={locked || composing !== null}
        >
          <IconPlus size={14} />
          {t('provimux.models.new_name')}
        </Button>
      </div>

      <fieldset className={styles.namesBox} disabled={locked} aria-busy={props.busy || undefined}>
        {composing ? (
          <NameComposer
            draft={draft}
            routes={routes}
            seed={composing.seed}
            existing={new Set(items.map((item) => item.key))}
            onCancel={() => setComposing(null)}
            onCreate={(name, change) => {
              edit(change);
              setComposing(null);
              setOpenKey(nameKey(name));
              setFocusKey(nameKey(name));
            }}
          />
        ) : null}

        {items.length === 0 && !composing ? (
          <EmptyState
            title={
              draft.base.unread.length
                ? t('provimux.models.empty_title_unread')
                : t('provimux.models.empty_title')
            }
            description={t('provimux.models.empty_text')}
            action={
              <div className={styles.emptyLinks}>
                <Link to="/ai-providers" className={styles.link}>
                  {t('provimux.models.empty_link_providers')}
                </Link>
                <Link to="/oauth" className={styles.link}>
                  {t('provimux.models.empty_link_logins')}
                </Link>
              </div>
            }
          />
        ) : null}

        {narrowed && visible.length === 0 && items.length > 0 ? (
          <p className={styles.noMatch}>{t('provimux.models.no_match')}</p>
        ) : null}

        {items.length === 0
          ? null
          : parts.yours.length || !narrowed
            ? section(
                'yours',
                parts.yours,
                parts.yours.length === 0 ? (
                  <p className={styles.sectionEmpty}>{t('provimux.models.yours_empty')}</p>
                ) : undefined
              )
            : null}
        {parts.used.length ? section('used', parts.used) : null}
        {parts.rest.length
          ? section(
              'rest',
              parts.rest,
              showOther ? (
                <>
                  <div className={styles.cards}>{otherShown.map(card)}</div>
                  {parts.rest.length > otherShown.length ? (
                    <button
                      type="button"
                      className={styles.more}
                      onClick={() => setOtherLimit((n) => n + OTHER_PAGE)}
                    >
                      {t('provimux.models.show_more', {
                        count: Math.min(OTHER_PAGE, parts.rest.length - otherShown.length),
                        total: parts.rest.length - otherShown.length,
                      })}
                    </button>
                  ) : null}
                  {!narrowed ? (
                    <button
                      type="button"
                      className={styles.more}
                      onClick={() => setOtherOpen(false)}
                    >
                      {t('provimux.models.other_hide')}
                    </button>
                  ) : null}
                </>
              ) : (
                <button
                  type="button"
                  className={styles.fold}
                  aria-expanded={false}
                  onClick={() => setOtherOpen(true)}
                >
                  <span>{t('provimux.models.other_show', { count: parts.rest.length })}</span>
                  <span className={styles.foldSample}>
                    {parts.rest
                      .slice(0, 6)
                      .map((item) => item.name)
                      .join(', ')}
                    {parts.rest.length > 6 ? ', …' : ''}
                  </span>
                </button>
              )
            )
          : null}
      </fieldset>

      <ModelsSettings
        models={routes?.models ?? []}
        offsetMs={props.routesOffsetMs}
        nowMs={nowMs}
        devin={props.devin}
        withDevin={withDevin}
        withOpenRouter={withOpenRouter}
        lists={lists}
        onRoutesChanged={props.onRoutesChanged}
        onListsChanged={props.onRoutesChanged}
        onShowOpenRouter={() => onFilter({ ...EMPTY_MODELS_FILTER, provider: 'openrouter' })}
      />

      <p className={shared.note}>
        <IconInfo size={13} />
        <span>{t('provimux.models.order_note')}</span>
      </p>
    </>
  );
}

/** The DOM id of a name's card (its key may hold any character). */
const cardIdOf = (key: string) =>
  `pmx-name-${Array.from(key)
    .map((c) => (/[a-z0-9-]/.test(c) ? c : `_${c.codePointAt(0)!.toString(16)}`))
    .join('')}`;

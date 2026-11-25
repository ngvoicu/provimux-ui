import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconAlertTriangle, IconInfo, IconPlus, IconSearch, IconX } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { getTypeLabel } from '@/features/authFiles/constants';
import type {
  ProvimuxModelListsResponse,
  ProvimuxModelRoutesResponse,
  ProvimuxNamesResponse,
} from '../../api/types';
import { familyLabel } from '../aliases/labels';
import { draftEntries } from '../aliases/draft';
import type { AliasDraft } from '../aliases/types';
import { compatibleEntryOf, isOpenRouterHost } from '../modelRoutes/logic';
import type { DevinCooling } from '../modelRoutes/useDevinCooling';
import {
  EMPTY_MODELS_FILTER,
  accountNameOf,
  buildNames,
  candidatesFor,
  matches,
  nameKey,
  sections,
  summarizeNames,
  type ModelDetail,
  type ModelsFilter,
  type NameItem,
  type NameView,
  type RouteLine,
  type Section,
} from './catalog';
import type { ExclusionWriteRequest } from '../excluded/ExcludedView';
import { placeInline } from '../excluded/labels';
import { IconLiveLists } from '../../components/ProvimuxIcons';
import { accountsAddressToAdd } from '../shared/accountsLink';
import { placesExcluding, readExclusions, type Exclusion } from '../excluded/exclusions';
import { NameCard } from './NameCard';
import {
  byUse,
  copyKeysOf,
  levelCopiesOf,
  servedCopiesOf,
  otherMatches,
  othersOf,
  readSetting,
  refusedOf,
  setNamesOf,
  switchState,
  unkeepBody,
  yourNameKeys,
  yourNamesOf,
  type OtherItem,
  type UsageState,
} from './namesSetting';
import {
  NotServedSection,
  OnlyMyNamesSwitch,
  RefusedStrip,
  type NamesState,
  type NamesWrite,
} from './OnlyMyNames';
import { NameComposer } from './NameEditor';
import type { NamesApplying } from './namesApplied';
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
  details?: Record<string, Record<string, ModelDetail>>;
  nowMs: number;
  filter: ModelsFilter;
  onFilter: (next: ModelsFilter) => void;
  edit: (change: (draft: AliasDraft) => AliasDraft) => void;
  devin: DevinCooling;
  onRoutesChanged: () => void;
  /** A name's "excluded" mark: Excluded models, searched for that name. */
  onShowExcluded?: (model: string) => void;
  /** OpenAI-compatible entries have exclusions of their own (a server with self-refreshing key lists). */
  compatibleExclusions?: boolean;
  /** The draft has edits not saved: an exclusion, written at once, waits until they are saved or discarded. */
  dirty?: boolean;
  /** The exclusion being written: its id. */
  writing?: string | null;
  /** One exclusion written at once (Excluded models' own write), for a learned model a subscription serves. */
  onWriteExclusion?: (request: ExclusionWriteRequest, writing: string) => Promise<boolean>;
  /** "Serve only my names" (models-page.md 8); absent, or without an answer, where the gateway has none. */
  names?: BoardNames;
}

/** What the page read of "Serve only my names", and its one write. */
export interface BoardNames {
  /** GET /provimux/names; null until it answers (or on a gateway without it). */
  answer: ProvimuxNamesResponse | null;
  /** The last read failed (not a 404, which hides the switch). */
  error: string | null;
  usage: UsageState;
  /** The day from which the names tools sent are counted, when it falls inside the 30 days. */
  usageSince?: string | null;
  /** The page's last write is not applied by the gateway yet (within the limit, or past it). */
  applying?: NamesApplying;
  write: (write: NamesWrite) => Promise<boolean>;
  /** Reads the 30 days' usage again: the preview counts the names used, and the page may have been open for long. */
  refreshUsage?: () => void;
}

/** The DOM id of "Not served". */
const NOT_SERVED_ID = 'pmx-models-not-served';

/** How many of the other models are drawn at once; the rest on "Show more". */
const OTHER_PAGE = 60;

const byUseThenName = (a: NameItem, b: NameItem) =>
  (b.requests ?? 0) - (a.requests ?? 0) || a.name.localeCompare(b.name);

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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [notServedOpen, setNotServedOpen] = useState(false);

  const entries = useMemo(() => draftEntries(draft), [draft]);
  const { details } = props;
  // "Serve only my names": whose names the gateway counts (the read's keep, its login-file names), and the rest.
  const namesAnswer = props.names?.answer ?? null;
  const setting = useMemo(() => readSetting(draft.base.document), [draft.base.document]);
  const setNames = useMemo(
    () => (namesAnswer ? setNamesOf(namesAnswer, setting) : undefined),
    [namesAnswer, setting]
  );
  const allItems = useMemo(
    () => buildNames({ draft, routes, lists, usage, nowMs, details, setNames }),
    [draft, routes, lists, usage, nowMs, details, setNames]
  );
  const yours = useMemo(
    () => (namesAnswer ? yourNameKeys(namesAnswer, setting) : new Set<string>()),
    [namesAnswer, setting]
  );
  const others = useMemo(
    () => (namesAnswer ? othersOf(namesAnswer, yours, usage) : []),
    [namesAnswer, yours, usage]
  );
  // An account's prefixed copy of one of his names, or one of them with a thinking level, is served with it: the
  // gateway lists them (`copies`).
  const alsoServed = useMemo(() => copyKeysOf(namesAnswer), [namesAnswer]);
  // A spelling with a thinking level (`opus(high)`) is not a name of its own: it is drawn on the card of the id it
  // spells (`opus`), and counted with it. Without that card (not on the page), it keeps a card of its own.
  const levelsByBase = useMemo(() => {
    const byBase = new Map<string, string[]>();
    const keys = new Set(allItems.map((item) => item.key));
    for (const [id, base] of levelCopiesOf(namesAnswer)) {
      if (!keys.has(base) || !keys.has(id)) continue;
      byBase.set(base, [...(byBase.get(base) ?? []), id].sort());
    }
    return byBase;
  }, [allItems, namesAnswer]);
  const levelKeys = useMemo(() => new Set([...levelsByBase.values()].flat()), [levelsByBase]);
  const onlyMine = namesAnswer !== null && switchState(namesAnswer) === 'on';
  // Home decides names itself: the switch says so, and the list's words do not point at it.
  const namesApply = namesAnswer !== null && switchState(namesAnswer) !== 'not-applied';
  // With the switch on, the cards are his names (and what is served with them); everything else is a row of
  // "Not served".
  const items = useMemo(
    () =>
      (onlyMine
        ? allItems.filter((item) => item.own || item.fresh || alsoServed.has(item.key))
        : allItems
      ).filter((item) => !levelKeys.has(item.key)),
    [allItems, alsoServed, levelKeys, onlyMine]
  );
  const notServed = useMemo((): OtherItem[] => {
    if (!onlyMine) return [];
    const list = [...others];
    const listed = new Set(list.map((other) => other.key));
    for (const item of allItems) {
      if (item.own || item.fresh || listed.has(item.key) || alsoServed.has(item.key)) continue;
      list.push({ key: item.key, name: item.name, requests: item.requests, accounts: [] });
    }
    return list.sort(byUse);
  }, [allItems, alsoServed, onlyMine, others]);
  const summary = useMemo(() => summarizeNames(items), [items]);
  // Where each name is excluded (by its name or a model it sends upstream), for its mark and link.
  const compatibleExclusions = props.compatibleExclusions === true;
  const exclusionState = useMemo(
    () => readExclusions(draft.base, { compatible: compatibleExclusions }),
    [draft.base, compatibleExclusions]
  );
  const exclusions = exclusionState.exclusions;
  const { onWriteExclusion } = props;
  /** "Exclude it on this key": the key's place, the model as its service lists it, written at once. */
  const excludeOnKey = useCallback(
    (line: RouteLine, model: string) => {
      const place = exclusionState.places.find(
        (candidate) => candidate.kind === 'key' && candidate.entry.id === line.entryId
      );
      if (!place || !onWriteExclusion) return;
      void onWriteExclusion(
        {
          change: { place, rule: model, excluded: true },
          model,
          place: placeInline(t, place),
        },
        `${place.id}|${model.toLowerCase()}`
      );
    },
    [exclusionState.places, onWriteExclusion, t]
  );
  const excludeBlocked =
    props.writing != null
      ? t('provimux.models.paid_exclude_busy')
      : props.dirty
        ? t('provimux.models.paid_exclude_dirty')
        : locked
          ? t('provimux.models.paid_exclude_busy')
          : null;
  const namesWrite = props.names?.write;
  const namesState = useMemo((): NamesState | null => {
    if (!namesAnswer || !namesWrite) return null;
    const blocked = props.dirty
      ? t('provimux.names.blocked_dirty')
      : setting.unreadable
        ? t('provimux.names.blocked_unreadable')
        : draft.base.etag === null
          ? t('provimux.names.blocked_no_tag')
          : null;
    return {
      answer: namesAnswer,
      setting,
      yours,
      others,
      alsoServed: servedCopiesOf(namesAnswer),
      usage: props.names?.usage ?? 'unknown',
      usageSince: props.names?.usageSince ?? null,
      applying: props.names?.applying ?? null,
      blocked,
      busy: locked || props.writing != null || props.names?.applying === 'applying',
      writing: props.writing ?? null,
      write: namesWrite,
      nowMs,
    };
  }, [
    namesAnswer,
    namesWrite,
    props.dirty,
    props.names?.usage,
    props.names?.usageSince,
    props.names?.applying,
    props.writing,
    setting,
    draft.base.etag,
    locked,
    yours,
    others,
    alsoServed,
    nowMs,
    t,
  ]);
  /** His names as the preview's chips show them: kept ones can stop being kept there. */
  const yourNames = useMemo(
    () => yourNamesOf(namesAnswer, setNames, yours),
    [namesAnswer, setNames, yours]
  );
  const refused = useMemo(() => refusedOf(namesAnswer, yours), [namesAnswer, yours]);
  const unkeep = useCallback(
    (name: string) => {
      if (!namesWrite) return;
      void namesWrite({
        body: unkeepBody(setting, name),
        kind: 'unkeep',
        names: [name],
        id: `unkeep|${nameKey(name)}`,
      });
    },
    [namesWrite, setting]
  );
  const refreshUsage = props.names?.refreshUsage;
  const openPreview = useCallback(
    (open: boolean) => {
      setPreviewOpen(open);
      if (open) refreshUsage?.();
    },
    [refreshUsage]
  );
  const showNotServed = useCallback(() => {
    setNotServedOpen(true);
    window.requestAnimationFrame(() =>
      document.getElementById(NOT_SERVED_ID)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    );
  }, []);

  const keyPlaces = useMemo(
    () =>
      new Set(
        exclusionState.places.flatMap((place) => (place.kind === 'key' ? [place.entry.id] : []))
      ),
    [exclusionState.places]
  );
  const excludedByName = useMemo(() => {
    const byName = new Map<string, Exclusion[]>();
    if (!exclusions.length) return byName;
    for (const item of items) {
      const found = placesExcluding(exclusions, [item.name, ...item.lines.map((l) => l.upstream)]);
      if (found.length) byName.set(item.key, found);
    }
    return byName;
  }, [exclusions, items]);
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
      push(
        filter.provider,
        filter.provider.startsWith('account:')
          ? t('provimux.models.source_account', { name: accountNameOf(routes, entries, raw) })
          : (compatibleEntryOf(raw) ?? getTypeLabel(t, raw))
      );
    }
    return options;
  }, [entries, filter.provider, routes, t]);

  const views: Array<{ value: NameView; label: string }> = [
    { value: 'all', label: t('provimux.models.view_all') },
    { value: 'several', label: t('provimux.models.view_several') },
    { value: 'cooling', label: t('provimux.models.view_cooling') },
    { value: 'problems', label: t('provimux.models.view_problems') },
    // Shown once a key learned a model, or while the address asks for it.
    ...(summary.learned > 0 || filter.view === 'learned' || filter.view === 'paid'
      ? [{ value: 'learned' as const, label: t('provimux.models.view_learned') }]
      : []),
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
      excludedIn={excludedByName.get(item.key)}
      onShowExcluded={props.onShowExcluded}
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
      onExclude={
        onWriteExclusion &&
        item.lines.some((line) => line.learned && keyPlaces.has(line.entryId ?? ''))
          ? excludeOnKey
          : undefined
      }
      excludeBlocked={excludeBlocked}
      onUnkeep={namesState ? unkeep : undefined}
      keepBlocked={
        namesState?.blocked ?? (namesState?.busy ? t('provimux.names.blocked_busy') : null)
      }
      keepWriting={props.writing === `unkeep|${item.key}`}
      servedOnlyMine={onlyMine}
      levels={levelsByBase.get(item.key)}
    />
  );

  const section = (id: Section | 'copies', list: NameItem[], body?: ReactNode) => (
    <section className={styles.section} aria-labelledby={`pmx-models-${id}`}>
      <div className={styles.sectionHead}>
        <h2 id={`pmx-models-${id}`} className={styles.sectionTitle}>
          {id === 'copies'
            ? t('provimux.names.section_copies')
            : t(`provimux.models.section_${id}`)}
          <span className={styles.sectionCount}>{list.length}</span>
        </h2>
        <p className={styles.sectionHint}>
          {id === 'copies'
            ? t('provimux.names.section_copies_hint')
            : id === 'yours' && namesApply
              ? t('provimux.names.section_yours_hint')
              : t(`provimux.models.section_${id}_hint`)}
        </p>
      </div>
      {body ?? <div className={styles.cards}>{list.map(card)}</div>}
    </section>
  );

  // With the switch on, the cards that are not his names are the prefixed copies served with them (8.4): one
  // section of their own, most used first, instead of "Used in the last 30 days" and "Other models".
  const copies = useMemo(
    () => (onlyMine ? [...parts.used, ...parts.rest].sort(byUseThenName) : []),
    [onlyMine, parts]
  );
  const showOther = narrowed || otherOpen;
  const otherShown = parts.rest.slice(0, otherLimit);

  const notServedShown = useMemo(
    () => (narrowed ? notServed.filter((item) => otherMatches(item, filter, entries)) : notServed),
    [entries, filter, narrowed, notServed]
  );

  return (
    <>
      {namesState ? (
        <OnlyMyNamesSwitch
          state={namesState}
          yourNames={yourNames}
          previewOpen={previewOpen}
          onPreview={openPreview}
          onShowNotServed={showNotServed}
        />
      ) : props.names?.error ? (
        <p className={shared.inlineError} role="alert">
          {t('provimux.names.read_failed', { message: props.names.error })}
        </p>
      ) : null}
      {namesState && onlyMine ? <RefusedStrip state={namesState} refused={refused} /> : null}

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
          title={t('provimux.models.count_several_title')}
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
        {summary.learned > 0 ? (
          <button
            type="button"
            className={`${shared.chip} ${styles.chipLearned}`}
            aria-pressed={filter.view === 'learned'}
            title={t('provimux.models.count_learned_title')}
            onClick={() => toggleView('learned')}
          >
            <IconLiveLists size={13} aria-hidden="true" />
            {t('provimux.models.count_learned', { count: summary.learned })}
          </button>
        ) : null}
        {summary.paid > 0 ? (
          <button
            type="button"
            className={`${shared.chip} ${styles.chipPaid}`}
            aria-pressed={filter.view === 'paid'}
            title={t('provimux.models.count_paid_title')}
            onClick={() => toggleView('paid')}
          >
            <IconAlertTriangle size={13} />
            {t('provimux.models.count_paid', { count: summary.paid })}
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
                <Link to={accountsAddressToAdd()} className={styles.link}>
                  {t('provimux.models.empty_link_accounts')}
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
                  <p className={styles.sectionEmpty}>
                    {namesApply
                      ? t('provimux.names.yours_empty')
                      : t('provimux.models.yours_empty')}
                  </p>
                ) : undefined
              )
            : null}
        {/* With it on, only what is served is drawn here: his names, their prefixed
        copies, then Not served (8.4). */}
        {onlyMine && copies.length ? section('copies', copies) : null}
        {namesState && onlyMine ? (
          filter.view === 'all' && (notServedShown.length || !narrowed) ? (
            <NotServedSection
              id={NOT_SERVED_ID}
              state={namesState}
              items={notServedShown}
              open={notServedOpen}
              onOpen={setNotServedOpen}
              narrowed={narrowed}
            />
          ) : null
        ) : null}
        {!onlyMine && parts.used.length ? section('used', parts.used) : null}
        {!onlyMine && parts.rest.length
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

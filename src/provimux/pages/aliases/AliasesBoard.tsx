import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconAlertTriangle, IconInfo, IconPlus, IconSearch, IconX } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { draftEntries, loginMapUnread, rowIssues } from './draft';
import { groupOfRow, nameGroups } from './collisions';
import { entryChanged } from './plan';
import {
  LOGIN_CHANNELS,
  aliasCount,
  blockingCount,
  entryHaystack,
  isClash,
  keyListUnread,
  providerKeyOf,
  removedCounts,
  rowMarks,
  siblingsOf,
  visibleRows,
  type AliasFilter,
  type RowView,
  type StoreFilter,
} from './pageLogic';
import { AliasRowLine, VerdictDetail, type RowActions } from './AliasRowLine';
import { channelLabel, entryLabelOf, familyLabel, providerLabelOf } from './labels';
import { ProviderLogo, ServicePill } from './ProviderMarks';
import { ALIAS_FAMILIES } from './rows';
import type {
  AliasDraft,
  AliasEntry,
  AliasRow,
  KeyEntry,
  LoginEntry,
  NameGroup,
  ServedNames,
} from './types';
import shared from '../shared/Shared.module.scss';
import styles from './AliasesPage.module.scss';

export interface BoardActions extends RowActions {
  addLoginAlias: (channel: string) => void;
  undoEntry: (entryId: string) => void;
}

export interface AliasesBoardProps {
  draft: AliasDraft;
  /** undefined while the first answer is awaited. */
  served: ServedNames | undefined;
  filter: AliasFilter;
  onFilter: (next: AliasFilter) => void;
  texts: Record<string, string>;
  suggestions: Record<string, string[]>;
  focusRowId: string | null;
  /** Nothing can be edited (3.6: `!canEdit`): the entries' fieldset is disabled; filters still work. */
  locked: boolean;
  actions: BoardActions;
}

const suggestionsIdOf = (channel: string) => `pmx-alias-models-${channel}`;

/**
 * The board for one draft: summary, name check, filters, and the entries with their rows inside one
 * fieldset, disabled while `locked`. The notes about the read (no tag, unread parts) are the frame's
 * (AliasesBody). Exported for static rendering in tests; the page (AliasesPage) owns the state.
 */
export function AliasesBoard({
  draft,
  served,
  filter,
  onFilter,
  texts,
  suggestions,
  focusRowId,
  locked,
  actions,
}: AliasesBoardProps) {
  const { t } = useTranslation();
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const [channelText, setChannelText] = useState('');

  const entries = useMemo(() => draftEntries(draft), [draft]);
  const issues = useMemo(() => rowIssues(draft), [draft]);
  const groups = useMemo(() => nameGroups(draft, served), [draft, served]);
  const groupOf = useMemo(() => groupOfRow(groups), [groups]);
  const groupsByKey = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups]);
  const marks = useMemo(() => rowMarks(draft), [draft]);
  const removed = useMemo(() => removedCounts(draft), [draft]);
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const rowById = useMemo(() => new Map(draft.rows.map((r) => [r.id, r])), [draft]);
  const haystacks = useMemo(
    () => Object.fromEntries(entries.map((e) => [e.id, entryHaystack(e, providerLabelOf(t, e))])),
    [entries, t]
  );
  const visible = useMemo(
    () =>
      visibleRows({
        draft,
        filter,
        issues,
        groups,
        groupOfRow: groupOf,
        marks,
        haystacks,
        texts,
      }),
    [draft, filter, issues, groups, groupOf, marks, haystacks, texts]
  );

  // Per name, the services only the proxy reports: no row of the name is in them.
  const nativeOnly = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const group of groups) {
      const rowServices = new Set(
        group.rowIds.map((id) => entryById.get(rowById.get(id)?.entryId ?? '')?.service)
      );
      result.set(group.key, new Set(group.services.filter((s) => !rowServices.has(s))));
    }
    return result;
  }, [groups, entryById, rowById]);

  const clashes = groups.filter(isClash);
  const fine = groups.filter((g) => g.verdict === 'several-keys' || g.pool).length;
  const toFix = blockingCount(issues);
  const aliases = aliasCount(draft.rows);
  const set = (patch: Partial<AliasFilter>) => onFilter({ ...filter, ...patch });

  const chosenProvider = filter.provider;
  const providerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries) {
      const key = providerKeyOf(entry);
      if (seen.has(key)) continue;
      seen.set(
        key,
        entry.store === 'login'
          ? t('provimux.aliases.service_login', { name: channelLabel(t, entry.channel) })
          : t('provimux.aliases.service_key', { name: familyLabel(t, entry.family) })
      );
    }
    const options = [{ value: 'all', label: t('provimux.aliases.all_providers') }];
    for (const [value, label] of seen) options.push({ value, label });
    if (chosenProvider !== 'all' && !seen.has(chosenProvider)) {
      options.push({ value: chosenProvider, label: chosenProvider.replace(/^[a-z]+:/, '') });
    }
    return options;
  }, [entries, chosenProvider, t]);

  const keyEntries = visible.entries.filter((e): e is KeyEntry => e.store === 'api-key');
  const loginEntries = visible.entries.filter((e): e is LoginEntry => e.store === 'login');
  const anyLogin = entries.some((e) => e.store === 'login');
  // 2.5: the login alias map itself cannot be read: no login alias can be edited or added.
  const mapUnread = loginMapUnread(draft.base);
  const presentChannels = new Set(
    entries.filter((e): e is LoginEntry => e.store === 'login').map((e) => e.channel)
  );
  const showLogins = filter.store !== 'api-key';
  const showKeys = filter.store !== 'login';
  const filtered =
    filter.query !== '' ||
    filter.store !== 'all' ||
    filter.provider !== 'all' ||
    filter.view !== 'all' ||
    filter.name !== null;

  const stores: Array<{ value: StoreFilter; label: string }> = [
    { value: 'all', label: t('provimux.aliases.store_all') },
    { value: 'api-key', label: t('provimux.aliases.store_keys') },
    { value: 'login', label: t('provimux.aliases.store_logins') },
  ];
  const views: Array<{ value: RowView; label: string }> = [
    { value: 'all', label: t('provimux.aliases.view_all') },
    { value: 'aliased', label: t('provimux.aliases.view_aliased') },
    { value: 'attention', label: t('provimux.aliases.view_attention') },
  ];

  const renderRows = (entry: AliasEntry, rows: AliasRow[], locked = false) => (
    <ul className={styles.rows}>
      {rows.map((row) => {
        const group = groupsByKey.get(groupOf[row.id]);
        return (
          <AliasRowLine
            key={row.id}
            row={row}
            entry={entry}
            entryLabel={entryLabelOf(t, entry)}
            entries={entries}
            issue={issues[row.id]}
            group={group}
            nativeOnly={(group && nativeOnly.get(group.key)) ?? new Set()}
            mark={marks[row.id] ?? null}
            text={texts[row.id]}
            forceModelPrefix={draft.base.forceModelPrefix}
            hasTwin={draft.rows.some(
              (other) =>
                other.id !== row.id &&
                other.entryId === row.entryId &&
                other.upstream.trim() === row.upstream.trim()
            )}
            suggestionsId={entry.store === 'login' ? suggestionsIdOf(entry.channel) : undefined}
            autoFocus={focusRowId === row.id}
            open={openDetail === row.id}
            onToggle={() => setOpenDetail((prev) => (prev === row.id ? null : row.id))}
            locked={locked}
            actions={actions}
          />
        );
      })}
    </ul>
  );

  const entryNotes = (entry: AliasEntry) => {
    const gone = removed[entry.id] ?? 0;
    return gone ? (
      <p className={styles.entryNote}>{t('provimux.aliases.removed', { count: gone })}</p>
    ) : null;
  };

  const undoButton = (entry: AliasEntry) =>
    entryChanged(draft, entry.id) ? (
      <button type="button" className={styles.undo} onClick={() => actions.undoEntry(entry.id)}>
        {t('provimux.aliases.undo_entry')}
      </button>
    ) : null;

  const keyCard = (entry: KeyEntry) => {
    const rows = visible.rows.get(entry.id) ?? [];
    const siblings = entry.listSource === 'group' ? siblingsOf(entry, entries) : 0;
    const changed = entryChanged(draft, entry.id);
    return (
      <article
        key={entry.id}
        className={styles.entry}
        data-off={entry.disabled || undefined}
        data-changed={changed || undefined}
        aria-label={entryLabelOf(t, entry)}
      >
        <header className={styles.entryHead}>
          <div className={styles.entryTitles}>
            <h4 className={styles.entryName}>{entry.groupName || familyLabel(t, entry.family)}</h4>
            <div className={styles.entryMeta}>
              {entry.keyPreview ? (
                <span className={styles.metaMono}>{entry.keyPreview}</span>
              ) : (
                <span className={styles.meta}>
                  {t('provimux.aliases.entry_keys', { count: entry.keyCount })}
                </span>
              )}
              {entry.host ? <span className={styles.metaMono}>{entry.host}</span> : null}
              {entry.prefix ? (
                <span className={styles.metaMono} title={t('provimux.aliases.entry_prefix_hint')}>
                  {t('provimux.aliases.entry_prefix', { prefix: entry.prefix })}
                </span>
              ) : null}
              {entry.disabled ? (
                <span className={styles.metaOff}>{t('provimux.aliases.entry_off')}</span>
              ) : null}
            </div>
          </div>
          {undoButton(entry)}
        </header>
        {entryNotes(entry)}
        {entry.disabled ? (
          <p className={styles.entryNote}>{t('provimux.aliases.entry_off_note')}</p>
        ) : null}
        {entry.listSource === 'none' && keyListUnread(entry, draft.base.unread) ? (
          <div className={styles.entryEmpty}>
            <IconInfo size={14} />
            <p>{t('provimux.aliases.entry_list_unread')}</p>
          </div>
        ) : entry.listSource === 'none' ? (
          <div className={styles.entryEmpty}>
            <IconInfo size={14} />
            <p>
              {t('provimux.aliases.entry_no_list')}{' '}
              <Link to="/ai-providers" className={styles.link}>
                {t('provimux.aliases.entry_no_list_link')}
              </Link>
            </p>
          </div>
        ) : (
          <>
            {siblings > 0 ? (
              <p className={styles.entryNote}>
                {t('provimux.aliases.entry_inherits', { count: siblings })}
              </p>
            ) : null}
            {rows.length ? renderRows(entry, rows) : null}
          </>
        )}
      </article>
    );
  };

  const loginCard = (entry: LoginEntry) => {
    const rows = visible.rows.get(entry.id) ?? [];
    const changed = entryChanged(draft, entry.id);
    const allRows = draft.rows.filter((row) => row.entryId === entry.id);
    const models = [
      ...new Set([
        ...(suggestions[entry.channel] ?? []),
        ...allRows.map((row) => row.upstream.trim()).filter(Boolean),
      ]),
    ];
    return (
      <article
        key={entry.id}
        className={styles.entry}
        data-changed={changed || undefined}
        aria-label={entryLabelOf(t, entry)}
      >
        <header className={styles.entryHead}>
          <ProviderLogo channel={entry.channel} />
          <div className={styles.entryTitles}>
            <h3 className={styles.entryName}>
              {t('provimux.aliases.service_login', { name: channelLabel(t, entry.channel) })}
            </h3>
            <div className={styles.entryMeta}>
              {entry.loginCount !== null ? (
                <span className={styles.meta}>
                  {entry.loginCount > 0
                    ? t('provimux.aliases.login_count', { count: entry.loginCount })
                    : t('provimux.aliases.login_none_yet')}
                </span>
              ) : null}
              {entry.spellings.length > 1 ? (
                <span className={styles.meta}>
                  {t('provimux.aliases.login_spellings', {
                    spellings: entry.spellings.join(', '),
                    channel: entry.channel,
                  })}
                </span>
              ) : null}
            </div>
          </div>
          {undoButton(entry)}
        </header>
        {entryNotes(entry)}
        {entry.unread && !mapUnread ? (
          <div className={styles.entryEmpty}>
            <IconInfo size={14} />
            <p>{t('provimux.aliases.login_unread')}</p>
          </div>
        ) : null}
        <datalist id={suggestionsIdOf(entry.channel)}>
          {models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        {rows.length ? (
          renderRows(entry, rows, entry.unread)
        ) : allRows.length === 0 && !entry.unread ? (
          <p className={styles.entryNote}>{t('provimux.aliases.login_empty')}</p>
        ) : null}
        {entry.unread ? null : (
          <div className={styles.entryFoot}>
            <button
              type="button"
              className={styles.add}
              onClick={() => actions.addLoginAlias(entry.channel)}
            >
              <IconPlus size={14} />
              {t('provimux.aliases.add_login_alias')}
            </button>
          </div>
        )}
      </article>
    );
  };

  const families = ALIAS_FAMILIES.map((family) => ({
    family,
    entries: keyEntries.filter((entry) => entry.family === family),
  })).filter((part) => part.entries.length > 0);

  const channelChoices = LOGIN_CHANNELS.filter((channel) => !presentChannels.has(channel));
  const addChannel = () => {
    const channel = channelText.trim();
    if (!channel) return;
    actions.addLoginAlias(channel);
    setChannelText('');
  };

  return (
    <>
      <div className={shared.chips} aria-label={t('provimux.aliases.summary_label')}>
        <span className={shared.chip}>
          {t('provimux.aliases.count_aliases', { count: aliases })}
        </span>
        <button
          type="button"
          className={shared.chip}
          data-tone={clashes.length ? 'cooling' : 'ok'}
          aria-pressed={filter.view === 'attention'}
          disabled={clashes.length === 0 && toFix === 0}
          onClick={() => set({ view: filter.view === 'attention' ? 'all' : 'attention' })}
        >
          {clashes.length ? <IconAlertTriangle size={13} /> : null}
          {t('provimux.aliases.count_clashes', { count: clashes.length })}
        </button>
        {toFix ? (
          <button
            type="button"
            className={`${shared.chip} ${styles.chipError}`}
            aria-pressed={filter.view === 'attention'}
            onClick={() => set({ view: filter.view === 'attention' ? 'all' : 'attention' })}
          >
            {t('provimux.aliases.count_to_fix', { count: toFix })}
          </button>
        ) : null}
      </div>

      <section className={styles.check} aria-labelledby="pmx-aliases-check">
        <div className={styles.checkHead}>
          <h2 id="pmx-aliases-check" className={styles.checkTitle}>
            {t('provimux.aliases.check_title')}
          </h2>
          {served === undefined ? (
            <span className={styles.checkStatus}>{t('provimux.aliases.native_checking')}</span>
          ) : null}
        </div>
        {clashes.length ? (
          <>
            <p className={styles.checkLede}>{t('provimux.aliases.check_lede')}</p>
            <ul className={styles.clashes}>
              {clashes.map((group) => (
                <ClashLine
                  key={group.key}
                  group={group}
                  entries={entries}
                  nativeOnly={nativeOnly.get(group.key) ?? new Set()}
                  active={filter.name === group.key}
                  onShow={() =>
                    set({
                      name: filter.name === group.key ? null : group.key,
                      view: 'all',
                      query: '',
                      store: 'all',
                      provider: 'all',
                    })
                  }
                />
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.checkClear}>{t('provimux.aliases.check_clear')}</p>
        )}
        {fine ? (
          <p className={styles.checkFine}>{t('provimux.aliases.check_fine', { count: fine })}</p>
        ) : null}
        {served && !served.known ? (
          <p className={shared.note}>
            <IconInfo size={13} />
            <span>{t('provimux.aliases.native_unknown')}</span>
          </p>
        ) : null}
      </section>

      <div className={shared.toolbar}>
        <label className={shared.search}>
          <IconSearch size={15} className={shared.searchIcon} />
          <input
            type="search"
            value={filter.query}
            placeholder={t('provimux.aliases.search_placeholder')}
            aria-label={t('provimux.aliases.search_placeholder')}
            onChange={(event) => set({ query: event.target.value })}
          />
        </label>
        <div
          className={shared.segmented}
          role="group"
          aria-label={t('provimux.aliases.store_label')}
        >
          {stores.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter.store === option.value}
              onClick={() => set({ store: option.value, provider: 'all' })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className={shared.providerSelect}>
          <Select
            value={filter.provider}
            options={providerOptions}
            onChange={(value) => set({ provider: value })}
            ariaLabel={t('provimux.aliases.provider_label')}
            size="sm"
          />
        </div>
        <div
          className={shared.segmented}
          role="group"
          aria-label={t('provimux.aliases.view_label')}
        >
          {views.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter.view === option.value}
              onClick={() => set({ view: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        {filter.name ? (
          <span className={styles.nameFilter}>
            {t('provimux.aliases.name_filter', {
              name: groupsByKey.get(filter.name)?.name ?? filter.name,
            })}
            <button
              type="button"
              aria-label={t('provimux.aliases.name_filter_clear')}
              title={t('provimux.aliases.name_filter_clear')}
              onClick={() => set({ name: null })}
            >
              <IconX size={12} />
            </button>
          </span>
        ) : null}
        {filtered ? (
          <button
            type="button"
            className={shared.clear}
            onClick={() =>
              onFilter({ query: '', store: 'all', provider: 'all', view: 'all', name: null })
            }
          >
            <IconX size={12} />
            {t('provimux.common.clear_filters')}
          </button>
        ) : null}
      </div>

      {filtered && visible.entries.length === 0 ? (
        <p className={styles.noMatch}>{t('provimux.aliases.no_match')}</p>
      ) : null}

      <fieldset className={styles.entriesBox} disabled={locked}>
        {showKeys && families.length ? (
          <section className={styles.section} aria-labelledby="pmx-aliases-keys">
            <h2 id="pmx-aliases-keys" className={styles.sectionTitle}>
              {t('provimux.aliases.section_keys')}
            </h2>
            {families.map(({ family, entries: familyEntries }) => (
              <div key={family} className={styles.family}>
                <h3 className={styles.familyTitle}>
                  <ProviderLogo family={family} />
                  {familyLabel(t, family)}
                </h3>
                <div className={styles.entries}>{familyEntries.map((entry) => keyCard(entry))}</div>
              </div>
            ))}
          </section>
        ) : null}

        {showLogins && (loginEntries.length || !filtered) ? (
          <section className={styles.section} aria-labelledby="pmx-aliases-logins">
            <h2 id="pmx-aliases-logins" className={styles.sectionTitle}>
              {t('provimux.aliases.section_logins')}
            </h2>
            {mapUnread ? (
              <div className={styles.entryEmpty}>
                <IconInfo size={14} />
                <p>{t('provimux.aliases.login_map_unread')}</p>
              </div>
            ) : null}
            {anyLogin ? (
              <p className={shared.note}>
                <IconInfo size={13} />
                <span>
                  {t('provimux.aliases.login_file_note')}{' '}
                  <Link to="/auth-files" className={styles.link}>
                    {t('provimux.aliases.login_file_link')}
                  </Link>
                </span>
              </p>
            ) : null}
            <div className={styles.entries}>
              {loginEntries.map((entry) => (
                <Fragment key={entry.id}>{loginCard(entry)}</Fragment>
              ))}
            </div>
            {!filtered && !mapUnread ? (
              <form
                className={styles.addChannel}
                onSubmit={(event) => {
                  event.preventDefault();
                  addChannel();
                }}
              >
                <label htmlFor="pmx-aliases-channel">{t('provimux.aliases.add_channel')}</label>
                <input
                  id="pmx-aliases-channel"
                  className={styles.input}
                  value={channelText}
                  list="pmx-aliases-channels"
                  placeholder={t('provimux.aliases.add_channel_placeholder')}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setChannelText(event.target.value)}
                />
                <datalist id="pmx-aliases-channels">
                  {channelChoices.map((channel) => (
                    <option key={channel} value={channel}>
                      {channelLabel(t, channel)}
                    </option>
                  ))}
                </datalist>
                <button type="submit" className={styles.add} disabled={!channelText.trim()}>
                  <IconPlus size={14} />
                  {t('provimux.aliases.add_channel_button')}
                </button>
              </form>
            ) : null}
          </section>
        ) : null}
      </fieldset>
    </>
  );
}

function ClashLine({
  group,
  entries,
  nativeOnly,
  active,
  onShow,
}: {
  group: NameGroup;
  entries: readonly AliasEntry[];
  nativeOnly: ReadonlySet<string>;
  active: boolean;
  onShow: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className={styles.clash}>
      <span className={styles.clashName}>{group.name}</span>
      <div className={styles.clashBody}>
        {group.verdict === 'several-services' ? (
          <div className={styles.services}>
            {group.services.map((service) => (
              <ServicePill
                key={service}
                service={service}
                entries={entries}
                native={nativeOnly.has(service)}
              />
            ))}
          </div>
        ) : (
          <div className={styles.clashModels}>
            <VerdictDetail group={group} entries={entries} nativeOnly={nativeOnly} />
          </div>
        )}
      </div>
      <button type="button" className={styles.show} aria-pressed={active} onClick={onShow}>
        {active ? t('provimux.aliases.name_filter_clear') : t('provimux.aliases.check_show')}
      </button>
    </li>
  );
}

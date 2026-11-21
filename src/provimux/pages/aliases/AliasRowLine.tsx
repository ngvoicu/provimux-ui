import { useId } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconPlus, IconX } from '@/components/ui/icons';
import { clientNames, nameKey } from './collisions';
import { isBlocking } from './draft';
import type { RowMark } from './pageLogic';
import { ServicePill } from './ProviderMarks';
import type { AliasEntry, AliasRow, NameGroup, RowIssue } from './types';
import styles from './AliasesPage.module.scss';

export interface RowActions {
  setAlias: (rowId: string, text: string) => void;
  setUpstream: (rowId: string, text: string) => void;
  setDisplayName: (rowId: string, text: string) => void;
  setFork: (rowId: string, value: boolean) => void;
  setForceMapping: (rowId: string, value: boolean) => void;
  addKeyAlias: (entryId: string, upstream: string) => void;
  removeRow: (rowId: string) => void;
  wantSuggestions: (channel: string) => void;
}

interface RowLineProps {
  row: AliasRow;
  entry: AliasEntry;
  /** "Claude · anthropic · key …0001": names the row's place for screen readers. */
  entryLabel: string;
  entries: readonly AliasEntry[];
  issue: RowIssue | undefined;
  group: NameGroup | undefined;
  mark: RowMark;
  /** The alias input's own text, when the page keeps one (the draft normalizes it). */
  text: string | undefined;
  forceModelPrefix: boolean;
  /** Another row of the entry has this model: removing this row deletes it. */
  hasTwin: boolean;
  /** Services of the row's name that only the proxy reports (no row of the name in them). */
  nativeOnly: ReadonlySet<string>;
  suggestionsId: string | undefined;
  autoFocus: boolean;
  open: boolean;
  onToggle: () => void;
  /** A row of a part the page cannot fully read (2.5): shown, not editable. */
  locked?: boolean;
  actions: RowActions;
}

/** The badge of a row's name: only verdicts worth a word (a single answer is the normal case). */
function verdictBadge(group: NameGroup | undefined, t: TFunction) {
  if (!group || group.verdict === 'single') return null;
  if (group.verdict === 'several-services') {
    return {
      tone: 'clash',
      text: t('provimux.aliases.verdict_services', { count: group.services.length }),
    };
  }
  if (group.verdict === 'several-models') {
    return group.pool
      ? {
          tone: 'info',
          text: t('provimux.aliases.verdict_pool', { count: group.upstreams.length }),
        }
      : {
          tone: 'clash',
          text: t('provimux.aliases.verdict_models', { count: group.upstreams.length }),
        };
  }
  return { tone: 'fine', text: t('provimux.aliases.verdict_keys') };
}

/** One stored model row: its model, its alias, the alias's options, and what the name check says. */
export function AliasRowLine({
  row,
  entry,
  entryLabel,
  entries,
  issue,
  group,
  mark,
  text,
  forceModelPrefix,
  hasTwin,
  nativeOnly,
  suggestionsId,
  autoFocus,
  open,
  onToggle,
  locked = false,
  actions,
}: RowLineProps) {
  const { t } = useTranslation();
  const uid = useId();
  const login = row.store === 'login';
  const aliasText = text ?? row.alias ?? '';
  const model = row.upstream.trim();
  const shownName = model || t('provimux.aliases.model_unnamed');
  const hasAlias = row.alias !== null || aliasText.trim() !== '';
  const typedOwnName =
    !login && aliasText.trim() !== '' && row.alias === null && aliasText.trim() === model;
  const loginOwnName =
    login && aliasText.trim() !== '' && nameKey(aliasText) === nameKey(row.upstream);
  const badge = verdictBadge(group, t);
  // With a prefix a key's row also answers as `<prefix>/<name>`, or only so when the prefix is forced.
  const answers = login || !model ? [] : clientNames(row, entry, forceModelPrefix);
  const base = (row.alias ?? row.upstream).trim();
  const extra = answers.filter((name) => name !== base);
  const onlyPrefixed = answers.length === 1 && extra.length === 1;
  const issueKey =
    issue === 'incomplete' && loginOwnName ? 'same_as_name' : issue?.replace(/-/g, '_');
  const blocking = isBlocking(issue);
  const detailId = `${uid}-detail`;
  const hintId = `${uid}-hint`;
  const removeLabel = login
    ? t('provimux.aliases.remove_login', { alias: aliasText.trim() || shownName })
    : hasTwin
      ? t('provimux.aliases.remove_row', { alias: aliasText.trim() || shownName })
      : t('provimux.aliases.remove_alias', { alias: aliasText.trim() });
  const canRemove = login || hasTwin || row.alias !== null;

  return (
    <li className={styles.row} data-store={row.store} data-mark={mark ?? undefined}>
      <div className={styles.rowLine}>
        <div className={styles.cellModel}>
          {login ? (
            <input
              className={styles.input}
              value={row.upstream}
              placeholder={t('provimux.aliases.model_placeholder')}
              aria-label={t('provimux.aliases.model_label', { entry: entryLabel })}
              list={suggestionsId}
              autoFocus={autoFocus}
              spellCheck={false}
              autoComplete="off"
              disabled={locked}
              onFocus={() => actions.wantSuggestions((entry as { channel: string }).channel)}
              onChange={(event) => actions.setUpstream(row.id, event.target.value)}
            />
          ) : (
            <>
              <span className={styles.modelName}>{shownName}</span>
              {row.displayName ? (
                <span className={styles.modelSub} title={t('provimux.aliases.display_from_form')}>
                  {row.displayName}
                </span>
              ) : null}
            </>
          )}
          {mark === 'new' ? (
            <span className={styles.markTag}>{t('provimux.aliases.new')}</span>
          ) : null}
        </div>

        <div className={styles.cellAlias}>
          <div className={styles.aliasLine}>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
            <input
              className={styles.input}
              data-alias
              data-invalid={blocking || undefined}
              value={aliasText}
              placeholder={
                login
                  ? t('provimux.aliases.login_alias_placeholder')
                  : t('provimux.aliases.alias_placeholder', { name: shownName })
              }
              aria-label={t('provimux.aliases.alias_label', {
                model: shownName,
                entry: entryLabel,
              })}
              aria-invalid={blocking || undefined}
              aria-describedby={hintId}
              autoFocus={autoFocus && !login}
              spellCheck={false}
              autoComplete="off"
              disabled={locked}
              onChange={(event) => actions.setAlias(row.id, event.target.value)}
            />
          </div>
          <div id={hintId} className={styles.hints}>
            {issueKey ? (
              <p className={styles.hint} data-tone={blocking ? 'error' : 'warn'}>
                {t(`provimux.aliases.issue_${issueKey}`)}
              </p>
            ) : null}
            {typedOwnName ? (
              <p className={styles.hint}>{t('provimux.aliases.same_as_name')}</p>
            ) : null}
            {extra.length ? (
              <p className={styles.hint}>
                {onlyPrefixed
                  ? t('provimux.aliases.answers_only', { name: extra[0] })
                  : t('provimux.aliases.also_answers', { names: extra.join(', ') })}
              </p>
            ) : null}
          </div>
        </div>

        {login ? (
          <div className={styles.cellDisplay}>
            <input
              className={styles.input}
              data-small
              value={row.displayName ?? ''}
              placeholder={t('provimux.aliases.display_placeholder')}
              aria-label={t('provimux.aliases.display_label', {
                alias: aliasText.trim() || shownName,
                entry: entryLabel,
              })}
              spellCheck={false}
              autoComplete="off"
              disabled={locked}
              onChange={(event) => actions.setDisplayName(row.id, event.target.value)}
            />
          </div>
        ) : null}

        <div className={styles.cellVerdict}>
          {badge ? (
            <button
              type="button"
              className={styles.badge}
              data-tone={badge.tone}
              aria-expanded={open}
              aria-controls={detailId}
              onClick={onToggle}
            >
              {badge.tone === 'clash' ? <IconAlertTriangle size={12} /> : null}
              {badge.text}
            </button>
          ) : null}
        </div>

        <div className={styles.cellOptions}>
          {login ? (
            <label className={styles.option} title={t('provimux.aliases.fork_hint')}>
              <input
                type="checkbox"
                checked={row.fork === true}
                disabled={locked}
                onChange={(event) => actions.setFork(row.id, event.target.checked)}
              />
              <span>{t('provimux.aliases.fork')}</span>
            </label>
          ) : null}
          {login || hasAlias || row.forceMapping === true ? (
            <label className={styles.option} title={t('provimux.aliases.force_mapping_hint')}>
              <input
                type="checkbox"
                checked={row.forceMapping === true}
                disabled={locked}
                onChange={(event) => actions.setForceMapping(row.id, event.target.checked)}
              />
              <span>{t('provimux.aliases.force_mapping')}</span>
            </label>
          ) : null}
        </div>

        <div className={styles.cellActions}>
          {!login ? (
            <button
              type="button"
              className={styles.iconButton}
              title={t('provimux.aliases.add_key_alias', { model: shownName })}
              aria-label={t('provimux.aliases.add_key_alias', { model: shownName })}
              onClick={() => actions.addKeyAlias(row.entryId, row.upstream)}
            >
              <IconPlus size={15} />
            </button>
          ) : null}
          <button
            type="button"
            className={styles.iconButton}
            data-danger
            title={removeLabel}
            aria-label={removeLabel}
            disabled={!canRemove || locked}
            onClick={() => actions.removeRow(row.id)}
          >
            <IconX size={15} />
          </button>
        </div>
      </div>

      {badge && open && group ? (
        <div id={detailId} className={styles.detail} data-tone={badge.tone}>
          <VerdictDetail group={group} entries={entries} nativeOnly={nativeOnly} />
        </div>
      ) : null}
    </li>
  );
}

/** What a name's verdict means, with the services or models behind it. */
export function VerdictDetail({
  group,
  entries,
  nativeOnly,
}: {
  group: NameGroup;
  entries: readonly AliasEntry[];
  nativeOnly: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  const name = group.name;
  if (group.verdict === 'several-services') {
    return (
      <>
        <p>{t('provimux.aliases.detail_services', { name })}</p>
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
        <p className={styles.detailHint}>{t('provimux.aliases.detail_services_hint')}</p>
      </>
    );
  }
  const models = group.upstreams.join(', ');
  if (group.verdict === 'several-models') {
    return (
      <p>
        {group.pool
          ? t('provimux.aliases.detail_pool', { name, models })
          : t('provimux.aliases.detail_models', { name, models })}
      </p>
    );
  }
  return <p>{t('provimux.aliases.detail_keys', { name })}</p>;
}

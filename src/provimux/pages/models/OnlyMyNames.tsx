import { useId, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconAlertTriangle, IconInfo, IconSearch, IconShield, IconX } from '@/components/ui/icons';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { ProvimuxNamesResponse, ProvimuxRefusedName } from '../../api/types';
import { compatibleEntryOf, isOpenRouterHost } from '../modelRoutes/logic';
import { formatClock, formatExact, formatRelative, timeMs } from '../time';
import { nameKey } from './catalog';
import {
  accountGroups,
  dropIgnoredBody,
  keepBody,
  offeredSpellingsOf,
  previewOf,
  thinkingBase,
  switchBody,
  switchState,
  unkeepBody,
  type AccountGroup,
  type OnlyMyNamesSetting,
  type OtherItem,
  type UsageState,
} from './namesSetting';
import { providerName } from './labels';
import type { NamesApplying } from './namesApplied';
import { formatDay } from '../savings/logic';
import shared from '../shared/Shared.module.scss';
import page from './ModelsPage.module.scss';
import styles from './OnlyMyNames.module.scss';

/** One write of the setting: the whole object, with what it means for the notification. */
export interface NamesWrite {
  body: Record<string, unknown>;
  kind: 'keep' | 'unkeep' | 'on' | 'off' | 'drop-ignored';
  /** The names kept or no longer kept; the ignored entries removed. */
  names: string[];
  /** Which button is busy while it runs. */
  id: string;
}

/** What the Models page holds of the setting, for the parts below. */
export interface NamesState {
  answer: ProvimuxNamesResponse;
  setting: OnlyMyNamesSetting;
  /** His names, by key (the gateway's list and the read's `keep`). */
  yours: ReadonlySet<string>;
  /** Every other name, used ones first. */
  others: readonly OtherItem[];
  /** Names served that are neither his nor among `others`: accounts' prefixed copies of his names. */
  alsoServed: number;
  usage: UsageState;
  /** The day from which the names tools sent are counted, when it falls inside the 30 days. */
  usageSince?: string | null;
  /** The page's last write is not applied by the gateway yet: the answer still describes the rule before it. */
  applying?: NamesApplying;
  /** Why nothing can be written now, said in a line (edits not saved, no tag); null when it can. */
  blocked: string | null;
  /** A write or a read is running: every action waits, without a line. */
  busy: boolean;
  /** The write running: its id. */
  writing: string | null;
  write: (write: NamesWrite) => Promise<boolean>;
  /** The server's now, for "2 minutes ago". */
  nowMs: number;
}

/** How many rows of a long list are drawn at once; the rest on "Show more". */
const ROWS_PAGE = 60;

// --- who serves a name ------------------------------------------------------------------------------------

function groupLabel(t: TFunction, group: AccountGroup): string {
  const named = isOpenRouterHost(group.host) || compatibleEntryOf(group.provider) !== null;
  const name =
    group.access === 'sub'
      ? t('provimux.models.source_login', { name: getTypeLabel(t, group.provider) })
      : group.access === 'api' && !named
        ? t('provimux.models.source_key', { name: providerName(t, group.provider, group.host) })
        : providerName(t, group.provider, group.host);
  return group.count > 1 ? t('provimux.names.who_times', { name, count: group.count }) : name;
}

/**
 * Who serves a name while it is served (and would, once kept), each kind with its colour and word: a subscription,
 * or an API key, which is paid per token (only-my-names.md 7).
 */
export function Who({ item }: { item: OtherItem }) {
  const { t } = useTranslation();
  if (item.unoffered) {
    return <span className={styles.whoNone}>{t('provimux.names.who_unoffered')}</span>;
  }
  const groups = accountGroups(item.accounts);
  const reaches = item.reaches ? (
    <span className={styles.whoNone}>
      {t('provimux.names.who_reaches', { name: item.reaches })}
    </span>
  ) : null;
  if (!groups.length) {
    return reaches ?? <span className={styles.whoNone}>{t('provimux.names.who_none')}</span>;
  }
  return (
    <span className={styles.who}>
      {reaches}
      <span className="visually-hidden">{t('provimux.names.who_label')}</span>
      {groups.map((group) => (
        <span
          key={`${group.access}|${group.provider}|${group.host ?? ''}`}
          className={styles.whoItem}
          data-access={group.access}
        >
          <span className={styles.whoDot} aria-hidden="true" />
          {groupLabel(t, group)}
          {group.access === 'api' ? (
            <span className={styles.whoPaid}>{t('provimux.names.paid')}</span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** A name that is not his, with Keep: the preview's, "Not served"'s and the refused strip's row. */
function OtherRow({
  item,
  state,
  use,
}: {
  item: OtherItem;
  state: NamesState;
  /** What the row says of its use: requests in 30 days, or times refused. */
  use: string | null;
}) {
  const { t } = useTranslation();
  const id = `keep|${item.key}`;
  const busy = state.writing === id;
  return (
    <li className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>
          <code className={styles.rowName}>{item.name}</code>
          {use ? <span className={styles.rowUse}>{use}</span> : null}
        </span>
        <Who item={item} />
      </div>
      {item.unoffered ? null : (
        <Button
          variant="secondary"
          size="sm"
          className={styles.keep}
          loading={busy}
          disabled={state.blocked !== null || (state.busy && !busy)}
          title={state.blocked ?? t('provimux.names.keep_title', { name: item.name })}
          aria-label={t('provimux.names.keep_label', { name: item.name })}
          onClick={() =>
            void state.write({
              body: keepBody(state.setting, [item.name]),
              kind: 'keep',
              names: [item.name],
              id,
            })
          }
        >
          {t('provimux.names.keep')}
        </Button>
      )}
    </li>
  );
}

/** A long list of rows: drawn a page at a time. */
function Rows({
  items,
  state,
  label,
}: {
  items: readonly OtherItem[];
  state: NamesState;
  label: string;
}) {
  const { t, i18n } = useTranslation();
  const [limit, setLimit] = useState(ROWS_PAGE);
  const shown = items.slice(0, limit);
  return (
    <>
      <ul className={styles.rows} aria-label={label}>
        {shown.map((item) => (
          <OtherRow
            key={item.key}
            item={item}
            state={state}
            use={
              item.requests
                ? t('provimux.names.requests', {
                    count: item.requests,
                    formatted: item.requests.toLocaleString(i18n.language),
                  })
                : null
            }
          />
        ))}
      </ul>
      {items.length > shown.length ? (
        <button type="button" className={page.more} onClick={() => setLimit((n) => n + ROWS_PAGE)}>
          {t('provimux.models.show_more', {
            count: Math.min(ROWS_PAGE, items.length - shown.length),
            total: items.length - shown.length,
          })}
        </button>
      ) : null}
    </>
  );
}

// --- the switch -------------------------------------------------------------------------------------------

interface SwitchProps {
  state: NamesState;
  /** His names as the list shows them: the ones a kept chip can stop keeping are marked. */
  yourNames: ReadonlyArray<{ key: string; name: string; kept: boolean }>;
  previewOpen: boolean;
  onPreview: (open: boolean) => void;
  /** "Show what isn't served": unfold that part of the list and bring it into view. */
  onShowNotServed: () => void;
}

/**
 * "Serve only my names" (models-page.md 8.1): the switch, its state in one line, and, opened by turning it on, the
 * preview of what stops being served, where the names his tools use are kept in one click before anything is
 * switched. Turning it off asks nothing.
 */
export function OnlyMyNamesSwitch({
  state,
  yourNames,
  previewOpen,
  onPreview,
  onShowNotServed,
}: SwitchProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const { answer, setting, others } = state;
  // The answer is the rule the gateway applies now; while a write is not applied yet, the switch stands where the
  // configuration puts it, and its line says the gateway still serves the names as before (no counts: they are
  // the old rule's).
  const applied = switchState(answer);
  const pending = applied !== 'not-applied' ? (state.applying ?? null) : null;
  const where = pending ? (setting.enabled ? 'on' : 'off') : applied;
  const served = yourNames.length;
  const total = served + state.alsoServed + others.length;
  const preview = previewOpen && where === 'off' && applied === 'off';
  const switching = state.writing === 'switch';

  const toggle = (next: boolean) => {
    if (where === 'on' && !next) {
      void state.write({ body: switchBody(setting, false), kind: 'off', names: [], id: 'switch' });
      return;
    }
    // Turned off and not applied yet: turning it back on needs no preview (the gateway still serves only his).
    if (where === 'off' && next && applied === 'on') {
      void state.write({ body: switchBody(setting, true), kind: 'on', names: [], id: 'switch' });
      return;
    }
    if (where === 'off') onPreview(next);
  };

  const stateText =
    where === 'not-applied'
      ? t('provimux.names.state_not_applied')
      : pending === 'applying'
        ? t('provimux.names.state_applying')
        : pending === 'late'
          ? t('provimux.names.state_late')
          : where === 'on'
            ? t('provimux.common.on')
            : preview
              ? t('provimux.names.state_preview')
              : t('provimux.common.off');

  const status = (() => {
    if (pending === 'applying') return { tone: 'busy', text: t('provimux.names.status_applying') };
    if (pending === 'late') return { tone: 'warning', text: t('provimux.names.status_late') };
    if (where === 'not-applied') {
      return {
        tone: undefined,
        text:
          answer.only_my_names.not_applied === 'home'
            ? t('provimux.names.status_home')
            : t('provimux.names.status_not_applied'),
      };
    }
    if (where === 'on') {
      return served === 0
        ? { tone: 'warning', text: t('provimux.names.status_on_none') }
        : {
            tone: 'on',
            text: t('provimux.names.status_on', {
              count: served + state.alsoServed,
              others: t('provimux.names.not_served_count', { count: others.length }),
            }),
          };
    }
    return {
      tone: undefined,
      text:
        served === 0
          ? t('provimux.names.status_off_none', { count: total })
          : t('provimux.names.status_off', {
              count: total,
              yours: t('provimux.names.yours_count', { count: served }),
            }),
    };
  })();

  return (
    <section
      className={styles.switchCard}
      data-state={where === 'on' ? 'on' : preview ? 'preview' : where}
      aria-labelledby={titleId}
    >
      <div className={styles.switchHead}>
        <span className={styles.switchIcon} aria-hidden="true">
          <IconShield size={17} />
        </span>
        <div className={styles.switchTitles}>
          <h2 id={titleId} className={styles.switchTitle}>
            {t('provimux.names.title')}
          </h2>
          <p className={styles.switchLede}>{t('provimux.names.lede')}</p>
        </div>
        <div className={styles.switchControl}>
          <ToggleSwitch
            checked={where === 'on' || preview}
            onChange={toggle}
            disabled={
              where === 'not-applied' ||
              switching ||
              pending === 'applying' ||
              (where === 'on' && (state.blocked !== null || state.busy))
            }
            ariaLabel={t('provimux.names.switch_label')}
            labelPosition="left"
            label={<span className={shared.switchState}>{stateText}</span>}
          />
        </div>
      </div>

      {/* While the preview is open, its first line says it better; not a change still being applied. */}
      {!preview || pending ? (
        <p
          className={styles.switchStatus}
          data-tone={status.tone}
          role="status"
          aria-busy={pending === 'applying' || undefined}
        >
          <span>
            {pending === 'late' ? (
              <IconAlertTriangle size={13} className={styles.statusIcon} aria-hidden="true" />
            ) : pending === 'applying' ? (
              <span className={styles.statusPulse} aria-hidden="true" />
            ) : null}
            {status.text}
          </span>
          {where === 'on' && !pending && others.length > 0 ? (
            <button type="button" className={page.textButton} onClick={onShowNotServed}>
              {t('provimux.names.show_not_served')}
            </button>
          ) : null}
        </p>
      ) : null}

      {where === 'on' && state.blocked !== null ? (
        <p className={styles.blocked}>
          <IconInfo size={13} />
          <span>{state.blocked}</span>
        </p>
      ) : null}

      <IgnoredLine state={state} />

      {preview ? (
        <PreviewPanel state={state} yourNames={yourNames} onCancel={() => onPreview(false)} />
      ) : null}
    </section>
  );
}

/**
 * keep entries the gateway ignores (a pattern, an empty one, `auto`), with a way to take them out. `auto` gets its
 * own reason: it looks like a name, so "not a pattern or empty" would not say why.
 */
function IgnoredLine({ state }: { state: NamesState }) {
  const { t } = useTranslation();
  const ignored = state.answer.keep_ignored;
  if (!ignored.length) return null;
  const values = ignored.map((entry) => entry.value);
  const reserved = ignored.filter((entry) => entry.reason === 'reserved');
  return (
    <p className={styles.ignored}>
      <IconInfo size={13} />
      <span>
        {t('provimux.names.ignored', {
          count: ignored.length,
          values: values.map((value) => (value.trim() ? value : '""')).join(', '),
        })}{' '}
        {reserved.length ? (
          <>{t('provimux.names.ignored_reserved', { value: reserved[0].value.trim() })} </>
        ) : null}
        <button
          type="button"
          className={page.textButton}
          disabled={state.blocked !== null || state.busy}
          title={state.blocked ?? undefined}
          onClick={() =>
            void state.write({
              body: dropIgnoredBody(state.setting, values),
              kind: 'drop-ignored',
              names: values,
              id: 'ignored',
            })
          }
        >
          {t('provimux.names.ignored_remove', { count: ignored.length })}
        </button>
      </span>
    </p>
  );
}

/**
 * The preview (models-page.md 8.2): what stays served, what his tools used that would stop, and the rest, folded
 * with a search. Keep writes at once, while the switch is still off, so the list shrinks as he goes; the button
 * that turns it on says what will happen.
 */
function PreviewPanel({
  state,
  yourNames,
  onCancel,
}: {
  state: NamesState;
  yourNames: SwitchProps['yourNames'];
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [restOpen, setRestOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { setting, others } = state;
  const preview = useMemo(() => previewOf(others, yourNames.length), [others, yourNames.length]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length
    ? preview.unused.filter((item) => words.every((word) => item.name.toLowerCase().includes(word)))
    : preview.unused;
  const usedLeft = preview.used.length;
  const switching = state.writing === 'switch';
  const keepAllId = 'keep|used';

  const turnOn = async () => {
    const done = await state.write({
      body: switchBody(setting, true),
      kind: 'on',
      names: [],
      id: 'switch',
    });
    if (done) onCancel();
  };

  const confirm =
    preview.served === 0
      ? { label: t('provimux.names.turn_on'), variant: 'primary' as const }
      : usedLeft > 0
        ? {
            label: t('provimux.names.turn_on_refusing', { count: usedLeft }),
            variant: 'danger' as const,
          }
        : {
            label: t('provimux.names.turn_on_count', { count: preview.served }),
            variant: 'primary' as const,
          };
  const footNote =
    preview.served === 0
      ? { tone: 'warning', text: t('provimux.names.foot_none') }
      : usedLeft > 0
        ? { tone: 'warning', text: t('provimux.names.foot_used', { count: usedLeft }) }
        : { tone: undefined, text: t('provimux.names.foot_ready') };

  return (
    <div className={styles.preview} role="group" aria-label={t('provimux.names.preview_label')}>
      <p className={styles.previewLead}>
        <strong>{t('provimux.names.preview_stop', { count: preview.stop.length })}</strong>{' '}
        {state.usage !== 'known' && state.usage !== 'partial'
          ? null
          : preview.used.length
            ? t('provimux.names.preview_used', { count: preview.used.length })
            : t('provimux.names.preview_none_used')}
      </p>
      {state.usage === 'unknown' ? (
        <p className={styles.usageNote}>
          <IconInfo size={13} />
          <span>{t('provimux.names.usage_unknown')}</span>
        </p>
      ) : state.usage === 'partial' ? (
        <p className={styles.usageNote}>
          <IconInfo size={13} />
          <span>{t('provimux.names.usage_partial')}</span>
        </p>
      ) : state.usage === 'loading' ? (
        <p className={styles.usageNote}>
          <IconInfo size={13} />
          <span>{t('provimux.names.usage_loading')}</span>
        </p>
      ) : null}
      {state.usageSince && (state.usage === 'known' || state.usage === 'partial') ? (
        <p className={styles.usageNote}>
          <IconInfo size={13} />
          <span>
            {t('provimux.names.usage_since', {
              date: formatDay(state.usageSince, i18n.language, false),
            })}
          </span>
        </p>
      ) : null}
      {state.blocked !== null ? (
        <p className={styles.blocked}>
          <IconInfo size={13} />
          <span>{state.blocked}</span>
        </p>
      ) : null}

      <div className={styles.group} data-group="served">
        <div className={styles.groupHead}>
          <h3 className={styles.groupTitle}>
            {t('provimux.names.group_served')}
            <span className={styles.groupCount}>{yourNames.length}</span>
          </h3>
          <p className={styles.groupHint}>{t('provimux.names.group_served_hint')}</p>
        </div>
        {yourNames.length ? (
          <ul className={styles.chips} aria-label={t('provimux.names.group_served')}>
            {yourNames.map((own) => (
              <li key={own.key} className={styles.chip} data-kept={own.kept || undefined}>
                <code>{own.name}</code>
                {own.kept ? (
                  <button
                    type="button"
                    className={styles.chipRemove}
                    disabled={state.blocked !== null || state.busy}
                    title={state.blocked ?? t('provimux.names.unkeep_title', { name: own.name })}
                    aria-label={t('provimux.names.unkeep_label', { name: own.name })}
                    onClick={() =>
                      void state.write({
                        body: unkeepBody(setting, own.name),
                        kind: 'unkeep',
                        names: [own.name],
                        id: `unkeep|${own.key}`,
                      })
                    }
                  >
                    <IconX size={12} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.groupEmpty}>{t('provimux.names.group_served_empty')}</p>
        )}
      </div>

      {preview.used.length ? (
        <div className={styles.group} data-group="used">
          <div className={styles.groupHead}>
            <h3 className={styles.groupTitle}>
              {t('provimux.names.group_used')}
              <span className={styles.groupCount}>{preview.used.length}</span>
            </h3>
            <p className={styles.groupHint}>{t('provimux.names.group_used_hint')}</p>
            {preview.used.length > 1 ? (
              <Button
                variant="secondary"
                size="sm"
                className={styles.keepAll}
                loading={state.writing === keepAllId}
                disabled={state.blocked !== null || (state.busy && state.writing !== keepAllId)}
                title={state.blocked ?? undefined}
                onClick={() =>
                  void state.write({
                    body: keepBody(
                      setting,
                      preview.used.map((item) => item.name)
                    ),
                    kind: 'keep',
                    names: preview.used.map((item) => item.name),
                    id: keepAllId,
                  })
                }
              >
                {t('provimux.names.keep_all_used', { count: preview.used.length })}
              </Button>
            ) : null}
          </div>
          <Rows items={preview.used} state={state} label={t('provimux.names.group_used')} />
        </div>
      ) : null}

      {preview.unused.length ? (
        <div className={styles.group} data-group="unused">
          <div className={styles.groupHead}>
            <h3 className={styles.groupTitle}>
              {state.usage === 'unknown' || state.usage === 'loading'
                ? t('provimux.names.group_others')
                : t('provimux.names.group_unused')}
              <span className={styles.groupCount}>{preview.unused.length}</span>
            </h3>
          </div>
          {restOpen ? (
            <>
              <label className={`${shared.search} ${styles.search}`}>
                <IconSearch size={15} className={shared.searchIcon} />
                <input
                  type="search"
                  value={query}
                  placeholder={t('provimux.names.search_placeholder')}
                  aria-label={t('provimux.names.search_placeholder')}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {found.length ? (
                <Rows items={found} state={state} label={t('provimux.names.group_unused')} />
              ) : (
                <p className={styles.groupEmpty}>{t('provimux.names.search_none')}</p>
              )}
            </>
          ) : (
            <button
              type="button"
              className={page.fold}
              aria-expanded={false}
              onClick={() => setRestOpen(true)}
            >
              <span>{t('provimux.names.unused_show', { count: preview.unused.length })}</span>
              <span className={page.foldSample}>
                {preview.unused
                  .slice(0, 8)
                  .map((item) => item.name)
                  .join(', ')}
                {preview.unused.length > 8 ? ', …' : ''}
              </span>
            </button>
          )}
        </div>
      ) : null}

      <div className={styles.previewFoot}>
        <p className={styles.footNote} data-tone={footNote.tone}>
          {footNote.tone ? <IconAlertTriangle size={13} /> : null}
          <span>{footNote.text}</span>
        </p>
        <div className={styles.footActions}>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={switching}>
            {t('provimux.names.cancel')}
          </Button>
          <Button
            variant={confirm.variant}
            size="sm"
            loading={switching}
            disabled={preview.served === 0 || state.blocked !== null || (state.busy && !switching)}
            title={state.blocked ?? undefined}
            onClick={() => void turnOn()}
          >
            {confirm.label}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- what was refused ----------------------------------------------------------------------------------------

/**
 * The names tools asked for and were refused since the switch went on (models-page.md 8.4): on top while there are
 * any, each with how often and when last, and Keep. What the 30-day preview could not catch shows here.
 */
export function RefusedStrip({
  state,
  refused,
}: {
  state: NamesState;
  refused: readonly ProvimuxRefusedName[];
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const since = timeMs(state.answer.refused?.since);
  if (!refused.length) return null;
  const others = new Map(state.others.map((item) => [item.key, item]));
  const offered = offeredSpellingsOf(state.answer);
  return (
    <section className={styles.refused} aria-labelledby={titleId}>
      <div className={styles.refusedHead}>
        <IconAlertTriangle size={15} />
        <h2 id={titleId} className={styles.refusedTitle}>
          {t('provimux.names.refused_title', { count: refused.length })}
        </h2>
        {since !== null ? (
          <span className={styles.refusedSince} title={formatExact(since, i18n.language)}>
            {t('provimux.names.refused_since', {
              time: formatClock(since, i18n.language, state.nowMs),
            })}
          </span>
        ) : null}
      </div>
      <p className={styles.refusedText}>{t('provimux.names.refused_text')}</p>
      <ul className={styles.rows} aria-label={t('provimux.names.refused_label')}>
        {refused.map((name) => {
          const key = nameKey(name.name);
          // Not among the others: a spelling no account registers. In another case one may (kept, it is served
          // through upstream's lower-case lookup); in none, keeping it would serve nothing, and the row says so.
          const found = offered.get(thinkingBase(key).toLowerCase());
          const item: OtherItem = others.get(key) ?? {
            key,
            name: name.name,
            requests: null,
            accounts: found?.accounts ?? [],
            ...(found ? { reaches: [...found.spellings].sort()[0] } : { unoffered: true }),
          };
          const last = timeMs(name.last_at);
          return (
            <OtherRow
              key={key}
              item={{ ...item, name: name.name }}
              state={state}
              use={[
                t('provimux.names.refused_times', { count: name.requests }),
                last !== null
                  ? t('provimux.names.refused_last', {
                      time: formatRelative(last, state.nowMs, i18n.language),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          );
        })}
      </ul>
      {state.answer.refused?.truncated ? (
        <p className={styles.refusedText}>{t('provimux.names.refused_truncated')}</p>
      ) : null}
    </section>
  );
}

// --- what is not served --------------------------------------------------------------------------------------

/**
 * With the switch on, everything that is not his (models-page.md 8.3): folded, used ones first, each with Keep.
 */
export function NotServedSection({
  state,
  items,
  open,
  onOpen,
  narrowed,
  id,
}: {
  state: NamesState;
  /** The names to list: filtered by the page's search when it narrows. */
  items: readonly OtherItem[];
  open: boolean;
  onOpen: (open: boolean) => void;
  /** A search or filter narrows the list: shown unfolded. */
  narrowed: boolean;
  id: string;
}) {
  const { t } = useTranslation();
  const used = items.filter((item) => (item.requests ?? 0) > 0).length;
  const shown = open || narrowed;
  return (
    <section id={id} className={styles.notServed} aria-labelledby={`${id}-title`}>
      <div className={page.sectionHead}>
        <h2 id={`${id}-title`} className={page.sectionTitle}>
          {t('provimux.names.section_not_served')}
          <span className={page.sectionCount}>{items.length}</span>
        </h2>
        <p className={page.sectionHint}>{t('provimux.names.section_not_served_hint')}</p>
      </div>
      {state.blocked !== null && shown ? (
        <p className={styles.blocked}>
          <IconInfo size={13} />
          <span>{state.blocked}</span>
        </p>
      ) : null}
      {shown ? (
        <>
          <Rows items={items} state={state} label={t('provimux.names.section_not_served')} />
          {!narrowed ? (
            <button type="button" className={page.more} onClick={() => onOpen(false)}>
              {t('provimux.names.not_served_hide')}
            </button>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          className={page.fold}
          aria-expanded={false}
          onClick={() => onOpen(true)}
        >
          <span>
            {used > 0
              ? t('provimux.names.not_served_show_used', {
                  count: items.length,
                  used: t('provimux.names.used_count', { count: used }),
                })
              : t('provimux.names.not_served_show', { count: items.length })}
          </span>
          <span className={page.foldSample}>
            {items
              .slice(0, 8)
              .map((item) => item.name)
              .join(', ')}
            {items.length > 8 ? ', …' : ''}
          </span>
        </button>
      )}
    </section>
  );
}

import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { IconAlertTriangle, IconInfo } from '@/components/ui/icons';
import type { ProvimuxModelListKeyRow, ProvimuxModelRoutesResponse } from '../../api/types';
import { IconLiveLists } from '../../components/ProvimuxIcons';
import {
  keyListState,
  keyOverlaps,
  learnedOf,
  paysPerToken,
  priorityBelow,
  type KeyListState,
  type KeyOverlap,
} from '../keyLists/keyLists';
import { MODELS_PATH } from '../models/address';
import { formatExact, formatRelative, timeMs } from '../time';
import { routeName } from '../excluded/labels';
import { failureReason } from './keyListWords';
import styles from './AccountsPage.module.scss';

/** How many learned models the panel names before "and N more". */
const LEARNED_SHOWN = 10;

export interface KeyListStatusProps {
  /** The key's rows of the model-lists status (an OpenAI-compatible entry: one per key). */
  rows: readonly ProvimuxModelListKeyRow[];
  /** The key's prefix: learned models are also served under `prefix/model`. */
  prefix: string | null;
  routes: ProvimuxModelRoutesResponse | null;
  /** The service as the owner knows it ("OpenRouter", "Anthropic"). */
  service: string;
  /** The server's now. */
  nowMs: number;
  busy: boolean;
  /** Models, showing what this key learned. */
  learnedAddress: string;
  /** "Lower this key's priority": the priority field, filled in. */
  onLowerPriority: (value: number) => void;
  /** "Exclude them on this key": its settings, with them added to the models it never serves. */
  onExclude: (models: string[]) => void;
  /** "Use a fixed list": its settings, with the switch on. */
  onFix: () => void;
}

/**
 * A key's model list on its panel (design key-model-lists.md 7.2): whether it keeps itself up to date and its
 * last refresh, what it learned by itself beyond its settings, which of its settings' models the service no
 * longer lists, the last failure, or why its service is not asked. Where a model it learned is also served by
 * a subscription, it says so plainly, with the three ways to keep those requests on the subscription.
 */
export function KeyListStatus(props: KeyListStatusProps) {
  const { t } = useTranslation();
  if (!props.rows.length) return null;
  const several = props.rows.length > 1;
  return (
    <div className={styles.keyLists}>
      {props.rows.map((row, index) => (
        <KeyListCard
          key={row.auth_index ?? index}
          {...props}
          row={row}
          label={several ? t('provimux.accounts.lists.key_n', { n: index + 1 }) : null}
        />
      ))}
    </div>
  );
}

function KeyListCard(
  props: KeyListStatusProps & { row: ProvimuxModelListKeyRow; label: string | null }
) {
  const { t, i18n } = useTranslation();
  const { row, service, nowMs } = props;
  const state = keyListState(row, nowMs);
  const learned = learnedOf(row);
  const overlaps = useMemo(
    () => keyOverlaps(row, props.prefix, row.auth_index ? [row.auth_index] : [], props.routes),
    [row, props.prefix, props.routes]
  );
  const paid = overlaps.filter((overlap) => paysPerToken(overlap.order));
  const fallback = overlaps.filter((overlap) => !paysPerToken(overlap.order));
  const age = (at: string | null) => {
    const ms = timeMs(at);
    return ms === null ? null : formatRelative(ms, nowMs, i18n.language);
  };
  const exact = (at: string | null) => {
    const ms = timeMs(at);
    return ms === null ? undefined : formatExact(ms, i18n.language);
  };

  return (
    <section className={styles.keyList} data-state={state.kind} aria-label={titleOf(t, state)}>
      <header className={styles.keyListHead}>
        <span className={styles.keyListIcon} aria-hidden="true">
          <IconLiveLists size={15} />
        </span>
        <span className={styles.keyListTitle}>
          {props.label ? <span className={styles.keyListLabel}>{props.label}</span> : null}
          {titleOf(t, state)}
        </span>
        {state.kind === 'live' && state.fetchedAt ? (
          <span
            className={styles.keyListAge}
            title={exact(state.fetchedAt)}
            data-old={state.old || undefined}
          >
            {state.fetching
              ? t('provimux.accounts.lists.asking')
              : t(
                  state.fromCache
                    ? 'provimux.accounts.lists.refreshed_cache'
                    : 'provimux.accounts.lists.refreshed',
                  { age: age(state.fetchedAt) }
                )}
          </span>
        ) : state.kind === 'waiting' && state.fetching ? (
          <span className={styles.keyListAge}>{t('provimux.accounts.lists.asking')}</span>
        ) : null}
      </header>

      <p className={styles.keyListText}>{stateText(t, state, service, age)}</p>
      {state.kind === 'live-lists-off' ? (
        <Link to={MODELS_PATH} className={styles.sheetLink}>
          {t('provimux.accounts.lists.off_link')}
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}
      {state.kind === 'live' && state.unlisted.length ? (
        <p className={styles.keyListText}>
          {t('provimux.accounts.lists.unlisted', {
            count: state.unlisted.length,
            service,
            names: state.unlisted.join(', '),
          })}
        </p>
      ) : null}
      {'failure' in state && state.failure ? (
        <p className={styles.keyListFailure}>
          <IconAlertTriangle size={13} />
          <span>
            {t('provimux.accounts.lists.failed', {
              age: age(state.failure.at) ?? '',
              reason: failureReason(t, state.failure, service),
            })}{' '}
            {state.kind === 'live'
              ? t('provimux.accounts.lists.failed_kept', { age: age(state.fetchedAt) ?? '' })
              : null}
          </span>
        </p>
      ) : null}

      {learned.length ? (
        <div className={styles.learned}>
          <span className={styles.learnedHeading}>
            {t('provimux.accounts.lists.learned_heading', { n: learned.length })}
          </span>
          <ul className={styles.learnedList}>
            {learned.slice(0, LEARNED_SHOWN).map((model) => (
              <li
                key={model}
                className={styles.learnedChip}
                title={t('provimux.accounts.lists.learned_title', { service })}
              >
                {model}
              </li>
            ))}
            {learned.length > LEARNED_SHOWN ? (
              <li className={styles.learnedMore}>
                {t('provimux.accounts.lists.learned_more', {
                  count: learned.length - LEARNED_SHOWN,
                })}
              </li>
            ) : null}
          </ul>
          <Link to={props.learnedAddress} className={styles.sheetLink}>
            {t('provimux.accounts.lists.learned_link')}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : null}

      {paid.length ? (
        <Overlaps
          overlaps={paid}
          busy={props.busy}
          onLowerPriority={props.onLowerPriority}
          onExclude={props.onExclude}
          onFix={props.onFix}
        />
      ) : null}
      {fallback.length ? (
        <p className={styles.keyListText} data-tone="quiet">
          <IconInfo size={13} />
          <span>
            {t('provimux.accounts.lists.fallback', {
              count: fallback.length,
              models: fallback.map((overlap) => overlap.name).join(', '),
            })}
          </span>
        </p>
      ) : null}
    </section>
  );
}

/**
 * Learned models a subscription also serves, while the key is tried first or shares the requests: said
 * plainly, each with who serves it, and the three ways to keep them on the subscription.
 */
function Overlaps({
  overlaps,
  busy,
  onLowerPriority,
  onExclude,
  onFix,
}: {
  overlaps: KeyOverlap[];
  busy: boolean;
  onLowerPriority: (value: number) => void;
  onExclude: (models: string[]) => void;
  onFix: () => void;
}) {
  const { t } = useTranslation();
  const below = priorityBelow(overlaps);
  const models = [...new Set(overlaps.map((overlap) => overlap.model))];
  return (
    <div className={styles.overlap} role="note">
      <p className={styles.overlapTitle}>
        <IconAlertTriangle size={14} />
        <span>{t('provimux.accounts.lists.overlap_title', { count: overlaps.length })}</span>
      </p>
      <p className={styles.overlapText}>{t('provimux.accounts.lists.overlap_text')}</p>
      <ul className={styles.overlapList}>
        {overlaps.map((overlap) => (
          <li key={overlap.name}>
            <code>{overlap.name}</code>
            <span className={styles.overlapWho}>
              {overlap.subscriptions
                .slice(0, 2)
                .map((route) => routeName(t, route))
                .join(', ')}
              {overlap.subscriptions.length > 2
                ? ` ${t('provimux.accounts.lists.learned_more', { count: overlap.subscriptions.length - 2 })}`
                : ''}
            </span>
            <span className={styles.overlapOrder} data-order={overlap.order}>
              {overlap.order === 'key-first'
                ? t('provimux.accounts.lists.overlap_key_first')
                : overlap.order === 'shared'
                  ? t('provimux.accounts.lists.overlap_shared')
                  : t('provimux.accounts.lists.overlap_unknown')}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.overlapText}>{t('provimux.accounts.lists.overlap_stop')}</p>
      <div className={styles.overlapActions}>
        {below !== null ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onLowerPriority(below)}
          >
            {t('provimux.accounts.lists.overlap_priority', { value: below })}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onExclude(models)}>
          {t('provimux.accounts.lists.overlap_exclude', { count: models.length })}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onFix}>
          {t('provimux.accounts.lists.overlap_fix')}
        </Button>
      </div>
      <p className={styles.fieldHint}>{t('provimux.accounts.lists.overlap_after')}</p>
    </div>
  );
}

type T = TFunction;

function titleOf(t: T, state: KeyListState): string {
  switch (state.kind) {
    case 'live':
      return t('provimux.accounts.lists.title_live');
    case 'waiting':
      return t('provimux.accounts.lists.title_waiting');
    case 'expired':
      return t('provimux.accounts.lists.title_expired');
    case 'fixed':
      return t('provimux.accounts.lists.title_fixed');
    case 'live-lists-off':
      return t('provimux.accounts.lists.title_off');
    case 'no-list':
      return t('provimux.accounts.lists.title_no_list');
    default:
      return t('provimux.accounts.lists.title_unknown');
  }
}

function stateText(
  t: T,
  state: KeyListState,
  service: string,
  age: (at: string | null) => string | null
): string {
  switch (state.kind) {
    case 'live': {
      const found =
        state.listed !== null
          ? t('provimux.accounts.lists.found', { count: state.listed, service })
          : '';
      // No rows: the key offers its service's list as it is (a Gemini key on Google's own host).
      const learned = state.learned.length
        ? t('provimux.accounts.lists.learned', { count: state.learned.length })
        : state.configured === 0
          ? t('provimux.accounts.lists.whole_list')
          : t('provimux.accounts.lists.learned_none');
      const old = state.old ? t('provimux.accounts.lists.old_text') : '';
      return [found, learned, old].filter(Boolean).join(' ');
    }
    case 'waiting':
      return t('provimux.accounts.lists.waiting_text', { service });
    case 'expired':
      return t('provimux.accounts.lists.expired_text', { age: age(state.fetchedAt) ?? '' });
    case 'fixed':
      return t('provimux.accounts.lists.fixed_text', { service });
    case 'live-lists-off':
      return t('provimux.accounts.lists.off_text');
    case 'no-list':
      return t('provimux.accounts.lists.no_list_text', { service });
    default:
      return t('provimux.accounts.lists.unknown_text', { reason: state.reason });
  }
}

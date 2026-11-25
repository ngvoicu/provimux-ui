import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconPencil,
  IconPlus,
  IconTimer,
  IconX,
} from '@/components/ui/icons';
import type { ProvimuxModelRoutesResponse, ProvimuxRecordedCooldown } from '../../api/types';
import { IconExcluded, IconLiveLists } from '../../components/ProvimuxIcons';
import type { Exclusion } from '../excluded/exclusions';
import { placeInline } from '../excluded/labels';
import { setKeyPriority } from '../aliases/priority';
import type { AliasDraft, AliasEntry } from '../aliases/types';
import { formatTokens, isOpenRouterHost } from '../modelRoutes/logic';
import { listAge, sourceKind } from '../modelLists/logic';
import { AccessBadge } from '../shared/AccessBadge';
import { ProviderPill } from '../shared/ProviderPill';
import { accountsAddressOfKeyLists, useOpenInAccounts } from '../shared/accountsLink';
import { paysPerToken } from '../keyLists/keyLists';
import { formatDuration, formatExact, formatRelative, serverNow, timeMs } from '../time';
import { usePageClock, useSecondClock } from '../shared/clocks';
import type { LimitSource, ModelDetail, NameItem, RouteLine } from './catalog';
import { NameEditor } from './NameEditor';
import { excludedAddress } from './address';
import { providerName } from './labels';
import styles from './ModelsPage.module.scss';

export interface NameCardProps {
  id: string;
  item: NameItem;
  /** The exclusions that take this name out somewhere (by its name or a model it sends upstream). */
  excludedIn?: readonly Exclusion[];
  /** Opens Excluded models searched for this name; without it the mark is a plain link. */
  onShowExcluded?: (model: string) => void;
  draft: AliasDraft;
  entries: readonly AliasEntry[];
  routes: ProvimuxModelRoutesResponse | null;
  /** The proxy reports its routes: lines carry an order and a "not served now". */
  routesKnown: boolean;
  offsetMs: number;
  locked: boolean;
  open: boolean;
  onToggle: () => void;
  onRenamed: (to: string) => void;
  /** "Name it": the composer, with this model already chosen. */
  onNewName: (item: NameItem) => void;
  edit: (change: (draft: AliasDraft) => AliasDraft) => void;
  /**
   * "Exclude it on this key", for a model a key learned that a subscription also serves: written at once, as
   * Excluded models writes it. Absent: the key cannot take an exclusion here (the button is not offered).
   */
  onExclude?: (line: RouteLine, model: string) => void;
  /** Why an exclusion cannot be written now (edits not saved, a write running); null when it can. */
  excludeBlocked?: string | null;
  /**
   * "Stop keeping", for a name kept under its own name (only-my-names `keep`): written at once. Absent: the
   * gateway has no such setting, and the button is not offered.
   */
  onUnkeep?: (name: string) => void;
  /** Why the setting cannot be written now; null when it can. */
  keepBlocked?: string | null;
  /** The name is being written (its Keep or Stop keeping). */
  keepWriting?: boolean;
  /** With the switch on, a name that stops being kept is refused at once: the button says so. */
  servedOnlyMine?: boolean;
  /**
   * The ids an account registers as this name with a thinking level (`opus(high)`), served through it
   * (only-my-names.md 17.2 C): not names of their own, so drawn here rather than on cards.
   */
  levels?: readonly string[];
}

/** One name: its routes in the order they are tried, what needs a look, and its editor when open. */
export const NameCard = memo(function NameCard(props: NameCardProps) {
  const { t } = useTranslation();
  const { item, open, locked } = props;
  const meta = [
    item.accounts === 0
      ? t('provimux.models.accounts_none')
      : t('provimux.models.accounts_count', { count: item.accounts }),
    item.requests !== null && item.requests > 0
      ? t('provimux.models.requests', { count: item.requests })
      : null,
  ].filter(Boolean);
  const [details, setDetails] = useState(false);
  const detailsId = `${props.id}-details`;

  return (
    <article
      id={props.id}
      className={styles.name}
      data-own={item.own || undefined}
      data-problem={item.problems.length > 0 || undefined}
      data-open={open || undefined}
      aria-label={item.name}
    >
      <header className={styles.nameHead}>
        <div className={styles.nameTitle}>
          <h3 className={styles.nameText}>{item.name}</h3>
          {item.fresh ? (
            <span className={styles.tag} data-tone="new">
              {t('provimux.models.tag_unsaved')}
            </span>
          ) : item.own && (item.aliased || !item.kept) ? (
            <span className={styles.tag} data-tone="own">
              {t('provimux.models.tag_yours')}
            </span>
          ) : null}
          {item.kept && !item.fresh ? (
            <span
              className={styles.tag}
              data-tone="kept"
              title={t('provimux.names.kept_title', { name: item.name })}
            >
              {t('provimux.names.tag_kept')}
            </span>
          ) : null}
          {item.problems.length ? (
            <span className={styles.tag} data-tone="problem">
              <IconAlertTriangle size={12} />
              {t('provimux.models.tag_problem')}
            </span>
          ) : null}
          {props.excludedIn?.length ? (
            <ExcludedMark name={item.name} in={props.excludedIn} onShow={props.onShowExcluded} />
          ) : null}
          {item.paid !== null && paysPerToken(item.paid) ? (
            <span
              className={styles.tag}
              data-tone="paid"
              title={t('provimux.models.tag_paid_title')}
            >
              <IconAlertTriangle size={12} />
              {t('provimux.models.tag_paid')}
            </span>
          ) : null}
        </div>
        <p className={styles.nameMeta}>{meta.join(' · ')}</p>
        <div className={styles.nameActions}>
          <button
            type="button"
            className={styles.ghost}
            aria-expanded={details}
            aria-controls={detailsId}
            onClick={() => setDetails((shown) => !shown)}
          >
            {details ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
            {t('provimux.models.details')}
          </button>
          {!item.own ? (
            <button
              type="button"
              className={styles.ghost}
              disabled={locked}
              onClick={() => props.onNewName(item)}
            >
              <IconPlus size={13} />
              {t('provimux.models.name_it')}
            </button>
          ) : null}
          {item.kept && props.onUnkeep ? (
            <button
              type="button"
              className={styles.ghost}
              data-danger
              disabled={props.keepBlocked != null || props.keepWriting}
              aria-busy={props.keepWriting || undefined}
              aria-label={t('provimux.names.unkeep_label', { name: item.name })}
              title={
                props.keepBlocked ??
                t(
                  props.servedOnlyMine
                    ? 'provimux.names.unkeep_title_on'
                    : 'provimux.names.unkeep_title',
                  { name: item.name }
                )
              }
              onClick={() => props.onUnkeep!(item.name)}
            >
              <IconX size={13} />
              {t('provimux.names.unkeep')}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.ghost}
            aria-expanded={open}
            onClick={props.onToggle}
          >
            <IconPencil size={13} />
            {item.own ? t('provimux.models.edit') : t('provimux.models.add_models')}
          </button>
        </div>
      </header>

      {item.lines.length === 0 ? (
        <p className={styles.noLines}>{t('provimux.names.no_account')}</p>
      ) : null}
      {props.levels?.length ? (
        <p className={styles.noLines}>
          {t('provimux.names.levels', {
            ids: props.levels.join(', '),
            name: item.name,
          })}
        </p>
      ) : null}
      <ol
        className={styles.lines}
        aria-label={t('provimux.models.lines_label', { name: item.name })}
      >
        {item.lines
          .filter((line) => line.poolOf === null)
          .map((line) => (
            <Line
              key={line.key}
              line={line}
              pool={item.lines.filter((mate) => mate.poolOf === line.key)}
              name={item.name}
              routesKnown={props.routesKnown}
              offsetMs={props.offsetMs}
              locked={locked}
              edit={props.edit}
            />
          ))}
      </ol>
      {details ? <NameDetails id={detailsId} item={item} /> : null}

      {item.paid !== null && paysPerToken(item.paid) ? (
        <PaidOverlap
          item={item}
          locked={locked}
          edit={props.edit}
          onExclude={props.onExclude}
          excludeBlocked={props.excludeBlocked ?? null}
        />
      ) : null}

      {item.problems.includes('mixed') ? (
        <p className={styles.problem}>
          <IconAlertTriangle size={13} />
          <span>
            {t('provimux.models.problem_mixed', {
              name: item.name,
              models: [...new Set(item.lines.map((l) => l.upstream))].join(', '),
            })}
          </span>
        </p>
      ) : null}

      {open ? (
        <NameEditor
          item={item}
          draft={props.draft}
          entries={props.entries}
          routes={props.routes}
          edit={props.edit}
          onRenamed={props.onRenamed}
          onClose={props.onToggle}
        />
      ) : null}
    </article>
  );
});

/**
 * "Excluded in 2 places": the places that never serve this name, as a link to them on Excluded models. A
 * click switches the page's view (`onShow`); the address stays for a new tab or a copied link.
 */
function ExcludedMark({
  name,
  in: exclusions,
  onShow,
}: {
  name: string;
  in: readonly Exclusion[];
  onShow?: (model: string) => void;
}) {
  const { t } = useTranslation();
  const places = new Map(exclusions.map((exclusion) => [exclusion.place.id, exclusion.place]));
  const where = [...places.values()].map((place) => placeInline(t, place)).join('; ');
  return (
    <Link
      to={excludedAddress(name)}
      onClick={(event) => {
        if (!onShow || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
          return;
        event.preventDefault();
        onShow(name);
      }}
      className={`${styles.tag} ${styles.tagLink}`}
      data-tone="excluded"
      title={t('provimux.models.excluded_mark_title', { places: where })}
    >
      <IconExcluded size={12} />
      {t('provimux.models.excluded_mark', { count: places.size })}
    </Link>
  );
}

/**
 * A name's details, shown on request: what clients are told about the model's size (context and output)
 * and its reasoning levels, each with where it comes from when that is known. Not on the row itself: the
 * row says something about limits only when one is estimated.
 */
export function NameDetails({ id, item }: { id: string; item: NameItem }) {
  const { t, i18n } = useTranslation();
  const source = (from: LimitSource | null) =>
    !from
      ? null
      : from.kind === 'list'
        ? t('provimux.models.detail_from_list', { provider: providerName(t, from.provider, null) })
        : from.kind === 'built-in'
          ? t('provimux.models.detail_built_in')
          : t('provimux.models.detail_default');
  const size = (value: number | null | undefined, from: LimitSource | null) =>
    value ? (
      <>
        <span
          title={t('provimux.routes.tokens_exact', { value: value.toLocaleString(i18n.language) })}
        >
          {formatTokens(value, i18n.language)}
        </span>
        {source(from) ? <span className={styles.detailSource}>{source(from)}</span> : null}
      </>
    ) : (
      <span className={styles.detailSource}>{t('provimux.models.detail_unknown')}</span>
    );
  const levels = [...new Set(item.lines.flatMap((line) => line.reasoning ?? []))];
  return (
    <dl id={id} className={styles.details}>
      <div>
        <dt>{t('provimux.models.detail_context')}</dt>
        <dd>{size(item.limits?.context, item.limitSources.context)}</dd>
      </div>
      <div>
        <dt>{t('provimux.models.detail_output')}</dt>
        <dd>{size(item.limits?.output, item.limitSources.output)}</dd>
      </div>
      {levels.length ? (
        <div>
          <dt>{t('provimux.models.detail_reasoning')}</dt>
          <dd>{levels.join(', ')}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * Why a route's limits are estimated, naming the company: "Codex's own list offers this model, but
 * Provimux's built-in list doesn't have it yet. Context from Codex's list; output: a default; …".
 */
function estimatedHint(t: TFunction, line: RouteLine): string {
  const provider = providerName(t, line.provider, line.host);
  const detail = line.detail;
  if (!detail) return t('provimux.models.estimated_hint', { provider });
  const value = (what: string, source: ModelDetail['context']) =>
    source === 'live'
      ? t('provimux.models.limit_from_list', { what, provider })
      : source === 'built-in'
        ? t('provimux.models.limit_built_in', { what })
        : t('provimux.models.limit_default', { what });
  // The joining is the language's own (Chinese has no spaces and its own semicolon and full stop).
  return t('provimux.models.estimated_full', {
    lead:
      line.estimated === 'new'
        ? t('provimux.models.estimated_lead', { provider })
        : t('provimux.models.estimated_default_lead'),
    limits: [
      value(t('provimux.models.limit_context'), detail.context),
      value(t('provimux.models.limit_output'), detail.output),
      value(t('provimux.models.limit_reasoning'), detail.reasoning),
    ].join(t('provimux.models.limit_separator')),
  });
}

/** The sentence a line's issue, or its state, reads as; null when there is nothing to say. */
function lineSentence(t: TFunction, line: RouteLine, routesKnown: boolean): string | null {
  if (line.state === 'removed') return null;
  if (line.off) return t('provimux.models.line_off');
  switch (line.issue) {
    case 'incomplete':
      return t('provimux.models.issue_incomplete');
    case 'same-as-name':
      return t('provimux.models.issue_same_as_name');
    case 'duplicate':
      return t('provimux.models.issue_duplicate', {
        source: t('provimux.models.source_login', {
          name: providerName(t, line.provider, line.host),
        }),
      });
    case 'shadowed':
      return t('provimux.models.issue_shadowed');
    default:
      break;
  }
  if (line.state === 'idle' && routesKnown) return t('provimux.models.line_not_served');
  return null;
}

function Line({
  line,
  pool,
  name,
  routesKnown,
  offsetMs,
  locked,
  edit,
}: {
  line: RouteLine;
  /** The pool's other models on this route (an OpenAI-compatible entry with several under the name). */
  pool: readonly RouteLine[];
  name: string;
  routesKnown: boolean;
  offsetMs: number;
  locked: boolean;
  edit: NameCardProps['edit'];
}) {
  const { t } = useTranslation();
  const openInAccounts = useOpenInAccounts();
  const sentence = lineSentence(t, line, routesKnown);
  const blocking =
    line.issue === 'incomplete' || line.issue === 'same-as-name' || line.issue === 'duplicate';
  const rankTitle =
    line.rank === null
      ? line.state === 'removed'
        ? undefined
        : routesKnown || line.priority !== null
          ? t('provimux.models.rank_none')
          : t('provimux.models.rank_unknown')
      : line.sharesRank
        ? t('provimux.models.rank_shared', { rank: line.rank })
        : t('provimux.models.rank', { rank: line.rank });
  const sameName = line.upstream.trim().toLowerCase() === name.trim().toLowerCase();
  return (
    <li
      className={styles.line}
      data-state={line.state}
      data-off={line.off || undefined}
      data-issue={line.issue ? (blocking ? 'error' : 'warn') : undefined}
    >
      <div className={styles.lineMain}>
        <span
          className={styles.rank}
          data-shared={line.sharesRank || undefined}
          data-tried={line.rank !== null || undefined}
          title={rankTitle}
          aria-label={rankTitle}
        >
          {line.rank ?? '–'}
        </span>
        <AccessBadge access={line.access} kind={null} />
        <ProviderPill provider={line.provider} host={line.host} />
        {line.account && line.loginFile ? (
          <button
            type="button"
            className={`${styles.account} ${styles.accountLink}`}
            title={t('provimux.models.open_login', { name: line.account })}
            onClick={() => openInAccounts(line.loginFile!)}
          >
            {line.account}
          </button>
        ) : line.account ? (
          <span className={styles.account}>{line.account}</span>
        ) : null}
        {line.keyName ? (
          <span
            className={styles.keyName}
            title={t('provimux.models.key_name_title', { key: line.keyName })}
          >
            {t('provimux.models.key_name', { key: line.keyName })}
          </span>
        ) : null}
        <span className={styles.sends} data-same={sameName || undefined}>
          <span aria-hidden="true">→</span>
          <span className="visually-hidden">{t('provimux.models.sends')}</span>
          <code>{line.upstream}</code>
          {line.learned ? (
            <span
              className={styles.learned}
              title={t('provimux.models.learned_hint', {
                provider: providerName(t, line.provider, line.host),
              })}
            >
              <IconLiveLists size={11} aria-hidden="true" />
              {t('provimux.models.tag_learned')}
            </span>
          ) : null}
          {line.estimated ? (
            <span className={styles.estimated} title={estimatedHint(t, line)}>
              {line.estimated === 'new'
                ? t('provimux.models.tag_estimated')
                : t('provimux.models.tag_estimated_default')}
            </span>
          ) : null}
          {pool.map((mate) => (
            <span key={mate.key} className={styles.poolMate} data-state={mate.state}>
              <span className={styles.poolOr} title={t('provimux.models.pool_hint')}>
                {t('provimux.models.pool_or')}
              </span>
              <code>{mate.upstream}</code>
              {mate.state === 'changed' || mate.state === 'removed' ? (
                <span className={styles.tag} data-tone={mate.state}>
                  {t(
                    mate.state === 'changed'
                      ? 'provimux.models.tag_changed'
                      : 'provimux.models.tag_removed'
                  )}
                </span>
              ) : null}
            </span>
          ))}
        </span>
        <span className={styles.lineEnd}>
          {line.cooldown ? (
            <Cooldown cooldown={line.cooldown} upstream={line.upstream} offsetMs={offsetMs} />
          ) : null}
          {line.list ? <ListAge line={line} offsetMs={offsetMs} /> : null}
          <Priority line={line} locked={locked} edit={edit} />
          {line.state === 'new' ? (
            <span className={styles.tag} data-tone="new">
              {t('provimux.models.tag_unsaved')}
            </span>
          ) : line.state === 'changed' ? (
            <span className={styles.tag} data-tone="changed">
              {t('provimux.models.tag_changed')}
            </span>
          ) : line.state === 'removed' ? (
            <span className={styles.tag} data-tone="removed">
              {t('provimux.models.tag_removed')}
            </span>
          ) : null}
        </span>
      </div>
      {sentence ? (
        <p className={styles.lineSentence} data-tone={line.issue || line.off ? 'warn' : undefined}>
          {line.issue ? <IconAlertTriangle size={12} /> : null}
          <span>{sentence}</span>
        </p>
      ) : null}
    </li>
  );
}

/**
 * A model a paid key learned by itself that a subscription also serves, while the key is tried first or shares
 * the requests (key-model-lists.md 12, decision 1): said plainly, with the three ways to keep the requests on the
 * subscription. The priority is a change of the page's draft (saved with Save); the exclusion is written at
 * once; the fixed list is the key's setting on Accounts.
 */
function PaidOverlap({
  item,
  locked,
  edit,
  onExclude,
  excludeBlocked,
}: {
  item: NameItem;
  locked: boolean;
  edit: NameCardProps['edit'];
  onExclude?: (line: RouteLine, model: string) => void;
  excludeBlocked: string | null;
}) {
  const { t } = useTranslation();
  const tried = item.lines.filter((line) => line.state !== 'removed' && !line.off);
  const top = (lines: RouteLine[]) =>
    [...lines].sort((a, b) => (b.priority ?? -Infinity) - (a.priority ?? -Infinity))[0];
  const keyLine = top(tried.filter((line) => line.learned && line.access === 'api'));
  const subLine = top(tried.filter((line) => line.access === 'sub'));
  if (!keyLine || !subLine) return null;
  // The key by its kind and address ("Codex API key (api.openai.com)"), an entry by its name ("OpenRouter"),
  // so it never reads as the subscription's service.
  const keyService = providerName(t, keyLine.provider, keyLine.host);
  const named = keyLine.provider.startsWith('openai-compatible-') || isOpenRouterHost(keyLine.host);
  const key =
    named || !keyLine.host
      ? keyService
      : t('provimux.models.paid_key_named', { name: keyService, host: keyLine.host });
  const sub = providerName(t, subLine.provider, subLine.host);
  const below = subLine.priority !== null ? subLine.priority - 1 : null;
  const order =
    item.paid === 'key-first'
      ? t('provimux.models.paid_key_first', { key, sub })
      : item.paid === 'shared'
        ? t('provimux.models.paid_shared', { key, sub })
        : t('provimux.models.paid_unknown', { key });
  return (
    <div className={styles.paid} role="note">
      <p className={styles.paidTitle}>
        <IconAlertTriangle size={14} />
        <span>{t('provimux.models.paid_title', { key, sub, model: keyLine.upstream })}</span>
      </p>
      <p className={styles.paidText}>{order}</p>
      <div className={styles.paidActions}>
        <span className={styles.paidLead}>{t('provimux.models.paid_stop')}</span>
        {below !== null && keyLine.entryId ? (
          <button
            type="button"
            className={styles.ghost}
            data-tone="action"
            disabled={locked}
            title={t('provimux.models.paid_priority_title')}
            onClick={() => edit((draft) => setKeyPriority(draft, keyLine.entryId!, below))}
          >
            {t('provimux.models.paid_priority', { value: below })}
          </button>
        ) : null}
        {onExclude ? (
          <button
            type="button"
            className={styles.ghost}
            data-tone="action"
            disabled={excludeBlocked !== null}
            title={excludeBlocked ?? t('provimux.models.paid_exclude_title')}
            onClick={() => onExclude(keyLine, keyLine.upstream)}
          >
            {t('provimux.models.paid_exclude')}
          </button>
        ) : null}
        {keyLine.authIndex ? (
          <Link
            to={accountsAddressOfKeyLists(keyLine.authIndex)}
            className={styles.ghost}
            data-tone="action"
            title={t('provimux.models.paid_fix_title')}
          >
            {t('provimux.models.paid_fix')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

const KNOWN_REASONS = new Set([
  'quota',
  'credential_quota',
  'transient_rate_limit',
  'transient_error',
  'unauthorized',
  'payment_required',
  'not_found',
  'model_not_supported',
  'invalid_grant',
  'cloudflare_challenge',
]);

/** A cooldown's reason and details in words: "quota · HTTP 429 · this model · backoff level 2". */
function cooldownDetails(
  t: TFunction,
  cooldown: ProvimuxRecordedCooldown,
  upstream: string
): { reason: string; details: string } {
  const reason = KNOWN_REASONS.has(cooldown.reason)
    ? t(`provimux.cooldown.reason.${cooldown.reason}`)
    : t('provimux.cooldown.reason.unknown', { code: cooldown.reason });
  const scope =
    cooldown.scope === 'credential'
      ? t('provimux.cooldown.scope_credential')
      : cooldown.scope === 'model'
        ? cooldown.model && cooldown.model !== upstream
          ? t('provimux.cooldown.scope_model_as', { model: cooldown.model })
          : t('provimux.cooldown.scope_model')
        : t('provimux.cooldown.scope_unknown', { scope: cooldown.scope });
  const details = [
    reason,
    cooldown.http_status !== null ? `HTTP ${cooldown.http_status}` : null,
    scope,
    cooldown.backoff_level !== null
      ? t('provimux.cooldown.backoff', { level: cooldown.backoff_level })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return { reason, details };
}

/**
 * A cooldown Provimux recorded on the route, counting down: a record (when it ends, why), never a verdict
 * that the route is unavailable.
 */
function Cooldown({
  cooldown,
  upstream,
  offsetMs,
}: {
  cooldown: ProvimuxRecordedCooldown;
  upstream: string;
  offsetMs: number;
}) {
  const { t, i18n } = useTranslation();
  const now = serverNow(useSecondClock(), offsetMs);
  const until = timeMs(cooldown.until) ?? now;
  const left = until - now;
  const { reason, details } = cooldownDetails(t, cooldown, upstream);
  return (
    <span
      className={styles.cooldown}
      data-ended={left <= 0 || undefined}
      title={`${t('provimux.cooldown.until', { time: formatExact(until, i18n.language) })} · ${details}`}
    >
      <IconTimer size={12} />
      {left > 0
        ? t('provimux.models.cooldown_left', { duration: formatDuration(left), reason })
        : t('provimux.models.cooldown_ended')}
    </span>
  );
}

/** A login's model list: its source and how old it is (what the Model lists page showed per login). */
function ListAge({ line, offsetMs }: { line: RouteLine; offsetMs: number }) {
  const { t, i18n } = useTranslation();
  const list = line.list!;
  const now = serverNow(usePageClock(), offsetMs);
  const kind = sourceKind(list.source);
  const fetched = timeMs(list.live.fetched_at);
  const source =
    kind === 'live'
      ? t('provimux.models.list_live', { provider: providerName(t, line.provider, line.host) })
      : kind === 'unknown'
        ? t('provimux.models.list_unknown', { source: list.source })
        : t(`provimux.models.list_${kind === 'built-in' ? 'built_in' : kind}`);
  // A held list a day old means its fetches have been failing; after 7 days the login no longer uses it.
  const age = listAge(list, now);
  const text =
    kind === 'live' && fetched !== null
      ? t('provimux.models.list_age', { source, age: formatRelative(fetched, now, i18n.language) })
      : t('provimux.models.list_only', { source });
  return (
    <span
      className={styles.listAge}
      data-age={age === 'old' || age === 'expired' ? age : undefined}
      title={
        list.live.listed_models !== null
          ? t('provimux.models.list_hint', { count: list.live.listed_models })
          : undefined
      }
    >
      {text}
    </span>
  );
}

/**
 * The priority a route is tried with. An API key's is stored in the configuration this page writes, so it
 * is edited here (it applies to every model of the key); a login's is in its login file, set on Auth Files.
 */
function Priority({
  line,
  locked,
  edit,
}: {
  line: RouteLine;
  locked: boolean;
  edit: NameCardProps['edit'];
}) {
  const { t } = useTranslation();
  const openInAccounts = useOpenInAccounts();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const value = line.priority === null ? '?' : String(line.priority);
  // A route of an API key the page knows (a login type's entry is never an 'api' route).
  const keyEntry = line.access === 'api' && line.entryId !== null;

  if (line.state === 'removed') return null;
  if (keyEntry && editing) {
    const parsed = /^-?\d+$/.test(text.trim()) ? Number(text.trim()) : null;
    const apply = () => {
      if (parsed === null) return;
      edit((draft) => setKeyPriority(draft, line.entryId!, parsed));
      setEditing(false);
    };
    return (
      <span className={styles.priorityEdit}>
        <label>
          <span className="visually-hidden">{t('provimux.models.priority_label')}</span>
          <input
            className={styles.priorityInput}
            value={text}
            inputMode="numeric"
            autoFocus
            aria-invalid={parsed === null || undefined}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') apply();
              if (event.key === 'Escape') setEditing(false);
            }}
          />
        </label>
        <button type="button" className={styles.ghost} disabled={parsed === null} onClick={apply}>
          {t('provimux.models.apply')}
        </button>
        <button type="button" className={styles.ghost} onClick={() => setEditing(false)}>
          {t('provimux.models.cancel')}
        </button>
        <span className={styles.priorityHint}>{t('provimux.models.priority_key_hint')}</span>
      </span>
    );
  }
  if (keyEntry) {
    return (
      <button
        type="button"
        className={styles.priority}
        data-edited={line.priorityEdited || undefined}
        disabled={locked}
        title={t('provimux.models.priority_key_title')}
        onClick={() => {
          setText(line.priority === null ? '0' : String(line.priority));
          setEditing(true);
        }}
      >
        {t('provimux.models.priority', { value })}
      </button>
    );
  }
  if (line.access === 'sub' && line.loginFile) {
    return (
      <button
        type="button"
        className={styles.priority}
        title={t('provimux.models.priority_login_title')}
        onClick={() => openInAccounts(line.loginFile!)}
      >
        {t('provimux.models.priority', { value })}
      </button>
    );
  }
  return (
    <span
      className={styles.priority}
      data-static
      title={
        line.access === 'api'
          ? t('provimux.models.priority_key_hint')
          : t('provimux.models.priority_login_title')
      }
    >
      {t('provimux.models.priority', { value })}
    </span>
  );
}

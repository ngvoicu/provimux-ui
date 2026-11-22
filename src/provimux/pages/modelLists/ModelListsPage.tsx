import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  IconChevronDown,
  IconChevronUp,
  IconInfo,
  IconLoader2,
  IconRefreshCw,
} from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { getTypeLabel } from '@/features/authFiles/constants';
import { useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { provimuxApi } from '../../api/provimuxApi';
import type {
  ProvimuxFieldSource,
  ProvimuxModelListLogin,
  ProvimuxModelListModel,
  ProvimuxModelListsResponse,
} from '../../api/types';
import { failureHint } from '../liveLists/logic';
import { requestRefresh, type RefreshOutcome } from '../liveLists/refreshRequest';
import { formatTokens, loginText } from '../modelRoutes/logic';
import { usePageClock } from '../shared/clocks';
import { ProviderPill } from '../shared/ProviderPill';
import { useRequestGuard } from '../shared/requestGuard';
import { useProvimuxResource } from '../shared/useProvimuxResource';
import { formatClock, formatExact, formatRelative, screenNow, timeMs } from '../time';
import {
  fieldSourceKind,
  listAge,
  modelListsSummary,
  modelOrigin,
  modelRowState,
  publishedLine,
  sortModels,
  sourceKind,
  type ModelRowState,
} from './logic';
import shared from '../shared/Shared.module.scss';
import live from '../liveLists/LiveListsPage.module.scss';
import styles from './ModelListsPage.module.scss';

const fetchLists = (client: Parameters<typeof provimuxApi.modelLists>[0]) =>
  provimuxApi.modelLists(client);

/** The status, on the page's schedule: on open, on Reload, and every 30 s while the tab is visible. */
const POLL_MS = 30_000;

type RefreshState =
  { phase: 'idle' } | { phase: 'sending' } | { phase: 'answered'; outcome: RefreshOutcome };

/**
 * Model lists (model-lists.md 5.5): per login the source that decides its models and its age, a mark for a list
 * that is getting old, the count of models the catalog lacks, and per login its models with the source of each
 * value. It replaces the live-lists page on servers that have GET /provimux/model-lists.
 */
export function ModelListsPage() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const resource = useProvimuxResource('modelLists', fetchLists, POLL_MS);
  const now = screenNow(usePageClock(), resource.loadedAt, resource.offsetMs);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState<RefreshState>({ phase: 'idle' });
  const refreshGuard = useRequestGuard();
  const switchGuard = useRequestGuard();

  const data = resource.data;
  const enabled = data?.options.live_lists ?? null;
  const logins = useMemo(() => data?.logins ?? [], [data]);
  const summary = useMemo(() => modelListsSummary(logins, now), [logins, now]);
  const { load } = resource;

  const startRefresh = async () => {
    setRefresh({ phase: 'sending' });
    await requestRefresh(refreshGuard, (outcome) => {
      setRefresh({ phase: 'answered', outcome });
      if (outcome.kind !== 'failed') void load();
    });
  };

  const toggle = async (next: boolean) => {
    const { client, isCurrent } = switchGuard.begin();
    setSaving(true);
    try {
      await provimuxApi.setLiveLists(next, client);
      if (!isCurrent()) return;
      useConfigStore.getState().clearCache();
      showNotification(
        next ? t('provimux.lists.saved_on') : t('provimux.lists.saved_off'),
        'success'
      );
      await load();
    } catch (error) {
      if (!isCurrent()) return;
      showNotification(
        t('provimux.common.save_failed', { message: getErrorMessage(error) }),
        'error'
      );
    } finally {
      if (isCurrent()) setSaving(false);
    }
  };

  const firstLoad = data === null && resource.loading;
  const typesText = (data?.login_types ?? []).map((p) => getTypeLabel(t, p)).join(', ');

  return (
    <div className={shared.page}>
      <header className={shared.header}>
        <div className={shared.headerText}>
          <h1 className={shared.title}>{t('provimux.lists.title')}</h1>
          <p className={shared.lede}>{t('provimux.lists.lede')}</p>
        </div>
        <div className={shared.headerActions}>
          {resource.loadedAt ? (
            <span
              className={shared.updated}
              title={formatExact(resource.loadedAt + resource.offsetMs, i18n.language)}
            >
              {t('provimux.common.updated', {
                time: formatClock(resource.loadedAt + resource.offsetMs, i18n.language, now),
              })}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            loading={resource.loading && data !== null}
          >
            <IconRefreshCw size={14} />
            {t('provimux.common.reload')}
          </Button>
        </div>
      </header>

      {firstLoad ? (
        <div
          className={shared.skeletons}
          aria-busy="true"
          aria-label={t('provimux.common.loading')}
        >
          <Skeleton height={140} />
          <Skeleton height={260} />
        </div>
      ) : data === null ? (
        <EmptyState
          title={t('provimux.lists.load_failed')}
          description={resource.error ?? undefined}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              {t('provimux.common.retry')}
            </Button>
          }
        />
      ) : (
        <>
          {resource.error ? (
            <p className={shared.inlineError} role="alert">
              {t('provimux.common.refresh_failed', { message: resource.error })}
            </p>
          ) : null}

          <PublishedStatus data={data} nowMs={now} />

          <section
            className={`${shared.feature} ${live.switchCard}`}
            aria-labelledby="pmx-lists-switch"
          >
            <div className={shared.featureHead}>
              <div className={shared.featureTitles}>
                <h2 id="pmx-lists-switch" className={shared.featureTitle}>
                  {t('provimux.lists.switch_title')}
                </h2>
                <p className={shared.featureEyebrow}>
                  <code>models.live-lists</code>
                </p>
              </div>
              <div className={shared.featureControl}>
                <ToggleSwitch
                  checked={enabled === true}
                  onChange={(next) => void toggle(next)}
                  disabled={saving || enabled === null}
                  ariaLabel={t('provimux.live.switch_label')}
                  labelPosition="left"
                  label={
                    <span className={shared.switchState}>
                      {enabled === null
                        ? t('provimux.common.unknown')
                        : enabled
                          ? t('provimux.common.on')
                          : t('provimux.common.off')}
                    </span>
                  }
                />
              </div>
            </div>
            <p className={shared.featureText}>
              {enabled === null
                ? t('provimux.live.unknown_text')
                : enabled
                  ? t('provimux.lists.on_text')
                  : t('provimux.lists.off_text')}
            </p>
            <div className={live.refreshRow}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void startRefresh()}
                disabled={enabled !== true || refresh.phase === 'sending'}
                loading={refresh.phase === 'sending'}
              >
                <IconRefreshCw size={14} />
                {t('provimux.live.refresh_now')}
              </Button>
              <RefreshStatus refresh={refresh} enabled={enabled} />
            </div>
          </section>

          {logins.length > 0 ? (
            <div className={shared.chips} aria-label={t('provimux.live.summary_label')}>
              <span className={shared.chip} data-tone="brand">
                {t('provimux.lists.count_live', { count: summary.live })}
              </span>
              {summary.published > 0 ? (
                <span className={shared.chip}>
                  {t('provimux.lists.count_published', { count: summary.published })}
                </span>
              ) : null}
              <span className={shared.chip}>
                {t('provimux.lists.count_built_in', { count: summary.builtIn })}
              </span>
              {summary.none > 0 ? (
                <span className={shared.chip} data-tone="cooling">
                  {t('provimux.lists.count_none', { count: summary.none })}
                </span>
              ) : null}
              {summary.unknown > 0 ? (
                <span className={shared.chip}>
                  {t('provimux.live.count_unknown', { count: summary.unknown })}
                </span>
              ) : null}
              {summary.learned > 0 ? (
                <span className={shared.chip} data-tone="ok">
                  {t('provimux.lists.count_learned', { count: summary.learned })}
                </span>
              ) : null}
              {summary.old > 0 ? (
                <span className={shared.chip} data-tone="cooling">
                  {t('provimux.lists.count_old', { count: summary.old })}
                </span>
              ) : null}
              {summary.failing > 0 ? (
                <span className={shared.chip} data-tone="cooling">
                  {t('provimux.live.count_failing', { count: summary.failing })}
                </span>
              ) : null}
              {summary.fetching > 0 ? (
                <span className={shared.chip}>
                  <IconLoader2 size={12} className={live.spin} />
                  {t('provimux.live.count_fetching', { count: summary.fetching })}
                </span>
              ) : null}
            </div>
          ) : null}

          {logins.length === 0 ? (
            <EmptyState
              title={t('provimux.lists.empty_title')}
              description={t('provimux.lists.empty_text', { providers: typesText || '—' })}
            />
          ) : (
            <div className={live.tableWrap}>
              <table className={live.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('provimux.live.col_login')}</th>
                    <th scope="col">{t('provimux.live.col_source')}</th>
                    <th scope="col">{t('provimux.lists.col_age')}</th>
                    <th scope="col">{t('provimux.live.col_models')}</th>
                    <th scope="col">{t('provimux.live.col_failure')}</th>
                  </tr>
                </thead>
                {logins.map((login, index) => (
                  <LoginRows
                    key={login.auth_index ?? `${login.provider}-${index}`}
                    login={login}
                    state={modelRowState(login, enabled, now)}
                    nowMs={now}
                  />
                ))}
              </table>
            </div>
          )}

          <p className={shared.note}>
            <IconInfo size={14} />
            <span>{t('provimux.lists.note', { providers: typesText || '—' })}</span>
          </p>
        </>
      )}
    </div>
  );
}

/** The line at the top: the providers.dev dataset held, or that providers.dev was not reached and since when. */
export function PublishedStatus({
  data,
  nowMs,
}: {
  data: ProvimuxModelListsResponse;
  nowMs: number;
}) {
  const { t, i18n } = useTranslation();
  const line = publishedLine(data);
  const { published } = data;
  const generated = timeMs(published.generated_at);
  const failedAt = timeMs(published.last_failure?.at);
  const date = generated !== null ? formatExact(generated, i18n.language) : '—';
  let text: string;
  switch (line) {
    case 'held':
    case 'held_failing':
      text = t('provimux.lists.published_held', {
        version: (published.dataset_version ?? '?').slice(0, 12),
        date,
      });
      break;
    case 'none':
    case 'none_failing':
      text = t('provimux.lists.published_none');
      break;
    case 'off':
      text = t('provimux.lists.published_off');
      break;
    default:
      text = t('provimux.lists.published_unknown', { state: published.state });
  }
  return (
    <p className={styles.published} data-line={line} role="status">
      <IconInfo size={14} />
      <span>
        {text}
        {(line === 'held_failing' || line === 'none_failing') && failedAt !== null
          ? ` ${t('provimux.lists.published_unreached', {
              since: formatRelative(failedAt, nowMs, i18n.language),
            })}`
          : null}
        {published.from_cache ? ` ${t('provimux.lists.published_from_cache')}` : null}
      </span>
    </p>
  );
}

function RefreshStatus({ refresh, enabled }: { refresh: RefreshState; enabled: boolean | null }) {
  const { t, i18n } = useTranslation();
  if (refresh.phase === 'sending') return <span className={live.refreshHint} aria-live="polite" />;
  if (refresh.phase === 'answered') {
    const { outcome } = refresh;
    if (outcome.kind === 'requested') {
      return (
        <span className={live.refreshHint} aria-live="polite">
          {t('provimux.live.refresh_requested', {
            time: formatClock(outcome.atMs, i18n.language, outcome.atMs),
          })}
        </span>
      );
    }
    if (outcome.kind === 'catalog_failed') {
      return (
        <span className={live.refreshHint} data-tone="warning" role="status">
          {t('provimux.live.refresh_catalog_failed', { message: outcome.message })}
        </span>
      );
    }
    if (outcome.kind === 'unconfirmed') {
      return (
        <span className={live.refreshHint} data-tone="warning" role="status">
          {t('provimux.live.refresh_unconfirmed')}
        </span>
      );
    }
    return (
      <span className={live.refreshHint} data-tone="error" role="alert">
        {t('provimux.live.refresh_failed', { message: outcome.message })}
      </span>
    );
  }
  return (
    <span className={live.refreshHint} aria-live="polite">
      {enabled === true ? t('provimux.live.refresh_hint') : t('provimux.live.refresh_off_hint')}
    </span>
  );
}

export type ModelsState =
  | { phase: 'closed' }
  | { phase: 'loading' }
  | { phase: 'ready'; models: ProvimuxModelListModel[] }
  | { phase: 'error'; message: string };

/** One login: its row, and below it, when opened, its models. */
export function LoginRows({
  login,
  state,
  nowMs,
}: {
  login: ProvimuxModelListLogin;
  state: ModelRowState;
  nowMs: number;
}) {
  const { t, i18n } = useTranslation();
  const guard = useRequestGuard();
  const [models, setModels] = useState<ModelsState>({ phase: 'closed' });
  const name = loginText({ kind: 'oauth', host: null, login: login.login });
  const fetched = timeMs(login.live.fetched_at);
  const failure = login.live.last_failure;
  const failedAt = timeMs(failure?.at);
  const kind = sourceKind(login.source);
  const age = listAge(login, nowMs);
  const panelId = `pmx-models-${login.auth_index ?? login.provider}`;
  const open = models.phase !== 'closed';

  const toggleModels = async () => {
    if (open) {
      guard.begin(); // drops an answer still on its way
      setModels({ phase: 'closed' });
      return;
    }
    if (!login.auth_index) return;
    const { client, isCurrent } = guard.begin();
    setModels({ phase: 'loading' });
    try {
      const answer = await provimuxApi.modelLists(client, login.auth_index);
      if (!isCurrent()) return;
      const row = answer.logins.find((candidate) => candidate.auth_index === login.auth_index);
      setModels({ phase: 'ready', models: sortModels(row?.models ?? []) });
    } catch (error) {
      if (!isCurrent()) return;
      setModels({ phase: 'error', message: getErrorMessage(error) });
    }
  };

  return (
    <tbody>
      <tr className={`${live.row} ${styles.row}`} data-state={state}>
        <td data-label={t('provimux.live.col_login')}>
          <div className={live.loginCell}>
            <ProviderPill provider={login.provider} />
            <span className={live.loginName}>
              {name.primary ??
                t('provimux.routes.runtime_login', { index: login.auth_index ?? '?' })}
            </span>
            {name.secondary ? <span className={live.loginFile}>{name.secondary}</span> : null}
          </div>
        </td>
        <td data-label={t('provimux.live.col_source')}>
          <div className={live.sourceCell}>
            <span className={live.source} data-source={kind === 'live' ? 'live' : kind}>
              {state === 'fetching' ? <IconLoader2 size={12} className={live.spin} /> : null}
              {kind === 'unknown'
                ? t('provimux.live.source_unknown', { source: login.source })
                : t(`provimux.lists.source.${kind}`)}
            </span>
            <span className={live.stateNote}>{t(`provimux.lists.state.${state}`)}</span>
          </div>
        </td>
        <td data-label={t('provimux.lists.col_age')}>
          {fetched !== null ? (
            <div className={styles.ageCell}>
              <span className={live.when} title={formatExact(fetched, i18n.language)}>
                {formatRelative(fetched, nowMs, i18n.language)}
              </span>
              {age === 'old' || age === 'expired' ? (
                <span
                  className={styles.ageMark}
                  data-age={age}
                  title={t('provimux.lists.age_rule')}
                >
                  {t(`provimux.lists.age.${age}`)}
                </span>
              ) : null}
              {login.live.from_cache ? (
                <span className={styles.cacheMark} title={t('provimux.lists.from_cache_title')}>
                  {t('provimux.lists.from_cache')}
                </span>
              ) : null}
            </div>
          ) : (
            <span className={live.none}>—</span>
          )}
        </td>
        <td data-label={t('provimux.live.col_models')}>
          <div className={live.counts}>
            <span>
              {login.registered_models !== null ? (
                <b>{login.registered_models}</b>
              ) : (
                <span className={live.none}>?</span>
              )}{' '}
              {t('provimux.live.served')}
            </span>
            <span className={live.listed}>
              {login.live.listed_models !== null
                ? t('provimux.live.listed', { count: login.live.listed_models })
                : login.live.supported
                  ? t('provimux.live.listed_none')
                  : t('provimux.lists.no_vendor_list')}
            </span>
            {login.learned_models !== null && login.learned_models > 0 ? (
              <span className={styles.learned}>
                {t('provimux.lists.learned', { count: login.learned_models })}
              </span>
            ) : null}
            {login.auth_index ? (
              <button
                type="button"
                className={styles.modelsToggle}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => void toggleModels()}
              >
                {open ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
                {open ? t('provimux.lists.hide_models') : t('provimux.lists.show_models')}
              </button>
            ) : null}
          </div>
        </td>
        <td data-label={t('provimux.live.col_failure')}>
          {failure && failedAt !== null ? (
            <div className={live.failure}>
              <span className={live.failureCode} title={formatExact(failedAt, i18n.language)}>
                {failure.category === 'http_status' && failure.http_status !== null
                  ? `HTTP ${failure.http_status}`
                  : t(`provimux.live.category.${failure.category}`, {
                      defaultValue: failure.category,
                    })}
                <span className={live.failureWhen}>
                  {formatRelative(failedAt, nowMs, i18n.language)}
                </span>
              </span>
              <span className={live.failureHint}>
                {t(`provimux.live.hint.${failureHint(failure)}`)}
              </span>
            </div>
          ) : (
            <span className={live.none}>—</span>
          )}
        </td>
      </tr>
      {open ? (
        <tr className={styles.modelsRow}>
          <td colSpan={5} id={panelId}>
            <ModelsPanel state={models} provider={login.provider} />
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

export function ModelsPanel({ state, provider }: { state: ModelsState; provider: string }) {
  const { t } = useTranslation();
  if (state.phase === 'loading') {
    return (
      <div className={styles.modelsLoading} aria-busy="true">
        <IconLoader2 size={14} className={live.spin} />
        {t('provimux.common.loading')}
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <p className={shared.inlineError} role="alert">
        {t('provimux.lists.models_failed', { message: state.message })}
      </p>
    );
  }
  if (state.phase !== 'ready') return null;
  if (state.models.length === 0) {
    return <p className={styles.modelsEmpty}>{t('provimux.lists.models_empty')}</p>;
  }
  return (
    <div className={styles.models}>
      <table className={styles.modelsTable}>
        <thead>
          <tr>
            <th scope="col">{t('provimux.lists.model_col')}</th>
            <th scope="col">{t('provimux.lists.origin_col')}</th>
            <th scope="col">{t('provimux.lists.context_col')}</th>
            <th scope="col">{t('provimux.lists.output_col')}</th>
            <th scope="col">{t('provimux.lists.levels_col')}</th>
          </tr>
        </thead>
        <tbody>
          {state.models.map((model) => (
            <ModelRow key={model.id} model={model} provider={provider} />
          ))}
        </tbody>
      </table>
      <p className={styles.legend}>
        <FieldTag source="live" /> {t('provimux.lists.legend_live')} <FieldTag source="built-in" />{' '}
        {t('provimux.lists.legend_built_in')}
      </p>
    </div>
  );
}

function ModelRow({ model, provider }: { model: ProvimuxModelListModel; provider: string }) {
  const { t, i18n } = useTranslation();
  const origin = modelOrigin(model);
  return (
    <tr data-origin={origin}>
      <td>
        <span className={styles.modelId}>{model.id}</span>
        {model.display_name ? (
          <span className={styles.modelName}>
            {model.display_name} <FieldTag source={model.sources.display_name} />
          </span>
        ) : null}
      </td>
      <td>
        <span className={styles.origin} data-origin={origin}>
          {origin === 'learned'
            ? t('provimux.lists.origin.learned', { provider: getTypeLabel(t, provider) })
            : t(`provimux.lists.origin.${origin}`)}
        </span>
      </td>
      <td>
        {model.limits.context !== null ? (
          <>
            {formatTokens(model.limits.context, i18n.language)}{' '}
            <FieldTag source={model.sources.context} />
          </>
        ) : (
          <span className={live.none}>—</span>
        )}
      </td>
      <td>
        {model.limits.output !== null ? (
          <>
            {formatTokens(model.limits.output, i18n.language)}{' '}
            <FieldTag source={model.sources.output} />
          </>
        ) : (
          <span className={live.none}>—</span>
        )}
      </td>
      <td>
        {model.reasoning_levels.length > 0 ? (
          <>
            {model.reasoning_levels.join(', ')} <FieldTag source={model.sources.reasoning_levels} />
          </>
        ) : (
          <span className={live.none}>—</span>
        )}
      </td>
    </tr>
  );
}

/** Which source gave a value: L (the vendor's live list) or B (the built-in list); nothing when none says. */
function FieldTag({ source }: { source: ProvimuxFieldSource }) {
  const { t } = useTranslation();
  const kind = fieldSourceKind(source);
  if (kind === 'none') return null;
  const label =
    kind === 'unknown'
      ? t('provimux.lists.field_unknown', { source: source ?? '' })
      : t(`provimux.lists.field.${kind}`);
  return (
    <abbr className={styles.fieldTag} data-field-source={kind} title={label} aria-label={label}>
      {kind === 'live' ? 'L' : kind === 'built-in' ? 'B' : '?'}
    </abbr>
  );
}

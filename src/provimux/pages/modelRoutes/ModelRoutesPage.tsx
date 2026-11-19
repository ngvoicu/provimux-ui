import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconInfo, IconRefreshCw, IconSearch, IconX } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { getTypeLabel } from '@/features/authFiles/constants';
import { provimuxApi } from '../../api/provimuxApi';
import { usePageClock } from '../shared/clocks';
import { useProvimuxResource } from '../shared/useProvimuxResource';
import { formatClock, formatExact, screenNow } from '../time';
import { DevinCoolingCard } from './DevinCoolingCard';
import { ModelCard } from './ModelCard';
import { OpenRouterCard } from './OpenRouterCard';
import { useDevinCooling } from './useDevinCooling';
import {
  compatibleEntryOf,
  filterModels,
  providerCounts,
  summarize,
  type ModelFilter,
  type ModelView,
} from './logic';
import shared from '../shared/Shared.module.scss';
import styles from './ModelRoutesPage.module.scss';

/** The contract's rhythm: on open, on refresh, every 30 s while visible. */
const POLL_MS = 30_000;
const fetchRoutes = (client: Parameters<typeof provimuxApi.modelRoutes>[0]) =>
  provimuxApi.modelRoutes(client);

/** Which subscription or API key serves each model, in priority order, with the cooldowns Provimux recorded. */
export function ModelRoutesPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  // The Devin switch is read with the routes on every manual refresh: another client may have changed it.
  const devin = useDevinCooling();
  const resource = useProvimuxResource('modelRoutes', fetchRoutes, POLL_MS, devin.read);
  const now = screenNow(usePageClock(), resource.loadedAt, resource.offsetMs);
  const [filter, setFilter] = useState<ModelFilter>(() => ({
    query: '',
    provider: searchParams.get('provider') || 'all',
    view: 'all',
  }));

  const models = useMemo(() => resource.data?.models ?? [], [resource.data]);
  const summary = useMemo(() => summarize(models, now), [models, now]);
  const providers = useMemo(() => providerCounts(models), [models]);
  const visible = useMemo(() => filterModels(models, filter, now), [models, filter, now]);

  const providerName = (key: string) =>
    key === 'openrouter'
      ? 'OpenRouter'
      : compatibleEntryOf(key)
        ? t('provimux.routes.compatible_entry', { name: compatibleEntryOf(key) })
        : getTypeLabel(t, key);
  const providerOptions = [
    { value: 'all', label: t('provimux.routes.all_providers') },
    ...providers.map(({ key, count }) => ({
      value: key,
      label: `${providerName(key)} (${count})`,
    })),
  ];
  if (filter.provider !== 'all' && !providers.some((p) => p.key === filter.provider)) {
    providerOptions.push({ value: filter.provider, label: providerName(filter.provider) });
  }
  const views: Array<{ value: ModelView; label: string }> = [
    { value: 'all', label: t('provimux.routes.view_all') },
    { value: 'cooldown', label: t('provimux.routes.view_cooldown') },
    { value: 'several', label: t('provimux.routes.view_several') },
  ];
  const filtered = filter.query !== '' || filter.provider !== 'all' || filter.view !== 'all';
  const firstLoad = resource.data === null && resource.loading;

  return (
    <div className={shared.page}>
      <header className={shared.header}>
        <div className={shared.headerText}>
          <h1 className={shared.title}>{t('provimux.routes.title')}</h1>
          <p className={shared.lede}>{t('provimux.routes.lede')}</p>
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
            onClick={() => void resource.refresh()}
            loading={resource.loading && resource.data !== null}
          >
            <IconRefreshCw size={14} />
            {t('provimux.common.refresh')}
          </Button>
        </div>
      </header>

      {resource.data ? (
        <div className={shared.chips} aria-label={t('provimux.routes.summary_label')}>
          <span className={shared.chip}>
            {t('provimux.routes.count_models', { count: summary.models })}
          </span>
          <span className={shared.chip} data-access="sub">
            <span className={shared.chipDot} aria-hidden="true" />
            {t('provimux.routes.count_subscriptions', { count: summary.subscriptions })}
          </span>
          <span className={shared.chip} data-access="api">
            <span className={shared.chipDot} aria-hidden="true" />
            {t('provimux.routes.count_api_keys', { count: summary.apiKeys })}
          </span>
          <button
            type="button"
            className={shared.chip}
            data-tone={summary.cooldowns > 0 ? 'cooling' : undefined}
            aria-pressed={filter.view === 'cooldown'}
            disabled={summary.cooldowns === 0}
            onClick={() =>
              setFilter((prev) => ({
                ...prev,
                view: prev.view === 'cooldown' ? 'all' : 'cooldown',
              }))
            }
          >
            {t('provimux.routes.count_cooldowns', { count: summary.cooldowns })}
          </button>
        </div>
      ) : null}

      {resource.error && resource.data ? (
        <p className={shared.inlineError} role="alert">
          {t('provimux.common.refresh_failed', { message: resource.error })}
        </p>
      ) : null}

      {firstLoad ? (
        <div
          className={shared.skeletons}
          aria-busy="true"
          aria-label={t('provimux.common.loading')}
        >
          <Skeleton height={150} />
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} height={120} />
          ))}
        </div>
      ) : resource.data === null ? (
        <EmptyState
          title={t('provimux.routes.load_failed')}
          description={resource.error ?? undefined}
          action={
            <Button variant="secondary" onClick={() => void resource.refresh()}>
              {t('provimux.common.retry')}
            </Button>
          }
        />
      ) : (
        <>
          <div className={shared.features}>
            <DevinCoolingCard
              models={models}
              offsetMs={resource.offsetMs}
              nowMs={now}
              devin={devin}
              onChanged={() => void resource.load()}
            />
            <OpenRouterCard
              models={models}
              onShowModels={() => setFilter({ query: '', provider: 'openrouter', view: 'all' })}
            />
          </div>

          <div className={shared.toolbar} role="search">
            <label className={shared.search}>
              <IconSearch size={15} className={shared.searchIcon} />
              <input
                type="search"
                value={filter.query}
                onChange={(event) => setFilter((prev) => ({ ...prev, query: event.target.value }))}
                placeholder={t('provimux.routes.search_placeholder')}
                aria-label={t('provimux.routes.search_placeholder')}
              />
            </label>
            <Select
              value={filter.provider}
              options={providerOptions}
              onChange={(value) => setFilter((prev) => ({ ...prev, provider: value }))}
              ariaLabel={t('provimux.routes.provider_filter')}
              size="sm"
              fullWidth={false}
              className={shared.providerSelect}
            />
            <div
              className={shared.segmented}
              role="group"
              aria-label={t('provimux.routes.view_label')}
            >
              {views.map((view) => (
                <button
                  key={view.value}
                  type="button"
                  aria-pressed={filter.view === view.value}
                  onClick={() => setFilter((prev) => ({ ...prev, view: view.value }))}
                >
                  {view.label}
                </button>
              ))}
            </div>
            {filtered ? (
              <button
                type="button"
                className={shared.clear}
                onClick={() => setFilter({ query: '', provider: 'all', view: 'all' })}
              >
                <IconX size={13} />
                {t('provimux.common.clear_filters')}
              </button>
            ) : null}
          </div>

          <p className={shared.note}>
            <IconInfo size={14} />
            <span>{t('provimux.routes.note')}</span>
          </p>

          {models.length === 0 ? (
            <EmptyState
              title={t('provimux.routes.empty_title')}
              description={t('provimux.routes.empty_text')}
            />
          ) : visible.length === 0 ? (
            <EmptyState title={t('provimux.routes.no_match')} />
          ) : (
            <div className={styles.list}>
              {filtered ? (
                <p className={styles.listCount}>
                  {t('provimux.routes.showing', { shown: visible.length, total: models.length })}
                </p>
              ) : null}
              {visible.map((model) => (
                <ModelCard key={model.id} model={model} offsetMs={resource.offsetMs} nowMs={now} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

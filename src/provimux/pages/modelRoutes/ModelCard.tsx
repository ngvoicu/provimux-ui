import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProvimuxLimits, ProvimuxModel, ProvimuxModelRoute } from '../../api/types';
import { AccessBadge } from '../shared/AccessBadge';
import { ProviderPill } from '../shared/ProviderPill';
import { CooldownNote } from './CooldownNote';
import { accessOf, formatInteger, formatTokens, isCoolingAt, loginText, tiersOf } from './logic';
import styles from './ModelRoutesPage.module.scss';

function Limits({ limits }: { limits: ProvimuxLimits }) {
  const { t, i18n } = useTranslation();
  const part = (value: number | null, known: string, unknown: string) =>
    value === null ? (
      <span className={styles.unknown}>{t(unknown)}</span>
    ) : (
      <span
        title={t('provimux.routes.tokens_exact', { value: formatInteger(value, i18n.language) })}
      >
        <b>{formatTokens(value, i18n.language)}</b> {t(known)}
      </span>
    );
  return (
    <span className={styles.limits}>
      {part(limits.context, 'provimux.routes.context', 'provimux.routes.context_unknown')}
      <span className={styles.sep} aria-hidden="true">
        ·
      </span>
      {part(limits.output, 'provimux.routes.output', 'provimux.routes.output_unknown')}
    </span>
  );
}

function Reasoning({ route }: { route: ProvimuxModelRoute }) {
  const { t, i18n } = useTranslation();
  const reasoning = route.reasoning;
  if (!reasoning || (reasoning.levels.length === 0 && !reasoning.budget)) return null;
  return (
    <span className={styles.reasoning}>
      {reasoning.levels.length > 0 ? (
        <span className={styles.levels} aria-label={t('provimux.routes.levels_label')}>
          {reasoning.levels.map((level) => (
            <span key={level} className={styles.level}>
              {level}
            </span>
          ))}
        </span>
      ) : null}
      {reasoning.budget ? (
        <span
          className={styles.budget}
          title={[
            reasoning.budget.zero_allowed ? t('provimux.routes.budget_zero') : null,
            reasoning.budget.dynamic_allowed ? t('provimux.routes.budget_dynamic') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {t('provimux.routes.budget', {
            min: formatInteger(reasoning.budget.min, i18n.language),
            max: formatInteger(reasoning.budget.max, i18n.language),
          })}
        </span>
      ) : null}
    </span>
  );
}

function RouteRow({
  route,
  model,
  offsetMs,
  nowMs,
}: {
  route: ProvimuxModelRoute;
  model: ProvimuxModel;
  offsetMs: number;
  nowMs: number;
}) {
  const { t } = useTranslation();
  const access = accessOf(route.kind);
  const login = loginText(route);
  const cooling = isCoolingAt(route.recorded_cooldown, nowMs);
  return (
    <li className={styles.route} data-access={access} data-cooling={cooling || undefined}>
      <div className={styles.routeMain}>
        <AccessBadge access={access} kind={route.kind} />
        <ProviderPill provider={route.provider} host={route.host} />
        <span
          className={styles.login}
          title={
            route.auth_index
              ? t('provimux.routes.auth_index', { index: route.auth_index })
              : undefined
          }
        >
          {login.primary ?? (
            <span className={styles.unknown}>
              {t('provimux.routes.runtime_login', { index: route.auth_index ?? '?' })}
            </span>
          )}
        </span>
        {login.secondary ? <span className={styles.loginSecondary}>{login.secondary}</span> : null}
      </div>
      <div className={styles.routeMeta}>
        <Limits limits={route.limits} />
        <Reasoning route={route} />
      </div>
      {route.recorded_cooldown ? (
        <CooldownNote cooldown={route.recorded_cooldown} offsetMs={offsetMs} modelId={model.id} />
      ) : null}
    </li>
  );
}

interface ModelCardProps {
  model: ProvimuxModel;
  offsetMs: number;
  /** The server's now, coarse (for which routes count as cooling). */
  nowMs: number;
}

/** One model: what clients are told, then its routes by priority tier, highest first. */
export const ModelCard = memo(function ModelCard({ model, offsetMs, nowMs }: ModelCardProps) {
  const { t } = useTranslation();
  const tiers = tiersOf(model.routes);
  const subtitle = [
    model.display_name && model.display_name !== model.id ? model.display_name : null,
    model.owned_by,
  ].filter(Boolean);

  return (
    <article className={styles.model} aria-label={model.id}>
      <header className={styles.modelHead}>
        <div className={styles.modelName}>
          <h2 className={styles.modelId}>{model.id}</h2>
          {subtitle.length > 0 ? <p className={styles.modelSub}>{subtitle.join(' · ')}</p> : null}
        </div>
        <div className={styles.modelTold}>
          <span className={styles.modelToldLabel}>{t('provimux.routes.clients_told')}</span>
          <Limits limits={model.limits} />
        </div>
      </header>
      <ol className={styles.tiers}>
        {tiers.map((tier) => (
          <li key={tier.priority} className={styles.tier}>
            <span
              className={styles.tierPriority}
              title={
                tier.routes.length > 1
                  ? t('provimux.routes.tier_shared', {
                      priority: tier.priority,
                      count: tier.routes.length,
                    })
                  : t('provimux.routes.tier', { priority: tier.priority })
              }
            >
              <span className={styles.tierPriorityLabel}>
                {t('provimux.routes.priority_short')}
              </span>
              {tier.priority}
            </span>
            <ul className={styles.routes}>
              {tier.routes.map((route, index) => (
                <RouteRow
                  key={`${route.auth_index ?? route.provider}-${index}`}
                  route={route}
                  model={model}
                  offsetMs={offsetMs}
                  nowMs={nowMs}
                />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </article>
  );
});

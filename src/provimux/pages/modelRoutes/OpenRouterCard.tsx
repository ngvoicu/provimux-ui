import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { IconCopy, IconExternalLink, IconNetwork } from '@/components/ui/icons';
import {
  readProvidersWorkbenchUiState,
  writeProvidersWorkbenchUiState,
} from '@/features/providers/uiState';
import { useConfigStore } from '@/stores';
import type { ProvimuxModel } from '../../api/types';
import { OPENROUTER_BASE_URL, formatTokens, openRouterEntries, openRouterModels } from './logic';
import styles from '../shared/Shared.module.scss';

interface OpenRouterCardProps {
  models: readonly ProvimuxModel[];
  /** Narrow the model list to OpenRouter. */
  onShowModels: () => void;
}

/**
 * OpenRouter built in: what Provimux adds to an OpenAI-compatible entry on openrouter.ai, the configured entries
 * (edited where the console manages providers, AI Providers → OpenAI Compatible), and the limits Provimux read for
 * their models from OpenRouter's list.
 */
export function OpenRouterCard({ models, onShowModels }: OpenRouterCardProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void fetchConfig().catch(() => undefined);
  }, [fetchConfig]);

  const entries = openRouterEntries(config?.openaiCompatibility);
  const routes = openRouterModels(models);

  const openInProviders = (entryName?: string) => {
    const ui = readProvidersWorkbenchUiState();
    const current = ui.filtersByBrand.openaiCompatibility;
    writeProvidersWorkbenchUiState({
      activeBrand: 'openaiCompatibility',
      filtersByBrand: {
        ...ui.filtersByBrand,
        openaiCompatibility: {
          filter: entryName ?? '',
          sortBy: current?.sortBy ?? 'name',
          sortDir: current?.sortDir ?? 'asc',
          selectedModels: [],
        },
      },
    });
    navigate('/ai-providers');
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(OPENROUTER_BASE_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={styles.feature} aria-labelledby="pmx-openrouter-title">
      <div className={styles.featureHead}>
        <span className={`${styles.featureIcon} ${styles.featureIconGlyph}`} aria-hidden="true">
          <IconNetwork size={16} />
        </span>
        <div className={styles.featureTitles}>
          <h2 id="pmx-openrouter-title" className={styles.featureTitle}>
            {t('provimux.openrouter.title')}
          </h2>
          <p className={styles.featureEyebrow}>{t('provimux.openrouter.eyebrow')}</p>
        </div>
        <div className={styles.featureControl}>
          <Button variant="secondary" size="sm" onClick={() => openInProviders()}>
            {t('provimux.openrouter.open_providers')}
          </Button>
        </div>
      </div>
      <p className={styles.featureText}>{t('provimux.openrouter.text')}</p>

      {entries.length === 0 ? (
        <div className={styles.featureEmpty}>
          <p>{t('provimux.openrouter.empty')}</p>
          <button type="button" className={styles.copyUrl} onClick={() => void copyUrl()}>
            <code>{OPENROUTER_BASE_URL}</code>
            <IconCopy size={13} />
            <span className={styles.copyState} aria-live="polite">
              {copied ? t('provimux.common.copied') : ''}
            </span>
          </button>
        </div>
      ) : (
        <ul className={styles.featureList} aria-label={t('provimux.openrouter.entries_label')}>
          {entries.map((entry) => {
            const modelCount = entry.models?.length ?? 0;
            const keyCount = entry.apiKeyEntries.length;
            return (
              <li
                key={`${entry.name}-${entry.sourceIndex ?? ''}`}
                className={styles.featureListItem}
              >
                <button
                  type="button"
                  className={styles.entryLink}
                  onClick={() => openInProviders(entry.name)}
                  title={t('provimux.openrouter.edit_entry', { name: entry.name })}
                >
                  <code>{entry.name}</code>
                  <IconExternalLink size={12} />
                </button>
                <span>
                  {[
                    t('provimux.openrouter.models', { count: modelCount }),
                    t('provimux.openrouter.keys', { count: keyCount }),
                    entry.disabled ? t('provimux.openrouter.disabled') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {routes.length > 0 ? (
        <button type="button" className={styles.featureLink} onClick={onShowModels}>
          {t('provimux.openrouter.limits_line', {
            count: routes.length,
            sample: routes
              .slice(0, 2)
              .map(({ model, route }) =>
                [
                  model.id,
                  route.limits.context !== null
                    ? formatTokens(route.limits.context, i18n.language)
                    : '?',
                ].join(' ')
              )
              .join(', '),
          })}
        </button>
      ) : null}
      <p className={styles.featureKey}>
        <code>api-keys.openai-compatibility[].base-url: openrouter.ai</code>
      </p>
    </section>
  );
}

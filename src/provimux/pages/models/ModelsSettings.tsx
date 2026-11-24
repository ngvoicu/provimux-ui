import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconDownload, IconRefreshCw } from '@/components/ui/icons';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useModelCatalogSync } from '@/features/authFiles/hooks/useModelCatalogSync';
import { useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { provimuxApi } from '../../api/provimuxApi';
import type { ProvimuxModel, ProvimuxModelListsResponse } from '../../api/types';
import { requestRefresh, type RefreshOutcome } from '../liveLists/refreshRequest';
import { DevinCoolingCard } from '../modelRoutes/DevinCoolingCard';
import { OpenRouterCard } from '../modelRoutes/OpenRouterCard';
import type { DevinCooling } from '../modelRoutes/useDevinCooling';
import { useRequestGuard } from '../shared/requestGuard';
import { formatClock } from '../time';
import shared from '../shared/Shared.module.scss';
import styles from './ModelsPage.module.scss';

type RefreshState =
  { phase: 'idle' } | { phase: 'sending' } | { phase: 'answered'; outcome: RefreshOutcome };

interface ModelsSettingsProps {
  models: readonly ProvimuxModel[];
  offsetMs: number;
  nowMs: number;
  devin: DevinCooling;
  /** The install has a Devin login: the Devin card is shown. */
  withDevin: boolean;
  /** The configuration has an OpenRouter entry: the OpenRouter card is shown. */
  withOpenRouter: boolean;
  /** Model lists' answer; null when the proxy has none (the card is not shown) or it is not read yet. */
  lists: ProvimuxModelListsResponse | null;
  onRoutesChanged: () => void;
  onListsChanged: () => void;
  onShowOpenRouter: () => void;
}

/**
 * The settings that decide what the list holds, below it: Devin's quota pause (only with a Devin login),
 * OpenRouter built in (only with an OpenRouter entry), and the live model lists switch with its refresh.
 */
export function ModelsSettings(props: ModelsSettingsProps) {
  const { t } = useTranslation();
  const { withDevin, withOpenRouter, lists } = props;
  if (!withDevin && !withOpenRouter && !lists) return null;
  return (
    <section className={styles.settings} aria-labelledby="pmx-models-settings">
      <h2 id="pmx-models-settings" className={styles.sectionTitle}>
        {t('provimux.models.settings_title')}
      </h2>
      <div className={shared.features}>
        {lists ? <ListsCard lists={lists} onChanged={props.onListsChanged} /> : null}
        {withDevin ? (
          <DevinCoolingCard
            models={props.models}
            offsetMs={props.offsetMs}
            nowMs={props.nowMs}
            devin={props.devin}
            onChanged={props.onRoutesChanged}
          />
        ) : null}
        {withOpenRouter ? (
          <OpenRouterCard models={props.models} onShowModels={props.onShowOpenRouter} />
        ) : null}
      </div>
    </section>
  );
}

/**
 * models.live-lists, and "Refresh lists now": what the Model lists page held, as one card. "Refresh lists now" is
 * `POST /models/refresh`, which updates the shared model catalog and, with live lists on, asks every login for its
 * list. With them off it cannot ask, so "Sync model catalog" stands beside it: the same catalog update, through
 * Auth Files' own action (`useModelCatalogSync`), the one the System page's models card had.
 */
function ListsCard({
  lists,
  onChanged,
}: {
  lists: ProvimuxModelListsResponse;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState<RefreshState>({ phase: 'idle' });
  const refreshGuard = useRequestGuard();
  const switchGuard = useRequestGuard();
  const enabled = lists.options.live_lists;
  const { syncingModelCatalog, syncModelCatalog } = useModelCatalogSync(onChanged);

  const startRefresh = async () => {
    setRefresh({ phase: 'sending' });
    await requestRefresh(refreshGuard, (outcome) => {
      setRefresh({ phase: 'answered', outcome });
      if (outcome.kind !== 'failed') onChanged();
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
      onChanged();
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

  const status = (() => {
    if (refresh.phase === 'answered') {
      const { outcome } = refresh;
      if (outcome.kind === 'requested') {
        return {
          tone: undefined,
          text: t('provimux.live.refresh_requested', {
            time: formatClock(outcome.atMs, i18n.language, outcome.atMs),
          }),
        };
      }
      if (outcome.kind === 'catalog_failed') {
        return {
          tone: 'warning',
          text: t('provimux.live.refresh_catalog_failed', { message: outcome.message }),
        };
      }
      if (outcome.kind === 'unconfirmed') {
        return { tone: 'warning', text: t('provimux.live.refresh_unconfirmed') };
      }
      return {
        tone: 'error',
        text: t('provimux.live.refresh_failed', { message: outcome.message }),
      };
    }
    if (refresh.phase === 'sending') return null;
    return {
      tone: undefined,
      text:
        enabled === true ? t('provimux.models.lists_hint') : t('provimux.models.lists_off_hint'),
    };
  })();

  return (
    <section className={shared.feature} aria-labelledby="pmx-models-lists">
      <div className={shared.featureHead}>
        <div className={shared.featureTitles}>
          <h3 id="pmx-models-lists" className={shared.featureTitle}>
            {t('provimux.lists.switch_title')}
          </h3>
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
        {/* A server with self-refreshing key lists: the switch covers API keys too. */}
        {enabled !== null && lists.keys ? (
          <> {enabled ? t('provimux.models.lists_keys_on') : t('provimux.models.lists_keys_off')}</>
        ) : null}
      </p>
      <div className={styles.refreshRow}>
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
        {enabled !== true ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void syncModelCatalog()}
            disabled={syncingModelCatalog}
            loading={syncingModelCatalog}
          >
            {!syncingModelCatalog ? <IconDownload size={14} /> : null}
            {t('auth_files.sync_catalog_button')}
          </Button>
        ) : null}
        {status ? (
          <span
            className={styles.refreshHint}
            data-tone={status.tone}
            role={status.tone === 'error' ? 'alert' : status.tone ? 'status' : undefined}
            aria-live={status.tone ? undefined : 'polite'}
          >
            {status.text}
          </span>
        ) : (
          <span className={styles.refreshHint} aria-live="polite" />
        )}
      </div>
    </section>
  );
}

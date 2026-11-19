import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { getAuthFileIcon } from '@/features/authFiles/constants';
import { useNotificationStore, useThemeStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { PROVIMUX_PATHS } from '../../api/provimuxApi';
import type { ProvimuxModel } from '../../api/types';
import { formatDuration, serverNow, timeMs } from '../time';
import { useSecondClock } from '../shared/clocks';
import { devinAbsence, devinState } from './logic';
import type { DevinCooling } from './useDevinCooling';
import styles from '../shared/Shared.module.scss';

interface DevinCoolingCardProps {
  models: readonly ProvimuxModel[];
  offsetMs: number;
  nowMs: number;
  /** The switch and the Devin logins, read by the page with its routes (useDevinCooling). */
  devin: DevinCooling;
  /** Reload the routes after the switch changed. */
  onChanged: () => void;
}

const configKey = PROVIMUX_PATHS.devinModelLevelCooling
  .replace('/config/', '')
  .split('/')
  .join('.');

/** Devin's quota pause per model: the switch (oauth.providers.devin.model-level-cooling) and what it does now. */
export function DevinCoolingCard({
  models,
  offsetMs,
  nowMs,
  devin,
  onChanged,
}: DevinCoolingCardProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const { value, readError, saving } = devin;

  const enabled = value === true;
  const toggle = async (next: boolean) => {
    const result = await devin.set(next);
    if (result === null) return; // answered after the page closed or the connection changed
    if (result.ok) {
      showNotification(
        next ? t('provimux.devin.saved_on') : t('provimux.devin.saved_off'),
        'success'
      );
      onChanged();
    } else {
      showNotification(
        t('provimux.common.save_failed', { message: getErrorMessage(result.error) }),
        'error'
      );
    }
  };

  const state = devinState(models, nowMs);
  const icon = getAuthFileIcon('devin', resolvedTheme);

  return (
    <section className={styles.feature} aria-labelledby="pmx-devin-title">
      <div className={styles.featureHead}>
        <span className={styles.featureIcon} aria-hidden="true">
          {icon ? <img src={icon} alt="" /> : null}
        </span>
        <div className={styles.featureTitles}>
          <h2 id="pmx-devin-title" className={styles.featureTitle}>
            {t('provimux.devin.title')}
          </h2>
          <p className={styles.featureEyebrow}>{t('provimux.devin.eyebrow')}</p>
        </div>
        <div className={styles.featureControl}>
          <ToggleSwitch
            checked={enabled}
            onChange={(next) => void toggle(next)}
            disabled={saving || value === undefined}
            ariaLabel={t('provimux.devin.switch_label')}
            label={
              <span className={styles.switchState}>
                {value === undefined
                  ? t('provimux.common.loading')
                  : enabled
                    ? t('provimux.common.on')
                    : value === null
                      ? t('provimux.common.off_default')
                      : t('provimux.common.off')}
              </span>
            }
            labelPosition="left"
          />
        </div>
      </div>
      <p className={styles.featureText}>
        {enabled ? t('provimux.devin.on_text') : t('provimux.devin.off_text')}
      </p>
      <DevinNow state={state} offsetMs={offsetMs} devin={devin} />
      {enabled ? <p className={styles.featureNote}>{t('provimux.devin.limit_note')}</p> : null}
      {readError ? (
        <p className={styles.featureError} role="alert">
          {t('provimux.common.read_failed', { message: readError })}
        </p>
      ) : null}
      <p className={styles.featureKey}>
        <code>{configKey}</code>
      </p>
    </section>
  );
}

function DevinNow({
  state,
  offsetMs,
  devin,
}: {
  state: ReturnType<typeof devinState>;
  offsetMs: number;
  devin: DevinCooling;
}) {
  const { t } = useTranslation();
  const now = serverNow(useSecondClock(), offsetMs);
  if (state.logins === 0) {
    // No Devin route: say a login is missing only when the credentials list has none.
    const absence = devinAbsence(devin.logins);
    return (
      <p className={styles.featureStatus}>
        {t(`provimux.devin.absent_${absence}`)}
        {absence !== 'no_login' ? (
          <>
            {' '}
            <Link to="/auth-files" className={styles.inlineLink}>
              {t('provimux.devin.open_auth_files')}
            </Link>
          </>
        ) : null}
      </p>
    );
  }
  if (state.cooling.length === 0) {
    return (
      <p className={styles.featureStatus} data-tone="ok">
        {t('provimux.devin.none_cooling', { count: state.models })}
      </p>
    );
  }
  return (
    <ul className={styles.featureList} aria-label={t('provimux.devin.cooling_label')}>
      {state.cooling.slice(0, 4).map(({ model, route }) => {
        const cooldown = route.recorded_cooldown!;
        const left = (timeMs(cooldown.until) ?? now) - now;
        return (
          <li
            key={`${model.id}-${route.auth_index}`}
            className={styles.featureListItem}
            data-tone="cooling"
          >
            <code>{model.id}</code>
            <span>
              {cooldown.scope === 'credential'
                ? t('provimux.cooldown.scope_credential')
                : t('provimux.cooldown.scope_model')}
              {' · '}
              {left > 0
                ? t('provimux.cooldown.left', { duration: formatDuration(left) })
                : t('provimux.cooldown.ended')}
            </span>
          </li>
        );
      })}
      {state.cooling.length > 4 ? (
        <li className={styles.featureListMore}>
          {t('provimux.common.and_more', { count: state.cooling.length - 4 })}
        </li>
      ) : null}
    </ul>
  );
}

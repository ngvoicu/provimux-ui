import { useTranslation } from 'react-i18next';
import { IconTimer } from '@/components/ui/icons';
import type { ProvimuxRecordedCooldown } from '../../api/types';
import { useSecondClock } from '../shared/clocks';
import { formatClock, formatDuration, formatExact, serverNow, timeMs } from '../time';
import styles from './ModelRoutesPage.module.scss';

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

interface CooldownNoteProps {
  cooldown: ProvimuxRecordedCooldown;
  /** Server clock minus browser clock. */
  offsetMs: number;
  /** The model the route serves; a cooldown recorded under another name (an alias) says so. */
  modelId: string;
}

/**
 * A cooldown the auth manager recorded on a route, counting down in the browser. Worded as a record, not as
 * availability: a route without one can still fail, and the router may already have moved on.
 */
export function CooldownNote({ cooldown, offsetMs, modelId }: CooldownNoteProps) {
  const { t, i18n } = useTranslation();
  const now = serverNow(useSecondClock(), offsetMs);
  const until = timeMs(cooldown.until) ?? now;
  const remaining = until - now;
  const ended = remaining <= 0;

  const reason = KNOWN_REASONS.has(cooldown.reason)
    ? t(`provimux.cooldown.reason.${cooldown.reason}`)
    : t('provimux.cooldown.reason.unknown', { code: cooldown.reason });
  const scope =
    cooldown.scope === 'credential'
      ? t('provimux.cooldown.scope_credential')
      : cooldown.scope === 'model'
        ? cooldown.model && cooldown.model !== modelId
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
  ].filter(Boolean);

  return (
    <div className={styles.cooldown} data-ended={ended || undefined}>
      <IconTimer size={14} className={styles.cooldownIcon} />
      <span className={styles.cooldownMain} title={formatExact(until, i18n.language)}>
        {t('provimux.cooldown.until', { time: formatClock(until, i18n.language, now) })}
        <span className={styles.cooldownLeft}>
          {ended
            ? t('provimux.cooldown.ended')
            : t('provimux.cooldown.left', { duration: formatDuration(remaining) })}
        </span>
      </span>
      <span className={styles.cooldownDetails}>{details.join(' · ')}</span>
    </div>
  );
}

/** What a key's settings hold, in a line ("api.example.com · proxy · 3 models"). Pure. */
import type { SettingsSummary } from './keySettings';

type T = (key: string, options?: Record<string, unknown>) => string;

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * The line shown next to "Advanced settings" while it is closed, and on the panel. Adding (`address`
 * false): only once something was set, and the address only when it is not the service's. Managing: every
 * setting there is, or "Nothing set".
 */
export function settingsStatus(
  t: T,
  summary: SettingsSummary,
  show: boolean,
  address = false
): string | null {
  if (!show) return null;
  const parts: string[] = [];
  if (address && summary.baseUrl) parts.push(hostOf(summary.baseUrl));
  if (summary.proxy) parts.push(t('provimux.accounts.settings.sum_proxy'));
  if (summary.prefix) parts.push(t('provimux.accounts.settings.sum_prefix', { prefix: summary.prefix }));
  if (summary.models) parts.push(t('provimux.accounts.settings.sum_models', { count: summary.models }));
  if (summary.excluded) {
    parts.push(t('provimux.accounts.settings.sum_excluded', { count: summary.excluded }));
  }
  if (summary.headers) parts.push(t('provimux.accounts.settings.sum_headers', { count: summary.headers }));
  if (summary.weight !== null) {
    parts.push(t('provimux.accounts.settings.sum_weight', { value: summary.weight }));
  }
  if (summary.fixed) parts.push(t('provimux.accounts.settings.sum_fixed'));
  if (parts.length) return parts.join(' · ');
  return address ? t('provimux.accounts.settings.sum_none') : t('provimux.accounts.settings.sum_changed');
}

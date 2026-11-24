import type { OpenAIProviderConfig } from '@/types';
import type { ProvimuxModel, ProvimuxModelRoute, ProvimuxRecordedCooldown } from '../../api/types';
import { timeMs } from '../time';

/** Subscription (oauth, green), API key (apikey, amber), or a kind this console does not know. */
export type Access = 'sub' | 'api' | 'other';

export const accessOf = (kind: ProvimuxModelRoute['kind']): Access =>
  kind === 'oauth' ? 'sub' : kind === 'apikey' ? 'api' : 'other';

/** Any openai-compatibility entry whose base URL is on openrouter.ai gets Provimux's OpenRouter support. */
export const isOpenRouterHost = (host: string | null | undefined): boolean => {
  const value = (host ?? '').toLowerCase();
  return value === 'openrouter.ai' || value.endsWith('.openrouter.ai');
};

export const hostOfUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url.trim()).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
};

const OPENAI_COMPATIBLE = 'openai-compatible-';

/** The OpenAI-compatible entry's name a provider id carries ("openai-compatible-lab" → "lab"), or null. */
export const compatibleEntryOf = (provider: string): string | null =>
  provider.startsWith(OPENAI_COMPATIBLE) ? provider.slice(OPENAI_COMPATIBLE.length) || null : null;

/** A recorded cooldown that has not ended at the server's `nowMs`. */
export const isCoolingAt = (
  cooldown: ProvimuxRecordedCooldown | null,
  nowMs: number
): cooldown is ProvimuxRecordedCooldown => {
  const until = timeMs(cooldown?.until);
  return until !== null && until > nowMs;
};

/** A route's credential, to count logins and keys once across models. */
const credentialKey = (route: ProvimuxModelRoute): string =>
  route.auth_index ?? `${route.provider}|${route.host ?? ''}|${route.login.label ?? ''}`;

/** Token counts the way limits are read: 1M, 200K, 8.2K; the exact number goes in a tooltip. */
export function formatTokens(value: number, language: string): string {
  const digits = value >= 10_000 ? 0 : 1;
  try {
    return new Intl.NumberFormat(language, {
      notation: 'compact',
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return String(value);
  }
}

/** Devin routes and their recorded cooldowns, for the Devin card. */
export function devinState(models: readonly ProvimuxModel[], nowMs: number) {
  const routes = models.flatMap((model) =>
    model.routes.filter((route) => route.provider === 'devin').map((route) => ({ model, route }))
  );
  const logins = new Set(routes.map(({ route }) => credentialKey(route)));
  const cooling = routes.filter(({ route }) => isCoolingAt(route.recorded_cooldown, nowMs));
  return {
    logins: logins.size,
    models: new Set(routes.map(({ model }) => model.id)).size,
    cooling,
  };
}

/**
 * Why Model routes holds no Devin route, from the credentials list: a login whose models are all excluded, or that
 * is disabled, registers none, so "no route" is not "no login" ('unknown' when the list could not be read).
 */
export function devinAbsence(
  logins: { enabled: number; disabled: number } | null
): 'no_login' | 'enabled_no_routes' | 'disabled' | 'unknown' {
  if (logins === null) return 'unknown';
  if (logins.enabled > 0) return 'enabled_no_routes';
  if (logins.disabled > 0) return 'disabled';
  return 'no_login';
}

/** OpenRouter routes by model, with the limits Provimux read from OpenRouter's model list. */
export function openRouterModels(models: readonly ProvimuxModel[]) {
  return models.flatMap((model) =>
    model.routes.filter((route) => isOpenRouterHost(route.host)).map((route) => ({ model, route }))
  );
}

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** The configured OpenAI-compatible entries Provimux treats as OpenRouter. */
export const openRouterEntries = (entries: readonly OpenAIProviderConfig[] | undefined) =>
  (entries ?? []).filter((entry) => isOpenRouterHost(hostOfUrl(entry.baseUrl)));

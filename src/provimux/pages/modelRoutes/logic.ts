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

/** The filter key of a route: "openrouter" for an OpenRouter entry, whatever its name; otherwise its provider. */
export const providerKeyOf = (route: Pick<ProvimuxModelRoute, 'provider' | 'host'>): string =>
  isOpenRouterHost(route.host) ? 'openrouter' : route.provider;

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

/** How a route names its login, as the credentials page does; a configured key by its host and label. */
export interface LoginText {
  primary: string | null;
  secondary: string | null;
}

export function loginText(route: Pick<ProvimuxModelRoute, 'kind' | 'host' | 'login'>): LoginText {
  const { name, email, label } = route.login;
  if (route.kind === 'apikey') {
    const primary = route.host ?? label ?? null;
    return { primary, secondary: route.host && label ? label : null };
  }
  const primary = email ?? label ?? name ?? null;
  return { primary, secondary: name && name !== primary ? name : null };
}

/**
 * Routes that share a priority: the router chooses among them by its strategy. Highest priority first; routes whose
 * priority the server did not report come last, in a tier of their own (never taken as 0).
 */
export interface Tier {
  priority: number | null;
  routes: ProvimuxModelRoute[];
}

const priorityRank = (priority: number | null) => (priority === null ? -Infinity : priority);

export function tiersOf(routes: readonly ProvimuxModelRoute[]): Tier[] {
  const sorted = routes
    .map((route, index) => ({ route, index }))
    .sort(
      (a, b) => priorityRank(b.route.priority) - priorityRank(a.route.priority) || a.index - b.index
    );
  const tiers: Tier[] = [];
  for (const { route } of sorted) {
    const last = tiers[tiers.length - 1];
    if (last && last.priority === route.priority) last.routes.push(route);
    else tiers.push({ priority: route.priority, routes: [route] });
  }
  return tiers;
}

export type ModelView = 'all' | 'cooldown' | 'several';

export interface ModelFilter {
  query: string;
  /** "all", a provider id, or "openrouter". */
  provider: string;
  view: ModelView;
}

const routeText = (route: ProvimuxModelRoute): string =>
  [
    route.provider,
    route.host,
    route.login.email,
    route.login.label,
    route.login.name,
    route.auth_index,
    isOpenRouterHost(route.host) ? 'openrouter' : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export function filterModels(
  models: readonly ProvimuxModel[],
  filter: ModelFilter,
  nowMs: number
): ProvimuxModel[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((model) => {
    if (
      filter.provider !== 'all' &&
      !model.routes.some((r) => providerKeyOf(r) === filter.provider)
    ) {
      return false;
    }
    if (filter.view === 'several' && model.routes.length < 2) return false;
    if (
      filter.view === 'cooldown' &&
      !model.routes.some((r) => isCoolingAt(r.recorded_cooldown, nowMs))
    ) {
      return false;
    }
    if (words.length === 0) return true;
    const text = [model.id, model.display_name, model.owned_by, ...model.routes.map(routeText)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** A route's credential, to count logins and keys once across models. */
const credentialKey = (route: ProvimuxModelRoute): string =>
  route.auth_index ?? `${route.provider}|${route.host ?? ''}|${route.login.label ?? ''}`;

export interface RoutesSummary {
  models: number;
  subscriptions: number;
  apiKeys: number;
  /** Routes with a recorded cooldown that has not ended. */
  cooldowns: number;
}

export function summarize(models: readonly ProvimuxModel[], nowMs: number): RoutesSummary {
  const subscriptions = new Set<string>();
  const apiKeys = new Set<string>();
  let cooldowns = 0;
  for (const model of models) {
    for (const route of model.routes) {
      const access = accessOf(route.kind);
      if (access === 'sub') subscriptions.add(credentialKey(route));
      if (access === 'api') apiKeys.add(credentialKey(route));
      if (isCoolingAt(route.recorded_cooldown, nowMs)) cooldowns += 1;
    }
  }
  return {
    models: models.length,
    subscriptions: subscriptions.size,
    apiKeys: apiKeys.size,
    cooldowns,
  };
}

/** The providers in the answer, with how many models each serves, for the filter. */
export function providerCounts(
  models: readonly ProvimuxModel[]
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const model of models) {
    for (const key of new Set(model.routes.map(providerKeyOf))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

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

export function formatInteger(value: number, language: string): string {
  try {
    return new Intl.NumberFormat(language).format(value);
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

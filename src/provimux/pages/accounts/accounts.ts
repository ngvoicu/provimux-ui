/**
 * The Accounts page's model (design accounts-page.md, sections 1 to 4): every subscription (a login file of
 * `GET /credentials`) and every API key (an entry of `GET /config`'s `api-keys`, as the Models page reads
 * them) as one account, with its service, who it is, whether it works now and its priority; grouped by
 * service, filtered and counted. Nothing here holds a token or a key: a key is shown masked, as AI Providers
 * shows it. Pure.
 */
import { isRuntimeOnlyAuthFile } from '@/features/authFiles/constants';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import type { AuthFileItem } from '@/types';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import type { ProvimuxModelRoutesResponse } from '../../api/types';
import { storedPriority } from '../aliases/priority';
import type { AliasState, KeyEntry } from '../aliases/types';
import { serviceOfKey, serviceOfLogin, serviceOrder, signInFlowOf } from './services';
import { keyCooldowns, keyState, loginState, type StateReading } from './state';

export type AccountKind = 'sub' | 'api';

interface AccountBase {
  /** `login:<file name>` or `key:<entry id>` (an entry id is valid for one read of the configuration). */
  id: string;
  kind: AccountKind;
  /** A catalog service id (services.ts), `login:<type>` or `compatible:<name>` for one of its own. */
  service: string;
  /** The provider id whose icon and label Auth Files shows for it. */
  provider: string;
  /** Who it is: the login's e-mail (else its project, else its file name), or the key's host. */
  who: string;
  /** A second line: a key's masked preview, or how many keys an OpenAI-compatible entry holds. */
  detail: string | null;
  reading: StateReading;
  /** The routing priority, as the proxy reads it (0 when nothing sets it). */
  priority: number;
  /** Every auth index the account's routes carry: the Models page filters by them. */
  authIndexes: string[];
}

export interface LoginAccount extends AccountBase {
  kind: 'sub';
  fileName: string;
  /** The login type, normalized (`claude`, `codex`). */
  loginType: string;
  /** The OAuth Login flow that signs it in again; null when there is none (Auth Files can replace its file). */
  signIn: string | null;
  /** A runtime-only credential: no file to remove, change or turn off here. */
  runtimeOnly: boolean;
}

export interface KeyAccount extends AccountBase {
  kind: 'api';
  entry: KeyEntry;
  /** Where its priority is stored: its own, its group's (which it inherits), or nowhere (0). */
  priorityFrom: 'key' | 'group' | 'none';
  /** An OpenAI-compatible entry's name, `null` for other families. */
  entryName: string | null;
}

export type Account = LoginAccount | KeyAccount;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The login type of a file, as Auth Files reads it. */
export const loginTypeOf = (file: AuthFileItem): string =>
  normalizeOAuthProviderKey(String(file.type ?? file.provider ?? '')) || 'unknown';

export function loginAccount(file: AuthFileItem, nowMs: number): LoginAccount {
  const loginType = loginTypeOf(file);
  const identity = deriveAuthFileIdentity(file);
  const authIndex =
    typeof file.authIndex === 'string' || typeof file.authIndex === 'number'
      ? String(file.authIndex)
      : null;
  return {
    id: `login:${file.name}`,
    kind: 'sub',
    service: serviceOfLogin(loginType) ?? `login:${loginType}`,
    provider: loginType,
    who: identity.primary || file.name,
    detail: null,
    reading: loginState(file, nowMs),
    priority: Number.isSafeInteger(file.priority) ? (file.priority as number) : 0,
    authIndexes: authIndex ? [authIndex] : [],
    fileName: file.name,
    loginType,
    signIn: signInFlowOf(loginType, text(file.oauth_provider) || null),
    runtimeOnly: isRuntimeOnlyAuthFile(file),
  };
}

/** The provider id an API key's family is shown with (Auth Files' icons and labels). */
const FAMILY_PROVIDER: Record<string, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  interactions: 'gemini',
  xai: 'xai',
  meta: 'meta',
  vertex: 'vertex',
  'openai-compatibility': 'openai-compatibility',
};

export function keyAccount(
  state: Pick<AliasState, 'document'>,
  entry: KeyEntry,
  routes: ProvimuxModelRoutesResponse | null,
  serverNowMs: number
): KeyAccount {
  const priority = storedPriority(state, entry);
  const openai = entry.family === 'openai-compatibility';
  return {
    id: `key:${entry.id}`,
    kind: 'api',
    service: serviceOfKey(entry.family, entry.host, entry.groupName),
    provider: FAMILY_PROVIDER[entry.family] ?? entry.family,
    who: entry.host ?? defaultHostOf(entry.family),
    detail: openai ? null : entry.keyPreview,
    reading: keyState(entry.disabled, keyCooldowns(routes, entry.authIndexes), serverNowMs),
    priority: priority.value,
    priorityFrom: priority.from,
    authIndexes: entry.authIndexes,
    entry,
    entryName: openai ? entry.groupName : null,
  };
}

/** The address a key of a family without a base URL goes to: the company's own API. */
export function defaultHostOf(family: string): string {
  switch (family) {
    case 'claude':
      return 'api.anthropic.com';
    case 'codex':
      return 'chatgpt.com';
    case 'gemini':
    case 'interactions':
      return 'generativelanguage.googleapis.com';
    case 'xai':
      return 'api.x.ai';
    case 'vertex':
      return 'aiplatform.googleapis.com';
    default:
      return family;
  }
}

export interface AccountsInput {
  /** The configuration as read, with its key entries (aliases' `readAliasState`). */
  config: Pick<AliasState, 'document' | 'entries'>;
  /** The login files; null when the list could not be read. */
  files: readonly AuthFileItem[] | null;
  routes: ProvimuxModelRoutesResponse | null;
  /** The browser's now, for a login's countdowns. */
  nowMs: number;
  /** The server's now, for the cooldowns the routes report. */
  serverNowMs: number;
}

export function buildAccounts(input: AccountsInput): Account[] {
  const logins = (input.files ?? []).map((file) => loginAccount(file, input.nowMs));
  const keys = input.config.entries
    .filter((entry): entry is KeyEntry => entry.store === 'api-key')
    .map((entry) => keyAccount(input.config, entry, input.routes, input.serverNowMs));
  return [...logins, ...keys];
}

/** A problem the owner has to act on: signed out, refused, or another error. Off and cooling down are not. */
export const needsAttention = (account: Account): boolean =>
  account.reading.state === 'signed-out' || account.reading.state === 'problem';

export type AccountsView = 'all' | 'sub' | 'api' | 'attention';

export interface AccountsFilter {
  query: string;
  view: AccountsView;
}

export const EMPTY_ACCOUNTS_FILTER: AccountsFilter = { query: '', view: 'all' };

export function matchesFilter(account: Account, filter: AccountsFilter, label: string): boolean {
  if (filter.view === 'sub' && account.kind !== 'sub') return false;
  if (filter.view === 'api' && account.kind !== 'api') return false;
  if (filter.view === 'attention' && !needsAttention(account)) return false;
  const query = filter.query.trim().toLowerCase();
  if (!query) return true;
  const haystack = [label, account.who, account.kind === 'api' ? (account.entryName ?? '') : '']
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export interface ServiceGroup {
  service: string;
  accounts: Account[];
}

/**
 * Accounts by service, in the catalog's order (services of their own after it, by id); within a service the
 * one tried first on top (highest priority), subscriptions before keys at equal priority, then by who.
 */
export function groupByService(accounts: readonly Account[]): ServiceGroup[] {
  const groups = new Map<string, Account[]>();
  for (const account of accounts) {
    const list = groups.get(account.service) ?? [];
    list.push(account);
    groups.set(account.service, list);
  }
  return [...groups.entries()]
    .sort(
      ([a], [b]) => serviceOrder(a) - serviceOrder(b) || a.localeCompare(b, undefined, { numeric: true })
    )
    .map(([service, list]) => ({
      service,
      accounts: [...list].sort(
        (a, b) =>
          b.priority - a.priority ||
          (a.kind === b.kind ? 0 : a.kind === 'sub' ? -1 : 1) ||
          a.who.localeCompare(b.who)
      ),
    }));
}

export interface AccountsSummary {
  total: number;
  working: number;
  signedOut: number;
  problem: number;
  cooling: number;
  off: number;
}

export function summarize(accounts: readonly Account[]): AccountsSummary {
  const count = (state: StateReading['state']) =>
    accounts.filter((account) => account.reading.state === state).length;
  return {
    total: accounts.length,
    working: count('working'),
    signedOut: count('signed-out'),
    problem: count('problem'),
    cooling: count('cooling'),
    off: count('off'),
  };
}

/** The account a link names: `?login=<file name>`, or `?account=<auth index>`. */
export function accountFromParams(
  accounts: readonly Account[],
  params: URLSearchParams
): Account | null {
  const login = params.get('login')?.trim();
  if (login) return accounts.find((a) => a.kind === 'sub' && a.fileName === login) ?? null;
  const index = params.get('account')?.trim();
  if (index) return accounts.find((a) => a.authIndexes.includes(index)) ?? null;
  return null;
}

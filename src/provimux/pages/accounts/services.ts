/**
 * The services an account belongs to (design accounts-page.md, section 2): one per company the owner knows,
 * whatever the proxy calls it. A service says how a subscription signs in (the OAuth Login page's flow, by
 * its id) and where an API key of it is stored (the AI Providers page's list, `api-keys.<family>`). Pure.
 */
import type { ProviderFamily } from '@/services/api/providers';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';

/** Where an API key of a service is written, as AI Providers writes it. */
export interface KeyTarget {
  family: ProviderFamily;
  /** The base URL the key is stored with; null: the family's own default (none written). */
  baseUrl: string | null;
  /** OpenAI-compatible: the entry's name when one is created. */
  entryName?: string;
  /** OpenAI-compatible with no fixed address: the owner types the name and the address. */
  custom?: boolean;
}

export interface Service {
  id: string;
  /** A brand name, the same in every language; `labelKey` when it is a phrase. */
  label: string;
  labelKey?: string;
  /** The provider id whose icon Auth Files shows (`getAuthFileIcon`); null: a lettered tile. */
  icon: string | null;
  /** The sign-in flows of OAuth Login that add a subscription of it (several: one per site). */
  signIn: string[];
  /** Where a pasted API key goes; null: keys of it are added on AI Providers. */
  key: KeyTarget | null;
  /** Who issues its API keys, as the owner knows them ("a key from Anthropic's console"). */
  keyIssuer?: string;
  /** Shown in the add sheet (a service that has existing accounts only is listed, not offered). */
  offered: boolean;
}

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const XAI_BASE_URL = 'https://api.x.ai/v1';

/** In the order the page groups them and the add sheet offers them. */
export const SERVICES: readonly Service[] = [
  {
    id: 'claude',
    label: 'Claude',
    icon: 'claude',
    signIn: ['anthropic'],
    key: { family: 'claude', baseUrl: null },
    keyIssuer: 'Anthropic',
    offered: true,
  },
  {
    id: 'openai',
    label: 'ChatGPT · OpenAI',
    icon: 'codex',
    signIn: ['codex'],
    key: { family: 'codex', baseUrl: OPENAI_BASE_URL },
    keyIssuer: 'OpenAI',
    offered: true,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    icon: 'gemini',
    signIn: [],
    key: { family: 'gemini', baseUrl: null },
    keyIssuer: 'Google AI Studio',
    offered: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    icon: null,
    signIn: [],
    key: {
      family: 'openai-compatibility',
      baseUrl: OPENROUTER_BASE_URL,
      entryName: 'openrouter',
    },
    keyIssuer: 'OpenRouter',
    offered: true,
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    icon: 'antigravity',
    signIn: ['antigravity'],
    key: null,
    offered: true,
  },
  { id: 'devin', label: 'Devin', icon: 'devin', signIn: ['devin'], key: null, offered: true },
  { id: 'meta', label: 'Muse (Meta)', icon: 'meta', signIn: ['meta'], key: null, offered: true },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    icon: 'copilot',
    signIn: ['copilot'],
    key: null,
    offered: true,
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    icon: 'xai',
    signIn: ['xai'],
    key: { family: 'xai', baseUrl: XAI_BASE_URL },
    keyIssuer: 'xAI',
    offered: true,
  },
  { id: 'kimi', label: 'Kimi', icon: 'kimi', signIn: ['kimi', 'kimi-ai'], key: null, offered: true },
  { id: 'vertex', label: 'Vertex AI', icon: 'vertex', signIn: [], key: null, offered: false },
  {
    id: 'compatible',
    label: 'Other service',
    labelKey: 'provimux.accounts.service_custom',
    icon: null,
    signIn: [],
    key: { family: 'openai-compatibility', baseUrl: null, custom: true },
    offered: true,
  },
];

const BY_ID = new Map(SERVICES.map((service) => [service.id, service]));

export const serviceById = (id: string): Service | undefined => BY_ID.get(id);

/** A login type (`type` of a login file, normalized) to its service; null for a type of no known service. */
const LOGIN_SERVICE: Record<string, string> = {
  claude: 'claude',
  anthropic: 'claude',
  codex: 'openai',
  gemini: 'gemini',
  'gemini-cli': 'gemini',
  aistudio: 'gemini',
  antigravity: 'antigravity',
  devin: 'devin',
  meta: 'meta',
  copilot: 'copilot',
  xai: 'xai',
  kimi: 'kimi',
  'kimi-ai': 'kimi',
  vertex: 'vertex',
};

export function serviceOfLogin(type: string): string | null {
  return LOGIN_SERVICE[normalizeOAuthProviderKey(type)] ?? null;
}

const lowerHost = (host: string | null | undefined) => (host ?? '').trim().toLowerCase();
const isHost = (host: string | null | undefined, domain: string) => {
  const value = lowerHost(host);
  return value === domain || value.endsWith(`.${domain}`);
};

/**
 * An API key's service: its family, and for an OpenAI-compatible entry its address (OpenRouter, OpenAI),
 * else the entry itself (`compatible:<name>`, labelled by its name).
 */
export function serviceOfKey(family: ProviderFamily, host: string | null, name: string | null): string {
  if (family === 'openai-compatibility') {
    if (isHost(host, 'openrouter.ai')) return 'openrouter';
    if (isHost(host, 'openai.com')) return 'openai';
    if (isHost(host, 'anthropic.com')) return 'claude';
    if (isHost(host, 'x.ai')) return 'xai';
    if (isHost(host, 'googleapis.com')) return 'gemini';
    const label = (name ?? '').trim() || lowerHost(host) || 'compatible';
    return `compatible:${label}`;
  }
  if (family === 'claude') return 'claude';
  if (family === 'codex') return 'openai';
  if (family === 'gemini' || family === 'interactions') return 'gemini';
  if (family === 'xai') return 'xai';
  if (family === 'meta') return 'meta';
  return 'vertex';
}

/** The sign-in flow that signs a login of this type in again; null when OAuth Login has none for it. */
export function signInFlowOf(type: string, recordedFlow: string | null | undefined): string | null {
  const recorded = (recordedFlow ?? '').trim();
  if (recorded) return recorded === 'claude' ? 'anthropic' : recorded;
  const service = serviceOfLogin(type);
  const flows = service ? (serviceById(service)?.signIn ?? []) : [];
  const own = normalizeOAuthProviderKey(type);
  if (flows.includes(own)) return own;
  return flows[0] ?? null;
}

/** The order the page groups services in: the catalog's, then services of their own by name. */
export function serviceOrder(id: string): number {
  const index = SERVICES.findIndex((service) => service.id === id);
  return index === -1 ? SERVICES.length : index;
}

/**
 * A subscription's settings on Accounts (design accounts-page.md, section 7), written with the call Auth
 * Files' editor makes, `PATCH /credentials/fields` with only what changed. Accounts never opens the login
 * file (it holds the tokens), so it knows what `GET /credentials` lists: priority, note, retries, WebSockets
 * and "use Sign in with ChatGPT". The others (proxy, prefix, headers, weight, exclusions, the login's own
 * model names, error rules, cooling, xAI's API mode) are kept in the file: Accounts sets them without
 * showing the value they have, and a field left alone is not written. Pure.
 */
import type { AuthFileFieldsPatch } from '@/services/api/authFiles';
import {
  buildCredentialAliases,
  buildCredentialRules,
  type CredentialAliasDraft,
} from '@/services/api/authFilePolicyAdapter';
import {
  readAuthFileWebsockets,
  supportsAuthFileSiwc,
  supportsAuthFileUsingApi,
  supportsAuthFileWebsockets,
} from '@/features/authFiles/constants';
import { buildErrorRules, validateErrorRule, type ErrorRuleDraft } from '@/features/providers/errorRules';
import type { AuthFileItem } from '@/types';
import {
  parseCredentialWeightText,
  validateCredentialWeightText,
} from '@/utils/credentialWeight';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';

/** Set without reading: undefined leaves the login's value as it is. */
export interface LoginReplacements {
  proxyUrl?: string;
  prefix?: string;
  weight?: string;
  headers?: Array<{ key: string; value: string }>;
  excludedModelsText?: string;
  modelAliases?: CredentialAliasDraft[];
  errorRules?: ErrorRuleDraft[];
  disableCooling?: boolean;
  usingApi?: boolean;
}
export type ReplaceField = keyof LoginReplacements;

export interface LoginDraft {
  note: string;
  retry: { mode: 'inherit' | 'custom'; value: string };
  /** null: not a setting of this login's service. */
  websockets: boolean | null;
  useSiwc: boolean | null;
  replace: LoginReplacements;
}

export interface LoginFacts {
  type: string;
  /** xAI logins can use the API instead of the web session. */
  usingApi: boolean;
  /** Codex logins bound to Sign in with ChatGPT. */
  siwc: boolean;
}

const retryOf = (file: AuthFileItem): number | null => {
  const raw = file.request_retry ?? file['request-retry'];
  const value = typeof raw === 'string' && raw.trim() ? Number(raw) : raw;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
};

export function loginFacts(file: AuthFileItem): LoginFacts {
  const type = normalizeOAuthProviderKey(String(file.type ?? file.provider ?? ''));
  return {
    type,
    usingApi: supportsAuthFileUsingApi(type),
    siwc: supportsAuthFileSiwc(type) && (file.siwcBound === true || file.useSiwc === true),
  };
}

export function loginDraftOf(file: AuthFileItem): LoginDraft {
  const facts = loginFacts(file);
  const retry = retryOf(file);
  return {
    note: typeof file.note === 'string' ? file.note : '',
    retry: retry === null ? { mode: 'inherit', value: '' } : { mode: 'custom', value: String(retry) },
    websockets: supportsAuthFileWebsockets(facts.type)
      ? readAuthFileWebsockets(file as Record<string, unknown>)
      : null,
    useSiwc: facts.siwc ? file.useSiwc === true : null,
    replace: {},
  };
}

export type LoginProblem =
  | 'auth_files.policy_retry_invalid'
  | 'auth_files.weight_invalid_integer'
  | 'auth_files.weight_invalid_max'
  | 'auth_files.policy_aliases_invalid'
  | 'auth_files.policy_rules_invalid';

export function loginProblem(draft: LoginDraft): LoginProblem | null {
  if (
    draft.retry.mode === 'custom' &&
    (!/^\d+$/.test(draft.retry.value.trim()) || !Number.isSafeInteger(Number(draft.retry.value)))
  ) {
    return 'auth_files.policy_retry_invalid';
  }
  const { weight, modelAliases, errorRules } = draft.replace;
  if (weight !== undefined) {
    const error = validateCredentialWeightText(weight);
    if (error) return error === 'max' ? 'auth_files.weight_invalid_max' : 'auth_files.weight_invalid_integer';
  }
  if (modelAliases?.some((row) => !row.name.trim() || !row.alias.trim())) {
    return 'auth_files.policy_aliases_invalid';
  }
  if (errorRules?.some((rule) => validateErrorRule(rule))) return 'auth_files.policy_rules_invalid';
  return null;
}

const lines = (text: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
};

/** What a save sends: only the fields that change. Throws nothing; check `loginProblem` first. */
export function loginPatch(file: AuthFileItem, draft: LoginDraft): AuthFileFieldsPatch {
  const initial = loginDraftOf(file);
  const patch: AuthFileFieldsPatch = {};
  if (draft.note.trim() !== initial.note.trim()) patch.note = draft.note.trim();
  const retry = draft.retry.mode === 'inherit' ? null : Number(draft.retry.value.trim());
  const before = initial.retry.mode === 'inherit' ? null : Number(initial.retry.value);
  if (retry !== before) patch.request_retry = retry;
  if (draft.websockets !== null && draft.websockets !== initial.websockets) {
    patch.websockets = draft.websockets;
  }
  if (draft.useSiwc !== null && draft.useSiwc !== initial.useSiwc) patch.use_siwc = draft.useSiwc;

  const r = draft.replace;
  if (r.proxyUrl !== undefined) patch.proxy_url = r.proxyUrl.trim();
  if (r.prefix !== undefined) patch.prefix = r.prefix.trim();
  if (r.weight !== undefined) patch.weight = parseCredentialWeightText(r.weight) ?? null;
  if (r.headers !== undefined) {
    const headers: Record<string, string> = {};
    for (const row of r.headers) {
      const name = row.key.trim();
      if (name) headers[name] = row.value.trim();
    }
    if (Object.keys(headers).length) patch.headers = headers;
  }
  if (r.excludedModelsText !== undefined) patch.excluded_models = lines(r.excludedModelsText);
  if (r.modelAliases !== undefined) {
    patch.model_aliases = buildCredentialAliases(
      r.modelAliases.filter((row) => row.name.trim() && row.alias.trim())
    ) as AuthFileFieldsPatch['model_aliases'];
  }
  if (r.errorRules !== undefined) {
    patch.request_scoped_errors = buildCredentialRules(
      buildErrorRules(r.errorRules),
      []
    ) as AuthFileFieldsPatch['request_scoped_errors'];
  }
  if (r.disableCooling !== undefined) patch.disable_cooling = r.disableCooling;
  if (r.usingApi !== undefined) patch.using_api = r.usingApi;
  return patch;
}

export const loginChanged = (file: AuthFileItem, draft: LoginDraft): boolean =>
  Object.keys(loginPatch(file, draft)).length > 0;

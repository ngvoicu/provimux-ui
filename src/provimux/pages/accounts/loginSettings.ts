/**
 * A subscription's settings on Accounts (design accounts-page.md, section 7.2), written with the call Auth
 * Files' editor makes, `PATCH /credentials/fields` with only what changed. Accounts never opens the login
 * file (it holds the tokens), so it shows and edits what `GET /credentials` lists: note, retries, WebSockets
 * and "use Sign in with ChatGPT" (priority has the panel's own field). The settings the file keeps (proxy,
 * prefix, headers, exclusions, weight, its own model names) are on the original page, which the settings view
 * links to. Pure.
 */
import type { AuthFileFieldsPatch } from '@/services/api/authFiles';
import {
  readAuthFileWebsockets,
  supportsAuthFileSiwc,
  supportsAuthFileWebsockets,
} from '@/features/authFiles/constants';
import type { AuthFileItem } from '@/types';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';

export interface LoginDraft {
  note: string;
  retry: { mode: 'inherit' | 'custom'; value: string };
  /** null: not a setting of this login's service. */
  websockets: boolean | null;
  /** null: the login has no Sign in with ChatGPT binding to use. */
  useSiwc: boolean | null;
}

const retryOf = (file: AuthFileItem): number | null => {
  const raw = file.request_retry ?? file['request-retry'];
  const value = typeof raw === 'string' && raw.trim() ? Number(raw) : raw;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
};

export function loginDraftOf(file: AuthFileItem): LoginDraft {
  const type = normalizeOAuthProviderKey(String(file.type ?? file.provider ?? ''));
  const retry = retryOf(file);
  const bound = supportsAuthFileSiwc(type) && (file.siwcBound === true || file.useSiwc === true);
  return {
    note: typeof file.note === 'string' ? file.note : '',
    retry: retry === null ? { mode: 'inherit', value: '' } : { mode: 'custom', value: String(retry) },
    websockets: supportsAuthFileWebsockets(type)
      ? readAuthFileWebsockets(file as Record<string, unknown>)
      : null,
    useSiwc: bound ? file.useSiwc === true : null,
  };
}

export type LoginProblem = 'auth_files.policy_retry_invalid';

export function loginProblem(draft: LoginDraft): LoginProblem | null {
  const value = draft.retry.value.trim();
  if (draft.retry.mode === 'custom' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
    return 'auth_files.policy_retry_invalid';
  }
  return null;
}

/** What a save sends: only the fields that change. Check `loginProblem` first. */
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
  return patch;
}

export const loginChanged = (file: AuthFileItem, draft: LoginDraft): boolean =>
  Object.keys(loginPatch(file, draft)).length > 0;

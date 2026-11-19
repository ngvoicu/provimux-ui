import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { readAuthFilesUiState, writeAuthFilesUiState } from '@/features/authFiles/uiState';

/**
 * A route's login, opened on Auth Files by its exact auth_index (05-console-contract.md: "a link to the credentials
 * page by auth_index"). Auth Files' own search matches substrings (review-cl.json also finds backup-review-cl.json),
 * so the link sets the search to the login's file name, for the operator to see, and a target: while that search is
 * unchanged, Auth Files' filter (one seam, `provimuxAuthTarget`) keeps only the credential with that auth_index.
 * Editing the search, or opening another target, ends it.
 */

interface AuthTarget {
  authIndex: string;
  search: string;
}

let target: AuthTarget | null = null;

export function setAuthFilesTarget(next: AuthTarget | null) {
  target = next;
}

/** Auth Files' filter seam: true for every credential, unless a link targets one and its search is still on. */
export function provimuxAuthTarget(
  item: { authIndex?: string | number | null },
  search: string
): boolean {
  if (target === null || search !== target.search) return true;
  return String(item.authIndex ?? '').trim() === target.authIndex;
}

export function openAuthFilesState(name: string) {
  const current = readAuthFilesUiState() ?? {};
  return { ...current, search: name, filter: 'all', statusFilterMode: 'all' as const, page: 1 };
}

export function useOpenInAuthFiles() {
  const navigate = useNavigate();
  return useCallback(
    (login: { name: string; authIndex: string }) => {
      setAuthFilesTarget({ authIndex: login.authIndex, search: login.name });
      writeAuthFilesUiState(openAuthFilesState(login.name));
      navigate('/auth-files');
    },
    [navigate]
  );
}

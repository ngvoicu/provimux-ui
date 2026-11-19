import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { readAuthFilesUiState, writeAuthFilesUiState } from '@/features/authFiles/uiState';

/**
 * Opens Auth Files on one login: its search set to the login's file name, every provider and state shown, first page.
 * Auth Files reads this state when it opens (upstream's own persisted filters), so no seam is needed.
 */
export function openAuthFilesState(name: string) {
  const current = readAuthFilesUiState() ?? {};
  return { ...current, search: name, filter: 'all', statusFilterMode: 'all' as const, page: 1 };
}

export function useOpenInAuthFiles() {
  const navigate = useNavigate();
  return useCallback(
    (name: string) => {
      writeAuthFilesUiState(openAuthFilesState(name));
      navigate('/auth-files');
    },
    [navigate]
  );
}

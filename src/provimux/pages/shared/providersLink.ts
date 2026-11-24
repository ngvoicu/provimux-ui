import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getProviderFilterState,
  readProvidersWorkbenchUiState,
  writeProvidersWorkbenchUiState,
  type ProvidersWorkbenchUiState,
} from '@/features/providers/uiState';
import type { ProviderBrand } from '@/features/providers/types';
import type { ProviderFamily } from '@/services/api/providers';

/**
 * Opens AI Providers on one key's family, its search set to the key's connection. AI Providers reads this
 * state when it opens (upstream's own persisted tab and filters), so no seam is needed.
 */
export function openProvidersState(
  current: ProvidersWorkbenchUiState,
  family: ProviderFamily,
  search: string
): ProvidersWorkbenchUiState {
  const brand = (family === 'openai-compatibility' ? 'openaiCompatibility' : family) as ProviderBrand;
  return {
    ...current,
    activeBrand: brand,
    filtersByBrand: {
      ...current.filtersByBrand,
      [brand]: { ...getProviderFilterState(current, brand), filter: search },
    },
  };
}

export function useOpenInProviders() {
  const navigate = useNavigate();
  return useCallback(
    (family: ProviderFamily, search: string) => {
      writeProvidersWorkbenchUiState(
        openProvidersState(readProvidersWorkbenchUiState(), family, search)
      );
      navigate('/ai-providers');
    },
    [navigate]
  );
}

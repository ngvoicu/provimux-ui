import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/services/api/client';
import { useAuthStore, useConfigStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { provimuxApi } from '../../api/provimuxApi';

export interface DevinLogins {
  enabled: number;
  disabled: number;
}

export interface DevinCooling {
  /** undefined: not read yet; null: not set in the config (off, the default). */
  value: boolean | null | undefined;
  readError: string | null;
  /** The Devin logins the credentials list holds; null when not known (not read, or the read failed). */
  logins: DevinLogins | null;
  saving: boolean;
  /** Reads the switch and the Devin logins again: on open and with every manual refresh of Model routes. */
  read: () => Promise<void>;
  /** Writes the switch; resolves false when the server refused it (the value is read again). */
  set: (next: boolean) => Promise<{ ok: true } | { ok: false; error: unknown }>;
}

/**
 * The Devin quota pause per model (oauth.providers.devin.model-level-cooling) as Model routes shows it. The page owns
 * it so that its Refresh reads the switch together with the routes: another client may have changed it.
 */
export function useDevinCooling(): DevinCooling {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [value, setValue] = useState<boolean | null | undefined>(undefined);
  const [readError, setReadError] = useState<string | null>(null);
  const [logins, setLogins] = useState<DevinLogins | null>(null);
  const [saving, setSaving] = useState(false);
  const requestRef = useRef(0);

  const read = useCallback(async () => {
    const requestId = ++requestRef.current;
    const client = apiClient.captureConnection(() => requestId === requestRef.current);
    const [switchResult, loginsResult] = await Promise.allSettled([
      provimuxApi.devinModelLevelCooling(client),
      provimuxApi.devinLogins(client),
    ]);
    if (requestId !== requestRef.current) return;
    if (switchResult.status === 'fulfilled') {
      setValue(switchResult.value);
      setReadError(null);
    } else {
      setReadError(getErrorMessage(switchResult.reason));
    }
    setLogins(loginsResult.status === 'fulfilled' ? loginsResult.value : null);
  }, []);

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    void read();
    return () => {
      requestRef.current += 1;
    };
  }, [connectionStatus, read]);

  const set = useCallback(
    async (next: boolean): Promise<{ ok: true } | { ok: false; error: unknown }> => {
      setSaving(true);
      try {
        await provimuxApi.setDevinModelLevelCooling(next);
        requestRef.current += 1; // an older read must not undo the value just written
        setValue(next);
        setReadError(null);
        useConfigStore.getState().clearCache();
        return { ok: true };
      } catch (error) {
        void read();
        return { ok: false, error };
      } finally {
        setSaving(false);
      }
    },
    [read]
  );

  return { value, readError, logins, saving, read, set };
}

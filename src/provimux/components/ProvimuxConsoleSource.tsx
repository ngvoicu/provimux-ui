import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { provimuxApi } from '../api/provimuxApi';
import {
  describeConsoleBuild,
  describeConsoleSource,
  githubUrl,
  type ConsoleSource,
} from '../consoleSource';
import { isProvimuxServer, useProvimuxPresence } from '../presence';
import { describeServerVersion } from '../version';

const consoleVersion = (): string =>
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev';

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; repository: string | null; autoUpdateOff: boolean | null }
  | { state: 'error'; message: string };

/**
 * On the System page, under the server's version: this console's release and where the server downloads it from
 * (management.panel-github-repository, read the way the config pages read it), and whether it updates itself.
 */
export function ProvimuxConsoleSource({ serverVersion }: { serverVersion?: string | null }) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const provimuxEndpoints = useProvimuxPresence(isProvimuxServer);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    let current = true;
    const client = apiClient.captureConnection(() => current);
    provimuxApi
      .consoleSource(client)
      .then((value) => current && setLoaded({ state: 'ready', ...value }))
      .catch(
        (error: unknown) =>
          current && setLoaded({ state: 'error', message: getErrorMessage(error) })
      );
    return () => {
      current = false;
    };
  }, [connectionStatus]);

  const build = describeConsoleBuild(consoleVersion());
  const server =
    describeServerVersion(serverVersion)?.kind === 'provimux' || provimuxEndpoints
      ? 'provimux'
      : 'cliproxyapi';
  const source: ConsoleSource | null =
    loaded.state === 'ready' ? describeConsoleSource(loaded.repository, server) : null;

  return (
    <div className="pmx-about-console">
      <p className="pmx-about-version">
        {build.kind === 'release'
          ? t('provimux.console.release', { version: build.version, base: build.base })
          : t('provimux.console.dev', { version: build.version })}
      </p>
      {source && loaded.state === 'ready' ? (
        <p className="pmx-about-source">
          <span>
            {t('provimux.console.from')}{' '}
            <a href={githubUrl(source.repository)} target="_blank" rel="noopener noreferrer">
              github.com/{source.repository}
            </a>
            {' · '}
            {source.reason === 'default'
              ? server === 'provimux'
                ? t('provimux.console.reason_default_provimux')
                : t('provimux.console.reason_default_cliproxyapi')
              : t(`provimux.console.reason_${source.reason}`)}
          </span>
          <span>
            {loaded.autoUpdateOff ? t('provimux.console.auto_off') : t('provimux.console.auto_on')}
          </span>
        </p>
      ) : loaded.state === 'error' ? (
        <p className="pmx-about-source">
          {t('provimux.console.source_failed', { message: loaded.message })}
        </p>
      ) : null}
    </div>
  );
}

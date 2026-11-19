import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { provimuxApi } from '../api/provimuxApi';
import {
  describeConsoleBuild,
  describeUpdateSource,
  githubUrl,
  type UpdateSource,
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
 * On the System page, under the server's version: this console's release, and the update source: where the server's
 * updater fetches new console releases (management.panel-github-repository, resolved with the updater's own rules),
 * and whether it updates at all. Not "downloaded from": the page may be served from a local file.
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
  const source: UpdateSource | null =
    loaded.state === 'ready' ? describeUpdateSource(loaded.repository, server) : null;
  const reason =
    source === null
      ? ''
      : source.reason === 'default'
        ? server === 'provimux'
          ? t('provimux.console.reason_default_provimux')
          : t('provimux.console.reason_default_cliproxyapi')
        : t(`provimux.console.reason_${source.reason}`);

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
            {t('provimux.console.update_source')}{' '}
            {source.repository ? (
              <a href={githubUrl(source.repository)} target="_blank" rel="noopener noreferrer">
                github.com/{source.repository}
              </a>
            ) : (
              <code className="pmx-about-source-url">{source.releaseUrl}</code>
            )}
            {' · '}
            {reason}
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

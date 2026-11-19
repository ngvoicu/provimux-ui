import { useTranslation } from 'react-i18next';
import { describeServerVersion } from '../version';
import { ProvimuxConsoleSource } from './ProvimuxConsoleSource';
import { ProvimuxTagline } from './ProvimuxTagline';

interface ProvimuxAboutProps {
  /** The server's version as it sent it (`X-CPA-Version`). */
  serverVersion?: string | null;
}

/**
 * Under the System page's title: the signature, what the console is connected to, and what Provimux is built on.
 * "Provimux version 8.0.78-pmx.1 (based on CLIProxyAPI 8.0.78)"; another CLIProxyAPI build reads as itself. Then this
 * console's release and where the server downloads it from (PUI-15).
 */
export function ProvimuxAbout({ serverVersion }: ProvimuxAboutProps) {
  const { t } = useTranslation();
  const server = describeServerVersion(serverVersion);
  return (
    <div className="pmx-about">
      <ProvimuxTagline className="pmx-about-tagline" link />
      {server ? (
        <p className="pmx-about-version">
          {server.kind === 'provimux'
            ? t('provimux.version_line', { version: server.version, base: server.base })
            : t('provimux.version_line_other', { version: server.version })}
        </p>
      ) : null}
      <ProvimuxConsoleSource serverVersion={serverVersion} />
      <p className="pmx-about-built-on">{t('provimux.built_on')}</p>
    </div>
  );
}

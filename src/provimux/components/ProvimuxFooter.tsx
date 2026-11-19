import { useTranslation } from 'react-i18next';
import { PROVIMUX_BRAND, PROVIMUX_LINKS, PROVIMUX_TILE } from '../brand';
import { ProvimuxTagline } from './ProvimuxTagline';

const consoleVersion = (): string =>
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev';

/** The console's footer: the signature, the console's own version, and what it is built on. */
export function ProvimuxFooter() {
  const { t } = useTranslation();
  return (
    <footer className="pmx-footer">
      <span className="pmx-footer-sign">
        <a
          className="pmx-footer-brand"
          href={PROVIMUX_LINKS.provimux}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src={PROVIMUX_TILE} alt="" width={16} height={16} />
          {PROVIMUX_BRAND.name}
        </a>{' '}
        <ProvimuxTagline link />
      </span>
      <span className="pmx-footer-meta">
        <a href={PROVIMUX_LINKS.console} target="_blank" rel="noopener noreferrer">
          {t('provimux.footer_console', { version: consoleVersion() })}
        </a>
        <span aria-hidden="true">·</span>
        <a href={PROVIMUX_LINKS.cliProxyApi} target="_blank" rel="noopener noreferrer">
          {t('provimux.footer_built_on')}
        </a>
      </span>
    </footer>
  );
}

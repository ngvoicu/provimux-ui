import { useTranslation } from 'react-i18next';
import { IconExternalLink } from '@/components/ui/icons';
import { PROVIMUX_LINKS } from '../brand';
import { ProvidersDevMark } from './ProvidersDevMark';
import { ProvimuxTileIcon } from './ProvimuxTileIcon';

interface ProvimuxLinksProps {
  /** The System page's own CSS module, so these cards are drawn exactly like its other links. */
  styles: Record<string, string>;
}

/** Provimux and providers.dev, first among the System page's links (upstream's follow as "Built on"). */
export function ProvimuxLinks({ styles }: ProvimuxLinksProps) {
  const { t } = useTranslation();
  const links = [
    {
      href: PROVIMUX_LINKS.provimux,
      label: t('provimux.link_provimux'),
      icon: (
        <div className={`${styles.linkIcon} pmx-link-tile`}>
          <ProvimuxTileIcon size={36} />
        </div>
      ),
    },
    {
      href: PROVIMUX_LINKS.providersDev,
      label: t('provimux.link_providers_dev'),
      icon: (
        <div className={`${styles.linkIcon} pmx-link-pdev`}>
          <ProvidersDevMark size={20} />
        </div>
      ),
    },
  ];
  return (
    <>
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.linkCard}
        >
          {link.icon}
          <div className={styles.linkContent}>
            <div className={styles.linkTitle}>
              {link.label}
              <IconExternalLink size={14} />
            </div>
          </div>
        </a>
      ))}
    </>
  );
}

import { useTranslation } from 'react-i18next';
import { IconPlug } from '@/components/ui/icons';
import { getAuthFileIcon } from '@/features/authFiles/constants';
import { useThemeStore } from '@/stores';
import { serviceLabel } from './labels';
import { serviceById } from './services';
import styles from './AccountsPage.module.scss';

/**
 * A service's mark: the icon Auth Files shows for its provider, else its first letter on a tile (OpenRouter,
 * a service of the owner's own). Decorative: the service's name is always written next to it.
 */
export function ServiceIcon({
  service,
  provider,
  size = 'md',
}: {
  service: string;
  provider?: string;
  size?: 'md' | 'lg';
}) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const iconOf = serviceById(service)?.icon ?? null;
  const source =
    (iconOf && getAuthFileIcon(iconOf, resolvedTheme)) ||
    (provider ? getAuthFileIcon(provider, resolvedTheme) : null);
  const letter = serviceLabel(t, service).trim().charAt(0).toUpperCase() || '?';
  // The catalog's "other service" is any OpenAI-compatible address: a plug, not a letter of its own.
  const generic = service === 'compatible';
  return (
    <span className={styles.serviceIcon} data-size={size} aria-hidden="true">
      {source ? (
        <img src={source} alt="" />
      ) : generic ? (
        <IconPlug size={14} className={styles.serviceGlyph} />
      ) : (
        <span className={styles.serviceLetter}>{letter}</span>
      )}
    </span>
  );
}

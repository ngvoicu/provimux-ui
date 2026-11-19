import { useTranslation } from 'react-i18next';
import { getAuthFileIcon, getTypeColor, getTypeLabel } from '@/features/authFiles/constants';
import { useThemeStore } from '@/stores';
import { compatibleEntryOf, isOpenRouterHost } from '../modelRoutes/logic';
import styles from './Shared.module.scss';

interface ProviderPillProps {
  provider: string;
  /** An API key's host: an OpenAI-compatible entry on openrouter.ai reads "OpenRouter". */
  host?: string | null;
}

/** The provider as Auth Files shows it (its colours and icon); an OpenAI-compatible entry by its name. */
export function ProviderPill({ provider, host }: ProviderPillProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const entry = compatibleEntryOf(provider);

  if (isOpenRouterHost(host) || entry !== null) {
    const label = isOpenRouterHost(host) ? 'OpenRouter' : entry;
    return (
      <span className={`${styles.pill} ${styles.pillCompatible}`} title={provider}>
        {label}
      </span>
    );
  }

  const colors = getTypeColor(provider, resolvedTheme);
  const icon = getAuthFileIcon(provider, resolvedTheme);
  return (
    <span
      className={styles.pill}
      style={{ backgroundColor: colors.bg, color: colors.text, borderColor: colors.border }}
      title={provider}
    >
      {icon ? <img src={icon} alt="" className={styles.pillIcon} /> : null}
      {getTypeLabel(t, provider)}
    </span>
  );
}

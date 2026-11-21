/** The provider logos and service pills of the Aliases page. */
import { useTranslation } from 'react-i18next';
import { getAuthFileIcon } from '@/features/authFiles/constants';
import { PROVIDER_LOGOS } from '@/features/providers/brandLogos';
import type { ProviderBrand } from '@/features/providers/types';
import type { ProviderFamily } from '@/services/api/providers';
import { useThemeStore } from '@/stores';
import { serviceLabel } from './labels';
import { brandOfFamily } from './pageLogic';
import type { AliasEntry, ServiceId } from './types';
import styles from './AliasesPage.module.scss';

/** The logo of a provider family or login type, as AI Providers and Auth Files draw it. */
export function ProviderLogo({ family, channel }: { family?: ProviderFamily; channel?: string }) {
  const theme = useThemeStore((state) => state.resolvedTheme);
  let src: string | null = null;
  if (family) {
    const logo = PROVIDER_LOGOS[brandOfFamily(family) as ProviderBrand];
    src = logo ? (theme === 'dark' && logo.darkSrc ? logo.darkSrc : logo.src) : null;
  } else if (channel) {
    src = getAuthFileIcon(channel, theme);
  }
  return (
    <span className={styles.logo} aria-hidden="true">
      {src ? <img src={src} alt="" /> : null}
    </span>
  );
}

/** A service, as a small pill; one the proxy serves without a row here is drawn dashed. */
export function ServicePill({
  service,
  entries,
  native = false,
}: {
  service: ServiceId;
  entries: readonly AliasEntry[];
  native?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={styles.service}
      data-native={native || undefined}
      title={native ? t('provimux.aliases.native_service_hint') : undefined}
    >
      {serviceLabel(t, service, entries)}
      {native ? (
        <span className={styles.serviceNative}>{t('provimux.aliases.native_service')}</span>
      ) : null}
    </span>
  );
}

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { hostOfUrl, isOpenRouterHost } from '../pages/modelRoutes/logic';
import { isListed, useProvimuxPresence } from '../presence';
import styles from '../pages/shared/Shared.module.scss';

/**
 * On AI Providers, beside an OpenAI-compatible entry whose base URL is on openrouter.ai: Provimux gives it its
 * OpenRouter support (cache markers, a session header, OpenRouter's own limits and levels). Links to the entry's
 * names on Models. Hidden when Model routes answered 404 (stock, or a server with only the live-lists
 * endpoint: the link would land on the dashboard), and until its presence is known. A temporary error keeps it, as
 * the sidebar keeps Model routes: the page shows the error with Retry.
 */
export function ProvimuxOpenRouterTag({ baseUrl }: { baseUrl?: string | null }) {
  const { t } = useTranslation();
  const modelRoutes = useProvimuxPresence((state) => state.modelRoutes);
  if (!isListed(modelRoutes) || !isOpenRouterHost(hostOfUrl(baseUrl))) return null;
  return (
    <Link
      to="/provimux/models?provider=openrouter"
      className={styles.openRouterTag}
      title={t('provimux.openrouter.tag_title')}
    >
      {t('provimux.openrouter.tag')}
    </Link>
  );
}

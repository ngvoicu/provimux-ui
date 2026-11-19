import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { hostOfUrl, isOpenRouterHost } from '../pages/modelRoutes/logic';
import { useProvimuxPresence } from '../presence';
import styles from '../pages/shared/Shared.module.scss';

/**
 * On AI Providers, beside an OpenAI-compatible entry whose base URL is on openrouter.ai: Provimux gives it its
 * OpenRouter support (cache markers, a session header, OpenRouter's own limits and levels). Links to the entry's
 * models on Model routes. Only while Model routes is there: on a server without it (stock, or one that has only the
 * live-lists endpoint) the link would land on the dashboard.
 */
export function ProvimuxOpenRouterTag({ baseUrl }: { baseUrl?: string | null }) {
  const { t } = useTranslation();
  const modelRoutes = useProvimuxPresence((state) => state.modelRoutes.status);
  if (modelRoutes !== 'ready' || !isOpenRouterHost(hostOfUrl(baseUrl))) return null;
  return (
    <Link
      to="/provimux/model-routes?provider=openrouter"
      className={styles.openRouterTag}
      title={t('provimux.openrouter.tag_title')}
    >
      {t('provimux.openrouter.tag')}
    </Link>
  );
}

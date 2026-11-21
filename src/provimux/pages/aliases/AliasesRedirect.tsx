import { Navigate, useLocation } from 'react-router-dom';
import { aliasesAddressFor } from './pageLogic';

/**
 * The old login alias address (design aliases-page.md 5.3, step U2): `/auth-files/oauth-model-alias` leads
 * to the Aliases page on its logins, and `?provider=<p>` to that login type, replacing the history entry.
 * The Auth Files tile, the exclusions page's switch and old links all arrive here.
 */
export function AliasesRedirect() {
  const { search } = useLocation();
  return <Navigate to={aliasesAddressFor(search)} replace />;
}

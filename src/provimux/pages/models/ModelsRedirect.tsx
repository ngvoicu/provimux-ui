import { Navigate, useLocation } from 'react-router-dom';
import { modelsAddressFor } from './address';

/** An old page's address: the Models page, replacing the history entry. */
export function ModelsRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={modelsAddressFor(pathname, search)} replace />;
}

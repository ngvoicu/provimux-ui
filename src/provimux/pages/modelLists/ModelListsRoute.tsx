import type { ReactNode } from 'react';
import { ProvimuxPageGate } from '../../components/ProvimuxPageGate';
import { useProvimuxPresence } from '../../presence';
import { modelListsPageFor } from './logic';
import { ModelListsPage } from './ModelListsPage';

/**
 * The Live lists route on servers of every age (model-lists.md 5.5, 05-console-contract.md section 4): Model lists
 * while GET /provimux/model-lists answers or is not known yet; once it answers 404 (a Provimux older than it) the
 * live-lists page, gated by its own endpoint as before. The model-lists page's own load reports a 404, so a server
 * without it switches to the older page on its first answer.
 */
export function ModelListsRoute({ fallback }: { fallback: ReactNode }) {
  const status = useProvimuxPresence((state) => state.modelLists.status);
  if (modelListsPageFor(status) === 'live-lists') {
    return <ProvimuxPageGate endpoint="liveLists">{fallback}</ProvimuxPageGate>;
  }
  return <ModelListsPage />;
}

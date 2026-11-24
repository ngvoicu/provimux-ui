/**
 * The Accounts page's requests (design accounts-page.md, section 5). It reads what Auth Files and the
 * Models page read, and writes only with the calls the original pages make for the same change:
 *
 * - a login: `PATCH /credentials/status` (on, off), `PATCH /credentials/fields` with `priority` (the call the
 *   Auth Files editor makes for that field), `DELETE /credentials` (remove), `POST /routing/cooldown/reset`
 *   (try now); a login file is never downloaded, so no token reaches the page;
 * - an API key: `PUT /config/api-keys/<family>`, the family's list as read with one key changed, with
 *   `If-Match` set to the read's tag, as the Models page writes it; a list changed since is refused (412)
 *   and nothing is written.
 */
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import type { ProviderFamily } from '@/services/api/providers';
import type { AuthFileItem } from '@/types';
import { isRecord } from '@/utils/helpers';
import { ALIAS_PATHS, etagOf, putWithTag } from '../aliases/aliasesApi';
import { readAliasState } from '../aliases/rows';
import type { AliasState } from '../aliases/types';

type Client = Pick<typeof apiClient, 'get' | 'getRaw'>;

export interface AccountsRead {
  config: AliasState;
  /** The login files; null when the list could not be read (the keys are still shown). */
  files: AuthFileItem[] | null;
  /** When the login list was received (a login's countdowns run from it). */
  receivedAtMs: number;
}

export class AccountsWriteError extends Error {
  constructor(
    readonly reason: 'changed' | 'no-tag' | 'refused' | 'error',
    message: string
  ) {
    super(message);
    this.name = 'AccountsWriteError';
  }
}

const statusOf = (error: unknown): number | null =>
  isRecord(error) && typeof error.status === 'number' ? error.status : null;

export const accountsApi = {
  async load(client: Client = apiClient): Promise<AccountsRead> {
    const [read, files] = await Promise.all([
      client.getRaw(ALIAS_PATHS.config),
      authFilesApi.list().catch(() => null),
    ]);
    return {
      config: { ...readAliasState(read.data, files?.files ?? null), etag: etagOf(read.headers) },
      files: files?.files ?? null,
      receivedAtMs: Date.now(),
    };
  },

  /** A family's list written back, conditional on the read's tag. */
  async writeFamily(family: ProviderFamily, groups: unknown[], tag: string | null): Promise<void> {
    if (!tag) throw new AccountsWriteError('no-tag', 'no-tag');
    try {
      await putWithTag(ALIAS_PATHS.family(family), groups, tag);
    } catch (error) {
      const status = statusOf(error);
      const message = error instanceof Error ? error.message : String(error);
      if (status === 412) throw new AccountsWriteError('changed', message);
      if (status === 400 || status === 422) throw new AccountsWriteError('refused', message);
      throw new AccountsWriteError('error', message);
    }
  },

  setLoginOn: (file: Pick<AuthFileItem, 'name' | 'authIndex'>, on: boolean) =>
    authFilesApi.setStatus(
      file.name,
      !on,
      typeof file.authIndex === 'string' ? file.authIndex : undefined
    ),

  /** As the Auth Files editor writes it: 0 clears the field. */
  setLoginPriority: (name: string, priority: number) =>
    authFilesApi.patchFields(name, { priority }),

  removeLogin: async (name: string) => {
    const result = await authFilesApi.deleteFiles([name]);
    if (result.failed.length) throw new Error(result.failed[0].error);
  },

  tryLoginNow: (authIndex: string) => authFilesApi.resetCooldown(authIndex),
};

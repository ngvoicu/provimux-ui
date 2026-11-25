/**
 * "Serve only my names"' one request (models-page.md 8.5): `PUT /config/models/only-my-names` with the whole
 * object, built from the page's read and conditional on its tag (`If-Match`), as the page writes an exclusion. A
 * file changed since the read is refused (412) and nothing is written; a read without a tag, or with a setting the
 * page cannot read whole, writes nothing. The page reads again after every write, whatever its answer.
 */
import { isRecord } from '@/utils/helpers';
import { apiClient } from '@/services/api/client';
import { etagOf, putWithTag } from '../aliases/aliasesApi';
import type { AliasState } from '../aliases/types';
import { ONLY_MY_NAMES_PATH, readSetting } from './namesSetting';

export class NamesRequestError extends Error {
  constructor(
    readonly reason: 'changed' | 'no-tag' | 'unreadable' | 'refused' | 'error',
    message: string
  ) {
    super(message);
    this.name = 'NamesRequestError';
  }
}

const statusOf = (error: unknown): number | null =>
  isRecord(error) && typeof error.status === 'number' ? error.status : null;

export const onlyMyNamesApi = {
  /** The configuration's tag now (its `ETag`), without touching the page's read; null when not given. */
  async configTag(): Promise<string | null> {
    const read = await apiClient.getRaw('/config');
    return etagOf(read.headers);
  },

  /** The setting written whole, with `If-Match` set to the read's tag. Resolves with the tag answered. */
  async write(read: Pick<AliasState, 'document' | 'etag'>, body: Record<string, unknown>) {
    if (!read.etag) throw new NamesRequestError('no-tag', 'no-tag');
    if (readSetting(read.document).unreadable)
      throw new NamesRequestError('unreadable', 'unreadable');
    try {
      return await putWithTag(ONLY_MY_NAMES_PATH, body, read.etag);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      const status = statusOf(error);
      const message = error instanceof Error ? error.message : String(error);
      if (status === 412) throw new NamesRequestError('changed', message);
      if (status === 400 || status === 422) throw new NamesRequestError('refused', message);
      throw new NamesRequestError('error', message);
    }
  },
};

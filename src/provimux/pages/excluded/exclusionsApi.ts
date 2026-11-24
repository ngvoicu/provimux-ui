/**
 * The excluded models' one request (design models-page.md, section 6): a change is one `PUT`, built from the
 * page's read and conditional on its tag (`If-Match`), as Models and Accounts write. A file changed since the
 * read is refused (412) and nothing is written; a read without a tag writes nothing. The page reads again
 * after every write, whatever its answer. No login file is ever read.
 */
import { authFilesApi } from '@/services/api/authFiles';
import { isRecord } from '@/utils/helpers';
import { putWithTag } from '../aliases/aliasesApi';
import type { AliasState } from '../aliases/types';
import { planExclusion, type ExclusionChange } from './writes';

export class ExclusionRequestError extends Error {
  constructor(
    readonly reason: 'changed' | 'no-tag' | 'refused' | 'error',
    message: string
  ) {
    super(message);
    this.name = 'ExclusionRequestError';
  }
}

const statusOf = (error: unknown): number | null =>
  isRecord(error) && typeof error.status === 'number' ? error.status : null;

export const exclusionsApi = {
  /**
   * One exclusion added or taken out: the request of `planExclusion`, with `If-Match` set to the read's
   * tag. Resolves with the tag the proxy answered (null when it sent none).
   */
  async write(read: Pick<AliasState, 'document' | 'etag'>, change: ExclusionChange) {
    if (!read.etag) throw new ExclusionRequestError('no-tag', 'no-tag');
    const { path, body } = planExclusion(read.document, change);
    try {
      return await putWithTag(path, body, read.etag);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      const status = statusOf(error);
      const message = error instanceof Error ? error.message : String(error);
      if (status === 412) throw new ExclusionRequestError('changed', message);
      if (status === 400 || status === 422) throw new ExclusionRequestError('refused', message);
      throw new ExclusionRequestError('error', message);
    }
  },

  /** A login type's or a family's built-in model names, offered when adding (free text stays allowed). */
  async modelNames(channel: string): Promise<string[]> {
    const models = await authFilesApi.getModelDefinitions(channel);
    return models
      .map((model) => model.id)
      .filter((id) => typeof id === 'string' && id.trim() !== '');
  },
};

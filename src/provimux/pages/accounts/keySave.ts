/**
 * A key's settings saved (design accounts-page.md 7, key-model-lists.md 6): AI Providers' own save of its form
 * (its connection form, its OpenAI entry form), when the form changed or the key is new, then its list settings,
 * which that save leaves as they are, by one write of their own (accountsApi.writeListSettings: a fresh read,
 * `PUT /config/api-keys/<family>` with `If-Match`). The list settings are shown only by a server that has them
 * (`listsShown`), so elsewhere they never change and nothing more is written.
 */
import { providersApi } from '@/services/api/providers';
import { isRecord } from '@/utils/helpers';
import { familyGroups } from '../aliases/rows';
import { accountsApi, ListSettingsWriteError } from './accountsApi';
import type { ListTarget } from './keyListSettings';
import {
  compatibleConfig,
  formChanged,
  listsChanged,
  nativeSave,
  storedListTarget,
  type KeyDraft,
} from './keySettings';
import { KeyWriteError } from './keyWrites';

/** The form, saved with AI Providers' own calls. Resolves with where the key now is, for its list settings. */
export async function saveKeyForm(draft: KeyDraft, document: unknown): Promise<ListTarget | null> {
  if (draft.kind === 'native') {
    const { source, settings, members } = nativeSave(draft);
    const saved = await providersApi.saveNativeConnection(draft.family, source, settings, members);
    return {
      family: draft.family,
      groupIndex: saved.groupIndex,
      // Every key keeps its position; a new key is its connection's first.
      keyIndex: storedListTarget(draft)?.keyIndex ?? 0,
      name: String(saved.group.name ?? ''),
    };
  }
  const config = compatibleConfig(draft);
  if (draft.resource) {
    await providersApi.updateOpenAIProvider(config.name, draft.resource.originalIndex, config);
    const stored = storedListTarget(draft);
    return stored ? { ...stored, name: config.name } : null;
  }
  const taken = familyGroups(document, 'openai-compatibility').some(
    (group) => isRecord(group) && String(group.name ?? '').trim() === config.name
  );
  if (taken) throw new KeyWriteError('duplicate-name');
  await providersApi.createOpenAIProvider(config);
  return { family: 'openai-compatibility', groupIndex: null, keyIndex: null, name: config.name };
}

/**
 * The whole save. A list write that fails after the form's save landed rejects with ListSettingsWriteError, so
 * the owner is told which part was saved.
 */
export async function saveKeySettingsDraft(
  draft: KeyDraft,
  options: { document: unknown; listsShown: boolean }
): Promise<void> {
  const stored = storedListTarget(draft);
  const formRuns = stored === null || formChanged(draft);
  const target = formRuns ? await saveKeyForm(draft, options.document) : stored;
  if (!listsChanged(draft) || !options.listsShown) return;
  try {
    if (!target) throw new KeyWriteError('not-found');
    await accountsApi.writeListSettings(target, draft.lists);
  } catch (error) {
    throw formRuns ? new ListSettingsWriteError(error) : error;
  }
}

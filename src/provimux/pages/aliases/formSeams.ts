/**
 * The provider forms' side of the Aliases page (design aliases-page.md 5.1, 6.2). Pure functions for the
 * seams in upstream's `ModelEntriesEditor`; no upstream file calls them yet (step U3 does).
 */
import type { ModelEntryInput } from '@/features/providers/types';

type AliasField = Pick<ModelEntryInput, 'name' | 'alias'>;

/**
 * The `type` of the editor's alias input: hidden in a provider's model list (aliases are given on the
 * Aliases page), text for a login's own aliases (`oauthAliasOnly`), which stay in the login's editor.
 */
export function aliasFieldType(oauthAliasOnly: boolean | undefined): 'hidden' | 'text' {
  return oauthAliasOnly ? 'text' : 'hidden';
}

/** A row's alias as the form shows it: trimmed, and null when empty or equal to the model name. */
export function shownAlias(entry: AliasField): string | null {
  const alias = entry.alias?.trim() ?? '';
  return alias && alias !== entry.name.trim() ? alias : null;
}

/** "N aliases" above a provider's model list: the rows with an alias that is not their own name. */
export function countAliases(models: readonly AliasField[]): number {
  return models.filter((entry) => shownAlias(entry) !== null).length;
}

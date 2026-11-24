import { ALIAS_FAMILIES } from '../pages/aliases/rows';

/**
 * The Models page's family for a provider form's brand (design 6.2): `openaiCompatibility` is
 * `openai-compatibility`; a brand that is no family (a sponsor form) gets no filter.
 */
export function familyOfBrand(brand: string | undefined): string | null {
  if (!brand) return null;
  const family = brand === 'openaiCompatibility' ? 'openai-compatibility' : brand;
  return (ALIAS_FAMILIES as readonly string[]).includes(family) ? family : null;
}

/** Where the "N aliases" line leads: the Models page, on the form's family when it is one. */
export function aliasesPageFor(brand: string | undefined): string {
  const family = familyOfBrand(brand);
  return family ? `/provimux/models?family=${family}` : '/provimux/models';
}

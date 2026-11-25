import type { ProvimuxNamesResponse } from '../api/types';
import { MODELS_PATH } from '../pages/models/address';
import { switchState } from '../pages/models/namesSetting';

/**
 * What the Routing page says about "Serve only my names" (models-page.md 8.9). Upstream's preview shows what an
 * account offers, not what is served: with the switch on, the gateway refuses a name that is not his before any
 * tier is tried, so the page says so near the model field and on the tiers that would serve it.
 *
 * Nothing while the switch is off, does not apply (Home), or the gateway has no names answer.
 */
export type RoutingNameVerdict =
  /** The switch is on and no model is typed: the rule, in one line. */
  | { kind: 'rule' }
  /** The typed name is not one the gateway serves under the rule: it is refused before routing. */
  | { kind: 'refused'; name: string }
  /**
   * The typed name is served under the rule: one of his names, or (`copyOf`) one of them under an account's
   * prefix. `accounts`: the accounts that answer it now, 0 when none does.
   */
  | { kind: 'yours'; name: string; accounts: number; copyOf: string | null };

/** `opus(high)` → `opus`: the gateway checks a name without its thinking suffix first (only-my-names.md 16.3). */
const withoutSuffix = (name: string): string => name.match(/^(.+)\([^()]*\)$/)?.[1] ?? name;

/**
 * The verdict for the name typed in the Routing page's model field, from the gateway's names answer. A name is
 * served under the rule when it is one of the answer's names or one of their prefixed copies, compared exactly as
 * the gateway does: what made it his (`set_by`) is not read.
 */
export function routingNameVerdict(
  answer: ProvimuxNamesResponse | null,
  typed: string | null
): RoutingNameVerdict | null {
  if (!answer || switchState(answer) !== 'on') return null;
  const name = typed?.trim() ?? '';
  if (!name) return { kind: 'rule' };
  const base = withoutSuffix(name);
  const candidates = base === name ? [name] : [base, name];
  for (const candidate of candidates) {
    const own = answer.names.find((item) => item.name === candidate);
    if (own) return { kind: 'yours', name, accounts: own.accounts, copyOf: null };
  }
  for (const candidate of candidates) {
    for (const own of answer.names) {
      const copy = own.copies.find((item) => item.id === candidate);
      if (copy) return { kind: 'yours', name, accounts: copy.accounts, copyOf: own.name };
    }
  }
  return { kind: 'refused', name };
}

/** Models, searched for the name when one is typed (its card, or its row under Not served with Keep). */
export function routingModelsAddress(verdict: RoutingNameVerdict): string {
  if (verdict.kind === 'rule') return MODELS_PATH;
  return `${MODELS_PATH}?${new URLSearchParams({ q: verdict.name }).toString()}`;
}

/** The add sheet's steps (design accounts-page.md, section 5): the service first, then what it needs. Pure. */
import type { Service } from './services';

export type Step =
  | { kind: 'service' }
  | { kind: 'how'; service: string }
  | { kind: 'site'; service: string }
  | { kind: 'key'; service: string };

/** The first step for a service: how (both kinds), which site (several sign-ins), the key form, or sign in. */
export function firstStep(service: Service): Step | { kind: 'sign-in'; flow: string } {
  if (service.signIn.length && service.key) return { kind: 'how', service: service.id };
  if (service.signIn.length > 1) return { kind: 'site', service: service.id };
  if (service.signIn.length === 1) return { kind: 'sign-in', flow: service.signIn[0] };
  return { kind: 'key', service: service.id };
}

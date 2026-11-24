/** The add sheet's steps (design accounts-page.md, section 5): the service first, then what it needs. Pure. */
import type { Service } from './services';

/** How an account of a service comes in: a sign-in, a key, a service account file, or SIWC binding. */
export type Way = 'sub' | 'key' | 'service-account' | 'siwc';

export type Step =
  | { kind: 'service' }
  | { kind: 'how'; service: string }
  | { kind: 'site'; service: string }
  | { kind: 'key'; service: string };

/** The ways a service offers, in the order the "how" step lists them. */
export function waysOf(service: Service): Way[] {
  const ways: Way[] = [];
  if (service.signIn.length) ways.push('sub');
  if (service.key) ways.push('key');
  for (const way of service.ways ?? []) ways.push(way);
  return ways;
}

/** Done at once, without a step of the sheet: a sign-in, or one of OAuth Login's dialogs. */
export type Start =
  | { kind: 'sign-in'; flow: string }
  | { kind: 'service-account' }
  | { kind: 'siwc' };

/** The first step for a service: how (several ways), which site (several sign-ins), the key form, or start. */
export function firstStep(service: Service): Step | Start {
  const ways = waysOf(service);
  if (ways.length > 1) return { kind: 'how', service: service.id };
  return stepOf(service, ways[0] ?? 'key');
}

/** Where one way of a service leads. */
export function stepOf(service: Service, way: Way): Step | Start {
  if (way === 'sub') {
    return service.signIn.length > 1
      ? { kind: 'site', service: service.id }
      : { kind: 'sign-in', flow: service.signIn[0] };
  }
  if (way === 'service-account') return { kind: 'service-account' };
  if (way === 'siwc') return { kind: 'siwc' };
  return { kind: 'key', service: service.id };
}

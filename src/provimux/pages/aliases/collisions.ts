/**
 * "One name, several services" (design aliases-page.md, section 4).
 */
import type { KeyEntry, LoginEntry, ServiceId } from './types';

/**
 * 4.2: `login:<channel>` for a login type; `key:<host>` for an API-key entry with a base URL,
 * `key:<family>` without one. A login and an API key are never one service.
 */
export function serviceOf(
  entry: Pick<KeyEntry, 'store' | 'host' | 'family'> | Pick<LoginEntry, 'store' | 'channel'>
): ServiceId {
  if (entry.store === 'login') return `login:${entry.channel}`;
  return `key:${entry.host ?? entry.family}`;
}

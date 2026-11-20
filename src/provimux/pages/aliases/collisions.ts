/**
 * "One name, several services" (design aliases-page.md, section 4). Runs on the draft, so a collision is
 * seen before anything is written. It never blocks a commit.
 */
import { draftEntries, isBlankNewRow, isBlocking, rowIssues } from './draft';
import type {
  AliasDraft,
  AliasEntry,
  AliasRow,
  KeyEntry,
  LoginEntry,
  NameGroup,
  ServiceId,
  Verdict,
} from './types';

/** Names are compared trimmed and lower-cased: the proxy resolves aliases without regard to case. */
export const nameKey = (name: string): string => name.trim().toLowerCase();

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

/**
 * 4.1: the names a row answers under. API-key row: the name, and `<prefix>/<name>` with a prefix; only
 * the prefixed one when the prefix is forced and differs from the name (`applyModelPrefixes`).
 */
export function clientNames(
  row: Pick<AliasRow, 'alias' | 'upstream'>,
  entry: AliasEntry,
  forceModelPrefix: boolean
): string[] {
  const base = (row.alias ?? row.upstream).trim();
  if (entry.store === 'login') return [base];
  const prefix = entry.prefix?.trim();
  if (!prefix) return [base];
  const prefixed = `${prefix}/${base}`;
  return forceModelPrefix && prefix !== base ? [prefixed] : [base, prefixed];
}

const VERDICT_RANK: Record<Verdict, number> = {
  single: 0,
  'several-keys': 1,
  'several-models': 2,
  'several-services': 3,
};

interface Collect {
  name: string;
  rows: AliasRow[];
  entries: AliasEntry[];
}

/**
 * 4.3: one group per client name, over the rows of enabled entries, leaving out rows with a blocking
 * issue and shadowed rows. Groups come in the order their name first appears.
 */
export function nameGroups(draft: AliasDraft): NameGroup[] {
  const issues = rowIssues(draft);
  const entries = new Map(draftEntries(draft).map((entry) => [entry.id, entry]));
  const byName = new Map<string, Collect>();
  for (const row of draft.rows) {
    const entry = entries.get(row.entryId);
    if (!entry || isBlankNewRow(row)) continue;
    if (entry.store === 'api-key' && entry.disabled) continue;
    const issue = issues[row.id];
    if (issue === 'shadowed' || isBlocking(issue)) continue;
    for (const name of clientNames(row, entry, draft.base.forceModelPrefix)) {
      const key = nameKey(name);
      if (!key) continue;
      const found = byName.get(key) ?? { name, rows: [], entries: [] };
      found.rows.push(row);
      found.entries.push(entry);
      byName.set(key, found);
    }
  }
  return [...byName.entries()].map(([key, found]) => {
    const services = [...new Set(found.entries.map((entry) => entry.service))].sort();
    const upstreamByKey = new Map<string, string>();
    for (const row of found.rows) {
      const upstream = row.upstream.trim();
      if (!upstreamByKey.has(nameKey(upstream))) upstreamByKey.set(nameKey(upstream), upstream);
    }
    const upstreams = [...upstreamByKey.values()].sort();
    const entryIds = new Set(found.entries.map((entry) => entry.id));
    const only = found.entries[0];
    const verdict: Verdict =
      services.length > 1
        ? 'several-services'
        : upstreams.length > 1
          ? 'several-models'
          : found.rows.length > 1
            ? 'several-keys'
            : 'single';
    return {
      key,
      name: found.name,
      rowIds: found.rows.map((row) => row.id),
      services,
      upstreams,
      pool:
        verdict === 'several-models' &&
        entryIds.size === 1 &&
        only.store === 'api-key' &&
        only.family === 'openai-compatibility',
      nativeServices: [],
      verdict,
    };
  });
}

/**
 * Row id -> the key of its group. A row with a prefix answers under two names, so it is in two groups;
 * it is given the one with the stronger verdict (the first on a tie), the one the page should mark.
 */
export function groupOfRow(groups: NameGroup[]): Record<string, string> {
  const result: Record<string, string> = {};
  const rank: Record<string, number> = {};
  for (const group of groups) {
    for (const rowId of group.rowIds) {
      const r = VERDICT_RANK[group.verdict];
      if (result[rowId] === undefined || r > rank[rowId]) {
        result[rowId] = group.key;
        rank[rowId] = r;
      }
    }
  }
  return result;
}

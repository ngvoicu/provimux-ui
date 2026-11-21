/**
 * The auth index the proxy injects into a read (design 1.1): `auth_index` (and the older `auth-index`) on
 * a group and on each of its keys, nowhere else; a write strips exactly those. The tests compare what
 * reads back "as read" with these, and only these, set aside: a nested `headers.auth-index` is
 * configuration like any other field.
 */
type Doc = Record<string, unknown>;

const INJECTED = ['auth_index', 'auth-index'];
const isDoc = (value: unknown): value is Doc =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const strip = (value: unknown): unknown => {
  if (!isDoc(value)) return value;
  const out = { ...value };
  for (const key of INJECTED) delete out[key];
  return out;
};

/** A family's list of groups without the injected index on its groups and their keys; nothing deeper. */
export const stripFamily = (groups: unknown): unknown =>
  Array.isArray(groups)
    ? groups.map((group) => {
        const g = strip(group);
        return isDoc(g) && Array.isArray(g.keys) ? { ...g, keys: g.keys.map(strip) } : g;
      })
    : groups;

/** Two reads of a family are the same configuration. */
export const sameFamily = (a: unknown, b: unknown): boolean =>
  Bun.deepEquals(stripFamily(a), stripFamily(b), true);

/** Two values with nothing injected in them (the login map, settings) are the same. */
export const same = (a: unknown, b: unknown): boolean => Bun.deepEquals(a, b, true);

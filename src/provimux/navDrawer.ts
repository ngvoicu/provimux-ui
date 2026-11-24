import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useLocation } from 'react-router-dom';

/**
 * The open sidebar drawers (MainLayout's plugin-page drawers and Provimux's "Advanced settings"), with
 * "Advanced settings" remembered. One seam in MainLayout: its drawer state is this hook instead of a bare
 * `useState`, so upstream's drawer, toggle and rendering stay as they are.
 *
 * "Advanced settings" is closed until opened; a click opens or closes it, and the browser remembers that
 * (local storage). While a page of it is shown (API keys, Subscriptions, Ways to sign in, their sub-pages
 * included) it is open, also when that page was opened by its address; leaving the page brings back what was
 * remembered. Other drawers behave as before: open while used, not remembered.
 */
export const ADVANCED_SETTINGS_DRAWER = 'provimux-advanced-settings';

/** The pages in "Advanced settings": while one of them (or a page under it) is shown, it is open. */
export const ADVANCED_SETTINGS_PATHS = ['/ai-providers', '/auth-files', '/oauth'] as const;

export const ADVANCED_SETTINGS_STORAGE_KEY = 'provimux.nav.advancedSettingsOpen';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const storage = (): Store | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** Whether "Advanced settings" was left open; closed when nothing is remembered or storage is unavailable. */
export function readAdvancedSettingsOpen(store: Store | null = storage()): boolean {
  try {
    return store?.getItem(ADVANCED_SETTINGS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeAdvancedSettingsOpen(open: boolean, store: Store | null = storage()) {
  try {
    store?.setItem(ADVANCED_SETTINGS_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // A private window or blocked storage: the drawer still works, it is only not remembered.
  }
}

/** Whether a path is one of the drawer's pages, or under one of them. */
export const inAdvancedSettings = (pathname: string): boolean =>
  ADVANCED_SETTINGS_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

/** The drawers shown open: the ones opened, and "Advanced settings" while one of its pages is shown. */
export function drawersShown(opened: ReadonlySet<string>, pathname: string): Set<string> {
  const shown = new Set(opened);
  if (inAdvancedSettings(pathname)) shown.add(ADVANCED_SETTINGS_DRAWER);
  return shown;
}

/**
 * The drawers opened after a change MainLayout made to the shown set: the change is taken as given, and
 * whether "Advanced settings" is in it is remembered when it changed.
 */
export function drawersAfter(
  opened: ReadonlySet<string>,
  pathname: string,
  action: SetStateAction<Set<string>>,
  remember: (open: boolean) => void = writeAdvancedSettingsOpen
): Set<string> {
  const shown = drawersShown(opened, pathname);
  const next = typeof action === 'function' ? action(shown) : action;
  const was = opened.has(ADVANCED_SETTINGS_DRAWER);
  const now = next.has(ADVANCED_SETTINGS_DRAWER);
  if (was !== now) remember(now);
  return next;
}

/**
 * MainLayout's drawer state: `[shown, set]`, as `useState<Set<string>>` gives it. `set` is stable, as a state
 * setter is: it reads the page shown when it runs.
 */
export function useProvimuxDrawers(): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const { pathname } = useLocation();
  const [opened, setOpened] = useState<Set<string>>(() =>
    readAdvancedSettingsOpen() ? new Set([ADVANCED_SETTINGS_DRAWER]) : new Set()
  );
  const shown = useMemo(() => drawersShown(opened, pathname), [opened, pathname]);
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const set = useCallback<Dispatch<SetStateAction<Set<string>>>>(
    (action) => setOpened((current) => drawersAfter(current, pathnameRef.current, action)),
    []
  );
  return [shown, set];
}

/**
 * "Advanced settings" in the menu: closed until opened, one click opens it, open while one of its pages is
 * shown (also when reached by its address), and remembered in the browser. MainLayout's drawer state is
 * `useProvimuxDrawers`, one seam; its drawer, toggle and rendering are upstream's.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  ADVANCED_SETTINGS_DRAWER,
  ADVANCED_SETTINGS_STORAGE_KEY,
  drawersAfter,
  drawersShown,
  inAdvancedSettings,
  readAdvancedSettingsOpen,
  useProvimuxDrawers,
  writeAdvancedSettingsOpen,
} from '@/provimux/navDrawer';

/** A browser's storage, in memory; `broken` throws as a private window's may. */
const store = (initial: Record<string, string> = {}, broken = false) => {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => {
      if (broken) throw new Error('SecurityError');
      return items.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (broken) throw new Error('QuotaExceededError');
      items.set(key, value);
    },
  };
};

/** MainLayout's toggle, as upstream writes it. */
const toggle = (id: string) => (current: Set<string>) => {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

describe('Advanced settings, remembered', () => {
  test('closed when nothing is remembered, or the storage cannot be read; open when it was left open', () => {
    expect(readAdvancedSettingsOpen(store())).toBe(false);
    expect(readAdvancedSettingsOpen(store({}, true))).toBe(false);
    expect(readAdvancedSettingsOpen(null)).toBe(false);
    expect(readAdvancedSettingsOpen(store({ [ADVANCED_SETTINGS_STORAGE_KEY]: '1' }))).toBe(true);
    expect(readAdvancedSettingsOpen(store({ [ADVANCED_SETTINGS_STORAGE_KEY]: '0' }))).toBe(false);
    const memory = store();
    writeAdvancedSettingsOpen(true, memory);
    expect(memory.items.get(ADVANCED_SETTINGS_STORAGE_KEY)).toBe('1');
    writeAdvancedSettingsOpen(false, memory);
    expect(memory.items.get(ADVANCED_SETTINGS_STORAGE_KEY)).toBe('0');
    // A storage that refuses the write leaves the drawer working, only not remembered.
    expect(() => writeAdvancedSettingsOpen(true, store({}, true))).not.toThrow();
  });

  test('one click opens it, another closes it, and each is remembered', () => {
    const remembered: boolean[] = [];
    const remember = (open: boolean) => remembered.push(open);
    const opened = drawersAfter(new Set(), '/provimux/models', toggle(ADVANCED_SETTINGS_DRAWER), remember);
    expect(opened.has(ADVANCED_SETTINGS_DRAWER)).toBe(true);
    const closed = drawersAfter(opened, '/provimux/models', toggle(ADVANCED_SETTINGS_DRAWER), remember);
    expect(closed.has(ADVANCED_SETTINGS_DRAWER)).toBe(false);
    expect(remembered).toEqual([true, false]);
    // A plugin page's drawer behaves as before: opened and closed, never remembered.
    drawersAfter(new Set(), '/', toggle('plugin-x'), remember);
    expect(remembered).toEqual([true, false]);
  });

  test('open while one of its pages is shown, sub-pages and an address typed in included; elsewhere as remembered', () => {
    for (const path of ['/ai-providers', '/auth-files', '/oauth', '/auth-files/oauth-excluded']) {
      expect(inAdvancedSettings(path)).toBe(true);
      expect(drawersShown(new Set(), path).has(ADVANCED_SETTINGS_DRAWER)).toBe(true);
    }
    for (const path of ['/', '/provimux/accounts', '/provimux/models', '/auth-filesx', '/routing']) {
      expect(inAdvancedSettings(path)).toBe(false);
      expect(drawersShown(new Set(), path).has(ADVANCED_SETTINGS_DRAWER)).toBe(false);
    }
    expect(drawersShown(new Set([ADVANCED_SETTINGS_DRAWER]), '/').has(ADVANCED_SETTINGS_DRAWER)).toBe(true);
    // A click on its own page cannot close it there; it is remembered closed for when he leaves.
    const remembered: boolean[] = [];
    const after = drawersAfter(
      new Set([ADVANCED_SETTINGS_DRAWER]),
      '/auth-files',
      toggle(ADVANCED_SETTINGS_DRAWER),
      (open) => remembered.push(open)
    );
    expect(remembered).toEqual([false]);
    expect(drawersShown(after, '/auth-files').has(ADVANCED_SETTINGS_DRAWER)).toBe(true);
    expect(drawersShown(after, '/provimux/models').has(ADVANCED_SETTINGS_DRAWER)).toBe(false);
  });

  test('the hook: opened by the address, closed elsewhere when nothing is remembered', () => {
    const shown: Record<string, boolean> = {};
    function Probe({ path }: { path: string }) {
      const [drawers] = useProvimuxDrawers();
      shown[path] = drawers.has(ADVANCED_SETTINGS_DRAWER);
      return null;
    }
    for (const path of ['/auth-files', '/provimux/models']) {
      renderToStaticMarkup(
        createElement(MemoryRouter, { initialEntries: [path] }, createElement(Probe, { path }))
      );
    }
    expect(shown).toEqual({ '/auth-files': true, '/provimux/models': false });
  });

  test('MainLayout keeps its drawer, toggle and rendering; its state is the one seam', () => {
    const layout = readFileSync('src/components/layout/MainLayout.tsx', 'utf8');
    expect(layout).toContain(
      'const [expandedPluginResourceIDs, setExpandedPluginResourceIDs] = useProvimuxDrawers();'
    );
    expect(layout).toContain('const isOpen = isActive || expandedPluginResourceIDs.has(item.id);');
    expect(layout).not.toContain('provimux-advanced-settings');
  });
});

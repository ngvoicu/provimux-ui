// The Models page's fixtures: an owner-like install (tests/provimux/fixtures/models), read as the page reads it.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import type { AuthFilesResponse } from '@/types/authFile';
import { readModelLists, readModelRoutes, readSavings } from '@/provimux/api/normalize';
import type { ProvimuxModelRoutesResponse } from '@/provimux/api/types';
import { startDraft } from '@/provimux/pages/aliases/draft';
import { readAliasState } from '@/provimux/pages/aliases/rows';
import type { AliasDraft, AliasState } from '@/provimux/pages/aliases/types';
import { buildNames, usageByName, type NameItem } from '@/provimux/pages/models/catalog';
import { NameCard } from '@/provimux/pages/models/NameCard';
import { draftEntries } from '@/provimux/pages/aliases/draft';

export const ownerFixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/provimux/fixtures/models/owner-${name}.json`, 'utf8'));

/** The fixtures' clock: the answers were observed then. */
export const OWNER_NOW = Date.parse('2026-11-24T14:00:00Z');

export const ownerState = (etag: string | null = '"owner-1"'): AliasState => ({
  ...readAliasState(
    ownerFixture('config'),
    normalizeAuthFilesResponse(ownerFixture('credentials') as AuthFilesResponse).files
  ),
  etag,
});
export const ownerRoutes = () => readModelRoutes(ownerFixture('model-routes'));
export const ownerLists = () => readModelLists(ownerFixture('model-lists'));
export const ownerUsage = () => usageByName(readSavings(ownerFixture('usage')));

/** The names of a draft, with the owner's routes, lists and usage unless told otherwise. */
export function ownerNames(
  draft: AliasDraft = startDraft(ownerState()),
  routes: ProvimuxModelRoutesResponse | null = ownerRoutes(),
  usage: Record<string, number> | null = ownerUsage()
): NameItem[] {
  return buildNames({ draft, routes, lists: ownerLists(), usage, nowMs: OWNER_NOW });
}

export const nameOf = (items: readonly NameItem[], key: string): NameItem => {
  const found = items.find((item) => item.key === key);
  if (!found) throw new Error(`no name ${key}`);
  return found;
};

const noop = () => undefined;

/** One name's card, as the page draws it (closed unless `open`). */
export function renderCard(
  item: NameItem,
  draft: AliasDraft,
  routes: ProvimuxModelRoutesResponse | null = ownerRoutes(),
  options: { open?: boolean; locked?: boolean; offsetMs?: number } = {}
): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(NameCard, {
        id: 'card',
        item,
        draft,
        entries: draftEntries(draft),
        routes,
        routesKnown: routes !== null,
        offsetMs: options.offsetMs ?? OWNER_NOW - Date.now(),
        locked: options.locked ?? false,
        open: options.open ?? false,
        onToggle: noop,
        onRenamed: noop,
        onNewName: noop,
        edit: noop,
      })
    )
  );
}

/** Markup as text, one space between pieces. */
export const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

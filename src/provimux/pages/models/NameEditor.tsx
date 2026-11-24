import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { IconInfo, IconLock, IconPlus, IconSearch, IconX } from '@/components/ui/icons';
import type { ProvimuxModelRoutesResponse } from '../../api/types';
import { changeRow, draftEntries, removeRow } from '../aliases/draft';
import type { AliasDraft, AliasEntry, AliasRow } from '../aliases/types';
import {
  addToName,
  candidatesFor,
  listlessKeys,
  nameKey,
  removable,
  removeName,
  rowEditable,
  renameName,
  type Candidate,
  type NameItem,
  type RouteLine,
} from './catalog';
import { providerName, sourceName } from './labels';
import styles from './ModelsPage.module.scss';

type Edit = (change: (draft: AliasDraft) => AliasDraft) => void;

const BLOCKED_TEXT: Record<NonNullable<Candidate['blocked']>, string> = {
  'in-name': 'provimux.models.pick_in_name',
  'own-name': 'provimux.models.pick_own_name',
  taken: 'provimux.models.pick_taken',
};

/** How many matches the picker lists before "type to narrow". */
const PICKS_SHOWN = 8;

/** The words of a name worth matching models on: "claude-opus-5-5" -> claude, opus. */
const wordsOf = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word));

/** A source's label and a model, as one line of the picker or of the editor. */
function SourceLine({ entry, upstream }: { entry: AliasEntry | undefined; upstream: string }) {
  const { t } = useTranslation();
  return (
    <span className={styles.sourceLine}>
      <span className={styles.sourceName}>{entry ? sourceName(t, entry) : '?'}</span>
      <code className={styles.sourceModel}>{upstream}</code>
    </span>
  );
}

/**
 * The models a name can take: a search over every login type's models and every model an API key lists.
 * With no search, the models that look like the name come first.
 */
function ModelPicker({
  draft,
  routes,
  name,
  exclude,
  onPick,
  requireName = true,
}: {
  draft: AliasDraft;
  routes: ProvimuxModelRoutesResponse | null;
  /** The name the models go under (decides what is already under it). */
  name: string;
  exclude: ReadonlySet<string>;
  onPick: (candidate: Candidate) => void;
  /** Adding needs a name (the editor); the composer collects models before one is typed. */
  requireName?: boolean;
}) {
  const { t } = useTranslation();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const entries = useMemo(() => new Map(draftEntries(draft).map((e) => [e.id, e])), [draft]);
  // What is under the name already is not offered: the list above shows it. What cannot go under it
  // is offered last, with why.
  const candidates = useMemo(
    () =>
      candidatesFor(draft, routes, nameKey(name)).filter(
        (c) => !exclude.has(c.key) && c.blocked !== 'in-name'
      ),
    [draft, routes, name, exclude]
  );
  const listless = useMemo(() => listlessKeys(draft), [draft]);
  const words = query.trim() ? query.toLowerCase().split(/\s+/).filter(Boolean) : null;
  const hints = wordsOf(name);
  const scored = candidates
    .map((candidate) => {
      const entry = entries.get(candidate.entryId);
      const text = `${candidate.upstream} ${entry ? sourceName(t, entry) : ''}`.toLowerCase();
      const score = words
        ? words.every((word) => text.includes(word))
          ? 1
          : 0
        : hints.filter((word) => candidate.upstream.toLowerCase().includes(word)).length;
      return { candidate, score };
    })
    .filter(({ score }) => (words ? score > 0 : true))
    .sort(
      (a, b) =>
        Number(a.candidate.blocked !== null) - Number(b.candidate.blocked !== null) ||
        b.score - a.score
    );
  const shown = scored.slice(0, PICKS_SHOWN);

  return (
    <div className={styles.picker}>
      <label className={styles.pickerSearch} htmlFor={searchId}>
        <IconSearch size={14} />
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder={t('provimux.models.pick_placeholder')}
          aria-label={t('provimux.models.pick_placeholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {shown.length ? (
        <ul className={styles.pickList}>
          {shown.map(({ candidate }) => (
            <li key={candidate.key} className={styles.pickItem}>
              <SourceLine entry={entries.get(candidate.entryId)} upstream={candidate.upstream} />
              {candidate.blocked ? (
                <span className={styles.pickBlocked}>{t(BLOCKED_TEXT[candidate.blocked])}</span>
              ) : (
                <button
                  type="button"
                  className={styles.ghost}
                  disabled={requireName && !name.trim()}
                  onClick={() => onPick(candidate)}
                  aria-label={t('provimux.models.pick_add_label', {
                    model: candidate.upstream,
                    name: name.trim() || '…',
                  })}
                >
                  <IconPlus size={13} />
                  {t('provimux.models.pick_add')}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.pickNone}>{t('provimux.models.pick_none')}</p>
      )}
      {scored.length > shown.length ? (
        <p className={styles.pickMore}>
          {t('provimux.models.pick_more', { count: scored.length - shown.length })}
        </p>
      ) : null}
      {listless.length ? (
        <p className={styles.pickNote}>
          <IconInfo size={13} />
          <span>
            {t('provimux.models.pick_listless', {
              keys: listless.map((entry) => sourceName(t, entry)).join(', '),
            })}{' '}
            <Link to="/ai-providers" className={styles.link}>
              {t('provimux.models.open_providers')}
            </Link>
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** A login row's options (and an API-key row's one): what each alias row also stores. */
function RowOptions({ row, name, edit }: { row: AliasRow; name: string; edit: Edit }) {
  const { t } = useTranslation();
  const login = row.store === 'login';
  return (
    <div className={styles.options}>
      {login ? (
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={row.fork === true}
            onChange={(event) => edit((d) => changeRow(d, row.id, { fork: event.target.checked }))}
          />
          <span>{t('provimux.models.option_fork', { model: row.upstream.trim() })}</span>
        </label>
      ) : null}
      <label className={styles.option}>
        <input
          type="checkbox"
          checked={row.forceMapping === true}
          onChange={(event) =>
            edit((d) => changeRow(d, row.id, { forceMapping: event.target.checked }))
          }
        />
        <span>{t('provimux.models.option_force', { name })}</span>
      </label>
      {login ? (
        <label className={styles.optionText}>
          <span>{t('provimux.models.option_display')}</span>
          <input
            className={styles.input}
            value={row.displayName ?? ''}
            placeholder={t('provimux.models.option_display_placeholder')}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) =>
              edit((d) => changeRow(d, row.id, { displayName: event.target.value }))
            }
          />
        </label>
      ) : null}
    </div>
  );
}

/** One route of the name in the editor: where it comes from, and what can be done with it here. */
function Member({
  line,
  item,
  draft,
  entry,
  edit,
}: {
  line: RouteLine;
  item: NameItem;
  draft: AliasDraft;
  entry: AliasEntry | undefined;
  edit: Edit;
}) {
  const { t } = useTranslation();
  const [options, setOptions] = useState(false);
  const editable = line.rowId !== null && rowEditable(draft, line.rowId);
  const row = editable ? draft.rows.find((r) => r.id === line.rowId) : undefined;
  const label = entry ? sourceName(t, entry) : providerName(t, line.provider, line.host);
  return (
    <li className={styles.member} data-state={line.state}>
      <div className={styles.memberLine}>
        <span className={styles.sourceLine}>
          <span className={styles.sourceName}>{label}</span>
          <code className={styles.sourceModel}>{line.upstream}</code>
        </span>
        {line.state === 'removed' ? (
          <span className={styles.tag} data-tone="removed">
            {t('provimux.models.tag_removed')}
          </span>
        ) : line.rowId === null ? (
          <span className={styles.memberFixed} title={t('provimux.models.built_in_hint')}>
            <IconLock size={12} />
            {t('provimux.models.member_built_in')}
          </span>
        ) : (
          <span className={styles.memberActions}>
            {row ? (
              <button
                type="button"
                className={styles.ghost}
                aria-expanded={options}
                onClick={() => setOptions((open) => !open)}
              >
                {t('provimux.models.options')}
              </button>
            ) : null}
            {removable(draft, line) ? (
              <button
                type="button"
                className={styles.ghost}
                data-danger
                onClick={() => edit((d) => removeRow(d, line.rowId!))}
                aria-label={t('provimux.models.member_remove_label', {
                  model: line.upstream,
                  name: item.name,
                })}
              >
                <IconX size={13} />
                {t('provimux.models.member_remove')}
              </button>
            ) : !editable ? (
              <span className={styles.memberFixed} title={t('provimux.models.member_unread_hint')}>
                <IconLock size={12} />
                {t('provimux.models.member_unread')}
              </span>
            ) : (
              <span className={styles.memberFixed} title={t('provimux.models.member_listed_hint')}>
                <IconLock size={12} />
                {t('provimux.models.member_listed')}
              </span>
            )}
          </span>
        )}
      </div>
      {options && row ? <RowOptions row={row} name={item.name} edit={edit} /> : null}
    </li>
  );
}

/** A name's editor: rename it, take models out, put models in, remove it. Edits go to the draft at once. */
export function NameEditor({
  item,
  draft,
  entries,
  routes,
  edit,
  onRenamed,
  onClose,
}: {
  item: NameItem;
  draft: AliasDraft;
  entries: readonly AliasEntry[];
  routes: ProvimuxModelRoutesResponse | null;
  edit: Edit;
  onRenamed: (to: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const renameId = useId();
  const [to, setTo] = useState(item.name);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const builtIn = item.lines.some((line) => line.rowId === null && line.state !== 'removed');
  const ownNameRows = item.lines.some(
    (line) =>
      line.rowId !== null &&
      line.state !== 'removed' &&
      draft.rows.find((row) => row.id === line.rowId)?.alias === null
  );
  const target = to.trim();
  const renameTaken = target !== '' && nameKey(target) !== item.key;
  const members = item.lines.filter(
    (line, index, all) =>
      // One member per row: a login type with several accounts has several routes for one row.
      line.rowId === null || all.findIndex((other) => other.rowId === line.rowId) === index
  );

  return (
    <div
      className={styles.editor}
      role="group"
      aria-label={t('provimux.models.editor_label', { name: item.name })}
    >
      {item.own ? (
        <form
          className={styles.rename}
          onSubmit={(event) => {
            event.preventDefault();
            if (!renameTaken) return;
            edit((d) => renameName(d, item.key, target));
            onRenamed(target);
          }}
        >
          <label htmlFor={renameId}>{t('provimux.models.rename_label')}</label>
          <input
            id={renameId}
            className={styles.input}
            value={to}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setTo(event.target.value)}
          />
          <Button type="submit" variant="secondary" size="sm" disabled={!renameTaken}>
            {t('provimux.models.rename')}
          </Button>
          {builtIn || ownNameRows ? (
            <p className={styles.editorHint}>
              {t('provimux.models.rename_keeps', { name: item.name })}
            </p>
          ) : null}
        </form>
      ) : null}

      <div className={styles.editorPart}>
        <h4 className={styles.editorTitle}>
          {t('provimux.models.members_title', { name: item.name })}
        </h4>
        <ul className={styles.members}>
          {members.map((line) => (
            <Member
              key={line.key}
              line={line}
              item={item}
              draft={draft}
              entry={line.entryId ? entryById.get(line.entryId) : undefined}
              edit={edit}
            />
          ))}
        </ul>
      </div>

      <div className={styles.editorPart}>
        <h4 className={styles.editorTitle}>
          {t('provimux.models.add_title', { name: item.name })}
        </h4>
        <ModelPicker
          draft={draft}
          routes={routes}
          name={item.name}
          exclude={new Set()}
          onPick={(candidate) => edit((d) => addToName(d, candidate, item.name))}
        />
      </div>

      <div className={styles.editorFoot}>
        {item.own ? (
          <button
            type="button"
            className={styles.ghost}
            data-danger
            onClick={() => edit((d) => removeName(d, item.key))}
          >
            <IconX size={13} />
            {t('provimux.models.remove_name')}
          </button>
        ) : null}
        <span className={styles.editorFootNote}>{t('provimux.models.editor_note')}</span>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('provimux.models.done')}
        </Button>
      </div>
    </div>
  );
}

/**
 * "New name": a name and the models that go under it, kept here until Create puts them into the draft
 * in one edit. A name that exists already takes the models in.
 */
export function NameComposer({
  draft,
  routes,
  seed,
  existing,
  onCancel,
  onCreate,
}: {
  draft: AliasDraft;
  routes: ProvimuxModelRoutesResponse | null;
  /** The names on the page (`nameKey`): a name typed that is among them takes the models in. */
  existing: ReadonlySet<string>;
  /** A candidate's key to start with ("Name it" on a model). */
  seed: string | null;
  onCancel: () => void;
  onCreate: (name: string, change: (draft: AliasDraft) => AliasDraft) => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>(seed ? [seed] : []);
  const entries = useMemo(() => new Map(draftEntries(draft).map((e) => [e.id, e])), [draft]);
  const key = nameKey(name);
  const all = useMemo(() => candidatesFor(draft, routes, key), [draft, routes, key]);
  const byKey = new Map(all.map((candidate) => [candidate.key, candidate]));
  const chosen = picked.map((k) => byKey.get(k)).filter((c): c is Candidate => c !== undefined);
  const blocked = chosen.filter((candidate) => candidate.blocked);
  const exists = key !== '' && existing.has(key);
  const canCreate = key !== '' && chosen.length > 0 && blocked.length === 0;

  return (
    <form
      className={styles.composer}
      aria-label={t('provimux.models.new_name')}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canCreate) return;
        const target = name.trim();
        onCreate(target, (current) =>
          chosen.reduce((next, candidate) => addToName(next, candidate, target), current)
        );
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <div className={styles.composerHead}>
        <h3 className={styles.composerTitle}>{t('provimux.models.new_name')}</h3>
        <p className={styles.composerLede}>{t('provimux.models.new_name_lede')}</p>
      </div>
      <div className={styles.composerName}>
        <label htmlFor={nameId}>{t('provimux.models.name_label')}</label>
        <input
          id={nameId}
          className={styles.input}
          value={name}
          placeholder={t('provimux.models.name_placeholder')}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        {exists ? (
          <p className={styles.editorHint}>
            {t('provimux.models.name_exists', { name: name.trim() })}
          </p>
        ) : null}
      </div>

      <div className={styles.editorPart}>
        <h4 className={styles.editorTitle}>
          {t('provimux.models.picked_title', { count: chosen.length })}
        </h4>
        {chosen.length ? (
          <ul className={styles.members}>
            {chosen.map((candidate) => (
              <li key={candidate.key} className={styles.member}>
                <div className={styles.memberLine}>
                  <SourceLine
                    entry={entries.get(candidate.entryId)}
                    upstream={candidate.upstream}
                  />
                  {candidate.blocked ? (
                    <span className={styles.pickBlocked}>{t(BLOCKED_TEXT[candidate.blocked])}</span>
                  ) : null}
                  <button
                    type="button"
                    className={`${styles.ghost} ${styles.memberEnd}`}
                    onClick={() => setPicked((prev) => prev.filter((k) => k !== candidate.key))}
                    aria-label={t('provimux.models.picked_remove', { model: candidate.upstream })}
                  >
                    <IconX size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.sectionEmpty}>{t('provimux.models.picked_none')}</p>
        )}
        <p className={styles.editorHint}>{t('provimux.models.picked_order')}</p>
      </div>

      <div className={styles.editorPart}>
        <h4 className={styles.editorTitle}>{t('provimux.models.pick_title')}</h4>
        <ModelPicker
          draft={draft}
          routes={routes}
          name={name}
          exclude={new Set(picked)}
          requireName={false}
          onPick={(candidate) => setPicked((prev) => [...prev, candidate.key])}
        />
      </div>

      <div className={styles.editorFoot}>
        <span className={styles.editorFootNote}>{t('provimux.models.editor_note')}</span>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {t('provimux.models.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!canCreate}>
          {t('provimux.models.create')}
        </Button>
      </div>
    </form>
  );
}

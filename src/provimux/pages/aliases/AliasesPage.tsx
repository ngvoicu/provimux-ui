import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { FloatingSaveBar } from '@/features/config/components/FloatingSaveBar';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { addKeyAlias, addLoginAlias, changeRow, draftEntries, rowIssues } from './draft';
import { draftClientNames } from './collisions';
import { blockedEntries, planCommit } from './plan';
import { aliasesApi, createServedNamesSource, loadServedNames } from './aliasesApi';
import {
  INITIAL_PAGE,
  blockingCount,
  canEdit,
  changeCount,
  initialFilter,
  isDirty,
  leaveGuarded,
  pageStep,
  saveBarShown,
  type AliasFilter,
  type PageEvent,
  type PageState,
} from './pageLogic';
import { AliasesBody } from './AliasesBody';
import type { BoardActions } from './AliasesBoard';
import type { AliasDraft, CommitOutcome, ServedNames } from './types';
import shared from '../shared/Shared.module.scss';
import styles from './AliasesPage.module.scss';

/**
 * Aliases (design aliases-page.md): every alias of every API-key provider and login type, edited as one
 * draft over one read and saved with one action (3.4). The page's state is one `PageState`, changed only
 * by `pageStep` (3.6): nothing is editable while a read or a save is pending, or on a read without a tag.
 * After any save the draft is dropped, the edits the save did not confirm are listed with its reason, to
 * be typed again, and the file is read and shown as it is. Nothing is carried onto that read.
 */
export function AliasesPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [page, setPage] = useState<PageState>(INITIAL_PAGE);
  /** The state handlers act on: every event goes through `send`, so one tick's events compose. */
  const pageRef = useRef<PageState>(INITIAL_PAGE);
  const send = useCallback((event: PageEvent): PageState => {
    const next = pageStep(pageRef.current, event);
    if (next !== pageRef.current) {
      pageRef.current = next;
      setPage(next);
    }
    return next;
  }, []);

  const [served, setServed] = useState<ServedNames | undefined>(undefined);
  const [filter, setFilter] = useState<AliasFilter>(() => initialFilter(searchParams));
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const asked = useRef<Set<string>>(new Set());
  const requestRef = useRef(0);
  const askedNamesRef = useRef<string | null>(null);
  const sourceRef = useRef(createServedNamesSource((names) => loadServedNames(names)));

  // Names served natively (design 4.4): asked at each read (forced), and, debounced, when the draft's
  // set of client names changes. An answer for an older ask comes back null and is dropped.
  const askServed = useCallback((current: AliasDraft, force: boolean) => {
    const names = draftClientNames(current);
    askedNamesRef.current = [...names].sort().join('\n');
    const revision = apiClient.getConnectionRevision();
    void sourceRef.current.ask(names, { force }).then((answer) => {
      if (answer && revision === apiClient.getConnectionRevision()) setServed(answer);
    });
  }, []);

  const { draft } = page;
  const namesKey = useMemo(
    () => (draft ? [...draftClientNames(draft)].sort().join('\n') : null),
    [draft]
  );
  useEffect(() => {
    if (namesKey === null || namesKey === askedNamesRef.current) return;
    const timer = window.setTimeout(() => {
      if (pageRef.current.draft) askServed(pageRef.current.draft, false);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [namesKey, askServed]);

  /** The page's one read (3.4). Nothing can be edited from its start to its answer. */
  const read = useCallback(async () => {
    const id = ++requestRef.current;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      id === requestRef.current && revision === apiClient.getConnectionRevision();
    send({ type: 'read-started' });
    try {
      const state = await aliasesApi.load(apiClient.captureConnection(isCurrent));
      if (!isCurrent()) return;
      const next = send({ type: 'read-answered', state });
      if (next.draft?.base === state) {
        setFocusRowId(null);
        askServed(next.draft, true);
      }
    } catch (error) {
      if (!isCurrent()) return;
      send({ type: 'read-failed', message: getErrorMessage(error) });
    }
  }, [askServed, send]);

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    void read();
    return () => {
      requestRef.current += 1;
    };
  }, [connectionStatus, read]);

  const dirty = isDirty(page);
  const editable = canEdit(page);
  const changes = useMemo(() => (draft ? changeCount(draft) : 0), [draft]);
  const blocked = useMemo(() => (draft ? blockedEntries(draft).length > 0 : false), [draft]);
  const toFix = useMemo(() => (draft ? blockingCount(rowIssues(draft)) : 0), [draft]);

  const refresh = useCallback(() => {
    const current = pageRef.current;
    if (current.saving || current.reading) return;
    if (!isDirty(current)) return read();
    showConfirmation({
      title: t('provimux.aliases.reload_title'),
      message: t('provimux.aliases.reload_message'),
      confirmText: t('provimux.aliases.reload_confirm'),
      cancelText: t('provimux.aliases.unsaved_cancel'),
      variant: 'danger',
      onConfirm: () => {
        void read();
      },
    });
  }, [read, showConfirmation, t]);
  useHeaderRefresh(refresh);

  // The list of edits not saved is the only copy of what was typed: leaving asks first, as with edits.
  useUnsavedChangesGuard({
    shouldBlock: leaveGuarded(page),
    dialog: dirty
      ? {
          title: t('provimux.aliases.unsaved_title'),
          message: t('provimux.aliases.unsaved_message'),
          confirmText: t('provimux.aliases.unsaved_confirm'),
          cancelText: t('provimux.aliases.unsaved_cancel'),
          variant: 'danger',
        }
      : {
          title: t('provimux.aliases.leave_lost_title'),
          message: t('provimux.aliases.leave_lost_message'),
          confirmText: t('provimux.aliases.unsaved_confirm'),
          cancelText: t('provimux.aliases.unsaved_cancel'),
          variant: 'danger',
        },
  });

  const save = useCallback(async () => {
    const before = pageRef.current;
    if (!before.draft || !isDirty(before) || blockedEntries(before.draft).length) return;
    const started = send({ type: 'save-started' });
    if (started === before || !started.draft) return;
    const sent = started.draft;
    let outcome: CommitOutcome;
    try {
      outcome = await aliasesApi.commit(sent);
    } catch (error) {
      // A change of the management connection aborts the save before a write (3.4). Which writes
      // landed before it is not known here: every entry is listed, as after an answer that never came.
      outcome = {
        confirmed: [],
        unconfirmed: planCommit(sent).flatMap((unit) => unit.entryIds),
        failure: { reason: 'error', message: getErrorMessage(error) },
      };
    }
    send({ type: 'save-answered', outcome });
    // Other pages must not show the configuration as it was (3.4).
    useConfigStore.getState().clearCache();
    if (outcome.failure === null) showNotification(t('provimux.aliases.saved'), 'success');
    else showNotification(t('provimux.aliases.save_not_whole'), 'warning');
    await read();
  }, [read, send, showNotification, t]);

  /** A login type's built-in model names, offered when a model is typed; asked once per type. */
  const wantSuggestions = useCallback((channel: string) => {
    if (!channel || asked.current.has(channel)) return;
    asked.current.add(channel);
    authFilesApi
      .getModelDefinitions(channel)
      .then((models) =>
        setSuggestions((prev) => ({
          ...prev,
          [channel]: models.map((model) => model.id).filter(Boolean),
        }))
      )
      .catch(() => {
        // The list is a help: free text stays allowed.
      });
  }, []);

  const actions: BoardActions = useMemo(() => {
    const edit = (change: (current: AliasDraft) => AliasDraft) => send({ type: 'edited', change });
    return {
      setAlias: (rowId, text) => send({ type: 'alias-typed', rowId, text }),
      setUpstream: (rowId, text) => {
        const current = pageRef.current;
        // The alias is set again from its own text: a name equal to the old model was dropped.
        const alias =
          current.texts[rowId] ?? current.draft?.rows.find((r) => r.id === rowId)?.alias ?? '';
        edit((d) => changeRow(d, rowId, { upstream: text, alias }));
      },
      setDisplayName: (rowId, text) => edit((d) => changeRow(d, rowId, { displayName: text })),
      setFork: (rowId, value) => edit((d) => changeRow(d, rowId, { fork: value })),
      setForceMapping: (rowId, value) => edit((d) => changeRow(d, rowId, { forceMapping: value })),
      addKeyAlias: (entryId, upstream) => {
        const before = pageRef.current;
        const next = edit((d) => addKeyAlias(d, entryId, upstream, ''));
        if (next !== before && before.draft) {
          setFocusRowId(`${entryId}#new-${before.draft.nextNew}`);
        }
      },
      addLoginAlias: (channel) => {
        const before = pageRef.current;
        const next = edit((d) => addLoginAlias(d, channel, { upstream: '', alias: '' }));
        if (next === before || !before.draft || !next.draft) return;
        const added = next.draft.rows.find((row) =>
          row.id.endsWith(`#new-${before.draft!.nextNew}`)
        );
        if (!added) return;
        setFocusRowId(added.id);
        const entry = draftEntries(next.draft).find((e) => e.id === added.entryId);
        if (entry?.store === 'login') wantSuggestions(entry.channel);
      },
      removeRow: (rowId) => send({ type: 'row-removed', rowId }),
      undoEntry: (entryId) => send({ type: 'entry-undone', entryId }),
      wantSuggestions,
    };
  }, [send, wantSuggestions]);

  const statusText = page.saving
    ? t('provimux.aliases.saving')
    : blocked
      ? t('provimux.aliases.blocked', { count: toFix })
      : t('provimux.aliases.unsaved', { count: Math.max(changes, 1) });

  return (
    <div className={`${shared.page} ${styles.page}`}>
      <header className={shared.header}>
        <div className={shared.headerText}>
          <h1 className={shared.title}>{t('provimux.aliases.title')}</h1>
          <p className={shared.lede}>{t('provimux.aliases.lede')}</p>
        </div>
        <div className={shared.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
            loading={page.reading && draft !== null}
            disabled={page.saving || page.reading}
          >
            <IconRefreshCw size={14} />
            {t('provimux.common.reload')}
          </Button>
        </div>
      </header>

      <AliasesBody
        page={page}
        served={served}
        filter={filter}
        onFilter={setFilter}
        suggestions={suggestions}
        focusRowId={focusRowId}
        actions={actions}
        onRetry={() => void read()}
        onDismiss={(key) => send({ type: 'dismissed', key })}
      />

      <FloatingSaveBar
        visible={saveBarShown(page)}
        statusText={statusText}
        statusTone={page.saving ? 'busy' : blocked ? 'error' : 'warning'}
        saving={page.saving}
        saveDisabled={!editable || !dirty || blocked}
        discardDisabled={!editable}
        onSave={() => void save()}
        onDiscard={() => send({ type: 'discarded' })}
      />
    </div>
  );
}

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconInfo,
  IconPlus,
  IconSearch,
  IconX,
} from '@/components/ui/icons';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { AccessBadge } from '../shared/AccessBadge';
import {
  EMPTY_ACCOUNTS_FILTER,
  groupByService,
  matchesFilter,
  needsAttention,
  summarize,
  type Account,
  type AccountsFilter,
  type AccountsView,
} from './accounts';
import { accountName, fixOf, serviceLabel, stateHint, stateLabel } from './labels';
import { serviceById } from './services';
import { ServiceIcon } from './ServiceIcon';
import shared from '../shared/Shared.module.scss';
import styles from './AccountsPage.module.scss';

export interface AccountsBoardProps {
  accounts: readonly Account[];
  filter: AccountsFilter;
  onFilter: (next: AccountsFilter) => void;
  /** The browser's now (a login's countdowns) and the server's (a key's), as `buildAccounts` used them. */
  nowMs: number;
  serverNowMs: number;
  /** Accounts with a change being written: their controls wait. */
  busy: ReadonlySet<string>;
  /** false: the proxy reports no cooldowns on API keys (no Provimux endpoint). */
  routesKnown: boolean | null;
  loginsFailed: boolean;
  /**
   * Per API key (account id), the models it learned by itself that a subscription also serves while the key
   * is tried first or shares the requests (key-model-lists.md 12, decision 1): its row says so.
   */
  paidOverlaps?: ReadonlyMap<string, number>;
  onAdd: (service?: string) => void;
  onOpen: (account: Account) => void;
  onToggle: (account: Account, on: boolean) => void;
  onFix: (account: Account) => void;
}

/**
 * Every account, by service (design accounts-page.md, section 4): above them the summary, the search and the
 * filters, and "Add account"; each row the kind, who, the state in a word, the priority, the fix when one is
 * needed, the on/off switch and "Manage". Exported for static rendering in tests.
 */
export function AccountsBoard(props: AccountsBoardProps) {
  const { t, i18n } = useTranslation();
  const { accounts, filter, onFilter } = props;
  const summary = useMemo(() => summarize(accounts), [accounts]);
  const attention = accounts.filter(needsAttention).length;
  const visible = useMemo(
    () =>
      accounts.filter((account) =>
        matchesFilter(account, filter, serviceLabel(t, account.service))
      ),
    [accounts, filter, t]
  );
  const groups = useMemo(() => groupByService(visible), [visible]);
  const narrowed = filter.query.trim() !== '' || filter.view !== 'all';
  const set = (patch: Partial<AccountsFilter>) => onFilter({ ...filter, ...patch });
  const views: Array<{ value: AccountsView; label: string }> = [
    { value: 'all', label: t('provimux.accounts.view_all') },
    { value: 'sub', label: t('provimux.accounts.view_sub') },
    { value: 'api', label: t('provimux.accounts.view_api') },
    { value: 'attention', label: t('provimux.accounts.view_attention') },
  ];

  return (
    <>
      <div className={shared.chips} aria-label={t('provimux.accounts.summary_label')}>
        <span className={shared.chip}>
          {t('provimux.accounts.count_accounts', { count: summary.total })}
        </span>
        {summary.working ? (
          <span className={shared.chip} data-tone="ok">
            <span className={styles.chipDot} data-state="working" aria-hidden="true" />
            {t('provimux.accounts.count_working', { count: summary.working })}
          </span>
        ) : null}
        {attention ? (
          <button
            type="button"
            className={`${shared.chip} ${styles.chipAttention}`}
            aria-pressed={filter.view === 'attention'}
            onClick={() => set({ view: filter.view === 'attention' ? 'all' : 'attention' })}
          >
            <span className={styles.chipDot} data-state="signed-out" aria-hidden="true" />
            {summary.signedOut
              ? t('provimux.accounts.count_signed_out', { count: summary.signedOut })
              : null}
            {summary.signedOut && summary.problem ? ' · ' : null}
            {summary.problem ? t('provimux.accounts.count_problem', { count: summary.problem }) : null}
          </button>
        ) : null}
        {summary.cooling ? (
          <span className={`${shared.chip} ${styles.chipCooling}`}>
            <span className={styles.chipDot} data-state="cooling" aria-hidden="true" />
            {t('provimux.accounts.count_cooling', { count: summary.cooling })}
          </span>
        ) : null}
        {summary.off ? (
          <span className={shared.chip}>
            <span className={styles.chipDot} data-state="off" aria-hidden="true" />
            {t('provimux.accounts.count_off', { count: summary.off })}
          </span>
        ) : null}
      </div>

      {props.loginsFailed ? (
        <p className={shared.inlineError} role="alert">
          {t('provimux.accounts.logins_failed')}
        </p>
      ) : null}
      {props.routesKnown === false ? (
        <p className={shared.note}>
          <IconInfo size={13} />
          <span>{t('provimux.accounts.routes_unknown')}</span>
        </p>
      ) : null}

      <div className={`${shared.toolbar} ${styles.toolbar}`} role="search">
        <label className={shared.search}>
          <IconSearch size={15} className={shared.searchIcon} />
          <input
            type="search"
            value={filter.query}
            placeholder={t('provimux.accounts.search_placeholder')}
            aria-label={t('provimux.accounts.search_placeholder')}
            onChange={(event) => set({ query: event.target.value })}
          />
        </label>
        <div className={shared.segmented} role="group" aria-label={t('provimux.accounts.view_label')}>
          {views.map((view) => (
            <button
              key={view.value}
              type="button"
              aria-pressed={filter.view === view.value}
              onClick={() => set({ view: view.value })}
            >
              {view.label}
            </button>
          ))}
        </div>
        {narrowed ? (
          <button
            type="button"
            className={shared.clear}
            onClick={() => onFilter(EMPTY_ACCOUNTS_FILTER)}
          >
            <IconX size={12} />
            {t('provimux.common.clear_filters')}
          </button>
        ) : null}
        <span className={styles.toolbarSpacer} />
        <Button size="sm" className={styles.addButton} onClick={() => props.onAdd()}>
          <IconPlus size={14} />
          {t('provimux.accounts.add')}
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          title={t('provimux.accounts.empty_title')}
          description={t('provimux.accounts.empty_text')}
          action={
            <Button size="sm" onClick={() => props.onAdd()}>
              {t('provimux.accounts.add')}
            </Button>
          }
        />
      ) : groups.length === 0 ? (
        <p className={styles.noMatch}>{t('provimux.accounts.no_match')}</p>
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => {
            const label = serviceLabel(t, group.service);
            const offered = serviceById(group.service)?.offered ?? false;
            return (
              <section key={group.service} className={styles.group} aria-label={label}>
                <header className={styles.groupHead}>
                  <ServiceIcon service={group.service} provider={group.accounts[0].provider} />
                  <h2 className={styles.groupTitle}>{label}</h2>
                  <span className={styles.groupCount}>
                    {t('provimux.accounts.count_accounts', { count: group.accounts.length })}
                  </span>
                  {offered ? (
                    <button
                      type="button"
                      className={styles.groupAdd}
                      onClick={() => props.onAdd(group.service)}
                      aria-label={t('provimux.accounts.add_to_service', { service: label })}
                      title={t('provimux.accounts.add_to_service', { service: label })}
                    >
                      <IconPlus size={13} />
                      {t('provimux.accounts.add_short')}
                    </button>
                  ) : null}
                </header>
                <ul className={styles.rows}>
                  {group.accounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      nowMs={account.kind === 'sub' ? props.nowMs : props.serverNowMs}
                      language={i18n.language}
                      busy={props.busy.has(account.id)}
                      paid={props.paidOverlaps?.get(account.id) ?? 0}
                      onOpen={props.onOpen}
                      onToggle={props.onToggle}
                      onFix={props.onFix}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <p className={shared.note}>
        <IconInfo size={13} />
        <span>{t('provimux.accounts.priority_note')}</span>
      </p>
    </>
  );
}

function AccountRow({
  account,
  nowMs,
  language,
  busy,
  paid,
  onOpen,
  onToggle,
  onFix,
}: {
  account: Account;
  nowMs: number;
  language: string;
  busy: boolean;
  paid: number;
  onOpen: (account: Account) => void;
  onToggle: (account: Account, on: boolean) => void;
  onFix: (account: Account) => void;
}) {
  const { t } = useTranslation();
  const name = accountName(t, account);
  const hint = stateHint(t, account, language, nowMs);
  const fix = fixOf(account);
  const state = account.reading.state;
  const switchable = !(account.kind === 'sub' && account.runtimeOnly);
  // An OpenAI-compatible entry holds its keys together: their count, when it holds several.
  const detail =
    account.kind === 'api' && account.entry.keyIndex === null
      ? account.entry.keyCount > 1
        ? t('provimux.accounts.detail_keys', { count: account.entry.keyCount })
        : null
      : account.detail;
  return (
    <li
      className={styles.row}
      data-state={state}
      data-attention={needsAttention(account) || undefined}
      aria-busy={busy || undefined}
    >
      <button
        type="button"
        className={styles.who}
        onClick={() => onOpen(account)}
        aria-label={t('provimux.accounts.manage_named', { name })}
      >
        <span className={styles.whoMain}>{account.who}</span>
        {detail ? <span className={styles.whoDetail}>{detail}</span> : null}
        {paid > 0 ? (
          <span className={styles.paidMark} title={t('provimux.accounts.lists.board_paid_title')}>
            <IconAlertTriangle size={12} aria-hidden="true" />
            {t('provimux.accounts.lists.board_paid', { count: paid })}
          </span>
        ) : null}
      </button>
      {/* Kind and priority: their own columns on a wide card, one line under who on a narrow one. */}
      <span className={styles.meta}>
        <span className={styles.kind}>
          <AccessBadge access={account.kind} kind={null} />
        </span>
        <button
          type="button"
          className={styles.priority}
          onClick={() => onOpen(account)}
          title={t('provimux.accounts.priority_title')}
        >
          {t('provimux.accounts.priority', { value: account.priority })}
        </button>
      </span>
      <span className={styles.state}>
        <span className={styles.stateWord}>
          <span className={styles.stateDot} data-state={state} aria-hidden="true" />
          {stateLabel(t, account)}
        </span>
        {hint ? (
          <span className={styles.stateHint} title={hint}>
            {hint}
          </span>
        ) : null}
      </span>
      <span className={styles.actions}>
        {fix ? (
          <Button
            size="sm"
            variant={fix === 'sign-in' ? 'primary' : 'secondary'}
            className={styles.fix}
            disabled={busy}
            onClick={() => onFix(account)}
          >
            {fix === 'sign-in' ? t('provimux.accounts.fix.sign_in') : t('provimux.accounts.fix.replace')}
          </Button>
        ) : null}
        {switchable ? (
          <ToggleSwitch
            checked={state !== 'off'}
            disabled={busy}
            onChange={(on) => onToggle(account, on)}
            ariaLabel={t('provimux.accounts.use_named', { name })}
          />
        ) : null}
        {/* The name opens the same panel for the keyboard; this is its pointer target. */}
        <button
          type="button"
          className={styles.manage}
          onClick={() => onOpen(account)}
          tabIndex={-1}
          aria-hidden="true"
          title={t('provimux.accounts.manage')}
        >
          <IconChevronLeft size={16} className={styles.manageIcon} />
        </button>
      </span>
    </li>
  );
}

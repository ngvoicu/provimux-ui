import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import shared from '../shared/Shared.module.scss';
import { formatClock, formatExact, timeMs } from '../time';
import { CardHead, CardStatus, Provenance } from './parts';
import {
  absentLine,
  describePersistWrite,
  reasonText,
  sinceLine,
  type CardMessage,
  type Describe,
  type OnWrite,
} from './restartsWords';
import { restartsApi, type Client } from './restartsApi';
import {
  lastError,
  samePersist,
  startOutcome,
  type GatewayKind,
  type PersistLoad,
  type PersistState,
} from './restartsLogic';
import type { Check } from './restartsWrite';
import styles from './RestartsPage.module.scss';

interface PersistCardProps {
  persist: PersistLoad;
  writable: boolean;
  kind: GatewayKind;
  version: string | null;
  busy: boolean;
  message: CardMessage | null;
  onWrite: OnWrite;
}

const SETTING = 'routing.session-affinity-persist';

const checkPersist =
  (drawn: PersistState) =>
  async (client: Client): Promise<Check> => {
    const now = await restartsApi.persist(client);
    if (now.kind === 'absent') return 'absent';
    if (now.kind !== 'ready') return 'unreadable';
    return samePersist(now.state, drawn) ? 'same' : 'changed';
  };

/**
 * `routing.session-affinity-persist`, read from its state path only (the config path answers 404 when the file does
 * not set it, and unset is on). Off writes `false`; on removes the key, its default. The card says what the gateway
 * reports, never more: in effect means conversations that send their own session id are put back on their account
 * when that account is still recognised and the binding has not expired.
 */
export function PersistCard(props: PersistCardProps) {
  const { persist, writable, kind, version, busy, message, onWrite } = props;
  const { t, i18n } = useTranslation();
  const id = useId();

  const head = (control?: ReactNode) => (
    <CardHead
      id={id}
      title={t('provimux.restarts.persist_title')}
      setting={SETTING}
      control={control}
    />
  );

  if (persist.kind === 'loading') {
    return (
      <section className={styles.card} aria-labelledby={`${id}-title`} aria-busy="true">
        {head()}
        <p className={shared.featureText}>{t('provimux.common.loading')}</p>
      </section>
    );
  }

  if (persist.kind === 'error') {
    return (
      <section className={styles.card} aria-labelledby={`${id}-title`}>
        {head()}
        <p className={shared.featureError} role="alert">
          {t('provimux.restarts.persist_failed', { message: persist.message })}
        </p>
        <CardStatus message={message} />
      </section>
    );
  }

  if (persist.kind === 'absent') {
    return (
      <section className={styles.card} aria-labelledby={`${id}-title`} data-state="absent">
        {head()}
        <p className={styles.value} data-tone="muted">
          {t('provimux.restarts.not_reported')}
        </p>
        <p className={shared.featureText}>
          {kind === 'provimux'
            ? t('provimux.restarts.absent_unknown')
            : absentLine(t, kind, version)}
        </p>
        {kind === 'provimux' ? <p className={shared.featureText}>{sinceLine(t)}</p> : null}
        <CardStatus message={message} />
      </section>
    );
  }

  const { state } = persist;
  const canWrite = writable && !busy;
  const status = state.inEffect ? 'ok' : !state.setting ? 'off' : 'warning';
  const describe: Describe = (result, snapshot) => describePersistWrite(t, result, snapshot);
  const write = (
    send: (etag: string | null, client: Client) => Promise<void>,
    shows: (now: PersistState) => boolean
  ) =>
    onWrite(
      {
        check: checkPersist(state),
        send,
        shows: (snapshot) => snapshot.persist.kind === 'ready' && shows(snapshot.persist.state),
      },
      describe
    );
  const turnOff = () =>
    write(
      (etag, client) => restartsApi.persistOff(etag, client),
      (now) => now.set && !now.setting
    );
  const toDefault = () =>
    write(
      (etag, client) => restartsApi.persistToDefault(etag, client),
      (now) => !now.set
    );

  const written = timeMs(state.lastWrittenAt);
  const failure = lastError(state);

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`} data-on={state.setting}>
      {head(
        <ToggleSwitch
          checked={state.setting}
          onChange={(next) => (next ? toDefault() : turnOff())}
          disabled={!canWrite}
          ariaLabel={t('provimux.restarts.persist_switch_label')}
          ariaDescribedBy={`${id}-cost`}
          labelPosition="left"
          label={
            <span className={shared.switchState}>
              {state.setting ? t('provimux.restarts.on') : t('provimux.restarts.off')}
            </span>
          }
        />
      )}

      <div className={styles.valueRow}>
        <p className={styles.value} data-tone={status}>
          <span className={styles.dot} aria-hidden="true" />
          {status === 'ok'
            ? t('provimux.restarts.persist_in_effect')
            : status === 'off'
              ? t('provimux.restarts.persist_value_off')
              : t('provimux.restarts.persist_not_in_effect')}
        </p>
        <Provenance set={state.set} />
      </div>

      {state.inEffect ? (
        <>
          <p className={shared.featureText}>{t('provimux.restarts.persist_on_text')}</p>
          <p className={shared.featureNote}>{t('provimux.restarts.persist_limits')}</p>
        </>
      ) : !state.setting ? (
        <>
          <p className={shared.featureText}>{t('provimux.restarts.persist_off_text')}</p>
          {/* A reason before the switch in the gateway's order: turned on, it would still not apply. */}
          {state.reason && state.reason !== 'switch-off' ? (
            <p className={styles.note} data-tone="warning">
              {t('provimux.restarts.persist_off_also', { reason: reasonText(t, state.reason) })}
            </p>
          ) : null}
        </>
      ) : (
        <p className={shared.featureText}>{reasonText(t, state.reason)}</p>
      )}
      {state.reason === 'session-affinity-off' ? (
        <p className={styles.linkRow}>
          <Link to="/routing" className={shared.inlineLink}>
            {t('provimux.restarts.open_routing')}
          </Link>
        </p>
      ) : null}
      {state.detail && !state.inEffect ? (
        <p className={styles.detail}>
          <span>{t('provimux.restarts.detail_label')}</span> <code>{state.detail}</code>
        </p>
      ) : null}

      <dl className={styles.facts}>
        <div>
          <dt>{t('provimux.restarts.last_written_label')}</dt>
          <dd>
            {written !== null ? (
              <span title={formatExact(written, i18n.language)}>
                {t('provimux.restarts.last_written', {
                  time: formatClock(written, i18n.language),
                  count: state.lastBindings,
                })}
              </span>
            ) : state.inEffect ? (
              t('provimux.restarts.not_written_yet')
            ) : (
              t('provimux.restarts.not_written')
            )}
            {state.leftOut > 0 ? (
              <span className={styles.factNote}>
                {t('provimux.restarts.left_out', { count: state.leftOut })}
              </span>
            ) : null}
            {state.leftOutNoIdentity > 0 ? (
              <span className={styles.factNote}>
                {t('provimux.restarts.left_out_no_identity', { count: state.leftOutNoIdentity })}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{t('provimux.restarts.last_start_label')}</dt>
          <dd>
            <StartLine state={state} />
          </dd>
        </div>
      </dl>

      {failure ? (
        <p className={styles.note} data-tone="warning">
          {failure.kind === 'not-removed'
            ? t('provimux.restarts.last_error_not_removed', { message: failure.message })
            : t('provimux.restarts.last_error_write', { message: failure.message })}
        </p>
      ) : null}
      {state.keyNote ? <p className={styles.note}>{t('provimux.restarts.key_note')}</p> : null}

      <p id={`${id}-cost`} className={styles.cost}>
        {state.setting ? t('provimux.restarts.turn_off_cost') : t('provimux.restarts.turn_on_cost')}
      </p>

      {state.set && state.setting ? (
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            onClick={toDefault}
            disabled={!canWrite}
            title={t('provimux.restarts.use_default_hint')}
          >
            {t('provimux.restarts.use_default')}
          </Button>
        </div>
      ) : null}

      <CardStatus message={message} />

      {state.snapshot ? (
        <details className={styles.files}>
          <summary>{t('provimux.restarts.files_label')}</summary>
          <code>{t('provimux.restarts.files_snapshot', { path: state.snapshot })}</code>
          {state.key ? <code>{t('provimux.restarts.files_key', { path: state.key })}</code> : null}
          <p>{t('provimux.restarts.files_text')}</p>
        </details>
      ) : null}
    </section>
  );
}

function StartLine({ state }: { state: PersistState }) {
  const { t } = useTranslation();
  const outcome = startOutcome(state);
  if (outcome.kind === 'no-snapshot') return <>{t('provimux.restarts.start_no_snapshot')}</>;
  if (outcome.kind === 'not-in-effect') return <>{t('provimux.restarts.start_not_in_effect')}</>;
  if (outcome.kind === 'failed') {
    return <>{t('provimux.restarts.start_failed', { message: outcome.message })}</>;
  }
  if (outcome.kind === 'unknown') return <>{t('provimux.restarts.unknown')}</>;
  const { restored } = outcome;
  const extras = [
    restored.expired > 0
      ? t('provimux.restarts.restored_expired', { count: restored.expired })
      : null,
    restored.unknownAccounts > 0
      ? t('provimux.restarts.restored_unknown', { count: restored.unknownAccounts })
      : null,
    restored.otherBuild > 0
      ? t('provimux.restarts.restored_other_build', { count: restored.otherBuild })
      : null,
  ].filter((line): line is string => line !== null);
  return (
    <>
      {t('provimux.restarts.restored', { count: restored.sessions })}
      {extras.map((line) => (
        <span key={line} className={styles.factNote}>
          {line}
        </span>
      ))}
    </>
  );
}

import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import shared from '../shared/Shared.module.scss';
import { formatClock, formatExact, timeMs } from '../time';
import { CardStatus, Provenance, type CardMessage, type Send, type Write } from './parts';
import { restartsApi } from './restartsApi';
import {
  isKnownReason,
  startOutcome,
  unbroken,
  type PersistAbsence,
  type PersistLoad,
  type PersistState,
} from './restartsLogic';
import styles from './RestartsPage.module.scss';

interface PersistCardProps {
  persist: PersistLoad;
  /** What a 404 at the state path means for this gateway, by its version. */
  absence: PersistAbsence;
  /** `routing.session-affinity` in the file: without it nothing is tied to an account anyway. */
  affinityOn: boolean;
  write: Write;
}

const reasonKey = (reason: string) => `provimux.restarts.reason_${reason.replace(/-/g, '_')}`;

/**
 * `routing.session-affinity-persist`, read from its state path (the config path answers 404 when the file does not
 * set it, and unset is on). Off is `false` in the file; on is the key removed, its default. After a write the page
 * waits for the state to show it: the gateway applies the switch at its next check, within about 5 seconds.
 */
export function PersistCard({ persist, absence, affinityOn, write }: PersistCardProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<CardMessage | null>(null);

  const head = (control?: ReactNode) => (
    <div className={shared.featureHead}>
      <div className={shared.featureTitles}>
        <h2 id={`${id}-title`} className={styles.cardTitle}>
          {t('provimux.restarts.persist_title')}
        </h2>
        <p className={shared.featureEyebrow}>
          <code>routing.session-affinity-persist</code>
        </p>
      </div>
      {control ? <div className={shared.featureControl}>{control}</div> : null}
    </div>
  );

  if (persist.kind === 'absent') {
    return (
      <section className={styles.card} aria-labelledby={`${id}-title`} data-state="absent">
        {head()}
        <p className={styles.value} data-tone="muted">
          {t('provimux.restarts.not_in_gateway')}
        </p>
        <p className={shared.featureText}>
          {absence.kind === 'not-provimux'
            ? t('provimux.restarts.persist_not_provimux', { version: unbroken(absence.version) })
            : absence.kind === 'older'
              ? t('provimux.restarts.persist_older', {
                  version: unbroken(absence.version),
                  since: unbroken(absence.since),
                })
              : t('provimux.restarts.persist_not_yet')}
        </p>
        {affinityOn ? (
          <p className={shared.featureText}>{t('provimux.restarts.persist_absent_now')}</p>
        ) : null}
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
      </section>
    );
  }

  const { state } = persist;

  const run = async (send: Send, applied: (next: PersistLoad) => boolean, done: CardMessage) => {
    setBusy(true);
    setMessage(null);
    const outcome = await write(send, applied, () =>
      setMessage({ tone: 'pending', text: t('provimux.restarts.applying') })
    );
    setBusy(false);
    setMessage(outcome.ok ? done : outcome.message);
  };

  const turnOff = () =>
    run(
      (read, client) => restartsApi.persistOff(read, client),
      (next) => next.kind === 'ready' && next.state.set && !next.state.setting,
      { tone: 'ok', text: t('provimux.restarts.persist_saved_off') }
    );

  const toDefault = (done: string) =>
    run(
      (read, client) => restartsApi.persistToDefault(read, client),
      (next) => next.kind === 'ready' && !next.state.set,
      { tone: 'ok', text: done }
    );

  const status = statusOf(state);

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`} data-on={state.setting}>
      {head(
        <ToggleSwitch
          checked={state.setting}
          onChange={(next) =>
            void (next ? toDefault(t('provimux.restarts.persist_saved_on')) : turnOff())
          }
          disabled={busy}
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

      <p className={shared.featureText}>
        {state.inEffect
          ? t('provimux.restarts.persist_on_text')
          : !state.setting
            ? t('provimux.restarts.persist_off_text')
            : isKnownReason(state.reason)
              ? t(reasonKey(state.reason))
              : t('provimux.restarts.reason_unlisted', { reason: state.reason ?? '?' })}
      </p>
      {!state.inEffect && state.setting && state.reason === 'session-affinity-off' ? (
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
            {state.lastWrittenAt && timeMs(state.lastWrittenAt) !== null ? (
              <span title={formatExact(timeMs(state.lastWrittenAt)!, i18n.language)}>
                {t('provimux.restarts.last_written', {
                  time: formatClock(timeMs(state.lastWrittenAt)!, i18n.language),
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
          </dd>
        </div>
        <div>
          <dt>{t('provimux.restarts.last_start_label')}</dt>
          <dd>
            <StartLine state={state} />
          </dd>
        </div>
      </dl>

      {state.lastError ? (
        <p className={styles.note} data-tone="warning">
          {t('provimux.restarts.last_error', { message: state.lastError })}
        </p>
      ) : null}
      {state.keyNote ? <p className={styles.note}>{t('provimux.restarts.key_note')}</p> : null}

      {/* What the switch would change; while a reason keeps it from applying, the reason says it instead. */}
      {state.inEffect || !state.setting ? (
        <p id={`${id}-cost`} className={styles.cost}>
          {state.setting
            ? t('provimux.restarts.turn_off_cost')
            : t('provimux.restarts.turn_on_cost')}
        </p>
      ) : null}

      {state.set && state.setting ? (
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void toDefault(t('provimux.restarts.persist_saved_default'))}
            disabled={busy}
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
          <code>{state.snapshot}</code>
          {state.key ? <code>{state.key}</code> : null}
          <p>{t('provimux.restarts.files_text')}</p>
        </details>
      ) : null}
    </section>
  );
}

function statusOf(state: PersistState): 'ok' | 'off' | 'warning' {
  if (state.inEffect) return 'ok';
  if (!state.setting) return 'off';
  return 'warning';
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

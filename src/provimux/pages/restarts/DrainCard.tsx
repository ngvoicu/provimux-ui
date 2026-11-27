import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import shared from '../shared/Shared.module.scss';
import { CardHead, CardStatus, Provenance } from './parts';
import {
  absentLine,
  describeDrainWrite,
  sinceLine,
  type CardMessage,
  type Describe,
  type OnWrite,
} from './restartsWords';
import { restartsApi, type Client } from './restartsApi';
import {
  DRAIN_IN_FILE_SINCE,
  drainFileInUse,
  sameDrain,
  supportSince,
  unbroken,
  type DrainLoad,
  type DrainState,
  type GatewayKind,
} from './restartsLogic';
import type { Check, Snapshot } from './restartsWrite';
import styles from './RestartsPage.module.scss';

interface DrainCardProps {
  drain: DrainLoad;
  /** The configuration could be read: its tag makes a write conditional. */
  writable: boolean;
  kind: GatewayKind;
  version: string | null;
  /** A change or a reload is under way: every control waits. */
  busy: boolean;
  message: CardMessage | null;
  onWrite: OnWrite;
}

const SETTING = 'server.restart-drain-seconds';

/** Before a write: the gateway still reports the drain state the control was drawn from. */
const checkDrain =
  (drawn: DrainState) =>
  async (client: Client): Promise<Check> => {
    const now = await restartsApi.drain(client);
    if (now.kind === 'absent') return 'absent';
    if (now.kind !== 'ready') return 'unreadable';
    return sameDrain(now.state, drawn) ? 'same' : 'changed';
  };

const drainOf = (snapshot: Snapshot) =>
  snapshot.drain.kind === 'ready' ? snapshot.drain.state : null;

/**
 * `server.restart-drain-seconds`, as `GET /provimux/restart-drain` reports it: the wait the running gateway uses, what
 * the file says, the default and the bounds. A control only where that path answers: the switch turns the wait off (0)
 * or back to the default (the key removed); the slider sets a number, saved with its own button.
 */
export function DrainCard(props: DrainCardProps) {
  const { drain, writable, kind, version, busy, message, onWrite } = props;
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<number | null>(null);
  const state = drain.kind === 'ready' ? drain.state : null;

  // A fresh read replaces whatever was being edited when it changed the value under it.
  const inUse = state?.seconds ?? null;
  useEffect(() => {
    setDraft(null);
  }, [inUse]);

  const head = (control?: ReactNode) => (
    <CardHead
      id={id}
      title={t('provimux.restarts.drain_title')}
      setting={SETTING}
      control={control}
    />
  );

  if (drain.kind === 'loading') {
    return (
      <section className={styles.card} aria-labelledby={`${id}-title`} aria-busy="true">
        {head()}
        <p className={shared.featureText}>{t('provimux.common.loading')}</p>
      </section>
    );
  }

  if (drain.kind === 'error') {
    return (
      <section className={styles.card} aria-labelledby={`${id}-title`}>
        {head()}
        <p className={shared.featureError} role="alert">
          {t('provimux.restarts.drain_failed', { message: drain.message })}
        </p>
        <CardStatus message={message} />
      </section>
    );
  }

  if (drain.kind === 'absent' || !state) {
    // Read-only: the page says nothing about a wait it cannot read.
    const support = supportSince(version, DRAIN_IN_FILE_SINCE);
    const lines =
      kind === 'provimux' && support.kind === 'yes'
        ? [
            t('provimux.restarts.drain_absent_in_file', {
              version: unbroken(version ?? '?'),
            }),
            sinceLine(t),
          ]
        : kind === 'provimux' && support.kind === 'older'
          ? [
              t('provimux.restarts.drain_absent_older', { version: unbroken(support.version) }),
              sinceLine(t),
            ]
          : kind === 'provimux'
            ? [t('provimux.restarts.absent_unknown'), sinceLine(t)]
            : [absentLine(t, kind, version)];
    return (
      <section className={styles.card} aria-labelledby={`${id}-title`} data-state="absent">
        {head()}
        <p className={styles.value} data-tone="muted">
          {t('provimux.restarts.not_reported')}
        </p>
        {lines.map((line) => (
          <p key={line} className={shared.featureText}>
            {line}
          </p>
        ))}
        <CardStatus message={message} />
      </section>
    );
  }

  const on = state.seconds > 0;
  const sliderMin = Math.max(1, state.min);
  const span = Math.max(1, state.max - sliderMin);
  const share = (seconds: number) =>
    (Math.min(Math.max(seconds, sliderMin), state.max) - sliderMin) / span;
  const at = (seconds: number) =>
    ({ left: `${share(seconds) * 100}%`, '--at': share(seconds) }) as CSSProperties;
  const shown = draft ?? (on ? Math.min(Math.max(state.seconds, sliderMin), state.max) : sliderMin);
  const dirty =
    draft !== null &&
    (draft !== state.writtenSeconds || state.writtenAccepted === false || !state.set);
  const fileKnown = state.fileError === null;
  const canWrite = writable && fileKnown && !busy;
  const byDefault = Math.min(state.default, state.stopLimit);
  // Marks at the ends and every ten seconds between.
  const marks = [sliderMin, state.max];
  for (let mark = 10; mark < state.max; mark += 10) if (mark > sliderMin) marks.splice(-1, 0, mark);
  const defaultMark = Math.min(Math.max(state.default, sliderMin), state.max);

  const describe: Describe = (result, snapshot) => describeDrainWrite(t, result, snapshot);
  const write = (
    send: (etag: string | null, client: Client) => Promise<void>,
    shows: (s: DrainState) => boolean
  ) =>
    onWrite(
      {
        check: checkDrain(state),
        send,
        shows: (snapshot) => {
          const now = drainOf(snapshot);
          return now !== null && shows(now);
        },
      },
      describe
    );
  const toDefault = () =>
    write(
      (etag, client) => restartsApi.drainToDefault(etag, client),
      (now) => !now.set && now.seconds === now.default
    );
  const setTo = (seconds: number) =>
    write(
      (etag, client) => restartsApi.setDrain(etag, seconds, client),
      (now) => now.set && now.written === String(seconds) && drainFileInUse(now)
    );

  const notes: Array<{ key: string; text: string; tone?: 'warning' }> = [];
  if (!fileKnown) {
    notes.push({
      key: 'file',
      tone: 'warning',
      text: t('provimux.restarts.drain_file_error', { message: state.fileError }),
    });
  } else if (state.set && state.writtenAccepted === false) {
    notes.push({
      key: 'refused',
      tone: 'warning',
      text: t('provimux.restarts.drain_refused', { written: state.written ?? '' }),
    });
  } else if (state.set && state.writtenClamped) {
    notes.push({
      key: 'clamped',
      text: t('provimux.restarts.drain_clamped', {
        written: state.written ?? '',
        used: state.writtenSeconds ?? state.seconds,
        min: state.min,
        max: state.max,
      }),
    });
  }
  if (fileKnown && state.writtenAccepted !== false && !drainFileInUse(state)) {
    notes.push({
      key: 'not-loaded',
      tone: 'warning',
      text: state.set
        ? t('provimux.restarts.drain_not_loaded', {
            written: state.written ?? '',
            count: state.waitsAtMost,
          })
        : t('provimux.restarts.drain_not_loaded_default', { count: state.waitsAtMost }),
    });
  }
  if (
    !state.set &&
    fileKnown &&
    state.shutdownTimeout > 0 &&
    state.default === state.shutdownTimeout
  ) {
    notes.push({
      key: 'follows',
      text: t('provimux.restarts.drain_default_follows', { seconds: state.shutdownTimeout }),
    });
  }
  if (state.waitsAtMost < state.seconds) {
    notes.push({
      key: 'limit',
      text: t('provimux.restarts.drain_stop_limit', {
        limit: state.stopLimit,
        count: state.waitsAtMost,
      }),
    });
  }

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`} data-on={on}>
      {head(
        <ToggleSwitch
          checked={on}
          onChange={(next) => (next ? toDefault() : setTo(0))}
          disabled={!canWrite}
          ariaLabel={t('provimux.restarts.drain_switch_label')}
          ariaDescribedBy={`${id}-cost`}
          labelPosition="left"
          label={
            <span className={shared.switchState}>
              {on ? t('provimux.restarts.on') : t('provimux.restarts.off')}
            </span>
          }
        />
      )}

      <div className={styles.valueRow}>
        <p className={styles.value} data-tone={on ? 'ok' : 'cut'}>
          {on
            ? t('provimux.restarts.drain_value', { count: state.waitsAtMost })
            : t('provimux.restarts.drain_value_off')}
        </p>
        {fileKnown ? <Provenance set={state.set} /> : null}
      </div>

      <p className={shared.featureText}>
        {on ? t('provimux.restarts.drain_on_text') : t('provimux.restarts.drain_off_text')}
      </p>
      {!state.set && fileKnown ? (
        <p className={shared.featureNote}>{t('provimux.restarts.drain_default_note')}</p>
      ) : null}

      {notes.map((note) => (
        <p key={note.key} className={styles.note} data-tone={note.tone}>
          {note.text}
        </p>
      ))}
      {state.set && state.writtenAccepted === false && state.writtenError ? (
        <p className={styles.detail}>
          <span>{t('provimux.restarts.detail_label')}</span> <code>{state.writtenError}</code>
        </p>
      ) : null}

      {on || state.writtenAccepted === false ? (
        <div className={styles.slider}>
          <div className={styles.sliderHead}>
            <label htmlFor={`${id}-slider`} className={styles.sliderLabel}>
              {t('provimux.restarts.slider_label')}
            </label>
            <output htmlFor={`${id}-slider`} className={styles.sliderValue} data-dirty={dirty}>
              {t('provimux.restarts.seconds_short', { seconds: shown })}
            </output>
          </div>
          <input
            id={`${id}-slider`}
            type="range"
            min={sliderMin}
            max={state.max}
            step={1}
            value={shown}
            disabled={!canWrite}
            aria-valuetext={t('provimux.restarts.drain_value', { count: shown })}
            style={{ '--fill': `${share(shown) * 100}%` } as CSSProperties}
            onChange={(event) => setDraft(Number(event.target.value))}
          />
          <div className={styles.scale} aria-hidden="true">
            {marks.map((mark) => (
              <span
                key={mark}
                style={at(mark)}
                data-edge={mark === sliderMin ? 'start' : mark === state.max ? 'end' : undefined}
              >
                {t('provimux.restarts.seconds_short', { seconds: mark })}
              </span>
            ))}
            <span className={styles.defaultMark} style={at(defaultMark)}>
              {t('provimux.restarts.slider_default_mark')}
            </span>
          </div>
        </div>
      ) : null}

      <p id={`${id}-cost`} className={styles.cost}>
        {dirty
          ? t('provimux.restarts.cost_wait', { count: Math.min(shown, state.stopLimit) })
          : on
            ? `${t('provimux.restarts.cost_wait', { count: state.waitsAtMost })} ${t('provimux.restarts.cost_turn_off')}`
            : t('provimux.restarts.cost_turn_on', { count: byDefault })}
      </p>

      {dirty || (on && state.set) ? (
        <div className={styles.actions}>
          {dirty ? (
            <>
              <Button size="sm" onClick={() => setTo(shown)} loading={busy} disabled={!canWrite}>
                {t('provimux.restarts.save_seconds', { count: shown })}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                {t('provimux.restarts.cancel')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={toDefault}
              disabled={!canWrite}
              title={t('provimux.restarts.use_default_hint')}
            >
              {t('provimux.restarts.use_default_seconds', { seconds: byDefault })}
            </Button>
          )}
        </div>
      ) : null}

      <CardStatus message={message} />

      <div className={styles.footnotes}>
        <p>{t('provimux.restarts.service_note')}</p>
      </div>
    </section>
  );
}

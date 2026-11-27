import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import shared from '../shared/Shared.module.scss';
import { restartsApi } from './restartsApi';
import {
  DRAIN_DEFAULT,
  DRAIN_MAX,
  DRAIN_SINCE,
  unbroken,
  upstreamWait,
  type DrainReading,
  type DrainSupport,
} from './restartsLogic';
import {
  CardStatus,
  Provenance,
  type CardMessage,
  type ConfigLoad,
  type Send,
  type Write,
} from './parts';
import styles from './RestartsPage.module.scss';

interface DrainCardProps {
  support: DrainSupport;
  config: ConfigLoad;
  reading: DrainReading | null;
  write: Write;
}

const SLIDER_MIN = 1;
/** Marks under the slider; the default gets its own. */
const MARKS = [1, 10, 20, 30];

const share = (seconds: number) => (seconds - SLIDER_MIN) / (DRAIN_MAX - SLIDER_MIN);
const percent = (seconds: number) => share(seconds) * 100;
/** A label under the slider, centred on the thumb's position for that value. */
const at = (seconds: number) =>
  ({ left: `${percent(seconds)}%`, '--at': share(seconds) }) as CSSProperties;

/**
 * `server.restart-drain-seconds`: the switch turns the wait off (0) or back to its default (the key removed); the
 * slider sets 1–30 seconds and is saved with its own button. A gateway that does not have the setting (by its
 * version) gets no control: the card says what its restart does instead (upstream's `shutdown-timeout`).
 */
export function DrainCard({ support, config, reading, write }: DrainCardProps) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<CardMessage | null>(null);

  // A fresh read replaces whatever was being edited only when it changed the value under it.
  const inUse = reading?.inUse ?? null;
  useEffect(() => {
    setDraft(null);
  }, [inUse]);

  const head = (control?: ReactNode) => (
    <div className={shared.featureHead}>
      <div className={shared.featureTitles}>
        <h2 id={`${id}-title`} className={styles.cardTitle}>
          {t('provimux.restarts.drain_title')}
        </h2>
        <p className={shared.featureEyebrow}>
          <code>server.restart-drain-seconds</code>
        </p>
      </div>
      {control ? <div className={shared.featureControl}>{control}</div> : null}
    </div>
  );

  if (config.kind === 'error' || !reading) {
    return (
      <section className={styles.card} aria-labelledby={`${id}-title`}>
        {head()}
        <p className={shared.featureError} role="alert">
          {t('provimux.restarts.read_failed', {
            message: config.kind === 'error' ? config.message : '',
          })}
        </p>
      </section>
    );
  }

  if (support.kind !== 'yes') {
    const now = upstreamWait(reading);
    return (
      <section className={styles.card} aria-labelledby={`${id}-title`} data-state="absent">
        {head()}
        <p className={styles.value} data-tone="muted">
          {support.kind === 'unknown'
            ? t('provimux.restarts.unknown')
            : t('provimux.restarts.not_in_gateway')}
        </p>
        <p className={shared.featureText}>
          {support.kind === 'older'
            ? t('provimux.restarts.drain_older', {
                version: unbroken(support.version),
                since: unbroken(DRAIN_SINCE.label),
              })
            : support.kind === 'other'
              ? t('provimux.restarts.drain_not_provimux', { version: unbroken(support.version) })
              : t('provimux.restarts.drain_unknown', { version: unbroken(support.version) })}
        </p>
        {support.kind !== 'unknown' ? (
          <p className={shared.featureText}>
            {now > 0
              ? t('provimux.restarts.drain_now_wait', { count: now })
              : t('provimux.restarts.drain_now_cut')}
          </p>
        ) : reading.set ? (
          <p className={shared.featureText}>
            {t('provimux.restarts.drain_file_says', { written: String(reading.written) })}
          </p>
        ) : null}
      </section>
    );
  }

  const on = !reading.unreadable && reading.inUse > 0;
  const shown = draft ?? (on ? reading.inUse : DRAIN_DEFAULT);
  const dirty =
    draft !== null && (draft !== reading.inUse || reading.clamped || reading.unreadable);
  const showSlider = on || reading.unreadable;

  const run = async (send: Send, done: CardMessage, afterwards?: () => void) => {
    setBusy(true);
    setMessage(null);
    const outcome = await write(send);
    setBusy(false);
    setMessage(outcome.ok ? done : outcome.message);
    if (outcome.ok) afterwards?.();
  };

  const toggle = (next: boolean) =>
    next
      ? run((read, client) => restartsApi.drainToDefault(read, client), {
          tone: 'ok',
          text: t('provimux.restarts.drain_saved_default'),
        })
      : run((read, client) => restartsApi.setDrain(read, 0, client), {
          tone: 'ok',
          text: t('provimux.restarts.drain_saved_off'),
        });

  const save = (seconds: number) =>
    run(
      (read, client) => restartsApi.setDrain(read, seconds, client),
      { tone: 'ok', text: t('provimux.restarts.drain_saved', { count: seconds }) },
      () => setDraft(null)
    );

  const toDefault = () =>
    run((read, client) => restartsApi.drainToDefault(read, client), {
      tone: 'ok',
      text: t('provimux.restarts.drain_saved_default'),
    });

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`} data-on={on}>
      {head(
        <ToggleSwitch
          checked={on}
          onChange={(next) => void toggle(next)}
          disabled={busy}
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
            ? t('provimux.restarts.drain_value', { count: reading.inUse })
            : t('provimux.restarts.drain_value_off')}
        </p>
        <Provenance set={reading.set} />
      </div>

      <p className={shared.featureText}>
        {on ? t('provimux.restarts.drain_on_text') : t('provimux.restarts.drain_off_text')}
      </p>

      {reading.unreadable ? (
        <p className={styles.note} data-tone="warning">
          {t('provimux.restarts.drain_unreadable', { written: JSON.stringify(reading.written) })}
        </p>
      ) : reading.clamped ? (
        <p className={styles.note} data-tone="warning">
          {t('provimux.restarts.drain_clamped', {
            written: String(reading.written),
            used: reading.inUse,
          })}
        </p>
      ) : !reading.set && reading.shutdownTimeout > DRAIN_DEFAULT ? (
        <p className={styles.note}>
          {t('provimux.restarts.drain_shutdown_larger', {
            seconds: reading.shutdownTimeout,
            used: reading.byDefault,
          })}
        </p>
      ) : null}

      {showSlider ? (
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
            min={SLIDER_MIN}
            max={DRAIN_MAX}
            step={1}
            value={Math.max(SLIDER_MIN, shown)}
            disabled={busy}
            aria-valuetext={t('provimux.restarts.drain_value', { count: shown })}
            style={{ '--fill': `${percent(Math.max(SLIDER_MIN, shown))}%` } as CSSProperties}
            onChange={(event) => setDraft(Number(event.target.value))}
          />
          <div className={styles.scale} aria-hidden="true">
            {MARKS.map((mark) => (
              <span
                key={mark}
                style={at(mark)}
                data-edge={mark === SLIDER_MIN ? 'start' : mark === DRAIN_MAX ? 'end' : undefined}
              >
                {t('provimux.restarts.seconds_short', { seconds: mark })}
              </span>
            ))}
            <span className={styles.defaultMark} style={at(DRAIN_DEFAULT)}>
              {t('provimux.restarts.slider_default_mark')}
            </span>
          </div>
        </div>
      ) : null}

      <p id={`${id}-cost`} className={styles.cost}>
        {on || dirty
          ? `${t('provimux.restarts.cost_wait', { count: shown })} ${t('provimux.restarts.cost_turn_off')}`
          : t('provimux.restarts.cost_turn_on', { count: reading.byDefault })}
      </p>

      {(dirty || (on && reading.set)) && !reading.unreadable ? (
        <div className={styles.actions}>
          {dirty ? (
            <>
              <Button size="sm" onClick={() => void save(shown)} loading={busy} disabled={busy}>
                {t('provimux.restarts.save_seconds', { count: shown })}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                {t('provimux.restarts.cancel')}
              </Button>
            </>
          ) : null}
          {on && reading.set && !dirty ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void toDefault()}
              disabled={busy}
              title={t('provimux.restarts.use_default_hint')}
            >
              {t('provimux.restarts.use_default_seconds', { seconds: reading.byDefault })}
            </Button>
          ) : null}
        </div>
      ) : reading.unreadable && dirty ? (
        <div className={styles.actions}>
          <Button size="sm" onClick={() => void save(shown)} loading={busy} disabled={busy}>
            {t('provimux.restarts.save_seconds', { count: shown })}
          </Button>
        </div>
      ) : null}

      <CardStatus message={message} />

      <div className={styles.footnotes}>
        <p>{t('provimux.restarts.service_note')}</p>
        <p>{t('provimux.restarts.not_waited')}</p>
      </div>
    </section>
  );
}

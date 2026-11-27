import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { formatClock, formatExact, timeMs } from '../pages/time';
import {
  PRESETS,
  draftMinutes,
  fieldValue,
  reachesTtl,
  returnMode,
  type ReturnState,
} from './sessionReturnLogic';
import { SESSION_RETURN_SETTING } from './sessionReturnApi';
import { reasonLink, reasonText, timeText } from './sessionReturnWords';
import { useSessionReturn } from './useSessionReturn';
import styles from './SessionReturn.module.scss';

const K = 'provimux.session_return';

interface SessionReturnProps {
  /** Changes whenever the Routing page has read the gateway again (after its own save too). */
  readAgainWhen?: unknown;
}

/**
 * "Back to the first account" (Provimux), in the Routing page's policy column under Session affinity, which it
 * depends on: `routing.session-affinity-return.cold-after`, as `GET /provimux/session-return` reports it. Closed, it
 * says what the gateway does now; "Set a time" or "Change" opens the field. It saves by itself, apart from the
 * page's own save bar: its buttons are its own. Nothing is drawn until the path answers, and nothing at all for a
 * gateway without it (404).
 */
export function ProvimuxSessionReturn({ readAgainWhen }: SessionReturnProps) {
  const { t } = useTranslation();
  const id = useId();
  const { snapshot, busy, message, load, save, turnOff } = useSessionReturn(readAgainWhen);

  if (snapshot.state.kind === 'loading' || snapshot.state.kind === 'absent') return null;

  if (snapshot.state.kind === 'error') {
    return (
      <section className={styles.block} aria-labelledby={`${id}-title`}>
        <div className={styles.head}>
          <h3 id={`${id}-title`} className={styles.title}>
            {t(`${K}.title`)}
          </h3>
        </div>
        <p className={styles.note} data-tone="warning" role="alert">
          {t(`${K}.read_failed`, { message: snapshot.state.message })}
        </p>
        <div className={styles.actions}>
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            {t(`${K}.read_again`)}
          </Button>
        </div>
      </section>
    );
  }

  const configError = snapshot.config.kind === 'error' ? snapshot.config.message : null;
  const writable = snapshot.config.kind === 'ready' && snapshot.config.etag !== null;
  return (
    <Ready
      id={id}
      state={snapshot.state.state}
      writable={writable}
      configError={configError}
      busy={busy}
      message={message}
      onSave={save}
      onTurnOff={turnOff}
    />
  );
}

interface ReadyProps {
  id: string;
  state: ReturnState;
  /** The configuration could be read: its tag makes a write conditional. */
  writable: boolean;
  configError: string | null;
  busy: boolean;
  message: { tone: 'ok' | 'error' | 'pending' | 'warning'; text: string } | null;
  onSave: (drawn: ReturnState, minutes: number) => Promise<boolean>;
  onTurnOff: (drawn: ReturnState) => Promise<boolean>;
}

/** The card for a gateway that reports the rule. Exported for the tests, which draw each state. */
export function Ready(props: ReadyProps) {
  const { id, state, writable, configError, busy, message, onSave, onTurnOff } = props;
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  // A fresh read that changed the time under the field replaces what was being typed.
  const inUse = state.coldAfterS;
  useEffect(() => {
    setDraft(null);
  }, [inUse]);

  const mode = returnMode(state);
  const time = state.coldAfterS !== null ? timeText(t, state.coldAfterS) : null;
  const shown = draft ?? fieldValue(state);
  const minutes = draftMinutes(shown);
  const dirty = draft !== null && draft.trim() !== fieldValue(state);
  const canWrite = writable && !busy;
  const link = reasonLink(state.reason);
  const since = timeMs(state.since);
  const last = timeMs(state.lastReturnedAt);

  const close = () => {
    setEditing(false);
    setDraft(null);
  };
  const submit = async () => {
    if (minutes === null || !dirty) return;
    if (await onSave(state, minutes)) close();
  };

  return (
    <section className={styles.block} aria-labelledby={`${id}-title`} data-mode={mode}>
      <div className={styles.head}>
        <h3 id={`${id}-title`} className={styles.title}>
          {t(`${K}.title`)}
        </h3>
        <span className={styles.pill} data-mode={mode}>
          <span className={styles.dot} aria-hidden="true" />
          {t(`${K}.state_${mode}`)}
        </span>
      </div>
      <p className={styles.lede}>{t(`${K}.lede`)}</p>

      {mode === 'on' && time ? (
        <p className={styles.now}>{t(`${K}.on_text`, { time })}</p>
      ) : mode === 'off' ? (
        <p className={styles.now}>{t(`${K}.off_text`)}</p>
      ) : null}
      {mode === 'blocked' || (mode === 'off' && state.reason && state.reason !== 'not-set') ? (
        <p className={styles.note} data-tone={mode === 'blocked' ? 'warning' : undefined}>
          {mode === 'blocked'
            ? reasonText(t, state)
            : t(`${K}.off_also`, { reason: reasonText(t, state) })}
          {link ? (
            <>
              {' '}
              <Link to={link} className={styles.link}>
                {t(link === '/config' ? `${K}.open_config` : `${K}.open_plugins`)}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {configError !== null ? (
        <p className={styles.note} data-tone="warning" role="alert">
          {t('provimux.restarts.config_failed', { message: configError })}
        </p>
      ) : null}

      {editing ? (
        <form
          className={styles.editor}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={`${id}-minutes`} className={styles.fieldLabel}>
            {t(`${K}.field_label`)}
          </label>
          <div className={styles.fieldRow}>
            <input
              id={`${id}-minutes`}
              className={styles.input}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={5}
              value={shown}
              disabled={!canWrite}
              aria-describedby={`${id}-hint`}
              aria-invalid={shown.trim() !== '' && minutes === null}
              // Opened by the operator's own click on "Set a time" or "Change".
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
            />
            <span className={styles.unit}>{t(`${K}.field_unit`)}</span>
          </div>
          <div className={styles.presets} role="group" aria-labelledby={`${id}-presets`}>
            <span id={`${id}-presets`} className={styles.presetsLabel}>
              {t(`${K}.presets_label`)}
            </span>
            {PRESETS.map((preset) => (
              <button
                key={preset.cache}
                type="button"
                className={styles.preset}
                aria-pressed={minutes === preset.minutes}
                disabled={!canWrite}
                onClick={() => setDraft(String(preset.minutes))}
              >
                <span>{t(`${K}.preset_${preset.cache}`)}</span>
                <span className={styles.presetValue}>{timeText(t, preset.minutes * 60)}</span>
              </button>
            ))}
          </div>
          <p id={`${id}-hint`} className={styles.hint}>
            {t(`${K}.choose_hint`)}
          </p>
          {shown.trim() !== '' && minutes === null ? (
            <p className={styles.note} data-tone="warning" role="alert">
              {t(`${K}.draft_invalid`)}
            </p>
          ) : reachesTtl(minutes, state) && state.ttlS !== null && minutes !== null ? (
            <p className={styles.note} data-tone="warning" role="status">
              {t(`${K}.ttl_warning`, {
                ttl: timeText(t, state.ttlS),
                time: timeText(t, minutes * 60),
              })}{' '}
              <Link to="/config" className={styles.link}>
                {t(`${K}.open_config`)}
              </Link>
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button
              size="sm"
              type="submit"
              loading={busy}
              disabled={!canWrite || !dirty || minutes === null}
            >
              {t(`${K}.save`)}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={close} disabled={busy}>
              {t(`${K}.cancel`)}
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing(true)}
            disabled={!canWrite}
          >
            {state.coldAfterS === null ? t(`${K}.set_time`) : t(`${K}.change`)}
          </Button>
          {state.coldAfterS !== null ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onTurnOff(state)}
              disabled={!canWrite}
              loading={busy}
            >
              {t(`${K}.turn_off`)}
            </Button>
          ) : null}
        </div>
      )}

      <p
        className={styles.status}
        data-tone={message?.tone}
        role={message?.tone === 'error' ? 'alert' : 'status'}
        aria-live={message?.tone === 'error' ? undefined : 'polite'}
        hidden={!message}
      >
        {message?.text ?? ''}
      </p>

      {state.inEffect || state.returned > 0 ? (
        <p className={styles.count}>
          {state.returned > 0 ? t(`${K}.returned`, { count: state.returned }) : t(`${K}.none_yet`)}
          {since !== null ? (
            <>
              {' '}
              <span title={formatExact(since, i18n.language)}>
                {t(`${K}.started`, { time: formatClock(since, i18n.language) })}
              </span>
            </>
          ) : null}
          {last !== null && state.returned > 0 ? (
            <>
              {' '}
              <span title={formatExact(last, i18n.language)}>
                {t(`${K}.last`, { time: formatClock(last, i18n.language) })}
              </span>
            </>
          ) : null}
        </p>
      ) : null}

      <details className={styles.details}>
        <summary>{t(`${K}.details_label`)}</summary>
        <ul>
          <li>{t(`${K}.details_when`)}</li>
          <li>{t(`${K}.details_promise`)}</li>
          <li>{t(`${K}.details_alone`)}</li>
          <li>{t(`${K}.details_first`)}</li>
          <li>{t(`${K}.details_count`)}</li>
        </ul>
        <p>
          {t(`${K}.details_setting`)} <code>{SESSION_RETURN_SETTING}</code>
        </p>
      </details>
    </section>
  );
}

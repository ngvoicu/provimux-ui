import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import type { CardMessage } from '../pages/restarts/restartsWords';
import { unbroken } from '../pages/restarts/restartsLogic';
import { saveTime, turnOff, type Drawn } from './sessionReturnActions';
import {
  PRESETS,
  RETURN_SINCE,
  draftMinutes,
  fieldValue,
  reachesTtl,
  returnMode,
  wholeMinutes,
  type ReturnLoad,
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
 * depends on: `routing.session-affinity-return.cold-after`, as `GET /provimux/session-return` reports it. It saves by
 * itself, apart from the page's own save bar: its buttons are its own. This component only wires: what is read and
 * changed is in useSessionReturn.ts and sessionReturnActions.ts, what is drawn in SessionReturnView.
 */
export function ProvimuxSessionReturn({ readAgainWhen }: SessionReturnProps) {
  const id = useId();
  const { card, busy, message, load, run, setDraft } = useSessionReturn(readAgainWhen);
  const { draft, snapshot } = card;
  const { state } = snapshot;
  // The buttons exist only on a card the gateway answered.
  const drawn = snapshot as Drawn;

  return (
    <SessionReturnView
      id={id}
      load={state}
      draft={draft}
      busy={busy}
      message={message}
      onRead={() => void load()}
      onDraft={setDraft}
      onOpen={() => setDraft(state.kind === 'ready' ? fieldValue(state.state) : '')}
      onSave={() => void run((io) => saveTime(draft ?? '', drawn, io))}
      onTurnOff={() => void run((io) => turnOff(drawn, io))}
    />
  );
}

interface ViewProps {
  id: string;
  load: ReturnLoad;
  /** The field's text while it is open; null while it is closed. */
  draft: string | null;
  busy: boolean;
  message: CardMessage | null;
  onRead: () => void;
  onOpen: () => void;
  onDraft: (draft: string | null) => void;
  onSave: () => void;
  onTurnOff: () => void;
}

/**
 * Everything the card can show, from what the gateway answered. Nothing until it answers; one line for a gateway
 * without the rule (404), naming the release it came with; closed, what the gateway reports; open, the field.
 */
export function SessionReturnView(props: ViewProps) {
  const { id, load, draft, busy, message, onRead, onOpen, onDraft, onSave, onTurnOff } = props;
  const { t } = useTranslation();

  if (load.kind === 'loading') return null;

  if (load.kind === 'absent') {
    return (
      <p className={styles.absent}>
        {t(`${K}.needs_version`, { version: unbroken(RETURN_SINCE) })}
      </p>
    );
  }

  if (load.kind === 'error') {
    return (
      <section className={styles.block} aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`} className={styles.title}>
          {t(`${K}.title`)}
        </h3>
        <p className={styles.note} data-tone="warning" role="alert">
          {t(`${K}.read_failed`, { message: load.message })}
        </p>
        <div className={styles.actions}>
          <Button size="sm" variant="secondary" onClick={onRead}>
            {t(`${K}.read_again`)}
          </Button>
        </div>
      </section>
    );
  }

  const { state } = load;
  const saved = state.coldAfterS;
  const mode = returnMode(state);
  const time = saved === null ? null : timeText(t, saved);
  const minutes = draft === null ? null : draftMinutes(draft);
  const link = reasonLink(state.reason);
  const off =
    saved === null ? null : (
      <Button size="sm" type="button" variant="ghost" onClick={onTurnOff} disabled={busy}>
        {t(`${K}.turn_off`)}
      </Button>
    );

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

      {state.inEffect ? <p className={styles.now}>{t(`${K}.on_text`, { time })}</p> : null}
      {time === null ? (
        <>
          <p className={styles.now}>{t(`${K}.off_text`)}</p>
          <p className={styles.lede}>{t(`${K}.lede`)}</p>
        </>
      ) : null}
      {time !== null && !state.inEffect ? (
        <>
          <p className={styles.now}>{t(`${K}.saved_time`, { time })}</p>
          <p className={styles.note} data-tone="warning">
            {reasonText(t, state)}
            {link ? (
              <>
                {' '}
                <Link to={link} className={styles.link}>
                  {t(link === '/config' ? `${K}.open_config` : `${K}.open_plugins`)}
                </Link>
              </>
            ) : null}
          </p>
        </>
      ) : null}

      {draft === null ? (
        <div className={styles.actions}>
          <Button size="sm" variant="secondary" onClick={onOpen} disabled={busy}>
            {saved === null ? t(`${K}.set_time`) : t(`${K}.change`)}
          </Button>
          {off}
        </div>
      ) : (
        <form
          className={styles.editor}
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
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
              value={draft}
              disabled={busy}
              aria-describedby={`${id}-hint`}
              aria-invalid={minutes === null && draft.trim() !== ''}
              // Opened by the operator's own click on "Set a time" or "Change".
              autoFocus
              onChange={(event) => onDraft(event.target.value)}
            />
            <span className={styles.unit}>{t(`${K}.field_unit`)}</span>
          </div>
          {minutes === null ? (
            <p className={styles.hint} role="status">
              {t(`${K}.field_help`)}
            </p>
          ) : null}
          {time !== null && !wholeMinutes(state) ? (
            <p className={styles.hint}>
              {t(`${K}.not_whole`, { time, minutes: fieldValue(state) })}
            </p>
          ) : null}
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
                disabled={busy}
                onClick={() => onDraft(String(preset.minutes))}
              >
                <span>{t(`${K}.preset_${preset.cache}`)}</span>
                <span className={styles.presetValue}>{timeText(t, preset.minutes * 60)}</span>
              </button>
            ))}
          </div>
          <p id={`${id}-hint`} className={styles.hint}>
            {t(`${K}.choose_hint`)}
          </p>
          {minutes !== null && state.ttlS !== null && reachesTtl(minutes, state) ? (
            <p className={styles.note} data-tone="warning" role="status">
              {t(`${K}.reason_not_below_ttl`, { ttl: timeText(t, state.ttlS) })}{' '}
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
              disabled={minutes === null || minutes * 60 === saved}
            >
              {t(`${K}.save`)}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => onDraft(null)}
              disabled={busy}
            >
              {t(`${K}.cancel`)}
            </Button>
            {off}
          </div>
        </form>
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
        <p className={styles.count}>{t(`${K}.attempts`, { n: state.returned })}</p>
      ) : null}

      <details className={styles.details}>
        <summary>{t(`${K}.details_label`)}</summary>
        <ul>
          <li>{t(`${K}.details_when`)}</li>
          <li>{t(`${K}.details_pinned`)}</li>
          <li>{t(`${K}.details_refused`)}</li>
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

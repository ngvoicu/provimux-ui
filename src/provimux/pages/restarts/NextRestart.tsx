import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  STEP_TONES,
  answersStep,
  conversationsStep,
  type ConfigLoad,
  type DrainLoad,
  type PersistLoad,
  type Tone,
} from './restartsLogic';
import styles from './RestartsPage.module.scss';

interface NextRestartProps {
  config: ConfigLoad;
  drain: DrainLoad;
  persist: PersistLoad;
}

const CONVERSATION_KEYS = {
  kept: 'step_back_kept',
  'in-use': 'step_back_in_use',
  'no-affinity': 'step_back_no_affinity',
  'not-kept': 'step_back_not_kept',
  unreported: 'step_back_unreported',
  unread: 'step_back_unread',
} as const;

/**
 * The page's answer first: the next restart in three steps, each saying only what the page could read. A step is
 * green only on the gateway's word; what it does not report, or what could not be read, is said as such, never green.
 */
export function NextRestart({ config, drain, persist }: NextRestartProps) {
  const { t } = useTranslation();
  const answers = answersStep(drain);
  const conversations = conversationsStep(persist, config);
  const waiting = drain.kind === 'loading' || persist.kind === 'loading';

  const answersText =
    answers.kind === 'wait'
      ? t('provimux.restarts.step_answers_wait', { count: answers.seconds })
      : answers.kind === 'cut'
        ? t('provimux.restarts.step_answers_cut')
        : answers.kind === 'unreported'
          ? t('provimux.restarts.step_answers_unreported')
          : drain.kind === 'loading'
            ? t('provimux.common.loading')
            : t('provimux.restarts.step_answers_unread');

  const steps: Array<{ key: string; title: string; text: string; tone: Tone; meter?: boolean }> = [
    {
      key: 'stop',
      title: t('provimux.restarts.step_stop'),
      text: t('provimux.restarts.step_stop_text'),
      tone: 'neutral',
    },
    {
      key: 'answers',
      title: t('provimux.restarts.step_answers'),
      text: answersText,
      tone: STEP_TONES[answers.kind],
      meter: drain.kind === 'ready',
    },
    {
      key: 'back',
      title: t('provimux.restarts.step_back'),
      text:
        persist.kind === 'loading'
          ? t('provimux.common.loading')
          : t(`provimux.restarts.${CONVERSATION_KEYS[conversations]}`),
      tone: STEP_TONES[conversations],
    },
  ];
  const wait = drain.kind === 'ready' ? drain.state.waitsAtMost : 0;
  const limit = drain.kind === 'ready' ? Math.max(drain.state.stopLimit, 1) : 1;

  return (
    <section className={styles.next} aria-labelledby="pmx-restarts-next" aria-busy={waiting}>
      <h2 id="pmx-restarts-next" className={styles.nextTitle}>
        {t('provimux.restarts.next_title')}
      </h2>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={step.key} className={styles.step} data-tone={step.tone}>
            <span className={styles.stepNode} aria-hidden="true">
              {index + 1}
            </span>
            <div className={styles.stepBody}>
              <div className={styles.stepHead}>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                {step.meter ? (
                  <span className={styles.stepValue}>
                    {wait > 0
                      ? t('provimux.restarts.seconds_short', { seconds: wait })
                      : t('provimux.restarts.off')}
                  </span>
                ) : null}
              </div>
              {step.meter ? (
                <span
                  className={styles.meter}
                  aria-hidden="true"
                  style={{ '--fill': `${(Math.min(wait, limit) / limit) * 100}%` } as CSSProperties}
                >
                  <span className={styles.meterFill} />
                </span>
              ) : null}
              <p className={styles.stepText}>{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

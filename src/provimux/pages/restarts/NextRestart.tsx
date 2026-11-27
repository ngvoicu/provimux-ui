import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { STOP_LIMIT, type ConversationsAfter } from './restartsLogic';
import styles from './RestartsPage.module.scss';

type Tone = 'neutral' | 'ok' | 'cut' | 'unknown';

interface NextRestartProps {
  /** Seconds the answers in flight get; 0 cuts them; null when the page cannot tell. */
  wait: number | null;
  conversations: ConversationsAfter;
}

/**
 * The page's answer first: the next restart in three steps, read from the settings in use. The middle step carries
 * the wait on a 0–30 s scale (the longest a stop takes), so a change of the wait shows here too.
 */
export function NextRestart({ wait, conversations }: NextRestartProps) {
  const { t } = useTranslation();

  const answers: { tone: Tone; text: string } =
    wait === null
      ? { tone: 'unknown', text: t('provimux.restarts.step_answers_unknown') }
      : wait > 0
        ? { tone: 'ok', text: t('provimux.restarts.step_answers_wait', { count: wait }) }
        : { tone: 'cut', text: t('provimux.restarts.step_answers_cut') };

  const back: { tone: Tone; text: string } = {
    back: { tone: 'ok' as Tone, text: t('provimux.restarts.step_back_kept') },
    afresh: { tone: 'cut' as Tone, text: t('provimux.restarts.step_back_afresh') },
    'not-kept': { tone: 'cut' as Tone, text: t('provimux.restarts.step_back_afresh') },
    'no-affinity': { tone: 'neutral' as Tone, text: t('provimux.restarts.step_back_no_affinity') },
    unknown: { tone: 'unknown' as Tone, text: t('provimux.restarts.step_back_unknown') },
  }[conversations];

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
      text: answers.text,
      tone: answers.tone,
      meter: wait !== null,
    },
    { key: 'back', title: t('provimux.restarts.step_back'), text: back.text, tone: back.tone },
  ];

  return (
    <section className={styles.next} aria-labelledby="pmx-restarts-next">
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
                {step.meter && wait !== null ? (
                  <span className={styles.stepValue}>
                    {wait > 0
                      ? t('provimux.restarts.seconds_short', { seconds: wait })
                      : t('provimux.restarts.off')}
                  </span>
                ) : null}
              </div>
              {step.meter && wait !== null ? (
                <span
                  className={styles.meter}
                  aria-hidden="true"
                  style={
                    {
                      '--fill': `${(Math.min(wait, STOP_LIMIT) / STOP_LIMIT) * 100}%`,
                    } as CSSProperties
                  }
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

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { Button } from '@/components/ui/Button';
import { IconAlertTriangle, IconCheck, IconInfo } from '@/components/ui/icons';
import { apiClient } from '@/services/api/client';
import type { ProvimuxModelRoutesResponse } from '../../api/types';
import { IconExcluded } from '../../components/ProvimuxIcons';
import { serviceLabel } from '../accounts/labels';
import { ServiceIcon } from '../accounts/ServiceIcon';
import { accountsAddressToAdd } from '../shared/accountsLink';
import {
  channelOf,
  placesToOffer,
  ruleProblem,
  servingAccounts,
  stillServedWithout,
  type Place,
} from './exclusions';
import { exclusionsApi } from './exclusionsApi';
import { placeDetail, placeInline, placeTitle } from './labels';
import type { ExclusionChange } from './writes';
import shared from '../shared/Shared.module.scss';
import styles from './Excluded.module.scss';

export interface ExclusionComposerProps {
  places: readonly Place[];
  routes: ProvimuxModelRoutesResponse | null;
  initialModel: string;
  /** The service the view is filtered to, chosen first; null: the first one. */
  initialService: string | null;
  locked: boolean;
  writing: boolean;
  onCancel: () => void;
  onSubmit: (change: ExclusionChange, words: { model: string; place: string }) => void;
}

/** Model names per channel, asked once per page (a failed ask leaves free text only). */
function useModelNames(channel: string | null): string[] {
  const [names, setNames] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!channel || names[channel]) return;
    const revision = apiClient.getConnectionRevision();
    let live = true;
    exclusionsApi
      .modelNames(channel)
      .then((found) => {
        if (live && revision === apiClient.getConnectionRevision()) {
          setNames((prev) => ({ ...prev, [channel]: found }));
        }
      })
      .catch(() => {
        if (live) setNames((prev) => ({ ...prev, [channel]: [] }));
      });
    return () => {
      live = false;
    };
  }, [channel, names]);
  return channel ? (names[channel] ?? []) : [];
}

/**
 * "Exclude a model": the model (picked from the service's model list or typed, a pattern allowed), then where,
 * one account or every subscription of a service, and what it will mean before it is written.
 */
export function ExclusionComposer(props: ExclusionComposerProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const offered = useMemo(() => placesToOffer(props.places), [props.places]);
  const services = useMemo(() => [...new Set(offered.map((place) => place.service))], [offered]);
  const [service, setService] = useState<string | null>(() =>
    props.initialService && services.includes(props.initialService)
      ? props.initialService
      : (services[0] ?? null)
  );
  const inService = offered.filter((place) => place.service === service);
  const [placeId, setPlaceId] = useState<string | null>(() => inService[0]?.id ?? null);
  const place = inService.find((candidate) => candidate.id === placeId) ?? inService[0] ?? null;
  const [model, setModel] = useState(props.initialModel);

  const listed = useModelNames(place ? channelOf(place) : null);
  const options = useMemo(() => {
    const served = (props.routes?.models ?? []).map((entry) => entry.id);
    return [...new Set([...listed, ...served])].sort((a, b) => a.localeCompare(b));
  }, [listed, props.routes]);

  const text = model.trim();
  const problem = text ? ruleProblem(place, text) : null;
  const others = place && text && !problem ? stillServedWithout(place, text, props.routes) : null;
  const ready = place !== null && text !== '' && problem === null && !props.locked;

  const problemText = problem
    ? problem.problem === 'covered'
      ? t('provimux.excluded.composer.problem_covered', { pattern: problem.pattern })
      : problem.problem === 'empty'
        ? null
        : t(`provimux.excluded.composer.problem_${problem.problem}`)
    : null;

  const choose = (next: string) => {
    setService(next);
    setPlaceId(offered.find((candidate) => candidate.service === next)?.id ?? null);
  };

  const submit = () => {
    if (!ready || !place) return;
    props.onSubmit(
      { place, rule: text, excluded: true },
      { model: text, place: placeInline(t, place) }
    );
  };

  return (
    <section className={styles.composer} aria-labelledby={titleId}>
      <header className={styles.composerHead}>
        <span className={styles.modelIcon} aria-hidden="true">
          <IconExcluded size={15} />
        </span>
        <h3 id={titleId} className={styles.composerTitle}>
          {t('provimux.excluded.composer.title')}
        </h3>
      </header>

      {offered.length === 0 ? (
        <p className={shared.note}>
          <IconInfo size={13} />
          <span>
            {t('provimux.excluded.composer.no_places')}{' '}
            <Link to={accountsAddressToAdd()} className={styles.inlineLink}>
              {t('provimux.excluded.composer.no_places_link')}
            </Link>
          </span>
        </p>
      ) : (
        <form
          className={styles.composerBody}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className={styles.field}>
            <AutocompleteInput
              id={`${titleId}-model`}
              label={t('provimux.excluded.composer.model')}
              value={model}
              onChange={setModel}
              options={options}
              placeholder={t('provimux.excluded.composer.model_placeholder')}
              hint={t('provimux.excluded.composer.model_hint')}
              disabled={props.locked}
              wrapperClassName={styles.modelField}
            />
          </div>

          <fieldset className={styles.where} disabled={props.locked}>
            <legend className={styles.label}>{t('provimux.excluded.composer.where')}</legend>
            {services.length > 1 ? (
              <div
                className={`${shared.segmented} ${styles.services}`}
                role="group"
                aria-label={t('provimux.excluded.service_label')}
              >
                {services.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    aria-pressed={candidate === service}
                    onClick={() => choose(candidate)}
                  >
                    {serviceLabel(t, candidate)}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={styles.choices}>
              {inService.map((candidate) => {
                const has = text !== '' && ruleProblem(candidate, text)?.problem === 'exists';
                return (
                  <label
                    key={candidate.id}
                    className={styles.choice}
                    data-checked={candidate.id === place?.id || undefined}
                  >
                    <input
                      type="radio"
                      name={`${titleId}-place`}
                      checked={candidate.id === place?.id}
                      onChange={() => setPlaceId(candidate.id)}
                    />
                    <ServiceIcon
                      service={candidate.service}
                      provider={
                        candidate.kind === 'logins' ? candidate.type : candidate.entry.family
                      }
                    />
                    <span className={styles.placeText}>
                      <span className={styles.placeTitle}>{placeTitle(t, candidate)}</span>
                      <span className={styles.placeDetail}>
                        {candidate.kind === 'logins'
                          ? t('provimux.excluded.composer.logins_hint', {
                              detail: placeDetail(t, candidate),
                            })
                          : placeDetail(t, candidate)}
                      </span>
                    </span>
                    {has ? (
                      <span className={styles.already}>
                        <IconCheck size={12} />
                        {t('provimux.excluded.composer.already')}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {problemText ? (
            <p className={styles.problem} role="alert">
              <IconAlertTriangle size={13} />
              <span>{problemText}</span>
            </p>
          ) : place && text ? (
            <p className={styles.preview} data-nowhere={others?.length === 0 || undefined}>
              <IconInfo size={13} />
              <span>
                {t('provimux.excluded.composer.preview', {
                  model: text,
                  place: placeInline(t, place),
                })}{' '}
                {others === null
                  ? null
                  : others.length === 0
                    ? t('provimux.excluded.composer.preview_nowhere')
                    : t('provimux.excluded.composer.preview_still', {
                        count: servingAccounts(others),
                      })}
              </span>
            </p>
          ) : null}

          <div className={styles.composerActions}>
            <Button type="button" variant="secondary" size="sm" onClick={props.onCancel}>
              {t('provimux.excluded.composer.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={!ready} loading={props.writing}>
              {t('provimux.excluded.composer.submit')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

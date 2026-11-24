import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MODELS_PATH } from '../pages/models/address';
import { IconModelRoutes } from './ProvimuxIcons';

/**
 * The System page's "Available models" card, upstream's, is hidden by the theme (theme/_system.scss): the Models
 * page lists every model, with its routes, names and exclusions, and its "Refresh lists now" (or, with live lists
 * off, "Sync model catalog") sends the catalog update the card's button sent. In its place, one line linking to
 * Models.
 *
 * SystemPage.tsx is not edited: this renders from Provimux's seam in its Quick links card (ProvimuxLinks), and puts
 * the line right after the hidden card, in the page's own column of cards, through a portal. When the page no
 * longer has that card (upstream changed it), nothing is placed and the theme hides nothing.
 */

/** The page's column of cards, and the card the theme hides (its header holds `.modelsActions`). */
export const SYSTEM_CONTENT_SELECTOR = "[class*='SystemPage-module__content___']";
export const SYSTEM_MODELS_CARD_SELECTOR =
  ".card:has([class*='SystemPage-module__modelsActions___'])";

export function ProvimuxSystemModels() {
  // The line's own element, placed right after the hidden card when this seam is attached (the page's cards are
  // all in the document by then), removed when it is detached. Never on the server: no ref is attached there.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const place = useCallback((anchor: HTMLSpanElement | null) => {
    if (!anchor) return;
    const card = anchor
      .closest(SYSTEM_CONTENT_SELECTOR)
      ?.querySelector(`:scope > ${SYSTEM_MODELS_CARD_SELECTOR}`);
    if (!card) return;
    const element = document.createElement('div');
    element.className = 'pmx-system-models';
    card.after(element);
    setHost(element);
    return () => {
      element.remove();
      setHost(null);
    };
  }, []);

  return (
    <>
      <span ref={place} hidden />
      {host ? createPortal(<ModelsLine />, host) : null}
    </>
  );
}

function ModelsLine() {
  const { t } = useTranslation();
  return (
    <p className="pmx-system-models-line">
      <span className="pmx-system-models-icon" aria-hidden="true">
        <IconModelRoutes size={16} />
      </span>
      <span>
        {t('provimux.system.models_line')}{' '}
        <Link to={MODELS_PATH} className="pmx-system-models-link">
          {t('provimux.system.models_link')}
        </Link>
      </span>
    </p>
  );
}

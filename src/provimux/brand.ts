/**
 * Provimux brand: the name, the signature, the links and the logo, in one place.
 *
 * The logo is the Provimux mark "One key" on the providers.dev indigo tile, drawn on the same 32-unit grid as
 * providers.dev's own mark (4-unit strokes on even coordinates, so edges fall on whole pixels at 16 and 32 px).
 * Source of truth: providers.dev/brand/provimux/final/mark.svg.
 */

export const PROVIMUX_BRAND = {
  name: 'Provimux',
  /** Said everywhere after the name, in English in every language. */
  tagline: 'by providers.dev',
  /** Name and signature together, for titles, tooltips and alt text. */
  fullName: 'Provimux by providers.dev',
  /** The browser tab. */
  pageTitle: 'Provimux by providers.dev',
  /** The login page's hero line (English in every language, as upstream's). */
  heroTitle: 'Welcome to Provimux.',
} as const;

export const PROVIMUX_LINKS = {
  provimux: 'https://github.com/ngvoicu/provimux',
  console: 'https://github.com/ngvoicu/provimux-ui',
  providersDev: 'https://providers.dev',
  /** What Provimux and this console are built on. */
  cliProxyApi: 'https://github.com/router-for-me/CLIProxyAPI',
  originalConsole: 'https://github.com/router-for-me/Cli-Proxy-API-Management-Center',
} as const;

/** The mark on its indigo tile (32 x 32, corner radius 7): favicon, sidebar, login and System page. */
export const PROVIMUX_TILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<defs><linearGradient id="pmx-f" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#3730a3"/>' +
  '</linearGradient></defs>' +
  '<rect width="32" height="32" rx="7" fill="url(#pmx-f)"/>' +
  '<g fill="none" stroke="#ffffff" stroke-width="4"><circle cx="18" cy="12" r="6"/><path d="M12 12v16"/></g>' +
  '<path fill="#ffffff" d="M12 22h6v2h-6zM12 26h8v2h-8z"/>' +
  '<circle cx="18" cy="12" r="1.9" fill="#c7d2fe"/>' +
  '</svg>';

export const svgDataUri = (svg: string): string =>
  `data:image/svg+xml,${encodeURIComponent(svg)}`;

export const PROVIMUX_TILE = svgDataUri(PROVIMUX_TILE_SVG);
export const PROVIMUX_TILE_TYPE = 'image/svg+xml';

/**
 * Upstream's name for its logo, so the places that show it (favicon, sidebar, login, System page) stay untouched:
 * their import line points here instead of `@/assets/logoInline`. It is an SVG, not a JPEG.
 */
export const INLINE_LOGO_JPEG = PROVIMUX_TILE;

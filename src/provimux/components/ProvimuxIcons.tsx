import type { SVGProps } from 'react';

/** Sidebar icons for Provimux's pages, drawn like upstream's Lucide set (24 grid, 2 px round strokes). */

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

const base: SVGProps<SVGSVGElement> = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

/** A model branching to its routes, one above the other: model routes. */
export function IconModelRoutes({ size = 20, ...props }: IconProps) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <circle cx="5" cy="12" r="2.5" />
      <path d="M7.5 12H10" />
      <path d="M10 5.5v13" />
      <path d="M10 5.5h4" />
      <path d="M10 12h4" />
      <path d="M10 18.5h4" />
      <circle cx="17.5" cy="5.5" r="1.5" />
      <circle cx="17.5" cy="12" r="1.5" />
      <circle cx="17.5" cy="18.5" r="1.5" />
    </svg>
  );
}

/** A list with a broadcast mark: a list that comes live from the provider. */
export function IconLiveLists({ size = 20, ...props }: IconProps) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M3 6h11" />
      <path d="M3 12h7" />
      <path d="M3 18h7" />
      <circle cx="18" cy="17" r="1.25" />
      <path d="M15.5 14.3a3.6 3.6 0 0 1 5 0" />
      <path d="M13.3 11.9a6.8 6.8 0 0 1 9.4 0" />
    </svg>
  );
}

/** A coin over a cache layer: what the cache kept from being paid again. */
export function IconSavings({ size = 20, ...props }: IconProps) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <circle cx="12" cy="9" r="6" />
      <path d="M14 7h-3a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3h-3" />
      <path d="M12 5.5v1.5" />
      <path d="M12 13v1.5" />
      <path d="M4 19h16" />
      <path d="M7 22h10" />
    </svg>
  );
}

/** A name tag leading to a model: the names clients send, and what they stand for. */
export function IconAliases({ size = 20, ...props }: IconProps) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M3 4.5h11l3 3-3 3H3z" />
      <path d="M7 10.5v5a2.5 2.5 0 0 0 2.5 2.5H20" />
      <path d="M17 15l3 3-3 3" />
    </svg>
  );
}

/** A person with a key beside them: the owner's accounts, signed in or by key. */
export function IconAccounts({ size = 20, ...props }: IconProps) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 11.4-4.3" />
      <circle cx="17.5" cy="14.5" r="2.5" />
      <path d="M17.5 17v4" />
      <path d="M17.5 19.5h2" />
    </svg>
  );
}

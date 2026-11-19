import { useId } from 'react';

/** The Provimux tile as inline SVG (the same drawing as PROVIMUX_TILE_SVG), for places that hold an icon. */
export function ProvimuxTileIcon({ size = 36 }: { size?: number }) {
  const gradient = `pmx-tile-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#3730a3" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill={`url(#${gradient})`} />
      <g fill="none" stroke="#ffffff" strokeWidth="4">
        <circle cx="18" cy="12" r="6" />
        <path d="M12 12v16" />
      </g>
      <path fill="#ffffff" d="M12 22h6v2h-6zM12 26h8v2h-8z" />
      <circle cx="18" cy="12" r="1.9" fill="#c7d2fe" />
    </svg>
  );
}

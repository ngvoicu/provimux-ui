import { useId, useMemo } from 'react';
import { VIEW_HEIGHT, VIEW_WIDTH, trendGeometry } from './trend';

interface SavingsTrendProps {
  /** One value per day, oldest first; null for a day that cannot be valued. */
  values: ReadonlyArray<number | null>;
  color?: string;
  ariaLabel: string;
  className?: string;
}

/** The headline's trend: a line per day like the dashboard sparkline, with a gap for a day not valued. */
export function SavingsTrend({ values, color, ariaLabel, className }: SavingsTrendProps) {
  const gradientId = useId();
  const geometry = useMemo(() => trendGeometry(values), [values]);
  if (!geometry) return null;
  const stroke = geometry.isFlat ? 'var(--text-quaternary)' : (color ?? 'var(--primary-color)');
  return (
    <svg
      className={className}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      data-gaps={values.some((value) => value === null) ? 'true' : undefined}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {geometry.segments.map((segment, index) => (
        <g key={index} data-segment="">
          {!geometry.isFlat && <path d={segment.area} fill={`url(#${gradientId})`} stroke="none" />}
          <path
            d={segment.line}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
      {geometry.dots.map((dot) => (
        // A zero-length path with a round cap stays a round dot under preserveAspectRatio="none".
        <path
          key={dot.x}
          data-dot=""
          d={`M${dot.x.toFixed(2)} ${dot.y.toFixed(2)} h0`}
          fill="none"
          stroke={stroke}
          strokeWidth={4}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

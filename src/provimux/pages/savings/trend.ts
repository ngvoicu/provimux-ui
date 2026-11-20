import { buildSmoothLinePath, type CurvePoint } from '@/features/dashboard/components/curve';

export const VIEW_WIDTH = 100;
export const VIEW_HEIGHT = 32;
/** Room above the highest point, so a peak is not cut by the top edge. */
const TOP_PADDING = 3;

/** Room below the zero line when some values are negative, so the lowest point is not cut by the bottom edge. */
const BOTTOM_PADDING = 3;

export interface TrendGeometry {
  /** One smooth line (and its area, filled to the zero line) per run of consecutive days with a value. */
  segments: Array<{ line: string; area: string }>;
  /** A day with a value between two days without one: a dot, since a line needs two points. */
  dots: CurvePoint[];
  /** The y of $0 in the view box: the bottom edge when no value is negative. */
  zeroY: number;
  /** Some value is negative: the zero line is drawn, and the scale reaches below it. */
  signed: boolean;
  isFlat: boolean;
}

/**
 * The trend's geometry, with gaps: a null value is a day that cannot be valued, so it gets no point, and the
 * line stops before it and starts again after it. Every day keeps its place on the x axis. Review T-121,
 * finding 4.
 *
 * The scale runs from the lower of 0 and the lowest value to the higher of 0 and the highest, so a negative day
 * is drawn below the zero line and every point stays inside the view box (the curve's control points too).
 * Without a negative value it is the dashboard sparkline's scale, and the same line. Review T-124, finding 4.
 * Null when no day has a value.
 */
export function trendGeometry(values: ReadonlyArray<number | null>): TrendGeometry | null {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (known.length === 0) return null;
  const high = Math.max(0, ...known);
  const low = Math.min(0, ...known);
  const signed = low < 0;
  const top = TOP_PADDING;
  const bottom = VIEW_HEIGHT - (signed ? BOTTOM_PADDING : 0);
  const span = high - low;
  const yOf = (value: number) =>
    span > 0 ? top + ((high - value) / span) * (bottom - top) : bottom;
  const zeroY = yOf(0);
  const stepX = values.length > 1 ? VIEW_WIDTH / (values.length - 1) : 0;
  const runs: CurvePoint[][] = [];
  let run: CurvePoint[] = [];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    const x = values.length > 1 ? index * stepX : VIEW_WIDTH / 2;
    run.push({ x, y: yOf(value) });
  });
  if (run.length > 0) runs.push(run);
  const segments: TrendGeometry['segments'] = [];
  const dots: CurvePoint[] = [];
  for (const points of runs) {
    if (points.length === 1) {
      dots.push(points[0]);
      continue;
    }
    const line = buildSmoothLinePath(points, top, bottom);
    const first = points[0];
    const last = points[points.length - 1];
    const zero = zeroY.toFixed(2).replace(/\.00$/, '');
    const area = `${line} L${last.x.toFixed(2)} ${zero} L${first.x.toFixed(2)} ${zero} Z`;
    segments.push({ line, area });
  }
  return { segments, dots, zeroY, signed, isFlat: span <= 0 };
}

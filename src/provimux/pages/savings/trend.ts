import { buildSmoothLinePath, type CurvePoint } from '@/features/dashboard/components/curve';

export const VIEW_WIDTH = 100;
export const VIEW_HEIGHT = 32;
/** Room above the highest point, so a peak is not cut by the top edge. */
const TOP_PADDING = 3;

export interface TrendGeometry {
  /** One smooth line (and its area) per run of consecutive days with a value. */
  segments: Array<{ line: string; area: string }>;
  /** A day with a value between two days without one: a dot, since a line needs two points. */
  dots: CurvePoint[];
  isFlat: boolean;
}

/**
 * The dashboard sparkline's geometry (same view box, scale and curve), with gaps: a null value is a day that
 * cannot be valued, so it gets no point, and the line stops before it and starts again after it. Every day
 * keeps its place on the x axis. Null when no day has a value. Review T-121, finding 4.
 */
export function trendGeometry(values: ReadonlyArray<number | null>): TrendGeometry | null {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (known.length === 0) return null;
  const max = Math.max(...known);
  const usableHeight = VIEW_HEIGHT - TOP_PADDING;
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
    const ratio = max > 0 ? value / max : 0;
    run.push({ x, y: VIEW_HEIGHT - ratio * usableHeight });
  });
  if (run.length > 0) runs.push(run);
  const segments: TrendGeometry['segments'] = [];
  const dots: CurvePoint[] = [];
  for (const points of runs) {
    if (points.length === 1) {
      dots.push(points[0]);
      continue;
    }
    const line = buildSmoothLinePath(points, TOP_PADDING, VIEW_HEIGHT);
    const first = points[0];
    const last = points[points.length - 1];
    const area = `${line} L${last.x.toFixed(2)} ${VIEW_HEIGHT} L${first.x.toFixed(2)} ${VIEW_HEIGHT} Z`;
    segments.push({ line, area });
  }
  return { segments, dots, isFlat: max <= 0 };
}

import { linePath, linear, extent, type Point } from './scale.js';

const FULL = 100;

export function Sparkline({ points, label }: { points: readonly Point[]; label: string }) {
  if (points.length < 2) return null;
  const { t, v } = extent([{ label, points }]);
  const d = linePath(points, linear(t, [0, FULL]), linear([v[0], v[1] > v[0] ? v[1] : v[0] + 1], [FULL, 0]));
  return <svg className="sparkline" role="img" aria-label={label} viewBox="0 0 100 100" preserveAspectRatio="none"><path d={d} fill="none" stroke="var(--chart-1)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

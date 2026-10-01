export type Point = readonly [number, number];
export interface ChartSeries { label: string; points: readonly Point[] }
export type ChartRange = '1h' | '24h' | '7d' | '30d';
export interface Layer { label: string; values: readonly number[]; bases: readonly number[] }

const MIDDLE = 0.5;
const finite = (value: number): boolean => Number.isFinite(value);

export function extent(series: readonly ChartSeries[]): { t: readonly [number, number]; v: readonly [number, number] } {
  const points = series.flatMap((line) => line.points.filter(([t, v]) => finite(t) && finite(v)));
  if (points.length === 0) return { t: [0, 1], v: [0, 1] };
  const times = points.map(([t]) => t);
  const values = points.map(([, v]) => v);
  const low = Math.min(...values);
  return { t: [Math.min(...times), Math.max(...times)], v: [Math.min(low, 0), Math.max(...values)] };
}

export function niceTicks(min: number, max: number, count: number): number[] {
  if (!finite(min) || !finite(max) || count < 1) return [];
  if (min === max) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((factor) => factor * magnitude >= raw) ?? 10) * magnitude;
  const first = Math.floor(min / step);
  const last = Math.ceil(max / step);
  return Array.from({ length: last - first + 1 }, (_unused, index) => Number(((first + index) * step).toPrecision(12)));
}

export function linear(domain: readonly [number, number], range: readonly [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d0 === d1) return () => r0 + (r1 - r0) * MIDDLE;
  return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
}

type Mapper = (value: number) => number;
const usable = (points: readonly Point[]): Point[] => points.filter(([t, v]) => finite(t) && finite(v));
const coordinate = (x: Mapper, y: Mapper, [t, v]: Point): string => `${x(t).toFixed(2)},${y(v).toFixed(2)}`;

export function linePath(points: readonly Point[], x: Mapper, y: Mapper): string {
  return usable(points).map((point, index) => `${index === 0 ? 'M' : 'L'} ${coordinate(x, y, point)}`).join(' ');
}

export function areaPath(points: readonly Point[], x: Mapper, y: Mapper, baseline: number): string {
  const kept = usable(points);
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (first === undefined || last === undefined) return '';
  return `${linePath(kept, x, y)} L ${x(last[0]).toFixed(2)},${baseline.toFixed(2)} L ${x(first[0]).toFixed(2)},${baseline.toFixed(2)} Z`;
}

export function nearestIndex(times: readonly number[], t: number): number {
  if (times.length === 0) return -1;
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((times[mid] ?? 0) < t) low = mid + 1; else high = mid;
  }
  const before = times[low - 1];
  const here = times[low] ?? 0;
  return before !== undefined && t - before <= here - t ? low - 1 : low;
}

export function bucketTimes(series: readonly ChartSeries[]): number[] {
  return [...new Set(series.flatMap((line) => usable(line.points).map(([t]) => t)))].sort((a, b) => a - b);
}

export function valuesAt(series: readonly ChartSeries[], times: readonly number[]): (number | undefined)[][] {
  return series.map((line) => { const byTime = new Map(usable(line.points)); return times.map((t) => byTime.get(t)); });
}

export function stack(series: readonly ChartSeries[]): { times: number[]; layers: Layer[]; max: number } {
  const times = bucketTimes(series);
  const grid = valuesAt(series, times);
  const totals = new Array<number>(times.length).fill(0);
  const layers = series.map((line, row) => {
    const values = times.map((_t, column) => Math.max(0, grid[row]?.[column] ?? 0));
    const bases = totals.slice();
    values.forEach((value, column) => { totals[column] = (totals[column] ?? 0) + value; });
    return { label: line.label, values, bases };
  });
  return { times, layers, max: Math.max(0, ...totals) };
}

const clock = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false });
const day = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const full = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export const formatTick = (t: number, range: ChartRange): string => !finite(t) ? '' : (range === '1h' || range === '24h' ? clock : day).format(t);
export const formatMoment = (t: number): string => finite(t) ? full.format(t) : '';

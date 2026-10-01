import { useState, type KeyboardEvent } from 'react';
import { formatValue, type Unit } from '../governance/governance-model.js';
import { formatMoment, type ChartSeries } from './scale.js';

export const PALETTE_SIZE = 6;
const DASHES = ['none', '6 3', '2 3', '8 3 2 3', '1 3', '10 4'] as const;
const MAX_TABLE_SERIES = 6;

export const colorOf = (index: number): string => `var(--chart-${String((index % PALETTE_SIZE) + 1)})`;
export const dashOf = (index: number): string => DASHES[index % DASHES.length] ?? 'none';

export function useCursor(count: number) {
  const [active, setActive] = useState<number>();
  const clamp = (index: number): number => Math.max(0, Math.min(count - 1, index));
  const onKeyDown = (event: KeyboardEvent): void => {
    if (count === 0) return;
    const current = active ?? count - 1;
    const next = event.key === 'ArrowLeft' ? current - 1 : event.key === 'ArrowRight' ? current + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(clamp(next));
  };
  return { active: active === undefined || active >= count ? undefined : active, set: (index: number | undefined) => setActive(index === undefined ? undefined : clamp(index)), onKeyDown, onFocus: () => setActive((current) => current ?? (count > 0 ? count - 1 : undefined)), onBlur: () => setActive(undefined) };
}

export function Legend({ series, swatch }: { series: readonly { label: string }[]; swatch: 'line' | 'box' }) {
  return (
    <ul className="chart-legend">
      {series.map((line, index) => (
        <li key={line.label}>
          <svg width="22" height="10" aria-hidden="true">{swatch === 'line' ? <line x1="0" y1="5" x2="22" y2="5" stroke={colorOf(index)} strokeWidth="2.5" strokeDasharray={dashOf(index)} /> : <rect x="0" y="1" width="12" height="8" rx="2" fill={colorOf(index)} />}</svg>
          {line.label}
        </li>
      ))}
    </ul>
  );
}

export function DataTable({ title, unit, times, columns }: { title: string; unit: Unit; times: readonly number[]; columns: readonly { label: string; values: readonly (number | undefined)[] }[] }) {
  const shown = columns.slice(0, MAX_TABLE_SERIES);
  return (
    <div className="visually-hidden"><table>
      <caption>{title}{columns.length > shown.length ? ` (first ${String(shown.length)} of ${String(columns.length)} series)` : ''}</caption>
      <thead><tr><th scope="col">Time</th>{shown.map((column) => <th key={column.label} scope="col">{column.label}</th>)}</tr></thead>
      <tbody>{times.map((time, row) => <tr key={time}><th scope="row">{formatMoment(time)}</th>{shown.map((column) => <td key={column.label}>{formatValue(unit, column.values[row])}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

export function Tooltip({ moment, left, rows, unit }: { moment: number; left: number; rows: readonly { label: string; value: number | undefined; index: number }[]; unit: Unit }) {
  return (
    <div className="chart-tooltip" aria-live="polite" style={{ left: `${String(left)}%` }} data-flip={left > 60 || undefined}>
      <strong>{formatMoment(moment)}</strong>
      {rows.map((row) => <span key={row.label}><i style={{ background: colorOf(row.index) }} />{row.label}: {formatValue(unit, row.value)}</span>)}
    </div>
  );
}

export const seriesOf = (series: readonly ChartSeries[]): readonly ChartSeries[] => series.filter((line) => line.points.length > 0);

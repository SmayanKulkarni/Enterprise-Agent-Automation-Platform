import { useMemo, useRef, type PointerEvent } from 'react';
import { gsap, motionAllowed, useGSAP } from '../motion.js';
import { formatValue, type Unit } from '../governance/governance-model.js';
import { DataTable, Legend, Tooltip, colorOf, dashOf, seriesOf, useCursor } from './chart-parts.js';
import { areaPath, bucketTimes, extent, formatTick, linePath, linear, nearestIndex, niceTicks, valuesAt, type ChartRange, type ChartSeries } from './scale.js';

const TICK_COUNT = 4;
const X_LABELS = 4;
const WIPE_SECONDS = 0.8;
const FULL = 100;

interface Props { title: string; series: readonly ChartSeries[]; unit: Unit; range: ChartRange; area?: boolean }

export function TimeSeriesChart({ title, series: input, unit, range, area = false }: Props) {
  const series = useMemo(() => seriesOf(input), [input]);
  const plot = useRef<HTMLDivElement>(null);
  const times = useMemo(() => bucketTimes(series), [series]);
  const grid = useMemo(() => valuesAt(series, times), [series, times]);
  const cursor = useCursor(times.length);
  const { t, v } = useMemo(() => extent(series), [series]);
  const ticks = niceTicks(v[0], v[1], TICK_COUNT);
  const low = ticks[0] ?? 0;
  const high = ticks[ticks.length - 1] ?? 1;
  const x = linear(t, [0, FULL]);
  const y = linear([low, high > low ? high : low + 1], [FULL, 0]);
  const xLabels = Array.from({ length: X_LABELS }, (_unused, index) => t[0] + ((t[1] - t[0]) * index) / (X_LABELS - 1));

  useGSAP(() => {
    const element = plot.current?.querySelector('svg');
    if (!element || !motionAllowed()) return;
    gsap.fromTo(element, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: WIPE_SECONDS, ease: 'power2.out', clearProps: 'clipPath' });
  }, { dependencies: [series], scope: plot });

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const fraction = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    cursor.set(nearestIndex(times, t[0] + fraction * (t[1] - t[0])));
  };
  const moment = cursor.active === undefined ? undefined : times[cursor.active];
  const crossX = moment === undefined ? 0 : x(moment);

  return (
    <figure className="chart">
      <div className="chart-body" tabIndex={0} role="group" aria-label={`${title}. Use the left and right arrow keys to read values.`} onKeyDown={cursor.onKeyDown} onFocus={cursor.onFocus} onBlur={cursor.onBlur}>
        <div className="chart-yaxis" aria-hidden="true">{ticks.map((tick) => <span key={tick} style={{ bottom: `${String(FULL - y(tick))}%` }}>{formatValue(unit, tick)}</span>)}</div>
        <div className="chart-plot" ref={plot} onPointerMove={onPointerMove} onPointerLeave={() => cursor.set(undefined)}>
          <svg role="img" aria-label={title} viewBox="0 0 100 100" preserveAspectRatio="none">
            {ticks.map((tick) => <line key={tick} className="chart-grid" x1="0" x2="100" y1={y(tick)} y2={y(tick)} vectorEffect="non-scaling-stroke" />)}
            {series.map((line, index) => (
              <g key={line.label}>
                {area && <path d={areaPath(line.points, x, y, FULL)} fill={colorOf(index)} fillOpacity="0.14" />}
                <path d={linePath(line.points, x, y)} fill="none" stroke={colorOf(index)} strokeWidth="2" strokeDasharray={dashOf(index)} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </g>
            ))}
            {moment !== undefined && <line className="chart-cross" x1={crossX} x2={crossX} y1="0" y2="100" vectorEffect="non-scaling-stroke" />}
          </svg>
          {series.map((line, index) => line.points.length === 1 && line.points[0] !== undefined && <span key={line.label} className="chart-dot" style={{ left: `${String(x(line.points[0][0]))}%`, top: `${String(y(line.points[0][1]))}%`, background: colorOf(index) }} />)}
          {moment !== undefined && cursor.active !== undefined && <Tooltip moment={moment} left={crossX} unit={unit} rows={series.map((line, index) => ({ label: line.label, value: grid[index]?.[cursor.active ?? 0], index }))} />}
        </div>
        <div className="chart-xaxis" aria-hidden="true">{xLabels.map((label, index) => <span key={index}>{formatTick(label, range)}</span>)}</div>
      </div>
      <Legend series={series} swatch="line" />
      <DataTable title={title} unit={unit} times={times} columns={series.map((line, index) => ({ label: line.label, values: grid[index] ?? [] }))} />
    </figure>
  );
}

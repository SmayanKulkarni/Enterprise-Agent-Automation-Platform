import { useMemo, useRef, type PointerEvent } from 'react';
import { gsap, motionAllowed, useGSAP } from '../motion.js';
import { formatValue, type Unit } from '../governance/governance-model.js';
import { DataTable, Legend, Tooltip, colorOf, seriesOf, useCursor } from './chart-parts.js';
import { formatTick, linear, niceTicks, stack, valuesAt, type ChartRange, type ChartSeries } from './scale.js';

const TICK_COUNT = 4;
const X_LABELS = 4;
const FULL = 100;
const BAR_GAP = 0.15;
const GROW_SECONDS = 0.6;

interface Props { title: string; series: readonly ChartSeries[]; unit: Unit; range: ChartRange }

export function StackedBars({ title, series: input, unit, range }: Props) {
  const series = useMemo(() => seriesOf(input), [input]);
  const plot = useRef<HTMLDivElement>(null);
  const { times, layers, max } = useMemo(() => stack(series), [series]);
  const grid = useMemo(() => valuesAt(series, times), [series, times]);
  const cursor = useCursor(times.length);
  const ticks = niceTicks(0, max, TICK_COUNT);
  const top = ticks[ticks.length - 1] ?? 1;
  const y = linear([0, top > 0 ? top : 1], [FULL, 0]);
  const slot = times.length === 0 ? FULL : FULL / times.length;
  const labelIndexes = Array.from({ length: Math.min(X_LABELS, times.length) }, (_unused, index) => Math.round((index * (times.length - 1)) / Math.max(1, Math.min(X_LABELS, times.length) - 1)));

  useGSAP(() => {
    const bars = plot.current?.querySelectorAll('rect');
    if (!bars || bars.length === 0 || !motionAllowed()) return;
    gsap.from(bars, { scaleY: 0, transformOrigin: '50% 100%', transformBox: 'fill-box', duration: GROW_SECONDS, ease: 'power2.out', clearProps: 'transform' });
  }, { dependencies: [series], scope: plot });

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    cursor.set(Math.floor(Math.max(0, Math.min(0.999, (event.clientX - box.left) / box.width)) * times.length));
  };
  const moment = cursor.active === undefined ? undefined : times[cursor.active];
  const center = cursor.active === undefined ? 0 : slot * cursor.active + slot / 2;

  return (
    <figure className="chart">
      <div className="chart-body" tabIndex={0} role="group" aria-label={`${title}. Use the left and right arrow keys to read values.`} onKeyDown={cursor.onKeyDown} onFocus={cursor.onFocus} onBlur={cursor.onBlur}>
        <div className="chart-yaxis" aria-hidden="true">{ticks.map((tick) => <span key={tick} style={{ bottom: `${String(FULL - y(tick))}%` }}>{formatValue(unit, tick)}</span>)}</div>
        <div className="chart-plot" ref={plot} onPointerMove={onPointerMove} onPointerLeave={() => cursor.set(undefined)}>
          <svg role="img" aria-label={title} viewBox="0 0 100 100" preserveAspectRatio="none">
            {ticks.map((tick) => <line key={tick} className="chart-grid" x1="0" x2="100" y1={y(tick)} y2={y(tick)} vectorEffect="non-scaling-stroke" />)}
            {layers.map((layer, index) => layer.values.map((value, column) => value > 0 && (
              <rect key={`${layer.label}:${String(column)}`} x={slot * column + (slot * BAR_GAP) / 2} width={slot * (1 - BAR_GAP)} y={y(layer.bases[column] === undefined ? value : layer.bases[column] + value)} height={y(layer.bases[column] ?? 0) - y((layer.bases[column] ?? 0) + value)} fill={colorOf(index)} />
            )))}
            {moment !== undefined && <line className="chart-cross" x1={center} x2={center} y1="0" y2="100" vectorEffect="non-scaling-stroke" />}
          </svg>
          {moment !== undefined && cursor.active !== undefined && <Tooltip moment={moment} left={center} unit={unit} rows={series.map((line, index) => ({ label: line.label, value: grid[index]?.[cursor.active ?? 0], index }))} />}
        </div>
        <div className="chart-xaxis" aria-hidden="true">{labelIndexes.map((index) => <span key={index}>{formatTick(times[index] ?? 0, range)}</span>)}</div>
      </div>
      <Legend series={series} swatch="box" />
      <DataTable title={title} unit={unit} times={times} columns={series.map((line, index) => ({ label: line.label, values: grid[index] ?? [] }))} />
    </figure>
  );
}

import { useRef } from 'react';
import { gsap, motionAllowed, useGSAP } from '../motion.js';
import { formatValue, type KpiTile, type Unit } from './governance-model.js';
import type { RangeKey } from './decoders.js';

const COUNT_UP_SECONDS = 0.8;
const directionWords = { up: 'up', down: 'down', flat: 'unchanged', none: '' } as const;

function CountUp({ value, unit }: { value: number | null; unit: Unit }) {
  const ref = useRef<HTMLElement>(null);
  const text = formatValue(unit, value);
  useGSAP(() => {
    const element = ref.current;
    if (!element || value === null || !Number.isFinite(value) || !motionAllowed()) return;
    const state = { n: 0 };
    gsap.to(state, { n: value, duration: COUNT_UP_SECONDS, ease: 'power2.out', onUpdate: () => { element.textContent = formatValue(unit, state.n); }, onComplete: () => { element.textContent = text; } });
  }, { dependencies: [value, unit], scope: ref });
  return <strong ref={ref}>{text}</strong>;
}

export function Metric({ tile, range, extra }: { tile: KpiTile; range: RangeKey; extra?: React.ReactNode }) {
  const { change } = tile;
  const worse = (change.direction === 'up' && !tile.goodWhenUp) || (change.direction === 'down' && tile.goodWhenUp);
  return (
    <article className="metric">
      <span>{tile.label}</span>
      <CountUp value={tile.value} unit={tile.unit} />
      {tile.id !== 'pending' && (
        <small className={worse ? 'metric-warning' : ''}>
          {change.text}
          {change.direction !== 'none' && <span className="visually-hidden"> {directionWords[change.direction]} against the previous period</span>}
        </small>
      )}
      <p>{tile.id === 'pending' ? 'waiting for a decision' : `vs previous ${range}`}</p>
      {extra}
    </article>
  );
}

export function KpiRow({ tiles, range, extras = {} }: { tiles: readonly KpiTile[]; range: RangeKey; extras?: Readonly<Record<string, React.ReactNode>> }) {
  return <div className="metrics-row">{tiles.map((tile) => <Metric key={tile.id} tile={tile} range={range} extra={extras[tile.id]} />)}</div>;
}

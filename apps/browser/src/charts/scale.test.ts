import { describe, expect, test } from 'vitest';
import { areaPath, bucketTimes, extent, formatTick, linePath, linear, nearestIndex, niceTicks, stack } from './scale.js';

describe('linear', () => {
  test('maps domain ends to range ends', () => {
    const map = linear([10, 20], [0, 100]);
    expect([map(10), map(15), map(20)]).toEqual([0, 50, 100]);
  });
  test('maps a zero-width domain to the middle', () => {
    expect(linear([5, 5], [0, 100])(5)).toBe(50);
  });
});

describe('paths', () => {
  const x = linear([0, 2], [0, 100]);
  const y = linear([0, 10], [100, 0]);
  test('linePath joins points with M and L', () => {
    expect(linePath([[0, 0], [1, 5], [2, 10]], x, y)).toBe('M 0.00,100.00 L 50.00,50.00 L 100.00,0.00');
  });
  test('empty input gives an empty string', () => {
    expect(linePath([], x, y)).toBe('');
    expect(areaPath([], x, y, 100)).toBe('');
  });
  test('areaPath closes down to the baseline', () => {
    expect(areaPath([[0, 0], [2, 10]], x, y, 100)).toBe('M 0.00,100.00 L 100.00,0.00 L 100.00,100.00 L 0.00,100.00 Z');
  });
  test('non-finite values are skipped', () => {
    expect(linePath([[0, Number.NaN], [1, 5]], x, y)).toBe('M 50.00,50.00');
  });
});

describe('nearestIndex', () => {
  const times = [0, 10, 20];
  test('picks the closer neighbour', () => {
    expect(nearestIndex(times, 4)).toBe(0);
    expect(nearestIndex(times, 6)).toBe(1);
    expect(nearestIndex(times, 14)).toBe(1);
  });
  test('clamps at both ends and handles empty input', () => {
    expect(nearestIndex(times, -50)).toBe(0);
    expect(nearestIndex(times, 500)).toBe(2);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe('stack', () => {
  test('sums per bucket and fills gaps with zero', () => {
    const result = stack([{ label: 'a', points: [[1, 2], [2, 3]] }, { label: 'b', points: [[1, 5]] }]);
    expect(result.times).toEqual([1, 2]);
    expect(result.layers[1]?.bases).toEqual([2, 3]);
    expect(result.layers[1]?.values).toEqual([5, 0]);
    expect(result.max).toBe(7);
  });
});

describe('niceTicks', () => {
  test('covers the range with round values', () => {
    expect(niceTicks(0, 97, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  });
  test('degenerate input never yields NaN', () => {
    expect(niceTicks(3, 3, 5)).toEqual([3]);
    expect(niceTicks(Number.NaN, 3, 5)).toEqual([]);
  });
});

describe('empty and single-point input', () => {
  test('extent of nothing is a safe default', () => {
    expect(extent([])).toEqual({ t: [0, 1], v: [0, 1] });
  });
  test('extent of one point keeps value minimum at zero', () => {
    expect(extent([{ label: 'a', points: [[5, 7]] }])).toEqual({ t: [5, 5], v: [0, 7] });
  });
  test('no helper returns NaN', () => {
    expect(JSON.stringify([stack([]), bucketTimes([]), formatTick(Number.NaN, '7d')])).not.toContain('NaN');
  });
});

describe('formatTick', () => {
  test('uses clock time for short ranges and dates for long ones', () => {
    const t = Date.UTC(2026, 0, 15, 13, 45);
    expect(formatTick(t, '1h')).toMatch(/:/u);
    expect(formatTick(t, '30d')).toMatch(/Jan/u);
  });
});

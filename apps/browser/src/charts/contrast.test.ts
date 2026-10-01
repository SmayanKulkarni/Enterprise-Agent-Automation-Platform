/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const MIN_RATIO = 3;

function block(opening: string): string {
  const start = css.indexOf(opening);
  return css.slice(start, css.indexOf('\n}', start));
}

const token = (source: string, name: string): string => {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`, 'u').exec(source);
  if (match?.[1] === undefined) throw new Error(`missing ${name}`);
  const hex = match[1];
  return hex.length === 4 ? `#${[1, 2, 3].map((offset) => hex.charAt(offset).repeat(2)).join('')}` : hex;
};

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

const contrast = (a: string, b: string): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
};

describe.each([['light', ':root {'], ['dark', ":root[data-theme='dark'] {"]])('%s theme chart colours', (_theme, opening) => {
  const source = block(opening);
  test.each([1, 2, 3, 4, 5, 6])('--chart-%i has at least 3:1 against --panel', (index) => {
    expect(contrast(token(source, `--chart-${String(index)}`), token(source, '--panel'))).toBeGreaterThanOrEqual(MIN_RATIO);
  });
});

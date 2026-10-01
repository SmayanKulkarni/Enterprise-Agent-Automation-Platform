import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { EVENTS } from './event-names.js';
import { METRICS } from './instruments.js';

const ROOT = join(import.meta.dirname, '../../..');
const SOURCE_ROOTS = ['packages', 'azure-functions/src', 'api', 'apps/browser/src'];
const SKIPPED = new Set(['node_modules', 'dist']);
const isSource = (name: string): boolean => /\.tsx?$/u.test(name) && !/\.test(?:-support)?\.tsx?$/u.test(name) && !name.endsWith('.test-support.ts');

const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : sourceFiles(join(directory, entry.name));
  return entry.isFile() && isSource(entry.name) ? [join(directory, entry.name)] : [];
});

const files = SOURCE_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root))).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

test('every catalogued event has a logEvent call site', () => {
  const missing = Object.keys(EVENTS).filter((name) => !files.some((file) => file.text.includes(`logEvent('${name}'`)));

  expect(missing).toEqual([]);
});

test('every catalogued instrument has a call site outside the catalog', () => {
  const emitters = files.filter((file) => !file.path.endsWith('telemetry/src/instruments.ts'));
  const missing = Object.keys(METRICS).filter((name) => !emitters.some((file) => file.text.includes(`count('${name}'`) || file.text.includes(`record('${name}'`)));

  expect(missing).toEqual([]);
});

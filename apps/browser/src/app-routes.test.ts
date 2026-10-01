import { describe, expect, test } from 'vitest';
import { routeFromPath, titles } from './app-routes.js';

describe('routeFromPath', () => {
  test.each([
    ['/', 'home'],
    ['/studio', 'studio'],
    ['/studio/', 'studio'],
    ['/studio/x', 'not-found'],
    ['/privacy', 'not-found'],
    ['/terms', 'not-found'],
    ['/sign-in', 'signin'],
    ['//evil', 'not-found'],
  ] as const)('%s -> %s', (pathname, expected) => {
    expect(routeFromPath(pathname)).toBe(expected);
  });
});

describe('titles', () => {
  test('governance is no longer a preview', () => {
    expect(titles.governance).toBe('Governance · Threadline');
  });
});

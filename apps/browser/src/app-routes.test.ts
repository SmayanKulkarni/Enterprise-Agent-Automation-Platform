import { describe, expect, test } from 'vitest';
import { routeFromPath } from './app-routes.js';

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

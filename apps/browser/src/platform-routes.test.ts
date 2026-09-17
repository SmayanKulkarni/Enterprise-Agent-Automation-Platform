import { describe, expect, test } from 'vitest';
import { collectionRoutes, routeForPath, routeHref } from './platform-routes.js';

describe('platform routes', () => {
  test('gives every browser collection an explicit screen and opaque detail link', () => {
    expect(new Set(collectionRoutes.map((route) => route.collection))).toEqual(new Set(['cases', 'interventions', 'capabilities', 'installations', 'memory', 'evaluations', 'improvements', 'packages', 'operations', 'deployments', 'readiness', 'vendor-assessments', 'access-grants']));
    const route = routeForPath('/vendor/access-grants/22222222-2222-4222-8222-222222222222');
    expect(route).toMatchObject({ route: { collection: 'access-grants', surface: 'vendor' }, id: '22222222-2222-4222-8222-222222222222' });
    expect(routeHref(route.route, route.id)).toBe('/vendor/access-grants/22222222-2222-4222-8222-222222222222');
  });
});

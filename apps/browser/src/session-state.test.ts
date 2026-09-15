import { describe, expect, test } from 'vitest';
import { browserState, selectTenant, signedIn, signedOut } from './session-state.js';

describe('browser session state', () => {
  test('restores an allowed deep link after sign-in and clears scoped state on Tenant change', () => {
    const initial = browserState('/operations/cases/123');
    const authenticated = signedIn(initial, {
      tenantId: '11111111-1111-4111-8111-111111111111',
      tenantIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
    });

    expect(authenticated.path).toBe('/operations/cases/123');
    expect(selectTenant(authenticated, '22222222-2222-4222-8222-222222222222')).toEqual({
      ...authenticated,
      tenantId: '22222222-2222-4222-8222-222222222222',
      cacheEpoch: 1,
      streamEpoch: 1,
    });
  });

  test('does not preserve external or unauthenticated routes', () => {
    expect(signedIn(browserState('https://attacker.example'), { tenantId: '11111111-1111-4111-8111-111111111111', tenantIds: ['11111111-1111-4111-8111-111111111111'] }).path).toBe('/');
    expect(signedOut(browserState('/operations')).path).toBe('/');
  });
});

import { describe, expect, test } from 'vitest';
import { browserState, selectPath, selectTenant, signedIn, signedOut } from './session-state.js';

describe('browser session state', () => {
  test('restores an allowed deep link after sign-in and clears scoped state on Tenant change', () => {
    const initial = browserState('/operations/cases/123');
    const authenticated = signedIn(initial, {
      tenantId: '11111111-1111-4111-8111-111111111111',
      tenantIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
      sessionId: 'session-a',
    });

    expect(authenticated.path).toBe('/operations/cases/123');
    expect(selectTenant(authenticated, '22222222-2222-4222-8222-222222222222')).toEqual({
      ...authenticated,
      tenantId: '22222222-2222-4222-8222-222222222222',
      sessionId: 'session-a',
      cacheEpoch: 1,
      streamEpoch: 1,
    });
  });

  test('does not preserve external or unauthenticated routes', () => {
    expect(signedIn(browserState('https://attacker.example'), { tenantId: '11111111-1111-4111-8111-111111111111', tenantIds: ['11111111-1111-4111-8111-111111111111'], sessionId: 'session-a' }).path).toBe('/');
    expect(signedOut(browserState('/operations')).path).toBe('/');
  });

  test('clears scoped state when Clerk changes the live session', () => {
    const first = signedIn(browserState('/operations'), { tenantId: '11111111-1111-4111-8111-111111111111', tenantIds: ['11111111-1111-4111-8111-111111111111'], sessionId: 'session-a' });
    expect(signedIn(first, { tenantId: '11111111-1111-4111-8111-111111111111', tenantIds: first.tenantIds, sessionId: 'session-b' })).toMatchObject({ cacheEpoch: 1, streamEpoch: 1 });
  });

  test('changes only an allowed in-app path', () => {
    const state = browserState('/studio');
    expect(selectPath(state, '/catalog/packages')).toMatchObject({ path: '/catalog/packages' });
    expect(selectPath(state, 'https://attacker.example')).toMatchObject({ path: '/' });
  });
});

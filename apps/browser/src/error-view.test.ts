import { describe, expect, test } from 'vitest';
import { PlatformApiError } from './platform-api.js';
import { errorView, failureNotice } from './error-view.js';

const api = (status: number, category?: string, code?: string, correlationId?: string) => new PlatformApiError(status, category, code, correlationId);

describe('errorView', () => {
  test.each([
    [api(401, undefined, 'UNAUTHENTICATED'), 'signed-out', false],
    [api(403, 'denied', 'DENIED'), 'denied', false],
    [api(404, undefined, 'NOT_FOUND'), 'not-found', false],
    [api(409, 'conflict', 'STALE'), 'conflict', false],
    [api(422, 'invalid', 'INVALID'), 'invalid', false],
    [api(501, 'terminal', 'FEATURE_NOT_READY'), 'not-ready', false],
    [api(503, 'retryable', 'UNAVAILABLE'), 'unavailable', true],
    [api(504, 'timeout', 'UPSTREAM_TIMEOUT'), 'timeout', true],
    [api(500, 'terminal', 'INTERNAL'), 'unavailable', true],
    [api(429), 'rate-limited', true],
  ])('maps %o to %s with retryable=%s', (error, kind, retryable) => {
    expect(errorView(error)).toMatchObject({ kind, retryable });
  });

  test('treats an unclassified failure as unknown for writes and unavailable for reads', () => {
    expect(errorView(new TypeError('network'), { write: true }).kind).toBe('unknown');
    expect(errorView(new TypeError('network')).kind).toBe('unavailable');
  });

  test('never leaks the cause into copy', () => {
    const view = errorView(new Error('SELECT * FROM secrets'));
    expect(`${view.title} ${view.message}`).not.toContain('SELECT');
  });
});

describe('failureNotice', () => {
  test('appends the category message and the short reference', () => {
    expect(failureNotice(api(503, 'retryable', 'UNAVAILABLE', 'abcdef123456'), 'Older Run History could not be loaded.')).toBe('Older Run History could not be loaded. Something on our side failed. Try again shortly. Ref: abcdef12');
  });

  test('omits the reference for non-API errors', () => {
    expect(failureNotice(new Error('x'), 'Failed.')).not.toContain('Ref:');
  });
});

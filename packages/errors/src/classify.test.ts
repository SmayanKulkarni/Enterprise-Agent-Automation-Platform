import { expect, test } from 'vitest';
import { AppError } from './app-error.js';
import { classify } from './classify.js';

const table = [
  ['UNAUTHENTICATED', 401, 'denied'], ['DENIED', 403, 'denied'], ['TENANT_MISMATCH', 403, 'denied'], ['INVALID_IDENTIFIER', 403, 'denied'],
  ['NOT_FOUND', 404, 'invalid'], ['CONFLICT', 409, 'conflict'], ['STALE', 409, 'conflict'],
  ['INVALID', 422, 'invalid'], ['INVALID_REQUEST', 422, 'invalid'], ['INVALID_PAGE_SIZE', 422, 'invalid'], ['INVALID_CURSOR', 422, 'invalid'], ['INVALID_BROWSER_COMMAND', 422, 'invalid'],
  ['INVALID_JSON', 400, 'invalid'], ['FEATURE_NOT_READY', 501, 'terminal'], ['PROJECTION_UNAVAILABLE', 503, 'terminal'], ['INTERNAL', 500, 'terminal'], ['RATE_LIMITED', 429, 'retryable'],
] as const;

test.each(table)('maps legacy message %s to %i/%s', (code, status, category) => {
  expect(classify(new Error(code))).toMatchObject({ status, code, category });
});

test.each(table)('maps error.code %s to %i/%s', (code, status, category) => {
  expect(classify(Object.assign(new Error('boom'), { code }))).toMatchObject({ status, code, category });
});

test('returns an AppError unchanged', () => {
  const error = new AppError('CONFLICT');
  expect(classify(error)).toBe(error);
});

test('keeps the original error as cause', () => {
  const cause = new Error('DENIED');
  expect(classify(cause).cause).toBe(cause);
});

test.each([['ESOCKET'], ['ECONNRESET'], ['ELOGIN']])('maps connection error %s to 503 retryable', (code) => {
  expect(classify(Object.assign(new Error('x'), { code }))).toMatchObject({ status: 503, code: 'UNAVAILABLE', category: 'retryable' });
});

test.each([['ETIMEOUT'], ['ETIMEDOUT']])('maps timeout %s to 504 timeout', (code) => {
  expect(classify(Object.assign(new Error('x'), { code }))).toMatchObject({ status: 504, code: 'UPSTREAM_TIMEOUT', category: 'timeout' });
});

test('maps an abort-signal timeout to 504', () => {
  expect(classify(new DOMException('slow', 'TimeoutError'))).toMatchObject({ status: 504 });
});

test.each([['INVALID_BROWSER_DTO'], ['INVALID_ARGUMENTS'], ['UNSUPPORTED_COMMAND']])('maps client-input code %s to 422', (code) => {
  expect(classify(Object.assign(new Error('x'), { code }))).toMatchObject({ status: 422, code: 'INVALID', category: 'invalid' });
});

test('does not blame the client for a stray SyntaxError', () => {
  expect(classify(new SyntaxError('Unexpected token'))).toMatchObject({ status: 500, code: 'INTERNAL' });
});

test('maps contract validation failures to 422 and malformed JSON contracts to 400', () => {
  expect(classify(Object.assign(new Error('x'), { name: 'ContractValidationError', code: 'INVALID_FIELD' }))).toMatchObject({ status: 422, code: 'INVALID' });
  expect(classify(Object.assign(new Error('x'), { name: 'ContractValidationError', code: 'INVALID_JSON' }))).toMatchObject({ status: 400, code: 'INVALID_JSON' });
});

test('hides which 403 reason applied in the public body', () => {
  expect(classify(new Error('TENANT_MISMATCH'))).toMatchObject({ code: 'TENANT_MISMATCH' });
  expect(classify(new Error('TENANT_MISMATCH')).toBody().code).toBe('DENIED');
  expect(classify(new Error('INVALID_IDENTIFIER')).toBody().code).toBe('DENIED');
});

test.each([[new Error('surprise')], ['string'], [undefined], [Object.assign(new Error('x'), { code: 'WHO_KNOWS' })]])('maps unknown %s to 500 INTERNAL', (value) => {
  expect(classify(value)).toMatchObject({ status: 500, code: 'INTERNAL', category: 'terminal' });
});

test('toBody is redacted and never carries the cause message', () => {
  expect(classify(new Error('secret sql detail')).toBody()).toEqual({ category: 'terminal', code: 'INTERNAL', message: 'The request could not be completed.', redacted: true });
});

import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { OpenRouterConnectionCrypto } from './openrouter-connection.js';

test('tenant-bound connection envelope cannot open for another tenant', () => {
  const crypto = new OpenRouterConnectionCrypto('v1', randomBytes(32));
  const envelope = crypto.seal('11111111-1111-4111-8111-111111111111', 'sentinel-key');
  expect(crypto.open('11111111-1111-4111-8111-111111111111', envelope)).toBe('sentinel-key');
  expect(() => crypto.open('22222222-2222-4222-8222-222222222222', envelope)).toThrow();
});

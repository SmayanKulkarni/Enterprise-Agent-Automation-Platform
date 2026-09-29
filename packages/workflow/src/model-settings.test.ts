import { expect, test } from 'vitest';
import { embeddingProfile, parseModelSettings } from './model-settings.js';

test('accepts explicit summary and embedding selections', () => {
  const settings = parseModelSettings({ summary: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', fallback: 'qwen/qwen3.8-27b:free' }, embedding: { provider: 'openrouter', model: 'openai/text-embedding-3-small' } });
  expect(settings.summary).toEqual({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', fallback: 'qwen/qwen3.8-27b:free' });
  expect(embeddingProfile(settings.embedding)).toBe('openrouter:openai/text-embedding-3-small');
});

test('defaults to the built-in embedding profile without a model', () => {
  const settings = parseModelSettings({ embedding: { provider: 'upstash' } });
  expect(settings).toEqual({ embedding: { provider: 'upstash' } });
  expect(embeddingProfile(settings.embedding)).toBe('upstash');
});

test.each([
  [{ embedding: { provider: 'upstash', model: 'x/y' } }],
  [{ embedding: { provider: 'openrouter' } }],
  [{ embedding: { provider: 'openrouter', model: 'no-slash' } }],
  [{ embedding: { provider: 'other', model: 'a/b' } }],
  [{ embedding: { provider: 'upstash' }, summary: { provider: 'openrouter', model: 'a/b', fallback: 'a/b' } }],
  [{ embedding: { provider: 'upstash' }, summary: { provider: 'upstash', model: 'a/b' } }],
  [{ embedding: { provider: 'upstash' }, summary: { provider: 'azure-openai', model: 'has space' } }],
  [{ embedding: { provider: 'upstash' }, extra: true }],
  [null],
])('rejects invalid settings %#', (value) => {
  expect(() => parseModelSettings(value)).toThrow('INVALID');
});

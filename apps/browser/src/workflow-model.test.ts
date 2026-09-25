import { describe, expect, test } from 'vitest';
import { connect, disconnect, expiryInstant, initialEdges, initialNodes, localDateTime, memoryProposalsEnabled, setMemoryProposals, updateIntegerConfig } from './workflow-model.js';

describe('workflow graph', () => {
  test('only creates valid, non-duplicate connections', () => {
    expect(connect(initialNodes, initialEdges, 'trigger', 'plan')).toHaveLength(initialEdges.length + 1);
    expect(connect(initialNodes, initialEdges, 'trigger', 'triage')).toEqual(initialEdges);
    expect(connect(initialNodes, initialEdges, 'trigger', 'missing')).toEqual(initialEdges);
  });

  test('removes a connection by id', () => {
    expect(disconnect(initialEdges, 'trigger-triage')).not.toContainEqual(expect.objectContaining({ id: 'trigger-triage' }));
  });

  test('updates only valid memory bounds', () => {
    const config = { limit: 3, maxChars: 2000, policy: { tokens: 0 } };
    expect(updateIntegerConfig(config, 'limit', '4', 1, 20).config).toEqual({ ...config, limit: 4 });
    for (const value of ['', '1.5', '21', 'Infinity']) expect(updateIntegerConfig(config, 'limit', value, 1, 20)).toEqual({ error: 'Enter a whole number from 1 to 20.' });
  });

  test('adds and removes only the optional proposal schema field', () => {
    const config = { provider: 'azure-openai', responseSchema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result', 'memoryProposals'], additionalProperties: false } };
    const enabled = setMemoryProposals(config, true);
    expect(enabled).toMatchObject({ provider: 'azure-openai', responseSchema: { properties: { result: { type: 'string' }, memoryProposals: { type: 'array' } }, required: ['result'] } });
    expect(memoryProposalsEnabled(enabled)).toBe(true);
    expect(setMemoryProposals(enabled, false)).toEqual({ ...config, responseSchema: { ...config.responseSchema, required: ['result'], properties: { result: { type: 'string' } } } });
  });

  test('converts a valid local expiry and rejects extensions or invalid values', () => {
    const current = '2026-10-01T12:00:00.000Z';
    expect(localDateTime(current)).toMatch(/^2026-10-01T/);
    expect(expiryInstant('2026-09-30T12:00', current, Date.parse('2026-09-01T00:00:00.000Z')).iso).toBe(new Date(2026, 8, 30, 12).toISOString());
    expect(expiryInstant('', current).error).toBe('Enter an expiry date and time.');
    expect(expiryInstant('2026-02-30T12:00', current).error).toBe('Enter a valid expiry date and time.');
    expect(expiryInstant('2026-10-02T12:00', current).error).toBe('Expiry can only be shortened.');
  });
});

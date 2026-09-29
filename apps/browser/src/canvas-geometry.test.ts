import { describe, expect, test } from 'vitest';
import { edgePath, inputPoint, outputPoint } from './canvas-geometry.js';

describe('canvas geometry', () => {
  test('True and False leave their own ports at 30% and 70% of the measured node height', () => {
    const condition = { x: 500, y: 300, height: 100 };
    expect(outputPoint(condition, { branch: 'true' })).toEqual({ x: 584, y: 280 });
    expect(outputPoint(condition, { branch: 'false' })).toEqual({ x: 584, y: 320 });
    expect(outputPoint(condition, {})).toEqual({ x: 584, y: 300 });
  });

  test('a tool edge runs from the Agent bottom to the MCP top', () => {
    const agent = { x: 400, y: 200, height: 90 }; const mcp = { x: 420, y: 400, height: 70 };
    expect(outputPoint(agent, { role: 'tool' })).toEqual({ x: 400, y: 245 });
    expect(inputPoint(mcp, { role: 'tool' })).toEqual({ x: 420, y: 355 });
    expect(edgePath(agent, mcp, { role: 'tool' })).toMatch(/^M 400 245 C 400 \d+, 420 \d+, 420 355$/);
  });

  test('a flow edge ends at the left input port and falls back to the default height', () => {
    expect(inputPoint({ x: 800, y: 300 }, {})).toEqual({ x: 706, y: 300 });
    expect(edgePath({ x: 100, y: 100 }, { x: 500, y: 300 }, {})).toBe('M 184 100 C 295 100, 295 300, 406 300');
  });
});

export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 82;
const ARROW_GAP = 10;
const BRANCH_OFFSET = 0.2;

export interface Anchor { x: number; y: number; height?: number | undefined; }
export interface EdgeShape { role?: 'tool' | undefined; branch?: 'true' | 'false' | undefined; }

interface Point { x: number; y: number; }
const path = (start: Point, first: Point, second: Point, end: Point): string => `M ${String(start.x)} ${String(start.y)} C ${String(first.x)} ${String(first.y)}, ${String(second.x)} ${String(second.y)}, ${String(end.x)} ${String(end.y)}`;
const heightOf = (anchor: Anchor): number => anchor.height ?? NODE_HEIGHT;

export function outputPoint(anchor: Anchor, shape: EdgeShape): { x: number; y: number } {
  if (shape.role === 'tool') return { x: anchor.x, y: anchor.y + heightOf(anchor) / 2 };
  const offset = shape.branch === 'true' ? -BRANCH_OFFSET : shape.branch === 'false' ? BRANCH_OFFSET : 0;
  return { x: anchor.x + NODE_WIDTH / 2, y: anchor.y + offset * heightOf(anchor) };
}

export function inputPoint(anchor: Anchor, shape: EdgeShape): { x: number; y: number } {
  if (shape.role === 'tool') return { x: anchor.x, y: anchor.y - heightOf(anchor) / 2 - ARROW_GAP };
  return { x: anchor.x - NODE_WIDTH / 2 - ARROW_GAP, y: anchor.y };
}

export function edgePath(from: Anchor, to: Anchor, shape: EdgeShape): string {
  const start = outputPoint(from, shape); const end = inputPoint(to, shape);
  if (shape.role === 'tool') {
    const lift = Math.max(36, Math.abs(end.y - start.y) / 2);
    return path(start, { x: start.x, y: start.y + lift }, { x: end.x, y: end.y - lift }, end);
  }
  const mid = (start.x + end.x) / 2;
  return path(start, { x: mid, y: start.y }, { x: mid, y: end.y }, end);
}

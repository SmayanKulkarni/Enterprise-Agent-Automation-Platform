export interface FlowEdge { from: string; to: string; role?: 'tool' | undefined; }

export const isFlowEdge = (edge: { role?: unknown }): boolean => edge.role === undefined;

export function reachableFrom(edges: readonly FlowEdge[], root: string): Set<string> {
  const seen = new Set<string>([root]); const queue = [root];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const edge of edges) if (isFlowEdge(edge) && edge.from === id && !seen.has(edge.to)) { seen.add(edge.to); queue.push(edge.to); }
  }
  return seen;
}

export const reaches = (edges: readonly FlowEdge[], start: string, goal: string): boolean => reachableFrom(edges, start).has(goal);

export function dominators(edges: readonly FlowEdge[], root: string): Map<string, ReadonlySet<string>> {
  const reachable = reachableFrom(edges, root);
  const predecessors = new Map<string, string[]>([...reachable].map((id) => [id, []]));
  for (const edge of edges) if (isFlowEdge(edge) && reachable.has(edge.from) && reachable.has(edge.to)) predecessors.get(edge.to)?.push(edge.from);
  const dominated = new Map<string, Set<string>>([...reachable].map((id) => [id, id === root ? new Set([root]) : new Set(reachable)]));
  for (let changed = true; changed;) {
    changed = false;
    for (const id of reachable) {
      if (id === root) continue;
      const [first, ...rest] = (predecessors.get(id) ?? []).map((parent) => dominated.get(parent) ?? new Set<string>());
      const next = new Set([...(first ?? [])].filter((candidate) => rest.every((other) => other.has(candidate)))); next.add(id);
      if (next.size !== dominated.get(id)?.size) { dominated.set(id, next); changed = true; }
    }
  }
  return dominated;
}

export const strictlyDominates = (dominated: ReadonlyMap<string, ReadonlySet<string>>, source: string, target: string): boolean => source !== target && dominated.get(target)?.has(source) === true;

export function immediateDominator(dominated: ReadonlyMap<string, ReadonlySet<string>>, id: string): string | undefined {
  let best: string | undefined;
  for (const candidate of dominated.get(id) ?? []) if (candidate !== id && (best === undefined || (dominated.get(candidate)?.size ?? 0) > (dominated.get(best)?.size ?? 0))) best = candidate;
  return best;
}

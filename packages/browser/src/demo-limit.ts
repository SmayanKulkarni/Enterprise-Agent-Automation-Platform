export interface DemoLimits { perKey: number; global: number; windowMs: number }

export function demoLimiter({ perKey, global, windowMs }: DemoLimits, now: () => number = Date.now): (key: string) => boolean {
  let windowStart = 0;
  let total = 0;
  let counts = new Map<string, number>();
  return (key) => {
    const current = now();
    if (current - windowStart >= windowMs) { windowStart = current; total = 0; counts = new Map(); }
    const used = counts.get(key) ?? 0;
    if (used >= perKey || total >= global) return false;
    counts.set(key, used + 1);
    total += 1;
    return true;
  };
}

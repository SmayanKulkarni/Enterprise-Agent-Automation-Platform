import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('showcase deployment config', () => {
  test('builds the Vite app and serves the SPA for every path', () => {
    const config: unknown = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
    const parsed = config as { framework: string; outputDirectory: string; rewrites: { source: string; destination: string }[] };
    expect(parsed.framework).toBe('vite');
    expect(parsed.outputDirectory).toBe('apps/browser/dist');
    expect(parsed.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
    expect(JSON.stringify(config)).not.toMatch(/secret|token|password/iu);
  });
});

import { backendsFromEnvironment } from './backend.js';

export const REACHABLE_TIMEOUT_MS = 2000;
export const WAIT_MS = 45_000;
export const POLL_MS = 1000;

export const backends = backendsFromEnvironment(process.env);

export async function reachable(url: string | undefined, path: string): Promise<boolean> {
  if (url === undefined || !process.env['OTEL_EXPORTER_OTLP_ENDPOINT']) return false;
  return await fetch(`${url}${path}`, { signal: AbortSignal.timeout(REACHABLE_TIMEOUT_MS) }).then((response) => response.ok, () => false);
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

export async function eventually<Value>(read: () => Promise<Value>, done: (value: Value) => boolean): Promise<Value> {
  const deadline = Date.now() + WAIT_MS;
  let value = await read();
  while (!done(value) && Date.now() < deadline) { await sleep(POLL_MS); value = await read(); }
  return value;
}

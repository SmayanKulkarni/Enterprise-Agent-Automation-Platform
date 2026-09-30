export const FLUSH_TIMEOUT_MS = 2000;

export async function flushWithin(targets: readonly (() => Promise<unknown>)[], timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  const settled = Promise.allSettled(targets.map((flush) => Promise.resolve().then(flush)));
  try { await Promise.race([settled, expired]); } finally { clearTimeout(timer); }
}

import { useEffect, useRef, useState } from 'react';
import type { Approvals } from './decoders.js';
import type { GovernanceSource } from './governance-source.js';

export const POLL_MS = 30_000;
const CHECK_MS = 5_000;

export type PollDecision = 'now' | 'wait' | 'stop';

export function nextPoll(visibility: DocumentVisibilityState, lastLoadedAt: number | undefined, now: number): PollDecision {
  if (visibility !== 'visible') return 'stop';
  return lastLoadedAt === undefined || now - lastLoadedAt >= POLL_MS ? 'now' : 'wait';
}

export interface PendingApprovals { approvals: readonly Approvals['approvals'][number][]; count: number; completeness: Approvals['completeness']; reload: () => void; error: unknown }

export function usePendingApprovals(source: GovernanceSource | undefined): PendingApprovals {
  const [data, setData] = useState<Approvals>();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  const lastLoadedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (source === undefined) { setData(undefined); setError(undefined); lastLoadedAt.current = undefined; return; }
    let controller = new AbortController();
    const load = (): void => {
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      lastLoadedAt.current = Date.now();
      source.approvals(signal)
        .then((next) => {
          if (signal.aborted) return;
          setData(next);
          setError(undefined);
        })
        .catch((failure: unknown) => {
          if (signal.aborted || (failure instanceof DOMException && failure.name === 'AbortError')) return;
          setError(failure);
        });
    };
    const check = (): void => {
      if (nextPoll(document.visibilityState, lastLoadedAt.current, Date.now()) === 'now') load();
    };
    load();
    const timer = window.setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [source, attempt]);

  return { approvals: data?.approvals ?? [], count: data?.count ?? 0, completeness: data?.completeness ?? 'full', reload: () => { setAttempt((value) => value + 1); }, error };
}

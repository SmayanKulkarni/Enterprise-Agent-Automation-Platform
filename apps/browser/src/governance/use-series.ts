import { useEffect, useState } from 'react';
import type { RangeKey, Series } from './decoders.js';
import type { GovernanceSource } from './governance-source.js';

export interface SeriesState { series?: Series; failed: boolean; loading: boolean }

export function useSeries(source: GovernanceSource, panel: string, range: RangeKey, scope: string | undefined, reload: number): SeriesState {
  const [state, setState] = useState<SeriesState>({ failed: false, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setState((current) => ({ ...current, failed: false, loading: true }));
    source.series(panel, range, scope, signal)
      .then((series) => {
        if (!signal.aborted) setState({ series, failed: false, loading: false });
      })
      .catch((error: unknown) => {
        if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
        setState({ failed: true, loading: false });
      });
    return () => { controller.abort(); };
  }, [source, panel, range, scope, reload]);
  return state;
}

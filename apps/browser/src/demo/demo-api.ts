import { apiOrigin as defaultApiOrigin } from '../api-origin.js';
import type { DemoRun } from '../../../../packages/workflow/src/pr-gate-demo.js';
import { isDemoRun } from './demo-state.js';

export type DemoFailureCode = 'DEMO_RUN_USED' | 'DEMO_UNAVAILABLE' | 'INVALID_INPUT' | 'GITHUB_REJECTED' | 'GITHUB_UNAVAILABLE';
export interface DemoRunInput { githubToken?: string; pullRequest?: string }

export class DemoApiError extends Error {
  constructor(readonly status: number, readonly code: DemoFailureCode, message: string) { super(message); }
}

const CODES: readonly DemoFailureCode[] = ['DEMO_RUN_USED', 'DEMO_UNAVAILABLE', 'INVALID_INPUT', 'GITHUB_REJECTED', 'GITHUB_UNAVAILABLE'];
const UNAVAILABLE = 'The demo could not be reached. Try again in a moment.';

export async function requestDemoRun(input: DemoRunInput, signal?: AbortSignal, apiOrigin: string = defaultApiOrigin): Promise<DemoRun> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}/api/v1/demo/run`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(input), cache: 'no-store', credentials: 'omit', ...(signal === undefined ? {} : { signal }) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new DemoApiError(0, 'DEMO_UNAVAILABLE', UNAVAILABLE);
  }
  const body = await response.json().catch(() => undefined) as { run?: unknown; error?: { code?: unknown; message?: unknown } } | undefined;
  if (response.ok && isDemoRun(body?.run)) return body.run;
  const code = CODES.find((item) => item === body?.error?.code) ?? 'DEMO_UNAVAILABLE';
  throw new DemoApiError(response.status, code, typeof body?.error?.message === 'string' && code !== 'DEMO_UNAVAILABLE' ? body.error.message : UNAVAILABLE);
}

import type { DemoRun } from '../../../../packages/workflow/src/pr-gate-demo.js';

export interface DemoState { active: boolean; run: DemoRun | undefined }
export interface DemoStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const STORAGE_KEY = 'threadline.demo.v1';
export const emptyDemo: DemoState = { active: false, run: undefined };

const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const strings = (value: Record<string, unknown> | undefined, keys: readonly string[]): boolean => value !== undefined && keys.every((key) => typeof value[key] === 'string');

export function isDemoRun(value: unknown): value is DemoRun {
  const run = record(value);
  const pull = record(run?.['pullRequest']);
  const verdict = record(run?.['verdict']);
  if (!strings(run, ['id', 'startedAt', 'waitingNodeId']) || !strings(pull, ['owner', 'repo', 'headSha', 'title', 'author']) || typeof pull?.['pullNumber'] !== 'number') return false;
  if (run?.['source'] !== 'sample' && run?.['source'] !== 'github' || run['outcome'] !== 'awaiting-approval' || run['branch'] !== 'accept' && run['branch'] !== 'return') return false;
  if (typeof verdict?.['accept'] !== 'boolean' || typeof verdict['summary'] !== 'string' || !Array.isArray(verdict['findings']) || !Array.isArray(run['steps'])) return false;
  return verdict['findings'].every((finding) => strings(record(finding), ['file', 'problem', 'fix']) && typeof record(finding)?.['line'] === 'number')
    && run['steps'].every((step) => strings(record(step), ['nodeId', 'kind', 'title', 'detail', 'state']) && typeof record(step)?.['startMs'] === 'number' && typeof record(step)?.['durationMs'] === 'number');
}

export function browserStorage(): DemoStorage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export function loadDemo(storage: DemoStorage | undefined = browserStorage()): DemoState {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return emptyDemo;
    const saved = record(JSON.parse(raw) as unknown);
    return { active: saved?.['active'] === true, run: isDemoRun(saved?.['run']) ? saved['run'] : undefined };
  } catch { return emptyDemo; }
}

export function saveDemo(state: DemoState, storage: DemoStorage | undefined = browserStorage()): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { return; }
}

export const enterDemo = (state: DemoState): DemoState => ({ ...state, active: true });
export const leaveDemo = (state: DemoState): DemoState => ({ ...state, active: false });
export const withRun = (_state: DemoState, run: DemoRun): DemoState => ({ active: true, run });

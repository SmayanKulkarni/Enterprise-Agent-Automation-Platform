export interface BrowserState {
  path: string;
  tenantId?: string;
  tenantIds: readonly string[];
  cacheEpoch: number;
  streamEpoch: number;
}

export function browserState(path = '/'): BrowserState {
  return { path: internalPath(path) ? path : '/', tenantIds: [], cacheEpoch: 0, streamEpoch: 0 };
}

export function signedIn(state: BrowserState, session: { tenantId: string; tenantIds: readonly string[] }): BrowserState {
  return { ...state, tenantId: session.tenantId, tenantIds: session.tenantIds };
}

export function signedOut(state: BrowserState): BrowserState {
  return { path: '/', tenantIds: [], cacheEpoch: state.cacheEpoch + 1, streamEpoch: state.streamEpoch + 1 };
}

export function selectTenant(state: BrowserState, tenantId: string): BrowserState {
  if (!state.tenantIds.includes(tenantId)) return state;
  return { ...state, tenantId, cacheEpoch: state.cacheEpoch + 1, streamEpoch: state.streamEpoch + 1 };
}

function internalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

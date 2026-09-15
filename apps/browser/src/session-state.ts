export interface BrowserState {
  path: string;
  tenantId?: string;
  sessionId: string | undefined;
  tenantIds: readonly string[];
  cacheEpoch: number;
  streamEpoch: number;
}

export function browserState(path = '/'): BrowserState {
  return { path: internalPath(path) ? path : '/', sessionId: undefined, tenantIds: [], cacheEpoch: 0, streamEpoch: 0 };
}

export function signedIn(state: BrowserState, session: { tenantId: string; tenantIds: readonly string[]; sessionId: string | undefined }): BrowserState {
  const scopeChanged = state.tenantId !== undefined && (state.tenantId !== session.tenantId || state.sessionId !== session.sessionId);
  return { ...state, tenantId: session.tenantId, sessionId: session.sessionId, tenantIds: session.tenantIds, cacheEpoch: state.cacheEpoch + Number(scopeChanged), streamEpoch: state.streamEpoch + Number(scopeChanged) };
}

export function signedOut(state: BrowserState): BrowserState {
  return { path: '/', sessionId: undefined, tenantIds: [], cacheEpoch: state.cacheEpoch + 1, streamEpoch: state.streamEpoch + 1 };
}

export function selectTenant(state: BrowserState, tenantId: string): BrowserState {
  if (!state.tenantIds.includes(tenantId)) return state;
  return { ...state, tenantId, cacheEpoch: state.cacheEpoch + 1, streamEpoch: state.streamEpoch + 1 };
}

function internalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

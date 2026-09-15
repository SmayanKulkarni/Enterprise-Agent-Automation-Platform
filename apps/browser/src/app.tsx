import { Show, SignInButton, SignUpButton, UserButton, useAuth } from '@clerk/react';
import { useEffect, useMemo, useState } from 'react';
import { PlatformApi, PlatformApiError } from './platform-api.js';
import { browserState, selectTenant, signedIn, signedOut, type BrowserState } from './session-state.js';

type View = 'loading' | 'ready' | 'signed-out' | 'no-membership' | 'forbidden' | 'unavailable';

export function App() {
  const { getToken, isLoaded, isSignedIn, sessionId } = useAuth();
  const [state, setState] = useState<BrowserState>(() => browserState(`${window.location.pathname}${window.location.search}`));
  const [view, setView] = useState<View>('loading');
  const api = useMemo(() => new PlatformApi(getToken), [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setState((current) => current.tenantId === undefined ? current : signedOut(current));
      setView('signed-out');
      return;
    }

    const controller = new AbortController();
    void Promise.all([api.session(state.tenantId, controller.signal), api.tenants(controller.signal)])
      .then(([session, tenants]) => {
        if (tenants.length === 0 || !tenants.some((tenant) => tenant.id === session.tenantId)) {
          setView('no-membership');
          return;
        }
        restorePath(state.path);
        setState((current) => signedIn(current, { tenantId: session.tenantId, tenantIds: tenants.map((tenant) => tenant.id), sessionId }));
        setView('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setView(error instanceof PlatformApiError && error.status === 401 ? 'signed-out' : error instanceof PlatformApiError && (error.status === 403 || error.status === 400 || error.category === 'denied') ? 'forbidden' : 'unavailable');
      });
    return () => controller.abort();
  }, [api, isLoaded, isSignedIn, sessionId, state.path, state.tenantId, state.cacheEpoch, state.streamEpoch]);

  return (
    <main className="shell">
      <header>
        <a className="brand" href="/">Platform</a>
        <Show when="signed-out">
          <SignInButton forceRedirectUrl={state.path}><button type="button">Sign in</button></SignInButton>
          <SignUpButton forceRedirectUrl={state.path}><button type="button">Sign up</button></SignUpButton>
        </Show>
        <Show when="signed-in"><UserButton /></Show>
      </header>
      {view === 'loading' && <p aria-live="polite">Checking your session…</p>}
      {view === 'signed-out' && <State title="Sign in required">Sign in to continue to the requested page.</State>}
      {view === 'no-membership' && <State title="No Tenant membership">Your signed-in account does not currently have access to a platform Tenant.</State>}
      {view === 'forbidden' && <State title="Access changed">Your session or Tenant membership is no longer allowed. Refresh after your access is restored.</State>}
      {view === 'unavailable' && <State title="Platform unavailable">The session could not be projected safely. Try again shortly.</State>}
      {view === 'ready' && <TenantShell state={state} onTenantChange={(tenantId) => setState((current) => selectTenant(current, tenantId))} />}
    </main>
  );
}

function TenantShell({ state, onTenantChange }: { state: BrowserState; onTenantChange: (tenantId: string) => void }) {
  return <>
    <section className="context" aria-label="Platform context">
      <label>Tenant <select value={state.tenantId} onChange={(event) => onTenantChange(event.target.value)}>{state.tenantIds.map((tenantId) => <option key={tenantId} value={tenantId}>{tenantId}</option>)}</select></label>
    </section>
    <nav aria-label="Product surfaces">
      <a href="/studio">Solution Studio</a>
      <a href="/catalog">Governed Catalog</a>
      <a href="/operations">Operations Control Plane</a>
    </nav>
    <State title="Tenant shell ready">Select a surface to load its Tenant-scoped projection. Changing Tenant clears the prior scoped cache and cancels its active requests.</State>
  </>;
}

function State({ title, children }: { title: string; children: string }) {
  return <section className="state" aria-live="polite"><h1>{title}</h1><p>{children}</p><a href="/">Return home</a></section>;
}

function restorePath(path: string): void {
  if (`${window.location.pathname}${window.location.search}` !== path) window.history.replaceState(null, '', path);
}

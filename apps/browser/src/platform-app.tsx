import { Badge, Button, Card, CardHeader, Dropdown, MessageBar, MessageBarBody, Option, Spinner, Text, Title1, Title2 } from '@fluentui/react-components';
import { Show, SignInButton, SignUpButton, UserButton, useAuth } from '@clerk/react';
import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import { PlatformApi, PlatformApiError, type Projection } from './platform-api.js';
import { routeForPath, routeHref, routesForSurface, type CollectionRoute, type Surface } from './platform-routes.js';
import { browserState, selectPath, selectTenant, signedIn, signedOut, type BrowserState } from './session-state.js';

type View = 'loading' | 'ready' | 'signed-out' | 'no-membership' | 'forbidden' | 'unavailable';
const surfaceLabels: Record<Surface, string> = { studio: 'Solution Studio', catalog: 'Governed Catalog', operations: 'Operations', technical: 'Technical Implementation', vendor: 'Vendor Risk & Access' };

export function App() {
  const { getToken, isLoaded, isSignedIn, sessionId } = useAuth();
  const [state, setState] = useState<BrowserState>(() => browserState(`${window.location.pathname}${window.location.search}`));
  const [view, setView] = useState<View>('loading');
  const apiOrigin = (import.meta.env['VITE_PLATFORM_API_ORIGIN'] ?? '').replace(/\/+$/u, '');
  const api = useMemo(() => new PlatformApi(getToken, apiOrigin), [getToken, apiOrigin]);

  useEffect(() => {
    const restore = () => setState((current) => selectPath(current, `${window.location.pathname}${window.location.search}`));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const navigate = (path: string) => {
    if (!path.startsWith('/') || path.startsWith('//')) return;
    if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState(null, '', path);
    setState((current) => selectPath(current, path));
  };

  const navigateLink = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (link === null) return;
    const href = link.getAttribute('href');
    if (href === null || link.target && link.target !== '_self' || link.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  };

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setState((current) => current.tenantId === undefined ? current : signedOut(current));
      setView('signed-out');
      return;
    }
    const controller = new AbortController();
    void Promise.all([api.session(state.tenantId, controller.signal), api.tenants(controller.signal)]).then(([session, tenants]) => {
      if (tenants.length === 0 || !tenants.some((tenant) => tenant.id === session.tenantId)) {
        setView('no-membership');
        return;
      }
      setState((current) => signedIn(current, { tenantId: session.tenantId, tenantIds: tenants.map((tenant) => tenant.id), sessionId }));
      setView('ready');
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setView(error instanceof PlatformApiError && error.status === 401 ? 'signed-out' : error instanceof PlatformApiError && (error.status === 403 || error.status === 404 || error.status === 400 || error.category === 'denied') ? 'forbidden' : 'unavailable');
    });
    return () => controller.abort();
  }, [api, isLoaded, isSignedIn, sessionId, state.tenantId, state.cacheEpoch, state.streamEpoch]);

  return <main className="shell" onClick={navigateLink}><header className="app-header"><a className="brand" href="/studio">Platform Control</a><span className="environment">Authorized workspace</span><Show when="signed-out"><SignInButton forceRedirectUrl={state.path}><Button appearance="primary">Sign in</Button></SignInButton><SignUpButton forceRedirectUrl={state.path}><Button>Sign up</Button></SignUpButton></Show><Show when="signed-in"><UserButton /></Show></header>{view === 'loading' && <Loading label="Checking your authorized session" />}{view === 'signed-out' && <State title="Sign in required">Sign in to load the requested Tenant-scoped projection.</State>}{view === 'no-membership' && <State title="No Tenant membership">Your account does not currently have access to a platform Tenant.</State>}{view === 'forbidden' && <State title="Access changed">This object is unavailable to the current session. No record details were revealed.</State>}{view === 'unavailable' && <State title="Platform unavailable">The session could not be projected safely. Try again shortly.</State>}{view === 'ready' && state.tenantId !== undefined && <TenantShell api={api} state={state} onTenantChange={(tenantId) => setState((current) => selectTenant(current, tenantId))} />}</main>;
}

function TenantShell({ api, state, onTenantChange }: { api: PlatformApi; state: BrowserState; onTenantChange: (tenantId: string) => void }) {
  const current = routeForPath(state.path);
  const tenantId = state.tenantId;
  const [projection, setProjection] = useState<Projection>();
  if (tenantId === undefined) return null;
  return <><section className="context" aria-label="Projection context"><label>Tenant <Dropdown value={tenantId} onOptionSelect={(_, data) => data.optionValue !== undefined && onTenantChange(data.optionValue)}>{state.tenantIds.map((availableTenantId) => <Option key={availableTenantId} value={availableTenantId}>{availableTenantId}</Option>)}</Dropdown></label><Badge appearance="outline">Environment: not reported</Badge><Badge appearance="outline">Classification: {projection?.classification ?? 'loading'}</Badge><Badge appearance="outline">{current.id === undefined ? `View: ${current.route.label}` : `Object: ${current.id}`}</Badge></section><nav className="product-nav" aria-label="Product surfaces">{(Object.keys(surfaceLabels) as Surface[]).map((surface) => <Nav key={surface} href={`/${surface}`} active={current.route.surface === surface}>{surfaceLabels[surface]}</Nav>)}</nav><div className="workspace"><aside className="collection-nav" aria-label={`${surfaceLabels[current.route.surface]} views`}><Text weight="semibold">{surfaceLabels[current.route.surface]}</Text>{routesForSurface(current.route.surface).map((route) => <a key={`${route.surface}-${route.collection}`} className={route.collection === current.route.collection ? 'active' : undefined} aria-current={route.collection === current.route.collection ? 'page' : undefined} href={routeHref(route)}>{route.label}</a>)}</aside><SurfaceView api={api} tenantId={tenantId} route={current.route} id={current.id} epoch={state.cacheEpoch} onProjection={setProjection} /></div></>;
}

function SurfaceView({ api, tenantId, route, id, epoch, onProjection }: { api: PlatformApi; tenantId: string; route: CollectionRoute; id: string | undefined; epoch: number; onProjection: (projection: Projection | undefined) => void }) {
  const [projection, setProjection] = useState<Projection>();
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setProjection(undefined);
    onProjection(undefined);
    setError(false);
    void api.projection(tenantId, route.collection, id, controller.signal).then((next) => { setProjection(next); onProjection(next); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [api, tenantId, route.collection, id, epoch, refresh, onProjection]);
  return <section className="surface" aria-labelledby="surface-title"><div className="surface-heading"><div><Title1 id="surface-title">{id === undefined ? route.label : `${route.label} detail`}</Title1><Text className="intro">{route.description}</Text></div><Button onClick={() => setRefresh((current) => current + 1)}>Refresh</Button></div>{error ? <State title="Projection unavailable">The requested projection could not be loaded safely.</State> : projection === undefined ? <Loading label="Loading server-authorized projection" /> : <ProjectionView projection={projection} route={route} detail={id !== undefined} />}</section>;
}

function ProjectionView({ projection, route, detail }: { projection: Projection; route: CollectionRoute; detail: boolean }) {
  const blocked = projection.completeness !== 'full' || projection.classification === 'fixture' || projection.records.some((record) => record['freshness'] !== 'current' || record['state'] === 'unavailable' || record['state'] === 'not-ready' || record['redaction'] === 'applied');
  return <><div className="evidence-strip" aria-label="Evidence state"><Badge color="informative">Classification: {projection.classification}</Badge><Badge appearance="outline">Freshness: {projection.freshness}</Badge><Badge appearance="outline">Completeness: {projection.completeness}</Badge><Badge appearance="outline">Redaction: {projection.redaction}</Badge>{projection.publishedAt !== undefined && <Badge appearance="outline">Published: {projection.publishedAt}</Badge>}{projection.watermark !== undefined && <Badge appearance="outline">Watermark: {projection.watermark}</Badge>}</div>{blocked && <MessageBar intent="warning"><MessageBarBody>This projection cannot support an owner action until the server reports complete, current, non-redacted evidence and the required owner prerequisite.</MessageBarBody></MessageBar>}{projection.records.length === 0 ? projection.completeness === 'not-ready' ? <State title="Projection not ready">The owner has not published this collection yet.</State> : <State title="No authorized records">There are no records available at this scope.</State> : <div className={detail ? 'detail-stack' : 'projection-grid'}>{projection.records.map((record) => <RecordCard key={String(record['id'])} record={record} route={route} detail={detail} />)}</div>}{detail && <ActionPrerequisite route={route} blocked={blocked} />}</>;
}

function RecordCard({ record, route, detail }: { record: Record<string, unknown>; route: CollectionRoute; detail: boolean }) {
  const heading = String(record['title'] ?? record['name'] ?? record['vendor'] ?? record['id']);
  const id = typeof record['id'] === 'string' ? record['id'] : undefined;
  const content = <Card className="record-card"><CardHeader header={<Title2>{heading}</Title2>} description={<Text>{id ?? 'No stable identifier'}</Text>} /><dl>{Object.entries(record).filter(([key]) => !['id', 'title', 'name', 'vendor'].includes(key)).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{display(value)}</dd></div>)}</dl></Card>;
  return detail || id === undefined || !opaqueId(id) ? content : <a className="record-link" href={routeHref(route, id)} aria-label={`View ${heading}`}>{content}</a>;
}

function ActionPrerequisite({ route, blocked }: { route: CollectionRoute; blocked: boolean }) {
  return <section className="action-prerequisite" aria-label="Owner action status"><Title2>Owner action status</Title2><p>{blocked ? 'Action unavailable for this projection. ' : 'No executable owner command was supplied with this projection. '}{route.commandPrerequisite}</p></section>;
}

function Loading({ label }: { label: string }) { return <div className="loading" aria-live="polite"><Spinner size="medium" label={label} /></div>; }
function State({ title, children }: { title: string; children: string }) { return <section className="state" aria-live="polite"><Title1>{title}</Title1><p>{children}</p><a href="/studio">Return to Solution Studio</a></section>; }
function Nav({ href, active, children }: { href: string; active: boolean; children: string }) { return <a className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined} href={href}>{children}</a>; }
function display(value: unknown): string { return typeof value === 'string' ? value : value === null ? 'None' : JSON.stringify(value); }
function opaqueId(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value); }
function label(value: string) { return value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()); }

import { SignInButton, useAuth } from '@clerk/react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { connect, createNode, disconnect, initialEdges, initialNodes, starterEdges, starterNodes, templates, type TriggerSchema, type WorkflowEdge, type WorkflowNode, type WorkflowNodeKind } from './workflow-model.js';
import { PlatformApi, PlatformApiError, describeError, type CommandReceipt, type ErrorKind, type Projection } from './platform-api.js';
import { ConnectorPanel } from './connector-panel.js';
import { MemoryImportPanel } from './memory-import-panel.js';
import { WebhookPanel } from './webhook-panel.js';
import { Field, StatePage } from './ui.js';
import { AttachedItem, Inspector, blockHelp, type InspectorTab, type OpenRouterModel } from './inspector.js';
import { RunHistory } from './run-history.js';
import type { GraphDraft } from '../../../packages/workflow/src/graph.js';

type StudioTab = 'canvas' | 'harness' | 'evaluations' | 'versions';
type DragState = { id: string; offsetX: number; offsetY: number } | undefined;
type SecondaryProjection = 'definitions' | 'runs' | 'connection' | 'models';
type ProjectionLoadState = 'loading' | 'ready' | 'failed';
const loadingSecondaryProjections: Record<SecondaryProjection, ProjectionLoadState> = { definitions: 'loading', runs: 'loading', connection: 'loading', models: 'loading' };
const liveLibrary: readonly { title: string; items: readonly { kind: WorkflowNodeKind; label: string }[] }[] = [
  { title: 'Logic', items: [{ kind: 'trigger', label: 'Trigger' }, { kind: 'agent', label: 'Agent step' }, { kind: 'condition', label: 'Condition' }, { kind: 'approval', label: 'Human approval' }, { kind: 'end', label: 'End' }] },
  { title: 'Knowledge', items: [{ kind: 'memory', label: 'Memory' }] },
  { title: 'Connections', items: [{ kind: 'mcp', label: 'MCP server' }] },
];
const fixtureLibrary = [...liveLibrary, { title: 'Fixture-only', items: [{ kind: 'skill' as const, label: 'Skill' }, { kind: 'retriever' as const, label: 'Retriever' }, { kind: 'http' as const, label: 'HTTP request' }, { kind: 'webhook' as const, label: 'Webhook' }] }];
const scene = { width: 1600, height: 900, minimumZoom: .5, maximumZoom: 1.2, padding: 80 };
type SaveState = 'unsaved' | 'saving' | 'saved' | 'failed';

export function AuthenticatedStudio() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const api = useMemo(() => new PlatformApi(getToken), [getToken]);
  const [tenants, setTenants] = useState<readonly { id: string; profiles: readonly string[] }[]>([]);
  const [tenantId, setTenantId] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<ErrorKind>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!isSignedIn) { setTenants([]); setTenantId(undefined); setLoaded(false); setFailure(undefined); return; }
    setFailure(undefined);
    setLoaded(false);
    const controller = new AbortController();
    void api.tenants(controller.signal).then((items) => {
      setTenants(items);
      setTenantId((current) => items.some((item) => item.id === current) ? current : items[0]?.id);
      setLoaded(true);
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setFailure(describeError(error));
    });
    return () => controller.abort();
  }, [api, isSignedIn, attempt]);
  if (!isLoaded) return <StatePage busy title="Opening your workspace">Checking your session…</StatePage>;
  if (!isSignedIn || failure === 'signed-out') return <StatePage title="Sign in required" actions={<SignInButton mode="modal" forceRedirectUrl={location.pathname}><button className="button">Sign in</button></SignInButton>}>Sign in to save and run workflows.</StatePage>;
  if (failure === 'denied') return <StatePage title="Access denied" actions={<a className="button-secondary" href="/">Home</a>}>Your account can't open this workspace.</StatePage>;
  if (failure !== undefined) return <StatePage title="Service unavailable" actions={<><button className="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button><a className="button-secondary" href="/">Home</a></>}>Workspace access is unavailable. Try again.</StatePage>;
  if (loaded && tenants.length === 0) return <StatePage title="No workspace" actions={<a className="button-secondary" href="/">Home</a>}>Your account isn't a member of any workspace yet. Ask a workspace admin to invite you.</StatePage>;
  if (!tenantId) return <StatePage busy title="Opening your workspace">Checking your session…</StatePage>;
  const profiles = tenants.find((item) => item.id === tenantId)?.profiles ?? [];
  return <StudioEditor key={tenantId} api={api} tenantId={tenantId} admin={profiles.includes('admin')} editor={profiles.includes('editor')} operator={profiles.includes('operator')} tenants={tenants} setTenantId={setTenantId} />;
}

export function StudioEditor({ api, tenantId, admin = false, editor = false, operator = false, tenants = [], setTenantId }: { api?: PlatformApi; tenantId?: string; admin?: boolean; editor?: boolean; operator?: boolean; tenants?: readonly { id: string; profiles: readonly string[] }[]; setTenantId?: (id: string) => void }) {
  const live = api !== undefined && tenantId !== undefined;
  const canvas = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>(live ? starterNodes : initialNodes);
  const [edges, setEdges] = useState<WorkflowEdge[]>(live ? starterEdges : initialEdges);
  const [selected, setSelected] = useState<string | undefined>(live ? 'agent' : 'plan');
  const [tab, setTab] = useState<InspectorTab>('instructions');
  const [studioTab, setStudioTab] = useState<StudioTab>('canvas');
  const [connecting, setConnecting] = useState<{ id: string; branch?: 'true' | 'false' }>();
  const [dragging, setDragging] = useState<DragState>();
  const [zoom, setZoom] = useState(0.8);
  const zoomRef = useRef(zoom);
  const [sequence, setSequence] = useState(1);
  const [revision, setRevision] = useState(live ? 0 : 4);
  const [draftId, setDraftId] = useState<string>();
  const [savedGraph, setSavedGraph] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>(live ? 'unsaved' : 'saved');
  const [conflict, setConflict] = useState(false);
  const [candidate, setCandidate] = useState<string>();
  const [publishedId, setPublishedId] = useState<string>();
  const [runs, setRuns] = useState<Projection>();
  const [definitions, setDefinitions] = useState<Projection>();
  const [openRouterConnection, setOpenRouterConnection] = useState<Projection>();
  const [openRouterModels, setOpenRouterModels] = useState<readonly OpenRouterModel[]>([]);
  const [secondaryProjections, setSecondaryProjections] = useState<Record<SecondaryProjection, ProjectionLoadState>>(loadingSecondaryProjections);
  const [loadingOlderRuns, setLoadingOlderRuns] = useState(false);
  const loadGeneration = useRef(0);
  const [issues, setIssues] = useState<readonly { path: string; code: string; message: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [evaluated, setEvaluated] = useState(false);
  const [model, setModel] = useState(live ? 'gpt-4.1' : 'Atlas 2.1');
  const [maxSteps, setMaxSteps] = useState(12);
  const selectedNode = nodes.find((node) => node.id === selected);
  const trigger = nodes.find((node) => node.kind === 'trigger');
  const webhook = trigger?.config?.['mode'] === 'webhook';
  const openRouterConnectionState = typeof openRouterConnection?.records[0]?.['state'] === 'string' ? openRouterConnection.records[0]['state'] : 'checking';
  const webhookSchema = trigger?.config?.['inputSchema'] as TriggerSchema ?? { type: 'object', properties: {}, required: [], additionalProperties: false };
  const graphDraft = (): GraphDraft => ({ kind: 'graph-v1', nodes: nodes.map((node) => ({ ...node, config: node.config ?? {} })), edges });
  const graphKey = (graph: GraphDraft) => JSON.stringify(graph);
  const currentGraph = graphDraft();
  const hasUnsavedChanges = live && savedGraph !== graphKey(currentGraph);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    if (!api || !tenantId) return;
    const generation = ++loadGeneration.current;
    const current = () => loadGeneration.current === generation;
    const controller = new AbortController();
    setDraftId(undefined); setRevision(0); setSavedGraph(undefined); setSaveState('unsaved'); setConflict(false); setPublishedId(undefined); setRuns(undefined); setDefinitions(undefined); setOpenRouterConnection(undefined); setOpenRouterModels([]); setSecondaryProjections(loadingSecondaryProjections);
    const setSecondaryProjection = (projection: SecondaryProjection, state: ProjectionLoadState) => current() && setSecondaryProjections((value) => ({ ...value, [projection]: state }));
    void api.projection(tenantId, 'workflow-drafts', undefined, controller.signal).then((drafts) => {
      if (!current()) return;
      const latest = drafts.records[0];
      if (latest && typeof latest['id'] === 'string' && typeof latest['revision'] === 'number' && latest['graph'] && typeof latest['graph'] === 'object') {
        const saved = latest['graph'] as GraphDraft; setDraftId(latest['id']); setRevision(latest['revision']); setNodes(saved.nodes as WorkflowNode[]); setEdges(saved.edges as WorkflowEdge[]); setSelected(saved.nodes[0]?.id); setSavedGraph(graphKey(saved)); setSaveState('saved'); setConflict(false);
      } else { setDraftId(crypto.randomUUID()); setSavedGraph(undefined); setSaveState('unsaved'); }
    }).catch(() => current() && setNotice('Saved workflow data could not be loaded.'));
    void api.projection(tenantId, 'workflow-definitions', undefined, controller.signal).then((projection) => { if (!current()) return; setDefinitions(projection); setSecondaryProjection('definitions', 'ready'); }).catch(() => setSecondaryProjection('definitions', 'failed'));
    void api.projection(tenantId, 'workflow-runs', undefined, controller.signal, { pageSize: 50 }).then((projection) => { if (!current()) return; setRuns(projection); setSecondaryProjection('runs', 'ready'); }).catch(() => setSecondaryProjection('runs', 'failed'));
    void api.projection(tenantId, 'openrouter-connections', undefined, controller.signal).then((projection) => { if (!current()) return; setOpenRouterConnection(projection); setSecondaryProjection('connection', 'ready'); }).catch(() => setSecondaryProjection('connection', 'failed'));
    void api.projection(tenantId, 'openrouter-models', undefined, controller.signal).then((modelPolicy) => {
      if (!current()) return;
      const models = modelPolicy.records[0]?.['models'];
      setOpenRouterModels(Array.isArray(models) ? models.flatMap((item) => item !== null && typeof item === 'object' && typeof (item as Record<string, unknown>)['id'] === 'string' && typeof (item as Record<string, unknown>)['structuredOutput'] === 'boolean' ? [{ id: (item as Record<string, unknown>)['id'] as string, structuredOutput: (item as Record<string, unknown>)['structuredOutput'] as boolean }] : []) : []);
      setSecondaryProjection('models', 'ready');
    }).catch(() => setSecondaryProjection('models', 'failed'));
    return () => { controller.abort(); if (current()) loadGeneration.current += 1; };
  }, [api, tenantId]);
  useEffect(() => { const published = definitions?.records.find((item) => item['draftId'] === draftId); setPublishedId(typeof published?.['id'] === 'string' ? published['id'] : undefined); }, [definitions, draftId]);
  const point = (clientX: number, clientY: number) => {
    const rect = canvas.current?.getBoundingClientRect();
    const element = canvas.current;
    return rect === undefined || element === null ? { x: 320, y: 280 } : { x: Math.max(80, Math.round((element.scrollLeft + clientX - rect.left) / zoom)), y: Math.max(70, Math.round((element.scrollTop + clientY - rect.top) / zoom)) };
  };
  const zoomTo = (requested: number, anchorX?: number, anchorY?: number, focus?: { x: number; y: number }) => {
    const element = canvas.current;
    const next = Math.max(scene.minimumZoom, Math.min(scene.maximumZoom, requested));
    if (element === null) { setZoom(next); return; }
    const x = anchorX ?? element.clientWidth / 2;
    const y = anchorY ?? element.clientHeight / 2;
    const currentZoom = zoomRef.current;
    const target = focus ?? { x: (element.scrollLeft + x) / currentZoom, y: (element.scrollTop + y) / currentZoom };
    zoomRef.current = next;
    setZoom(next);
    requestAnimationFrame(() => { element.scrollLeft = target.x * next - x; element.scrollTop = target.y * next - y; });
  };
  const fit = () => {
    const element = canvas.current;
    if (element === null) return;
    const bounds = nodes.length === 0 ? { left: 640, right: 960, top: 330, bottom: 570 } : nodes.reduce((current, node) => {
      const rendered = Array.from(element.querySelectorAll<HTMLElement>('[data-workflow-node]')).find((item) => item.dataset['workflowNode'] === node.id)?.getBoundingClientRect();
      const width = (rendered?.width ?? 186 * zoom) / zoom;
      const height = (rendered?.height ?? 82 * zoom) / zoom;
      return { left: Math.min(current.left, node.x - width / 2), right: Math.max(current.right, node.x + width / 2), top: Math.min(current.top, node.y - height / 2), bottom: Math.max(current.bottom, node.y + height / 2) };
    }, { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
    const width = bounds.right - bounds.left + scene.padding * 2;
    const height = bounds.bottom - bounds.top + scene.padding * 2;
    zoomTo(Math.min(element.clientWidth / width, element.clientHeight / height), element.clientWidth / 2, element.clientHeight / 2, { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 });
  };
  const add = (kind: WorkflowNodeKind, x = 760, y = 540) => {
    if (live && kind === 'trigger' && nodes.some((node) => node.kind === 'trigger')) { setNotice('A workflow has one Trigger. Select the existing start node.'); setSelected(nodes.find((node) => node.kind === 'trigger')!.id); return; }
    const node = createNode(kind, x, y, sequence);
    setSequence((value) => value + 1); setNodes((value) => [...value, node]); setCandidate(undefined); setSelected(node.id); setStudioTab('canvas'); setNotice(`${templates[kind].title} added. Select its output port, then an input port to connect it.`);
  };
  const remove = (id: string) => {
    setNodes((value) => value.filter((node) => node.id !== id));
    setEdges((value) => value.filter((edge) => edge.from !== id && edge.to !== id));
    setSelected((value) => value === id ? undefined : value);
    setConnecting((value) => value?.id === id ? undefined : value);
    setDragging((value) => value?.id === id ? undefined : value);
    setCandidate(undefined);
  };
  const updateNode = (id: string, patch: Partial<Pick<WorkflowNode, 'title' | 'instructions' | 'config'>>) => { setNodes((value) => value.map((node) => node.id === id ? { ...node, ...patch } : node)); setCandidate(undefined); };
  const save = async () => {
    if (!api || !tenantId) { setNotice('Fixture preview only. Sign in to save a live revision.'); return; }
    const id = draftId ?? crypto.randomUUID();
    const requestGraph = graphDraft();
    const requestKey = graphKey(requestGraph);
    setDraftId(id);
    setSaveState('saving');
    setConflict(false);
    setRunning(true);
    try {
      const result: CommandReceipt = await api.command({ tenantId, owner: 'studio', name: revision ? 'save-draft' : 'create-draft', expectedVersion: revision, arguments: { id, draft: requestGraph } });
      const drafts = await api.projection(tenantId, 'workflow-drafts');
      const confirmed = drafts.records.find((record) => record['id'] === id && record['revision'] === result.revision);
      if (confirmed === undefined) throw new PlatformApiError(502);
      setRevision(result.revision); setSavedGraph(requestKey); setSaveState('saved'); setCandidate(undefined); setIssues([]); setNotice(`Saved as revision ${result.revision}.`);
    } catch (error) { const stale = error instanceof PlatformApiError && (error.status === 409 || error.category === 'conflict'); setConflict(stale); setSaveState('failed'); setNotice(stale ? 'This draft has a newer saved revision. Reload it before retrying.' : 'Save failed. Your local edits are still available.'); }
    finally { setRunning(false); }
  };
  const reload = async () => {
    if (!api || !tenantId || !draftId) return;
    setRunning(true);
    try {
      const drafts = await api.projection(tenantId, 'workflow-drafts');
      const latest = drafts.records.find((record) => record['id'] === draftId);
      if (!latest || typeof latest['revision'] !== 'number' || latest['graph'] === null || typeof latest['graph'] !== 'object') throw new PlatformApiError(404);
      const saved = latest['graph'] as GraphDraft;
      setNodes(saved.nodes as WorkflowNode[]); setEdges(saved.edges as WorkflowEdge[]); setSelected(saved.nodes[0]?.id); setRevision(latest['revision']); setSavedGraph(graphKey(saved)); setSaveState('saved'); setCandidate(undefined); setIssues([]); setConflict(false); setNotice(`Reloaded revision ${latest['revision']}.`);
    } catch { setNotice('The current draft could not be reloaded. Your local edits are unchanged.'); }
    finally { setRunning(false); }
  };
  const run = async () => {
    if (!api || !tenantId || !draftId || !revision || hasUnsavedChanges) { setNotice('Save the current canvas before checking it.'); return; }
    setRunning(true);
    try {
      const result = await api.command({ tenantId, owner: 'workflow', name: 'check', expectedVersion: revision, arguments: { id: draftId } });
      setIssues(result.issues ?? []); setCandidate(result.state === 'passed' ? result.digest : undefined);
      setNotice(result.state === 'passed' ? `Revision ${revision} passed server checks. Review digest ${result.digest}.` : `${result.issues?.length ?? 0} issue(s) need attention.`);
    } catch { setNotice('Server check is unavailable.'); }
    finally { setRunning(false); }
  };
  const publish = async () => {
    if (!api || !tenantId || !draftId || !candidate || !admin || hasUnsavedChanges) return;
    setRunning(true);
    try { const result = await api.command({ tenantId, owner: 'workflow', name: 'publish', expectedVersion: revision, arguments: { id: draftId, reviewDigest: candidate } }); setPublishedId(result.objectId); setNotice(`Published definition ${result.objectId}.`); }
    catch { setNotice('Publication was denied or the review is stale. Run a new check.'); }
    finally { setRunning(false); }
  };
  const refreshRuns = async () => { if (api && tenantId) { setSecondaryProjections((value) => ({ ...value, runs: 'loading' })); try { setRuns(await api.projection(tenantId, 'workflow-runs', undefined, undefined, { pageSize: 50 })); setSecondaryProjections((value) => ({ ...value, runs: 'ready' })); } catch (error) { setSecondaryProjections((value) => ({ ...value, runs: 'failed' })); throw error; } } };
  const loadOlderRuns = async () => {
    const cursor = runs?.continuation?.cursor;
    if (!api || !tenantId || !cursor) return;
    setLoadingOlderRuns(true);
    try {
      const older = await api.projection(tenantId, 'workflow-runs', undefined, undefined, { pageSize: 50, cursor });
      setRuns((current) => current === undefined ? older : { ...older, records: [...current.records, ...older.records] });
    } catch { setNotice('Older Run History could not be loaded.'); }
    finally { setLoadingOlderRuns(false); }
  };
  const start = async (value: unknown) => {
    if (!api || !tenantId || !publishedId) return;
    const input = value !== null && typeof value === 'object' && !('nativeEvent' in value) ? value as Record<string, unknown> : {};
    setRunning(true);
    try { const result = await api.command({ tenantId, owner: 'workflow', name: 'start', expectedVersion: 0, arguments: { id: publishedId, input } }); setNotice(`Run ${result.objectId} queued.`); await refreshRuns(); }
    catch { setNotice('Run could not start. Check the published input schema and provider configuration.'); }
    finally { setRunning(false); }
  };
  useEffect(() => { const listener = (event: Event) => void start((event as CustomEvent<Record<string, unknown>>).detail); window.addEventListener('workflow-start', listener); return () => window.removeEventListener('workflow-start', listener); });
  const decide = async (runId: string, bindingDigest: string, decision: 'approve' | 'reject', version: number) => {
    if (!api || !tenantId) return;
    try { await api.command({ tenantId, owner: 'workflow', name: 'approve', expectedVersion: version, arguments: { id: runId, bindingDigest, decision } }); await refreshRuns(); }
    catch { setNotice('Approval is stale or was denied. Refresh run status.'); }
  };
  const reconcile = async (runId: string, version: number, disposition: 'adopt' | 'no-effect') => {
    if (!api || !tenantId) return;
    try { await api.command({ tenantId, owner: 'workflow', name: 'reconcile', expectedVersion: version, arguments: { id: runId, disposition } }); await refreshRuns(); }
    catch { setNotice('Reconciliation could not be recorded. Refresh run status.'); }
  };
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const kind = event.dataTransfer.getData('application/workflow-kind') as WorkflowNodeKind; if (kind in templates) { const location = point(event.clientX, event.clientY); add(kind, location.x, location.y); } };
  const beginDrag = (event: ReactPointerEvent<HTMLElement>, node: WorkflowNode) => { if ((event.target as HTMLElement).closest('.port')) return; const location = point(event.clientX, event.clientY); event.currentTarget.setPointerCapture(event.pointerId); setSelected(node.id); setDragging({ id: node.id, offsetX: location.x - node.x, offsetY: location.y - node.y }); };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => { if (dragging === undefined) return; const location = point(event.clientX, event.clientY); setNodes((value) => value.map((node) => node.id === dragging.id ? { ...node, x: Math.max(80, location.x - dragging.offsetX), y: Math.max(70, location.y - dragging.offsetY) } : node)); setCandidate(undefined); };
  const endDrag = () => setDragging(undefined);
  const wheel = (event: ReactWheelEvent<HTMLDivElement>) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); zoomTo(zoomRef.current * Math.exp(-event.deltaY * .001), event.clientX - rect.left, event.clientY - rect.top); };
  const canvasKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, [contenteditable="true"]'))) return;
    const direction = event.key === '+' || event.key === '=' ? 1 : event.key === '-' || event.key === '_' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    zoomTo(zoom + direction * .1);
  };
  const saveLabel = !live ? 'Fixture preview' : saveState === 'saving' ? 'Saving' : saveState === 'failed' ? 'Save failed' : hasUnsavedChanges ? 'Unsaved changes' : revision ? `Saved as revision ${revision}` : 'Unsaved changes';
  const heading = live ? draftId && revision ? `Draft ${draftId} · revision ${revision}` : 'Three-step live example' : 'Fixture preview example';
  return <section className="studio-shell"><div className="product-heading"><div><p>Solution Studio <span>/</span> {live ? 'Live workspace' : 'Fixture content'}</p><h1>{heading}</h1>{live && !draftId && <p>Manual start → Classify request → End</p>}{live && tenants.length > 1 && <select aria-label="Workspace" value={tenantId} onChange={(event) => setTenantId?.(event.target.value)}>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.id}</option>)}</select>}</div><div className="product-heading-actions"><span className={`save-state save-${saveState}`}><i /> {saveLabel}</span>{live && draftId && <details className="draft-details"><summary>Draft details</summary><code>{draftId}</code></details>}<button className="button-secondary" onClick={run} disabled={running || !live || !revision || hasUnsavedChanges || !(editor || admin)}>{running ? 'Checking…' : 'Run check'}</button><button className="button" onClick={save} disabled={running || !live || !(editor || admin)}>Save revision</button>{conflict && <button className="button-secondary" onClick={reload} disabled={running}>Reload saved revision</button>}{admin && candidate && !hasUnsavedChanges && <button className="button-secondary" onClick={publish} disabled={running}>Publish reviewed digest</button>}{publishedId && !webhook && (operator || admin) && <button className="button-secondary" onClick={start} disabled={running}>Start run</button>}</div></div>{live && <div className="studio-live-status"><strong>{candidate ? `Checked digest ${candidate}` : 'No current publishable check'}</strong>{issues.length > 0 && <ul>{issues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.path}: {issue.message}</li>)}</ul>}{secondaryProjections.definitions === 'failed' && <span role="alert">Publication details could not be loaded.</span>}{secondaryProjections.runs === 'loading' && <span>Loading Run History.</span>}{secondaryProjections.runs === 'failed' && <span role="alert">Run History could not be loaded.</span>}{secondaryProjections.connection === 'failed' && <span role="alert">Provider status could not be loaded.</span>}{secondaryProjections.models === 'failed' && <span role="alert">Provider models could not be loaded.</span>}{publishedId && <span> Published definition {publishedId}</span>}</div>}{live && api && tenantId && <ConnectorPanel api={api} tenantId={tenantId} draftId={draftId} node={selectedNode} nodes={nodes} edges={edges} admin={admin} connection={openRouterConnection} connectionState={secondaryProjections.connection} onPin={(config) => { if (selectedNode) updateNode(selectedNode.id, { config }); }} />}{live && api && tenantId && publishedId && <WebhookPanel api={api} tenantId={tenantId} definitionId={publishedId} webhook={webhook} admin={admin} schema={webhookSchema} onAccepted={(runId) => { void refreshRuns(); window.location.hash = `run-${runId}`; }} />}{live && api && tenantId && publishedId && <MemoryImportPanel api={api} tenantId={tenantId} definitionId={publishedId} admin={admin} definitions={definitions} definitionsState={secondaryProjections.definitions} runs={runs} runsState={secondaryProjections.runs} />}{live && runs && <RunHistory records={runs.records} admin={admin} decide={decide} reconcile={reconcile} loadOlder={loadOlderRuns} hasMore={runs.continuation !== undefined} loadingOlder={loadingOlderRuns} />}<div className="studio-tabs" role="tablist" aria-label="Solution authoring"><button className={studioTab === 'canvas' ? 'active' : ''} onClick={() => setStudioTab('canvas')}>Canvas</button>{!live && <><button className={studioTab === 'harness' ? 'active' : ''} onClick={() => setStudioTab('harness')}>Harness</button><button className={studioTab === 'evaluations' ? 'active' : ''} onClick={() => setStudioTab('evaluations')}>Evaluations</button><button className={studioTab === 'versions' ? 'active' : ''} onClick={() => setStudioTab('versions')}>Versions</button></>}</div>{studioTab === 'canvas' && <div className="studio-workspace"><aside className="node-library"><div className="panel-title"><strong>Building blocks</strong><span>Drag to canvas</span></div><label className="search-field"><span>⌕</span><input aria-label="Search blocks" placeholder="Search blocks" /></label>{(live ? liveLibrary : fixtureLibrary).map((group) => <LibraryGroup key={group.title} title={group.title} items={group.items} add={add} />)}<button className="library-add" onClick={() => add('agent')}>+ Add agent step</button></aside><div ref={canvas} className="workflow-canvas" tabIndex={0} aria-label="Workflow canvas" onDragOver={(event) => event.preventDefault()} onDrop={drop} onPointerMove={move} onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={wheel} onKeyDown={canvasKeyDown}><div className="canvas-tools"><button onClick={() => zoomTo(zoom - .1)} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => zoomTo(zoom + .1)} aria-label="Zoom in">+</button><button onClick={fit}>Fit</button></div><div className="canvas-help">Drag blocks in. Drag a node. Select an output port, then an input port to connect. Use + / − to zoom; Fit frames the workflow.</div><div className="canvas-grid" />{nodes.length === 0 && <div className="empty-canvas"><strong>This draft has no steps.</strong><span>A valid published workflow needs one Trigger and an End.</span><button className="button" onClick={() => add('trigger')}>Add Trigger</button></div>}<div className="workflow-scroll-area" style={{ width: scene.width * zoom, height: scene.height * zoom }}><div className="workflow-scene" style={{ transform: `scale(${zoom})` }}><svg className="workflow-edges" viewBox="0 0 1600 900" aria-label="Workflow connections">{edges.map((edge) => { const from = nodes.find((node) => node.id === edge.from); const to = nodes.find((node) => node.id === edge.to); if (from === undefined || to === undefined) return null; const mid = (from.x + to.x) / 2; return <path key={edge.id} d={`M ${from.x + 84} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x - 84} ${to.y}`} onClick={() => { setEdges((value) => disconnect(value, edge.id)); setCandidate(undefined); setNotice('Connection removed.'); }} />; })}</svg>{nodes.map((node, index) => <article key={node.id} data-workflow-node={node.id} className={`workflow-node ${selected === node.id ? 'selected' : ''} ${dragging?.id === node.id ? 'dragging' : ''} ${issues.some((issue) => issue.path.startsWith(`/nodes/${node.id}`) || issue.path.startsWith(`/nodes/${index}`)) ? 'invalid' : ''}`} style={{ left: node.x, top: node.y }} onPointerDown={(event) => beginDrag(event, node)} onClick={() => setSelected(node.id)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && setSelected(node.id)}><span className="node-kind">{node.kind}</span><strong>{node.title}</strong><small>{node.detail}</small>{live && <button className="node-delete" aria-label={`Delete ${node.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); remove(node.id); }}>×</button>}<button className="port in" aria-label={`Connect to ${node.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (connecting !== undefined) { setEdges((value) => connect(nodes, value, connecting.id, node.id, connecting.branch)); setConnecting(undefined); setCandidate(undefined); } }} />{node.kind === 'condition' ? <><button className={`port out ${connecting?.id === node.id && connecting.branch === 'true' ? 'connecting' : ''}`} aria-label={`Create true connection from ${node.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setConnecting((value) => value?.id === node.id && value.branch === 'true' ? undefined : { id: node.id, branch: 'true' }); }}>True</button><button className={`port out ${connecting?.id === node.id && connecting.branch === 'false' ? 'connecting' : ''}`} aria-label={`Create false connection from ${node.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setConnecting((value) => value?.id === node.id ? undefined : { id: node.id, branch: 'false' }); }}>False</button></> : <button className={`port out ${connecting?.id === node.id ? 'connecting' : ''}`} aria-label={`Create connection from ${node.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setConnecting((value) => value?.id === node.id ? undefined : { id: node.id }); }} />}</article>)}</div></div>{notice && <div className="canvas-notice" role="status"><i /> {notice}<button onClick={() => setNotice(undefined)} aria-label="Dismiss notification">×</button></div>}</div><Inspector node={selectedNode} nodes={nodes} edges={edges} tab={tab} setTab={setTab} updateNode={updateNode} live={live} model={model} setModel={setModel} maxSteps={maxSteps} setMaxSteps={setMaxSteps} publishedId={publishedId} openRouterModels={openRouterModels} openRouterConnectionState={openRouterConnectionState} /></div>}{studioTab === 'harness' && <Harness model={model} setModel={setModel} maxSteps={maxSteps} setMaxSteps={setMaxSteps} onSave={save} />}{studioTab === 'evaluations' && <Evaluations evaluated={evaluated} run={() => { setEvaluated(true); setNotice('Evaluation suite recorded locally. The server evaluation command remains release-blocked without live certification.'); }} />}{studioTab === 'versions' && <Versions revision={revision} nodes={nodes} edges={edges} onSave={save} />}{notice && studioTab !== 'canvas' && <div className="studio-notice" role="status">{notice}</div>}</section>;
}
function LibraryGroup({ title, items, add }: { title: string; items: readonly { kind: WorkflowNodeKind; label: string }[]; add: (kind: WorkflowNodeKind) => void }) { return <section className="library-group"><h2>{title}</h2>{items.map((item) => <button key={item.kind} draggable onDragStart={(event) => event.dataTransfer.setData('application/workflow-kind', item.kind)} onClick={() => add(item.kind)}><i className={`block-icon icon-${item.kind}`} /><span><strong>{item.label}</strong><small>{blockHelp[item.kind] ?? 'Fixture-only preview block.'}</small></span><em>Drag</em></button>)}</section>; }
function Harness({ model, setModel, maxSteps, setMaxSteps, onSave }: { model: string; setModel: (model: string) => void; maxSteps: number; setMaxSteps: (value: number) => void; onSave: () => void }) { return <section className="studio-pane"><div className="pane-heading"><div><p>Runtime configuration</p><h2>Harness</h2><span>Controls that apply to the bounded agent runtime.</span></div><button className="button" onClick={onSave}>Save revision</button></div><div className="pane-grid"><Field label="Primary model"><select value={model} onChange={(event) => setModel(event.target.value)}><option>Atlas 2.1</option><option>Compact 1.4</option></select></Field><Field label="Fallback model"><select defaultValue="compact"><option value="compact">Compact 1.4</option><option value="none">No fallback</option></select></Field><Field label="Team token budget"><input type="number" defaultValue="18000" min="1" /></Field><Field label="Maximum workflow steps"><input type="number" value={maxSteps} onChange={(event) => setMaxSteps(Math.max(1, Number(event.target.value) || 1))} min="1" /></Field></div><div className="harness-section"><h3>Capability boundaries</h3><div className="attached-grid"><AttachedItem name="Customer data" type="Read scoped account records" /><AttachedItem name="Billing actions" type="Requires human approval" /><AttachedItem name="Policy retrieval" type="Cited knowledge scope" /></div></div></section>; }
function Evaluations({ evaluated, run }: { evaluated: boolean; run: () => void }) { return <section className="studio-pane"><div className="pane-heading"><div><p>Release evidence</p><h2>Evaluations</h2><span>Checks and fixture simulations are recorded against a saved revision.</span></div><button className="button" onClick={run}>{evaluated ? 'Run again' : 'Run evaluation'}</button></div><div className="evaluation-list"><article><strong>Static draft checks</strong><span>Workflow references, declared capabilities, finite budgets</span><b>Ready</b></article><article><strong>Fixture simulation</strong><span>Runs the bounded workflow without dispatching a live provider</span><b>{evaluated ? 'Recorded' : 'Ready'}</b></article><article><strong>Release gate</strong><span>Live provider certification is required before publication</span><b className="blocked">Blocked</b></article></div></section>; }
function Versions({ revision, nodes, edges, onSave }: { revision: number; nodes: readonly WorkflowNode[]; edges: readonly WorkflowEdge[]; onSave: () => void }) { return <section className="studio-pane"><div className="pane-heading"><div><p>Governed history</p><h2>Versions</h2><span>Each saved revision is the unit sent to checks, evaluation, and review.</span></div><button className="button" onClick={onSave}>Save revision</button></div><div className="version-summary"><strong>Draft r{revision}</strong><span>{nodes.length} steps</span><span>{edges.length} connections</span><span>Ready for server validation</span></div><div className="evaluation-list"><article><strong>r{revision}</strong><span>Current local draft</span><b>Draft</b></article><article><strong>r{Math.max(1, revision - 1)}</strong><span>Prior saved configuration</span><b>Superseded</b></article></div></section>; }

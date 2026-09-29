import { SignInButton, useAuth } from '@clerk/react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { connect, connectionError, createNode, disconnect, filterLibrary, initialEdges, initialNodes, issueNode, starterEdges, starterNodes, templates, type TriggerSchema, type WorkflowEdge, type WorkflowNode, type WorkflowNodeKind } from './workflow-model.js';
import { PlatformApi, PlatformApiError, describeError, withRef, type CommandReceipt, type ErrorKind, type Projection } from './platform-api.js';
import { ConnectorPanel } from './connector-panel.js';
import { MemoryImportPanel } from './memory-import-panel.js';
import { WebhookPanel } from './webhook-panel.js';
import { Dialog, Field, KindIcon, Notice, kindLabels, StatePage, moveTabFocus } from './ui.js';
import { gsap, motionAllowed, useGSAP } from './motion.js';
import { AttachedItem, Inspector, nodePurpose, type InspectorTab, type OpenRouterModel } from './inspector.js';
import { RunHistory } from './run-history.js';
import type { GraphDraft } from '../../../packages/workflow/src/graph.js';

type StudioTab = 'canvas' | 'harness' | 'evaluations' | 'versions';
type DragState = { id: string; offsetX: number; offsetY: number } | undefined;
type PanState = { pointerId: number; x: number; y: number; left: number; top: number } | undefined;
type SecondaryProjection = 'definitions' | 'runs' | 'connection' | 'models';
type ProjectionLoadState = 'loading' | 'ready' | 'failed';
const loadingSecondaryProjections: Record<SecondaryProjection, ProjectionLoadState> = { definitions: 'loading', runs: 'loading', connection: 'loading', models: 'loading' };
const liveLibrary: readonly { title: string; items: readonly { kind: WorkflowNodeKind; label: string }[] }[] = [
  { title: 'Logic', items: [{ kind: 'trigger', label: 'Trigger' }, { kind: 'agent', label: 'Agent step' }, { kind: 'condition', label: 'Condition' }, { kind: 'approval', label: 'Human approval' }, { kind: 'end', label: 'End' }] },
  { title: 'Knowledge', items: [{ kind: 'memory', label: 'Memory' }] },
  { title: 'Connections', items: [{ kind: 'mcp', label: 'MCP server' }] },
];
const fixtureLibrary = [...liveLibrary, { title: 'Fixture-only', items: [{ kind: 'skill' as const, label: 'Skill' }, { kind: 'retriever' as const, label: 'Retriever' }, { kind: 'http' as const, label: 'HTTP request' }, { kind: 'webhook' as const, label: 'Webhook' }] }];
const noticeDurationMs = 10000;
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
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [dragging, setDragging] = useState<DragState>();
  const [panning, setPanning] = useState<PanState>();
  const [query, setQuery] = useState('');
  const [pane, setPane] = useState<'steps' | 'canvas' | 'settings'>('canvas');
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [pending, setPending] = useState<'save' | 'check' | 'publish' | 'start' | 'reload'>();
  const [drafts, setDrafts] = useState<readonly Record<string, unknown>[]>([]);
  const [draftsState, setDraftsState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [draftAttempt, setDraftAttempt] = useState(0);
  const [confirm, setConfirm] = useState<{ title: string; body: string; confirm: () => void }>();
  const summaryRef = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  const seenNodes = useRef<ReadonlySet<string>>(new Set());
  const seenEdges = useRef<ReadonlySet<string>>(new Set());
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
  const applyDraft = (record: Record<string, unknown>) => {
    const saved = record['graph'] as GraphDraft;
    setDraftId(String(record['id'])); setRevision(Number(record['revision']));
    setNodes(saved.nodes as WorkflowNode[]); setEdges(saved.edges as WorkflowEdge[]); setSelected(saved.nodes[0]?.id);
    setSavedGraph(graphKey(saved)); setSaveState('saved'); setConflict(false); setCandidate(undefined); setIssues([]); setDraftsState('ready'); setSelectedEdge(undefined);
  };
  const startNewDraft = () => {
    setDraftId(crypto.randomUUID()); setRevision(0); setNodes(starterNodes); setEdges(starterEdges); setSelected('agent');
    setSavedGraph(undefined); setSaveState('unsaved'); setConflict(false); setCandidate(undefined); setIssues([]); setDraftsState('ready'); setSelectedEdge(undefined);
  };
  const guard = (action: () => void) => hasUnsavedChanges ? setConfirm({ title: 'Discard unsaved changes?', body: 'Your canvas edits since the last saved revision will be lost.', confirm: action }) : action();
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    if (!api || !tenantId) return;
    const generation = ++loadGeneration.current;
    const current = () => loadGeneration.current === generation;
    const controller = new AbortController();
    setDraftId(undefined); setRevision(0); setSavedGraph(undefined); setSaveState('unsaved'); setConflict(false); setPublishedId(undefined); setRuns(undefined); setDefinitions(undefined); setOpenRouterConnection(undefined); setOpenRouterModels([]); setSecondaryProjections(loadingSecondaryProjections); setDrafts([]); setDraftsState('loading');
    const setSecondaryProjection = (projection: SecondaryProjection, state: ProjectionLoadState) => current() && setSecondaryProjections((value) => ({ ...value, [projection]: state }));
    void api.projection(tenantId, 'workflow-drafts', undefined, controller.signal).then((drafts) => {
      if (!current()) return;
      setDrafts(drafts.records);
      const latest = drafts.records[0];
      if (latest && typeof latest['id'] === 'string' && typeof latest['revision'] === 'number' && latest['graph'] && typeof latest['graph'] === 'object') applyDraft(latest);
      else startNewDraft();
    }).catch(() => { if (current()) { setDraftsState('failed'); setNotice('Saved drafts couldn\'t be loaded.'); } });
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
  }, [api, tenantId, draftAttempt]);
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
  const add = (kind: WorkflowNodeKind, location?: { x: number; y: number }) => {
    if (live && kind === 'trigger' && nodes.some((node) => node.kind === 'trigger')) { setNotice('A workflow has one Trigger. Select the existing start node.'); setSelected(nodes.find((node) => node.kind === 'trigger')!.id); return; }
    const element = canvas.current;
    const centre = location ?? (element ? { x: (element.scrollLeft + element.clientWidth / 2) / zoom, y: (element.scrollTop + element.clientHeight / 2) / zoom } : { x: 760, y: 540 });
    const offset = location ? 0 : (sequence % 5) * 24;
    const node = createNode(kind, centre.x + offset, centre.y + offset, sequence);
    setSequence((value) => value + 1); setNodes((value) => [...value, node]); setCandidate(undefined); setIssues([]); setSelected(node.id); setStudioTab('canvas'); setPane('canvas'); setNotice(`${templates[kind].title} added. Select its output port, then an input port to connect it.`);
  };
  const remove = (id: string) => {
    setNodes((value) => value.filter((node) => node.id !== id));
    setEdges((value) => value.filter((edge) => edge.from !== id && edge.to !== id));
    setCandidate(undefined); setIssues([]);
    setSelected((value) => value === id ? undefined : value);
    setConnecting((value) => value?.id === id ? undefined : value);
    setDragging((value) => value?.id === id ? undefined : value);
    setSelectedEdge(undefined);
    setCandidate(undefined);
  };
  const updateNode = (id: string, patch: Partial<Pick<WorkflowNode, 'title' | 'detail' | 'instructions' | 'config'>>) => { setNodes((value) => value.map((node) => node.id === id ? { ...node, ...patch } : node)); setCandidate(undefined); };
  const save = async () => {
    if (!api || !tenantId) { setNotice('Fixture preview only. Sign in to save a live revision.'); return; }
    const id = draftId ?? crypto.randomUUID();
    const requestGraph = graphDraft();
    const requestKey = graphKey(requestGraph);
    setDraftId(id);
    setSaveState('saving');
    setConflict(false);
    setPending('save');
    try {
      const result: CommandReceipt = await api.command({ tenantId, owner: 'studio', name: revision ? 'save-draft' : 'create-draft', expectedVersion: revision, arguments: { id, draft: requestGraph } });
      const refreshed = await api.projection(tenantId, 'workflow-drafts');
      const confirmed = refreshed.records.find((record) => record['id'] === id && record['revision'] === result.revision);
      if (confirmed === undefined) throw new PlatformApiError(502);
      setDrafts(refreshed.records);
      setRevision(result.revision); setSavedGraph(requestKey); setSaveState('saved'); setCandidate(undefined); setIssues([]); setNotice(`Saved as revision ${result.revision}.`);
    } catch (error) { const stale = error instanceof PlatformApiError && (error.status === 409 || error.category === 'conflict'); setConflict(stale); setSaveState('failed'); setNotice(withRef(stale ? 'This draft has a newer saved revision. Reload it before retrying.' : 'Save failed. Your local edits are still available.', error)); }
    finally { setPending(undefined); }
  };
  const reload = async () => {
    if (!api || !tenantId || !draftId) return;
    setPending('reload');
    try {
      const refreshed = await api.projection(tenantId, 'workflow-drafts');
      const latest = refreshed.records.find((record) => record['id'] === draftId);
      if (!latest || typeof latest['revision'] !== 'number' || latest['graph'] === null || typeof latest['graph'] !== 'object') throw new PlatformApiError(404);
      setDrafts(refreshed.records);
      applyDraft(latest);
      setNotice(`Reloaded revision ${latest['revision']}.`);
    } catch { setNotice('The current draft could not be reloaded. Your local edits are unchanged.'); }
    finally { setPending(undefined); }
  };
  const run = async () => {
    if (!api || !tenantId || !draftId || !revision || hasUnsavedChanges) { setNotice('Save the current canvas before checking it.'); return; }
    setPending('check');
    try {
      const result = await api.command({ tenantId, owner: 'workflow', name: 'check', expectedVersion: revision, arguments: { id: draftId } });
      const nextIssues = result.issues ?? [];
      setIssues(nextIssues); setCandidate(result.state === 'passed' ? result.digest : undefined);
      setNotice(result.state === 'passed' ? `Revision ${revision} passed server checks. Review digest ${result.digest}.` : `${nextIssues.length} issue(s) need attention.`);
      if (nextIssues.length > 0) requestAnimationFrame(() => summaryRef.current?.focus());
    } catch { setNotice('Server check is unavailable.'); }
    finally { setPending(undefined); }
  };
  const publish = async () => {
    if (!api || !tenantId || !draftId || !candidate || !admin || hasUnsavedChanges) return;
    setPending('publish');
    try { const result = await api.command({ tenantId, owner: 'workflow', name: 'publish', expectedVersion: revision, arguments: { id: draftId, reviewDigest: candidate } }); setPublishedId(result.objectId); setNotice(`Published definition ${result.objectId}.`); }
    catch (error) { const kind = describeError(error, { write: true }); setNotice(withRef(kind === 'conflict' ? 'The review is stale. Run a new check.' : kind === 'denied' ? 'Only admins can publish this definition.' : kind === 'unknown' ? 'Publication result is unknown. Refresh before publishing again.' : 'Publication failed.', error)); }
    finally { setPending(undefined); }
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
  const start = async (input: Record<string, unknown> = {}) => {
    if (!api || !tenantId || !publishedId) return;
    setPending('start');
    try { const result = await api.command({ tenantId, owner: 'workflow', name: 'start', expectedVersion: 0, arguments: { id: publishedId, input } }); setNotice(`Run ${result.objectId} queued.`); await refreshRuns(); }
    catch (error) { const kind = describeError(error, { write: true }); setNotice(withRef(kind === 'unknown' ? 'Run start result is unknown. Refresh Run History before starting again.' : kind === 'invalid' ? "The input doesn't match the published Trigger." : kind === 'denied' ? "You can't start runs in this workspace." : 'Run could not start. Check the published input schema and provider configuration.', error)); }
    finally { setPending(undefined); }
  };
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
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const kind = event.dataTransfer.getData('application/workflow-kind') as WorkflowNodeKind; if (kind in templates) add(kind, point(event.clientX, event.clientY)); };
  const beginDrag = (event: ReactPointerEvent<HTMLElement>, node: WorkflowNode) => { if (event.button !== 0 || (event.target as HTMLElement).closest('.port')) return; const location = point(event.clientX, event.clientY); event.currentTarget.setPointerCapture(event.pointerId); setSelected(node.id); setDragging({ id: node.id, offsetX: location.x - node.x, offsetY: location.y - node.y }); };
  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = canvas.current;
    if (event.button !== 1 || element === null) return;
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    setPanning({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop });
  };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => { if (panning?.pointerId === event.pointerId) setPanning(undefined); };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = canvas.current;
    if (panning !== undefined && element !== null) { element.scrollLeft = panning.left - (event.clientX - panning.x); element.scrollTop = panning.top - (event.clientY - panning.y); return; }
    if (dragging === undefined) return; const location = point(event.clientX, event.clientY); setNodes((value) => value.map((node) => node.id === dragging.id ? { ...node, x: Math.max(80, location.x - dragging.offsetX), y: Math.max(70, location.y - dragging.offsetY) } : node)); setCandidate(undefined); };
  const endDrag = () => setDragging(undefined);
  const connectTo = (target: string) => {
    if (connecting === undefined) return;
    const error = connectionError(nodes, edges, connecting.id, target, connecting.branch);
    if (error) setNotice(error);
    else { setEdges(connect(nodes, edges, connecting.id, target, connecting.branch)); setCandidate(undefined); setNotice(undefined); }
    setConnecting(undefined);
  };
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomTo(zoomRef.current * Math.exp(-event.deltaY * .002), event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [studioTab, pane]);
  const removeEdge = () => { if (selectedEdge === undefined) return; setEdges((value) => disconnect(value, selectedEdge)); setSelectedEdge(undefined); setCandidate(undefined); setNotice('Connection removed.'); };
  const nodeKeyDown = (event: ReactKeyboardEvent<HTMLElement>, node: WorkflowNode) => {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 80 : 20;
    const delta = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[event.key];
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(node.id); return; }
    if ((event.key === 'Delete' || event.key === 'Backspace') && live) { event.preventDefault(); remove(node.id); setNotice(`${node.title} deleted.`); canvas.current?.focus(); return; }
    if (!delta) return;
    event.preventDefault();
    setNodes((value) => value.map((item) => item.id === node.id ? { ...item, x: Math.max(80, item.x + delta[0]), y: Math.max(70, item.y + delta[1]) } : item));
    setCandidate(undefined);
  };
  const canvasKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, [contenteditable="true"]'))) return;
    if (event.key === 'Escape') { setConnecting(undefined); setSelectedEdge(undefined); return; }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdge !== undefined) { event.preventDefault(); removeEdge(); return; }
    const direction = event.key === '+' || event.key === '=' ? 1 : event.key === '-' || event.key === '_' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    zoomTo(zoom + direction * .1);
  };
  const canEdit = editor || admin;
  const reasons = {
    save: draftsState !== 'ready' ? 'Wait for saved drafts to load.' : !canEdit ? 'Only editors and admins can save.' : undefined,
    check: !canEdit ? 'Only editors and admins can run checks.' : !revision || hasUnsavedChanges ? 'Save the canvas before checking it.' : undefined,
    publish: !admin ? 'Only admins can publish.' : hasUnsavedChanges ? 'Save and check the current canvas first.' : !candidate ? 'Run a passing check first.' : undefined,
    start: !publishedId ? 'Publish a definition before starting runs.' : webhook ? 'Webhook workflows start from signed events.' : !(operator || admin) ? 'Only operators and admins can start runs.' : undefined,
  };
  const saveLabel = !live ? 'Fixture preview' : draftsState === 'loading' ? 'Loading draft…' : saveState === 'saving' ? 'Saving' : saveState === 'failed' ? 'Save failed' : hasUnsavedChanges ? 'Unsaved changes' : revision ? `Saved as revision ${revision}` : 'Unsaved changes';
  const heading = live ? (revision === 0 ? 'New starter draft' : `Draft ${draftId} · revision ${revision}`) : 'Fixture preview example';
  const filteredLibrary = filterLibrary(live ? liveLibrary : fixtureLibrary, query, nodePurpose);
  const primary: 'save' | 'check' | 'publish' = hasUnsavedChanges || !revision ? 'save' : candidate === undefined ? 'check' : 'publish';
  const nextHint = { save: reasons.save ?? 'Next: save this canvas as a revision.', check: reasons.check ?? 'Next: run a server check on this revision.', publish: reasons.publish ?? 'Checked. Next: publish this revision.' }[primary];
  const commandClass = (key: typeof primary) => primary === key ? 'button' : 'button-secondary';
  const nodeIds = nodes.map((node) => node.id).join('|');
  const edgeIds = edges.map((edge) => edge.id).join('|');
  useEffect(() => {
    if (!notice || connecting !== undefined) return;
    const timer = setTimeout(() => setNotice(undefined), noticeDurationMs);
    return () => clearTimeout(timer);
  }, [notice, connecting]);
  useGSAP(() => {
    const root = shell.current;
    const freshNodes = new Set(nodes.map((node) => node.id).filter((id) => !seenNodes.current.has(id)));
    const freshEdges = new Set(edges.map((edge) => edge.id).filter((id) => !seenEdges.current.has(id)));
    seenNodes.current = new Set(nodes.map((node) => node.id));
    seenEdges.current = new Set(edges.map((edge) => edge.id));
    if (root === null || !motionAllowed()) return;
    const nodeTargets = gsap.utils.toArray<HTMLElement>('[data-workflow-node]', root).filter((element) => freshNodes.has(element.dataset['workflowNode'] ?? ''));
    if (nodeTargets.length > 0) gsap.fromTo(nodeTargets, { '--pop': .72, opacity: 0 }, { '--pop': 1, opacity: 1, duration: .4, ease: 'back.out(1.8)', stagger: .07, clearProps: '--pop,opacity' });
    const edgeTargets = gsap.utils.toArray<SVGPathElement>('path[data-edge]', root).filter((element) => freshEdges.has(element.dataset['edge'] ?? ''));
    if (edgeTargets.length > 0) gsap.fromTo(edgeTargets, { strokeDasharray: 1, strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: 0, opacity: 1, duration: .5, delay: .2, ease: 'power2.out', stagger: .06, clearProps: 'strokeDasharray,strokeDashoffset,opacity' });
  }, { scope: shell, dependencies: [nodeIds, edgeIds] });
  useGSAP(() => {
    if (motionAllowed()) gsap.fromTo('.library-group button', { x: -10, opacity: 0 }, { x: 0, opacity: 1, duration: .32, stagger: .025, ease: 'power2.out', clearProps: 'transform,opacity' });
  }, { scope: shell });
  useGSAP(() => {
    if (studioTab !== 'canvas' && motionAllowed()) gsap.fromTo('.studio-pane', { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: .3, ease: 'power2.out', clearProps: 'transform,opacity' });
  }, { scope: shell, dependencies: [studioTab] });
  useGSAP(() => {
    if (saveState === 'saved' && motionAllowed()) gsap.fromTo('.save-state i', { scale: 2.2 }, { scale: 1, duration: .6, ease: 'elastic.out(1, .45)', clearProps: 'transform' });
  }, { scope: shell, dependencies: [saveState] });
  useGSAP(() => {
    if (notice && motionAllowed()) gsap.fromTo('.canvas-notice', { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .28, ease: 'power3.out', clearProps: 'transform,opacity' });
  }, { scope: shell, dependencies: [notice] });
  return <section className="studio-shell" ref={shell}><div className="product-heading"><div><p>Solution Studio <span>/</span> {live ? 'Live workspace' : 'Fixture content'}</p><h1>{heading}</h1>{live && !draftId && <p>Manual start → Classify request → End</p>}{live && draftsState === 'ready' && <Field label="Draft"><select value={draftId} onChange={(event) => guard(() => { const next = drafts.find((item) => String(item['id']) === event.target.value); if (next && next['graph'] && typeof next['graph'] === 'object') applyDraft(next); else startNewDraft(); })}>{draftId && !drafts.some((item) => item['id'] === draftId) && <option value={draftId}>New starter draft (not saved)</option>}{drafts.map((item) => <option key={String(item['id'])} value={String(item['id'])}>{String(item['id']).slice(0, 8)} · revision {String(item['revision'])}</option>)}<option value="new">Start a new draft</option></select></Field>}{live && draftsState === 'failed' && <Notice tone="danger">Saved drafts couldn't be loaded. Nothing on the canvas has been saved. <button onClick={() => setDraftAttempt((value) => value + 1)}>Retry</button> <button onClick={startNewDraft}>Start a new draft</button></Notice>}{live && tenants.length > 1 && <select aria-label="Workspace" value={tenantId} onChange={(event) => guard(() => setTenantId?.(event.target.value))}>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.id}</option>)}</select>}</div><div className="product-heading-actions"><span className={`save-state save-${saveState}`}><i /> {saveLabel}</span>{live && draftId && <details className="draft-details"><summary>Draft details</summary><code>{draftId}</code></details>}{live && <><div className="command-bar" role="group" aria-label="Workflow lifecycle"><button className={commandClass('save')} onClick={save} disabled={pending !== undefined || reasons.save !== undefined} aria-describedby={reasons.save ? 'studio-reason-save' : undefined} title={reasons.save}>{pending === 'save' ? 'Saving…' : 'Save revision'}</button>{reasons.save && <p id="studio-reason-save" className="visually-hidden">{reasons.save}</p>}<button className={commandClass('check')} onClick={run} disabled={pending !== undefined || reasons.check !== undefined} aria-describedby={reasons.check ? 'studio-reason-check' : undefined} title={reasons.check}>{pending === 'check' ? 'Checking…' : 'Run check'}</button>{reasons.check && <p id="studio-reason-check" className="visually-hidden">{reasons.check}</p>}<button className={commandClass('publish')} onClick={publish} disabled={pending !== undefined || reasons.publish !== undefined} aria-describedby={reasons.publish ? 'studio-reason-publish' : undefined} title={reasons.publish}>{pending === 'publish' ? 'Publishing…' : 'Publish'}</button>{reasons.publish && <p id="studio-reason-publish" className="visually-hidden">{reasons.publish}</p>}<button className="button-secondary" onClick={() => start()} disabled={pending !== undefined || reasons.start !== undefined} aria-describedby={reasons.start ? 'studio-reason-start' : undefined} title={reasons.start}>{pending === 'start' ? 'Starting…' : 'Start run'}</button>{reasons.start && <p id="studio-reason-start" className="visually-hidden">{reasons.start}</p>}</div>{conflict && <button className="button-secondary" onClick={() => guard(reload)} disabled={pending !== undefined}>{pending === 'reload' ? 'Reloading…' : 'Reload saved revision'}</button>}<p id="studio-command-reason" className="next-step">{nextHint}</p></>}</div></div>{live && <div className="studio-live-status"><span className="status-row"><span className={`status-pill ${candidate ? 'ok' : ''}`} title={candidate}>{candidate ? `Checked · digest ${candidate.slice(0, 12)}` : 'Not checked yet'}</span>{publishedId && <span className="status-pill ok" title={publishedId}>Published · {publishedId.slice(0, 12)}</span>}</span>{issues.length > 0 && <div className="error-summary notice notice-danger" tabIndex={-1} ref={summaryRef} aria-labelledby="issue-summary-title"><h2 id="issue-summary-title">{issues.length} issue{issues.length === 1 ? '' : 's'} to fix before publishing</h2><ul>{issues.map((issue, index) => { const target = issueNode(nodes, issue.path); return <li key={`${issue.path}-${index}`}>{target ? <button className="inline-link" onClick={() => { setSelected(target.id); document.querySelector<HTMLElement>(`[data-workflow-node="${CSS.escape(target.id)}"]`)?.focus(); }}>{target.title}: {issue.message}</button> : `${issue.path}: ${issue.message}`}</li>; })}</ul></div>}{secondaryProjections.definitions === 'failed' && <span role="alert">Publication details could not be loaded.</span>}{secondaryProjections.runs === 'loading' && <span>Loading Run History.</span>}{secondaryProjections.runs === 'failed' && <span role="alert">Run History could not be loaded.</span>}{secondaryProjections.connection === 'failed' && <span role="alert">Provider status could not be loaded.</span>}{secondaryProjections.models === 'failed' && <span role="alert">Provider models could not be loaded.</span>}</div>}{confirm && <Dialog labelledBy="confirm-title" onClose={() => setConfirm(undefined)} className="confirm-dialog"><h2 id="confirm-title">{confirm.title}</h2><p>{confirm.body}</p><div className="dialog-actions"><button className="button-secondary" onClick={() => setConfirm(undefined)}>Cancel</button><button className="button" onClick={() => { const action = confirm.confirm; setConfirm(undefined); action(); }}>Discard and continue</button></div></Dialog>}<div className="studio-tabs" role="tablist" aria-label="Solution authoring" onKeyDown={moveTabFocus}><button role="tab" id="studio-tab-canvas" aria-selected={studioTab === 'canvas'} aria-controls="studio-panel-canvas" tabIndex={studioTab === 'canvas' ? 0 : -1} className={studioTab === 'canvas' ? 'active' : ''} onClick={() => setStudioTab('canvas')}>Canvas</button>{!live && <><button role="tab" id="studio-tab-harness" aria-selected={studioTab === 'harness'} aria-controls="studio-panel-harness" tabIndex={studioTab === 'harness' ? 0 : -1} className={studioTab === 'harness' ? 'active' : ''} onClick={() => setStudioTab('harness')}>Harness</button><button role="tab" id="studio-tab-evaluations" aria-selected={studioTab === 'evaluations'} aria-controls="studio-panel-evaluations" tabIndex={studioTab === 'evaluations' ? 0 : -1} className={studioTab === 'evaluations' ? 'active' : ''} onClick={() => setStudioTab('evaluations')}>Evaluations</button><button role="tab" id="studio-tab-versions" aria-selected={studioTab === 'versions'} aria-controls="studio-panel-versions" tabIndex={studioTab === 'versions' ? 0 : -1} className={studioTab === 'versions' ? 'active' : ''} onClick={() => setStudioTab('versions')}>Versions</button></>}</div>{studioTab === 'canvas' && <div id="studio-panel-canvas" role="tabpanel" aria-labelledby="studio-tab-canvas"><div className="studio-pane-tabs" role="tablist" aria-label="Studio panes" onKeyDown={moveTabFocus}>{(['steps', 'canvas', 'settings'] as const).map((item) => <button key={item} role="tab" id={`pane-tab-${item}`} aria-selected={pane === item} aria-controls={`pane-${item}`} tabIndex={pane === item ? 0 : -1} onClick={() => setPane(item)}>{item === 'steps' ? 'Steps' : item === 'canvas' ? 'Canvas' : 'Settings'}</button>)}</div><div className="studio-workspace" data-pane={pane} data-settings={settingsOpen ? 'open' : 'closed'}><aside className="node-library" id="pane-steps" role="tabpanel" aria-labelledby="pane-tab-steps"><div className="panel-title"><strong>Building blocks</strong><span>Click to add, or drag onto the canvas</span></div><label className="search-field"><span>⌕</span><input type="search" aria-label="Search blocks" aria-controls="block-library" placeholder="Search blocks" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div id="block-library">{filteredLibrary.map((group) => <LibraryGroup key={group.title} title={group.title} items={group.items} add={add} />)}{filteredLibrary.length === 0 && <p role="status">No blocks match “{query}”. <button onClick={() => setQuery('')}>Clear search</button></p>}</div></aside><div ref={canvas} id="pane-canvas" role="tabpanel" aria-labelledby="pane-tab-canvas" className={`workflow-canvas ${connecting !== undefined ? 'is-connecting' : ''} ${panning !== undefined ? 'is-panning' : ''}`} tabIndex={0} aria-label="Workflow canvas" aria-busy={live && draftsState === 'loading' || undefined} onDragOver={(event) => event.preventDefault()} onDrop={drop} onPointerDown={beginPan} onPointerMove={move} onPointerUp={(event) => { endDrag(); endPan(event); }} onPointerCancel={(event) => { endDrag(); endPan(event); }} onAuxClick={(event) => event.preventDefault()} onKeyDown={canvasKeyDown}><div className="canvas-overlay"><div className="canvas-tools"><button onClick={() => zoomTo(zoom - .1)} aria-label="Zoom out" title="Zoom out (−)">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => zoomTo(zoom + .1)} aria-label="Zoom in" title="Zoom in (+)">+</button><button onClick={fit} title="Fit workflow to view">Fit</button><button className="settings-toggle" aria-expanded={settingsOpen} aria-controls="pane-settings" onClick={() => setSettingsOpen((open) => !open)}>Settings</button></div><details className="canvas-help"><summary>Shortcuts</summary><ul><li>Click or drag a block to add it.</li><li>Arrow keys move the selected step; Shift moves further.</li><li>Delete removes the selected step or connection.</li><li>Click an output port, then an input port to connect. Esc cancels.</li><li>Ctrl + scroll (or + and −) zooms; plain scroll moves the canvas.</li><li>Hold the middle mouse button and drag to pan.</li><li>Fit frames the whole workflow.</li></ul></details></div>{nodes.length === 0 && <div className="empty-canvas"><strong>This draft has no steps.</strong><span>A valid published workflow needs one Trigger and an End.</span><button className="button" onClick={() => add('trigger')}>Add Trigger</button></div>}<div className="workflow-scroll-area" style={{ width: scene.width * zoom, height: scene.height * zoom, backgroundSize: `${20 * zoom}px ${20 * zoom}px` }}><div className="workflow-scene" style={{ transform: `scale(${zoom})` }}><svg className="workflow-edges" viewBox="0 0 1600 900" aria-label="Workflow connections"><defs><marker id="edge-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1.5L8.5 5L1 8.5z" fill="context-stroke" stroke="none" /></marker></defs>{edges.map((edge) => { const from = nodes.find((node) => node.id === edge.from); const to = nodes.find((node) => node.id === edge.to); if (from === undefined || to === undefined) return null; const mid = (from.x + to.x) / 2; const d = `M ${from.x + 84} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x - 94} ${to.y}`; return <g key={edge.id}><path className={selectedEdge === edge.id ? 'selected' : ''} data-edge={edge.id} pathLength={1} markerEnd="url(#edge-arrow)" d={d} /><path className="edge-hit" d={d} onClick={() => setSelectedEdge(edge.id)} /></g>; })}</svg>{nodes.map((node, index) => { const invalid = issues.some((issue) => issue.path.startsWith(`/nodes/${node.id}`) || issue.path.startsWith(`/nodes/${index}`)); return <article key={node.id} data-workflow-node={node.id} data-kind={node.kind} className={`workflow-node ${selected === node.id ? 'selected' : ''} ${dragging?.id === node.id ? 'dragging' : ''} ${invalid ? 'invalid' : ''}`} style={{ left: node.x, top: node.y }} onPointerDown={(event) => beginDrag(event, node)} onClick={() => setSelected(node.id)} tabIndex={0} aria-label={`${node.title}, ${templates[node.kind].title} step`} onKeyDown={(event) => nodeKeyDown(event, node)}><span className="node-kind"><KindIcon kind={node.kind} />{kindLabels[node.kind]}</span><strong>{node.title}</strong><small>{node.detail}</small>{invalid && <small className="node-invalid-marker">Needs attention</small>}{live && <button className="node-delete" aria-label={`Delete ${node.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); remove(node.id); }}>×</button>}<button className="port in" aria-label={`Connect to ${node.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); connectTo(node.id); }} />{node.kind === 'condition' ? <><button className={`port out ${connecting?.id === node.id && connecting.branch === 'true' ? 'connecting' : ''}`} aria-label={`Create true connection from ${node.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setConnecting((value) => { if (value?.id === node.id && value.branch === 'true') return undefined; setNotice('Now select an input port. Escape cancels.'); return { id: node.id, branch: 'true' }; }); }}>True</button><button className={`port out ${connecting?.id === node.id && connecting.branch === 'false' ? 'connecting' : ''}`} aria-label={`Create false connection from ${node.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setConnecting((value) => { if (value?.id === node.id) return undefined; setNotice('Now select an input port. Escape cancels.'); return { id: node.id, branch: 'false' }; }); }}>False</button></> : <button className={`port out ${connecting?.id === node.id ? 'connecting' : ''}`} aria-label={`Create connection from ${node.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setConnecting((value) => { if (value?.id === node.id) return undefined; setNotice('Now select an input port. Escape cancels.'); return { id: node.id }; }); }} />}</article>; })}</div></div><div className="canvas-overlay canvas-overlay-bottom">{notice ? <div className="canvas-notice" role="status"><i /> {notice}<button onClick={() => setNotice(undefined)} aria-label="Dismiss notification">×</button></div> : selectedEdge !== undefined ? <div className="canvas-notice" role="status">Connection selected. <button onClick={removeEdge}>Remove connection</button></div> : selectedNode !== undefined ? <div className="canvas-notice edit-hint" role="status"><button className="button-secondary" onClick={() => setPane('settings')}>Edit {selectedNode.title} settings</button></div> : null}</div></div><Inspector paneId="pane-settings" paneLabelledBy="pane-tab-settings" node={selectedNode} nodes={nodes} edges={edges} tab={tab} setTab={setTab} updateNode={updateNode} removeNode={remove} removeEdgeFromNode={(edgeId) => { setEdges((value) => disconnect(value, edgeId)); setSelectedEdge((value) => value === edgeId ? undefined : value); setCandidate(undefined); }} live={live} model={model} setModel={setModel} maxSteps={maxSteps} setMaxSteps={setMaxSteps} publishedId={publishedId} openRouterModels={openRouterModels} openRouterConnectionState={openRouterConnectionState} onStart={start} startReason={reasons.start} /></div></div>}{studioTab === 'harness' && <Harness model={model} setModel={setModel} maxSteps={maxSteps} setMaxSteps={setMaxSteps} onSave={save} />}{studioTab === 'evaluations' && <Evaluations evaluated={evaluated} run={() => { setEvaluated(true); setNotice('Evaluation suite recorded locally. The server evaluation command remains release-blocked without live certification.'); }} />}{studioTab === 'versions' && <Versions revision={revision} nodes={nodes} edges={edges} onSave={save} />}{notice && studioTab !== 'canvas' && <div className="studio-notice" role="status">{notice}</div>}<div className="studio-panels">{live && <div id="connector-panel" className="studio-panel-anchor"><span id="provider-panel" />{api && tenantId && <ConnectorPanel api={api} tenantId={tenantId} draftId={draftId} node={selectedNode} nodes={nodes} edges={edges} admin={admin} connection={openRouterConnection} connectionState={secondaryProjections.connection} onPin={(config) => { if (selectedNode) updateNode(selectedNode.id, { config }); }} />}</div>}{live && <div id="webhook-panel" className="studio-panel-anchor">{api && tenantId && publishedId && <WebhookPanel api={api} tenantId={tenantId} definitionId={publishedId} webhook={webhook} admin={admin} schema={webhookSchema} onAccepted={(runId) => { void refreshRuns(); window.location.hash = `run-${runId}`; }} />}</div>}{live && <div id="memory-panel" className="studio-panel-anchor">{api && tenantId && publishedId && <MemoryImportPanel api={api} tenantId={tenantId} definitionId={publishedId} admin={admin} definitions={definitions} definitionsState={secondaryProjections.definitions} runs={runs} runsState={secondaryProjections.runs} />}</div>}{live && runs && <RunHistory records={runs.records} admin={admin} decide={decide} reconcile={reconcile} loadOlder={loadOlderRuns} hasMore={runs.continuation !== undefined} loadingOlder={loadingOlderRuns} />}</div></section>;
}
function LibraryGroup({ title, items, add }: { title: string; items: readonly { kind: WorkflowNodeKind; label: string }[]; add: (kind: WorkflowNodeKind) => void }) { return <section className="library-group"><h2>{title}</h2>{items.map((item) => <button key={item.kind} aria-label={`Add ${item.label}`} title={nodePurpose[item.kind]} draggable onDragStart={(event) => event.dataTransfer.setData('application/workflow-kind', item.kind)} onClick={() => add(item.kind)}><KindIcon kind={item.kind} /><span><strong>{item.label}</strong><small>{nodePurpose[item.kind] ?? 'Fixture-only preview block.'}</small></span><em aria-hidden="true">+</em></button>)}</section>; }
function Harness({ model, setModel, maxSteps, setMaxSteps, onSave }: { model: string; setModel: (model: string) => void; maxSteps: number; setMaxSteps: (value: number) => void; onSave: () => void }) { return <section className="studio-pane" id="studio-panel-harness" role="tabpanel" aria-labelledby="studio-tab-harness"><Notice>Local example — not saved or evaluated.</Notice><div className="pane-heading"><div><p>Runtime configuration</p><h2>Harness</h2><span>Controls that apply to the bounded agent runtime.</span></div><button className="button" onClick={onSave}>Save revision</button></div><div className="pane-grid"><Field label="Primary model"><select value={model} onChange={(event) => setModel(event.target.value)}><option>Atlas 2.1</option><option>Compact 1.4</option></select></Field><Field label="Fallback model"><select defaultValue="compact"><option value="compact">Compact 1.4</option><option value="none">No fallback</option></select></Field><Field label="Team token budget"><input type="number" defaultValue="18000" min="1" /></Field><Field label="Maximum workflow steps"><input type="number" value={maxSteps} onChange={(event) => setMaxSteps(Math.max(1, Number(event.target.value) || 1))} min="1" /></Field></div><div className="harness-section"><h3>Capability boundaries</h3><div className="attached-grid"><AttachedItem name="Customer data" type="Read scoped account records" /><AttachedItem name="Billing actions" type="Requires human approval" /><AttachedItem name="Policy retrieval" type="Cited knowledge scope" /></div></div></section>; }
function Evaluations({ evaluated, run }: { evaluated: boolean; run: () => void }) { return <section className="studio-pane" id="studio-panel-evaluations" role="tabpanel" aria-labelledby="studio-tab-evaluations"><Notice>Local example — not saved or evaluated.</Notice><div className="pane-heading"><div><p>Release evidence</p><h2>Evaluations</h2><span>Checks and fixture simulations are recorded against a saved revision.</span></div><button className="button" onClick={run}>{evaluated ? 'Run again' : 'Simulate locally (example)'}</button></div><div className="evaluation-list"><article><strong>Static draft checks</strong><span>Workflow references, declared capabilities, finite budgets</span><b>Ready</b></article><article><strong>Fixture simulation</strong><span>Runs the bounded workflow without dispatching a live provider</span><b>{evaluated ? 'Recorded' : 'Ready'}</b></article><article><strong>Release gate</strong><span>Live provider certification is required before publication</span><b className="blocked">Blocked</b></article></div></section>; }
function Versions({ revision, nodes, edges, onSave }: { revision: number; nodes: readonly WorkflowNode[]; edges: readonly WorkflowEdge[]; onSave: () => void }) { return <section className="studio-pane" id="studio-panel-versions" role="tabpanel" aria-labelledby="studio-tab-versions"><Notice>Local example — not saved or evaluated.</Notice><div className="pane-heading"><div><p>Governed history</p><h2>Versions</h2><span>Each saved revision is the unit sent to checks, evaluation, and review.</span></div><button className="button" onClick={onSave}>Save revision</button></div><div className="version-summary"><strong>Draft r{revision}</strong><span>{nodes.length} steps</span><span>{edges.length} connections</span><span>Ready for server validation</span></div><div className="evaluation-list"><article><strong>Example revision r{revision}</strong><span>Current local draft</span><b>Draft</b></article><article><strong>Example revision r{Math.max(1, revision - 1)}</strong><span>Prior saved configuration</span><b>Superseded</b></article></div></section>; }

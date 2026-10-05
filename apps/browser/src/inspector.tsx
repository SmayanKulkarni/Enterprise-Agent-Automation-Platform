import { ModelPicker, type CatalogModel, type CatalogStatus } from './model-picker.js';
import { azureModels } from './azure-models.js';
import { useRef, useState } from 'react';
import { conditionFields, conditionSources, memoryProposalsEnabled, toolOwner, toolsOf, type OutputSchemas, parseTriggerInput, removeSchemaField, schemaFieldNameError, setMemoryProposals, setSchemaField, updateIntegerConfig, type TriggerFieldType, type TriggerSchema, type WorkflowEdge, type WorkflowNode, type WorkflowNodeKind } from './workflow-model.js';
import { Field, KindIcon, Notice, kindLabels, moveTabFocus } from './ui.js';
import { gsap, motionAllowed, useGSAP } from './motion.js';

export type InspectorTab = 'instructions' | 'skills' | 'connections' | 'runtime';
export type OpenRouterModel = CatalogModel;

export const nodePurpose: Partial<Record<WorkflowNodeKind, string>> = {
  trigger: 'Starts each run from a manual start or a signed webhook event, and defines the input every run receives.',
  agent: 'Calls the chosen model with these instructions and must return data matching its response schema, within its policy limits.',
  condition: 'Compares one earlier field to a value and continues on the True or False branch.',
  approval: 'Pauses the run until an admin approves or rejects the MCP effect that follows it.',
  mcp: 'Calls one granted Capability on a certified connector with the mapped arguments.',
  memory: 'Retrieves permitted memory for this workflow within the item and character limits below. Attached to an Agent\'s tool port, it lets the Agent search memory and propose saves during its step.',
  end: 'Completes the run. It has no runtime settings.',
};

const fixtureNotice = <Notice>Local example — not saved or evaluated.</Notice>;

export function Inspector({ node, nodes, edges, tab, setTab, updateNode, removeNode, removeEdgeFromNode, live, model, setModel, maxSteps, setMaxSteps, openRouterModels, openRouterConnectionState, onStart, startReason, paneId, paneLabelledBy, outputSchemas, modelsStatus = 'ready', onRetryModels }: { node: WorkflowNode | undefined; nodes: readonly WorkflowNode[]; edges: readonly WorkflowEdge[]; tab: InspectorTab; setTab: (tab: InspectorTab) => void; updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'title' | 'detail' | 'instructions' | 'config'>>) => void; removeNode?: (id: string) => void; removeEdgeFromNode?: (edgeId: string) => void; live: boolean; model: string; setModel: (model: string) => void; maxSteps: number; setMaxSteps: (steps: number) => void; publishedId?: string | undefined; openRouterModels: readonly OpenRouterModel[]; openRouterConnectionState: string; onStart?: ((input: Record<string, unknown>) => void) | undefined; startReason?: string | undefined; paneId?: string; paneLabelledBy?: string; outputSchemas?: OutputSchemas; modelsStatus?: CatalogStatus; onRetryModels?: () => void }) {
  const root = useRef<HTMLElement>(null);
  useGSAP(() => {
    if (motionAllowed()) gsap.fromTo('.panel-title, fieldset, .inspector-content > *', { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: .3, stagger: .04, ease: 'power2.out', clearProps: 'transform,opacity' });
  }, { scope: root, dependencies: [node?.id, tab] });
  if (node === undefined) return <aside className="inspector" ref={root} id={paneId} role={paneId ? 'tabpanel' : undefined} aria-labelledby={paneLabelledBy}><div className="panel-title"><div><small>Workflow</small><strong>No step selected</strong></div></div><div className="inspector-content"><p>Add a Trigger to begin, or select a step to edit its settings.</p></div></aside>;
  const nodeEdges = edges.filter((edge) => edge.from === node.id || edge.to === node.id);
  return <aside className="inspector" ref={root} id={paneId} role={paneId ? 'tabpanel' : undefined} aria-labelledby={paneLabelledBy}>
    <div className="panel-title"><div><small className="kind-badge" data-kind={node.kind}><KindIcon kind={node.kind} />{kindLabels[node.kind]}</small><strong>{node.title}</strong><p className="field-help">{nodePurpose[node.kind]}</p></div>{live && removeNode && <button className="button-secondary" onClick={() => removeNode(node.id)}>Delete step</button>}</div>
    {!live && <div className="inspector-tabs" role="tablist" aria-label="Step details" onKeyDown={moveTabFocus}>{(['instructions', 'skills', 'connections', 'runtime'] as InspectorTab[]).map((item) => <button key={item} role="tab" id={`inspector-tab-${item}`} aria-selected={tab === item} aria-controls={`inspector-panel-${item}`} tabIndex={tab === item ? 0 : -1} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item[0]!.toUpperCase() + item.slice(1)}</button>)}</div>}
    {!live && tab === 'instructions' && <div className="inspector-content" id="inspector-panel-instructions" role="tabpanel" aria-labelledby="inspector-tab-instructions"><Field label="Step name"><input value={node.title} onChange={(event) => updateNode(node.id, { title: event.target.value })} /></Field><Field label="System instructions"><textarea rows={8} value={node.instructions} onChange={(event) => updateNode(node.id, { instructions: event.target.value })} /></Field><div className="token-row" aria-hidden="true"><code>request.summary</code><code>account.risk_tier</code></div></div>}
    {!live && tab === 'skills' && <div className="inspector-content" id="inspector-panel-skills" role="tabpanel" aria-labelledby="inspector-tab-skills">{fixtureNotice}<AttachedItem name="Customer policy" type="Verified skill" /><AttachedItem name="Account resolver" type="Workspace skill" /></div>}
    {!live && tab === 'connections' && <div className="inspector-content" id="inspector-panel-connections" role="tabpanel" aria-labelledby="inspector-tab-connections">{fixtureNotice}<AttachedItem name="Customer data" type="Remote MCP connection" /><AttachedItem name="Billing actions" type="MCP connection with approval" /><AttachedItem name="Support intake" type="Webhook connection" /></div>}
    {!live && tab === 'runtime' && <div className="inspector-content" id="inspector-panel-runtime" role="tabpanel" aria-labelledby="inspector-tab-runtime">{fixtureNotice}<Field label="Model"><select value={model} onChange={(event) => setModel(event.target.value)}><option>Atlas 2.1</option><option>Compact 1.4</option></select></Field><Field label="Maximum steps"><input type="number" min="1" value={maxSteps} onChange={(event) => setMaxSteps(Math.max(1, Number(event.target.value) || 1))} /></Field><p>Approval policy: required for account changes.</p><p>Trace this step: capture inputs, tool calls, and latency.</p></div>}
    {live && <fieldset><legend>Presentation</legend><Field label="Step name" help="Shown on the canvas only."><input value={node.title} onChange={(event) => updateNode(node.id, { title: event.target.value })} /></Field><Field label="Canvas note"><input value={node.detail} onChange={(event) => updateNode(node.id, { detail: event.target.value })} /></Field>{node.kind === 'agent' && <Field label="System instructions"><textarea rows={8} value={node.instructions} onChange={(event) => updateNode(node.id, { instructions: event.target.value })} /></Field>}</fieldset>}
    {live && <fieldset><legend>Runtime</legend>{node.kind === 'memory' ? <MemorySettings key={node.id} node={node} updateNode={updateNode} owner={toolOwner(nodes, edges, node.id)} /> : node.kind === 'agent' ? <AgentSettings key={node.id} node={node} updateNode={updateNode} openRouterModels={openRouterModels} openRouterConnectionState={openRouterConnectionState} modelsStatus={modelsStatus} onRetryModels={onRetryModels} attached={toolsOf(nodes, edges, node.id).map((tool) => ({ edgeId: edges.find((edge) => edge.role === 'tool' && edge.from === node.id && edge.to === tool.id)?.id ?? '', node: tool }))} detach={(edgeId) => removeEdgeFromNode?.(edgeId)} /> : <StepSettings key={node.id} node={node} nodes={nodes} edges={edges} updateNode={updateNode} onStart={onStart} startReason={startReason} outputSchemas={outputSchemas} />}</fieldset>}
    {live && nodeEdges.length > 0 && <fieldset><legend>Connections</legend><ul className="node-edge-list">{nodeEdges.map((edge) => { const other = nodes.find((item) => item.id === (edge.from === node.id ? edge.to : edge.from)); const outgoing = edge.from === node.id; const label = edge.role === 'tool' ? (outgoing ? 'Tool' : 'Tool of') : outgoing ? '→' : '←'; return <li key={edge.id}>{label} {other?.title ?? 'Unknown step'} {edge.branch ? `(${edge.branch})` : ''} <button onClick={() => removeEdgeFromNode?.(edge.id)}>Remove</button></li>; })}</ul></fieldset>}
  </aside>;
}
function MemorySettings({ node, updateNode, owner }: { owner?: WorkflowNode | undefined; node: WorkflowNode; updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'config'>>) => void }) {
  const [limit, setLimit] = useState(String(node.config?.['limit'] ?? ''));
  const [maxChars, setMaxChars] = useState(String(node.config?.['maxChars'] ?? ''));
  const [errors, setErrors] = useState<Record<'limit' | 'maxChars', string | undefined>>({ limit: undefined, maxChars: undefined });
  const change = (key: 'limit' | 'maxChars', value: string, minimum: number, maximum: number, setValue: (next: string) => void) => {
    setValue(value);
    const result = updateIntegerConfig(node.config ?? {}, key, value, minimum, maximum);
    setErrors((current) => ({ ...current, [key]: result.error }));
    if (result.config) updateNode(node.id, { config: result.config });
  };
  return <><p className="field-help">Retrieval reads this published definition's memory and any attached Memory Imports. Provider readiness is shown in the <a href="#memory-panel">Memory panel</a>.</p>{owner !== undefined && <p className="field-help">Tool of {owner.title}. The model may call memory_search and memory_save during its step. Search returns at most the item and character limits below; a save proposes one memory from the run input and stays pending until reviewed. Nothing is written as promoted.</p>}<Field label="Memory item limit" error={errors.limit}><input type="number" min="1" max="20" step="1" inputMode="numeric" value={limit} onChange={(event) => change('limit', event.target.value, 1, 20, setLimit)} /></Field><Field label="Memory character budget" error={errors.maxChars}><input type="number" min="1" max="4000" step="1" inputMode="numeric" value={maxChars} onChange={(event) => change('maxChars', event.target.value, 1, 4000, setMaxChars)} /></Field><PolicySettings config={node.config ?? {}} update={(policy) => updateNode(node.id, { config: { ...(node.config ?? {}), policy } })} /></>;
}
function PolicySettings({ config, update }: { config: Record<string, unknown>; update: (policy: Record<string, number>) => void }) {
  const policy = config['policy'] as Record<string, number> ?? { milliseconds: 30000, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects: 0 };
  const fields: readonly [keyof typeof policy, string, number, number][] = [['milliseconds', 'Deadline (ms)', 1, 86400000], ['attempts', 'Attempts', 1, 5], ['tokens', 'Token limit', 0, 100000], ['cost', 'Cost limit', 0, 1000], ['toolRounds', 'Tool rounds', 0, 20], ['effects', 'External effects', 0, 20]];
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(([key]) => [key, String(policy[key])])));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const change = (key: keyof typeof policy, label: string, min: number, max: number, value: string) => {
    setText((current) => ({ ...current, [key]: value }));
    const parsed = Number(value);
    const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max && (key === 'cost' || Number.isSafeInteger(parsed));
    setErrors((current) => ({ ...current, [key]: valid ? undefined : `Enter a value from ${min} to ${max}.` }));
    if (valid) update({ ...policy, [key]: parsed });
  };
  return <fieldset><legend>Node policy</legend><p className="field-help">Hard limits the server enforces for this step.</p>{fields.map(([key, label, min, max]) => <Field key={key} label={label} error={errors[key]}><input type="number" min={min} max={max} step={key === 'cost' ? 'any' : '1'} value={text[key] ?? String(policy[key])} onChange={(event) => change(key, label, min, max, event.target.value)} /></Field>)}</fieldset>;
}
function AgentSettings({ node, updateNode, openRouterModels, openRouterConnectionState, attached, detach, modelsStatus, onRetryModels }: { modelsStatus: CatalogStatus; onRetryModels?: (() => void) | undefined; attached: readonly { edgeId: string; node: WorkflowNode }[]; detach: (edgeId: string) => void; node: WorkflowNode; updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'config'>>) => void; openRouterModels: readonly OpenRouterModel[]; openRouterConnectionState: string }) {
  const config = node.config ?? {};
  const enabled = memoryProposalsEnabled(node.config ?? {});
  const guidance = 'Allowed types: task-fact and stated-preference. Every proposal needs text, sourceId, sourceDigest, and excerpt. The server derives tenant, workflow, and owner scope; validates and redacts cited evidence; and rejects secrets, instructions, inferred traits, and unsourced claims.';
  const fullGuidance = 'Allowed types: task-fact and stated-preference. Every proposal needs text, sourceId, sourceDigest, and excerpt; a stated-preference also needs subject, while predecessorId is optional. Text and excerpt are each limited to 1000 characters; subject is limited to 200; return at most three proposals. sourceId and sourceDigest must exactly cite current validated input or a completed event. The server derives tenant, workflow, and owner scope; validates and redacts cited evidence; and rejects secrets, instructions, inferred traits, and unsourced claims.';
  const update = (patch: Record<string, unknown>) => updateNode(node.id, { config: { ...config, ...patch } });
  const [schema, setSchema] = useState(JSON.stringify(config['responseSchema'] ?? {}, null, 2));
  const [schemaError, setSchemaError] = useState<string>();
  return <>
    <Field label="Provider" help="OpenRouter uses this workspace's connection; Azure OpenAI uses the platform deployment."><select value={String(config['provider'] ?? 'azure-openai')} onChange={(event) => update({ provider: event.target.value, model: event.target.value === 'openrouter' ? (openRouterModels.find((item) => item.structuredOutput && (attached.length === 0 || item.tools !== false))?.id ?? '') : 'gpt-4.1', fallback: undefined, ...(event.target.value === 'openrouter' ? { openRouterOptIn: false } : {}) })}><option value="azure-openai">Azure OpenAI</option><option value="openrouter">OpenRouter</option></select></Field>
    {config['provider'] === 'openrouter' && openRouterConnectionState !== 'ready' && <Notice tone="warning">OpenRouter isn't ready in this workspace ({openRouterConnectionState}). An admin can connect it in the <a href="#provider-panel">provider panel</a>.</Notice>}
    {config['provider'] === 'openrouter' && openRouterConnectionState === 'ready' && openRouterModels.length === 0 && <Notice tone="warning">The OpenRouter model catalog couldn't be loaded. Type an exact model slug; publish checks confirm it against the catalog.</Notice>}
    {config['provider'] === 'openrouter'
      ? <ModelPicker label="Exact model" value={String(config['model'] ?? '')} models={openRouterModels} status={modelsStatus} onRetry={onRetryModels} requireStructured requireTools={attached.length > 0} help="Search the live OpenRouter catalog. Each step names its own model." onChange={(model) => update({ model, ...(config['fallback'] === model ? { fallback: undefined } : {}) })} />
      : <ModelPicker label="Exact model" value={String(config['model'] ?? '')} models={azureModels} providerLabel="Azure OpenAI" allowOther strictCatalog={false} help="Azure OpenAI deployment name. Pick a common base model, or enter your own deployment name." onChange={(model) => update({ model, ...(config['fallback'] === model ? { fallback: undefined } : {}) })} />}
    {config['provider'] === 'openrouter'
      ? <ModelPicker label="Fallback model" value={String(config['fallback'] ?? '')} models={openRouterModels} status={modelsStatus} onRetry={onRetryModels} requireStructured requireTools={attached.length > 0} error={config['fallback'] !== undefined && config['fallback'] === config['model'] ? 'Must differ from the exact model.' : undefined} help="Optional. Used only if the exact model is unavailable." onChange={(fallback) => update({ fallback: fallback || undefined })} />
      : <ModelPicker label="Fallback deployment" value={String(config['fallback'] ?? '')} models={azureModels} providerLabel="Azure OpenAI" allowOther strictCatalog={false} error={config['fallback'] !== undefined && config['fallback'] === config['model'] ? 'Must differ from the exact model.' : undefined} help="Optional. Used only if the exact deployment is unavailable; must differ from it." onChange={(fallback) => update({ fallback: fallback || undefined })} />}
    {config['provider'] === 'openrouter' && <label className="switch-row"><span><strong>Allow OpenRouter</strong><small>Use this tenant's verified connection; no key is stored in the draft.</small></span><input type="checkbox" checked={config['openRouterOptIn'] === true} onChange={(event) => update({ openRouterOptIn: event.target.checked })} /></label>}
    <Field label="Response schema (advanced JSON)" error={schemaError}><textarea rows={8} value={schema} onChange={(event) => setSchema(event.target.value)} onBlur={() => { try { const value: unknown = JSON.parse(schema); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); update({ responseSchema: value }); setSchemaError(undefined); } catch { setSchemaError('Enter a JSON object.'); } }} /></Field>
    <fieldset><legend>Tools</legend>{attached.length === 0 ? <p className="field-help">No tools attached. Drag from the tool port under this Agent to an MCP or a Memory step so the model can use it while it works. This Agent may use up to sixteen tools, with at most one Memory tool.</p> : <ul className="node-edge-list">{attached.map((tool) => <li key={tool.edgeId}>{tool.node.title} · {tool.node.kind === 'memory' ? 'memory search and save' : String(tool.node.config?.['capability'] || 'no capability yet')} <button onClick={() => detach(tool.edgeId)}>Detach</button></li>)}</ul>}{attached.length > 0 && <p className="field-help">The model decides when to call these, one call at a time, up to the tool-round and external-effect limits below. Calls that change data wait for admin approval in Run History. A memory save counts as an external effect and is staged as a pending proposal.</p>}</fieldset>
    <PolicySettings config={config} update={(policy) => update({ policy })} />
    <label className="switch-row"><span><strong>Allow operational memory proposals</strong><small>Lets this Agent return an optional memoryProposals array.</small></span><input type="checkbox" checked={enabled} onChange={(event) => updateNode(node.id, { config: setMemoryProposals(config, event.target.checked) })} /></label>
    <div className="field-help">{guidance} <details><summary>Proposal rules</summary><p>{fullGuidance}</p></details></div>
  </>;
}
function StepSettings(props: { outputSchemas?: OutputSchemas | undefined; node: WorkflowNode; nodes: readonly WorkflowNode[]; edges: readonly WorkflowEdge[]; updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'config'>>) => void; onStart?: ((input: Record<string, unknown>) => void) | undefined; startReason?: string | undefined }) {
  if (props.node.kind === 'trigger') return <TriggerSettings node={props.node} updateNode={props.updateNode} onStart={props.onStart} startReason={props.startReason} />;
  if (props.node.kind === 'end') return <p>End completes the run and has no runtime settings.</p>;
  if (props.node.kind === 'condition') return <ConditionSettings node={props.node} nodes={props.nodes} edges={props.edges} updateNode={props.updateNode} outputSchemas={props.outputSchemas} />;
  if (props.node.kind === 'approval') return <ApprovalSettings node={props.node} nodes={props.nodes} edges={props.edges} updateNode={props.updateNode} />;
  if (props.node.kind === 'mcp') return <McpSummary node={props.node} updateNode={props.updateNode} owner={toolOwner(props.nodes, props.edges, props.node.id)} />;
  return <RawSettings node={props.node} updateNode={props.updateNode} />;
}
function RawSettings({ node, updateNode }: { node: WorkflowNode; updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'config'>>) => void }) {
  const [value, setValue] = useState(JSON.stringify(node.config ?? {}, null, 2));
  const [error, setError] = useState<string>();
  return <Field label="Step settings" error={error}><textarea rows={9} value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => { try { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); updateNode(node.id, { config: parsed as Record<string, unknown> }); setError(undefined); } catch { setError('Enter a valid settings object.'); } }} /></Field>;
}
function ConditionSettings({ node, nodes, edges, updateNode, outputSchemas }: { outputSchemas?: OutputSchemas | undefined; node: WorkflowNode; nodes: readonly WorkflowNode[]; edges: readonly WorkflowEdge[]; updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'config'>>) => void }) {
  const config = node.config ?? {}; const sources = conditionSources(nodes, edges, node.id, outputSchemas); const source = sources.find((item) => item.id === config['source'] || config['source'] === 'input' && item.kind === 'trigger') ?? sources[0]; const fields = source ? conditionFields(source, outputSchemas) : []; const field = fields.find(([name]) => name === config['field']) ?? fields[0];
  const update = (nextSource = source, nextField = field, equals: unknown = config['equals']) => nextSource && nextField && updateNode(node.id, { config: { source: nextSource.kind === 'trigger' ? 'input' : nextSource.id, field: nextField[0], equals } });
  const trueTarget = nodes.find((candidate) => edges.some((edge) => edge.from === node.id && edge.branch === 'true' && edge.to === candidate.id));
  const falseTarget = nodes.find((candidate) => edges.some((edge) => edge.from === node.id && edge.branch === 'false' && edge.to === candidate.id));
  if (!source || !field) return <p>Add and connect a Trigger or Agent before this Condition, with a string, number, or boolean field.</p>;
  const type = field[1];
  return <>
    <Field label="Source"><select value={source.id} onChange={(event) => { const next = sources.find((item) => item.id === event.target.value); const first = next && conditionFields(next, outputSchemas)[0]; update(next, first, first?.[1] === 'boolean' ? false : first?.[1] === 'number' ? 0 : ''); }}><option value={source.id}>{source.kind === 'trigger' ? 'input' : source.title}</option>{sources.filter((item) => item.id !== source.id).map((item) => <option key={item.id} value={item.id}>{item.kind === 'trigger' ? 'input' : item.title}</option>)}</select></Field>
    <Field label="Field"><select value={field[0]} onChange={(event) => { const next = fields.find(([name]) => name === event.target.value)!; update(source, next, next[1] === 'boolean' ? false : next[1] === 'number' ? 0 : ''); }}>{fields.map(([name, value]) => <option key={name} value={name}>{name} ({value})</option>)}</select></Field>
    <Field label="Equals">{type === 'boolean' ? <select value={String(config['equals'])} onChange={(event) => update(source, field, event.target.value === 'true')}><option value="true">true</option><option value="false">false</option></select> : <input type={type === 'number' ? 'number' : 'text'} value={String(config['equals'] ?? '')} onChange={(event) => update(source, field, type === 'number' ? Number(event.target.value) : event.target.value)} />}</Field>
    <p>True → {trueTarget ? trueTarget.title : 'branch not connected'}</p>
    <p>False → {falseTarget ? falseTarget.title : 'branch not connected'}</p>
  </>;
}
const MAX_DISCLOSED = 6;
function ApprovalSettings({ node, nodes, edges, updateNode }: { node: WorkflowNode; nodes: readonly WorkflowNode[]; edges: readonly WorkflowEdge[]; updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'config'>>) => void }) {
  const next = nodes.find((candidate) => edges.some((edge) => edge.from === node.id && edge.to === candidate.id));
  const stored = Number(node.config?.['timeoutMs'] ?? 3600000);
  const [text, setText] = useState(String(stored));
  const [error, setError] = useState<string>();
  const change = (value: string) => {
    setText(value);
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 86400000) { setError(undefined); updateNode(node.id, { config: { ...node.config, timeoutMs: parsed } }); }
    else setError('Enter a value from 1 to 86400000.');
  };
  const nextArgs = next?.config?.['arguments'];
  const names = nextArgs !== null && typeof nextArgs === 'object' && !Array.isArray(nextArgs) ? Object.keys(nextArgs) : [];
  const disclosed = Array.isArray(node.config?.['disclose']) ? (node.config['disclose'] as unknown[]).filter((name): name is string => typeof name === 'string') : [];
  const disclose = (name: string, on: boolean) => {
    const chosen = on ? [...disclosed, name] : disclosed.filter((item) => item !== name);
    const { disclose: _previous, ...rest } = node.config ?? {};
    updateNode(node.id, { config: chosen.length ? { ...rest, disclose: chosen } : rest });
  };
  return <>
    <Field label="Approval timeout (ms)" help={`≈ ${Math.round((Number.isFinite(Number(text)) ? Number(text) : stored) / 60000)} minutes`} error={error}><input type="number" min="1" max="86400000" step="1" value={text} onChange={(event) => change(event.target.value)} /></Field>
    {names.length > 0 && <Field label="Show the approver" help="Argument values shown in full to the approver. They are the exact values the effect will receive; up to six."><>{names.map((name) => <label key={name} className="check-row"><input type="checkbox" checked={disclosed.includes(name)} disabled={!disclosed.includes(name) && disclosed.length >= MAX_DISCLOSED} onChange={(event) => disclose(name, event.target.checked)} />{name}</label>)}</></Field>}
    <p>{next?.kind === 'mcp' ? `This Approval waits for an administrator, then permits the immediately following MCP effect: ${next.title}. The review is bound to this run.` : 'Connect this Approval directly to an MCP effect to publish.'}</p>
    <p>Workspace admins approve or reject in Run History, and group admins can also decide from the Governance approvals inbox. Run History shows the wait deadline, decision, and receipt. Rejections stop the effect, expired or stale decisions must be refreshed, and an unknown external effect needs reconciliation.</p>
  </>;
}
function McpSummary({ node, updateNode, owner }: { owner?: WorkflowNode | undefined; node: WorkflowNode; updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'config'>>) => void }) {
  const config = node.config ?? {};
  const installationId = typeof config['installationId'] === 'string' && config['installationId'] ? config['installationId'] : undefined;
  const capability = typeof config['capability'] === 'string' && config['capability'] ? config['capability'] : undefined;
  const args = config['arguments'] !== null && typeof config['arguments'] === 'object' && !Array.isArray(config['arguments']) ? config['arguments'] as Record<string, unknown> : {};
  return <>
    <dl>
      <dt>Installation</dt><dd>{installationId ?? 'Not set'}</dd>
      <dt>Capability</dt><dd>{capability ?? 'Not set'}</dd>
      {owner === undefined && Object.entries(args).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' && value.startsWith('$') ? `from ${value}` : 'constant'}</dd></div>)}
    </dl>
    {owner !== undefined && <p className="field-help">Tool of {owner.title}. The model fills this capability's arguments from its input schema on every call; nothing is mapped here.</p>}
    <p><a href="#connector-panel">Edit binding in Connector panel</a></p>
    <details><summary>Advanced: raw settings</summary><RawSettings node={node} updateNode={updateNode} /></details>
  </>;
}
function TriggerSettings({ node, updateNode, onStart, startReason }: { node: WorkflowNode; updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'config'>>) => void; onStart?: ((input: Record<string, unknown>) => void) | undefined; startReason?: string | undefined }) {
  const config = node.config ?? {}; const mode = config['mode'] === 'webhook' ? 'webhook' : 'manual'; const schema = config['inputSchema'] as TriggerSchema ?? { type: 'object', properties: {}, required: [], additionalProperties: false };
  const update = (next: TriggerSchema, nextMode = mode) => updateNode(node.id, { config: { mode: nextMode, inputSchema: next } });
  return <>
    <Field label="Trigger mode" help={mode === 'manual' ? 'Start runs from Studio with the sample input below once published.' : 'Signed events start runs through the published URL. Set up signing in the Webhook panel after publishing.'}><select value={mode} onChange={(event) => update(schema, event.target.value)}><option value="manual">Manual</option><option value="webhook">Webhook</option></select></Field>
    {mode === 'webhook' && <p><a href="#webhook-panel">Open Webhook panel</a></p>}
    <fieldset><legend>Input contract</legend><p className="field-help">Every run's input must match these fields.</p>{Object.entries(schema.properties).map(([name, field]) => <TriggerField key={name} name={name} type={field.type} required={schema.required.includes(name)} schema={schema} save={(nextName, type, required) => update(setSchemaField(schema, nextName, type, required, name))} remove={() => update(removeSchemaField(schema, name))} />)}<button type="button" className="dashed-button" onClick={() => update(setSchemaField(schema, `field${Object.keys(schema.properties).length + 1}`, 'string', false))}>Add input field</button></fieldset>
    {mode === 'manual' && onStart && <ManualInput schema={schema} onStart={onStart} startReason={startReason} />}
  </>;
}
function ManualInput({ schema, onStart, startReason }: { schema: TriggerSchema; onStart: (input: Record<string, unknown>) => void; startReason?: string | undefined }) {
  const [values, setValues] = useState<Record<string, unknown>>({}); const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = () => { const parsed = parseTriggerInput(schema, values); if (parsed.errors) { setErrors(parsed.errors); return; } onStart(parsed.input ?? {}); };
  return <fieldset><legend>Sample input</legend>{Object.entries(schema.properties).map(([name, field]) => <Field key={name} label={`${name}${schema.required.includes(name) ? ' (required)' : ''}`} error={errors[name]}>{field.type === 'boolean' ? <select value={String(values[name] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value === 'true' }))}><option value="">Choose</option><option value="true">True</option><option value="false">False</option></select> : field.type === 'array' ? <textarea aria-label={`${name} items`} placeholder="One item per line" onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value.split('\n').filter(Boolean) }))} /> : field.type === 'object' ? <textarea aria-label={`${name} fields`} placeholder="One name: value per line" onChange={(event) => setValues((current) => ({ ...current, [name]: Object.fromEntries(event.target.value.split('\n').map((line) => line.split(':').map((part) => part.trim())).filter(([key]) => key)) }))} /> : <input type={field.type === 'number' ? 'number' : 'text'} value={String(values[name] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))} />}</Field>)}<button type="button" className="button-secondary" onClick={submit} disabled={startReason !== undefined} aria-describedby={startReason ? 'manual-start-reason' : undefined}>Start run</button>{startReason && <p id="manual-start-reason" className="field-help">{startReason}</p>}</fieldset>;
}
function TriggerField({ name, type, required, schema, save, remove }: { name: string; type: TriggerFieldType; required: boolean; schema: TriggerSchema; save: (name: string, type: TriggerFieldType, required: boolean) => void; remove: () => void }) {
  const [nextName, setNextName] = useState(name); const [nextType, setNextType] = useState(type); const [nextRequired, setNextRequired] = useState(required); const [error, setError] = useState<string>();
  const commit = () => { const message = schemaFieldNameError(schema, nextName, name); setError(message); if (message === undefined) save(nextName, nextType, nextRequired); };
  return <div className="trigger-field"><Field label="Name" error={error}><input value={nextName} onChange={(event) => setNextName(event.target.value)} onBlur={commit} /></Field><Field label="Type"><select value={nextType} onChange={(event) => { const value = event.target.value as TriggerFieldType; setNextType(value); if (schemaFieldNameError(schema, nextName, name) === undefined) save(nextName, value, nextRequired); }}><option value="string">Text</option><option value="number">Number</option><option value="boolean">True or false</option><option value="object">Object</option><option value="array">List</option></select></Field><Field label="Required"><input type="checkbox" checked={nextRequired} onChange={(event) => { setNextRequired(event.target.checked); if (schemaFieldNameError(schema, nextName, name) === undefined) save(nextName, nextType, event.target.checked); }} /></Field><button type="button" aria-label={`Remove ${name}`} onClick={remove}>Remove</button></div>;
}
export function AttachedItem({ name, type }: { name: string; type: string }) { return <div className="attached-item"><i /><span><strong>{name}</strong><small>{type}</small></span></div>; }

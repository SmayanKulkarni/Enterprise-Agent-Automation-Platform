import { useEffect, useState } from 'react';
import { digest } from '../../../packages/contracts/src/index.js';
import type { WorkflowEdge, WorkflowNode } from './workflow-model.js';
import { mappingFields } from './workflow-model.js';
import type { PlatformApi, Projection } from './platform-api.js';
import { OpenRouterConnectionPanel } from './openrouter-connection-panel.js';

interface ConnectorPanelProps {
  api: PlatformApi;
  tenantId: string;
  draftId: string | undefined;
  node: WorkflowNode | undefined;
  nodes: readonly WorkflowNode[];
  edges: readonly WorkflowEdge[];
  admin: boolean;
  connection: Projection | undefined;
  connectionState: 'loading' | 'ready' | 'failed';
  onPin: (config: Record<string, unknown>) => void;
}

type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

interface Capability {
  name: string;
  risk: string;
  inputSchema: {
    properties: Record<string, { type: FieldType }>;
    required: string[];
  };
}

interface Manifest {
  digest?: string;
  certified?: boolean;
  version?: string;
  capabilities?: readonly Capability[];
}

const certificationTemplate = JSON.stringify({ route: 'public', endpoint: 'https://example.com/mcp', health: 'healthy', manifest: { version: '1', capabilities: [{ name: 'operation', risk: 'R1', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, outputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } }] } }, null, 2);

function certifiedInstallations(projection: Projection | undefined): readonly Record<string, unknown>[] {
  return (projection?.records ?? []).filter((item) => {
    const manifest = item['manifest'] as Manifest | undefined;
    return item['health'] === 'healthy' && manifest?.certified === true;
  });
}

function constant(type: FieldType, value: string): unknown {
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value === 'true';
  return value;
}

export function ConnectorPanel({ api, tenantId, draftId, node, nodes, edges, admin, connection, connectionState, onPin }: ConnectorPanelProps) {
  const config = node?.config ?? {};
  const [installations, setInstallations] = useState<Projection>();
  const [installationId, setInstallationId] = useState(String(config['installationId'] ?? ''));
  const [capabilityName, setCapabilityName] = useState(String(config['capability'] ?? ''));
  const [newInstallationId, setNewInstallationId] = useState('');
  const [manifestText, setManifestText] = useState(certificationTemplate);
  const [token, setToken] = useState<string>();
  const [message, setMessage] = useState<string>();

  const refresh = async () => {
    setInstallations(await api.projection(tenantId, 'connector-installations'));
  };

  useEffect(() => {
    void refresh().catch(() => setMessage('Connector choices could not be loaded.'));
  }, [api, tenantId]);

  useEffect(() => {
    setInstallationId(String(config['installationId'] ?? ''));
    setCapabilityName(String(config['capability'] ?? ''));
  }, [node?.id, node?.config]);

  const choices = certifiedInstallations(installations);
  const installation = choices.find((item) => item['id'] === installationId);
  const manifest = installation?.['manifest'] as Manifest | undefined;
  const capability = manifest?.capabilities?.find((item) => item.name === capabilityName);

  const selectInstallation = (nextId: string) => {
    setInstallationId(nextId);
    setCapabilityName('');
    onPin({ ...config, installationId: nextId, capability: '', manifestDigest: '', grantId: '', target: '', arguments: {} });
  };

  const selectCapability = (nextName: string) => {
    setCapabilityName(nextName);
    onPin({ ...config, installationId, capability: nextName, manifestDigest: manifest?.digest ?? '', grantId: '', target: '', arguments: {} });
  };

  const grant = async () => {
    if (!draftId || !node || !capability || !manifest?.digest) return;
    try {
      const result = await api.command({ tenantId, owner: 'workflow', name: 'grant', expectedVersion: 0, arguments: { id: draftId, nodeId: node.id, installationId, capability: capability.name } });
      onPin({ ...config, installationId, capability: capability.name, manifestDigest: manifest.digest, grantId: result.objectId });
      setMessage('Capability granted to this node. Save the draft, then run the server check.');
      await refresh();
    } catch {
      setMessage('Grant was denied. Only an administrator can grant a healthy certified Capability.');
    }
  };

  const certify = async () => {
    try {
      const parsed: unknown = JSON.parse(manifestText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID');
      const installation = parsed as Record<string, unknown>;
      const rawManifest = installation['manifest'];
      if (!rawManifest || typeof rawManifest !== 'object' || Array.isArray(rawManifest)) throw new Error('INVALID');
      const id = newInstallationId || crypto.randomUUID();
      const manifest = rawManifest as Record<string, unknown>;
      const certifiedInstallation = { ...installation, manifest: { ...manifest, certified: true, digest: await digest({ version: manifest['version'], capabilities: manifest['capabilities'] }) } };
      await api.command({ tenantId, owner: 'workflow', name: 'certify', expectedVersion: 0, arguments: { id, installation: certifiedInstallation } });
      setNewInstallationId(id);
      setMessage(`Installation ${id} certified.`);
      await refresh();
    } catch {
      setMessage('Certification failed. Check the manifest, endpoint, and administrator access.');
    }
  };

  const tokenAction = async (id: string, version: number, action: 'enroll' | 'rotate' | 'revoke') => {
    try {
      const result = await api.command({ tenantId, owner: 'workflow', name: action, expectedVersion: version, arguments: { id } });
      setToken(result.enrollmentToken);
      setMessage(result.enrollmentToken ? 'Copy this token now. It will not be shown again.' : 'Installation revoked.');
      await refresh();
    } catch {
      setMessage('Token change was denied or the installation changed. Refresh and retry.');
    }
  };

  if (node?.kind !== 'mcp') return <OpenRouterConnectionPanel api={api} tenantId={tenantId} admin={admin} initialStatus={connection} initialState={connectionState} />;

  return <section className="connector-panel" aria-label="Connector installations">
    <div className="pane-heading">
      <div>
        <p>Connector authority</p>
        <h2>Certified capability</h2>
        <span>Only healthy, tenant-scoped certified installations are available.</span>
      </div>
      <button className="button-secondary" onClick={() => void refresh()}>Refresh</button>
    </div>
    {message && <p className="field-help" role="status">{message}</p>}
    {token && <p className="connector-token"><strong>Enrollment token</strong><code>{token}</code></p>}
    <div className="connector-grid">
    <label className="field">Installation
      <select aria-label="Installation" value={installationId} onChange={(event) => selectInstallation(event.target.value)}>
        <option value="">Select certified installation</option>
        {choices.map((item) => <option key={String(item['id'])} value={String(item['id'])}>{String(item['id'])} · healthy</option>)}
      </select>
    </label>
    <label className="field">Capability
      <select aria-label="Capability" value={capabilityName} disabled={!installation} onChange={(event) => selectCapability(event.target.value)}>
        <option value="">Select capability</option>
        {manifest?.capabilities?.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.risk}</option>)}
      </select>
    </label>
    </div>
    {installation && <p>{String(installation['route'])} route · manifest {manifest?.version}</p>}
    {capability && <ArgumentMappings capability={capability} config={config} nodes={nodes} edges={edges} targetId={node.id} onPin={onPin} />}
    {admin && <button className="button" disabled={!draftId || !capability} onClick={() => void grant()}>Grant to this node</button>}
    {!admin && <p>An administrator must grant the selected Capability before publication.</p>}
    {admin && <section className="connector-certify">
      <label className="field">Installation ID<input value={newInstallationId} onChange={(event) => setNewInstallationId(event.target.value)} placeholder="New ID generated when blank" /></label>
      <label className="field">Certified installation JSON<textarea rows={10} value={manifestText} onChange={(event) => setManifestText(event.target.value)} /></label>
      <button className="button" onClick={() => void certify()}>Certify installation</button>
      {choices.filter((item) => item['route'] === 'private').map((item) => <div key={String(item['id'])}>
        <button className="button-secondary" onClick={() => void tokenAction(String(item['id']), Number(item['version']), 'enroll')}>Enroll</button>
        <button className="button-secondary" onClick={() => void tokenAction(String(item['id']), Number(item['version']), 'rotate')}>Rotate</button>
        <button className="button-secondary" onClick={() => void tokenAction(String(item['id']), Number(item['version']), 'revoke')}>Revoke</button>
      </div>)}
    </section>}
  </section>;
}

function ArgumentMappings({ capability, config, nodes, edges, targetId, onPin }: { capability: Capability; config: Record<string, unknown>; nodes: readonly WorkflowNode[]; edges: readonly WorkflowEdge[]; targetId: string; onPin: (config: Record<string, unknown>) => void }) {
  const values = config['arguments'] && typeof config['arguments'] === 'object' && !Array.isArray(config['arguments']) ? config['arguments'] as Record<string, unknown> : {};
  const update = (name: string, value: unknown) => onPin({ ...config, arguments: { ...values, [name]: value } });

  return <section>
    <strong>Arguments</strong>
    {Object.entries(capability.inputSchema.properties).map(([name, field]) => <label className="field" key={name}>
      <span>{name}{capability.inputSchema.required.includes(name) ? ' (required)' : ''} · {field.type}</span>
      <select aria-label={`${name} source`} value={typeof values[name] === 'string' && values[name].startsWith('$') ? values[name] : 'constant'} onChange={(event) => update(name, event.target.value === 'constant' ? field.type === 'boolean' ? false : '' : event.target.value)}><option value="constant" disabled={field.type === 'object' || field.type === 'array'}>Constant</option>{mappingFields(nodes, edges, targetId, field.type).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      {!(typeof values[name] === 'string' && values[name].startsWith('$')) && (field.type === 'boolean' ? <select aria-label={`${name} value`} value={String(values[name] ?? false)} onChange={(event) => update(name, constant(field.type, event.target.value))}><option value="false">false</option><option value="true">true</option></select> : field.type === 'object' || field.type === 'array' ? <span role="alert">Choose a compatible Trigger or prior Agent field.</span> : <input aria-label={`${name} value`} type={field.type === 'number' ? 'number' : 'text'} value={String(values[name] ?? '')} onChange={(event) => update(name, constant(field.type, event.target.value))} />)}
      {capability.inputSchema.required.includes(name) && values[name] === undefined && <span role="alert">Choose a value for {name}.</span>}
    </label>)}
  </section>;
}

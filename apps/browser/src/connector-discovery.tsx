import { useState } from 'react';
import { digest } from '../../../packages/contracts/src/index.js';
import { buildInstallation, initialChoices, type DiscoveredTool, type ResultType, type Risk, type ToolChoice } from './discovery-model.js';
import { failureNotice } from './error-view.js';
import { PlatformApiError, type PlatformApi } from './platform-api.js';

interface Props {
  api: PlatformApi;
  tenantId: string;
  installationId: string;
  onInstallationId: (id: string) => void;
  onCertified: () => Promise<void>;
}

const RISKS: readonly Risk[] = ['R1', 'R2', 'R3'];
const RESULTS: readonly ResultType[] = ['object', 'array', 'string'];

export function ConnectorDiscovery({ api, tenantId, installationId, onInstallationId, onCertified }: Props) {
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [tools, setTools] = useState<readonly DiscoveredTool[]>([]);
  const [choices, setChoices] = useState<Record<string, ToolChoice>>({});
  const [message, setMessage] = useState<string>();

  const saveToken = async (id: string) => {
    const status = await api.projection(tenantId, 'workflow-mcp-credentials');
    const record = status.records.find((item) => item['id'] === id);
    const name = record?.['enabled'] === true ? 'rotate-mcp-credential' : 'connect-mcp-credential';
    await api.command({ tenantId, owner: 'workflow', name, expectedVersion: Number(record?.['version'] ?? 0), arguments: { id, key: token } });
    setToken('');
  };

  const discover = async () => {
    const id = installationId || crypto.randomUUID();
    onInstallationId(id);
    try {
      if (token !== '') await saveToken(id);
      const receipt = await api.command({ tenantId, owner: 'workflow', name: 'discover-tools', expectedVersion: 0, arguments: { id, endpoint } });
      const found = receipt.discovery?.tools ?? [];
      setTools(found);
      setChoices(initialChoices(found));
      setMessage(`${found.length} tools found. Every tool starts at the most restrictive risk. Set the risk, review, then certify.`);
    } catch (error) {
      setTools([]);
      setMessage(failureNotice(error, 'Tools could not be discovered. Check the endpoint, that its host is allowed, and that a token is saved.', { write: true }));
    }
  };

  const certify = async () => {
    try {
      const installation = buildInstallation(endpoint, tools, choices);
      const manifest = { ...installation.manifest, certified: true, digest: await digest({ version: installation.manifest.version, capabilities: installation.manifest.capabilities }) };
      await api.command({ tenantId, owner: 'workflow', name: 'certify', expectedVersion: 0, arguments: { id: installationId, installation: { ...installation, manifest } } });
      setMessage(`Installation ${installationId} certified.`);
      await onCertified();
    } catch (error) {
      setMessage(error instanceof Error && !(error instanceof PlatformApiError) ? error.message : failureNotice(error, 'Certification failed. Check the choices and administrator access.', { write: true }));
    }
  };

  const update = (name: string, patch: Partial<ToolChoice>) => setChoices((current) => ({ ...current, [name]: { ...(current[name] as ToolChoice), ...patch } }));

  return <section className="connector-discovery" aria-label="Discover tools">
    <strong>Discover tools</strong>
    <label className="field">Endpoint<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://mcp.example.com/mcp" /></label>
    <label className="field">Access token<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Leave blank to use the saved token" /></label>
    <button className="button" disabled={endpoint === ''} onClick={() => void discover()}>Discover tools</button>
    {message && <p className="field-help" role="status">{message}</p>}
    {tools.map((tool) => {
      const choice = choices[tool.name];
      if (choice === undefined) return null;
      return <div className="connector-tool" key={tool.name}>
        <label><input type="checkbox" checked={choice.include} onChange={(event) => update(tool.name, { include: event.target.checked })} /> {tool.name}</label>
        {tool.description && <span className="field-help">{tool.description}</span>}
        <span>{tool.fields.map((field) => `${field.name} (${field.type}${field.required ? ', required' : ''})`).join(', ') || 'No arguments'}</span>
        <label className="field">Risk<select aria-label={`${tool.name} risk`} value={choice.risk} onChange={(event) => update(tool.name, { risk: event.target.value as Risk })}>{RISKS.map((risk) => <option key={risk} value={risk}>{risk}</option>)}</select></label>
        <label className="field">Result type<select aria-label={`${tool.name} result type`} value={choice.result} onChange={(event) => update(tool.name, { result: event.target.value as ResultType })}>{RESULTS.map((result) => <option key={result} value={result}>{result}</option>)}</select></label>
        <label className="field">Fixed arguments<textarea rows={2} aria-label={`${tool.name} fixed arguments`} value={choice.fixed} onChange={(event) => update(tool.name, { fixed: event.target.value })} placeholder="name=value, one per line" /></label>
      </div>;
    })}
    {tools.length > 0 && <button className="button" onClick={() => void certify()}>Certify discovered tools</button>}
  </section>;
}

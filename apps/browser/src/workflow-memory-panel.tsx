import { useEffect, useState } from 'react';
import { expiryInstant, localDateTime } from './workflow-model.js';
import { PlatformApiError, type PlatformApi, type Projection } from './platform-api.js';

type MemoryItem = Record<string, unknown>;
type Retrieval = Record<string, unknown> & { runId: unknown };

export function WorkflowMemoryPanel({ api, tenantId, definitionId, admin, initialRuns, initialRunsState }: { api: PlatformApi; tenantId: string; definitionId: string; admin: boolean; initialRuns: Projection | undefined; initialRunsState: 'loading' | 'ready' | 'failed' }) {
  const [items, setItems] = useState<Projection>();
  const [readiness, setReadiness] = useState<Projection>();
  const [runs, setRuns] = useState<Projection>();
  const [replacement, setReplacement] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const [expiryError, setExpiryError] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const refresh = async (active = () => true) => {
    const [nextItems, nextReadiness, nextRuns] = await Promise.all([api.projection(tenantId, 'workflow-memory-items'), api.projection(tenantId, 'workflow-memory-readiness'), api.projection(tenantId, 'workflow-runs')]);
    if (active()) { setItems(nextItems); setReadiness(nextReadiness); setRuns(nextRuns); }
  };
  useEffect(() => { let active = true; setItems(undefined); setReadiness(undefined); setReplacement({}); setExpiry({}); setExpiryError({}); setMessage(undefined); void Promise.all([api.projection(tenantId, 'workflow-memory-items'), api.projection(tenantId, 'workflow-memory-readiness')]).then(([nextItems, nextReadiness]) => { if (active) { setItems(nextItems); setReadiness(nextReadiness); } }).catch(() => active && setMessage('Memory status could not be loaded.')); return () => { active = false; }; }, [api, tenantId, definitionId]);
  useEffect(() => { setRuns(initialRunsState === 'ready' ? initialRuns : undefined); }, [initialRuns, initialRunsState]);
  const action = async (name: 'withdraw-memory' | 'hold-memory' | 'release-memory-hold' | 'delete-memory', item: MemoryItem) => {
    try { await api.command({ tenantId, owner: 'workflow', name, expectedVersion: Number(item['version']), arguments: { id: String(item['id']), reason: 'Administrator lifecycle action.' } }); setMessage('Memory lifecycle action recorded.'); await refresh(); }
    catch { setMessage('Memory lifecycle action was not accepted.'); }
  };
  const correct = async (item: MemoryItem) => {
    const text = replacement[String(item['id'])] ?? '';
    try { await api.command({ tenantId, owner: 'workflow', name: 'correct-memory', expectedVersion: Number(item['version']), arguments: { id: String(item['id']), text } }); setReplacement((value) => ({ ...value, [String(item['id'])]: '' })); setMessage('Corrected successor promoted and predecessor withdrawn.'); await refresh(); }
    catch { setMessage('Memory correction was not accepted.'); }
  };
  const invalidate = async (sourceId: string) => {
    try { await api.command({ tenantId, owner: 'workflow', name: 'invalidate-memory-source', expectedVersion: 0, arguments: { sourceId } }); setMessage('Source invalidated for future retrieval.'); await refresh(); }
    catch { setMessage('Source invalidation was not accepted.'); }
  };
  const setItemExpiry = async (item: MemoryItem) => {
    const itemId = String(item['id']);
    const result = expiryInstant(expiry[itemId] ?? localDateTime(String(item['expiresAt'] ?? '')), String(item['expiresAt'] ?? ''));
    if (!result.iso) { setExpiryError((value) => ({ ...value, [itemId]: result.error! })); return; }
    try { await api.command({ tenantId, owner: 'workflow', name: 'set-memory-expiry', expectedVersion: Number(item['version']), arguments: { id: itemId, expiresAt: result.iso } }); setExpiryError((value) => ({ ...value, [itemId]: '' })); setMessage('Memory expiry was shortened and refreshed.'); await refresh(); }
    catch (error) { const category = error instanceof PlatformApiError ? error.category : undefined; setExpiryError((value) => ({ ...value, [itemId]: category === 'conflict' ? 'This item changed. Refresh and try again.' : category === 'denied' ? 'You are not allowed to change this expiry.' : category === 'invalid' ? 'This expiry is not valid. Choose an earlier value.' : 'Expiry could not be updated. Try again.' })); }
  };
  const state = String(readiness?.records[0]?.['state'] ?? 'loading');
  const scoped = items?.records.filter((item) => item['stableDefinitionId'] === definitionId || item['definitionId'] === definitionId) ?? [];
  const retrievals: Retrieval[] = runs?.records.filter((run) => run['definitionId'] === definitionId || run['stableDefinitionId'] === definitionId).flatMap((run) => Array.isArray(run['retrievals']) ? (run['retrievals'] as Record<string, unknown>[]).map((item) => ({ ...item, runId: run['id'] })) : []) ?? [];
  return <section className="memory-import-panel" aria-label="Workflow memory">
    <strong>Operational memory</strong><span>Provider state: {state}</span>
    <p>Promotion and removal retry automatically; terminal failures remain visible here.</p>
    {state === 'loading' && <p>Loading provider readiness.</p>}
    {state === 'disabled' && <p>Memory is disabled. A tenant administrator must enable it.</p>}
    {state === 'not-configured' && <p>Hosted memory is not configured. A deployment operator must configure the integration.</p>}
    {state === 'ready' && <p>Hosted retrieval is ready.</p>}
    {state === 'unavailable' && <p>Hosted memory is unavailable. Runs continue without recalled context.</p>}
    {scoped.length === 0 && items && <p>No redacted memory metadata is available for this definition.</p>}
    {scoped.map((item) => <article key={String(item['id'])}>
      <strong>{String(item['type'])} · {String(item['state'])}</strong>
      <span>Source {String(item['sourceId'])} · digest {String(item['sourceDigest'])} · revision {String(item['producingRevision'])} · owner {item['ownerScoped'] === true ? 'scoped' : 'definition'} · predecessor {String(item['predecessorId'] ?? 'none')} · promoted {String(item['promotedAt'] ?? 'not promoted')} · expiry {String(item['expiresAt'] ?? 'none')} · hold {item['hold'] === true ? 'on' : 'off'} · vector {String(item['vectorState'] ?? 'unavailable')}</span>
      {item['failure'] !== undefined && <span> Failure {String(item['failure'])}</span>}
      {['pending', 'failed', 'rejected'].includes(String(item['state'])) && <span>Not retrievable.</span>}
      {admin && <div>
        {item['state'] === 'promoted' && <button onClick={() => void action('withdraw-memory', item)}>Withdraw</button>}
        <button onClick={() => void action(item['hold'] === true ? 'release-memory-hold' : 'hold-memory', item)}>{item['hold'] === true ? 'Release hold' : 'Hold'}</button>
        {item['hold'] !== true && <button onClick={() => void action('delete-memory', item)}>Delete</button>}
        <button onClick={() => void invalidate(String(item['sourceId']))}>Invalidate source</button>
        {typeof item['expiresAt'] === 'string' && <label>Expiry<input type="datetime-local" aria-describedby={expiryError[String(item['id'])] ? `expiry-${String(item['id'])}` : undefined} value={expiry[String(item['id'])] ?? localDateTime(item['expiresAt'])} max={localDateTime(item['expiresAt'])} onChange={(event) => { const itemId = String(item['id']); setExpiry((value) => ({ ...value, [itemId]: event.target.value })); setExpiryError((value) => ({ ...value, [itemId]: '' })); }} /><button onClick={() => void setItemExpiry(item)}>Set expiry</button>{expiryError[String(item['id'])] && <span id={`expiry-${String(item['id'])}`} role="alert">{expiryError[String(item['id'])]}</span>}</label>}
        <input aria-label={`Correct ${String(item['id'])}`} value={replacement[String(item['id'])] ?? ''} onChange={(event) => setReplacement((value) => ({ ...value, [String(item['id'])]: event.target.value }))} placeholder="Corrected redacted fact" />
        <button disabled={!replacement[String(item['id'])]} onClick={() => void correct(item)}>Correct</button>
      </div>}
    </article>)}
    <strong>Retrieval history</strong>
    {initialRunsState === 'failed' && runs === undefined ? <p role="alert">Run History is unavailable.</p> : runs === undefined ? <p>Loading retrieval receipts.</p> : retrievals.length === 0 ? <p>No memory retrieval receipts for this definition.</p> : retrievals.map((item) => <p key={String(item['id'])}>Run {String(item.runId)} · Memory node {String(item['nodeId'])} · {String(item['status'])} · items {Array.isArray(item['itemIds']) && item['itemIds'].length ? item['itemIds'].map(String).join(', ') : 'none'} · imports {Array.isArray(item['importIds']) && item['importIds'].length ? item['importIds'].map(String).join(', ') : 'none'}{item['failure'] ? ` · failure ${String(item['failure'])}` : ''}</p>)}
    {message && <span role="status">{message}</span>}
  </section>;
}

import { useEffect, useState } from 'react';
import { failureNotice } from './error-view.js';
import { ModelPicker, parseCatalogModels, type CatalogModel } from './model-picker.js';
import type { PlatformApi, Projection } from './platform-api.js';
import { Field, Notice } from './ui.js';

type ChatProvider = 'azure-openai' | 'openrouter';
type EmbeddingProvider = 'upstash' | ChatProvider;
type Summary = { provider: ChatProvider; model: string; fallback?: string | undefined };
type Embedding = { provider: EmbeddingProvider; model?: string };
type Settings = { summary?: Summary; embedding: Embedding };

const labels: Record<EmbeddingProvider, string> = { upstash: 'Built-in (Upstash Vector)', 'azure-openai': 'Azure OpenAI', openrouter: 'OpenRouter' };
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function readSettings(record: Record<string, unknown> | undefined): Settings {
  const summary = record?.['summary']; const embedding = record?.['embedding'];
  return {
    ...(isRecord(summary) && typeof summary['model'] === 'string' && (summary['provider'] === 'openrouter' || summary['provider'] === 'azure-openai') ? { summary: { provider: summary['provider'], model: summary['model'], ...(typeof summary['fallback'] === 'string' ? { fallback: summary['fallback'] } : {}) } } : {}),
    embedding: isRecord(embedding) && (embedding['provider'] === 'openrouter' || embedding['provider'] === 'azure-openai') && typeof embedding['model'] === 'string' ? { provider: embedding['provider'], model: embedding['model'] } : { provider: 'upstash' },
  };
}

function clean(settings: Settings): Settings {
  const summary = settings.summary && settings.summary.model ? { provider: settings.summary.provider, model: settings.summary.model, ...(settings.summary.fallback ? { fallback: settings.summary.fallback } : {}) } : undefined;
  return { ...(summary ? { summary } : {}), embedding: settings.embedding.provider === 'upstash' ? { provider: 'upstash' } : { provider: settings.embedding.provider, model: settings.embedding.model ?? '' } };
}

export function ModelSettingsPanel({ api, tenantId, admin }: { api: PlatformApi; tenantId: string; admin: boolean }) {
  const [projection, setProjection] = useState<Projection>();
  const [catalog, setCatalog] = useState<Projection>();
  const [draft, setDraft] = useState<Settings>();
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const load = async (active: () => boolean = () => true) => {
    const [settings, models] = await Promise.all([api.projection(tenantId, 'workflow-model-settings'), api.projection(tenantId, 'openrouter-models').catch(() => undefined)]);
    if (!active()) return;
    setProjection(settings); setCatalog(models); setDraft(readSettings(settings.records[0])); setState('ready');
  };
  useEffect(() => {
    let active = true; setState('loading'); setMessage(undefined); setDraft(undefined);
    void load(() => active).catch(() => { if (active) setState('failed'); });
    return () => { active = false; };
  }, [api, tenantId]);

  if (state === 'loading') return <section className="connector-panel" aria-label="Model settings"><p>Loading model settings.</p></section>;
  if (state === 'failed' || !projection || !draft) return <section className="connector-panel" aria-label="Model settings"><p role="alert">Model settings could not be loaded.</p><button onClick={() => { setState('loading'); void load().catch(() => setState('failed')); }}>Retry</button></section>;

  const record = projection.records[0]; const version = Number(record?.['version'] ?? 0);
  const providers = Array.isArray(record?.['providers']) ? record['providers'].filter((item): item is ChatProvider => item === 'azure-openai' || item === 'openrouter') : [];
  const chat: CatalogModel[] = parseCatalogModels(catalog?.records[0]?.['models']); const embedding: CatalogModel[] = parseCatalogModels(catalog?.records[0]?.['embeddingModels']);
  const saved = readSettings(record); const catalogReady = catalog?.records[0]?.['catalog'] === 'ready';
  const summary = draft.summary; const changedEmbedding = JSON.stringify(clean(draft).embedding) !== JSON.stringify(saved.embedding);
  const dirty = JSON.stringify(clean(draft)) !== JSON.stringify(saved);
  const complete = (draft.embedding.provider === 'upstash' || Boolean(draft.embedding.model)) && (!summary || Boolean(summary.model)) && (summary?.fallback === undefined || summary.fallback !== summary.model);
  const setSummary = (patch: Partial<Summary> | undefined) => setDraft({ ...draft, ...(patch ? { summary: { provider: 'openrouter', model: '', ...summary, ...patch } } : { summary: undefined }) } as Settings);
  const save = async () => {
    setSaving(true); setMessage(undefined);
    try {
      await api.command({ tenantId, owner: 'workflow', name: 'configure-model-settings', expectedVersion: version, arguments: { id: String(record?.['id']), settings: clean(draft) } });
      setMessage('Model settings saved.'); await load();
    } catch (error) { setMessage(failureNotice(error, 'Model settings were not saved.', { write: true }) + ' Check that each model exists, OpenRouter is connected and verified, and embeddings match the index dimension.'); }
    finally { setSaving(false); }
  };
  const summaryProviders = providers;
  const embeddingProviders: EmbeddingProvider[] = ['upstash', ...providers];
  const models = (provider: ChatProvider | undefined, list: CatalogModel[]) => provider === 'openrouter' ? list : [];
  return <section className="connector-panel" id="model-settings-panel" aria-label="Model settings">
    <div className="pane-heading"><div><p>Workspace models</p><h2>Summary and embeddings</h2><span>{admin ? 'Explicit choices for this workspace' : 'Read only'}</span></div></div>
    {message && <p role="status">{message}</p>}
    {providers.includes('openrouter') && !catalogReady && <Notice tone="warning">The OpenRouter catalog is unavailable right now. Saving OpenRouter selections needs it; try again shortly.</Notice>}
    <fieldset disabled={!admin || saving}>
      <legend>Summary model</legend>
      <p className="field-help">Writes each Run Summary that later runs can recall. With no summary model, Run Summaries are not created.</p>
      <Field label="Provider"><select value={summary?.provider ?? ''} onChange={(event) => event.target.value ? setSummary({ provider: event.target.value as ChatProvider, model: '', fallback: undefined }) : setSummary(undefined)}><option value="">Not set</option>{summaryProviders.map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select></Field>
      {summary && (summary.provider === 'openrouter'
        ? <><ModelPicker label="Summary model" value={summary.model} models={models(summary.provider, chat)} requireStructured onChange={(model) => setSummary({ model, ...(summary.fallback === model ? { fallback: undefined } : {}) })} /><ModelPicker label="Summary fallback model" value={summary.fallback ?? ''} models={models(summary.provider, chat)} requireStructured help="Optional. Used only if the summary model fails." error={summary.fallback !== undefined && summary.fallback === summary.model ? 'Must differ from the summary model.' : undefined} onChange={(fallback) => setSummary({ fallback: fallback || undefined })} /></>
        : <><Field label="Summary deployment" help="Azure OpenAI deployment name."><input value={summary.model} onChange={(event) => setSummary({ model: event.target.value.trim() })} /></Field><Field label="Summary fallback deployment" help="Optional. Must differ from the summary deployment."><input value={summary.fallback ?? ''} onChange={(event) => setSummary({ fallback: event.target.value.trim() || undefined })} /></Field></>)}
    </fieldset>
    <fieldset disabled={!admin || saving}>
      <legend>Embedding model</legend>
      <p className="field-help">Turns memory text into vectors for retrieval. One provider is used for the whole workspace; there is no automatic cross-provider fallback because vectors from different models are not comparable.</p>
      <Field label="Provider"><select value={draft.embedding.provider} onChange={(event) => setDraft({ ...draft, embedding: event.target.value === 'upstash' ? { provider: 'upstash' } : { provider: event.target.value as ChatProvider, model: '' } })}>{embeddingProviders.map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select></Field>
      {draft.embedding.provider === 'openrouter' && <ModelPicker label="Embedding model" value={draft.embedding.model ?? ''} models={embedding} help="Must return vectors that match the index dimension; checked with a test call on save." onChange={(model) => setDraft({ ...draft, embedding: { provider: 'openrouter', model } })} />}
      {draft.embedding.provider === 'azure-openai' && <Field label="Embedding deployment" help="Azure OpenAI embedding deployment name; checked with a test call on save."><input value={draft.embedding.model ?? ''} onChange={(event) => setDraft({ ...draft, embedding: { provider: 'azure-openai', model: event.target.value.trim() } })} /></Field>}
      {changedEmbedding && <Notice tone="warning">Items already embedded with the current model stay stored but are not retrieved by the new one. Corrections and new runs create items in the new model's space.</Notice>}
    </fieldset>
    {admin && <button disabled={!dirty || !complete || saving} onClick={() => void save()}>{saving ? 'Saving' : 'Save model settings'}</button>}
  </section>;
}

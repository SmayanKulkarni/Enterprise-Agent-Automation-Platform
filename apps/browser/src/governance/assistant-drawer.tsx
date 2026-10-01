import { useEffect, useRef, useState } from 'react';
import { azureModels } from '../azure-models.js';
import { ModelPicker, type CatalogModel, type CatalogStatus } from '../model-picker.js';
import { PlatformApiError, withRef } from '../platform-api.js';
import { Dialog, Notice } from '../ui.js';
import type { InboxNotice } from './approvals-inbox.js';
import type { AssistantAnswer, AssistantRequest, ChatMessage, RangeKey } from './decoders.js';
import { messagesToSend } from './governance-model.js';

type Provider = AssistantRequest['provider'];
export interface Workspace { id: string; name: string }
export interface PanelProps {
  messages: readonly ChatMessage[]; draft: string; busy: boolean; notice: InboxNotice | undefined;
  provider: Provider; model: string; models: readonly CatalogModel[]; modelStatus: CatalogStatus;
  billingTenantId: string; workspaces: readonly Workspace[]; scopeName: string; range: RangeKey;
  onDraft: (value: string) => void; onSend: () => void; onProvider: (value: Provider) => void; onModel: (value: string) => void; onBilling: (value: string) => void; onRetryModels: () => void;
}
interface DrawerProps {
  ask: (request: AssistantRequest, signal: AbortSignal) => Promise<AssistantAnswer>;
  loadModels: (tenantId: string) => Promise<readonly CatalogModel[]>;
  workspaces: readonly Workspace[]; defaultBilling: string; scope: string | undefined; range: RangeKey;
}

const MAX_MESSAGE_CHARS = 2000;
const LABELS: Record<Provider, string> = { 'azure-openai': 'Azure OpenAI', openrouter: 'OpenRouter' };
const ROLE_LABELS: Record<ChatMessage['role'], string> = { user: 'You', assistant: 'Assistant' };

export function AssistantPanel(props: PanelProps) {
  const { messages, draft, busy, notice, provider, model, models, modelStatus, billingTenantId, workspaces, scopeName, range } = props;
  const azure = provider === 'azure-openai';
  const canSend = !busy && draft.trim() !== '' && model !== '';
  return (
    <div className="assistant">
      <div className="assistant-settings">
        <label className="gov-control">Provider<select value={provider} onChange={(event) => { props.onProvider(event.target.value as Provider); }}>{(Object.keys(LABELS) as Provider[]).map((key) => <option key={key} value={key}>{LABELS[key]}</option>)}</select></label>
        <label className="gov-control">Billing workspace<select value={billingTenantId} onChange={(event) => { props.onBilling(event.target.value); }}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
        <ModelPicker label="Model" value={model} onChange={props.onModel} models={azure ? azureModels : models} providerLabel={LABELS[provider]} allowOther={azure} requireStructured={!azure} status={azure ? 'ready' : modelStatus} onRetry={props.onRetryModels} strictCatalog={!azure} />
      </div>
      <ol className="assistant-messages" aria-live="polite">
        {messages.map((message, index) => (
          <li key={index} data-role={message.role}>
            <strong>{ROLE_LABELS[message.role]}</strong>
            <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
          </li>
        ))}
      </ol>
      {notice !== undefined && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <form className="assistant-form" onSubmit={(event) => { event.preventDefault(); if (canSend) props.onSend(); }}>
        <label htmlFor="assistant-question">Ask about the data on screen</label>
        <textarea id="assistant-question" value={draft} maxLength={MAX_MESSAGE_CHARS} rows={3} onChange={(event) => { props.onDraft(event.target.value); }} />
        <small>Answers use {scopeName} over the last {range}.</small>
        <button className="button" type="submit" disabled={!canSend}>Send</button>
      </form>
    </div>
  );
}

const refused = (status: number): string | undefined => ({
  429: 'You have asked a lot in a short time. Try again in a few minutes.',
  501: 'The assistant is not configured for this environment.',
  403: "The billing workspace's OpenRouter connection is not available.",
} as Record<number, string>)[status];

export const failureText = (error: unknown): string =>
  (error instanceof PlatformApiError ? refused(error.status) : undefined) ?? withRef('The assistant could not answer. Try again.', error);

export function AssistantDrawer({ ask, loadModels, workspaces, defaultBilling, scope, range }: DrawerProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<InboxNotice>();
  const [provider, setProvider] = useState<Provider>('azure-openai');
  const [model, setModel] = useState('');
  const [billing, setBilling] = useState(defaultBilling);
  const [models, setModels] = useState<readonly CatalogModel[]>([]);
  const [modelStatus, setModelStatus] = useState<CatalogStatus>('loading');
  const [modelsReload, setModelsReload] = useState(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const billingId = workspaces.some((workspace) => workspace.id === billing) ? billing : defaultBilling;

  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    if (!open || provider !== 'openrouter') return;
    let active = true;
    setModelStatus('loading');
    loadModels(billingId).then((list) => { if (active) { setModels(list); setModelStatus('ready'); } }).catch(() => { if (active) setModelStatus('failed'); });
    return () => { active = false; };
  }, [open, provider, billingId, modelsReload, loadModels]);

  const send = (): void => {
    const next: readonly ChatMessage[] = [...messages, { role: 'user', content: draft.trim() }];
    const abort = new AbortController();
    controller.current = abort;
    setMessages(next); setDraft(''); setNotice(undefined); setBusy(true);
    ask({ messages: messagesToSend(next), scope: { tenantId: scope ?? null }, range, provider, model, billingTenantId: billingId }, abort.signal)
      .then((result) => { setMessages([...next, { role: 'assistant', content: result.answer }]); })
      .catch((error: unknown) => { if (!abort.signal.aborted) setNotice({ tone: 'danger', text: failureText(error) }); })
      .finally(() => { setBusy(false); });
  };
  const scopeName = workspaces.find((workspace) => workspace.id === scope)?.name ?? 'all workspaces';

  return (
    <>
      <button className="button-secondary" onClick={() => { setOpen(true); }}>Ask</button>
      {open && (
        <Dialog labelledBy="assistant-title" onClose={() => { setOpen(false); }} className="assistant-dialog">
          <header><h2 id="assistant-title">Ask about this data</h2><button className="button-secondary button-small" onClick={() => { setOpen(false); }}>Close</button></header>
          <AssistantPanel messages={messages} draft={draft} busy={busy} notice={notice} provider={provider} model={model} models={models} modelStatus={modelStatus} billingTenantId={billingId} workspaces={workspaces} scopeName={scopeName} range={range}
            onDraft={setDraft} onSend={send} onProvider={(value) => { setProvider(value); setModel(''); }} onModel={setModel} onBilling={(value) => { setBilling(value); setModel(''); }} onRetryModels={() => { setModelsReload((value) => value + 1); }} />
        </Dialog>
      )}
    </>
  );
}

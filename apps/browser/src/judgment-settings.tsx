import { useState } from 'react';
import { BandInputs } from './band-inputs.js';
import { addQuestion, memoryLimitWarning, pinnedModels, questionReferences, QUESTION_LIMIT, removeQuestion, renameQuestion, setQuestion, type QuestionConfig } from './judgment-model.js';
import { QuestionCard } from './judgment-question.js';
import { ModelPicker, type CatalogModel, type CatalogStatus } from './model-picker.js';
import { PolicySettings } from './policy-settings.js';
import { Field, Notice } from './ui.js';
import { stateOptions, type OutputSchemas, type WorkflowEdge, type WorkflowNode } from './workflow-model.js';

const STATE_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u;
const MAX_STATE = 16;
const LITERAL = '__literal__';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

interface Props { node: WorkflowNode; nodes: readonly WorkflowNode[]; edges: readonly WorkflowEdge[]; updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'config'>>) => void; decisionModels: readonly CatalogModel[]; openRouterConnectionState: string; modelsStatus: CatalogStatus; onRetryModels?: (() => void) | undefined; outputSchemas?: OutputSchemas | undefined; }

function StateRow({ name, value, keys, options, onKey, onValue, onRemove }: { name: string; value: string; keys: readonly string[]; options: readonly (readonly [string, string])[]; onKey: (key: string) => void; onValue: (value: string) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState(name);
  const error = draft !== name && keys.includes(draft) ? `${draft} already exists.` : !STATE_KEY.test(draft) ? 'Use letters, numbers and underscores; start with a letter.' : undefined;
  const mapped = value.startsWith('$'); const known = options.some(([option]) => option === value);
  return <div className="trigger-field">
    <Field label="State key" error={error}><input value={draft} maxLength={64} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (error === undefined) onKey(draft); else setDraft(name); }} /></Field>
    <Field label="Source"><select value={mapped ? value : LITERAL} onChange={(event) => onValue(event.target.value === LITERAL ? '' : event.target.value)}>
      {mapped && !known && <option value={value}>{value} (not available here)</option>}
      {options.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
      <option value={LITERAL}>Literal text</option>
    </select></Field>
    {!mapped && <Field label="Literal text"><input value={value} maxLength={4000} onChange={(event) => onValue(event.target.value.startsWith('$') ? event.target.value.slice(1) : event.target.value)} /></Field>}
    <button type="button" onClick={onRemove}>Remove entry</button>
  </div>;
}

export function JudgmentSettings({ node, nodes, edges, updateNode, decisionModels, openRouterConnectionState, modelsStatus, onRetryModels, outputSchemas }: Props) {
  const config = node.config ?? {};
  const questions = (record(config['questions']) ? config['questions'] : {}) as Record<string, QuestionConfig>;
  const ids = Object.keys(questions);
  const state = (record(config['state']) ? config['state'] : {}) as Record<string, string>;
  const thresholds = (record(config['thresholds']) ? config['thresholds'] : { act: 0.85, review: 0.6 }) as { act: number; review: number };
  const [notice, setNotice] = useState<string>();
  const update = (next: Record<string, unknown>): void => updateNode(node.id, { config: next });
  const options = stateOptions(nodes, edges, node.id, outputSchemas);
  const warn = memoryLimitWarning(state, nodes);
  const stateKeys = Object.keys(state);
  const setState = (next: Record<string, string>): void => update({ ...config, state: next });
  const referenced = (id: string, action: string): void => { const titles = questionReferences(nodes, node.id, id); setNotice(titles.length === 0 ? undefined : `${id} was ${action}. These steps still read its fields and will fail check until you update them: ${titles.join(', ')}.`); };
  return <>
    <ModelPicker label="Decision model" value={String(config['model'] ?? '')} models={pinnedModels(decisionModels)} status={modelsStatus} onRetry={onRetryModels} help="Pin an exact version. Thresholds tuned for one model do not carry over to another. Some open models (for example Tev1) only answer choice questions." onChange={(model) => update({ ...config, model })} />
    {openRouterConnectionState !== 'ready' && <Notice tone="warning">OpenRouter isn't ready in this workspace ({openRouterConnectionState}). An admin can connect it in the <a href="#provider-panel">provider panel</a>.</Notice>}
    <fieldset><legend>State</legend>
      <p className="field-help">All questions read the same state. Send only what they need; extra detail lowers accuracy.</p>
      {stateKeys.length === 0 && <p className="field-error" role="alert">Add at least one state entry.</p>}
      {stateKeys.map((key) => <StateRow key={key} name={key} value={String(state[key] ?? '')} keys={stateKeys} options={options}
        onKey={(next) => setState(Object.fromEntries(Object.entries(state).map(([name, value]) => [name === key ? next : name, value])))}
        onValue={(value) => setState({ ...state, [key]: value })} onRemove={() => setState(Object.fromEntries(Object.entries(state).filter(([name]) => name !== key)))} />)}
      <button type="button" className="dashed-button" disabled={stateKeys.length >= MAX_STATE} onClick={() => { let index = stateKeys.length + 1; while (`field${String(index)}` in state) index += 1; setState({ ...state, [`field${String(index)}`]: '' }); }}>Add state entry</button>
      {warn && <Notice tone="warning">{warn}</Notice>}
    </fieldset>
    <fieldset><legend>Default confidence bands</legend>
      <p className="field-help">act: the answer is confident enough to continue automatically. review: a person should look. escalate: below review, so treat the answer as unreliable.</p>
      <BandInputs value={thresholds} onChange={(next) => update({ ...config, thresholds: next })} />
    </fieldset>
    <fieldset><legend>Questions ({ids.length} of {QUESTION_LIMIT})</legend>
      <p className="field-help">Ask several narrow questions instead of one compound question. They run together in one call, so extra questions cost little and add no latency.</p>
      {notice && <Notice tone="warning">{notice}</Notice>}
      {ids.map((id) => <QuestionCard key={id} id={id} question={questions[id]!} ids={ids} defaults={thresholds} removable={ids.length > 1}
        onChange={(question) => update(setQuestion(config, id, question))}
        onRename={(next) => { if (next === id) return; update(renameQuestion(config, id, next)); referenced(id, 'renamed'); }}
        onRemove={() => { update(removeQuestion(config, id)); referenced(id, 'removed'); }} />)}
      <button type="button" className="dashed-button" disabled={ids.length >= QUESTION_LIMIT} onClick={() => update(addQuestion(config))}>Add question</button>
    </fieldset>
    <PolicySettings config={config} locked={['toolRounds', 'effects']} update={(policy) => update({ ...config, policy })} />
  </>;
}

import { useState } from 'react';
import { BandInputs, type Bands } from './band-inputs.js';
import { changeQuestionType, questionIdError, setCriteriaKey, type QuestionConfig, type QuestionType } from './judgment-model.js';
import { Field } from './ui.js';

const CHOICE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const MAX_CHOICES = 255; const MAX_LEVELS = 10; const MIN_CRITERIA = 2;
const typeLabels: Record<QuestionType, string> = { choice: 'Choice', score: 'Score', noul: 'Yes / no' };

interface CardProps { id: string; question: QuestionConfig; ids: readonly string[]; defaults: Bands; removable: boolean; onChange: (question: QuestionConfig) => void; onRename: (id: string) => void; onRemove: () => void; }

function ChoiceRow({ name, text, keys, canRemove, onKey, onText, onRemove }: { name: string; text: string; keys: readonly string[]; canRemove: boolean; onKey: (key: string) => void; onText: (text: string) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState(name);
  const error = draft !== name && keys.includes(draft) ? `${draft} already exists.` : !CHOICE_KEY.test(draft) ? 'Use lowercase letters, numbers, - and _.' : undefined;
  return <div className="trigger-field">
    <Field label="Option key" error={error}><input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (error === undefined) onKey(draft); else setDraft(name); }} /></Field>
    <Field label="Description"><input value={text} maxLength={2000} onChange={(event) => onText(event.target.value)} /></Field>
    <button type="button" disabled={!canRemove} onClick={onRemove}>Remove option</button>
  </div>;
}

function ChoiceCriteria({ criteria, onChange }: { criteria: Record<string, string>; onChange: (criteria: Record<string, string>) => void }) {
  const keys = Object.keys(criteria);
  const add = () => { let index = keys.length + 1; while (`option_${String(index)}` in criteria) index += 1; onChange({ ...criteria, [`option_${String(index)}`]: 'Describe this option' }); };
  return <>
    {keys.map((key) => <ChoiceRow key={key} name={key} text={criteria[key] ?? ''} keys={keys} canRemove={keys.length > MIN_CRITERIA} onKey={(next) => onChange(setCriteriaKey(criteria, key, next))} onText={(text) => onChange({ ...criteria, [key]: text })} onRemove={() => onChange(Object.fromEntries(Object.entries(criteria).filter(([name]) => name !== key)))} />)}
    <button type="button" className="dashed-button" disabled={keys.length >= MAX_CHOICES} onClick={add}>Add option</button>
    <small className="field-help">Add a none option. The model leans slightly toward the first option, so put the riskiest action last.</small>
  </>;
}

function ScoreCriteria({ levels, onChange }: { levels: readonly string[]; onChange: (levels: string[]) => void }) {
  return <>
    {levels.map((text, index) => <div className="trigger-field" key={index}>
      <Field label={`Level ${String(index)}`}><input value={text} maxLength={2000} onChange={(event) => onChange(levels.map((level, at) => at === index ? event.target.value : level))} /></Field>
      <button type="button" disabled={levels.length <= MIN_CRITERIA} onClick={() => onChange(levels.filter((_, at) => at !== index))}>Remove level</button>
    </div>)}
    <button type="button" className="dashed-button" disabled={levels.length >= MAX_LEVELS} onClick={() => onChange([...levels, 'Describe this level'])}>Add level</button>
    <small className="field-help">Levels run from lowest to highest, 2 to 10.</small>
  </>;
}

function YesNoCriteria({ criteria, onChange }: { criteria: { true: string; false: string } | undefined; onChange: (criteria: { true: string; false: string } | undefined) => void }) {
  const [text, setText] = useState({ yes: criteria?.true ?? '', no: criteria?.false ?? '' });
  const change = (key: 'yes' | 'no', value: string) => {
    const draft = { ...text, [key]: value }; setText(draft);
    if (draft.yes !== '' && draft.no !== '') onChange({ true: draft.yes, false: draft.no });
    else if (draft.yes === '' && draft.no === '') onChange(undefined);
  };
  const partial = (text.yes === '') !== (text.no === '');
  return <>
    <Field label="Yes means (optional)" error={partial ? 'Describe both yes and no, or neither.' : undefined}><input value={text.yes} maxLength={2000} onChange={(event) => change('yes', event.target.value)} /></Field>
    <Field label="No means (optional)"><input value={text.no} maxLength={2000} onChange={(event) => change('no', event.target.value)} /></Field>
  </>;
}

export function QuestionCard({ id, question, ids, defaults, removable, onChange, onRename, onRemove }: CardProps) {
  const [draft, setDraft] = useState(id);
  const idError = questionIdError(draft, ids, id);
  const update = (patch: Partial<QuestionConfig>): void => onChange({ ...question, ...patch } as QuestionConfig);
  const withoutCriteria = (): QuestionConfig => { const { criteria: _criteria, ...rest } = question; return rest as QuestionConfig; };
  return <fieldset className="question-card" aria-label={`Question ${id}`}>
    <legend>{id}</legend>
    <Field label="Id" help={`Output fields start with ${draft || 'id'}_ (for example ${draft || 'id'}_answer).`} error={idError}><input value={draft} maxLength={40} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (idError === undefined) onRename(draft); else setDraft(id); }} /></Field>
    <Field label="Type"><select value={question.type} onChange={(event) => onChange(changeQuestionType(question, event.target.value as QuestionType))}>{(Object.keys(typeLabels) as QuestionType[]).map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></Field>
    <Field label="Instructions" help="Ask about facts in the state, not about the text itself. Do maths and date comparisons before this step."><textarea rows={3} maxLength={4000} value={question.instructions} onChange={(event) => update({ instructions: event.target.value })} /></Field>
    {question.type === 'choice' && <ChoiceCriteria criteria={question.criteria} onChange={(criteria) => update({ criteria })} />}
    {question.type === 'score' && <ScoreCriteria levels={question.criteria} onChange={(criteria) => update({ criteria })} />}
    {question.type === 'noul' && <YesNoCriteria criteria={question.criteria} onChange={(criteria) => onChange(criteria === undefined ? withoutCriteria() : { ...question, criteria })} />}
    <label className="switch-row"><span><strong>Gates the step</strong><small>Turn off for speculative questions; their answers are recorded but a low-confidence answer won't send the step to review.</small></span><input type="checkbox" checked={question.gate !== false} onChange={(event) => { const { gate: _gate, ...rest } = question; onChange(event.target.checked ? rest as QuestionConfig : { ...rest, gate: false } as QuestionConfig); }} /></label>
    <details><summary>{question.thresholds ? 'Own confidence bands' : 'Own confidence bands (using the default)'}</summary>
      <BandInputs key={question.thresholds ? 'own' : `default-${String(defaults.act)}-${String(defaults.review)}`} value={question.thresholds ?? defaults} onChange={(thresholds) => update({ thresholds })} />
      {question.thresholds && <button type="button" onClick={() => { const { thresholds: _thresholds, ...rest } = question; onChange(rest as QuestionConfig); }}>Use the default bands</button>}
    </details>
    <button type="button" disabled={!removable} onClick={onRemove}>Remove question</button>
  </fieldset>;
}

import { useState } from 'react';
import { Field } from './ui.js';

export function PolicySettings({ config, update, locked = [] }: { config: Record<string, unknown>; update: (policy: Record<string, number>) => void; locked?: readonly string[] }) {
  const policy = config['policy'] as Record<string, number> ?? { milliseconds: 30000, attempts: 1, tokens: 0, cost: 0, toolRounds: 0, effects: 0 };
  const fields: readonly [keyof typeof policy, string, number, number][] = [['milliseconds', 'Deadline (ms)', 1, 86400000], ['attempts', 'Attempts', 1, 5], ['tokens', 'Token limit', 0, 100000], ['cost', 'Cost limit', 0, 1000], ['toolRounds', 'Tool rounds', 0, 20], ['effects', 'External effects', 0, 20]];
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(([key]) => [key, String(policy[key])])));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const change = (key: keyof typeof policy, label: string, min: number, max: number, value: string) => {
    setText((current) => ({ ...current, [key]: value }));
    const parsed = Number(value);
    const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max && (key === 'cost' || Number.isSafeInteger(parsed));
    setErrors((current) => ({ ...current, [key]: valid ? undefined : `Enter a value from ${min} to ${max}.` }));
    if (valid) update({ ...policy, ...Object.fromEntries(locked.map((name) => [name, 0])), [key]: parsed });
  };
  return <fieldset><legend>Node policy</legend><p className="field-help">Hard limits the server enforces for this step.</p>{fields.map(([key, label, min, max]) => locked.includes(key) ? <Field key={key} label={label} help="Fixed at 0: a Judgment makes no tool calls and takes no action."><input type="number" value={policy[key] ?? 0} disabled readOnly /></Field> : <Field key={key} label={label} error={errors[key]}><input type="number" min={min} max={max} step={key === 'cost' ? 'any' : '1'} value={text[key] ?? String(policy[key])} onChange={(event) => change(key, label, min, max, event.target.value)} /></Field>)}</fieldset>;
}

import { useState } from 'react';
import { Field } from './ui.js';

export interface Bands { act: number; review: number; }

export function bandsError(act: string, review: string): string | undefined {
  const high = Number(act); const low = Number(review);
  if (act.trim() === '' || review.trim() === '' || !Number.isFinite(high) || !Number.isFinite(low)) return 'Enter both values as numbers.';
  if (high < 0 || high > 1 || low < 0 || low > 1) return 'Use values from 0 to 1.';
  return low > high ? 'Review must not be higher than act.' : undefined;
}

export function BandInputs({ value, onChange }: { value: Bands; onChange: (bands: Bands) => void }) {
  const [text, setText] = useState({ act: String(value.act), review: String(value.review) });
  const error = bandsError(text.act, text.review);
  const change = (key: keyof Bands, next: string) => {
    const draft = { ...text, [key]: next };
    setText(draft);
    if (bandsError(draft.act, draft.review) === undefined) onChange({ act: Number(draft.act), review: Number(draft.review) });
  };
  return <div className="trigger-field">
    <Field label="Act at or above"><input type="number" min="0" max="1" step="0.01" value={text.act} onChange={(event) => change('act', event.target.value)} /></Field>
    <Field label="Review at or above" error={error}><input type="number" min="0" max="1" step="0.01" value={text.review} onChange={(event) => change('review', event.target.value)} /></Field>
  </div>;
}

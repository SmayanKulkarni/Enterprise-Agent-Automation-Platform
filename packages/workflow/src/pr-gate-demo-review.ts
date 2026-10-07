import { DEMO_MODEL_DIFF_CHARS, DEMO_MODEL_MAX_TOKENS, DEMO_MODEL_TIMEOUT_MS, DEMO_TENANT_ID, REVIEW_INSTRUCTIONS, REVIEW_SCHEMA } from './pr-gate-demo.js';
import { PR_GATE_DEFAULT_MODEL } from './pr-gate-template.js';
import { observeModelCall } from './call-telemetry.js';
import type { ModelRequest, ModelResult } from './runtime.js';

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PROMPT_VERSION = 'pr-gate-demo-review-v1';
const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

type Send = (url: string, init?: RequestInit) => Promise<Response>;

export function demoReviewer(environment: Readonly<Record<string, string | undefined>>, send: Send): ((diff: string) => Promise<unknown>) | undefined {
  const key = environment['DEMO_OPENROUTER_API_KEY']?.trim();
  if (!key) return undefined;
  return (diff) => {
    const request: ModelRequest = { tenantId: DEMO_TENANT_ID, provider: 'openrouter', model: PR_GATE_DEFAULT_MODEL, promptVersion: PROMPT_VERSION, instructions: REVIEW_INSTRUCTIONS, input: { diff: diff.slice(0, DEMO_MODEL_DIFF_CHARS) }, context: {}, responseSchema: REVIEW_SCHEMA, policy: { milliseconds: DEMO_MODEL_TIMEOUT_MS, attempts: 1, tokens: DEMO_MODEL_MAX_TOKENS, cost: 1, toolRounds: 0, effects: 0 }, telemetry: { feature: 'demo' } };
    const call = async (): Promise<ModelResult> => {
      const body = { model: request.model, messages: [{ role: 'system', content: `${request.instructions}\nPrompt version: ${request.promptVersion}` }, { role: 'user', content: JSON.stringify(request.input) }], response_format: { type: 'json_schema', json_schema: { name: 'demo_review', strict: true, schema: request.responseSchema } }, max_completion_tokens: request.policy.tokens, usage: { include: true } };
      const response = await send(CHAT_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(request.policy.milliseconds), redirect: 'error' });
      if (!response.ok) throw new Error('PROVIDER_FAILED');
      const parsed = await response.json() as { choices?: { message?: { content?: unknown } }[]; usage?: Record<string, unknown> };
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('INVALID_PROVIDER_RESPONSE');
      let output: unknown;
      try { output = JSON.parse(content); } catch { throw new Error('INVALID_MODEL_OUTPUT'); }
      if (output === null || typeof output !== 'object' || Array.isArray(output)) throw new Error('INVALID_MODEL_OUTPUT');
      const promptTokens = finite(parsed.usage?.['prompt_tokens']); const completionTokens = finite(parsed.usage?.['completion_tokens']);
      return { output: output as Record<string, unknown>, model: request.model, tokens: finite(parsed.usage?.['total_tokens']) ?? DEMO_MODEL_MAX_TOKENS, cost: finite(parsed.usage?.['cost']) ?? 0, ...(promptTokens === undefined ? {} : { promptTokens }), ...(completionTokens === undefined ? {} : { completionTokens }) };
    };
    return observeModelCall(request, call).then((result) => result.output);
  };
}

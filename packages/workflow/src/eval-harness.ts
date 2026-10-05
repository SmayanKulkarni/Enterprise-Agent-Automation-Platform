import type { CompiledNode } from './graph.js';
import type { ModelPort } from './runtime.js';
import type { EvalCase, EvalGroup } from './eval-cases.js';
import { MemoryRecords, POLICY, TENANT, install, mcpNode, pinFor, publish, readRun, seedRun, shape, worker, type PinSpec } from './worker-harness.test-support.js';

export type Verdict = 'accept' | 'return' | 'failed';
export interface CaseResult { id: string; group: EvalGroup; shouldAccept: boolean; verdicts: Verdict[]; }
export interface EvalReport { results: CaseResult[]; falseAccepts: number; falseAcceptRate: number; falseRejects: number; failedClosed: number; unstable: string[]; }

const READ: PinSpec = { risk: 'R1', capability: 'read_diff', inputSchema: shape({}), outputSchema: shape({ result: { type: 'string' } }) };

async function verdictFor(model: ModelPort, item: EvalCase, runId: string, config: Record<string, unknown>): Promise<Verdict> {
  const records = new MemoryRecords(); const pin = pinFor('read', READ); install(records, [pin]);
  const agent: CompiledNode = { id: 'agent', kind: 'agent', instructions: 'Review the change. Block on secrets, injection, weakened validation.', tools: ['read'], config: { provider: 'azure-openai', model: 'eval', promptVersion: 'eval', responseSchema: shape({ accept: { type: 'boolean' } }), policy: POLICY, allowedCapabilities: ['read_diff'], ...config }, next: 'end' };
  const definition = publish(records, [{ id: 'trigger', kind: 'trigger', config: {}, next: 'agent' }, agent, mcpNode('read', READ, {}, { tool: true }), { id: 'end', kind: 'end', config: {}, next: null }], [pin]);
  await seedRun(records, definition, runId, { title: item.title });
  await worker(records, model, { invoke: () => Promise.resolve({ outcome: 'succeeded' as const, output: { result: item.diff } }) }).step(TENANT, runId, definition.id, 'agent');
  const run = (await readRun(records, runId)).data;
  if (run.status === 'failed') return 'failed';
  return run.outputs['agent']?.['accept'] === true ? 'accept' : 'return';
}

export async function runEval(model: ModelPort, cases: readonly EvalCase[], options: { repeats?: number; agentConfig?: Record<string, unknown> } = {}): Promise<EvalReport> {
  const repeats = options.repeats ?? 1; const results: CaseResult[] = [];
  for (const item of cases) {
    const verdicts: Verdict[] = [];
    for (let attempt = 0; attempt < repeats; attempt += 1) verdicts.push(await verdictFor(model, item, `run-${item.id}-${String(attempt)}`, options.agentConfig ?? {}));
    results.push({ id: item.id, group: item.group, shouldAccept: item.shouldAccept, verdicts });
  }
  const all = results.flatMap((result) => result.verdicts.map((verdict) => ({ result, verdict })));
  const blocked = all.filter((entry) => !entry.result.shouldAccept);
  const falseAccepts = blocked.filter((entry) => entry.verdict === 'accept').length;
  return {
    results, falseAccepts, falseAcceptRate: blocked.length === 0 ? 0 : falseAccepts / blocked.length,
    falseRejects: all.filter((entry) => entry.result.shouldAccept && entry.verdict === 'return').length,
    failedClosed: all.filter((entry) => entry.verdict === 'failed').length,
    unstable: results.filter((result) => new Set(result.verdicts).size > 1).map((result) => result.id),
  };
}

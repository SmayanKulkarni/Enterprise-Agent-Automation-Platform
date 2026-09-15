import type { ContractDescriptor, EvidenceClassification } from './index.js';

type Definition = readonly [name: string, classification: EvidenceClassification];
const definitions: readonly Definition[] = [
  ['identity.identity', 'restricted-operational'], ['identity.tenant', 'immutable-audit'], ['identity.user', 'restricted-operational'], ['identity.membership', 'immutable-audit'], ['identity.authenticated-execution-context', 'secret'], ['identity.risk', 'restricted-operational'], ['identity.approval-evidence', 'immutable-audit'], ['identity.effective-authority-evidence', 'immutable-audit'],
  ['lifecycle.solution-package', 'restricted-operational'], ['lifecycle.dependency-manifest', 'immutable-audit'], ['lifecycle.tenant-installation', 'restricted-operational'], ['lifecycle.activation', 'immutable-audit'], ['case.package-pin', 'immutable-audit'],
  ['case.case', 'restricted-operational'], ['case.stage', 'restricted-operational'], ['case.assignment', 'restricted-operational'], ['case.command', 'immutable-audit'], ['case.effect-intent', 'immutable-audit'], ['case.effect-attempt', 'immutable-audit'], ['case.effect-receipt', 'immutable-audit'], ['case.intervention', 'immutable-audit'], ['case.outcome', 'immutable-audit'],
  ['capability.registration', 'restricted-operational'], ['capability.availability', 'restricted-operational'], ['capability.invocation', 'secret'], ['capability.normalized-error', 'restricted-operational'], ['capability.throttle-state', 'restricted-operational'], ['capability.reconciliation-checkpoint', 'immutable-audit'], ['capability.credential-reference', 'secret'],
  ['memory.query', 'restricted-operational'], ['memory.result-provenance', 'restricted-operational'], ['evaluation.ledger-record', 'immutable-audit'], ['memory.validated-experience', 'restricted-operational'], ['improvement.orchestrator-candidate', 'immutable-audit'],
  ['operations.event', 'restricted-operational'], ['operations.audit-evidence', 'immutable-audit'], ['operations.trace-context', 'restricted-operational'], ['deployment.deployment', 'restricted-operational'], ['deployment.environment-manifest', 'immutable-audit'], ['operations.cost-attribution', 'restricted-operational'], ['operations.correlation', 'restricted-operational'], ['operations.causation', 'restricted-operational'],
  ['browser.v1', 'restricted-operational'],
];

export const CONTRACT_DESCRIPTORS: Readonly<Record<string, ContractDescriptor>> = Object.freeze(Object.fromEntries(
  definitions.map(([name, classification]) => [name, { classification, name, tenantScoped: true, version: '1.0.0' }]),
));

export function descriptorFor(name: string): ContractDescriptor {
  const descriptor = CONTRACT_DESCRIPTORS[name];
  if (descriptor === undefined) throw new Error(`Unknown contract descriptor: ${name}`);
  return descriptor;
}

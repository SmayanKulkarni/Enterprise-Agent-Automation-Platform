# Cross-subsystem contract registry

Status: proposed for platform ratification
Owner: [Platform Integration & Delivery](../../.scratch/platform-integration-delivery/map.md)
Contract line: v1

This is the only canonical registry for data that crosses subsystem-map
boundaries. A producing map proposes a semantic change, but this map owns the
contract name, identifier, envelope, version line, compatibility declaration,
and ratification record. Consumers may depend on entries here and their stated
invariants; they must not depend on another map's persistence layout or private
workflow.

## Common rules

### Identifiers and envelope

All IDs are opaque UUIDs. A Tenant-owned record carries `tenantId`; a
caller-supplied Tenant ID chooses candidate scope and never proves membership
or authority. `messageId`, `correlationId`, and `causationId` identify a
message, its end-to-end work, and its immediate cause. The v1 outer envelope is
defined in [cross-subsystem-envelope.schema.json](v1/schemas/cross-subsystem-envelope.schema.json).
It contains the contract name/version, time, sender, payload, classification,
and integrity proof where required. Sensitive contracts reject an unknown or
missing field, version, Tenant scope, authority proof, or signature.

### Versions and compatibility

Every contract uses semantic versioning and records the consumer range it
supports. Patch versions correct compatible defects; minor versions may add
optional ordinary-contract fields; major versions are breaking. Before a major
change, the owner publishes the new version, declares backward/forward/mixed
compatibility, migration, replay, rollback or forward-recovery behavior, and a
retirement date. Old and new versions operate concurrently until consumer
evidence permits retirement. Security-sensitive contracts are never permissive
about unknown data merely to preserve compatibility.

### Errors, security, and fixtures

The normalized errors are `denied`, `invalid`, `conflict`, `retryable`,
`timeout`, `unknown-outcome`, and `terminal`; each has a stable uppercase code
and a safe message. Their schema is [normalized-error.schema.json](v1/schemas/normalized-error.schema.json).
Classifications are `ordinary`, `restricted-operational`, `secret`, and
`immutable-audit`; classification controls visibility, fixture redaction, and
retention handling. Every contract must exercise the portable fixtures below,
without importing a producing map implementation:

| Required outcome | Fixture |
| --- | --- |
| Success | [success.json](v1/fixtures/success.json) |
| Denial | [denial.json](v1/fixtures/denial.json) |
| Retryable failure | [retryable-failure.json](v1/fixtures/retryable-failure.json) |
| Terminal failure | [terminal-failure.json](v1/fixtures/terminal-failure.json) |
| Conflict | [conflict.json](v1/fixtures/conflict.json) |
| Timeout | [timeout.json](v1/fixtures/timeout.json) |
| Unknown outcome | [unknown-outcome.json](v1/fixtures/unknown-outcome.json) |
| Redaction | [redaction.json](v1/fixtures/redaction.json) |
| Version mismatch | [version-mismatch.json](v1/fixtures/version-mismatch.json) |

### Change evidence

All shared changes need an owner-approved registry update, linked ADR, version
and compatibility declaration, updated fixtures/schema, and consumer-test
evidence. Breaking or security-sensitive changes additionally need explicit
migration, replay, rollback/forward-recovery, and mixed-version evidence.
No change is ratified until its named consumers have either supplied evidence
or recorded why they are unaffected.

## Contract entries

All entries below have stability **stable**, current version **1.0.0**, and
compatibility **producer `^1.0.0`; consumer accepts `>=1.0.0 <2.0.0`** unless a
later row-level change record narrows that range. Each uses the common error
model, fixtures, and change evidence above. `P` means producer/proposer; `C`
means consumer. Platform is the single named owner of every canonical entry.

### Identity, Tenancy, and Policy

| Contract | P / C | Classification | Core invariant |
| --- | --- | --- | --- |
| `identity.identity` | P Identity; C Lifecycle, Operations | restricted-operational | Identity is opaque; authentication mapping is not authority. |
| `identity.tenant` | P Identity; C Runtime, Gateway, Memory, Lifecycle, Operations, Azure | immutable-audit | Logical Tenant is application-owned and boundaries are default-deny. |
| `identity.user` | P Identity; C Runtime, Lifecycle, Operations | restricted-operational | A User is scoped to memberships, never an implicit Tenant administrator. |
| `identity.membership` | P Identity; C Runtime, Gateway, Lifecycle, Operations | immutable-audit | Membership is explicit, Tenant-scoped, revocable, and does not establish every authority. |
| `identity.authenticated-execution-context` | P Identity; C Runtime, Gateway, Memory, Lifecycle, Operations | secret | Authenticated subject, selected Tenant, authentication proof, and expiry are inseparable. |
| `identity.risk` | P Identity; C Runtime, Gateway, Lifecycle, Memory | restricted-operational | Risk is evaluated at the protected action and cannot be weakened by a consumer. |
| `identity.approval-evidence` | P Identity; C Runtime, Gateway, Lifecycle, Operations | immutable-audit | Approval records subject, scope, expiry, decision, and authority provenance. |
| `identity.effective-authority-evidence` | P Identity; C Runtime, Gateway, Memory, Lifecycle, Operations | immutable-audit | Grant equals the intersection of policy, package, agent, initiator, Case risk, and valid approvals. |

### Solution lifecycle

| Contract | P / C | Classification | Core invariant |
| --- | --- | --- | --- |
| `lifecycle.solution-package` | P Lifecycle; C Runtime, Gateway, Memory, Identity, Operations | restricted-operational | Artifact has stable logical identity plus immutable version, digest, provenance, and signature. |
| `lifecycle.dependency-manifest` | P Lifecycle; C Runtime, Gateway, Memory, Azure | immutable-audit | All dependency ranges resolve deterministically; secret values and Tenant data are excluded. |
| `lifecycle.tenant-installation` | P Lifecycle; C Identity, Gateway, Memory, Operations | restricted-operational | Installation is Tenant-scoped and proves compatible policy, credentials, and readiness. |
| `lifecycle.activation` | P Lifecycle; C Runtime, Gateway, Memory, Operations | immutable-audit | Authorized idempotent activation creates an immutable revision for new Cases. |
| `case.package-pin` | P Runtime; C Lifecycle, Operations, Memory | immutable-audit | Every Case retains one immutable activation/package revision unless an explicit governed transition records otherwise. |

### Case runtime

| Contract | P / C | Classification | Core invariant |
| --- | --- | --- | --- |
| `case.case` | P Runtime; C Identity, Gateway, Memory, Lifecycle, Operations | restricted-operational | Case timeline is durable source of truth for work and evidence. |
| `case.stage` | P Runtime; C Gateway, Memory, Operations | restricted-operational | A stage has allowed transitions, budget, exit criteria, and serialized durable ownership. |
| `case.assignment` | P Runtime; C Identity, Memory, Operations | restricted-operational | Assignment is bounded to a declared Agent Team role and permitted stage. |
| `case.command` | P Runtime or Operations; C Runtime | immutable-audit | Automated and operator changes use the same authorized durable command path. |
| `case.effect-intent` | P Runtime; C Gateway, Operations | immutable-audit | Intent is durable, authorized, Tenant-scoped, and idempotency/fencing identified before a provider call. |
| `case.effect-attempt` | P Gateway; C Runtime, Operations | immutable-audit | At-least-once-safe attempt never claims exactly-once provider delivery. |
| `case.effect-receipt` | P Gateway; C Runtime, Operations, Memory | immutable-audit | Receipt is durable evidence or explicitly reports unknown outcome and required reconciliation. |
| `case.intervention` | P Runtime or Operations; C Identity, Operations, Runtime | immutable-audit | Human intervention records authority, requested action, decision, scope, and expiry. |
| `case.outcome` | P Runtime; C Memory, Lifecycle, Operations | immutable-audit | Outcome identifies Case, package pin, evidence, and completion or governed terminal state. |

### Capability gateway

| Contract | P / C | Classification | Core invariant |
| --- | --- | --- | --- |
| `capability.registration` | P Gateway; C Lifecycle, Operations, Azure | restricted-operational | Registered capability declares schema, adapter, Tenant availability, and policy seam. |
| `capability.availability` | P Gateway; C Runtime, Lifecycle, Operations | restricted-operational | Availability is Tenant-scoped and cannot imply authority to invoke. |
| `capability.invocation` | P Runtime; C Gateway | secret | Invocation carries execution context, authority evidence, effect identity, budget, and idempotency key. |
| `capability.normalized-error` | P Gateway; C Runtime, Operations, Lifecycle | restricted-operational | Uses only the common error model and never leaks provider secrets. |
| `capability.throttle-state` | P Gateway; C Runtime, Operations | restricted-operational | Flow-control state identifies scope, limit, observed state, expiry, and retry guidance. |
| `capability.reconciliation-checkpoint` | P Gateway; C Runtime, Operations | immutable-audit | Reconciliation links intent/attempt to a provider-safe lookup or explicit unresolved outcome. |
| `capability.credential-reference` | P Gateway; C Lifecycle, Azure, Operations | secret | Reference identifies secret location/version and scope; it never carries a secret value. |

### Memory, evaluation, and improvement

| Contract | P / C | Classification | Core invariant |
| --- | --- | --- | --- |
| `memory.query` | P Runtime; C Memory | restricted-operational | Query carries explicit authorized purpose, Tenant scope, and allowed knowledge scope. |
| `memory.result-provenance` | P Memory; C Runtime, Operations, Evaluation | restricted-operational | Every result explains source, scope, authorization, version, and applicable redaction. |
| `evaluation.ledger-record` | P Memory; C Lifecycle, Operations, Runtime | immutable-audit | Ledger preserves evaluation provenance and is not raw trusted knowledge. |
| `memory.validated-experience` | P Memory; C Runtime, Lifecycle, Operations | restricted-operational | Experience is reviewed, versioned, scope-authorized, and distinct from raw Case history. |
| `improvement.orchestrator-candidate` | P Memory; C Runtime, Lifecycle, Operations | immutable-audit | Candidate is immutable and cannot expand authority or weaken guardrails. |

### Operations, deployment, and traceability

| Contract | P / C | Classification | Core invariant |
| --- | --- | --- | --- |
| `operations.event` | P Runtime, Gateway, Lifecycle, Memory, Identity; C Operations | restricted-operational | Event is Tenant-scoped where applicable and links canonical correlation/causation. |
| `operations.audit-evidence` | P all producing maps; C Operations | immutable-audit | Security, authority, approval, and effect evidence is durable and unsampled. |
| `operations.trace-context` | P all maps; C Operations, Azure | restricted-operational | Trace context propagates correlation/causation without granting access or exposing secrets. |
| `deployment.deployment` | P Azure; C Operations, Lifecycle, Runtime | restricted-operational | Deployment identifies immutable artifact, environment, owner, region, and verifier result. |
| `deployment.environment-manifest` | P Azure; C Operations, Lifecycle, Gateway | immutable-audit | Manifest records scoped configuration/digests/references, never secret values. |
| `operations.cost-attribution` | P Azure, Operations; C Operations, Lifecycle | restricted-operational | Cost links deployment, environment, Tenant scope where lawful, and owner without inventing authority. |
| `operations.correlation` | P Platform envelope; C all maps | restricted-operational | Correlation ID identifies one end-to-end work chain. |
| `operations.causation` | P Platform envelope; C all maps | restricted-operational | Causation ID identifies the direct prior message/action; it is not a persistence reference. |
| `browser.v1` | P Browser transport; C Browser clients, Identity, Runtime, Gateway, Operations | restricted-operational | Browser DTOs are versioned, Tenant-selected, redacted, and never carry bearer proof or raw provider/domain errors. |

## Cross-map dependency index

| Consumer map | Registry entries it consumes |
| --- | --- |
| Identity, Tenancy & Policy | `case.intervention`, `operations.event`, `operations.audit-evidence` |
| Case Runtime & Multi-Agent Orchestration | all `identity.*`, `lifecycle.activation`, `case.package-pin`, `memory.query`, `memory.result-provenance`, `capability.*`, `deployment.*` |
| Capability Gateway & Integrations | `identity.authenticated-execution-context`, `identity.effective-authority-evidence`, `case.effect-*`, `lifecycle.*`, `deployment.*` |
| Memory, Evaluation & Improvement | `identity.effective-authority-evidence`, `case.case`, `case.outcome`, `lifecycle.*`, `operations.*` |
| Solution Lifecycle | `identity.*`, `capability.registration`, `capability.credential-reference`, `evaluation.ledger-record`, `memory.validated-experience`, `case.package-pin`, `deployment.*` |
| Operations & Observability | all published entries as Tenant-authorized projections/evidence; no direct persistence dependency |
| Azure Platform Engineering | `identity.tenant`, `lifecycle.*`, `capability.credential-reference`, `operations.*`, `deployment.*` |
| Reference Solutions & Portfolio | public fixture-only consumer; no implementation or persistence dependency |

## Duplicate ADR ratification

The number alone is never a citation. The canonical decisions are the following
full filenames; the similarly numbered files remain historical and are not
deleted.

| Number | Canonical decision | Historical duplicate |
| --- | --- | --- |
| 0002 | [0002-three-layer-product-model.md](../adr/0002-three-layer-product-model.md) | [0002-risk-tiered-agent-authority.md](../adr/0002-risk-tiered-agent-authority.md) |
| 0003 | [0003-case-is-the-durable-unit-of-work.md](../adr/0003-case-is-the-durable-unit-of-work.md) | [0003-multi-tenant-platform-with-two-reference-deployments.md](../adr/0003-multi-tenant-platform-with-two-reference-deployments.md) |
| 0006 | [0006-place-agentic-stages-inside-durable-workflows.md](../adr/0006-place-agentic-stages-inside-durable-workflows.md) | [0006-contain-agency-in-durable-workflow-stages.md](../adr/0006-contain-agency-in-durable-workflow-stages.md) |
| 0007 | [0007-calculate-effective-agent-authority-by-intersection.md](../adr/0007-calculate-effective-agent-authority-by-intersection.md) | [0007-compute-effective-authority-by-intersection.md](../adr/0007-compute-effective-authority-by-intersection.md) |

The canonical selection follows the full filenames already linked in subsystem
maps. A future ADR cleanup may assign unique numbers, but no map may cite a
number without its full linked filename until then.

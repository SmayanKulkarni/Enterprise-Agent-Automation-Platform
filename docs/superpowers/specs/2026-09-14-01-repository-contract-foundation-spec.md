# Repository and executable contract foundation specification

Status: implementation-ready
Sequence: 1 of 14; produces M1
Owner: Platform Integration & Delivery

This specification imports the [universal interface, lifecycle and acceptance rules](2026-09-14-platform-specification-index.md#universal-interface-and-data-rules), including Tenant isolation, authority, idempotency/concurrency,
unknown outcomes, replay, retention/redaction/audit, observability/cost,
version/migration compatibility and destructive teardown. This foundation owns
their shared vocabulary and validation shape, not their domain behavior.

## Goal, scope and non-goals

Create the pnpm/TypeScript monorepo and the one executable contract module all
later modules import. Scope is workspace configuration, branded identifiers,
v1 envelope/error types, strict JSON Schema validation, portable fixtures,
semantic compatibility, contract-owner/link checks and root verification
commands. Identity is a named consumer only. No database, authentication,
workflow, UI, Azure resource or provider behavior is implemented here.

Relevant personas are platform maintainer, module implementer and CI verifier. Terms
`Module`, `Interface`, `Seam` and `Adapter` follow [codebase design](../plans/2026-09-14-platform-implementation-sequence.md)'s architecture; domain terms follow [`CONTEXT.md`](../../../CONTEXT.md).

## Authority and dependencies

Implements the [registry](../../contracts/cross-subsystem-contract-registry.md),
[gate ladder](../../contracts/integration-gate-ladder.md), [stack ADR](../../adr/0016-use-typescript-azure-native-portfolio-stack.md),
[platform contract governance](../../../.scratch/platform-integration-delivery/issues/01-cross-subsystem-contract-governance.md),
[integration gates](../../../.scratch/platform-integration-delivery/issues/02-integration-gate-ladder.md)
and foundation plan Task 1. It consumes only ratified documentation and existing
v1 schemas/fixtures; it unblocks every later specification.

## Module interface and ownership

`@platform/contracts` owns `ContractEnvelope<T>`, all branded UUID types,
`EvidenceClassification`, `NormalizedError`, `ContractDescriptor`,
`CompatibilityDecision`, `validateEnvelope(descriptor, unknown)`,
`assertCompatible(producer, consumer)` and canonical JSON/digest helpers. IDs
remain opaque; conversion validates UUID syntax and never changes Tenant scope.
The registry generator owns contract-name/version metadata. Domain modules own
payload semantics and import—not duplicate—the envelope and identifiers.

The envelope exactly carries contract name/version, message/correlation/
causation IDs, occurred time, producer, classification, Tenant scope when
applicable, payload, and required integrity proof. Sensitive contracts and all
schemas use closed objects and reject unknown/missing fields, unknown versions,
missing Tenant scope and invalid integrity. Normalized outcomes are the seven
registry classes; domain-specific status may be nested but cannot replace them.

## Lifecycle, compatibility and failures

Schema sources are canonical; generated TypeScript and bundled schemas are
derived artifacts checked for drift. Patch is compatible correction, minor may
add optional fields only to ordinary contracts, and major is breaking. A
compatibility manifest declares producer/consumer ranges, sensitivity,
migration, mixed-version, replay, rollback/forward recovery and retirement.
Unknown contracts/versions or malformed compatibility metadata fail closed.

Fixtures are immutable input evidence. Tests load the nine repository fixtures,
clone them before mutation tests, and prove success, denial, retryable, terminal,
conflict, timeout, unknown outcome, redaction and version mismatch. Errors expose
safe code/message/detail references only. Contract validation emits no payload,
secret or foreign-object existence into diagnostics.

## Ordered implementation slices

1. **1.1 workspace:** root `package.json`, `pnpm-workspace.yaml`, strict base
   TypeScript/config/lint/test conventions and empty package graph.
2. **1.2 executable types:** branded IDs, envelope/error/descriptor types,
   canonicalization and schema compilation. Gate: type tests reject mixing IDs.
3. **1.3 conformance:** portable fixtures, strict/tenant/version/redaction tests
   and compatibility matrix. Gate: M1 fixture suite passes from packed package.
4. **1.4 governance:** owner/consumer registry parser, generated-artifact drift,
   Markdown link/schema JSON checks and root `lint`, `typecheck`, `test`,
   `contracts`, `verify`. `verify` runs all prior commands from a clean install.

## Acceptance and evidence

Acceptance includes exact fixture success; unknown field/version/contract;
wrong/missing Tenant; branded-ID substitution; duplicate message; conflicting
payload digest; compatible minor and incompatible major; corrupt schema;
redacted secret; broken link/unknown owner; and deterministic clean rebuild.
Concurrency tests compile schemas once without accepting partially initialized
validators. A crash during generation leaves prior outputs or fails verification,
never mixed files. No destructive operation exists beyond disposable build
output, whose path is repository-bounded.

Completion evidence is root command output, package tarball inventory/digest,
schema/type drift report, contract/owner matrix, link report and recursive secret
scan. Azure/live evidence is not applicable. M1 passes only when a fresh consumer
can install the packed module and run fixtures without importing source paths.

## Dependency result

Consumes no earlier specification. Unblocks specs 2–14. Any later change to this
interface follows the registry change-evidence process and reruns every named
consumer's contract suite before the old line can retire.

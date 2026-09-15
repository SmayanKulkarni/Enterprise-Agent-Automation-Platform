# Platform specification index and implementation order

Status: implementation-ready specification set
Authority: [ratified platform design](../../architecture/platform-design-ratification.md)
Owner: Platform Integration & Delivery

## Purpose

This index is the integration contract for the part-by-part specifications. It
turns the ratified architecture into one acyclic implementation order while
keeping each specification reviewable at a contract-owned seam. The numbered
items below are implementation slices, not tickets; a later planning session may
decompose a slice only after its specification is accepted.

All specifications import the vocabulary in [`CONTEXT.md`](../../../CONTEXT.md),
the canonical names and envelopes in the [contract registry](../../contracts/cross-subsystem-contract-registry.md),
the ownership decisions in [subsystem reconciliation](../../architecture/subsystem-reconciliation.md),
and the evidence progression in the [integration gate ladder](../../contracts/integration-gate-ladder.md).
No specification may redefine those artifacts or consume another module's
persistence/workflow implementation.

## Global topological order

| Order | Specification | Internal slices, in required order | Gate produced |
| --- | --- | --- | --- |
| 1 | [Repository and contract foundation](2026-09-14-01-repository-contract-foundation-spec.md) | 1.1 workspace -> 1.2 types/schemas -> 1.3 fixtures/compatibility -> 1.4 ownership/link/root verification | M1 |
| 2 | [Identity, Tenant, authentication and authority](2026-09-14-02-identity-tenant-authority-spec.md) | 2.1 Tenant/User -> 2.2 memberships -> 2.3 auth contexts -> 2.4 authority -> 2.5 ingress/lifecycle | M2 |
| 3 | [Case runtime and Agent Team](2026-09-14-03-case-runtime-agent-team-spec.md) | 3.1 Case reducer -> 3.2 durable adapter -> 3.3 intervention -> 3.4 Agent Team -> 3.5 recovery | M3 |
| 4 | [Effects and Capability Gateway core](2026-09-14-04-effects-gateway-core-spec.md) | 4.1 intent -> 4.2 invocation -> 4.3 receipt/reconcile -> 4.4 flow control | M4 |
| 5 | [Provider lifecycle and Extension isolation](2026-09-14-05-provider-extension-lifecycle-spec.md) | 5.1 definitions/adapters -> 5.2 installations -> 5.3 credentials -> 5.4 isolation -> 5.5 readiness/removal | M4 extension |
| 6 | [Memory and Validated Experience](2026-09-14-06-memory-validated-experience-spec.md) | 6.1 provenance -> 6.2 scoped stores -> 6.3 retrieval -> 6.4 lifecycle -> 6.5 experience | M5a |
| 7 | [Evaluation and governed improvement](2026-09-14-07-evaluation-improvement-spec.md) | 7.1 ledger -> 7.2 gates -> 7.3 candidates -> 7.4 shadow/canary -> 7.5 Strategy Selector | M5b |
| 8 | [Solution Package lifecycle](2026-09-14-08-solution-package-lifecycle-spec.md) | 8.1 authoring -> 8.2 manifest/resolve -> 8.3 validate -> 8.4 sign/catalog -> 8.5 install/activate -> 8.6 upgrade/retire | M6 |
| 9 | [Operations and observability](2026-09-14-09-operations-observability-spec.md) | 9.1 event intake -> 9.2 projections -> 9.3 signals/cost -> 9.4 commands -> 9.5 UI/alerts/runbooks | M7 |
| 10 | [Local Technical Implementation slice](2026-09-14-10-local-technical-implementation-spec.md) | 10.1 package fixture -> 10.2 bootstrap/seed -> 10.3 success -> 10.4 denial/failure/recovery -> 10.5 reset/evidence | M8 |
| 11 | [Azure delivery and recovery](2026-09-14-11-azure-delivery-recovery-spec.md) | 11.1 policy/IaC -> 11.2 identity/data -> 11.3 compute/telemetry -> 11.4 delivery/readiness -> 11.5 failure/restore -> 11.6 teardown | M9 |
| 12 | [Live provider adapters](2026-09-14-12-live-provider-adapters-spec.md) | 12.1 shared certification -> 12.2 Graph -> 12.3 SQL -> 12.4 Blob -> 12.5 Boards -> 12.6 Jira -> 12.7 combined readiness/reset | M10 |
| 13 | [Vendor Risk and Access](2026-09-14-13-vendor-risk-access-spec.md) | 13.1 package -> 13.2 assessment -> 13.3 linked grant -> 13.4 provision/revoke -> 13.5 failure/reset | M11 |
| 14 | [Portfolio hardening and repeatability](2026-09-14-14-portfolio-hardening-evidence-spec.md) | 14.1 drill harness -> 14.2 upgrade/quarantine -> 14.3 improvement rollout -> 14.4 restore/teardown -> 14.5 second operator/rubric | M12 |

An implementation slice may start only when every earlier row and every earlier
slice in its row has passed its named exit gate. A later slice may add adapters
behind an earlier seam; it may not change the seam without registry versioning,
compatibility evidence, and rerunning all affected consumer gates.

## Cross-spec integration matrix

| Producing specification | Owned cross-spec output | Direct consumers | Consumer gate |
| --- | --- | --- | --- |
| 1 Contracts | Envelope, IDs, errors, descriptors, compatibility and fixtures | 2–14 | Every consumer runs the packed contract suite |
| 2 Identity | `identity.*` context, Tenant, membership, risk, approval and authority evidence | 3–14 | Protected-seam allow/deny and revocation freshness |
| 3 Runtime | `case.case`, stage, assignment, command, intervention, outcome and effect intent | 4, 6–10, 13–14 | Deterministic Case crash/replay timeline |
| 4–5 Gateway | registration/availability/invocation, attempts, receipts, checkpoints, credential references and Extension outcomes | 6, 8–14 | Intent-to-receipt/unknown reconciliation and readiness |
| 6–7 Memory/Evaluation | memory query/provenance/experience, ledger and candidate/gate evidence | 8–10, 13–14 | Scoped retrieval plus immutable comparable gate evidence |
| 8 Lifecycle | signed package, lock, installation, activation/readiness and Case pin inputs | 9–14 | Tamper/readiness/activation/upgrade/quarantine suite |
| 9 Operations | authorized projections, audit/trace views, cost, alerts and owner-command transport | 10–14 | Deterministic rebuild, redaction and command receipt |
| 10 Local solution | Signed Technical Implementation package, deterministic tools and local evidence manifest | 11–12, 14 | Repeatable fixture journey and clean reset |
| 11 Azure | deployment/environment manifests and Azure adapters | 12–14 | Same slice live with restore, lease and teardown evidence |
| 12 Providers | Certified Graph/SQL/Blob/Boards/Jira adapters and installation readiness | 13–14 | Labeled live contract/reconcile/reset records |
| 13 Second solution | Signed Vendor Risk and Access package and linked-Case evidence | 14 | Same platform digests and fixture/live repeat |
| 14 Portfolio | Demo run/evidence/rubric manifests | Completion decision | Second-operator run and M1–M12 evidence closure |

Each row names an owned output rather than a shared database. Consumers import
the registry contract, validate its version and preserve correlation/causation;
they do not call producing-module internals. Cycles at runtime are broken by
commands/events: for example Operations submits a Runtime-owned command and
later consumes the resulting event, while owning neither mutation nor fact.

## Universal interface and data rules

- Every public module interface accepts canonical branded IDs and returns a
  typed result or normalized error; transport/provider errors never escape.
- Every Tenant-owned route, repository key/index/FK, queue/session/dedupe key,
  cache/index, object path, checkpoint, signal, backup and cost record begins
  with authenticated `tenantId`. Candidate Tenant selectors do not authorize.
- Only a fresh `allow` from `identity.effective-authority-evidence` crosses a
  protected seam. Availability/readiness and authentication are not authority.
- Commands use expected generation/version and stable idempotency key/digest.
  Effects persist intent before send; possible-send timeout is
  `unknown-outcome` until reconciled. Replay reuses recorded nondeterminism.
- Immutable audit facts are unsampled. Classified content remains in its owning
  store; messages and projections carry safe references, digests and explicit
  redaction/partiality.
- Local fakes, Azure adapters and live provider adapters run the same public
  contract fixtures. Fixture/simulated/live evidence labels are immutable.
- Major or security-sensitive contract changes require parallel version
  operation, migration/replay/rollback or forward-recovery, and named consumer
  evidence before retirement. Running Cases keep immutable activation pins.

## Universal acceptance and completion evidence

Every specification must exercise applicable success, denial, stale,
duplicate/conflicting, concurrent, timeout-before-send, partial/possible effect,
crash/replay, recovery and destructive-boundary scenarios. Cross-Tenant
substitution and secret scans are mandatory at every new seam. Destructive
commands require exact manifest/scope, fresh authority and approval, dry-run or
preflight, durable receipts, legal-hold handling, and a residual scan.

Each slice publishes machine-readable test results, artifact/config/schema
digests, fixture versions, and correlation IDs. Azure/live evidence additionally
records environment/deployment/provider-installation versions, time, cost and
teardown status. Fixture evidence never satisfies an explicitly live gate.

## Change and review rule

The implementation order itself is versioned. Moving a slice earlier requires
proof that it consumes no later interface. Splitting work follows an owning
contract seam, never frontend/backend/database layers that must evolve together.
Before accepting a specification, verify local links, canonical contract names,
single ownership, all negative paths, no placeholders, and consistency with this
table. A later ticket plan must preserve these numeric prefixes and prerequisites.

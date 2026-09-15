# 056: Certification harness

**Source spec:** [Live Graph, SQL, Blob, Boards and Jira adapter specification, source slice 12.1](../../../docs/superpowers/specs/2026-09-14-12-live-provider-adapters-spec.md#ordered-implementation-slices)

**What to build:** Create the provider-neutral certification harness, live manifest gate, secret-safe recording/evidence schema and shared fake/live contract suite for adapters behind the accepted Gateway seam.

**Blocked by:** 055: Close

**Status:** implementation-complete (root verification blocked by pinned Node mismatch)

**Produces:** Provider-neutral adapter certification interface and live-evidence gate; foundation toward M10

- [x] The harness runs identical allow, deny, pagination, throttle, idempotency, timeout, reconciliation, credential and reset cases against a declared adapter and records immutable evidence classification.
- [x] Missing or stale provider/API/auth/schema versions, forged live labels, unsafe recording payloads and fixture evidence presented as live fail certification and readiness.
- [ ] Publish harness/schema digests, fake baseline results, label-integrity tests, recording redaction results, live-manifest validation and recursive secret scan. Blocked: manifest publication runs only after pinned root verification.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest. Blocked: this shell has Node 24.13.0; the workspace requires Node 22.14.0.

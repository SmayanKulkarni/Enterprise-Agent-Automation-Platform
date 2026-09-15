# 003: Conformance

**Source spec:** [Repository and executable contract foundation specification, source slice 1.3](../../../docs/superpowers/specs/2026-09-14-01-repository-contract-foundation-spec.md#ordered-implementation-slices)

**What to build:** Make the nine portable outcome fixtures and semantic compatibility matrix executable against the packed contract module so every later adapter can prove the same interface behavior.

**Blocked by:** 002a: Boundary codecs

**Status:** implemented; root verification pending the pinned Node 22.14.0/Vitest environment.

**Produces:** Portable packed conformance suite and compatibility evidence; foundation toward M1

**Execution (2026-09-15):** The nine v1 fixtures run through the built codecs; eight decode/encode round-trip and the version-mismatch fixture rejects before consumption. Corrected fixture metadata that contradicted the canonical registry (`case.command` and `case.effect-attempt`). Root evidence is pending the host repair noted in 001.

- [ ] Success, denial, retryable, terminal, conflict, timeout, unknown-outcome, redaction and version-mismatch fixtures pass from a fresh packed-package consumer.
- [ ] Duplicate/conflicting messages, wrong or missing Tenant scope, incompatible major versions, unsafe redaction and partially initialized concurrent validators fail deterministically.
- [ ] Use 002a's packed codecs for fixture encode/decode and byte-stable round trips; duplicate JSON members and transform/digest drift fail before adapter consumption.
- [ ] Publish fixture versions/results, compatibility matrix, concurrency results, package digest and recursive secret scan.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

# 040: Intake

**Source spec:** [Operations information, observability and control plane specification, source slice 9.1](../../../docs/superpowers/specs/2026-09-14-09-operations-observability-spec.md#ordered-implementation-slices)

**What to build:** Ingest owner-published operational events through 002a decode, contract/version/Tenant/classification validation and declared safe transformations; dedupe canonical event IDs and quarantine unsafe or incompatible records before any browser feed or Mongo projection.

**Blocked by:** 039a: Studio and Catalog views

**Status:** complete

**Produces:** Validated Operations event intake and quarantine interface

- [x] Valid at-least-once events enter the projection stream with correlation/causation, classification and owning sequence intact, while duplicate deliveries are idempotent.
- [x] Unknown sensitive versions/fields, wrong Tenant, broken redaction, conflicting duplicate digest and malformed events enter a visible quarantine path without leaking payloads.
- [x] Record source/target version and transform digest for each accepted owner event; reject event transformation that loses correlation/causation, owner sequence, required evidence or classification. SSE receives only the encoded safe projection hint after authority filtering.
- [x] Publish intake/quarantine fixtures, contract-version matrix, dedupe results, safe diagnostics, correlation samples and secret/classification scan.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

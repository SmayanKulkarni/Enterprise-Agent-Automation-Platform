# 041: Projection

**Source spec:** [Operations information, observability and control plane specification, source slice 9.2](../../../docs/superpowers/specs/2026-09-14-09-operations-observability-spec.md#ordered-implementation-slices)

**What to build:** Build deterministic Tenant-authorized projections and joins over owner events, with bounded disorder, gap handling, watermarks, completeness and rebuildable query results.

**Blocked by:** 040: Intake

**Status:** complete

**Produces:** Tenant-scoped operational projection/query interface

- [x] Ordered, delayed and replayed event sets produce byte-equivalent snapshots and authorized queries show watermark, source versions, calculated time and completeness state.
- [x] Gaps, out-of-order/clock-skewed events, incompatible schemas, cross-Tenant IDs, lag and rebuild interruption remain partial or quarantined rather than inventing facts or authority.
- [x] Publish one safe versioned query DTO schema/encoder with Tenant-bound cursor, redaction markers, watermark and completeness; both the original adapter and 041a Mongo adapter must return byte-equivalent authorized DTOs for the same event set.
- [x] Publish deterministic snapshots, rebuild equivalence, gap/reorder/replay tests, query-authorization matrix, watermark timeline and Tenant-isolation evidence.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

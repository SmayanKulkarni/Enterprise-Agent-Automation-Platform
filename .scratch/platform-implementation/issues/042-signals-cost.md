# 042: Signals/cost

**Source spec:** [Operations information, observability and control plane specification, source slice 9.3](../../../docs/superpowers/specs/2026-09-14-09-operations-observability-spec.md#ordered-implementation-slices)

**What to build:** Emit and consume unsampled audit plus bounded events, traces, logs and metrics, and attribute estimated/final cost with versioned rates and explicit unknown/shared states.

**Blocked by:** 041a: Mongo Operations read model

**Status:** complete

**Produces:** `operations.audit-evidence`, trace context and cost-attribution interfaces

- [x] Signals preserve canonical scope, producer/schema, time, classification and correlation while cost records join lawful owner/deployment/environment/Tenant context and state their basis.
- [x] Diagnostic sampling/export loss never drops business/audit facts; unsafe cardinality or small-group inference, payload leakage and missing cost data are suppressed or shown as unknown rather than zero.
- [x] Publish audit immutability/retention tests, telemetry-loss/backpressure results, cardinality controls, cost calculations/rate versions and redaction/secret scans.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

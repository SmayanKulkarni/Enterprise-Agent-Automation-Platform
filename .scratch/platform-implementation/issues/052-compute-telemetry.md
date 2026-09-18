# 052: Compute/telemetry

**Source spec:** [Azure infrastructure, delivery, readiness and recovery specification, source slice 11.3](../../../docs/superpowers/specs/2026-09-14-11-azure-delivery-recovery-spec.md#ordered-implementation-slices)

**What to build:** Deploy Functions and disposable Container Apps/Jobs with protected ingress and Azure Monitor, implementing the existing telemetry, redaction, retention, cost and Extension sandbox interfaces.

**Blocked by:** 051: Foundations/data

**Status:** fixture-verified; live Azure evidence pending

**Produces:** Azure compute, sandbox and telemetry adapters

- [x] Application workers and isolated jobs run the packed contract/escape suites, propagate correlation and emit unsampled audit plus bounded diagnostics with attributable cost.
- [x] Ambient identity, metadata or network escape, cross-Tenant residue, diagnostic export loss, unsafe cardinality/redaction and compute exhaustion cannot expose secrets or suppress durable audit.
- [ ] Publish compute/sandbox contract results, escape/resource measurements, ingress checks, Monitor retention/redaction/cost evidence, artifact digests and residue/secret scans. Live Azure evidence remains pending.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

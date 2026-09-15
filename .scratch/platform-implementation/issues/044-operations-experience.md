# 044: Experience

**Source spec:** [Operations information, observability and control plane specification, source slice 9.5](../../../docs/superpowers/specs/2026-09-14-09-operations-observability-spec.md#ordered-implementation-slices)

**What to build:** Finish the task-oriented overview and evidence timelines in the thin browser client from 043a, plus every critical alert, notification and versioned runbook drill while preserving Tenant, environment, time, freshness, sampling and cost context.

**Blocked by:** 043a: Operations browser

**Status:** complete

**Produces:** M7 Operations projection/control/alert gate and user-facing evidence interface

- [x] Authorized users can identify actionable Cases, interventions, provider/deployment risk and follow canonical evidence IDs; each critical alert fires, groups, routes, links its runbook and clears.
- [x] Foreign evidence, stale or partial projections, notification failure, alert duplication and attempted direct destructive action remain explicit and cannot bypass owner commands.
- [x] Publish M7 browser accessibility/isolation results, alert fire/group/route/clear records, runbook drill manifests, evidence timelines and cost/watermark screenshots.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

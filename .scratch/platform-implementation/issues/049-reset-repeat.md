# 049: Reset/repeat

**Source spec:** [Local Technical Implementation vertical-slice specification, source slice 10.5](../../../docs/superpowers/specs/2026-09-14-10-local-technical-implementation-spec.md#ordered-implementation-slices)

**What to build:** Run success, injected failure and exact-inventory reset twice, reconciling every managed object and preserving declared audit evidence so repeatability is measured rather than asserted.

**Blocked by:** 048: Negatives/recovery

**Status:** complete

**Produces:** M8 repeatable local vertical-slice gate and clean reset evidence

- [x] Both runs produce equal logical outcome, module, package and evidence digests, and reset removes generated data and temporary credentials with zero unexplained residue.
- [x] Partial reset, reset crash/resume, held evidence and unmanaged or foreign objects stop destructive progress, preserve prior evidence and report exact residual disposition.
- [x] Publish M8 paired run manifests, digest comparison, reset inventory/receipts, link and secret results, held/residual report and fixture/simulated labels.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

# 045: Package fixture

**Source spec:** [Local Technical Implementation vertical-slice specification, source slice 10.1](../../../docs/superpowers/specs/2026-09-14-10-local-technical-implementation-spec.md#ordered-implementation-slices)

**What to build:** Author the smallest Technical Implementation Solution Package and carry it through the shared validate, approve, sign, publish, install and activate interfaces without any solution-specific platform fork.

**Blocked by:** 044: Experience

**Status:** complete

**Produces:** Signed Technical Implementation package fixture and activation pin

- [x] The typed package declares its Case, bounded Agent Team, evidence, joins, budgets, interventions, memory/evaluation rules and exact SQL/Blob/Boards capabilities, then yields a valid activation pin.
- [x] Unsupported requirements, embedded secrets, undeclared capability or delegation, authority/budget widening and incompatible fake-provider allocation block validation or readiness.
- [x] Publish signed package/lock/activation digests, semantic diff, gate/install/readiness reports, fixture labels and shared-module inventory.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

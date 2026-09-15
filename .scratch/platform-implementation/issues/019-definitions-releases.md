# 019: Definitions/releases

**Source spec:** [Provider registration, credentials and Extension isolation specification, source slice 5.1](../../../docs/superpowers/specs/2026-09-14-05-provider-extension-lifecycle-spec.md#ordered-implementation-slices)

**What to build:** Register immutable capability definitions and signed adapter releases with closed schemas, semantic compatibility and the accepted ProviderAdapter seam, while keeping discovery separate from authority.

**Blocked by:** 018a: Case workbench

**Status:** complete (local signed-release evidence)

**Produces:** `capability.registration` interface and versioned adapter-release seam

- [x] A compatible signed release registers exact capability/input/output and adapter metadata and becomes discoverable only in its declared Tenant installation context.
- [x] Tampered signature, incompatible schema/version, duplicate conflicting definition and any adapter request to choose Tenant, capability, target or authority fail closed.
- [x] Publish registration/compatibility fixtures, definition/release digests, signature results, owner/consumer checks and safe discovery samples.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/gateway-browser.test.ts`; root manifest slice `019-definitions-releases`.

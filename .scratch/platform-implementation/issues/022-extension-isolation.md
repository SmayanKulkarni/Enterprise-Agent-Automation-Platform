# 022: Extension isolation

**Source spec:** [Provider registration, credentials and Extension isolation specification, source slice 5.4](../../../docs/superpowers/specs/2026-09-14-05-provider-extension-lifecycle-spec.md#ordered-implementation-slices)

**What to build:** Run signed Extension Package invocations in a disposable local adapter under explicit network, filesystem, identity, resource, output and deadline policy, then gate normalized output before release.

**Blocked by:** 021: Credentials

**Status:** complete

**Produces:** `ExtensionRunner` interface and disposable local isolation adapter

- [x] A permitted Extension receives only its bound Tenant/capability/input and declared resources, completes within budgets and returns schema-, malware-, classification- and DLP-validated output.
- [x] Filesystem/process/socket/metadata/identity/DNS/egress escape, privilege/fork exhaustion, cancellation, oversized or malicious output, secret leakage and cross-Tenant residue are blocked and evidenced.
- [x] Publish sandbox policy/artifact digests, escape-suite results, resource measurements, output-gate fixtures, cancellation traces, secret and residue scans.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

Evidence: `tests/platform/lifecycle-memory.test.ts`; pinned `pnpm verify` passed on 2026-09-15 and published `evidence/implementation/manifest.json`.

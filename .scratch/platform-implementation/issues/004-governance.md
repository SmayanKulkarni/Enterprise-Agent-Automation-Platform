# 004: Governance

**Source spec:** [Repository and executable contract foundation specification, source slice 1.4](../../../docs/superpowers/specs/2026-09-14-01-repository-contract-foundation-spec.md#ordered-implementation-slices)

**What to build:** Close contract foundation governance by checking registry ownership and consumers, generated-artifact drift, Markdown/schema links and a clean root verification path that composes every prior command.

**Blocked by:** 003: Conformance

**Status:** implemented; root verification pending the pinned Node 22.14.0/Vitest environment.

**Produces:** M1 contract-governance gate and versioned owner/consumer registry interface

**Execution (2026-09-15):** Added the `contracts` root command and governance report for registry ownership/consumers, schema JSON, local links, descriptor drift, artifact digest and package secret scan. Direct governance, TypeScript and lint checks pass; root evidence is pending the host repair noted in 001.

**Implemented details:**

- Added `tools/contracts/governance.mjs`, which reads the registry, requires producer and consumer declarations, verifies local Markdown links and JSON schemas, and compares packed descriptors with registry name/classification metadata.
- The governance report emits the owner/consumer matrix, compiled artifact SHA-256, schema inventory and recursive package secret-scan result.
- Contract build and governance run through the new root `contracts` command; the root verifier now includes that command before lint, typechecking and tests.
- Evidence publishing remains atomic and does not replace the existing manifest after a failed root command.

**Performed checks:** `pnpm --config.engine-strict=false contracts`, TypeScript, lint, workspace validation and governance passed. Root verification remains pending the pinned host repair noted in 001.

- [ ] Registry generation names one owner and valid consumers for every contract, all local links and schemas resolve, and clean root verify passes using only packed schemas and 002a codecs.
- [ ] Unknown owners, broken links, schema/type drift, mixed generation after a crash and incompatible contract metadata stop verification while retaining the last coherent outputs.
- [ ] Publish M1 evidence containing root command output, owner/consumer matrix, link/schema report, drift report, artifact digests and secret scan.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

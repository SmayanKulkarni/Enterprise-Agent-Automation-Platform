# 001: Workspace

**Source spec:** [Repository and executable contract foundation specification, source slice 1.1](../../../docs/superpowers/specs/2026-09-14-01-repository-contract-foundation-spec.md#ordered-implementation-slices)

**What to build:** Create the pnpm/TypeScript workspace as an installable vertical foundation whose strict configuration, linting, typechecking, testing and package graph can be exercised from the root before any domain module exists.

**Blocked by:** None (can start immediately)

**Status:** complete; root-verified with Node 22.14.0 and pnpm 10.15.1.

**Produces:** Workspace conventions and clean root verification seam; foundation toward M1

**Execution (2026-09-15):** Restored Node 22.14.0 and locked dependencies, then ran `pnpm verify` successfully. The package graph includes `@platform/contracts`; the root verifier published fresh implementation evidence.

**Implemented details:**

- Added root `contracts` verification and made it a required workspace command; root verification runs it before lint, typechecking and tests.
- Extended the strict workspace validator and evidence interface for the non-empty `@platform/contracts` package graph and its repository-bounded `dist` output.
- Repaired the verifier's Corepack invocation so it executes the Node-adjacent `corepack` binary rather than assuming an invalid internal path.
- Updated the workspace configuration fixtures for the new required command.

**Performed checks:** `pnpm verify` passed workspace validation, contracts, lint, typechecking and all 14 tests; it regenerated `evidence/implementation/manifest.json`.

- [x] A clean install discovers the intended package graph and the root lint, typecheck and test commands complete deterministically under the pinned toolchain.
- [x] Invalid workspace membership, relaxed compiler settings, dependency cycles and out-of-scope build output fail closed without leaving mixed generated state.
- [x] Publish machine-readable command results, toolchain/configuration digests, package-graph inventory and a repository-bounded output scan.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

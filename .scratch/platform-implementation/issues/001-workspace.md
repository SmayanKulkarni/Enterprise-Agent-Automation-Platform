# 001: Workspace

**Source spec:** [Repository and executable contract foundation specification, source slice 1.1](../../../docs/superpowers/specs/2026-09-14-01-repository-contract-foundation-spec.md#ordered-implementation-slices)

**What to build:** Create the pnpm/TypeScript workspace as an installable vertical foundation whose strict configuration, linting, typechecking, testing and package graph can be exercised from the root before any domain module exists.

**Blocked by:** None (can start immediately)

**Status:** implemented; root verification pending the pinned Node 22.14.0/Vitest environment.

**Produces:** Workspace conventions and clean root verification seam; foundation toward M1

**Execution (2026-09-15):** Workspace policy validation, TypeScript and lint pass locally. The package graph now includes `@platform/contracts`; the root `pnpm verify` evidence remains pending because this host has Node 24.13.0 and a broken optional Vitest binding.

- [ ] A clean install discovers the intended empty package graph and the root lint, typecheck and test commands complete deterministically under the pinned toolchain.
- [ ] Invalid workspace membership, relaxed compiler settings, dependency cycles and out-of-scope build output fail closed without leaving mixed generated state.
- [ ] Publish machine-readable command results, toolchain/configuration digests, package-graph inventory and a repository-bounded output scan.
- [ ] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

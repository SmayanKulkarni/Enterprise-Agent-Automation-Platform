# 002: Executable types

**Source spec:** [Repository and executable contract foundation specification, source slice 1.2](../../../docs/superpowers/specs/2026-09-14-01-repository-contract-foundation-spec.md#ordered-implementation-slices)

**What to build:** Deliver the executable contract module with opaque branded identifiers, the canonical envelope/error/descriptor interface, deterministic canonicalization/digests and compiled strict schemas consumable without source-path imports. Publish the schema/descriptor hooks that 002a will use for all boundary decode/encode paths.

**Blocked by:** 001: Workspace

**Status:** complete; root-verified with Node 22.14.0 and pnpm 10.15.1.

**Produces:** `@platform/contracts` executable type and validation interface; foundation toward M1

**Execution (2026-09-15):** Added the packed `@platform/contracts` module with branded UUIDs, strict envelopes/errors, canonical JSON/digests, descriptors and a compile-time non-substitutable ID check. Packed round-trip, direct typechecking and root verification pass.

**Implemented details:**

- Added `packages/contracts` with package exports, declaration output and a standalone build configuration.
- Added opaque Tenant, message, correlation and causation UUID brands; envelope, normalized-error, descriptor and compatibility types; strict UUID/date/envelope/error validation; canonical JSON and SHA-256 digest helpers.
- Added all registry contract descriptors as packed runtime metadata and a compile-time `@ts-expect-error` test proving Tenant IDs cannot be supplied as message IDs.
- Added a `contracts` command that builds the package before consuming its compiled output.

**Performed checks:** root typechecking, a compiled-package round trip and the type-level ID boundary check passed.

- [x] A packed consumer validates canonical envelopes and normalized outcomes while type tests reject substitution among branded IDs.
- [x] Unknown or missing fields, invalid identifiers, Tenant scope, versions or integrity proof and corrupt schemas are rejected without exposing sensitive payloads.
- [x] Publish packed-module inventory/digest, schema compilation results, type-test output and contract-validation fixtures with correlation IDs.
- [x] Root verification passes, and the produced interface and evidence are linked from the implementation evidence manifest.

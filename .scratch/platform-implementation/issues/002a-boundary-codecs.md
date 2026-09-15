# 002a: Boundary codecs and safe transformations

**Source:** [contract registry](../../../docs/contracts/cross-subsystem-contract-registry.md), [canonical envelope schema](../../../docs/contracts/v1/schemas/cross-subsystem-envelope.schema.json), [Wayfinder transport decision](../../frontend-mvp-integration/issues/03-browser-command-and-event-transport.md)

**What to build:** Add the smallest packed `@platform/contracts` decode/encode boundary over 002's compiled schemas and canonicalizer. It is shared by HTTP, owner events, worker messages and provider adapter evidence; it does not own business transformations.

**Blocked by:** 002: Executable types
**Status:** complete; root-verified with Node 22.14.0 and pnpm 10.15.1.
**Produces:** `decodeContract`, `encodeContract` and safe projection DTO codecs consumed by 003/004a and later adapters

**Execution (2026-09-15):** Added bounded strict UTF-8 decoding, duplicate-key rejection, Tenant/version/classification validation, allowlisted payload projections, canonical byte encoding and transform provenance. Direct packed checks and root verification pass.

**Implemented details:**

- `decodeContract` limits input to 1 MB, decodes fatal UTF-8, parses JSON without duplicate keys, rejects non-finite numbers, and validates the descriptor before returning an envelope.
- `encodeContract` projects payloads through an explicit allowlist, validates the result, then emits canonical bytes and a SHA-256 digest.
- `transformContract` validates source and target envelopes, records source/target versions and a transform digest, and rejects classification changes.
- Wire validation rejects unknown envelope/error fields, non-UUID identifiers, invalid UTC timestamps, absent Tenant scope, wrong Tenant, classification or version, and non-plain JSON values.

**Performed checks:** compiled-package round trip, duplicate-key rejection and cross-Tenant rejection passed.

- [x] Decode bounded UTF-8 JSON into validated named/versioned contracts; reject duplicate object keys, non-finite/ambiguous numbers, invalid UUID/date forms, missing/unknown security-sensitive fields, wrong Tenant/classification and incompatible versions **before** any owner handler. Never silently coerce an invalid identifier or infer Tenant from payload.
- [x] Apply only declared, versioned transformations after validation and before the existing canonical digest; record source/target contract versions and transformation digest/provenance. A transform cannot weaken classification, invent authority, discard required evidence or convert a malformed payload into acceptance.
- [x] Encode safe, route-specific allowlisted DTOs/events/errors after authorization and redaction; validate output schema, deterministic canonical bytes/digest and round-trip decode. Dates use one UTC representation; wire JSON has no implicit `Date`, `BigInt`, undefined or class-instance serialization.
- [x] One packed-consumer runnable check covers valid round trip, duplicate key, cross-Tenant, version mismatch, unsafe redaction and transform/digest drift; publish codec fixture/digest results and pass root verification.

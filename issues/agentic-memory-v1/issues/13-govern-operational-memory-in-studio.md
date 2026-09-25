# 13 — Govern Operational Memory in Studio

**What to build:** A tenant administrator can shorten an Operational Memory item's expiry and use the existing Memory Import and lifecycle controls with clear versioned feedback. Operators can inspect the outcome but cannot invoke governance actions.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] An administrator sees the current expiry and a labeled native date/time control. The control rejects empty, invalid, later-than-current, and beyond-horizon values before submission and converts a valid local value to an ISO instant.
- [x] Setting expiry sends the item ID, current expected version, and ISO timestamp through the existing command. Success refreshes the item projection; stale-version, denied, and invalid responses give distinct actionable feedback without claiming the change succeeded.
- [x] Existing withdraw, hold, release, delete, invalidate-source, correction, Memory Import attachment, and revocation actions remain available with their current authorization, idempotency, and expected-version semantics. A legal hold still prevents physical deletion, and import revocation remains prospective.
- [x] Correction submits only newly entered text, clears it after success and on tenant change, and never fetches stored memory text into the browser. Non-administrators cannot see mutation controls; server-side authorization remains authoritative.
- [x] Lifecycle states explain automatic durable promotion/removal retries and terminal failure visibility. No manual retry action, provider configuration form, or browser memory-write command is introduced.
- [x] Focused browser command and lifecycle tests cover successful expiry, stale and denied outcomes, a held item, role gating, tenant switching, and continued behavior of the existing actions. Controls and feedback are keyboard and screen-reader accessible.

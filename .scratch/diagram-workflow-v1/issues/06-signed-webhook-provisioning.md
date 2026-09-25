# 06: Provision a signed webhook Trigger

**What to build:** An editor configures a webhook Trigger's event contract, and an administrator can publish it, obtain its URL and signing instructions, and provision or rotate its signing credential.

Use the same guided Trigger schema controls as the manual mode. The published connection view should explain that the tenant's database or event relay sends signed events; Studio does not subscribe to database changes. Show the URL, canonical signing message, timestamp and event-ID requirements, and credential status to an authorized administrator. Add a server-managed credential command and safe projection if absent. The existing webhook handler should resolve that credential while retaining environment-backed secrets during migration.

**Blocked by:** 02: Configure and start a manual Trigger.

**Status:** done

- [x] Webhook mode edits the Trigger's existing input schema and shows the URL only for a published Definition.
- [x] Credential creation and rotation are administrator-only and tenant-scoped; secret material is shown once and never enters graph, browser projections, or Run History.
- [x] Rotation provides bounded overlap or a documented cutover; existing environment-backed credentials continue to work during migration.
- [x] Missing or disabled credentials fail closed, and signed ingress retains signature, freshness, replay, and schema checks.
- [x] The accepted workflow decision record captures storage, rotation, and frontend migration behavior.
- [x] Creating or rotating a credential reveals the new secret only in the one-time response; subsequent views show status and rotation time only.
- [x] Disabling or leaving the credential unconfigured cannot produce an open ingress, and a cross-tenant administrator cannot see or change it.
- [x] A signed request with the new credential can start a Run; bad signature, stale timestamp, replayed event ID, invalid body, and tenant mismatch cannot.

Verified with `pnpm typecheck` and focused Vitest coverage for the browser command boundary and workflow graph controls.

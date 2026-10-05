# 02 — Create a group; add and remove workspaces

**What to build:** A workspace admin creates a tenant group from workspaces they already administer and becomes its first group admin. A group admin adds a workspace they administer, or removes one. Adding a workspace gives every group admin real admin rights in it. Removing it takes back only the rights the group created. Every write is idempotent, bumps the group epoch, and a request made with an old epoch is refused with 409.

**Blocked by:** 01 — See my tenant groups.

**Status:** implemented

**Spec:** `docs/superpowers/specs/2026-09-30-governance-observability-design.md` — Unit 1: "Authority model", the `create_group` / `add_tenant` / `remove_tenant` rows of "Procedures", the paragraph after that table (idempotency, limits, consent rule), "Contract and routes". Security summary rows "Seizing a workspace", "Over-revocation", "Stale authority".

- [x] `POST /api/v1/groups/commands/governance/create-group` creates a group when the caller holds a current `admin` profile in every listed workspace; the caller becomes its first admin. Any listed workspace the caller does not administer gives 403. A workspace already in a group gives 409.
- [x] `POST /api/v1/groups/:groupId/commands/governance/add-tenant` requires the caller to be a group admin **and** a current admin of that workspace (consent rule). Otherwise 403.
- [x] After `add-tenant`, every current group admin has a current membership with an `admin` profile in that workspace, and `identity.group_admin_grants` records which rows the group created.
- [x] `remove-tenant` deletes only group-created rows. A user who was a direct admin before keeps the profile. Every affected membership epoch is bumped. `billing_tenant_id` is cleared when it pointed at the removed workspace.
- [x] Every write bumps `identity.tenant_groups.epoch`. A command whose `If-Match` is not the current group epoch gives 409 `STALE`.
- [x] Replaying a command with the same idempotency key and body returns the original receipt. The same key with a different body gives 409 `CONFLICT`.
- [x] Limit: 50 workspaces per group.
- [x] Group POST routes enforce the same origin, bearer, idempotency-key, correlation-id and content-type rules as tenant commands.
- [x] Without `AZURE_SQL_CONNECTION_STRING` the group command routes answer 501 `FEATURE_NOT_READY`.
- [x] `database/verify/014_tenant_group_commands.sql` proves the consent rule, grant materialization, revoke-only-what-was-created, epoch bumps, idempotent replay, and the stale-epoch refusal.

## Code map (verified 2026-09-30)

| Where | What is there now |
| --- | --- |
| `packages/browser/src/index.ts:185-196` | `command()` — the tenant command path you mirror: header checks (186-188), envelope decode (189), `If-Match` and size checks (191), argument decode (193), second context read with `STALE` on an epoch change (195) |
| `packages/browser/src/index.ts:157` | `assertOrigin` already runs for every POST |
| `packages/browser/src/index.ts:174` | `context()` builds the Clerk proof inline. There is no shared bearer-to-proof helper yet |
| `packages/browser/src/browser-contracts.ts:4-17, 30-41, 56-79` | `COMMANDS`, `argumentKeys`, `decodeCommandArguments`. Every key listed for a command must be present in the request (line 61) |
| `packages/browser/src/workflow-commands.ts:17` | `receipt()` shape: `{ commandId, objectId, revision, state, digest, evidenceIds }` |
| `packages/browser/src/local-browser-host.ts:46-48` | Where command handlers are built and passed to the transport |
| `packages/workflow/src/sql.ts:35-42` | `mapError` (module-private): SQL 50001/50002/50003/50004 to `DENIED`/`INVALID`/`STALE`/`CONFLICT` |
| `database/migrations/010_model_settings.sql:63-112` | The receipt-replay pattern inside a stored procedure |
| `packages/contracts/src/codecs.ts` | `decodeContract(descriptor, bytes, expectedTenantId?)` — the third argument is optional |
| `packages/browser/src/browser-response.ts:10` | On Vercel and Azure a new transport is built per request. Do not keep state on the transport instance |

## Implementation path

### 1. Migration `014_tenant_group_commands.sql`

Ticket 05 owns number 013. The runner applies files by name and skips applied ones, so the order in which 013 and 014 land does not matter.

```sql
CREATE TABLE [governance].command_receipts (
  actor_user_id uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  idempotency_key uniqueidentifier NOT NULL,
  request_digest char(64) NOT NULL,
  receipt_json nvarchar(max) NOT NULL CHECK (ISJSON(receipt_json) = 1),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_governance_command_receipts PRIMARY KEY (actor_user_id, idempotency_key)
);
```

The spec asks for stored receipts but names no table. Receipts are keyed by actor rather than by group because `create-group` has no group yet.

Two internal helpers, granted to no role (they are called only from `EXECUTE AS OWNER` procedures):

- `governance.grant_tenant_admin(@group_id, @tenant_id, @user_id)`
  - No membership row for (tenant, user): insert one as `current`; `created_membership = 1`.
  - Membership exists but is `revoked`: set it `current`, bump its epoch; `created_membership = 1`.
  - No `admin` row in `identity.membership_profiles`: insert it; `created_profile = 1`.
  - Insert the `identity.group_admin_grants` row with those two flags if it does not exist. Never overwrite an existing grant row.
- `governance.revoke_tenant_admin(@group_id, @tenant_id, @user_id)`
  - `created_profile = 1`: delete the `admin` profile row.
  - `created_membership = 1` **and** the membership has no profile rows left: set the membership `revoked`.
  - Always bump the membership epoch, then delete the grant row.

Public procedures, all `WITH EXECUTE AS OWNER`, one transaction each, execute granted to `platform_governance_browser`:

| Procedure | Parameters after the common ones | Rules |
| --- | --- | --- |
| `governance.create_group` | `@user_id, @name nvarchar(128), @tenant_ids nvarchar(max)` (JSON array), `@billing_tenant_id` (nullable) | Name 1-128 chars after trim; 1-50 distinct valid ids; billing null or in the list (else 50002). Caller has a current `admin` profile in every listed active tenant (else 50001). No listed tenant is in `identity.tenant_group_members` (else 50004). Group id is `@idempotency_key`. Inserts the group (epoch 1), the members, the admin row (epoch 1), and a grant row per tenant for the caller with both flags 0. |
| `governance.add_tenant` | `@group_id, @user_id, @group_epoch, @admin_epoch, @tenant_id` | Caller has a current `admin` profile in `@tenant_id` (else 50001). Tenant not in any group, and group has fewer than 50 members (else 50004). Inserts the member, then calls `grant_tenant_admin` for every current group admin. |
| `governance.remove_tenant` | same | Tenant is a member (else 50002). Calls `revoke_tenant_admin` for every grant row of (group, tenant), deletes the member row, clears `billing_tenant_id` if it matched. |

Common trailing parameters on all three: `@idempotency_key uniqueidentifier, @request_digest char(64), @receipt_json nvarchar(max)`. All three return `receipt_json, replayed` like `workflow.write_record`.

Order inside `add_tenant` and `remove_tenant`:

1. Receipt lookup by `(@user_id, @idempotency_key)` with `UPDLOCK, HOLDLOCK`. Same digest: return the stored receipt with `replayed = 1`. Different digest: `THROW 50004`.
2. Read the group row with `UPDLOCK, HOLDLOCK`. If its epoch differs from `@group_epoch`: `THROW 50003, N'STALE', 1`.
3. `EXEC governance.assert_group_admin @group_id, @user_id, @group_epoch, @admin_epoch`.
4. The rule checks and the writes.
5. `UPDATE identity.tenant_groups SET epoch = epoch + 1`.
6. Insert the receipt; return it with `replayed = 0`.

The replay check comes first on purpose. The original command bumped the epoch, so a faithful retry would otherwise fail step 2.

### 2. Verify `014_tenant_group_commands.sql`

Inside `BEGIN TRANSACTION … ROLLBACK`, with synthetic tenants and users:

- `create_group` by a user who is not admin of one listed tenant throws 50001; with a tenant already grouped throws 50004.
- `add_tenant` by a group admin who is not an admin of the target tenant throws 50001.
- With a second group admin inserted directly into `identity.tenant_group_admins`: after `add_tenant` that user has a current membership and an `admin` profile in the new tenant, and the grant row has both flags 1.
- After `remove_tenant`: that membership is `revoked`, its epoch went up, the grant row is gone. The original caller, who was a direct admin, still has the `admin` profile.
- The group epoch went up by one per write. A call with the old epoch throws 50003.
- The same key and digest twice returns `replayed = 1` and changes nothing. The same key with another digest throws 50004.

### 3. Contracts

`browser-contracts.ts`:

- `COMMANDS.governance = ['create-group', 'add-tenant', 'remove-tenant', 'add-admin', 'remove-admin', 'set-billing-tenant']`. The last three are implemented in ticket 03; listing them now keeps the owner in one place.
- `argumentKeys`: `'governance.create-group': ['name', 'tenantIds', 'billingTenantId']`, `'governance.add-tenant': ['tenantId']`, `'governance.remove-tenant': ['tenantId']`.
- `decodeCommandArguments` validators: `tenantId` is a UUID; `tenantIds` is an array of 1-50 distinct UUIDs; `name` is a string of 1-128 chars; `billingTenantId` is `null` or a UUID. Clients send `billingTenantId: null` when there is none, because every listed key is required.

### 4. Store

New file `packages/governance/src/sql.ts`:

```ts
export class AzureSqlGovernanceStore {
  constructor(connectionString: string)
  createGroup(userId: string, args: { name: string; tenantIds: readonly string[]; billingTenantId: string | null }, key: string, requestDigest: string, receipt: Record<string, unknown>): Promise<{ receipt: Record<string, unknown>; replayed: boolean }>
  command(name: 'add-tenant' | 'remove-tenant', context: GroupContext, expectedEpoch: number, args: Record<string, unknown>, key: string, requestDigest: string, receipt: Record<string, unknown>): Promise<{ receipt: Record<string, unknown>; replayed: boolean }>
}
```

- Use `sqlPool` from `packages/identity/src/sql-pool.ts`, and export `mapError` from `packages/workflow/src/sql.ts` to reuse it. Do not copy it.
- `command` passes `expectedEpoch` as `@group_epoch` and `context.adminEpoch` as `@admin_epoch`.
- The procedure name comes from a fixed map keyed by command name. Never build it from request text.

### 5. Handlers and transport

`packages/browser/src/governance-commands.ts`: `governanceCommandHandlers(store)` returns one handler per command name. Each builds the receipt `{ commandId: key, objectId, revision: expectedVersion + 1, state, digest, evidenceIds: [] }` and calls the store. `objectId` is the group id.

`packages/browser/src/index.ts`:

```ts
export interface GroupCommand { userId: string; group?: GroupContext; name: string; idempotencyKey: string; correlationId: CorrelationId; expectedVersion: number; digest: string; arguments: Record<string, unknown>; }
export type GroupCommandHandler = (command: GroupCommand) => Promise<Record<string, unknown>>;
```

- `BrowserTransportOptions.groupCommands?: Readonly<Record<string, GroupCommandHandler>>`.
- Routes, matched after the `GET /api/v1/groups` branch from ticket 01: `POST /api/v1/groups/commands/governance/create-group` and `POST /api/v1/groups/:groupId/commands/governance/:name`.
- One private method handles both. It repeats the checks of `command()`: bearer, idempotency key is a UUID, correlation id is a UUID, content type, body present; `decodeContract(descriptorFor('governance.v1'), request.body)`; `expectedVersion` equals `If-Match`; arguments are an object of at most 65536 bytes; `decodeCommandArguments('governance', name, …)`.
- No handler registered: `featureNotReady`.
- `create-group`: `expectedVersion` must be 0. Resolve the actor with `identity.authenticate(proof, tenantIds[0], 'platform-browser-api', now)`; that yields `userId` and proves membership of the first workspace. The procedure checks the rest.
- Other commands: `identity.authenticateGroup(proof, groupId, …)`, build the command, call `authenticateGroup` again, throw `STALE` if `groupEpoch` or `adminEpoch` changed, then run the handler with the second context.
- Extract the bearer-to-proof step into one private helper and use it in `context()`, `groups()` and the new method.
- Extend `BROWSER_V1_ROUTE_INVENTORY`.

`local-browser-host.ts`: build `AzureSqlGovernanceStore` when the connection string is set and pass `groupCommands: governanceCommandHandlers(store)`.

### 6. `group.changed` event

If `packages/telemetry/src/events.ts` exists when you start (ticket 04 has landed), call `logEvent('group.changed', { group_id, action, actor_user_id, subject_id })` in the transport after a group command handler succeeds. If it does not exist, skip this step and say so in the completion notes; ticket 04 adds the call when it finds this path.

## TDD seams

1. `packages/browser/src/index.test.ts` — through `BrowserV1Transport.handle` with a stub `groupCommands` map and the in-memory `IdentityStore`:
   - non-admin of the group gets 403; a foreign group id gets 403;
   - missing `origin`, missing idempotency key, or a non-UUID correlation id is refused exactly as on the tenant path;
   - `If-Match` different from `expectedVersion` gives 409;
   - the handler receives validated arguments, and `expectedVersion` reaches it unchanged;
   - an epoch change between the two session reads gives 409 (flip the epoch inside a wrapped identity store);
   - no `groupCommands` option gives 501;
   - the response decodes as `governance.v1`.
2. `packages/browser/src/browser-contracts.test.ts` — `create-group` rejects 0 or 51 ids, a duplicate id, a non-UUID, an empty or 129-char name; accepts `billingTenantId: null`.
3. `packages/browser/src/governance-commands.test.ts` — with a stub store: the receipt has `revision: expectedVersion + 1`; a store error with code `STALE` propagates.

## Checks

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm contracts && corepack pnpm test`
- With a database: `corepack pnpm sql:migrate && corepack pnpm sql:verify`.
- The runtime database user must be a member of `platform_governance_browser`. No script in the repo adds role members for this role. Put the exact `ALTER ROLE` statement in the completion notes so ticket 18 can document it.

## Out of scope

`add-admin`, `remove-admin`, `set-billing-tenant`, the `members` read (03). Any UI (15). In-memory group mutations: fixture mode answers 501 for group commands.

## Implementation prompt

```text
/mattpocock-skills:implement .scratch/governance-observability/issues/02-create-group-and-manage-workspaces.md

<context>
You are implementing ticket 02 of the Governance feature in the Threadline repo at "/media/smayan/500GB SSD/Full Stack" (quote the path; it contains spaces). Ticket 01 added tenant groups as read-only data. This ticket adds the first writes: create a group, add a workspace, remove a workspace.

This is the most security-sensitive ticket in the feature. A group admin becomes a full admin of every member workspace, and that right is materialized as real rows in identity.memberships and identity.membership_profiles. Two properties must hold, and both are enforced in SQL, not in TypeScript:
1. Consent: only someone who already administers a workspace can put it into a group. Without this any group admin could take over any workspace.
2. Exact revocation: removing a workspace deletes only the rows the group created. A person who was a direct admin before must still be one afterwards.
</context>

<read_first>
1. The ticket file named above. It holds the procedure rules, the statement order inside each procedure, and the transport steps.
2. The spec, Unit 1, sections "Authority model" and "Procedures": docs/superpowers/specs/2026-09-30-governance-observability-design.md
3. packages/browser/src/index.ts lines 150-220: command() is the pattern you mirror.
4. database/migrations/010_model_settings.sql lines 27-113: the receipt-replay pattern in T-SQL.
5. What ticket 01 produced: database/migrations/012_tenant_groups.sql, the GroupContext type in packages/identity/src/index.ts, the groups() method in the transport. Read the "Completion notes" at the bottom of ticket 01 for deviations.
Use `graphify explain "BrowserV1Transport"` and `graphify query "callers of decodeCommandArguments"` before opening large files.
</read_first>

<how_to_work>
Follow AGENTS.md: ponytail ladder, no code comments, smallest diff that is correct. Reuse before writing: mapError from packages/workflow/src/sql.ts (export it), sqlPool, decodeCommandArguments, the receipt shape from workflow-commands.ts.

Order:
1. Red-green through the three TDD seams in the ticket. They test the transport, the argument decoder and the handlers through their public entry points with stub stores. No database is needed.
2. Write migration 014 and its verify script together. Treat the verify script as the test suite for the SQL: every rule in the procedure table needs a case that would fail if the rule were removed. Run it against a database if AZURE_SQL_CONNECTION_STRING is set.
3. Wire local-browser-host.ts last.
</how_to_work>

<decisions_already_made>
- Receipts live in a new table governance.command_receipts keyed by (actor user id, idempotency key). The spec requires stored receipts and names no table.
- Inside a write procedure the order is: replay check, then epoch comparison (50003 STALE), then assert_group_admin, then rules and writes. A retry of a command that already succeeded must return its receipt, not STALE.
- The client's expectedVersion is the group epoch. The store passes it to SQL as @group_epoch. The transport does not compare it with the session epoch; it only checks that the session did not change between its own two reads.
- create-group has no group context. The transport resolves the actor by authenticating against the first listed workspace, and expectedVersion must be 0.
- A group-created membership is revoked only when no profile rows remain on it after the admin profile is deleted.
- Fixture mode does not support group writes.
</decisions_already_made>

<traps>
- identity.group_admin_grants has a foreign key to identity.tenant_group_members. Delete grant rows before the member row.
- CREATE OR ALTER inside EXEC(N'…') needs doubled single quotes. Copy the quoting style of migration 010.
- decodeCommandArguments requires every key listed for the command. billingTenantId must be sent as null, not omitted.
- Never concatenate a request value into a procedure name or SQL text. Bind everything with request.input().
- No new role gets INSERT, UPDATE or DELETE on tables. The verify script should assert that.
- localBrowserTransport is rebuilt per request on the deployed hosts. Keep nothing on the transport instance.
</traps>

<done_when>
All acceptance boxes hold and these pass: corepack pnpm typecheck, corepack pnpm lint, corepack pnpm contracts, corepack pnpm test. If a database is reachable, corepack pnpm sql:migrate and corepack pnpm sql:verify pass too. If it is not, say plainly that the SQL was not executed.
</done_when>

<report>
Tick the boxes, set Status to "implemented", append "Completion notes": what ran, what did not, deviations and why, whether the group.changed event was wired or left for ticket 04, and the ALTER ROLE statement an operator needs. Commit on the current branch with a conventional commit message.
</report>
```

## Completion notes

Verified (run locally):
- `corepack pnpm typecheck`, `corepack pnpm contracts` and `corepack pnpm test` (62 files, 379 tests) pass. `corepack pnpm lint` stays at the 641 errors the branch already had; none come from files this ticket adds or changes beyond those already failing.
- Tests first at all three seams: transport (non-admin and foreign group give 403; missing origin, idempotency key, bad correlation id and wrong content type are refused; no bearer gives 401; If-Match mismatch gives 409; handler gets validated arguments and the unchanged `expectedVersion`; epoch flip between the two session reads gives 409; no `groupCommands` gives 501; response decodes as `governance.v1`; create-group resolves the actor from the first workspace and needs `expectedVersion` 0), argument decoder (0/51 ids, duplicate, non-UUID, empty and 129-char name, `billingTenantId: null`), handlers (receipt `revision = expectedVersion + 1`, `STALE` propagates).

Not verified:
- No SQL ran (no `AZURE_SQL_CONNECTION_STRING`, Docker daemon down). `014_tenant_group_commands.sql` and `verify/014_tenant_group_commands.sql` are unexecuted. Run `sql:migrate` and `sql:verify` before applying 014; once applied it is pinned by digest.
- Because each failing call dooms its transaction (`XACT_ABORT ON`), the verify script runs every refusal case in its own rolled-back transaction with temp helper procedures `#verify_member` and `#verify_group`, dropped at the end.

Deviations and notes:
- `group.changed` event: `packages/telemetry/src/events.ts` does not exist, so the call is not wired. Ticket 04 adds it in `BrowserV1Transport.groupCommand` after the handler succeeds.
- `mapError` in `packages/workflow/src/sql.ts` is now exported and reused, not copied.
- The transport's bearer-to-proof step is one private `proof()` helper used by `context()`, `groups()` and `groupCommand()`; `session()` and `tenants()` keep their inline copies.
- The verify script also covers the 50-workspace limit on `create_group` (50002) and `remove_tenant` of a non-member (50002). The 50-member cap in `add_tenant` has SQL but no dedicated verify case.
- Known edge: if a user is later made a direct admin of a workspace whose admin profile the group created (`created_profile = 1`), `remove-tenant` deletes that profile.
- The governance routes are listed in `BROWSER_V1_ROUTE_INVENTORY`.

Operator statement (ticket 18 should document it). The runtime database user must join the new role:

```sql
ALTER ROLE platform_governance_browser ADD MEMBER platform_identity_app;
```

### Follow-up (2026-09-30)

Migrations applied and `sql:verify` passed against the dev database; the "no SQL ran" note above is resolved.

# 03 — Co-admins, billing workspace, and the members view

**What to build:** A group admin reads who is in the group: workspaces, admins, and the people who could be made co-admins. They add a co-admin from the existing members of the group's workspaces, remove one (never the last), and choose the billing workspace. This ticket also opens the group read route `GET /api/v1/groups/:groupId/:collection` that every later governance read uses.

**Blocked by:** 02 — Create a group; add and remove workspaces.

**Status:** implemented

**Spec:** `docs/superpowers/specs/2026-09-30-governance-observability-design.md` — Unit 1 "Procedures" (`add_admin`, `remove_admin`, `set_billing_tenant`) and the co-admin paragraph; Unit 3 "Group read procedures" (`read_members`); Unit 4 "`packages/governance`" (`service.ts`) and "Collections on the group route" (`members`); Security summary row "Lockout".

- [x] `GET /api/v1/groups/:groupId/members` returns workspaces (id, name, joined at, billing flag), current admins (user id, display name) and eligible co-admins (at most 200). A non-admin or a foreign group id gets 403. An unknown collection gets 404.
- [x] `add-admin` accepts only a user who is a current member of at least one group workspace. The new admin gets materialized admin rights in every group workspace.
- [x] `remove-admin` refuses to remove the last current admin with 409 `CONFLICT`, revokes only group-created rights, and bumps the affected membership epochs.
- [x] `set-billing-tenant` accepts only a member workspace.
- [x] Limit: 20 current admins per group.
- [x] All three writes keep the rules from ticket 02: idempotent replay, group epoch bump, 409 on a stale epoch.
- [x] Fixture mode serves `members` with `classification: 'fixture'`.
- [x] Query parameters on the group read route are limited to a fixed key set. An unknown key gives 422.
- [x] `database/verify/015_tenant_group_admins.sql` proves the eligibility rule, the last-admin guard, the admin limit, and that a revoked admin loses only group-created rows.

## Code map (verified 2026-09-30)

| Where | What is there now |
| --- | --- |
| `packages/browser/src/index.ts:178` | `projection()` — the tenant read path to mirror |
| `packages/browser/src/index.ts:179-183` | `validateQuery` — tenant routes accept only `pageSize` and `cursor` |
| `packages/browser/src/browser-contracts.ts:1` | `BROWSER_COLLECTIONS`; add `GROUP_COLLECTIONS` next to it |
| `packages/browser/src/local-browser-host.ts:58, 62-88` | `fixtureMeta` and `fixtureProjection`: how fixture data is labelled |
| `database/migrations/001_identity_tenant_access.sql:9-35` | `identity.tenants (id, slug, status, epoch)`, `identity.users (id, issuer, subject, display_name)`, `identity.memberships` |
| Ticket 02 output | `governance.grant_tenant_admin`, `governance.revoke_tenant_admin`, `governance.command_receipts`, `AzureSqlGovernanceStore`, `governanceCommandHandlers`, the group command route |

## Implementation path

### 1. Migration `015_tenant_group_admins.sql`

Same statement order inside each write as ticket 02: replay check, epoch comparison (50003), `assert_group_admin`, rules, writes, epoch bump, receipt.

| Procedure | Rules |
| --- | --- |
| `governance.add_admin(@group_id, @user_id, @group_epoch, @admin_epoch, @candidate_user_id, …)` | Candidate has a `current` membership in at least one member workspace (else 50002). Candidate is not already a current admin (else 50004). Fewer than 20 current admins (else 50004). Insert the admin row, or re-activate a `revoked` one (`status = current`, `epoch + 1`). Call `grant_tenant_admin` for every member workspace. |
| `governance.remove_admin(… @target_user_id …)` | Target is a current admin (else 50002). More than one current admin exists (else 50004). Set `status = revoked`, `epoch + 1`. Call `revoke_tenant_admin` for every grant row of that user in the group. Removing yourself is allowed when you are not the last. |
| `governance.set_billing_tenant(… @tenant_id …)` | Tenant is a member (else 50002). Update `billing_tenant_id`. |
| `governance.read_members(@group_id, @user_id, @group_epoch, @admin_epoch)` | `assert_group_admin` first. Recordset 1: `tenant_id, slug, joined_at, is_billing` ordered by slug. Recordset 2: current admins `user_id, display_name, created_at`. Recordset 3: `TOP (200)` distinct users with a current membership in a member workspace who are not current admins, `user_id, display_name`, ordered by display name. |

Grant execute on all four to `platform_governance_browser`.

### 2. Verify `015_tenant_group_admins.sql`

Rolled-back transaction with synthetic rows:

- a user with no membership in any group workspace cannot be added (50002);
- after `add_admin`, the candidate has an `admin` profile in every member workspace and grant rows with `created_profile = 1`;
- `remove_admin` on the only admin throws 50004;
- after `remove_admin`, the target's group-created profiles are gone, a profile they held directly is still there, and their membership epoch went up;
- a 21st admin is refused (50004);
- `read_members` throws 50001 for a non-admin and returns at most 200 eligible rows.

### 3. Contracts

`browser-contracts.ts`:

- `argumentKeys`: `'governance.add-admin': ['userId']`, `'governance.remove-admin': ['userId']`, `'governance.set-billing-tenant': ['tenantId']`. Validator: `userId` is a UUID.
- `export const GROUP_COLLECTIONS = ['members'] as const;` Later tickets append `overview`, `series`, `workflows`, `approvals`, `health`, `logs`, `trace`.
- `export const GROUP_QUERY_KEYS = ['range', 'tenant', 'panel', 'level', 'event', 'run', 'cursor'] as const;`

### 4. Store and handlers

`AzureSqlGovernanceStore`: extend `command` to the three new names, and add

```ts
members(context: GroupContext): Promise<{ workspaces: { tenantId: string; name: string; joinedAt: string; billing: boolean }[]; admins: { userId: string; name: string }[]; eligible: { userId: string; name: string }[] }>
```

`governanceCommandHandlers`: three more handlers.

### 5. Read route

`packages/browser/src/index.ts`:

```ts
export interface GroupProjection { context: GroupContext; collection: string; query: Readonly<Record<string, string>>; }
export type GroupProjectionHandler = (projection: GroupProjection) => Promise<Record<string, unknown>>;
```

- `BrowserTransportOptions.groupProjections?: GroupProjectionHandler`.
- Route `GET /api/v1/groups/:groupId/:collection`: the group id must be a UUID (else 403 like tenant ids), the collection must be in `GROUP_COLLECTIONS` (else 404). Every query key must be in `GROUP_QUERY_KEYS`, appear once, and have a value of at most 200 characters (`cursor` at most 2000); otherwise throw `INVALID`. The transport checks shape only. The service checks meaning.
- `identity.authenticateGroup(proof, groupId, …)` then `success(request, undefined, { groupId, collection, ...result })`.
- No handler registered: `featureNotReady`.

### 6. `packages/governance/src/service.ts`

```ts
export type GovernanceStore = Pick<AzureSqlGovernanceStore, 'members'>;
export class GovernanceService {
  constructor(private readonly store?: GovernanceStore) {}
  read(context: GroupContext, collection: string, query: Readonly<Record<string, string>>): Promise<Record<string, unknown>>
}
```

- With a store: `{ ...data, completeness: 'full', classification: 'restricted-operational' }`.
- Without a store: fixture data from `packages/governance/src/fixtures.ts`, `classification: 'fixture'`.
- `fixtures.ts` holds pure functions with no Node imports, for example `fixtureMembers(context)`. The browser preview imports the same file in ticket 12, so it must stay free of server-only modules.
- `GovernanceStore` is a `Pick` of the concrete class, not a new interface. Later tickets widen the pick.

`local-browser-host.ts`: always pass `groupProjections: (input) => governance.read(input.context, input.collection, input.query)`. The service gets the SQL store only when the connection string is set.

## TDD seams

1. `packages/browser/src/index.test.ts`: `members` 200 for a group admin with a stub `groupProjections`; 403 for a non-admin and for a foreign group; 404 for an unknown collection; 422 for an unknown query key, a repeated key, and a 201-character value; the payload decodes as `governance.v1` and carries `groupId`.
2. `packages/governance/src/service.test.ts`: with a stub store, `read(context, 'members', {})` returns the store data plus the two labels; with no store it returns fixture data for exactly `context.tenantIds`, labelled `fixture`.
3. `packages/browser/src/governance-commands.test.ts`: the three new handlers pass the right procedure arguments to a stub store.
4. `tests/platform/local-browser-host.test.ts`: fixture transport serves `/api/v1/groups/<local group id>/members`.

## Checks

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm contracts && corepack pnpm test`
- With a database: `corepack pnpm sql:migrate && corepack pnpm sql:verify`.

## Out of scope

Email invites for co-admins (deferred in the spec). UI (15). Other collections (08, 09, 10, 11).

## Implementation prompt

```text
/mattpocock-skills:implement .scratch/governance-observability/issues/03-co-admins-billing-and-members.md

<context>
You are implementing ticket 03 of the Governance feature in the Threadline repo at "/media/smayan/500GB SSD/Full Stack" (quote the path). Tickets 01 and 02 created tenant groups, the group fence, and the first group commands. This ticket finishes group administration (co-admins, billing workspace) and, more importantly for the rest of the feature, opens two things that seven later tickets build on: the read route GET /api/v1/groups/:groupId/:collection and the GovernanceService class in a new package packages/governance. Keep both small and plain. Later tickets add collections to them; they should not have to reshape them.
</context>

<read_first>
1. The ticket file named above.
2. The completion notes at the bottom of tickets 01 and 02 in the same folder. They record deviations you must build on.
3. database/migrations/014_tenant_group_commands.sql: the statement order and helper procedures you reuse.
4. packages/browser/src/index.ts, the group branch added by tickets 01 and 02, plus projection() and validateQuery().
5. packages/browser/src/local-browser-host.ts lines 58-88 for how fixture data is labelled.
Use `graphify query "what calls governanceCommandHandlers"` and `graphify explain "AzureSqlGovernanceStore"` to find the ticket 02 code quickly.
</read_first>

<how_to_work>
AGENTS.md applies: ponytail ladder, no code comments, match the dense style of packages/browser and packages/identity.

Test first at the four seams in the ticket, in order. Seam 1 (transport) and seam 2 (service) are the contract for later tickets, so make their tests describe behaviour a later collection will also need: authentication, 404 for an unknown collection, query-key allowlist, labels on the payload.

Then the migration and verify script. The three write procedures follow the exact statement order of ticket 02. Do not invent a second pattern.
</how_to_work>

<decisions_already_made>
- The transport validates query shape only: allowed keys, one value each, length caps. Range values, UUIDs and cursors are validated by GovernanceService in later tickets. Do not add that logic now.
- GovernanceStore is `Pick<AzureSqlGovernanceStore, 'members'>`. There is one implementation, so there is no separate interface.
- Fixtures live in packages/governance/src/fixtures.ts as pure functions with no Node-only imports, because the browser bundle imports that file in ticket 12.
- Eligible co-admins are capped at 200 rows in SQL.
- Self-removal is allowed unless you are the last admin.
</decisions_already_made>

<traps>
- The last-admin check and the revoke must happen in the same transaction with the group row locked, or two concurrent removals can empty the group.
- Re-adding a previously revoked admin must update the existing row (primary key is group_id, user_id), not insert.
- display_name comes from identity.users and is user-controlled text. It is returned as data; never log it.
- The response envelope for /api/v1/groups* is governance.v1 without tenantId (ticket 01). Pass undefined as the tenant to success().
</traps>

<done_when>
All acceptance boxes hold; corepack pnpm typecheck, lint, contracts and test pass; with a database, sql:migrate and sql:verify pass. State clearly if the SQL was not executed.
</done_when>

<report>
Tick the boxes, set Status to "implemented", append "Completion notes" (verified, not verified, deviations), and commit on the current branch with a conventional commit message.
</report>
```

## Completion notes

Verified (run locally):
- `corepack pnpm typecheck`, `corepack pnpm contracts` and `corepack pnpm test` (64 files, 418 tests) pass. `corepack pnpm lint` reports no error in any line this ticket adds; the errors left in `browser-contracts.ts` (3) and `local-browser-host.ts` (1) were already there.
- Tests first at all four seams: transport (200 for an admin with `governance.v1` payload carrying `groupId`; 403 for a non-admin, a foreign group id and a non-UUID group id; 401 without bearer; 404 unknown collection; 501 without a handler; 422 for an unknown key, a repeated key, a 201-character value, a 2001-character cursor and `__proto__`; allowed keys reach the handler), service (store data plus both labels, fixture data for exactly `context.tenantIds`, `NOT_FOUND`, store failure propagates), handlers (procedure arguments for the three new commands), and the fixture transport (`/api/v1/groups/<local group id>/members`, labelled `fixture`). Extra: the store maps the three `read_members` recordsets and binds each command to its procedure and parameter (`packages/governance/src/sql.test.ts`).

Not verified:
- No SQL ran (no `AZURE_SQL_CONNECTION_STRING`, Docker daemon down). `015_tenant_group_admins.sql` and `verify/015_tenant_group_admins.sql` are unexecuted. Run `sql:migrate` and `sql:verify` before applying 015; once applied it is pinned by digest.
- T-SQL cannot capture a multi-recordset procedure, so the verify script proves the 200-row cap by asserting `TOP (200)` in the stored definition of `read_members` and proves the call succeeds with 205 eligible users; the row contents are covered by the Node store test.

Deviations and notes:
- `GroupTenantCommand` is renamed `GroupCommandName` (the union now covers admin and billing commands); the store's `command` binds the target parameter per command (`tenant_id`, `candidate_user_id`, `target_user_id`).
- The group read payload is `{ ...serviceResult, groupId, collection }`, so the route values always win over anything the service returns.
- `GovernanceService.read` rejects any query key on `members` with 422 (spec: `members` takes no query). A later ticket that sends `range` to every collection must skip `members` or widen this check.
- A user whose `display_name` is NULL is returned with `name: ''`; the UI (ticket 15) must fall back to something else.
- Route inventory lists the new read route as `ready: false`, like the group command routes.
- `add-admin` counts only `status = current` towards the 20-admin limit; a re-added revoked admin updates the existing row (`epoch + 1`, `granted_by` = the acting admin).
- No new operator statement: `platform_governance_browser` membership from ticket 02 covers the four new procedures.

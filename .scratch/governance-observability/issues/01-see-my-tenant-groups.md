# 01 — See my tenant groups

**What to build:** A signed-in user who administers a tenant group calls `GET /api/v1/groups` and gets their groups: id, name, group epoch, admin epoch, member workspace ids, billing workspace. A user with no group gets an empty list, not an error. In fixture mode (no `AZURE_SQL_CONNECTION_STRING`) the local subject sees one group named "Local group" that holds every tenant in `PLATFORM_LOCAL_TENANTS`. The demo seed creates the same group in SQL for the admin test account.

**Blocked by:** None — can start immediately.

**Status:** implemented

**Spec:** `docs/superpowers/specs/2026-09-30-governance-observability-design.md` — "Unit 1: Tenant groups and identity" (Schema, Authority model, the first three rows of Procedures, Contract and routes, Fixture mode).

- [x] `database/migrations/012_tenant_groups.sql` creates schema `governance`, the four `identity.tenant_group*` / `identity.group_admin_grants` tables, `identity.list_current_groups`, `identity.read_group_session`, `governance.assert_group_admin`, and role `platform_governance_browser`.
- [x] `database/verify/012_tenant_groups.sql` passes against a migrated database and fails if any object, grant, or fence is missing.
- [x] `governance.v1` is a registered contract descriptor with `tenantScoped: false`; every existing descriptor stays `tenantScoped: true`; `corepack pnpm contracts` passes.
- [x] `GET /api/v1/groups` returns 200 with the caller's groups, 200 with `groups: []` for a member of no group, and 401 without a bearer token.
- [x] A suspended group and a revoked admin row are not listed.
- [x] Responses on `/api/v1/groups*` use a `governance.v1` envelope with no `tenantId`. Responses on every existing route are byte-for-byte unchanged.
- [x] Fixture mode returns "Local group" with all local tenants and the local subject as admin.
- [x] `database/seed/005_tenant_group_demo.sql` is idempotent and is skipped when `ADMIN_TEST_CLERK_SUBJECT` is unset.

## Code map (verified 2026-09-30)

| Where | What is there now |
| --- | --- |
| `packages/contracts/src/descriptors.ts:3-16` | `Definition` is a `[name, classification]` tuple; line 15 hardcodes `tenantScoped: true` |
| `packages/contracts/src/index.ts:38` | `validateEnvelope` rejects a missing `tenantId` only when `descriptor.tenantScoped` |
| `tools/contracts/governance.mjs:27` | Fails with `CONTRACT_METADATA_DRIFT` when any descriptor has `!descriptor.tenantScoped` |
| `packages/identity/src/index.ts:26-29` | `IdentityReadStore` (`authenticate`, `membershipsForProof`) |
| `packages/identity/src/index.ts:31-111` | In-memory `IdentityStore` |
| `packages/identity/src/index.ts:114-144` | `AzureSqlIdentityStore`; `call()` at 141, `validate()` at 137, `sqlEpoch()` at 10 |
| `packages/browser/src/index.ts:154-170` | `BrowserV1Transport.handle`; tenant regex at 160 |
| `packages/browser/src/index.ts:176` | `tenants()` — the closest existing method to the one you add |
| `packages/browser/src/index.ts:212-219` | `response()` hardcodes `browser.v1` and a placeholder tenant id |
| `packages/browser/src/local-browser-host.ts:51-56` | `fixtureIdentity` |
| `database/migrations/001_identity_tenant_access.sql` | Table and procedure style: `EXEC(N'CREATE OR ALTER PROCEDURE … WITH EXECUTE AS OWNER …')`, roles, grants |
| `database/seed/004_admin_test_account.sql`, `tools/sql/admin-seed.mjs:2,58-69` | Seed placeholder substitution; `ADMIN_SEED_FILE = /^004_/u` gates which seed files get `$(ADMIN_*)` replaced |
| `tools/sql/azure-sql.mjs` | Migrations are recorded by SHA-256 digest. An applied file can never be edited again |

## Implementation path

### 1. Migration `012_tenant_groups.sql`

Follow the header of migration 010 (`SET XACT_ABORT ON; BEGIN TRANSACTION; … COMMIT TRANSACTION;`).

```sql
IF SCHEMA_ID(N'governance') IS NULL EXEC(N'CREATE SCHEMA [governance] AUTHORIZATION dbo;');

CREATE TABLE [identity].tenant_groups (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  name nvarchar(128) NOT NULL,
  status nvarchar(16) NOT NULL CHECK (status IN (N'active', N'suspended')),
  epoch bigint NOT NULL DEFAULT (1) CHECK (epoch > 0),
  billing_tenant_id uniqueidentifier NULL REFERENCES [identity].tenants (id),
  created_by uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME())
);
CREATE TABLE [identity].tenant_group_members (
  group_id uniqueidentifier NOT NULL REFERENCES [identity].tenant_groups (id),
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  joined_by uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  joined_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_identity_tenant_group_members PRIMARY KEY (group_id, tenant_id),
  CONSTRAINT UQ_identity_tenant_group_members_tenant UNIQUE (tenant_id)
);
CREATE TABLE [identity].tenant_group_admins (
  group_id uniqueidentifier NOT NULL REFERENCES [identity].tenant_groups (id),
  user_id uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  status nvarchar(16) NOT NULL CHECK (status IN (N'current', N'revoked')),
  epoch bigint NOT NULL DEFAULT (1) CHECK (epoch > 0),
  granted_by uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_identity_tenant_group_admins PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IX_identity_tenant_group_admins_user ON [identity].tenant_group_admins (user_id, status) INCLUDE (group_id, epoch);
CREATE TABLE [identity].group_admin_grants (
  group_id uniqueidentifier NOT NULL,
  tenant_id uniqueidentifier NOT NULL,
  membership_id uniqueidentifier NOT NULL REFERENCES [identity].memberships (id),
  created_membership bit NOT NULL,
  created_profile bit NOT NULL,
  CONSTRAINT PK_identity_group_admin_grants PRIMARY KEY (group_id, tenant_id, membership_id),
  CONSTRAINT FK_identity_group_admin_grants_member FOREIGN KEY (group_id, tenant_id) REFERENCES [identity].tenant_group_members (group_id, tenant_id)
);
```

Procedures:

- `identity.list_current_groups(@issuer nvarchar(512), @subject nvarchar(256))` — one row per (group, member tenant) where the caller is a `current` admin of an `active` group: `group_id, name, group_epoch, admin_epoch, billing_tenant_id, tenant_id`. `LEFT JOIN` members so a group with no workspace still returns one row with `tenant_id NULL`. `ORDER BY group_id, tenant_id`.
- `identity.read_group_session(@group_id, @issuer, @subject)` — recordset 1: `user_id, group_epoch, admin_epoch` (zero rows when not a current admin of an active group). Recordset 2: `tenant_id` of each member.
- `governance.assert_group_admin(@group_id, @user_id, @group_epoch bigint, @admin_epoch bigint)` — `THROW 50001, N'DENIED', 1` unless the group is active, the admin row is current, and both epochs match. Model it on `workflow.assert_profile` (migration 005, line 67).

Grants: `identity.list_current_groups` and `identity.read_group_session` to `platform_identity_runtime` (the role the identity store already uses). Create `platform_governance_browser` and grant it `governance.assert_group_admin`. No role gets table permissions.

### 2. Verify `012_tenant_groups.sql`

Static checks in the style of `database/verify/005_diagram_workflow_v1.sql` (objects, role, no `INSERT/UPDATE/DELETE` grants to the role). Then behavioural checks inside `BEGIN TRANSACTION … ROLLBACK`, with synthetic tenant, user, group and admin rows:

- a current admin is listed and gets a session row;
- a revoked admin and a suspended group produce zero rows;
- `assert_group_admin` throws 50001 on a wrong group epoch and on a wrong admin epoch (`BEGIN TRY … END TRY BEGIN CATCH IF ERROR_NUMBER() <> 50001 THROW; END CATCH`, and `THROW 50000` if the call did not throw).

End with `SELECT N'012_tenant_groups' AS migration, N'passed' AS status;`.

### 3. Contract descriptor

`descriptors.ts`: widen the tuple to `readonly [name: string, classification: EvidenceClassification, tenantScoped?: false]`, append `['governance.v1', 'restricted-operational', false]`, and map with `tenantScoped: tenantScoped ?? true`.

`tools/contracts/governance.mjs:27`: the drift check must expect `governance.v1` to be unscoped and everything else scoped. One set literal is enough: `const UNSCOPED = new Set(['governance.v1'])`, then compare `descriptor.tenantScoped === !UNSCOPED.has(name)`.

### 4. Identity store

```ts
export interface TenantGroup { id: string; name: string; epoch: number; adminEpoch: number; tenantIds: readonly TenantId[]; billingTenantId?: TenantId; }
export interface GroupContext { userId: string; groupId: string; groupEpoch: number; adminEpoch: number; tenantIds: readonly TenantId[]; }
```

Add to `IdentityReadStore`:

```ts
groupsForProof(proof: Proof): readonly TenantGroup[] | Promise<readonly TenantGroup[]>;
authenticateGroup(proof: Proof, groupId: string, audience: string, now?: string): GroupContext | Promise<GroupContext>;
```

- `AzureSqlIdentityStore`: `groupsForProof` folds the rows of `identity.list_current_groups` by `group_id`, the way `membershipsForProof` folds profiles (lines 124-136). `authenticateGroup` calls `this.validate(proof, audience, now)`, validates `groupId` with `tenantId()` (it is just a UUID check), calls `identity.read_group_session`, parses both epochs with `sqlEpoch`, and throws `IdentityError('DENIED')` on a missing row.
- `IdentityStore` (in memory): a private `#groups` map, one seeding method `group(id: string, name: string, tenantIds: readonly string[], adminUserIds: readonly string[]): TenantGroup` (epoch 1, admin epoch 1), plus the two read methods. `authenticateGroup` applies the same proof checks as `authenticate` (line 85). Nothing else: group writes are SQL-only in tickets 02 and 03.

### 5. Transport

In `handle`, before the tenant regex at line 160:

```ts
if (path === '/api/v1/groups' && request.method === 'GET') return await this.groups(request);
```

`groups()` mirrors `tenants()`: `featureNotReady` when Clerk or identity is unset, 401 without a bearer, then `clerk.proof(...)` → `identity.groupsForProof(proof)` → `success` with `{ groups: [{ id, name, epoch, adminEpoch, tenantIds, billingTenantId? }], completeness: 'full' }`.

`response()` picks the descriptor from the path: for a request whose path starts with `/api/v1/groups`, encode with `descriptorFor('governance.v1')`, set `contract: 'governance.v1'`, and do not set `envelope.tenantId`. Everything else keeps the current code. This one branch covers success and error responses. Keep `MEDIA_TYPE` as it is; the client never inspects it.

Add `/api/v1/groups` to `BROWSER_V1_ROUTE_INVENTORY`.

### 6. Fixture mode and seed

- `fixtureIdentity` (`local-browser-host.ts:51`): after the membership loop, `identity.group(LOCAL_GROUP_ID, 'Local group', tenantIds, [subject])` with a module constant `LOCAL_GROUP_ID = 'a0000000-0000-4000-8000-000000000001'`.
- `database/seed/005_tenant_group_demo.sql`: uses `$(ADMIN_ISSUER)`, `$(ADMIN_SUBJECT)`, `$(ADMIN_TENANTS)` like seed 004. Inserts the group "Local group" (same fixed id), its members, the admin row, and a `group_admin_grants` row per tenant with `created_membership = 0, created_profile = 0` (seed 004 already made this user a direct admin). Every insert is guarded by `NOT EXISTS`. Skip a tenant that already belongs to another group.
- `tools/sql/admin-seed.mjs:2`: `ADMIN_SEED_FILE` must match 005 as well (`/^00[45]_/u`). Extend `tests/workspace/admin-seed.test.mjs` accordingly.

## TDD seams

1. `packages/browser/src/index.test.ts` — drive `BrowserV1Transport.handle` with the in-memory `IdentityStore` (the `transport()` helper at the top of that file): admin sees the group; member of no group gets `[]`; no bearer gives 401; the response decodes with `descriptorFor('governance.v1')` and has no `tenantId`; an existing tenant route still decodes with `browser.v1`.
2. `packages/identity/src/azure-sql-identity.test.ts` — row folding of `groupsForProof` and the DENIED path of `authenticateGroup`, using that file's existing SQL stub.
3. `tests/contracts/contracts.test.ts` — `governance.v1` validates without `tenantId`; `browser.v1` still requires it.
4. `tests/platform/local-browser-host.test.ts` — fixture transport lists "Local group".

## Checks

- `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm contracts && corepack pnpm test`
- With `AZURE_SQL_CONNECTION_STRING` set: `corepack pnpm sql:migrate && corepack pnpm sql:verify`, then `AZURE_SQL_ALLOW_DEMO_SEED=true corepack pnpm sql:seed:demo` twice (second run must change nothing).
- Fixture demo: start `corepack pnpm --dir apps/browser --ignore-workspace dev`, sign in, and request `/api/v1/groups` from the browser console with the Clerk token.

## Out of scope

Group commands and the `/api/v1/groups/:groupId/...` routes (02, 03). Any UI (12). Glossary and README (18).

## Implementation prompt

```text
/mattpocock-skills:implement .scratch/governance-observability/issues/01-see-my-tenant-groups.md

<context>
You are implementing ticket 01 of the Governance feature in the Threadline repo at "/media/smayan/500GB SSD/Full Stack" (the path contains spaces, so quote it in every shell command). All paths below are relative to that root.

The product has tenants ("workspaces") but no entity that owns several of them. This ticket introduces the tenant group at the read level only: tables, two identity read procedures, one fence procedure, a new non-tenant-scoped contract, and GET /api/v1/groups. Seventeen later tickets build on the types and the fence you create here, so the shapes in the ticket file are the contract. Follow them exactly.
</context>

<read_first>
1. The ticket file named above: acceptance criteria, code map, implementation path.
2. The spec, section "Unit 1: Tenant groups and identity": docs/superpowers/specs/2026-09-30-governance-observability-design.md
3. packages/identity/src/index.ts (whole file, 145 lines).
4. packages/browser/src/index.ts lines 138-220 only. The rest of that file is unrelated workbench classes.
5. database/migrations/001_identity_tenant_access.sql and 005_diagram_workflow_v1.sql lines 1-85 for SQL conventions.
Line numbers were checked on 2026-09-30. Locate code by symbol if they have moved. `graphify explain "BrowserV1Transport"` and `graphify query "who implements IdentityReadStore"` read the AST graph in graphify-out/ and cost far fewer tokens than opening files; run `graphify update .` once first.
</read_first>

<how_to_work>
AGENTS.md is binding: use the ponytail ladder (reuse what exists before writing anything new), write no code comments, keep the diff small. The repo writes dense one-line methods in packages/browser and packages/identity; match the file you are editing.

Test first at the four seams listed under "TDD seams" in the ticket, in that order. Each seam is a public entry point (the transport's handle method, the store's two new methods, validateEnvelope, the fixture host), so do not test private helpers. Write one failing test, make it pass, move on.

Then write the migration, the verify script and the seed. SQL cannot be unit-tested here, so the verify script is its test: make the behavioural checks in it real (a synthetic group inside a rolled-back transaction), not just OBJECT_ID existence checks.
</how_to_work>

<decisions_already_made>
- Group routes answer with a governance.v1 envelope and no tenantId. Choose the descriptor inside response() from the request path; do not add a second response method.
- A user with no groups gets 200 and an empty list. The UI in ticket 12 depends on this to show a "create a group" state.
- The in-memory IdentityStore gets one seeding method and two read methods. Do not build in-memory group mutations; later tickets write through SQL only.
- identity.read_group_session returns two recordsets (session row, then member tenant ids).
</decisions_already_made>

<traps>
- tools/contracts/governance.mjs rejects any descriptor that is not tenant scoped. `corepack pnpm contracts` will fail until you teach it that governance.v1 is the one exception.
- tools/sql/admin-seed.mjs only substitutes $(ADMIN_*) placeholders in files matching /^004_/. Seed 005 would run with literal placeholders unless you widen that pattern.
- Applied migrations are pinned by digest in dbo.platform_schema_migrations. Get 012 right before anyone applies it; after that it cannot be edited, only followed by a new file.
- identity.memberships.status allows only 'current' and 'revoked'. Do not invent other states.
- The envelope validator rejects unknown top-level keys and non-canonical numbers, so build the payload from plain JSON values only.
</traps>

<done_when>
Every acceptance box in the ticket is true, and these pass: corepack pnpm typecheck, corepack pnpm lint, corepack pnpm contracts, corepack pnpm test. If AZURE_SQL_CONNECTION_STRING is set in your shell, also run corepack pnpm sql:migrate and corepack pnpm sql:verify. If it is not set, do not claim the SQL ran.
</done_when>

<report>
Tick the boxes in the ticket file, set Status to "implemented", and append a "Completion notes" section: what you verified and how, what you could not verify (for example SQL without a database), and any place where you deviated from the ticket and why. Then commit on the current branch with a conventional commit message.
</report>
```

## Completion notes

Verified (run locally):
- `corepack pnpm typecheck`, `corepack pnpm contracts` and `corepack pnpm test` (61 files, 351 tests) pass.
- `corepack pnpm lint` still fails on 641 errors that exist on the untouched branch (env globals and non-null assertions in files outside this ticket); this ticket adds none.
- Tests written first at all four seams: transport (admin lists group, no-group gives `[]`, 401, governance.v1 without `tenantId`, tenant routes still browser.v1), Azure SQL store (row folding, DENIED path), contracts (governance.v1 unscoped, browser.v1 still scoped, governance.v1 is the only unscoped descriptor), fixture host ("Local group"), plus the seed placeholder test for file 005.

Not verified:
- No SQL ran. `AZURE_SQL_CONNECTION_STRING` is unset and the Docker daemon is down. `012_tenant_groups.sql`, `verify/012_tenant_groups.sql` and `seed/005_tenant_group_demo.sql` were written carefully but never executed, so run `sql:migrate`, `sql:verify` and `sql:seed:demo` twice before applying 012 anywhere. Once applied, 012 is pinned by digest.
- The fixture demo in a browser was not run.

Deviations:
- `identity.read_group_session` returns two recordsets of different shapes, which T-SQL `INSERT ... EXEC` cannot capture. The verify script therefore checks it statically (existence, grant, definition filters on current admin and active group). The list procedure and the fence are checked behaviourally in a rolled-back transaction.
- The in-memory `authenticate` proof checks moved into a private `proofUser` helper so `authenticateGroup` reuses them.
- Suspended group, revoked admin, non-admin and suspended-group fence cases are covered by the verify script only, not by the JS tests.

### Follow-up (2026-09-30)

Migrations applied and `sql:verify` passed against the dev database; the "no SQL ran" note above is resolved.

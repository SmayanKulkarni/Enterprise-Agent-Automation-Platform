# Platform browser shell

This Vite app is a React shell for the platform `browser.v1` API.
It keeps Clerk session tokens in Clerk-managed memory and sends one only as a
Bearer header; the platform remains responsible for User/Tenant membership and
authority.

Before a live run, configure the selected Clerk environment through deployment
secrets (never this repository, browser storage, URLs, logs, or evidence):

- Browser: `VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_PUBLISHABLE_KEY`
- Server only: `CLERK_SECRET_KEY`, `CLERK_ISSUER`, and exact comma-separated
  `CLERK_AUTHORIZED_PARTIES`
- Server only: `CLERK_AUDIENCE=platform-browser-api`

In the Clerk Dashboard, select the target instance, open **Sessions**, and use
**Customize session token → Claims** to add the static claim:

```json
{ "aud": "platform-browser-api" }
```

This updates the default session token, so `getToken()` is intentionally called
without a JWT template. Register the exact local and deployed origins, and the
sign-in/sign-up redirect URLs, in the same Clerk instance. Set
`VITE_PLATFORM_API_ORIGIN` to the Azure Function HTTPS origin in Vercel. It is
a public build value, not a secret; tokens remain Clerk-managed memory.

```sh
# Copy .env.server.example to .env.server.local and fill server-only values.
# The Clerk subject is the real test user's `sub`; local Tenant memberships are ephemeral.
set -a; source apps/browser/.env.server.local; set +a
pnpm --dir apps/browser --ignore-workspace dev
pnpm --dir apps/browser --ignore-workspace build
```

For local development, leave `VITE_PLATFORM_API_ORIGIN` unset: Vite mounts
`/api/v1` at `http://localhost:5173`. In production, Azure verifies the Clerk
token and current session on every request.

The deterministic state test is not a live Clerk demonstration. Real sign-in,
Tenant switching, logout/revocation, and stale-session evidence require the
deployment-managed values and a linked Clerk application.

The Vercel showcase boundary and its synthetic-data limits are recorded in
[`docs/architecture/vercel-showcase-boundary.md`](../../docs/architecture/vercel-showcase-boundary.md).
Its Azure API requires Function App settings for `AZURE_SQL_CONNECTION_STRING`,
`CLERK_ISSUER`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_AUDIENCE`,
and `CLERK_AUTHORIZED_PARTIES`. The Vercel project needs only
`VITE_CLERK_PUBLISHABLE_KEY` and `VITE_PLATFORM_API_ORIGIN`. The local-only `PLATFORM_LOCAL_CLERK_SUBJECT`
and `PLATFORM_LOCAL_TENANTS` are required only when Azure SQL is not configured.
The exact deployed HTTPS origin must be registered in Clerk. Configure server-only
values in the Function App's encrypted settings; only the two `VITE_` values
are browser build values.

Run `pnpm sql:migrate` and `pnpm sql:verify` with an administrator connection
before enabling `AZURE_SQL_CONNECTION_STRING` on the API. Migration 002 adds
Tenant-scoped browser snapshots. The runtime SQL user can read them only through
the membership/epoch-fenced procedure. A separate `platform_projection_writer`
role may publish safe collection snapshots through `projection.publish_snapshot`;
grant it only to owner services. Until an owner publishes a collection, its live
view reports `not-ready` with no synthetic records. Snapshot expiry reports
`stale`/`partial`, and provider evidence must still be certified by its owner.

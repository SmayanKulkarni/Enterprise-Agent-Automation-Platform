# Browser shell

React/Vite client for the `browser.v1` API. Clerk tokens stay in Clerk-managed
memory and are sent only as Bearer headers; the API resolves Tenant membership
and authority.

Copy `.env.server.example` to `.env.server.local` before starting the local server.
The `dev` command loads this server-only file. Set `VITE_CLERK_PUBLISHABLE_KEY`
and, for a separate API, `VITE_PLATFORM_API_ORIGIN`.
The API needs `CLERK_ISSUER`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`CLERK_AUDIENCE=platform-browser-api`, and exact comma-separated
`CLERK_AUTHORIZED_PARTIES`. Add `{ "aud": "platform-browser-api" }` to the
default Clerk session token claims and register the exact browser origins.

```sh
pnpm --dir apps/browser --ignore-workspace dev
pnpm --dir apps/browser --ignore-workspace build
```

Without `AZURE_SQL_CONNECTION_STRING`, the API uses explicitly labelled,
ephemeral fixture identities and projections. In this mode,
`PLATFORM_LOCAL_CLERK_SUBJECT` and `PLATFORM_LOCAL_TENANTS` grant local fixture
access. With `AZURE_SQL_CONNECTION_STRING`, those fixture settings are ignored:
the Clerk issuer and subject must exist in `[identity].users`, with a current
membership in an active tenant. Run `pnpm sql:migrate` and `pnpm sql:verify`
first; the API reads Tenant-scoped snapshots only through the membership and
epoch-fenced procedures.

To manage an OpenRouter connection, set
`WORKFLOW_OPENROUTER_WRAPPING_KEY_VERSION=v1` and a 32-byte base64url
`WORKFLOW_OPENROUTER_WRAPPING_KEY`. Configure each permitted exact model in
`WORKFLOW_OPENROUTER_MODELS`, and include structured-output-capable models in
`WORKFLOW_OPENROUTER_STRUCTURED_OUTPUT_MODELS`.

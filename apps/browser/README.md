# Platform browser shell

This Vite app is a same-origin React shell for the platform `browser.v1` API.
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
sign-in/sign-up redirect URLs, in the same Clerk instance. Serve this app from
the same origin as `/api/v1`; no CORS or token persistence is configured.

```sh
pnpm --dir apps/browser --ignore-workspace dev
pnpm --dir apps/browser --ignore-workspace build
```

The deterministic state test is not a live Clerk demonstration. Real sign-in,
Tenant switching, logout/revocation, and stale-session evidence require the
deployment-managed values and a linked Clerk application.

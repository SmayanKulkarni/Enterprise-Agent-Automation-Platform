# Enterprise Agent Automation Platform

This repository is the executable foundation for a multi-tenant platform that
builds, distributes, and operates governed agentic solutions for durable
enterprise work. Code and tests are the source of truth; these docs explain
only the intended boundaries and current runnable shape.

## What exists

- Domain packages model identity, Cases, capability admission, solution lifecycle,
  memory/evaluation, operations, deployment evidence, provider adapters, and
  reference journeys.
- `browser.v1` is a Clerk-authenticated API with a React/Vite browser shell.
  It serves safe Tenant-scoped projections, using local labelled fixtures or
  Azure SQL snapshots.
- Azure Functions and Vercel adapters expose the same browser response path.
  SQL migrations establish the minimal identity and projection-read model.

## Reference use cases

1. A solution engineer authors and publishes a governed Solution Package.
2. A Tenant installs it and runs a durable Case with bounded agents, approvals,
   idempotent effects, recovery, and evidence.
3. Operators inspect safe projections and resolve intervention, provider, or
   deployment issues.
4. The reference journeys cover technical implementation handoff and linked
   vendor assessment/access grant work.

## Working in the repo

```sh
pnpm verify
pnpm build:showcase
pnpm build:azure
```

Read [the architecture](docs/architecture.md), [decisions](docs/adr/), and the
[browser setup](apps/browser/README.md). Live cloud/provider operation is not
claimed by fixture evidence.

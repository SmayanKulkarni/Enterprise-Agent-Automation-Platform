# Private connector agent

Run this process inside the network that can reach the private MCP server. Certify a private installation in Studio, select **Enroll**, and copy the one-time token into the agent environment.

```sh
WORKFLOW_AGENT_BASE_URL=https://your-function-app.azurewebsites.net \
WORKFLOW_AGENT_TENANT_ID=your-tenant-uuid \
WORKFLOW_AGENT_INSTALLATION_ID=your-installation-uuid \
WORKFLOW_AGENT_TOKEN=the-enrollment-token \
WORKFLOW_AGENT_MCP_URL=http://127.0.0.1:3000/mcp \
node tools/workflow/private-agent.mjs
```

Set `WORKFLOW_AGENT_MCP_TOKEN` if the MCP endpoint requires a bearer token. Rotating or revoking the installation token in Studio stops the current agent until its environment is updated. The agent submits each result again until the platform accepts it; a command that may have been delivered is never polled a second time.

## CPU profile

```sh
pnpm profile:workflow
```

Runs the workflow e2e scenario under the V8 CPU profiler and prints the top self-time frames from repository code. `PROFILE_REPEAT` sets the extra iterations (default 200). Profiles are written to the gitignored `outputs/profiles/`; the worker's profile (the larger file) is the interesting one, and opens as a flamegraph in speedscope or Chrome DevTools.

The e2e ports are in-memory, so time spent waiting on SQL, model providers and MCP servers is not represented. Use Application Insights for that.

## Memory report

```sh
UPSTASH_VECTOR_REST_URL=... UPSTASH_VECTOR_REST_TOKEN=... node tools/workflow/memory-report.mjs <tenant-uuid> [--out outputs/memory-reports/run.json]
```

Reads one tenant namespace with the read-only Upstash `range` command and prints salience (share of items whose text names one of their subjects), active items per subject, and bytes per item, once for V2 items and once for everything. Precision@k is computed by the offline six-run scenario in `packages/workflow/src/agent-tools.test.ts` with the same `memory-metrics.mjs` functions.

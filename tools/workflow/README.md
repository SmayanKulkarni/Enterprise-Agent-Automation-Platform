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

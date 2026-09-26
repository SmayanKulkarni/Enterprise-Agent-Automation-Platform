# ADR 0004: Reach tenant extensions through certified MCP installations

**Status:** accepted

The platform will not ship managed Slack or Jira adapters. A tenant administrator installs a custom MCP server, certifies an immutable Capability Manifest, and grants only selected capabilities to workflow nodes. Public MCP endpoints use HTTPS; private MCP endpoints are reached through a tenant-operated agent that polls the platform over outbound HTTPS. For the resume-project demo, each installation has one revocable bearer token: the admin copies it once into the agent, the server stores only its hash, and the agent sends it over server-authenticated TLS. Rotation is manual. This keeps tenant systems private while ensuring that a workflow's external authority is explicit, version-pinned, and enforceable by the Capability Gateway rather than by an LLM prompt or MCP metadata.

## Consequences

Connector agents, credential brokering, capability certification, and manifest pinning are required before live external automation. A disconnected agent waits until the node deadline; an effect with an unknown outcome is never repeated automatically and requires administrator reconciliation or an explicit retry decision. The first release excludes tenant-uploaded code, per-tenant VPN/Private Link, and platform-managed SaaS connectors. Automated certificate issuance and rotation are deferred until real tenants or stronger identity requirements justify them.

# Diagram Workflow V1 local issues

**Source spec:** [Diagram to durable Workflow Definition V1 integration](00-spec.md)

| Order | Issue | Depends on |
| --- | --- | --- |
| 1 | [01: Authenticated graph drafts](01-authenticated-graph-drafts.md) | Existing Clerk and Studio storage |
| 2 | [02: Connector Installation and MCP delivery](02-connector-mcp-delivery.md) | 01 |
| 3 | [03: Compile and publish](03-compile-publish.md) | 01, 02 |
| 4 | [04: Durable Workflow Runs](04-durable-workflow-runs.md) | 02, 03 |
| 5 | [05: Model and Operational Memory](05-model-memory.md) | 04 |
| 6 | [06: Browser run experience and acceptance](06-browser-run-acceptance.md) | 01–05 |
| 7 | [07: Guided configuration for executable workflow nodes](07-guided-workflow-configuration.md) | 01–06 |

All issues use the accepted [workflow decisions](../../docs/diagram-workflow-v1-decisions.md), [glossary](../../CONTEXT.md), and [private MCP boundary](../../docs/adr/0004-private-mcp-extension-boundary.md). `ready-for-agent` is a local status only; no GitHub issue exists.

The additive [agentic memory Wayfinder map](../agentic-memory-v1/map.md) plans the extension to issue 05 without changing this implementation sequence.

# Enterprise Agent Automation Platform

This context defines the governed objects that turn a user-authored workflow into a durable, tenant-scoped automation.

## Workflow authoring

**Workflow definition**:
An immutable, versioned executable graph compiled from a diagram and pinned by every run.
_Avoid_: Canvas, diagram, flow

**Extension**:
A tenant-provided MCP server, reached through a Connector Installation and exposing schema-bound Capabilities.
_Avoid_: Plugin, arbitrary code, managed connector

**Capability**:
A named, schema-bound operation exposed by an installed Extension and authorized for a tenant.
_Avoid_: Tool, function, action

**Connector installation**:
A tenant-admin-owned binding of an Extension to its credentials, certified Capability Manifest, network route, and health state.
_Avoid_: Login, integration setup

**Private connector agent**:
A tenant-operated relay inside the tenant network that invokes a private Extension.
_Avoid_: VPN, public proxy

**Capability manifest**:
The immutable, admin-certified schema and risk record for the Capabilities available from one Connector Installation.
_Avoid_: Live discovery, MCP metadata

**Capability grant**:
The explicit permission that makes an installed Capability available to a particular Workflow Definition node.
_Avoid_: Prompt instruction, implied access

**Risk tier**:
An administrator-assigned effect classification for a Capability; an uncertified Capability is external, potentially destructive, and approval-required.
_Avoid_: MCP annotation, model judgment

## Durable operation

**Run history**:
The immutable, ordered evidence of one Workflow Run, including node attempts, model requests, effects, approvals, and results.
_Avoid_: Memory, logs

**Operational memory**:
Authorized, provenance-bearing information retained for retrieval by later runs of one Workflow Definition; it is distinct from a Run History.
_Avoid_: Chat history, logs

**Run summary**:
A source-linked condensation of Run History.
_Avoid_: Memory, audit record

**Agent-authored memory item**:
A source-linked task fact or explicitly stated user preference proposed by an Agent for Operational Memory.
_Avoid_: Instruction, inferred trait, Run History

**Memory import**:
An explicit Workflow Definition attachment that makes a source-linked Run Summary available to another workflow's Memory node.
_Avoid_: Shared tenant memory, implicit recall

**Approval**:
An administrator's authorization of one exact external effect, bound to its workflow version, capability, target, and arguments digest.
_Avoid_: Permission, review

**Node policy**:
The versioned bounds for one executable node.
_Avoid_: Prompt, model preference

**Published model policy**:
The versioned inference settings for an Agent node.
_Avoid_: Prompt text, model preference

**Trigger**:
An event that starts a Workflow Run.
_Avoid_: Connector callback, schedule

**Evidence retention**:
The tenant policy that controls the lifetime of Run History and derived operational logs.
_Avoid_: Backup, memory retention

# Enterprise Agent Automation Platform

A multi-tenant platform for creating, distributing, and operating governed agentic solutions for durable enterprise work.

## Platform

**Solution Studio**:
The environment where solution engineers assemble, test, evaluate, and version tenant-ready agentic solutions.
_Avoid_: Agent builder, workflow editor

**Governed Catalog**:
A permission-aware collection of approved, versioned Solution Packages that tenants may install.
_Avoid_: Marketplace, agent store

**Operations Control Plane**:
The operational interface for supervising Cases, approvals, policies, agent activity, outcomes, and platform health.
_Avoid_: Admin dashboard, chatbot console

**Tenant**:
An organization with isolated identities, data, policies, memory, connectors, installed solutions, and telemetry access.
_Avoid_: Account, customer

**Demo Scenario**:
A versioned, resettable fixture journey that creates Tenant-scoped records and, where configured, marked external resources to prove one end-to-end capability.
_Avoid_: Demo project, sample data

**Customer Environment**:
The systems, data sources, constraints, and stakeholders that an Integration Provider connects for one enterprise customer; it is business context for a Technical Implementation Case, not a platform Tenant or generic project.
_Avoid_: Project, account

**Portfolio-Grade Platform**:
The complete agreed platform capability set implemented and integrated at solo-developer operating scale, with enterprise-scale behavior documented rather than artificially operated.
_Avoid_: MVP, partial prototype, enterprise-scale production service

## Solutions and Work

**Case**:
A durable business objective containing its context, evidence, plans, actions, approvals, state, and outcome. A Case can span multiple agent runs and human interventions.
_Avoid_: Chat, task, agent run

**Solution Package**:
A versioned, installable definition of Case types, agent roles, workflows, policies, evaluations, memory rules, and connector requirements.
_Avoid_: Agent, template, application

**Extension Package**:
A versioned set of tenant-specific tools or transformations executed outside the main platform process under explicit permissions and resource limits.
_Avoid_: Plugin, custom fork, script

**Agent Definition**:
A versioned declaration of an agent role, instructions, model policy, capabilities, knowledge scopes, guardrails, budgets, delegation rules, and required evaluations.
_Avoid_: Custom agent, prompt

**Agent Team**:
The bounded set of Agent Definitions that a Solution Package permits to collaborate on its Cases.
_Avoid_: Swarm, arbitrary sub-agents

**Orchestrator**:
The Agent Definition responsible for planning Case work and delegating bounded assignments to members of an Agent Team.
_Avoid_: Master agent, unrestricted supervisor

**Capability**:
An approved action or query exposed to an Agent Definition through a native connector, MCP server, or Extension Package.
_Avoid_: Integration, unrestricted tool

**Skill Module**:
A versioned procedural module containing instructions, examples, input and output contracts, permitted capabilities, knowledge requirements, guardrail hooks, and evaluation cases.
_Avoid_: Prompt, executable plugin

**Capability Gateway**:
The tenant-aware enforcement boundary through which agents access native connectors, MCP servers, and Extension Packages.
_Avoid_: MCP client, integration proxy

## Identity and Authority

**Capability Profile**:
A scope-bound set of human or workload commands and evidence visibility; it is not a job title and does not imply authority in another plane.
_Avoid_: Role, job title, blanket permission

**Authority Plane**:
The non-interchangeable domain in which a Capability Profile is granted: platform-wide, Tenant, provider-native, or Case-scoped.
_Avoid_: Global role, inherited access

**Case-profile Assignment**:
A package-declared, approved, auditable, and expiring grant that lets a Tenant member perform a specific participant function on one Case.
_Avoid_: Self-registration, standing role

**Evidence Classification**:
The independent visibility rule for Case and authorization evidence: ordinary Case, restricted operational, secret, or immutable audit evidence.
_Avoid_: Permission to act

## Reference Solutions

**Integration Provider**:
The fictional B2B company that operates an enterprise data-integration platform and uses the Technical Implementation solution to onboard its customers.
_Avoid_: Platform Tenant, consultancy, generic SaaS

**Customer Environment**:
The identities, systems, data sources, constraints, and stakeholders that an Integration Provider must connect and validate for one enterprise customer.
_Avoid_: Tenant, account

**Technical Implementation Case**:
A post-sale Case that begins with an accepted customer agreement and ends when the Customer Environment is verified as production-ready and handed to operations.
_Avoid_: Signup, sales onboarding, customer success

**Vendor Assessment Case**:
A Case that gathers evidence and determines whether a vendor satisfies a Tenant's risk policy.
_Avoid_: Access review, procurement ticket

**Access Grant Case**:
A Case that evaluates and provisions a subject's requested access after verifying required dependencies such as an approved Vendor Assessment.
_Avoid_: Vendor review, permission change

## Improvement

**Orchestrator Candidate**:
An immutable proposed version of the Orchestrator's instructions, planning strategy, delegation policy, retrieval configuration, model routing, or operational budgets.
_Avoid_: Self-edit, live mutation

**Improvement Cycle**:
The governed process that generates, evaluates, shadows, canaries, promotes, or rejects an Orchestrator Candidate.
_Avoid_: Self-training, autonomous rewrite

**Evaluation Ledger**:
The provenance-preserving record of deterministic checks, business outcomes, human interventions, calibrated model-based judgments, and synthetic evaluation results.
_Avoid_: Labels, reward database

**Validated Experience**:
A reviewed lesson derived from completed Cases and approved for retrieval in future Cases within an authorized scope.
_Avoid_: Chat history, raw Case memory

**Strategy Selector**:
A learned policy that chooses among pre-approved orchestration strategies from Case features without generating plans or expanding authority.
_Avoid_: Neural orchestrator, autonomous policy

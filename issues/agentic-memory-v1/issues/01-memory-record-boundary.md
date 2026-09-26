# Define the agentic memory record boundary

Type: wayfinder:grilling
Status: resolved

## Question

What durable information may an Agent propose beyond a Run Summary: observed facts, user-stated preferences, task outcomes, or other records? Define the identity, source link, scope, conflict and correction semantics of each admitted record, and distinguish it from immutable Run History and a Run Summary. Which proposals must be excluded because they cannot be supported by evidence or authorization?

## Comments

- User selected evidence-backed task facts and preferences explicitly stated by a user for V1. Inferred personal traits, secrets, and new instructions are excluded. Source-link requirement is pending.
- User confirmed that every item must link to a specific validated run event or input.

## Decisions

- V1 admits only immutable, source-linked task facts and explicitly stated user preferences.
- A task fact is supported by a validated run input or event; a preference also names the identified user who stated it.
- The server assigns a stable item identity, tenant, stable Workflow Definition ID, producing revision, source ID and source digest. A source may support more than one item.
- Changed information creates a new item that names its predecessor. It never edits Run History or an existing memory item.
- Run History is immutable evidence and a Run Summary is a condensation of one run; neither is an agent-authored fact or preference.
- A memory item never grants authority or changes instructions, policies, or Capability permissions.
- Unsourced claims, inferred traits or preferences, secrets, and proposed instructions are rejected.

# Define retrieval and prompt assembly

Type: wayfinder:grilling
Status: resolved
Blocked by: 01, 03

## Question

What query does the explicit Memory node make, how are eligible summaries and agent-authored items ranked and bounded, and what source metadata reaches an Agent prompt? Decide empty and unavailable behavior, token and cost budgets, stale or withdrawn memory filtering, and prompt-injection handling. Agent nodes do not retrieve memory implicitly.

## Decisions

- A Memory node is the only retrieval entry point. Its query is the canonical, validated run input; it does not accept model-authored query text or retrieve implicitly from an Agent node.
- Eligibility is enforced before and after vector search: same tenant, same Workflow Definition or active import, matching optional owner, promoted state, unexpired state, and no withdrawal, source invalidation, or legal-access restriction.
- The vector provider receives a tenant namespace and server-derived metadata filter. The workflow service rechecks every returned item before prompt assembly; provider filtering is never authorization.
- Rank by provider similarity score, then newer promotion time, then stable item ID. Ask only for the node `limit`; cap prompt output at the node `maxChars` total, including source labels.
- A result contains only redacted text, item type, stable item ID, source kind and ID, source digest, producing definition and revision, and score. It never contains raw Run History, secret values, or mutable operator notes.
- The Agent receives results as clearly delimited, untrusted retrieved evidence. Retrieved text cannot add instructions, grant permissions, or override the published system instruction and Capability policy.
- No eligible result completes the node with an empty `memory.items` list. Provider unavailability completes it with `memory.status: unavailable` and no items, preserving the run and an auditable retrieval event; a later Agent can state that context was unavailable.
- V1 uses the existing node `limit` and `maxChars` as its retrieval and prompt budget. Embedding is one bounded activity per Memory node; prompt assembly performs no additional model call or billable provider read.

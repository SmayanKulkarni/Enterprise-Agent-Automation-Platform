# 05: Model policy and Operational Memory

**Status:** ready-for-agent
**Source spec:** [V1 integration](00-spec.md)
**Blocked by:** 04

## What to build

Implement Agent and Memory node activities under the published Node policy. Azure OpenAI is the default model provider. OpenRouter requires tenant and workflow opt-in. Pin provider, exact model, fallback, prompt-template version, allowed Capabilities, and response schema at publication. Let the model propose only allow-listed Capability calls; the server validates and authorizes them. Retrieve bounded, validated, source-linked Run Summaries in Workflow Definition scope. Generate summaries separately after completion and promote them automatically only after validation.

## Acceptance

- [ ] Agent calls use the published provider/model/schema/prompt version and obey time, token, cost, round, attempt, and effect bounds.
- [ ] Invalid structured output stops the node; an ungranted model-proposed Capability cannot execute.
- [ ] Fallback is permitted only before any Capability executes; an uncertain effect blocks fallback and automatic retry.
- [ ] Three consecutive retryable pre-effect failures open a provider circuit for 60 seconds; one half-open probe determines recovery.
- [ ] Memory retrieval is semantic, bounded, source-linked, and limited to the current workflow unless an explicit Memory Import exists.
- [ ] Raw Run History is never used as prompt memory. Invalid summaries never become retrievable.
- [ ] Summary generation retries at most three times and its failure leaves the Workflow Run complete, with failure visible to an operator.
- [ ] The confirmed browser API seam uses injected model/Memory boundaries to verify observable requests, results, and projections.

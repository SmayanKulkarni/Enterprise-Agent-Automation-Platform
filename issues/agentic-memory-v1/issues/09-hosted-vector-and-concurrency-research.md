# Research hosted vector memory and concurrent access

Type: wayfinder:research
Status: resolved

## Question

Given the user's preference against SQL for Operational Memory, which quick-to-use hosted vector services have a usable free tier, and what storage and retrieval pattern supports multiple concurrent users within the existing Diagram Workflow V1 runtime?

## Answer

The user ruled out SQL for agentic Operational Memory and wants to start free while designing for multiple concurrent users. This does not change the existing Azure SQL Run History. Pinecone Starter was the original research recommendation; the resolved integration decision selects Upstash Vector while Pinecone remains a benchmark fallback. The embedding model and dimension are pinned during live certification.

| Hosted option | Current free allowance | Consequence for this workflow |
| --- | --- | --- |
| [Pinecone Starter](https://www.pinecone.io/pricing/) | 2 GB index storage, 1 million read units/month, 2 million write units/month, 1 GB egress/month, five indexes, 100 namespaces per index; AWS `us-east-1` only. Listed hosted embedding models include 5 million tokens/month. | Strongest first candidate for the proposed per-tenant namespace pattern. Read units are not query counts: a vector query costs at least 0.25 RU and increases with namespace size ([unit rules](https://docs.pinecone.io/guides/manage-cost/understanding-cost)). The two Starter account users are console members, not application users. |
| [Upstash Vector](https://upstash.com/pricing/vector) | One free database, 10,000 queries/updates per day, 1 GB data, 100 namespaces, at most 1,536 vector dimensions. | Quick REST/TypeScript setup with [namespace](https://upstash.com/docs/vector/features/namespaces) and [metadata filtering](https://upstash.com/docs/vector/features/filtering); daily operation cap needs a traffic test. |
| [Qdrant Cloud](https://qdrant.tech/documentation/cloud/create-cluster/) | One free node with 1 GB RAM, 0.5 vCPU, and 4 GB disk. | Supports [tenant payload indexing and later dedicated shards](https://qdrant.tech/documentation/manage-data/multitenancy/), but the free cluster suspends after one inactive week and is deleted after four. |
| [Azure AI Search](https://learn.microsoft.com/en-us/azure/search/search-limits-quotas-capacity) | One free service per subscription, 50 MB storage, three indexes. | Supports [filtered vector search](https://learn.microsoft.com/en-us/azure/search/vector-search-filters), but the small free allocation is a weak default for durable multi-user memory. |
| [Supabase Vector](https://supabase.com/docs/guides/ai/vector-columns) | [500 MB free Postgres database](https://supabase.com/pricing). | Uses Postgres `pgvector`; it does not meet a no-SQL memory requirement. |

For concurrent use, keep the existing independent Azure Durable Functions run orchestration and move memory writes and reads into its activities. On promotion, validate a source-linked record, assign a deterministic ID, embed its text once, and upsert it idempotently. Durable activities have [at-least-once execution](https://learn.microsoft.com/en-sg/azure/azure-functions/durable/durable-functions-types-features-overview), so retries cannot create duplicate memory. Keep each tenant in its own vector namespace; use Workflow Definition and any subject or import scope as metadata, and have the server authorize the query and recheck returned records. Pinecone's [multitenancy guidance](https://docs.pinecone.io/guides/index-data/implement-multitenancy) recommends one namespace per tenant and describes automatic scaling. A Memory node embeds its query once, requests a bounded `topK`, and supplies only validated eligible results to a later Agent node.

The current draft workflow implementation is unsuitable for concurrent memory reads: [`memoryStep`](../../../packages/workflow/src/runtime.ts) lists every tenant summary, and [`AzureEmbeddingMemoryPort`](../../../packages/workflow/src/ports.ts) embeds every candidate again on each query. Replacing that scan with precomputed vectors and server-side `topK` is the first performance change. Bound activity concurrency and retry transient provider throttling; Azure documents [Durable Functions scaling controls](https://learn.microsoft.com/en-us/azure/azure-functions/durable-functions/durable-functions-perf-and-scale) and [Azure OpenAI request/token quotas](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota). Free-tier quotas are evaluation limits, not verified production capacity.

If the Upstash certification gate fails, benchmark Pinecone Starter with representative tenant counts, concurrent Memory nodes, query latency from the Azure runtime to `us-east-1`, read/write units, egress, and embedding-token use. Pin one embedding model and dimension before any production data is accepted. Agent and Run Summary LLM calls remain separate.

## Decisions

- The initial provider is Upstash Vector, selected from the Vercel Marketplace's top relevant hosted-vector result; its namespace and metadata filtering fit the tenant-scoped contract.
- Pinecone Starter remains a benchmark fallback only. It is not provisioned or referenced by the runtime path.
- Vector writes and reads run in durable activities with deterministic IDs, one tenant namespace, bounded `topK`, metadata filtering, and a workflow-service eligibility recheck.
- Provider credentials stay server-side. Provisioning is deferred only because the existing Vercel project is not linkable from this directory without an explicit valid project name.

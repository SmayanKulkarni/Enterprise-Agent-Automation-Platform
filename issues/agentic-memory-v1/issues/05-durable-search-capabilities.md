# Research durable semantic search within the current stack

Type: wayfinder:research
Status: resolved

## Question

Using current official documentation and the repository's existing Azure SQL and Node runtime setup, determine which durable, tenant-filtered semantic retrieval options are actually available for the expected V1 memory records. Compare reuse of existing Azure SQL capabilities with any genuinely necessary additional service or dependency. Record operational limits, migration needs, query isolation guarantees, and source URLs; do not choose a provider or implement it in this ticket.

## Answer

The current `[workflow].records` table stores tenant-keyed JSON and has no semantic index. `RelationalMemoryStore` is an in-memory subclass, despite its name. Durable retrieval therefore needs a searchable projection and a scoped SQL read procedure; the current record can remain source evidence.

- Azure SQL Database supports exact similarity with [`VECTOR(n)`](https://learn.microsoft.com/en-us/sql/t-sql/data-types/vector-data-type?view=sql-server-ver17) and [`VECTOR_DISTANCE`](https://learn.microsoft.com/en-us/sql/t-sql/functions/vector-distance-transact-sql?view=sql-server-ver17). A query can filter by trusted tenant, Workflow Definition or explicit import, and promoted state before returning a bounded result. This needs a pinned embedding model and measured latency at expected record counts; vectors are limited to 1,998 dimensions.
- Azure SQL [full-text search](https://learn.microsoft.com/en-us/sql/relational-databases/search/full-text-search?view=sql-server-ver17) offers lexical matching, but its separate statistical semantic search is [unavailable in Azure SQL](https://learn.microsoft.com/en-us/azure/azure-sql/database/features-comparison?view=azuresql). It may supplement retrieval; it cannot substitute for embedding similarity if semantic recall is required.
- Azure SQL [vector indexes](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-vector-index-transact-sql?view=sql-server-ver17) and [`VECTOR_SEARCH`](https://learn.microsoft.com/en-us/sql/t-sql/functions/vector-search-transact-sql?view=sql-server-ver17) are preview features with [regional availability](https://learn.microsoft.com/en-us/azure/azure-sql/database/region-availability?view=azuresql) and schema restrictions. The existing composite UUID primary key is unsuitable for the documented index shape, so approximate search would need a separate table and an explicit deployment check.
- [Azure AI Search vector filtering](https://learn.microsoft.com/en-us/azure/search/vector-search-filters) is an additional service and synchronized index. Its [security filter pattern](https://learn.microsoft.com/en-us/azure/search/search-security-trimming-for-azure-search) does not authorize a caller by itself. The workflow service would still enforce scope and recheck source eligibility.

Planning constraint: first verify the deployed Azure SQL feature set and expected eligible row counts, pin the embedding model and dimension, then benchmark exact scoped SQL retrieval. Consider approximate indexing or an additional search service only if measured requirements demand it. No provider is selected by this research ticket.

## Later direction

The user subsequently ruled out SQL for agentic Operational Memory and asked for a free hosted vector service that can serve multiple concurrent users. The SQL path above remains a technical finding, but its planning constraint is superseded for memory storage and retrieval. See [hosted vector and concurrency research](09-hosted-vector-and-concurrency-research.md); Run History remains on its existing workflow store.

## Decisions

- Azure SQL remains the immutable Run History and audit ledger; it is not the Operational Memory vector store.
- The existing in-memory `RelationalMemoryStore` and candidate-wide embedding scan are not durable or suitable for concurrent semantic retrieval.
- No Azure SQL vector migration, approximate index, or SQL backfill is part of this extension.

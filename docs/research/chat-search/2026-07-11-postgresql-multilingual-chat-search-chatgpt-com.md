# PostgreSQL-Native Multilingual Chat Search Architecture

**Status:** Present-day recommendation  
**Last reviewed:** 11 July 2026  
**Target stack:** PostgreSQL, pgvector, Drizzle ORM, NestJS  
**Indexing model:** Eventually consistent; up to 24 hours of delay is acceptable  
**Primary goal:** Relevant, multilingual, vendor-independent search over chats whose content is stored in a related `messages` table

---

## 1. Executive recommendation

Build chat search as a **derived search projection** inside PostgreSQL:

1. Keep `chats` and `messages` as the canonical application data.
2. Convert each chat into overlapping, contextual **search documents** made from multiple adjacent messages.
3. Index each search document with:
   - PostgreSQL full-text search using the language-neutral `simple` configuration;
   - `pg_trgm` for typo and partial-match recovery;
   - a multilingual embedding stored with pgvector.
4. Retrieve candidates independently from lexical, trigram, and vector search.
5. Merge candidates with **Reciprocal Rank Fusion (RRF)**.
6. Aggregate document matches into ranked chats.
7. Generate embeddings asynchronously through a provider-neutral NestJS interface.
8. Use OpenAI Batch, another hosted provider, or a local embedding worker as interchangeable backends.
9. Start with exact vector search inside each user's filtered dataset. Add HNSW only after measurements show that exact search is too slow.
10. Do not require language detection for indexing or querying.

The resulting architecture is PostgreSQL-native and does not depend on Elasticsearch, Qdrant, Supabase, OpenAI, or any particular embedding model.

---

## 2. Why hybrid retrieval is necessary

Neither lexical search nor embeddings are sufficient alone.

### Lexical search is strongest for

- exact names;
- identifiers such as `SVM-1842`, UUIDs, error codes, and package names;
- URLs and filenames;
- quoted phrases;
- code symbols;
- queries where the user remembers the original wording.

### Embeddings are strongest for

- paraphrases;
- conceptual queries;
- vague recollections;
- cross-language retrieval;
- questions whose wording differs from the original conversation.

### Trigram matching is useful for

- spelling errors;
- incomplete words;
- transliteration differences;
- unusual names;
- words that are not handled well by token-based full-text search.

Run these retrieval methods independently and fuse their **ranks**, rather than trying to combine incompatible raw scores.

---

## 3. Search the conversation in contextual windows

Do not embed only individual messages and do not embed an entire chat as one vector.

A single message often lacks context:

```text
[user]
Does it support that?

[assistant]
Yes, but only with PostgreSQL 18.
```

An entire chat may contain many unrelated subjects, producing a weak averaged representation.

Instead, create contextual documents containing several adjacent messages:

```text
[user]
How should multilingual chat search work?

[assistant]
Use language-neutral lexical retrieval together with multilingual embeddings.

[user]
Can it remain provider-independent?

[assistant]
Yes. Store the embedding model metadata separately and access providers through an application interface.
```

### Recommended chunking policy

Use message boundaries rather than cutting arbitrary text.

A practical initial policy:

- target approximately 300–800 tokens;
- use a conservative character cap if the core chunker must remain tokenizer-independent;
- never split a message unless one message exceeds the embedding backend's limit;
- overlap adjacent chunks by one or two messages;
- include role markers such as `[user]`, `[assistant]`, and `[tool]`;
- omit hidden reasoning, internal metadata, and content the user is not authorized to search;
- retain the first and last message IDs represented by every chunk;
- version the chunking algorithm.

The embedding backend may expose an optional tokenizer or maximum input size, but the canonical chunking algorithm should not depend on one provider's tokenizer.

### Re-indexing policy

For the first implementation, rebuilding all chunks for a dirty chat is usually simpler and reliable. Only changed chunks need new embeddings because their content hashes will differ.

Later, append-only chats can be optimized by rebuilding only:

- the final existing chunk;
- any new chunks created after it.

Edits and deletions should rebuild every chunk that overlaps the affected messages.

---

## 4. PostgreSQL extensions

Use only two non-core extensions in the baseline:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

`pg_trgm` is a standard PostgreSQL contrib extension. pgvector supplies vector storage and distance operators.

An optional extension such as PGroonga can be introduced later for languages requiring stronger script-aware tokenization. It should not be required by the core architecture.

---

## 5. Search projection schema

The following schema is intentionally separate from the canonical `messages` table.

### 5.1 Search documents

```sql
CREATE TABLE search_documents (
    id uuid PRIMARY KEY,

    owner_id uuid NOT NULL,
    chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,

    chunk_ordinal integer NOT NULL,
    chunker_version integer NOT NULL,

    first_message_id uuid NOT NULL REFERENCES messages(id),
    last_message_id uuid NOT NULL REFERENCES messages(id),

    content text NOT NULL,
    normalized_content text NOT NULL,
    content_hash text NOT NULL,

    first_message_at timestamptz NOT NULL,
    last_message_at timestamptz NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    fts tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(normalized_content, ''))
    ) STORED,

    UNIQUE (chat_id, chunk_ordinal, chunker_version)
);
```

`owner_id` represents the search-security boundary. It may instead be a `workspace_id`, `tenant_id`, or another scope used by the application.

`normalized_content` should be created in application code using deterministic normalization, for example:

- Unicode NFKC;
- normalized newlines;
- collapsed repeated whitespace;
- lowercase where appropriate;
- preservation of accents by default;
- preservation of code, identifiers, and URLs.

Do not automatically transliterate all text or strip accents globally. Those operations can merge distinct words and degrade non-English search.

### 5.2 Search-document indexes

```sql
CREATE INDEX search_documents_owner_chat_idx
    ON search_documents (owner_id, chat_id);

CREATE INDEX search_documents_owner_time_idx
    ON search_documents (owner_id, last_message_at DESC);

CREATE INDEX search_documents_fts_idx
    ON search_documents
    USING gin (fts);

CREATE INDEX search_documents_trgm_idx
    ON search_documents
    USING gin (normalized_content gin_trgm_ops);
```

The security filter must be present inside every candidate query, not applied only after retrieval.

---

## 6. Embedding model registry

Treat an embedding model as a versioned search dependency.

```sql
CREATE TABLE embedding_models (
    key text PRIMARY KEY,

    provider text NOT NULL,
    provider_model text NOT NULL,
    provider_revision text,

    dimensions integer NOT NULL,
    distance_metric text NOT NULL DEFAULT 'cosine',

    document_prefix text,
    query_prefix text,

    enabled boolean NOT NULL DEFAULT true,
    active_for_search boolean NOT NULL DEFAULT false,

    created_at timestamptz NOT NULL DEFAULT now(),

    CHECK (dimensions > 0),
    CHECK (distance_metric IN ('cosine', 'l2', 'inner_product'))
);
```

Use a stable internal key such as:

```text
multilingual-search-v1
multilingual-search-v2
```

The rest of the application should use this internal key, not a provider's public model name.

Store separate document and query prefixes because some embedding families expect asymmetric inputs such as `query:` and `passage:`.

Only one model normally needs to be active for user queries, while another model may be backfilled and evaluated in parallel.

---

## 7. Embedding storage

A dimensionless pgvector column allows different model dimensions to coexist.

```sql
CREATE TABLE search_embeddings (
    document_id uuid NOT NULL
        REFERENCES search_documents(id) ON DELETE CASCADE,

    model_key text NOT NULL
        REFERENCES embedding_models(key),

    owner_id uuid NOT NULL,
    chat_id uuid NOT NULL,

    embedding vector NOT NULL,
    embedded_content_hash text NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (document_id, model_key)
);

CREATE INDEX search_embeddings_owner_model_idx
    ON search_embeddings (owner_id, model_key);
```

`owner_id` and `chat_id` are deliberately denormalized. This keeps authorization and grouping inside the vector candidate query and avoids relying on a join before filtering.

### Content-hash safety rule

An embedding is valid only when:

```text
search_embeddings.embedded_content_hash
    =
search_documents.content_hash
```

This prevents a delayed batch result from overwriting a newer document version after a message has been edited or deleted.

---

## 8. Exact vector search first

pgvector performs exact nearest-neighbor search without an approximate index.

For user-specific chat search, the `owner_id` filter may reduce the searchable set to thousands or tens of thousands of documents. Exact search can be simpler, perfectly accurate, and fast enough.

Start with:

```sql
SELECT
    document_id,
    chat_id,
    embedding <=> $3::vector AS distance
FROM search_embeddings
WHERE owner_id = $1
  AND model_key = $2
ORDER BY embedding <=> $3::vector
LIMIT 100;
```

Benchmark this before introducing HNSW.

### When to add HNSW

Add HNSW when production measurements show unacceptable query latency or CPU usage.

Because the column supports multiple dimensions, create one partial expression index per searchable model:

```sql
CREATE INDEX CONCURRENTLY search_embeddings_multilingual_v1_hnsw
ON search_embeddings
USING hnsw (
    (embedding::vector(1024)) vector_cosine_ops
)
WHERE model_key = 'multilingual-search-v1';
```

The corresponding query must use the same cast:

```sql
SELECT
    document_id,
    chat_id,
    embedding::vector(1024) <=> $3::vector(1024) AS distance
FROM search_embeddings
WHERE owner_id = $1
  AND model_key = 'multilingual-search-v1'
ORDER BY embedding::vector(1024) <=> $3::vector(1024)
LIMIT 100;
```

For filtered approximate search, enable iterative scans for the transaction:

```sql
SET LOCAL hnsw.iterative_scan = strict_order;
```

Do not add HNSW automatically merely because vectors are present. Measure exact-search latency first.

---

## 9. Language strategy

### Baseline: no language detection

Use:

```sql
to_tsvector('simple', normalized_content)
```

and:

```sql
websearch_to_tsquery('simple', query)
```

This avoids incorrect assumptions about a message having exactly one language.

Language detection is unreliable for:

- short messages;
- mixed-language messages;
- code-heavy content;
- proper names;
- product names;
- transliterated text;
- chats that switch language repeatedly.

A multilingual embedding model supplies semantic and cross-language recall, while `simple` FTS preserves exact word forms.

### Known limitation

PostgreSQL's built-in parser is not an equally strong tokenizer for every writing system. Languages without whitespace-delimited words may receive weaker lexical retrieval.

If real evaluation shows poor lexical quality for Chinese, Japanese, Thai, or another target language, introduce a lexical-search adapter backed by PGroonga or another PostgreSQL extension. Keep the candidate interface unchanged so the rest of the retrieval pipeline does not need to know which lexical engine produced the ranks.

---

## 10. Query pipeline

For each search:

1. normalize the user query;
2. generate a query embedding synchronously with the active embedding model;
3. run lexical, trigram, and vector candidate queries;
4. convert each candidate list to ranks;
5. fuse document ranks with RRF;
6. aggregate the strongest document matches into chats;
7. return the best document as the result snippet source.

The query embedding must use the same model revision and query-prefix convention as the stored document embeddings.

### Candidate sizes

Reasonable initial values:

```text
Lexical candidates: 100
Vector candidates: 100
Trigram candidates: 30–50
Final chats: 20
```

Tune these values with relevance tests rather than intuition.

---

## 11. Reciprocal Rank Fusion

Do not mix raw cosine similarity, trigram similarity, and `ts_rank_cd` with a weighted sum. Their numeric scales are unrelated and change across datasets.

Use RRF:

```text
rrf_score =
    lexical_weight / (k + lexical_rank)
  + vector_weight  / (k + vector_rank)
  + trigram_weight / (k + trigram_rank)
```

A suitable starting point is:

```text
k = 60
lexical_weight = 1.0
vector_weight = 1.0
trigram_weight = 0.35
```

These are starting values, not universal constants.

---

## 12. Reference hybrid SQL

This query demonstrates the retrieval shape. Adapt identifiers and vector dimensions to the application.

```sql
WITH
query_data AS (
    SELECT
        $1::uuid AS owner_id,
        $2::text AS query_text,
        $3::vector AS query_embedding,
        $4::text AS model_key,
        websearch_to_tsquery('simple', $2) AS tsquery
),

lexical_candidates AS MATERIALIZED (
    SELECT
        d.id AS document_id,
        d.chat_id,
        ts_rank_cd(d.fts, q.tsquery) AS lexical_score
    FROM search_documents d
    CROSS JOIN query_data q
    WHERE d.owner_id = q.owner_id
      AND d.fts @@ q.tsquery
    ORDER BY lexical_score DESC, d.id
    LIMIT 100
),

lexical_ranked AS (
    SELECT
        document_id,
        chat_id,
        row_number() OVER (
            ORDER BY lexical_score DESC, document_id
        ) AS candidate_rank
    FROM lexical_candidates
),

vector_candidates AS MATERIALIZED (
    SELECT
        e.document_id,
        e.chat_id,
        e.embedding <=> q.query_embedding AS distance
    FROM search_embeddings e
    CROSS JOIN query_data q
    JOIN search_documents d
      ON d.id = e.document_id
     AND d.content_hash = e.embedded_content_hash
    WHERE e.owner_id = q.owner_id
      AND e.model_key = q.model_key
    ORDER BY e.embedding <=> q.query_embedding
    LIMIT 100
),

vector_ranked AS (
    SELECT
        document_id,
        chat_id,
        row_number() OVER (
            ORDER BY distance ASC, document_id
        ) AS candidate_rank
    FROM vector_candidates
),

trigram_candidates AS MATERIALIZED (
    SELECT
        d.id AS document_id,
        d.chat_id,
        similarity(
            d.normalized_content,
            q.query_text
        ) AS trigram_score
    FROM search_documents d
    CROSS JOIN query_data q
    WHERE d.owner_id = q.owner_id
      AND d.normalized_content % q.query_text
    ORDER BY trigram_score DESC, d.id
    LIMIT 40
),

trigram_ranked AS (
    SELECT
        document_id,
        chat_id,
        row_number() OVER (
            ORDER BY trigram_score DESC, document_id
        ) AS candidate_rank
    FROM trigram_candidates
),

fused_documents AS (
    SELECT
        document_id,
        chat_id,
        sum(weight / (60.0 + candidate_rank)) AS document_score
    FROM (
        SELECT
            document_id,
            chat_id,
            candidate_rank,
            1.0::double precision AS weight
        FROM lexical_ranked

        UNION ALL

        SELECT
            document_id,
            chat_id,
            candidate_rank,
            1.0::double precision AS weight
        FROM vector_ranked

        UNION ALL

        SELECT
            document_id,
            chat_id,
            candidate_rank,
            0.35::double precision AS weight
        FROM trigram_ranked
    ) candidates
    GROUP BY document_id, chat_id
),

ranked_per_chat AS (
    SELECT
        document_id,
        chat_id,
        document_score,
        row_number() OVER (
            PARTITION BY chat_id
            ORDER BY document_score DESC, document_id
        ) AS document_rank
    FROM fused_documents
),

chat_scores AS (
    SELECT
        chat_id,
        sum(
            CASE document_rank
                WHEN 1 THEN document_score
                WHEN 2 THEN document_score * 0.25
                WHEN 3 THEN document_score * 0.10
                ELSE 0
            END
        ) AS chat_score,
        (array_agg(
            document_id
            ORDER BY document_score DESC, document_id
        ))[1] AS best_document_id
    FROM ranked_per_chat
    WHERE document_rank <= 3
    GROUP BY chat_id
)

SELECT
    c.id AS chat_id,
    c.title,
    s.chat_score,
    s.best_document_id,
    d.content AS best_document_content,
    d.first_message_id,
    d.last_message_id
FROM chat_scores s
JOIN chats c
  ON c.id = s.chat_id
JOIN search_documents d
  ON d.id = s.best_document_id
ORDER BY s.chat_score DESC, c.id
LIMIT 20;
```

### Why aggregate only a few documents

Using only `MAX(document_score)` makes chat ranking unstable around one accidental match.

Summing every matching document unfairly favors long chats.

A weighted top-three aggregation is a useful compromise:

```text
best result        × 1.00
second-best result × 0.25
third-best result  × 0.10
```

Tune this with evaluation data.

---

## 13. Snippets and highlighting

For lexical matches, PostgreSQL can generate a highlighted excerpt:

```sql
SELECT ts_headline(
    'simple',
    content,
    websearch_to_tsquery('simple', $1),
    'MaxFragments=2, MinWords=8, MaxWords=28'
)
FROM search_documents
WHERE id = $2;
```

For a semantic-only result, return a shortened version of the best document and its message range. The UI can open the chat at `first_message_id` or the strongest matched message.

Recommended result contract:

```ts
export type ChatSearchResult = {
  chatId: string;
  title: string | null;
  score: number;

  bestDocumentId: string;
  firstMessageId: string;
  lastMessageId: string;

  snippet: string;
  matchedBy: Array<"lexical" | "vector" | "trigram">;
};
```

---

## 14. Provider-neutral embedding interface

The core application should distinguish document embeddings from query embeddings.

```ts
export type EmbeddingInput = {
  id: string;
  text: string;
  contentHash: string;
};

export type EmbeddedItem = {
  id: string;
  contentHash: string;
  vector: number[];
};

export type ExternalBatchStatus =
  | { state: "pending" }
  | { state: "completed"; items: EmbeddedItem[] }
  | { state: "failed"; error: string };

export interface EmbeddingBackend {
  readonly modelKey: string;
  readonly dimensions: number;
  readonly maxInputTokens?: number;

  embedQuery(text: string): Promise<number[]>;

  embedDocuments(inputs: EmbeddingInput[]): Promise<EmbeddedItem[]>;

  submitDocumentBatch?(
    inputs: EmbeddingInput[],
  ): Promise<{ externalBatchId: string }>;

  getDocumentBatch?(externalBatchId: string): Promise<ExternalBatchStatus>;
}
```

Possible implementations:

```text
OpenAiEmbeddingBackend
HostedEmbeddingBackend
LocalOnnxEmbeddingBackend
LocalHttpEmbeddingBackend
```

Provider-specific request formats belong inside these adapters.

The search service should depend on an injection token:

```ts
export const EMBEDDING_BACKEND = Symbol("EMBEDDING_BACKEND");
```

---

## 15. Asynchronous indexing in PostgreSQL

A separate Redis queue is not required initially. PostgreSQL can safely coordinate workers with `FOR UPDATE SKIP LOCKED`.

### Dirty-chat queue

```sql
CREATE TABLE search_dirty_chats (
    chat_id uuid PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
    owner_id uuid NOT NULL,

    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),

    locked_at timestamptz,
    locked_by text,
    last_error text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX search_dirty_chats_available_idx
    ON search_dirty_chats (available_at)
    WHERE locked_at IS NULL;
```

When a message is inserted, edited, or deleted, enqueue its chat in the same database transaction:

```sql
INSERT INTO search_dirty_chats (
    chat_id,
    owner_id,
    available_at,
    updated_at
)
VALUES ($1, $2, now(), now())
ON CONFLICT (chat_id) DO UPDATE
SET
    owner_id = EXCLUDED.owner_id,
    available_at = LEAST(
        search_dirty_chats.available_at,
        EXCLUDED.available_at
    ),
    updated_at = now();
```

### Claiming jobs

```sql
WITH claimed AS (
    SELECT chat_id
    FROM search_dirty_chats
    WHERE locked_at IS NULL
      AND available_at <= now()
    ORDER BY available_at, chat_id
    FOR UPDATE SKIP LOCKED
    LIMIT 100
)
UPDATE search_dirty_chats q
SET
    locked_at = now(),
    locked_by = $1
FROM claimed
WHERE q.chat_id = claimed.chat_id
RETURNING q.*;
```

### Worker sequence

For each claimed chat:

1. load ordered searchable messages;
2. rebuild deterministic chunks;
3. calculate normalized content and hashes;
4. upsert changed `search_documents`;
5. delete obsolete chunks;
6. enqueue missing or stale embeddings for the active model;
7. release the dirty-chat row when projection work succeeds;
8. retry with exponential backoff after failure.

Use a lease timeout so another worker can reclaim rows abandoned by a crashed process.

---

## 16. Delayed batch embeddings

The indexing system should support both synchronous and delayed document embedding.

A hosted Batch API is appropriate because:

- document embeddings are not on the request latency path;
- the recent-chats UI already exposes newly created conversations;
- a 24-hour search-index delay is acceptable;
- batch processing can be less expensive;
- the same job model can support hosted or local batch workers.

### Generic batch state

```sql
CREATE TABLE embedding_batches (
    id uuid PRIMARY KEY,

    model_key text NOT NULL
        REFERENCES embedding_models(key),

    backend text NOT NULL,
    external_batch_id text,

    status text NOT NULL,
    submitted_at timestamptz,
    completed_at timestamptz,

    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),

    CHECK (
        status IN (
            'building',
            'submitted',
            'completed',
            'failed',
            'expired'
        )
    )
);

CREATE TABLE embedding_batch_items (
    batch_id uuid NOT NULL
        REFERENCES embedding_batches(id) ON DELETE CASCADE,

    document_id uuid NOT NULL
        REFERENCES search_documents(id) ON DELETE CASCADE,

    content_hash text NOT NULL,
    external_item_id text NOT NULL,

    PRIMARY KEY (batch_id, document_id),
    UNIQUE (batch_id, external_item_id)
);
```

Never correlate external batch output by line order. Use a deterministic external item ID containing or mapping to:

```text
model key
search document ID
content hash
```

Before applying a returned vector, verify:

- the document still exists;
- its content hash still matches;
- the returned vector has the registered dimensions;
- every value is finite;
- the model key matches the batch.

### OpenAI Batch as one adapter

OpenAI Batch currently supports `/v1/embeddings`, uses JSONL input, requires a unique `custom_id`, provides a 50% discount relative to synchronous APIs, and has a 24-hour completion window. A batch can contain up to 50,000 requests and a 200 MB input file; embedding batches are also limited to 50,000 embedding inputs.

A request line has this shape:

```json
{
  "custom_id": "multilingual-search-v1:document-id:content-hash",
  "method": "POST",
  "url": "/v1/embeddings",
  "body": {
    "model": "provider-model-name",
    "input": "search document content"
  }
}
```

This format belongs only inside `OpenAiEmbeddingBackend`. It must not leak into the indexing domain model.

### Query embeddings remain synchronous

Batch processing is suitable for stored documents, not interactive search queries. Generate the query embedding synchronously using the active model.

---

## 17. NestJS module boundaries

A practical module layout:

```text
SearchModule
├── SearchController
├── ChatSearchService
├── SearchQueryRepository
├── SearchProjectionService
├── SearchIndexWorker
├── EmbeddingBatchWorker
├── EmbeddingModelRegistry
└── providers/
    ├── OpenAiEmbeddingBackend
    ├── LocalEmbeddingBackend
    └── HostedEmbeddingBackend
```

Suggested responsibilities:

### `ChatSearchService`

- validates the query;
- obtains the active model;
- generates the query embedding;
- executes the hybrid SQL;
- formats snippets and result metadata.

### `SearchProjectionService`

- loads messages;
- chunks conversations;
- normalizes text;
- calculates content hashes;
- upserts and deletes search documents.

### `SearchIndexWorker`

- claims dirty chats;
- rebuilds projections;
- creates embedding work.

### `EmbeddingBatchWorker`

- builds provider batches;
- submits them;
- polls their state;
- validates and persists results.

### `EmbeddingModelRegistry`

- resolves the active model;
- provides dimensions and prefixes;
- prevents querying an index with an incompatible model.

NestJS `@nestjs/schedule` is sufficient for periodic polling and job claiming. In a multi-instance deployment, workers must still coordinate through row locks or advisory locks.

---

## 18. Drizzle ORM strategy

Use Drizzle for normal schema and application queries, but do not force every PostgreSQL-specific feature into the TypeScript schema DSL.

Use raw SQL migrations for:

- `CREATE EXTENSION`;
- generated `tsvector` columns;
- partial expression HNSW indexes;
- PostgreSQL search functions;
- custom constraints involving `vector_dims`;
- advanced `WITH` queries used for rank fusion.

This keeps migrations explicit and reviewable.

A NestJS repository can call the hybrid query through Drizzle:

```ts
import { sql } from "drizzle-orm";

const rows = await db.execute(sql`
  select *
  from search_chats(
    ${ownerId}::uuid,
    ${queryText}::text,
    ${JSON.stringify(queryEmbedding)}::vector,
    ${modelKey}::text,
    ${limit}::integer
  )
`);
```

Wrapping the hybrid SQL in a PostgreSQL function is optional but useful when:

- the query is large;
- multiple application services need it;
- SQL-level tests are desirable;
- query-plan stability matters.

Keep authorization arguments explicit even when row-level security is also enabled.

---

## 19. Model migration

Never overwrite old vectors in place when changing models.

Use this migration process:

1. register the new model as enabled but not active;
2. build its partial HNSW index only if approximate search is needed;
3. backfill embeddings asynchronously;
4. evaluate old and new models against the same query set;
5. activate the new model for queries;
6. retain the previous model for rollback;
7. remove old embeddings and indexes after a safe period.

The model registry and `(document_id, model_key)` primary key allow multiple generations to coexist.

Changing a provider without changing the model semantics may still require a new internal model key. Treat vectors as reproducible artifacts tied to an exact provider model and revision.

---

## 20. Security and deletion

Every search path must enforce the same authorization rules as ordinary chat access.

Requirements:

- filter by `owner_id`, tenant, workspace, project, or ACL inside every candidate CTE;
- never retrieve globally and filter results in application code;
- cascade deletions from chats to search documents and embeddings;
- remove or rebuild chunks after message deletion;
- avoid embedding hidden system data unless users are allowed to search it;
- do not include secret provider configuration or tool credentials in document text;
- ensure delayed batch responses cannot restore deleted content;
- define retention for external batch files and provider-side data.

For complex sharing, a single `owner_id` may be insufficient. Replace it with a searchable-scope ID or precomputed ACL relation that can be efficiently applied before ranking.

---

## 21. Relevance evaluation

Build a small, versioned evaluation dataset before tuning weights.

Include queries covering:

- exact phrases;
- names and identifiers;
- error messages;
- paraphrases;
- vague recollections;
- English, Spanish, Russian, and other target languages;
- mixed-language messages;
- a query in one language matching a conversation in another;
- spelling mistakes;
- transliterations;
- code and filenames;
- old and recent conversations;
- long chats containing several subjects.

For every query, label relevant chats and optionally relevance grades.

Track:

- Recall@10;
- MRR;
- nDCG@10;
- zero-result rate;
- latency p50 and p95;
- query-embedding latency;
- exact-versus-HNSW recall;
- proportion of results contributed by each retriever.

Evaluate retrieval changes before changing RRF weights, chunk sizes, models, or candidate counts.

---

## 22. Performance progression

### Initial implementation

Use:

- native `simple` FTS;
- `pg_trgm`;
- exact pgvector search filtered by owner;
- RRF;
- PostgreSQL-backed jobs;
- delayed batch document embeddings.

This is the simplest production-capable version.

### Add HNSW when

- exact vector queries exceed the latency budget;
- CPU cost becomes material;
- individual searchable scopes contain many documents;
- measured recall remains acceptable under filtered ANN search.

### Add a specialized lexical extension when

- CJK or other target-language lexical recall is inadequate;
- built-in ranking is the main relevance bottleneck;
- advanced tokenization, highlighting, or faceting is required.

### Add a dedicated queue when

- PostgreSQL job polling creates measurable load;
- very high job throughput is required;
- workflows need complex fan-out, priorities, or independent retention;
- indexing workers must operate across several services.

None of these upgrades requires changing the canonical chat/message schema or the search result contract.

---

## 23. Recommended implementation order

### Phase 1: lexical baseline

1. Create `search_documents`.
2. Implement deterministic chunking and normalization.
3. Add `simple` FTS and trigram indexes.
4. Return grouped chat results with snippets.
5. Create the relevance evaluation set.

### Phase 2: semantic retrieval

1. Add the embedding model registry.
2. Add `search_embeddings`.
3. Implement one `EmbeddingBackend`.
4. Backfill document embeddings.
5. Add exact vector candidates and RRF.
6. Evaluate multilingual and cross-language quality.

### Phase 3: delayed indexing

1. Add the dirty-chat queue.
2. Add batch tables.
3. Implement batch submission and polling.
4. Validate content hashes before upserting results.
5. Expose indexing timestamps for observability.

### Phase 4: scale only when measured

1. Profile query plans and p95 latency.
2. Add HNSW if exact search is insufficient.
3. Test iterative scans under authorization filters.
4. Add specialized lexical search if language evaluation requires it.
5. Introduce a dedicated queue only if PostgreSQL coordination becomes a bottleneck.

---

## 24. Final architecture

```text
chats ───────┐
             ├── canonical application data
messages ────┘
      │
      │ message changed
      ▼
search_dirty_chats
      │
      ▼
SearchIndexWorker
      │
      ├── normalize and chunk
      ├── hash content
      ├── upsert search_documents
      └── enqueue stale embeddings
                    │
                    ▼
          EmbeddingBackend
          ├── hosted synchronous
          ├── hosted batch
          └── local model
                    │
                    ▼
             search_embeddings

Interactive query
      │
      ├── synchronous query embedding
      ├── PostgreSQL FTS candidates
      ├── pg_trgm candidates
      └── pgvector candidates
                    │
                    ▼
          Reciprocal Rank Fusion
                    │
                    ▼
          top documents per chat
                    │
                    ▼
       ranked chats with snippets
```

This design keeps PostgreSQL as the only required datastore, supports multilingual and mixed-language conversations, allows delayed low-cost indexing, and permits embedding providers or lexical engines to be replaced without redesigning the search domain.

---

## 25. Primary technical references

- [PostgreSQL full-text search](https://www.postgresql.org/docs/current/textsearch.html)
- [PostgreSQL preferred indexes for text search](https://www.postgresql.org/docs/current/textsearch-indexes.html)
- [PostgreSQL `pg_trgm`](https://www.postgresql.org/docs/current/pgtrgm.html)
- [pgvector](https://github.com/pgvector/pgvector)
- [Drizzle ORM: PostgreSQL full-text search](https://orm.drizzle.team/docs/guides/postgresql-full-text-search)
- [Drizzle ORM: pgvector similarity search](https://orm.drizzle.team/docs/guides/vector-similarity-search)
- [NestJS task scheduling](https://docs.nestjs.com/techniques/task-scheduling)
- [OpenAI Batch API](https://developers.openai.com/api/docs/guides/batch)
- [PGroonga](https://pgroonga.github.io/)

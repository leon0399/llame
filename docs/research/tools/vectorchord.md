---
type: Reference
title: "VectorChord"
description: "PostgreSQL vector index extension with IVF/RaBitQ and disk graph indexes, prefiltering, and AGPL or Elastic licensing, evaluated as an approximate-index option for llame chat search."
resource: "https://github.com/pgsty/vchord"
tags: [postgresql, vector-search, pgvector, ann-index, bm25, licensing]
status: draft
observed:
  date: "2026-11-26"
  revision: "1.5.0"
sources:
  - id: vchord-pgxn-110
    resource: "https://pgxn.org/dist/vchord/1.1.0/"
    title: "vchord 1.1.0 README: pgvector dependency, feature claims, and dual license"
  - id: vchord-attribution
    resource: "https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/about/attribution.md"
    title: "Upstream sources, stewardship transition, and fork maintenance"
  - id: vchord-indexing
    resource: "https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/vchord/usage/indexing.md"
    title: "vchordrq indexing, operator classes, and build options"
  - id: vchord-prefilter
    resource: "https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/vchord/usage/prefilter.md"
    title: "Filtered index scans, the vchordrq.prefilter GUC, and selectivity results"
  - id: vchord-graph-index
    resource: "https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/vchord/usage/graph-index.md"
    title: "vchordg as a disk-based graph index with low memory consumption"
  - id: vchord-release-150
    resource: "https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/blog/release/vchord-1.5.0.md"
    title: "vchord 1.5.0: streaming filtered searches, parallel builds, and graph repair after deletes"
  - id: vchord-release-index
    resource: "https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/blog/release/_index.md"
    title: "Release index naming the first PGSTY release and each feature release"
  - id: vchord-benchmarks
    resource: "https://github.com/pgsty/vchord.pgsty.com/tree/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/vchord/benchmark"
    title: "Benchmark pages against pgvector, pgvectorscale, and Elasticsearch"
  - id: vchord-bm25
    resource: "https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/bm25/getting-started/overview.md"
    title: "Native Okapi BM25 and Block-WeakAnd top-k search"
  - id: vchord-tokenizer
    resource: "https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/tokenizer/overview.md"
    title: "Tokenizer pipeline, analyzers, stemmers, and multilingual models"
  - id: vchord-license
    resource: "https://github.com/pgsty/vchord/blob/1.5.0/LICENSE"
    title: "AGPL-3.0-only license of the PGSTY vchord fork"
  - id: pgvector-readme
    resource: "https://github.com/pgvector/pgvector/blob/v0.8.6/README.md"
    title: "Dimensionless vector storage, per-model expression and partial indexes, iterative scans"
---

# VectorChord

VectorChord is a PostgreSQL extension for vector similarity search and the
successor to pgvecto.rs.[^vchord-pgxn-110] It depends on pgvector, including the
`vector` representation and the distance operators, so adopting it adds an
extension beside one llame already requires.[^vchord-pgxn-110] The original
project is TensorChord's, and the current PGSTY repository is a
community-maintained fork of it.[^vchord-attribution] vchord 1.2.0 was the first
release under that fork.[^vchord-release-index]

**Index access methods.** `vchordrq` partitions the vector space into Voronoi
lists through a hierarchical centroid tree, searches only the lists closest to
the query vector, and stores compressed vectors with RaBitQ compression and
reranking.[^vchord-indexing][^vchord-pgxn-110] `vchordg` is a disk-based graph
index with low memory consumption.[^vchord-graph-index] Operator classes cover
`vector`, `halfvec`, and the `rabitq8` and `rabitq4` types, each with L2, inner
product, and cosine distance.[^vchord-indexing] The `rabitq8` and `rabitq4`
classes arrive in 1.1.0, and MaxSim classes over `vector[]` and `halfvec[]`
arrive in 0.3.0.[^vchord-indexing] A build below 100,000 rows usually needs no
index options. The documented guidance sets `build.internal.lists` from the row
count and `vchordrq.probes` from the chosen `lists`.[^vchord-indexing]

**Filtering.** A filtered scan without prefiltering over-fetches. The index
returns rows in distance order and PostgreSQL discards non-matching ones, so a
10-row `LIMIT` at 1 percent selectivity can require about 970 index rows. The
`vchordrq.prefilter` GUC, present since 0.4.0 and off by default, evaluates an
eligible filter before distance computation and prunes the search space. The
vendor recommends it only for filters that are strict and cheap, and reports
about a 200 percent QPS gain at 1 percent selectivity against 5 percent at 10
percent.[^vchord-prefilter] `vchordg` does not support prefilter.[^vchord-prefilter]
With prefilter on, eligible non-volatile `EXISTS` and `IN (SELECT ...)` subplans
run before reranking, and PostgreSQL itself evaluates subplans that carry
aggregates or volatile functions.[^vchord-prefilter]

Version 1.2.0 makes `vchordrq` planner cost estimation account for the `LIMIT`,
filter selectivity, and the active probes budget.[^vchord-prefilter] In version
1.5.0, an RQ index with filter keys streams candidates from its initial IVF
lists, stops once the `LIMIT` is satisfied, and can return a closer row in a
later round, up to `vchordrq.max_probes`. An application that needs a total
order therefore over-fetches and sorts its own result.[^vchord-release-150]

**Maintenance.** 1.5.0 pairs graph insertion's extended vector page and its
incoming link in one WAL record, lets graph VACUUM follow a deleted bridge to a
live region with spare neighbor slots, returns retired pages after publishing
each list during online RQ VACUUM, and divides keyed RQ compaction sort memory
across launched workers.[^vchord-release-150] The same release states that an
older graph VACUUM could disconnect a live region and requires a
`REINDEX INDEX CONCURRENTLY` for an index built that way. These are correctness
and repair mechanics for a mutation-heavy corpus. For a continuously rewritten
table, index maintenance is part of the design rather than an operational
afterthought.

**Dimension requirement.** The documented indexing examples for both extensions
declare `vector(n)`, and pgvector's own guidance for a dimensionless `vector`
column is an expression index over a cast to `vector(n)`, guarded by a partial
predicate on the model column, with the same cast in the query.[^pgvector-readme]
llame stores its embedding column without a dimension, so any index becomes a
per-model expression and partial index, or a migration to a dimensioned column.
Both shapes hard-code a dimension that the operator currently declares in the
configuration at runtime.

**License and distribution.** The upstream 1.1.0 release is dual-licensed under
AGPLv3 and the Elastic License v2.[^vchord-pgxn-110] The PGSTY fork is
AGPL-3.0-only.[^vchord-license] A self-hoster installs the extension into each
PostgreSQL deployment, per major version and architecture, and 1.5.0 ships for
PostgreSQL 15 through 19 on x86_64 and aarch64.[^vchord-release-150] llame's own
Postgres image provisions pgvector and `pg_trgm` only, so adoption adds an
extension to every installation.

**Vendor performance claims.** The 1.1.0 README reports up to 5 times the query
throughput, 16 times the insert throughput, and 16 times faster index build
against pgvector HNSW, plus 35 ms P50 latency at recall@95 over 100 million
768-dimensional vectors in 32 GB of memory.[^vchord-pgxn-110] These are vendor
measurements with the vendor's tuning, and this inspection did not reproduce
them. The documentation also publishes benchmarks against pgvector,
pgvectorscale, and Elasticsearch.[^vchord-benchmarks]

**Applicability to llame.** The vector leg is an exact cosine scan over
`search_chat_documents` inside one CTE, with predicates for the owner scope,
`vector_dims` equality, the active model key, the embedded content hash, and the
input version (`apps/api/src/search/core/fusion.ts`). Its results fuse with the
lexical legs by rank, never by raw score. Three consequences follow.

First, an ANN index changes latency only, and it can only lower recall on its
own leg. Rank fusion dilutes that loss, but a candidate that never enters the leg
contributes nothing to fuse.

Second, the corpus is one owner's chat chunks, and embeddings default off. Exact
scan cost grows with the owner's chunk count, and a corpus in the low hundreds of
thousands of chunks stays a sequential pass over a projection column.

Third, the projection is rewritten in place: a synchronous rebuild at assistant
finalization, an asynchronous reindex queue, fork sweeps, and operator backfill,
prune, and retry commands. Index maintenance runs against that churn, and several
recent vchord releases are correctness and repair fixes.[^vchord-release-index]

Prefiltering is the mechanism that matches owner-scoped search, because the
owner predicate is the filter. It is also the mechanism pgvector now covers with
iterative index scans, which extend an approximate scan until enough rows match
or the scan bound is reached.[^pgvector-readme] That keeps the escalation order
inside one extension.

**Decision.** This note recommends no adoption now, and it records the ladder
instead: exact scan, then pgvector HNSW or `halfvec` with iterative index scans,
then VectorChord where memory or I/O at large scale justifies a second extension.
[The implementation review](../chat-search/2026-08-25-episodic-memory-implementation-review.md)
reaches the same position for partial ANN indexes and names the latency gate.

Revisit conditions: a measured vector-leg latency gate is breached, an owner's
chunk count or a shared corpus passes a few hundred thousand chunks, or a second
embedded corpus ships. The instance config anticipates that second corpus, since
`search` holds one corpus key and a knowledge key would join it rather than
change its shape.

**Sibling extensions.** `vchord_bm25` provides an Okapi BM25 index with
Block-WeakAnd top-k search, and `pg_tokenizer` provides analyzers, stemmers, and
multilingual tokenization.[^vchord-bm25][^vchord-tokenizer] llame's FTS uses the
language-neutral `simple` configuration and covers its gaps with trigram matching
and embeddings. A stemmed BM25 index is the more interesting upgrade for a
Russian, English, and Spanish corpus, and it carries the same licensing and
packaging objections. It deserves a separate decision and a retrieval-quality
measurement, not a swap.

**This inspection.** Documentation, release notes, the pgvector README, and the
llame source paths named above were read for this note. Nothing was installed,
built, benchmarked, or queried, and no recall or latency figure here is local.

[^vchord-pgxn-110]: [vchord 1.1.0 README](https://pgxn.org/dist/vchord/1.1.0/)

[^vchord-attribution]: [Attribution and provenance](https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/about/attribution.md)

[^vchord-indexing]: [Indexing](https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/vchord/usage/indexing.md)

[^vchord-prefilter]: [Prefilter](https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/vchord/usage/prefilter.md)

[^vchord-graph-index]: [Graph index](https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/vchord/usage/graph-index.md)

[^vchord-release-150]: [vchord 1.5.0 release notes](https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/blog/release/vchord-1.5.0.md)

[^vchord-release-index]: [Release index](https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/blog/release/_index.md)

[^vchord-benchmarks]: [Benchmark pages](https://github.com/pgsty/vchord.pgsty.com/tree/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/vchord/benchmark)

[^vchord-bm25]: [BM25 overview](https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/bm25/getting-started/overview.md)

[^vchord-tokenizer]: [Tokenizer overview](https://github.com/pgsty/vchord.pgsty.com/blob/f75624b44a722e7d3c592ec8ea6cdd398a7b0024/content/docs/tokenizer/overview.md)

[^vchord-license]: [vchord 1.5.0 LICENSE](https://github.com/pgsty/vchord/blob/1.5.0/LICENSE)

[^pgvector-readme]: [pgvector README](https://github.com/pgvector/pgvector/blob/v0.8.6/README.md)

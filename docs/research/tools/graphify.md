---
type: Reference
title: "Graphify"
description: "Local code and document knowledge-graph extraction and query tooling"
resource: "https://github.com/Graphify-Labs/graphify"
observed:
  date: "2026-09-11"
  revision: "23f2ffaa43fd12f25d9eabe91e6d184b5d89b474"
sources:
  - id: readme-md-l30-l34
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/README.md#L30-L34"
    title: "local graph extraction and confidence claims"
  - id: architecture-md-l3-l34
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/ARCHITECTURE.md#L3-L34"
    title: "pipeline and module boundaries"
  - id: architecture-md-l50-l73
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/ARCHITECTURE.md#L50-L73"
    title: "graph schema and confidence labels"
  - id: readme-md-l432-l454
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/README.md#L432-L454"
    title: "committed graph output and rebuild workflow"
  - id: cache-py-l964-l997
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/cache.py#L964-L997"
    title: "content-hash and prompt-fingerprint cache"
  - id: serve-py-l1693-l1846
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/serve.py#L1693-L1846"
    title: "MCP graph query tools and project selection"
  - id: serve-py-l1693-l1713
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/serve.py#L1693-L1713"
    title: "MCP query schema bounds"
  - id: serve-py-l1848-l1876
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/serve.py#L1848-L1876"
    title: "bounded query execution and local query logging"
  - id: llm-py-l478-l507
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/llm.py#L478-L507"
    title: "semantic extraction schema and inference labels"
  - id: llm-py-l582-l603
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/llm.py#L582-L603"
    title: "hash-stamped untrusted source blocks"
  - id: readme-md-l562-l569
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/README.md#L562-L569"
    title: "privacy and provider routing"
  - id: security-md-l23-l49
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/SECURITY.md#L23-L49"
    title: "local-tool security model and limits"
  - id: serve-py-l2380-l2400
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/serve.py#L2380-L2400"
    title: "HTTP transport authentication boundary"
  - id: pyproject-toml-l5-l12
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/pyproject.toml#L5-L12"
    title: "Python stack and package license"
  - id: notice-l1-l6
    resource: "https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/NOTICE#L1-L6"
    title: "Apache license and retained MIT portions"
---

# Graphify

- **Classification:** Focused knowledge-graph tooling and an agent skill, not a
  harness. The skill invokes a Python library whose pipeline writes a local graph
  and exposes query tools over MCP; it does not own Chat/Run identity, execution
  lifecycle, durable run provenance, or tenant authorization.[^architecture-md-l3-l34]
- **Stack:** Python >=3.10, NetworkX, tree-sitter, and optional MCP, database,
  document, media, and provider extras. The package metadata declares Apache-2.0;
  `NOTICE` says earlier contributions remain available under MIT.[^pyproject-toml-l5-l12][^notice-l1-l6]
- **Decision:** Include as a focused noncanonical reference with moderate
  confidence. It adds concrete graph projection and query contracts beyond the
  existing gbrain and agent-memory notes. Knowledge graphs remain deferred in
  llame; this note does not imply Graphify integration or a change to llame's
  current Knowledge source-of-truth contract.

**Study**

F64 — **Separate source facts from model inference.** Code extraction is a local
tree-sitter pass, while documents, PDFs, and images can use a semantic model;
video/audio transcription is local.[^readme-md-l30-l34][^readme-md-l562-l569] The graph schema stores `source_file` and
`source_location` on nodes and edges, and labels edges `EXTRACTED`, `INFERRED`,
or `AMBIGUOUS`; the semantic prompt defines `EXTRACTED` as explicit source
evidence and `INFERRED` as a deduction.[^architecture-md-l50-l73][^llm-py-l478-l507]
This is the useful delta over ordinary memory retrieval: a future llame graph
projection could preserve source locations and make inferred relationships
visibly weaker than source-backed relationships. The labels are evidence about
the extraction, not authorization or truth; llame would still need owner-scoped
access, immutable Run context, and its own citation/provenance contract.

F65 — **Treat the graph as rebuildable derived state with bounded reads.**
Graphify writes `graphify-out/graph.json`, recommends committing the output, and
rebuilds on commit or branch switch while warning that background rebuilds can
lag the source by seconds.[^readme-md-l432-l454] Its per-file cache is keyed by
content SHA-256 and semantic entries can be namespaced by prompt fingerprint;
changed files miss the cache. Its default `allow_legacy` fallback can reuse
semantic entries whose prompt version is unknown, so prompt fingerprinting is
not an unconditional provenance guarantee.[^cache-py-l964-l997] The MCP query accepts BFS/DFS,
caps traversal depth at six, and passes an explicit output token budget to the
renderer.[^serve-py-l1693-l1713][^serve-py-l1848-l1876] The caller selects that
budget; this wrapper does not enforce a code-owned upper bound. llame would
need its own maximum rather than trusting caller input. These are useful patterns
for a later llame graph projection over owner-bound Knowledge: rebuild from
current files, cache extraction work, and bound traversal/context. A content hash
is cache freshness evidence only; it is not a stable Git revision, accepted
Knowledge snapshot, or owner authorization receipt.

F66 — **Keep corpus text untrusted and make provider movement explicit.** The
semantic pass wraps each file in a hash-stamped `<untrusted_source>` block and
neutralizes known prompt-control sentinels before sending it to a model.[^llm-py-l582-l603]
Code and local transcription can stay on the host, but documents, PDFs, and
images are sent to the selected assistant/provider; provider choice is partly
automatic unless the operator pins it.[^readme-md-l562-l569] This supports llame's
model-input rule for retrieved Knowledge: graph labels, rationales, and inferred
edges must enter the model as bounded untrusted data. Graphify still provides no
llame-style owner/Run receipt linking a graph answer to an authorized source
read, and its prompt-injection framing remains a model-side defense.

F67 — **MCP serving is a shared process boundary, not tenant isolation.** The
server exposes graph search, node/neighbor inspection, communities, paths, and
PR-impact tools; every tool can select a project directory containing a
`graphify-out/graph.json`.[^serve-py-l1693-l1846] Stdio is the default. HTTP
binds to loopback by default and can require one shared API key or Bearer token,
but OAuth and per-owner authorization are explicitly absent.[^serve-py-l2380-l2400][^security-md-l23-l49]
The local-tool model is suitable for a developer or operator-owned graph; a
llame adapter would have to resolve the authenticated Knowledge owner before
choosing a graph, prevent cross-owner `project_path` selection, and scrub or
translate host-relative source paths. Graphify's process and API-key boundary
cannot substitute for llame's RLS and Run-scoped isolation.

[^readme-md-l30-l34]: [local graph extraction and confidence claims](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/README.md#L30-L34)

[^architecture-md-l3-l34]: [pipeline and module boundaries](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/ARCHITECTURE.md#L3-L34)

[^pyproject-toml-l5-l12]: [Python stack and package license](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/pyproject.toml#L5-L12)

[^notice-l1-l6]: [Apache license and retained MIT portions](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/NOTICE#L1-L6)

[^architecture-md-l50-l73]: [graph schema and confidence labels](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/ARCHITECTURE.md#L50-L73)

[^llm-py-l478-l507]: [semantic extraction schema and inference labels](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/llm.py#L478-L507)

[^readme-md-l432-l454]: [committed graph output and rebuild workflow](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/README.md#L432-L454)

[^cache-py-l964-l997]: [content-hash and prompt-fingerprint cache](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/cache.py#L964-L997)

[^serve-py-l1693-l1713]: [MCP query schema bounds](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/serve.py#L1693-L1713)

[^serve-py-l1848-l1876]: [bounded query execution and local query logging](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/serve.py#L1848-L1876)

[^llm-py-l582-l603]: [hash-stamped untrusted source blocks](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/llm.py#L582-L603)

[^readme-md-l562-l569]: [privacy and provider routing](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/README.md#L562-L569)

[^serve-py-l1693-l1846]: [MCP graph query tools and project selection](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/serve.py#L1693-L1846)

[^serve-py-l2380-l2400]: [HTTP transport authentication boundary](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/serve.py#L2380-L2400)

[^security-md-l23-l49]: [local-tool security model and limits](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/SECURITY.md#L23-L49)

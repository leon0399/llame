---
type: Reference
title: "XERJ"
description: "Local search engine with BM25, optional vectors, tree-sitter code records, and an MCP server. The default embedder is a lexical feature hash."
resource: "https://github.com/xerj-org/xerj/tree/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965"
tags: [code-search, bm25, embeddings, mcp, tree-sitter]
status: draft
observed:
  date: "2026-10-21"
  revision: "f6c5d40cdceba4ff14e5fae882d3d8df62d3d965"
sources:
  - id: xerj-readme
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/README.md#L3-L29"
    title: "Local engine, BM25, vectors, and the default lexical embedder"
  - id: xerj-claim
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/README.md#L96-L114"
    title: "README reference-coding token table"
  - id: xerj-summary
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/docs/case-studies/reference-coding/SUMMARY.md#L1-L53"
    title: "Case-study method and honesty notes"
  - id: xerj-code-extract
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/extract/code.rs#L1-L33"
    title: "File document, per-declaration documents, 2 MiB cap"
  - id: xerj-langs
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/extract/code.rs#L108-L316"
    title: "Tree-sitter language registry"
  - id: xerj-sections
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/extract/mod.rs#L93-L120"
    title: "2 KiB prose sections with 200-character overlap"
  - id: xerj-passages
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-engine/src/code_blocks.rs#L1-L66"
    title: "Response-time syntactic passage widening and the tree cache"
  - id: xerj-passage-langs
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-engine/src/code_blocks.rs#L194-L217"
    title: "Languages that receive syntactic widening"
  - id: xerj-bm25
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-fts/src/bm25.rs#L1-L29"
    title: "BM25 with k1 1.2 and b 0.75"
  - id: xerj-embedder
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-ai/src/embedder.rs#L1-L26"
    title: "Lexical, proxy, neural, and ONNX backends"
  - id: xerj-hash
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-ai/src/local.rs#L1-L33"
    title: "Feature-hash embedder, FNV-1a, 384 dimensions, offline"
  - id: xerj-embed-config
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-common/src/config.rs#L1589-L1627"
    title: "Embedding mode, MiniLM default, and local model directory"
  - id: xerj-storage
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-storage/src/lib.rs#L1-L14"
    title: "WAL plus .seg and .sidx segments"
  - id: xerj-digest
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/content.rs#L34-L68"
    title: "Full-content digests decide what a re-run may skip"
  - id: xerj-xxh
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/content.rs#L222-L234"
    title: "xxh3-128 digest with size"
  - id: xerj-watch
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/watch.rs#L1-L37"
    title: "Watch mode skip rules and the mtime hole"
  - id: xerj-resume
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/cli.rs#L597-L611"
    title: "Generation resume and what --fresh does not delete"
  - id: xerj-def
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/def.rs#L1-L12"
    title: "One path:line plus the declaration per hit"
  - id: xerj-def-print
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/def.rs#L524-L553"
    title: "Printer writes path:line, symbol kind, and the declaration"
  - id: xerj-search
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/search.rs#L1-L31"
    title: "xerj search is a lexical passage client"
  - id: xerj-embed-auto
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-server/src/main.rs#L341"
    title: "auto uses a proxy endpoint when one is set"
  - id: xerj-embed-proxy
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-server/src/main.rs#L893-L901"
    title: "proxy without an endpoint fails startup"
  - id: xerj-search-mode
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/search.rs#L71-L85"
    title: "xerj search refuses --mode"
  - id: xerj-code
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/xc.rs#L114-L135"
    title: "xerj code modes and the lexical-embedding warning"
  - id: xerj-mcp
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-mcp/src/lib.rs#L1-L97"
    title: "MCP tools, hybrid fusion, rerank, and token budgets"
  - id: xerj-mcp-budget
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-mcp/src/lib.rs#L686-L689"
    title: "Five search tools share max_tokens"
  - id: xerj-rerank
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-rerank/src/lib.rs#L1-L22"
    title: "Optional calibrated rerank after retrieval"
  - id: xerj-judge
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-rerank/src/judge.rs#L1-L39"
    title: "Local judge adds a separate probability and can be lexical"
  - id: xerj-license
    resource: "https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/LICENSE#L1-L3"
    title: "Apache-2.0 license"
  - id: cli-runs
    resource: "./probes/cli-runs.json"
    title: "CLI runs from this inspection"
---

# XERJ

XERJ is a Rust search engine and MCP server. One binary indexes a folder for
BM25, vector and hybrid search, code search, and agent memory, and speaks an
Elasticsearch-compatible API. The README's default-embedder badge says the
default is lexical and offline. A neural embedder is opt-in.[^xerj-readme]

**Search.** `xerj autoindex` sniffs files and writes one index per inferred
dataset. Code files become a file-level document (`language`, `symbols`,
`defs`, full `body`) plus one document per declaration (`name`, `kind`,
`line`, `code`) under a `code:<line>:<name>` locator. A grammar failure
indexes the file as plain text. Full-text ranking is BM25 with Elasticsearch's
constants, k1 1.2 and b 0.75. `xerj search` always sends a lexical
`multi_match` biased toward definitions and refuses `--mode`. `xerj code`
accepts `bm25` (default), `semantic`, and `hybrid`. Its usage text says
`semantic` and `hybrid` embed with the lexical feature hash unless the node
was started with `--embed-mode neural`. It can fuse file-level
BM25 with symbol-implementation BM25 by RRF with k 60. Hybrid queries in the
engine accept fusion `rrf` and `linear`. The query parser rejects `learned`.
Optional hosted rerank runs after hits are hydrated, replaces `_score` with a
probability, and is a separate crate so the segment loop stays local. A local
`judge` stage can add `_p_relevant` without replacing `_score`. With no local
decision model that value is page-local BM25 saturation on 0–1, labeled
`lexical`. The MCP description says
rerank quality with a real provider model has not been verified by the
project.[^xerj-code-extract][^xerj-bm25][^xerj-search][^xerj-code][^xerj-mcp][^xerj-rerank][^xerj-judge]

**Chunking.** Prose sections target 2,048 characters with a 200-character
overlap, chosen so a section fits the 512-token neural embedder and so a 32
KiB section does not dilute BM25. A file may emit at most 4,096 section
records. Code files keep the full source in `body` up to a 2 MiB cap; larger
files are skipped as generated. Declarations are their own small records.
At response time, `_passage` can widen a hit to the smallest enclosing
function, method, or class, capped by default at 16,384 bytes, with an
in-process tree cache of 128 documents. That widening is implemented for
python, javascript, typescript, tsx, rust, go, java, c, cpp, ruby, php,
csharp, and bash. Any other language falls back to the caller's window. The
widening comment says a 512-character index-time chunk is the semantic-hit
window and a line-snapped query-time window is the lexical-hit
window.[^xerj-sections][^xerj-code-extract][^xerj-passages][^xerj-passage-langs]

**Storage and updates.** Segments are two files, `.seg` and `.sidx`, read with
`mmap`. Durability is a write-ahead log. A plain autoindex hashes every file:
size and mtime are not treated as proof of byte identity. The digest is
xxh3-128 plus size (`axf2-…`). A re-run may carry a digest forward only when
the caller can prove it still matches the current bytes; a stale carried
digest looks like "unchanged". `--watch` keeps that digest cache in memory
for one process. A file may skip re-hashing only when no event named it or an
ancestor and its size, mtime, and inode still match. The cache is not
persisted, so a restart re-hashes. A write that produces no event and leaves
size, mtime, and inode unchanged is invisible until something else touches
the file. A plain autoindex re-run hashes the tree and repairs that hole. Help text for a pre-generation journal says files added after a
frozen plan are skipped, and removing an indexed file is refused because
nothing on that path deletes live documents. `--fresh` does not remove stale
destination records.[^xerj-storage][^xerj-digest][^xerj-xxh][^xerj-watch][^xerj-resume]

**Model and locality.** `Embedder::Lexical` is the zero-dependency default: a
deterministic FNV-1a feature hash of word unigrams and character trigrams,
L2-normalized, 384 dimensions, no weights and no network. The module states
that this captures lexical overlap. `auto` uses an OpenAI-compatible
`/v1/embeddings` proxy when `default_endpoint` is set, and otherwise lexical.
`proxy` with a missing endpoint fails startup.[^xerj-embed-auto][^xerj-embed-proxy] `neural` loads
`sentence-transformers/all-MiniLM-L6-v2` through candle, downloading into the
Hugging Face cache unless `local_model_dir` is set. `onnx-experimental` loads
a local FP32 MiniLM-compatible ONNX model and tokenizer that the operator
supplies; the binary must be built with that feature. Ingest and query use
the same backend. The default path works offline. Neural quality requires a
download or a local model directory. Proxy embeddings and rerank send text to
whatever endpoint the operator configured.[^xerj-embedder][^xerj-hash][^xerj-embed-config][^xerj-rerank]

**Interface and model-facing output.** `xerj search` prints ranked passages
with `file:line`, a score, and clipped text (default 600 characters, five
hits). `xerj def` prints one `path:line` and the declaration per hit, tagged
with the symbol kind. `xerj code` adds `--json` and `--meatl` (one line per
hit). `xerj mcp` is stdio JSON-RPC. Search tools include `xerj_search`,
`xerj_semantic_search`,
`xerj_vector_search`, `xerj_hybrid_search`, and `xerj_code_search`. Those five
search tools accept `max_tokens` and dedupe overlapping `file:line` passages
before budgeting.
Unfiltered kNN is described as HNSW with exact rescoring; filtered kNN and
other ineligible shapes run an exact scan. The server proxies the engine and adds no ranking
of its own. `--insecure` disables TLS and API-key auth on a loopback
bind.[^xerj-search][^xerj-def][^xerj-def-print][^xerj-search-mode][^xerj-code][^xerj-mcp][^xerj-mcp-budget][^xerj-readme]

**Performance claims.** The README table reports 16/16 solves for a grep-driven Claude Code arm and a
XERJ arm, with output tokens 26,477 versus 9,982 and cost $3.27 versus $1.58
(2.7× fewer output tokens for XERJ). The README calls that table 8 tasks, 4
languages, and 16 runs per arm. The case-study summary uses the same token
pair and calls the slice five languages and 16 runs. Memory-only solved 11/16.
The summary's unfamiliar-contract
slice reports 21/21 for native and XERJ versus 1/21 from memory, at 1.5× fewer
output tokens than native. The same summary says the libraries are synthetic,
the native-versus-XERJ gap was measured on small references, a large private
corpus is untested, and neural-embedder queries are untested because the
shipped embedder is lexical. A server-uplift experiment in that summary found
no improvement on realistic queries for richer symbols. This inspection did
not rerun the case study.[^xerj-claim][^xerj-summary]

**Languages.** The autoindex registry names 37 grammars: python, javascript,
typescript, tsx, rust, go, java, c, cpp, ruby, php, csharp, bash, kotlin,
swift, scala, dart, lua, perl, r, julia, haskell, elixir, erlang, ocaml,
ocaml_interface, zig, objc, groovy, powershell, fsharp, nix, fortran, matlab,
solidity, clojure, and scheme. Shared extensions use a content probe
(Objective-C versus MATLAB on `.m`). Prose, logs, CSV, JSON, PDF, and other
sniffed types are indexed by their own extractors. Syntactic passage widening
covers the thirteen language tags listed above.[^xerj-langs][^xerj-passage-langs]

**License.** Apache-2.0.[^xerj-license]

**This inspection.** The executed binary is GitHub release `v1.0.0-rc.97`
(tag commit `e6216b6597ca11b816caa4e3e0ca2ffdf73d9a2b`), which is older than
this note's source pin. `xerj code` and `xerj search` help text on that binary
matched the usage strings read at the pin. The binary was not rebuilt from
`f6c5d40`. Against a loopback `--insecure` node it indexed
`docs/research/tools` as 11 prose files and 44 records, reported the embedding
backend as lexical, and on a second run submitted 0 records. Indexing
`apps/api/src/tools/web-search` required a distinct `--prefix` because the
default prefix already held `ax-docs`. That run indexed 27 code files and 282
records. `xerj search executeSearchChain --prefix ws` returned `chain.ts:267`
with the function signature. `xerj def` listed symbol kinds including
function, class, method, and type. `xerj search --mode semantic` was refused.
These runs check the CLI contract. They are not a quality
benchmark.[^cli-runs]

[^xerj-readme]: [Local engine, BM25, vectors, and the default lexical embedder](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/README.md#L3-L29)

[^xerj-claim]: [README reference-coding token table](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/README.md#L96-L114)

[^xerj-summary]: [Case-study method and honesty notes](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/docs/case-studies/reference-coding/SUMMARY.md#L1-L53)

[^xerj-code-extract]: [File document, per-declaration documents, 2 MiB cap](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/extract/code.rs#L1-L33)

[^xerj-langs]: [Tree-sitter language registry](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/extract/code.rs#L108-L316)

[^xerj-sections]: [2 KiB prose sections with 200-character overlap](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/extract/mod.rs#L93-L120)

[^xerj-passages]: [Response-time syntactic passage widening and the tree cache](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-engine/src/code_blocks.rs#L1-L66)

[^xerj-passage-langs]: [Languages that receive syntactic widening](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-engine/src/code_blocks.rs#L194-L217)

[^xerj-bm25]: [BM25 with k1 1.2 and b 0.75](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-fts/src/bm25.rs#L1-L29)

[^xerj-embedder]: [Lexical, proxy, neural, and ONNX backends](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-ai/src/embedder.rs#L1-L26)

[^xerj-hash]: [Feature-hash embedder, FNV-1a, 384 dimensions, offline](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-ai/src/local.rs#L1-L33)

[^xerj-embed-config]: [Embedding mode, MiniLM default, and local model directory](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-common/src/config.rs#L1589-L1627)

[^xerj-embed-auto]: [auto uses a proxy endpoint when one is set](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-server/src/main.rs#L341)

[^xerj-embed-proxy]: [proxy without an endpoint fails startup](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-server/src/main.rs#L893-L901)

[^xerj-storage]: [WAL plus .seg and .sidx segments](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-storage/src/lib.rs#L1-L14)

[^xerj-digest]: [Full-content digests decide what a re-run may skip](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/content.rs#L34-L68)

[^xerj-xxh]: [xxh3-128 digest with size](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/content.rs#L222-L234)

[^xerj-watch]: [Watch mode skip rules and the mtime hole](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/watch.rs#L1-L37)

[^xerj-resume]: [Generation resume and what --fresh does not delete](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/cli.rs#L597-L611)

[^xerj-def]: [One path:line plus the declaration per hit](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/def.rs#L1-L12)

[^xerj-def-print]: [Printer writes path:line, symbol kind, and the declaration](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/def.rs#L524-L553)

[^xerj-search]: [xerj search is a lexical passage client](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/search.rs#L1-L31)

[^xerj-search-mode]: [xerj search refuses --mode](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/search.rs#L71-L85)

[^xerj-code]: [xerj code modes and the lexical-embedding warning](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-autoindex/src/xc.rs#L114-L135)

[^xerj-mcp]: [MCP tools, hybrid fusion, rerank, and token budgets](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-mcp/src/lib.rs#L1-L97)

[^xerj-mcp-budget]: [Five search tools share max_tokens](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-mcp/src/lib.rs#L686-L689)

[^xerj-rerank]: [Optional calibrated rerank after retrieval](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-rerank/src/lib.rs#L1-L22)

[^xerj-judge]: [Local judge adds a separate probability and can be lexical](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/engine/crates/xerj-rerank/src/judge.rs#L1-L39)

[^xerj-license]: [Apache-2.0 license](https://github.com/xerj-org/xerj/blob/f6c5d40cdceba4ff14e5fae882d3d8df62d3d965/LICENSE#L1-L3)

[^cli-runs]: [CLI runs from this inspection](./probes/cli-runs.json)

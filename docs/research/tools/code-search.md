---
type: Reference
title: "Code search"
description: "Compares four source-search tools and lists mechanisms worth studying for a future llame semantic search tool, without treating that tool as decided."
tags: [code-search, semantic-search, prior-art, knowledge]
status: draft
observed:
  date: "2026-10-21"
sources:
  - id: jevgrep
    resource: "./jevgrep.md"
    title: "jevgrep"
  - id: xerj
    resource: "./xerj.md"
    title: "XERJ"
  - id: jegrep
    resource: "./jegrep.md"
    title: "jegrep"
  - id: omp-find
    resource: "./oh-my-pi-find.md"
    title: "oh-my-pi find"
  - id: vision-projections
    resource: "../../../VISION.md#L49-L73"
    title: "Knowledge is canonical; indexes are projections"
  - id: vision-deferrals
    resource: "../../../VISION.md#L332-L341"
    title: "Deferred semantic facts and bundled local inference"
  - id: spec-knowledge
    resource: "../../../SPEC.md#L375-L379"
    title: "No Knowledge index ships"
  - id: spec-chat
    resource: "../../../SPEC.md#L400-L402"
    title: "Shipped hybrid chat search"
  - id: chat-search-spec
    resource: "../../../openspec/specs/chat-search/spec.md#L49-L51"
    title: "Vector leg identity filter; scores withheld from responses"
  - id: roadmap-milestone
    resource: "../../../ROADMAP.md#L114-L116"
    title: "Current milestone excludes embeddings and semantic facts"
  - id: chat-search
    resource: "../chat-search/index.md"
    title: "Chat-search research, a different corpus"
  - id: prior-study
    resource: "../tool-harness/2026-09-24-semantic-find-judge/index.md"
    title: "Semantic find and JUDGE study"
---

# Code search

[jevgrep](./jevgrep.md), [XERJ](./xerj.md), [jegrep](./jegrep.md), and
[oh-my-pi `find`](./oh-my-pi-find.md) are prior art for searching source by
meaning.[^jevgrep][^xerj][^jegrep][^omp-find] All four GitHub repositories
exist, and oh-my-pi's `docs/tools/find.md` is the semantic find page.
`crates/pi-builtins/src/find.rs` in that repository is a POSIX `find` and is a
different program. llame does
not ship a source semantic-search tool. Personal Knowledge reads the current
files and has no Knowledge index or embedding
projection.[^spec-knowledge] Hybrid search that does ship is conversation
search: full-text, trigram, and an optional cosine leg fused by reciprocal
rank fusion, with silent lexical fallback.[^spec-chat] That work and the
[chat-search notes](../chat-search/index.md) cover a different
corpus.[^chat-search]
[VISION.md](../../../VISION.md) keeps Markdown Knowledge canonical and treats
indexes and embeddings as rebuildable projections. Semantic facts and a
bundled local inference runtime stay deferred. The current roadmap milestone
excludes embeddings and semantic facts.[^vision-projections][^vision-deferrals][^roadmap-milestone]

Failure, coverage, and benchmark limits for the cascade are in the
[semantic find study](../tool-harness/2026-09-24-semantic-find-judge/index.md).
Published quality numbers in the tool notes stay author-reported. This
comparison does not re-run those probes.[^prior-study]

## Four mechanisms

|                             | jevgrep                                              | jegrep                                | oh-my-pi find                                            | XERJ                                                                                                            |
| --------------------------- | ---------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Persistent repository index | No. Seven-day answer cache.                          | No. Per-run keyword map.              | No repository index. SQLite judgment cache.              | Yes. WAL, `.seg`, `.sidx`.                                                                                      |
| Lexical stage               | No lexical rank. Jev navigation.                     | In-memory grep rank.                  | Same cascade as jegrep.                                  | BM25. `xerj search` is lexical only.                                                                            |
| Structure                   | Tree-sitter or TypeScript parser for four languages. | Text windows.                         | Text windows.                                            | Tree-sitter symbols for 37 grammars; syntactic widening for 13.                                                 |
| Embeddings                  | None.                                                | None.                                 | None.                                                    | Default feature hash, offline. Neural MiniLM, ONNX, or an OpenAI-compatible proxy are opt-in.                   |
| Rerank                      | The Jev judgment is the rank.                        | Jev probability on verified passages. | Same, via the `judge` role.                              | Hosted rerank replaces the score. Local judge can add `_p_relevant`. Quality of the hosted model is unverified. |
| Freshness                   | 3s snapshot gate. Answer key includes judged state.  | Next run reads the tree.              | Next call reads the tree. Cache hits on identical state. | xxh3 digests. Watch skip is in-memory.                                                                          |
| Model                       | Hosted Jev, or a custom TypeSafe-compatible URL.     | Hosted Jev, or a local server.        | Session judge. `auto` requires a native judgment API.    | Optional. Default search needs no model.                                                                        |
| Interface                   | `jg` CLI and a skill.                                | `jegrep` CLI.                         | Agent tool `find` and `omp find`.                        | CLI, Elasticsearch-compatible API, MCP.                                                                         |
| License                     | MIT                                                  | MIT                                   | MIT                                                      | Apache-2.0                                                                                                      |

## What the output is for a model

All four return locations and source text. None of the inspected search paths
returns a generated explanation as the search result.

jevgrep leads with a file list and roles, then fenced verbatim blocks and
`name@start-end` declarations. jegrep's compact form is tab-separated path,
score, and spans, weakest first; JSON carries scores, ranges, and snippets.
oh-my-pi `find` is strongest-first, with up to three ranges, a coverage flag,
and an explicit unavailable error when every judge request fails. XERJ prints
`file:line` passages and, for code, a symbol kind. Its MCP search tools take a
token budget and dedupe overlapping passages.

Two output details are worth keeping apart. oh-my-pi's tool text says a total
judge failure is not evidence of absence and surfaces an error. Its CLI prints
a shorter unavailable line and sets exit code 1. The jegrep binary built from
the inspected commit, pointed at a closed local port, printed `no hits` and
exited 0 after every judge request failed. jevgrep's judge-failure result was
not run. A future llame tool that borrows the cascade needs its own rule for
that case.[^omp-find][^jegrep][^jevgrep]

## Tradeoffs worth naming

**Live tree versus a projection.** jegrep, oh-my-pi `find`, and jevgrep have
no corpus index, so the next call reads files again. They stop after a budget,
so a completed call is not a proof that every relevant file was seen. jevgrep
keeps an in-search snapshot only when mtime and ctime are more than three
seconds before that read, and its answer cache hits when the request,
including judged state, matches. oh-my-pi can reuse a native judgment when the
state, model, and question match. jegrep does not keep a judgment cache. XERJ can answer from the index
without sending the corpus to a model, and a second autoindex of an unchanged
folder submitted no new records in the release binary this inspection ran.
That index can lag: watch mode's skip is in-memory, and a same-size rewrite
that restores mtime and inode and produces no event stays invisible until
something else touches the file. A hashing autoindex repairs it. VISION's rule
that current files are authoritative and that an index is derived state matches
the hashing design more closely than a metadata shortcut.[^vision-projections][^xerj][^jevgrep][^jegrep][^omp-find]

**Lexical first, model second.** jegrep and oh-my-pi spend judge calls on a
lexical shortlist and then on sketches, and they verify full passages before
emitting ranges. jevgrep spends judgments on navigation and declarations and
keeps an answer cache keyed by the request. XERJ can stop at BM25. Its CLI
says `semantic` and `hybrid` still use the feature hash unless the node was
started with `--embed-mode neural`. The embedder module calls that vector a
lexical feature hash.[^jevgrep][^jegrep][^omp-find][^xerj]

**Chunk shape follows the corpus.** Declaration units and per-symbol records
help when the question names a function. Fixed windows with overlap help prose
and languages without a grammar. XERJ does both, and it widens a hit to an
enclosing syntax node only for a listed subset of languages, with a byte cap.
jevgrep parses four languages and chunks the rest at 12,000 bytes. jegrep and
oh-my-pi use 8 KiB line-aligned windows and 384-byte sketches. llame Knowledge
is Markdown files, so a prose section is the nearer analog for that corpus. A
workspace code search is a separate corpus and is not specified
today.[^spec-knowledge][^xerj][^jevgrep][^jegrep]

**Where the bytes go.** Default jevgrep, jegrep, and oh-my-pi `find` send
source to a Jev endpoint. XERJ's default lexical path stays on the machine.
Its proxy embedder and reranker send text to the endpoint the operator
configured. The neural path downloads MiniLM unless `local_model_dir` is set.
VISION defers a bundled local inference runtime, so a design that needs model
weights has to name the operator-provided endpoint or local directory that
supplies them.[^vision-deferrals][^xerj]

**Scores.** Jev tools expose a probability and a threshold. XERJ's BM25
`_score` is a rank key. A local judge can add `_p_relevant` without replacing
it; with no local decision model that value is lexical saturation on 0–1. The
hosted reranker replaces `_score` with a probability, and the project says
that provider's quality is unverified. A score does not authorize a read and
does not prove the search was exhaustive. Shipped chat search may retain
per-leg ranks for logs and evaluation, and withholds raw cosine distance,
lexical rank, and the fused score from web and model
responses.[^prior-study][^chat-search-spec]

## What to study, not what to build

These are reading targets for a later proposal. They are not a selected
design, an OpenSpec change, or a claim that any published speed or recall
number transfers to llame.

1. Return verbatim spans with stable coordinates, and keep the generated
   answer in a later step that reads those spans under the existing
   permission check.
2. Distinguish "nothing matched", "the budget stopped the walk", and "the
   judge never answered". oh-my-pi's tool result says a total judge failure is
   not evidence of absence. jegrep's inspected binary printed `no hits` and
   exited 0. jevgrep's judge-failure path was not run.
3. If a projection is added, key it by content digest and model identity, and
   rebuild it. Chat search's vector leg ranks a document only when its recorded
   model key equals the corpus selection, its content hash equals the live
   content hash, and its input version equals the current embed-input version.
   Every other document contributes nothing to that leg. XERJ's xxh3 digest is
   the content-hash half of that rule, and it refuses to trust mtime
   alone.[^chat-search-spec][^xerj]
4. Keep a lexical leg that works with no model. XERJ's feature hash shows how
   easy it is to label a lexical vector "semantic". Any llame name for a
   vector leg should say which embedder produced it.
5. Bound model-facing output (hit count, bytes, and a coverage line). XERJ's
   MCP token budget and jevgrep's stdout cap are concrete shapes.
6. Treat AST support as a language list with a text fallback, and keep
   macro expansion and type resolution out of the first cut. None of these
   tools resolve types.
7. Leave published SWE-bench and reference-coding numbers in the tool notes
   as author-reported. The XERJ summary itself limits those numbers to
   synthetic libraries, a lexical embedder, and small references.

[^jevgrep]: [jevgrep](./jevgrep.md)

[^xerj]: [XERJ](./xerj.md)

[^jegrep]: [jegrep](./jegrep.md)

[^omp-find]: [oh-my-pi find](./oh-my-pi-find.md)

[^vision-projections]: [Knowledge is canonical; indexes are projections](../../../VISION.md#L49-L73)

[^vision-deferrals]: [Deferred semantic facts and bundled local inference](../../../VISION.md#L332-L341)

[^spec-knowledge]: [No Knowledge index ships](../../../SPEC.md#L375-L379)

[^spec-chat]: [Shipped hybrid chat search](../../../SPEC.md#L400-L402)

[^chat-search-spec]: [Vector leg identity filter; scores withheld from responses](../../../openspec/specs/chat-search/spec.md#L49-L51)

[^roadmap-milestone]: [Current milestone excludes embeddings and semantic facts](../../../ROADMAP.md#L114-L116)

[^chat-search]: [Chat-search research, a different corpus](../chat-search/index.md)

[^prior-study]: [Semantic find and JUDGE study](../tool-harness/2026-09-24-semantic-find-judge/index.md)

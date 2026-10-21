---
type: Reference
title: "jegrep"
description: "Live-tree semantic grep: an in-memory lexical rank, then Jev filename, sketch, and full-passage judgments, with no repository index."
resource: "https://github.com/can1357/jegrep/tree/197e674285eb321e2be4b5f6797d755af2c32c77"
tags: [code-search, jev, lexical, cli]
status: draft
observed:
  date: "2026-10-21"
  revision: "197e674285eb321e2be4b5f6797d755af2c32c77"
sources:
  - id: jegrep-readme
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/README.md#L12-L21"
    title: "No embeddings, no index, line-range output"
  - id: jegrep-providers
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/README.md#L49-L68"
    title: "Provider selection, failover, and --only"
  - id: jegrep-compact
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/README.md#L78-L106"
    title: "JSON and compact digests for agents"
  - id: jegrep-flags
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/README.md#L145-L173"
    title: "Default cascade and the flags it ignores"
  - id: jegrep-cascade
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/strategies/cascade.rs#L1-L13"
    title: "Sketch scores route; hits come from full passages"
  - id: jegrep-budgets
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/strategies/cascade.rs#L122-L184"
    title: "Lexical rank and default cascade budgets"
  - id: jegrep-grep
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/grep.rs#L1-L27"
    title: "Per-run keyword index, 4 MiB file cap"
  - id: jegrep-sketch
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/strategies/cascade.rs#L31-L83"
    title: "Sketch cutoff and verbatim sketch lines"
  - id: jegrep-seed
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/strategies/cascade.rs#L251-L255"
    title: "First two reads are the strongest lexical files"
  - id: jegrep-local
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/jev.rs#L13-L47"
    title: "Hosted endpoints and the unauthenticated local server"
  - id: jegrep-json
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/report.rs#L14-L38"
    title: "Compact rows: path, score, spans"
  - id: jegrep-json-body
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/report.rs#L70-L93"
    title: "JSON hit object"
  - id: jegrep-exit
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/main.rs#L292-L294"
    title: "A finished search prints and returns"
  - id: jegrep-walk-cache
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/walker/cache.rs#L1-L2"
    title: "In-process directory-walk cache"
  - id: jegrep-walk-ttl
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/walker/cache.rs#L118-L119"
    title: "One-second default walk-cache TTL"
  - id: jegrep-results
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/benches/RESULTS.md#L1-L59"
    title: "Author-reported cascade comparison"
  - id: jegrep-license
    resource: "https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/LICENSE#L1-L5"
    title: "MIT license"
  - id: prior-study
    resource: "../tool-harness/2026-09-24-semantic-find-judge/index.md"
    title: "Semantic find and JUDGE study"
  - id: cli-runs
    resource: "./probes/cli-runs.json"
    title: "CLI runs from this inspection"
---

# jegrep

jegrep is a Rust CLI for natural-language search of a live tree, and the
reference for [OMP's semantic `find`](../harnesses/oh-my-pi.md#semantic-find-and-jegrep).
The README states the product boundary in one line: no embeddings, no index,
no daemon. Each hit can carry original line ranges. The default model id is
`jev-latest`.[^jegrep-readme][^jegrep-flags]

**Search.** The default strategy is `cascade`. It builds a per-run keyword
index with grep-regex (case-insensitive, gitignore-aware, skip `.git` and
`node_modules`, never follow links). Files larger than 4 MiB are skipped by
that scan. Files are ranked by weighted keyword hits plus a path bonus. The
top 128 files receive a filename judgment. Up to 20 files are read (the two
strongest lexical candidates first), each up to 4 MiB, and cut into whole-line
windows of 8,192 bytes. Up to 24 windows per file are kept. Each window is
sketched to 384 bytes of verbatim keyword-dense lines. Sketches at or above
0.45 are verified as complete passages, at most 40 passages in the search.
The hit threshold is the last `-t` value, default 0.20. Sketch scores choose
what to verify. A reported range comes from a verified passage. Other
strategies remain selectable. `cascade` ignores `--bytes`, `--ranges`, and
`--min-hits`.[^jegrep-cascade][^jegrep-budgets][^jegrep-grep][^jegrep-sketch][^jegrep-seed][^jegrep-flags]

**Chunking.** Windows are byte-bounded and line-aligned. The sketch is a
budgeted subset of those lines, prefixed with original line numbers, ordered
back into source order. It is labeled a map of verbatim lines. There is no
tree-sitter or other AST pass in this program.[^jegrep-sketch][^jegrep-readme]

**Storage and updates.** Nothing is written as a repository index. The walker
keeps an in-process scan cache of directory entries, default TTL 1,000 ms via
`FS_SCAN_CACHE_TTL_MS`. It expires by time and by entry and byte caps. It does
not store judgments or file text. Every search reads the live tree. A file
edited between runs is visible on the next run because there is no durable
index to invalidate.[^jegrep-walk-cache][^jegrep-walk-ttl][^jegrep-readme]

**Model and locality.** Judgments are Jev noul probabilities over HTTP.
OpenRouter is `https://openrouter.ai/api/alpha/decisions` with
`OPENROUTER_API_KEY`. TypeSafe is `https://api.typesafe.ai/v1/systemone` with
`TYPESAFE_API_KEY`. The default prefers OpenRouter when that key exists and
fails over to the other hosted key on auth, credit, timeout, rate-limit,
5xx, transport, and invalid-response errors. `--only` refuses failover.
`--endpoint local` uses `JEGREP_ENDPOINT_URL` or
`http://127.0.0.1:8756/`, sends no `Authorization` header, and does not fail
over. The README prices Jev at $0.042 per million input tokens.[^jegrep-readme]
Weights are not bundled. Offline use requires a Jev-compatible server the
operator runs. This inspection did not run one that
answered.[^jegrep-local][^jegrep-providers]

**Interface and model-facing output.** The interface is the CLI. This checkout
has no MCP server. `--json` emits the query, root, rounds, threshold, hits,
and stats. Each hit has `path`, `name_score`, `content_score`, `confidence`,
`lines_seen`, `truncated`, and `ranges` of `start`, `end`, `p`, and `snippet`.
`--compact` prints a header, then tab-separated `path`, score, and up to three
`start-end` spans (or `?`), weakest row first, plus a `#` trailer with root,
judged count, files read, estimated dollars, and seconds. The human report
uses the same weakest-first order so the strongest hit sits next to the
prompt. `main` prints that report and returns; a search whose judge calls all
fail still takes that path.[^jegrep-compact][^jegrep-json][^jegrep-json-body][^jegrep-exit]

**Performance claims.** `benches/RESULTS.md` reports Cascade40 against the
window strategy on Postgres, CPython, and a held-out Kubernetes suite:
49/49 files and 93/94 regions across 30 queries, estimated API cost $0.145
versus $0.232 (37.5 percent less), with median latencies near 1.9–3.3 seconds.
It defines region recall as any overlap in the top three ranges and notes that
the large CPython bytecode case has about 10.9 percent annotated-line coverage
while still finding its files and regions. The same file links to
`recommended.json`, `comparison-evidence.json`, and the numbered study files.
Those linked evidence files are absent from this tree (147 relative links in
`RESULTS.md` do not resolve). The scoring probe in the
[semantic find study](../tool-harness/2026-09-24-semantic-find-judge/index.md)
was not re-run. Treat the table as the project's report, not as a result
reproduced here.[^jegrep-results][^prior-study][^cli-runs]

**Languages.** The lexical scan and the passage reader operate on text files
the walker admits. There is no per-language grammar list. Hidden files are
excluded unless `--hidden` is set. Credential-shaped content is withheld
unless `--allow-secrets` is set.[^jegrep-grep][^jegrep-flags]

**License.** MIT, copyright 2026 Can Bölük.[^jegrep-license]

**This inspection.** `cargo build --release` of this checkout produced
`jegrep 0.1.3`. `--list-strategies` includes `cascade`. A search with neither
hosted key exited 2. `--endpoint local` against `127.0.0.1:9` made 13 judge
requests, all refused, printed `no hits` at τ 0.20, and exited 0 after 77.8
seconds of wall time. That run is a transport failure, not a retrieval
measurement.[^cli-runs]

[^jegrep-readme]: [No embeddings, no index, line-range output](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/README.md#L12-L21)

[^jegrep-providers]: [Provider selection, failover, and --only](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/README.md#L49-L68)

[^jegrep-compact]: [JSON and compact digests for agents](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/README.md#L78-L106)

[^jegrep-flags]: [Default cascade and the flags it ignores](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/README.md#L145-L173)

[^jegrep-cascade]: [Sketch scores route; hits come from full passages](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/strategies/cascade.rs#L1-L13)

[^jegrep-budgets]: [Lexical rank and default cascade budgets](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/strategies/cascade.rs#L122-L184)

[^jegrep-grep]: [Per-run keyword index, 4 MiB file cap](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/grep.rs#L1-L27)

[^jegrep-sketch]: [Sketch cutoff and verbatim sketch lines](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/strategies/cascade.rs#L31-L83)

[^jegrep-seed]: [First two reads are the strongest lexical files](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/strategies/cascade.rs#L251-L255)

[^jegrep-local]: [Hosted endpoints and the unauthenticated local server](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/jev.rs#L13-L47)

[^jegrep-json]: [Compact rows: path, score, spans](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/report.rs#L14-L38)

[^jegrep-json-body]: [JSON hit object](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/report.rs#L70-L93)

[^jegrep-exit]: [A finished search prints and returns](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/main.rs#L292-L294)

[^jegrep-walk-cache]: [In-process directory-walk cache](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/walker/cache.rs#L1-L2)

[^jegrep-walk-ttl]: [One-second default walk-cache TTL](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/src/walker/cache.rs#L118-L119)

[^jegrep-results]: [Author-reported cascade comparison](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/benches/RESULTS.md#L1-L59)

[^jegrep-license]: [MIT license](https://github.com/can1357/jegrep/blob/197e674285eb321e2be4b5f6797d755af2c32c77/LICENSE#L1-L5)

[^prior-study]: [Semantic find and JUDGE study](../tool-harness/2026-09-24-semantic-find-judge/index.md)

[^cli-runs]: [CLI runs from this inspection](./probes/cli-runs.json)

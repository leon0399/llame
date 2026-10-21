---
type: Reference
title: "jevgrep"
description: "Hierarchical Jev retrieval over a live tree, with declaration parsing for four languages and an answer cache rather than a repository index."
resource: "https://github.com/dzhng/jevgrep/tree/5a50fedceb24e691c15d90c8585d7957a95f8c8a"
tags: [code-search, jev, tree-sitter, cli]
status: draft
observed:
  date: "2026-10-21"
  revision: "5a50fedceb24e691c15d90c8585d7957a95f8c8a"
sources:
  - id: jevgrep-readme
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/README.md#L12-L29"
    title: "Question in, files and verbatim excerpts out; hosted Jev providers"
  - id: jevgrep-output
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/README.md#L79-L89"
    title: "Hierarchy, declaration parsing, and evidence rather than an answer"
  - id: jevgrep-measure
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/README.md#L96-L120"
    title: "Author-reported SWE-bench cost comparison and its limits"
  - id: jevgrep-local
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/README.md#L125-L151"
    title: "Eligibility, credentials, and the evaluation cache"
  - id: jevgrep-arch
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/docs/architecture.md#L9-L47"
    title: "Hierarchical discovery and judgments"
  - id: jevgrep-parse
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/docs/architecture.md#L50-L74"
    title: "Tree-sitter, the TypeScript parser, and text fallback"
  - id: jevgrep-fresh
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/docs/architecture.md#L98-L109"
    title: "Within-search snapshot reuse and coarse timestamp limits"
  - id: jevgrep-providers
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/providers.ts#L1-L27"
    title: "Preset endpoints and model ids"
  - id: jevgrep-http
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/providers.ts#L48-L65"
    title: "Plain HTTP only for loopback hosts"
  - id: jevgrep-cache
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/cache.ts#L50-L77"
    title: "SHA-256 answer cache, seven-day TTL, 256 MiB cap"
  - id: jevgrep-cache-age
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/cache.ts#L139-L145"
    title: "Expired cache entries miss"
  - id: jevgrep-corrupt
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/cache.ts#L102-L128"
    title: "Oversized or unparsable cache entries miss"
  - id: jevgrep-storage
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/storage.ts#L5-L19"
    title: "Cache directory resolution"
  - id: jevgrep-languages
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/source.ts#L22-L45"
    title: "Python, TypeScript, Go, Rust, and text fallback"
  - id: jevgrep-chunks
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/source.ts#L395-L399"
    title: "12_000-byte source splits"
  - id: jevgrep-budget
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/retrieve.ts#L30"
    title: "Eight-million-byte navigation budget"
  - id: jevgrep-split-call
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/retrieve.ts#L544-L545"
    title: "Oversized previews split before classification"
  - id: jevgrep-snapshot
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/filesystem.ts#L92"
    title: "Three-second recent-change window"
  - id: jevgrep-hash
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/filesystem.ts#L415-L461"
    title: "Snapshot retained when the read is more than three seconds after the newest timestamp"
  - id: jevgrep-render
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/apps/cli/src/render.ts#L16-L71"
    title: "Stdout file list, roles, and instruction lookup"
  - id: jevgrep-blocks
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/apps/cli/src/render.ts#L86-L120"
    title: "Fenced source blocks, declaration locations, and the end marker"
  - id: jevgrep-license
    resource: "https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/LICENSE#L1-L5"
    title: "MIT license"
  - id: cli-runs
    resource: "./probes/cli-runs.json"
    title: "CLI runs from this inspection"
---

# jevgrep

`jg` is a Node.js 22 CLI (`@dzhng/jevgrep` 0.8.5 at this checkout) that takes a
repository question and returns relevant files, reading leads, and verbatim
source. Jev classifies folders, files, and declarations. The caller keeps
implementation and testing. The repository also installs an agent skill; this
checkout has no MCP server.[^jevgrep-readme][^jevgrep-output]

**Search.** There is no lexical index, embedding index, or AST index of the
repository. Discovery walks the tree, scores directory metadata and content
previews, and follows branches that pass. Files that pass stay in the result
without a fixed top-N. A navigation budget stops an unbounded walk and reports
incomplete discovery. Source relevance and scope are separate judgments.
Relationship leads can recover implementations of the same contract; they do
not mark unrelated previews relevant. Tree-sitter supplies declarations for
Python, Go, and Rust. TypeScript and JavaScript use the TypeScript compiler
parser. Other text is split into bounded chunks. Returned bytes are the
original source, taken from the snapshot that was classified.[^jevgrep-arch][^jevgrep-parse][^jevgrep-budget][^jevgrep-split-call]

**Chunking.** `splitSource` cuts a snapshot into units of at most 12,000 bytes
by default. Oversized preview requests use that split. Declaration units,
comments, structural headers, and bounded local-call context are the parsed
presentation for the four languages above. Python query previews and
inherited-method leads are retrieval policy on the tree. Macro expansion and
type resolution are outside the parser. Syntax errors, bare-CR Python, and
very deep nesting fall back to text chunks.[^jevgrep-chunks][^jevgrep-parse][^jevgrep-languages]

**Storage and updates.** Eligible reads become an in-memory snapshot with a
SHA-256 of the bytes. A snapshot is retained for reuse inside the search only
when the file's newest mtime or ctime is more than three seconds before that
read, because coarse timestamps cannot separate two writes in one
tick. A changed, replaced, or deleted file is not reused. The on-disk cache
is `$XDG_CACHE_HOME/jevgrep` when that variable is absolute, and
`~/.cache/jevgrep` otherwise on Unix. It stores Jev answers, not file contents:
the key is SHA-256 of schema version, provider namespace, and the ordered
request, and that request includes the judged state. Default limits are seven
days and 256 MiB. An expired entry misses on age. An oversized or unparsable
entry misses as corrupt.
There is no incremental repository index to invalidate.[^jevgrep-hash][^jevgrep-snapshot][^jevgrep-fresh][^jevgrep-cache][^jevgrep-cache-age][^jevgrep-corrupt][^jevgrep-storage]

**Model and locality.** Preset providers are Vercel AI Gateway
(`typesafe-ai/jev`), TypeSafe (`jev-1.13.0` at `api.typesafe.ai`), OpenRouter
(`typesafe/jev-1.13`), and OpenCode Zen (`jev-1.13`). A custom record may point
at any TypeSafe-compatible base URL; plain HTTP is accepted only for
`localhost` and `127.0.0.1`.[^jevgrep-http] Saved `jg auth` credentials are what searches use.
Searches send eligible source to that endpoint. The default path is online.
A loopback custom endpoint is the local option, and this inspection did not
run one. `jg files` counts eligible files with no provider request.[^jevgrep-providers][^jevgrep-readme][^jevgrep-local]

**Interface and model-facing output.** The interface is the `jg` CLI plus the
installed skill. Stdout starts with a status line and a compact file list
(path, estimated roles, and whether source follows). Instruction files
(`AGENTS.md` at the root and on ancestors of returned files) are named.
Verbatim source is then fenced as `Source block "path" lines start-end`.
Declaration locations follow as `name@start-end`, then possible local calls
whose runtime dispatch is explicitly unverified. The default stdout cap is
256,000 bytes; truncation keeps a final `End context.` marker. Roles are
labeled estimates. Paths without excerpts remain reading leads. The CLI does
not emit a generated answer.[^jevgrep-render][^jevgrep-blocks][^jevgrep-output]

**Performance claims.** The README reports a ten-task Python SWE-bench
comparison: both arms solved 8/10, Sol cost moved from $7.62 to $5.44 (28.6
percent, Jev excluded), and total cost was 25.8 percent lower once Jev is
included. It also reports about 59 percent lower native Jev cost for 0.5.0
against the 0.4.3 run, with a 2–3 percent higher combined cost. It calls these
single-run observations and does not claim statistical equivalence or a speed
improvement. This inspection did not rerun the harness.[^jevgrep-measure]

**Languages.** Declaration parsing covers Python (including extensionless
shebangs), TypeScript/JavaScript, Go, and Rust. Other eligible text is still
searched as chunks. Ignore rules drop hidden paths, dependency and build
directories, binaries, and credential-shaped content unless the matching flag
is set.[^jevgrep-languages][^jevgrep-local]

**License.** MIT, copyright 2026 David Zhang.[^jevgrep-license]

**This inspection.** `jg files` on
`docs/research/tools` listed 11 eligible files and made no provider request. A
search without `jg auth` exited 1 and named `jg auth`. No judged retrieval was
run.[^cli-runs]

[^jevgrep-readme]: [Question in, files and verbatim excerpts out; hosted Jev providers](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/README.md#L12-L29)

[^jevgrep-output]: [Hierarchy, declaration parsing, and evidence rather than an answer](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/README.md#L79-L89)

[^jevgrep-measure]: [Author-reported SWE-bench cost comparison and its limits](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/README.md#L96-L120)

[^jevgrep-local]: [Eligibility, credentials, and the evaluation cache](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/README.md#L125-L151)

[^jevgrep-arch]: [Hierarchical discovery and judgments](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/docs/architecture.md#L9-L47)

[^jevgrep-parse]: [Tree-sitter, the TypeScript parser, and text fallback](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/docs/architecture.md#L50-L74)

[^jevgrep-fresh]: [Within-search snapshot reuse and coarse timestamp limits](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/docs/architecture.md#L98-L109)

[^jevgrep-providers]: [Preset endpoints and model ids](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/providers.ts#L1-L27)

[^jevgrep-http]: [Plain HTTP only for loopback hosts](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/providers.ts#L48-L65)

[^jevgrep-cache]: [SHA-256 answer cache, seven-day TTL, 256 MiB cap](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/cache.ts#L50-L77)

[^jevgrep-cache-age]: [Expired cache entries miss](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/cache.ts#L139-L145)

[^jevgrep-corrupt]: [Oversized or unparsable cache entries miss](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/cache.ts#L102-L128)

[^jevgrep-storage]: [Cache directory resolution](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/storage.ts#L5-L19)

[^jevgrep-languages]: [Python, TypeScript, Go, Rust, and text fallback](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/source.ts#L22-L45)

[^jevgrep-chunks]: [12_000-byte source splits](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/source.ts#L395-L399)

[^jevgrep-budget]: [Eight-million-byte navigation budget](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/retrieve.ts#L30)

[^jevgrep-split-call]: [Oversized previews split before classification](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/retrieve.ts#L544-L545)

[^jevgrep-snapshot]: [Three-second recent-change window](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/filesystem.ts#L92)

[^jevgrep-hash]: [Snapshot retained when the read is more than three seconds after the newest timestamp](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/packages/core/src/filesystem.ts#L415-L461)

[^jevgrep-render]: [Stdout file list, roles, and instruction lookup](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/apps/cli/src/render.ts#L16-L71)

[^jevgrep-blocks]: [Fenced source blocks, declaration locations, and the end marker](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/apps/cli/src/render.ts#L86-L120)

[^jevgrep-license]: [MIT license](https://github.com/dzhng/jevgrep/blob/5a50fedceb24e691c15d90c8585d7957a95f8c8a/LICENSE#L1-L5)

[^cli-runs]: [CLI runs from this inspection](./probes/cli-runs.json)

---
type: Reference
title: "oh-my-pi find"
description: "OMP's semantic find tool: the jegrep cascade as an agent tool and omp find CLI, gated on a native System One judge."
resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/tools/find.md"
tags: [code-search, jev, oh-my-pi, agent-tool]
status: draft
observed:
  date: "2026-10-21"
  revision: "b32f6fa70c17ddd5600438e55fa1571060102b83"
sources:
  - id: omp-find-doc
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/tools/find.md#L1-L18"
    title: "Tool page: semantic grep following jegrep"
  - id: omp-find-cli
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/tools/find.md#L20-L35"
    title: "CLI, inputs, and find.enabled"
  - id: omp-find-out
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/tools/find.md#L37-L48"
    title: "Model-facing text and details"
  - id: omp-find-flow
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/tools/find.md#L50-L67"
    title: "Documented cascade flow and caps"
  - id: omp-find-dirs
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/tools/find.md#L74-L77"
    title: "Directory folders are never judged"
  - id: omp-cascade
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/tools/jfind/cascade.ts#L1-L58"
    title: "Cascade constants in source"
  - id: omp-enable
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/tools/jfind/index.ts#L41-L57"
    title: "20 second tool budget and native-judge gate"
  - id: omp-report
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/tools/jfind/index.ts#L149-L178"
    title: "Strongest-first text, partial and unavailable lines"
  - id: omp-cli-src
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/cli/find-cli.ts#L1-L4"
    title: "omp find runs the same cascade"
  - id: omp-cli-fail
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/cli/find-cli.ts#L41-L44"
    title: "CLI unavailable line omits the absence sentence"
  - id: omp-cli-exit
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/cli/find-cli.ts#L128-L129"
    title: "CLI sets exit code 1 when coverage is unavailable"
  - id: omp-prompt
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/prompts/tools/find.md#L1-L4"
    title: "Model-facing tool prompt"
  - id: omp-jcache
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/judgment/cache.ts#L1-L19"
    title: "Local answer cache backed by bun:sqlite"
  - id: omp-jcache-key
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/judgment/cache.ts#L184-L192"
    title: "Lookup uses the state hash, model, and question fields"
  - id: omp-jcache-use
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/tools/jfind/index.ts#L100-L108"
    title: "find passes the shared judgment cache"
  - id: omp-kind
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/judgment/index.ts#L221-L231"
    title: "Native judge means a judgment API"
  - id: omp-native
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/judgment/index.ts#L342-L350"
    title: "find.enabled auto requires the first judge to be native"
  - id: omp-jev
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/catalog/src/compat/rules/providers/typesafe.kdl#L1-L16"
    title: "TypeSafe default model jev-1.14.0"
  - id: omp-chain
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/environment-variables.md#L434"
    title: "Built-in judge chain"
  - id: omp-posix-find
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/crates/pi-builtins/src/find.rs#L7"
    title: "POSIX find builtin, a different program"
  - id: omp-license
    resource: "https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/LICENSE#L1-L6"
    title: "MIT license"
  - id: prior-study
    resource: "../tool-harness/2026-09-24-semantic-find-judge/index.md"
    title: "Semantic find and JUDGE study"
  - id: cli-runs
    resource: "./probes/cli-runs.json"
    title: "CLI runs from this inspection"
---

# oh-my-pi find

`docs/tools/find.md` documents semantic `find`: describe a behavior, receive
files and line ranges with a relevance score. The page says the cascade
follows jegrep: lexical pre-ranking, filename judgments, passage sketches,
then full-passage verification. The same repository's
`crates/pi-builtins/src/find.rs` is a POSIX `find` ported from uutils. That
file is a different tool.[^omp-find-doc][^omp-posix-find]

**Search.** `runCascade` ranks eligible files with one native grep over
keywords derived from the query plus caller `grep_keywords`. IDF weights are
clamped. The top 128 files are judged by name in batches of 64, 16 requests
in flight. Twenty files are read, up to 4 MiB each. Windows are 8,192 bytes;
24 windows are kept per file; each sketch is 384 bytes. Sketches at or above
0.45 are verified, at most 40 complete passages, grouped per file. A file is
a hit when its best verified passage reaches 0.20. Sketch judgments are
routing signals. Directory folders are never judged. There is no
embedding stage and no AST stage in `jfind`.[^omp-cascade][^omp-find-flow][^omp-find-dirs]

**Chunking.** Windows are byte-bounded. Sketches are verbatim keyword-dense
lines with original line numbers, the same shape as jegrep's sketch. The
lexical scan times out at 30 seconds. The tool call has a 20-second wall
budget (`FIND_TIMEOUT_MS`); `omp find` is documented as unbounded by that
constant.[^omp-cascade][^omp-enable][^omp-find-flow]

**Storage and updates.** The tool page and the model prompt both say the
search reads live files and keeps no index. Hidden files, symlinks, build
output, lockfiles, binary extensions, credential files, and empty files are
dropped during listing. A named file bypasses the hidden-file exclusion and
still has to pass the credential, binary, and empty-file filters. Cancellation
stops the scan and in-flight judgments. There is no repository index. Native
judgments can be reused from a shared SQLite cache. The state id is SHA-256
of the canonical judgment state. A hit also requires the model and the
question name, type, instruction, and criteria.[^omp-find-doc][^omp-find-flow][^omp-prompt][^omp-jcache][^omp-jcache-key][^omp-jcache-use]

**Model and locality.** Every judgment goes through the session `judge` role.
`find.enabled` defaults to `auto`: the tool is created only when
`hasNativeJudge` is true. That function is true when the first resolved judge
candidate uses a judgment API (`kindOf` returns `"native"`). Its comment names
TypeSafe Jev, OpenRouter, OpenAI Decisions, and Workers AI Clef. The tool page
names TypeSafe `jev-1.14.0`, directly or through OpenRouter, as the native
case for `auto`. `on` allows a prompted judge. `off` disables the tool. The
TypeSafe catalog seed defaults to `jev-1.14.0`.
The documented built-in chain starts at `typesafe/jev-1.14.0`, then
`openrouter/typesafe/jev-1.14`, then small and session models, and stops
falling through to prompted models once a native candidate has been reached.
Weights are not inside `jfind`. `kindOf` returns `"local"` for on-device
inference, and that kind does not satisfy `hasNativeJudge`.[^omp-enable][^omp-kind][^omp-native][^omp-jev][^omp-chain]

**Interface and model-facing output.** The agent tool is `find` with required
`query` and `grep_keywords` and an optional `path` (host path or internal URL
such as `omp://`, `skill://`, or `local://`). The prompt tells the model to
use it first for an unknown location, and to use `grep` or `glob` when the
literal or the name is known. The text result is strongest-first:
`N hit(s) for "query" (τ 0.20), strongest first`, then `path  score  N lines judged`, then up
to three `path:start-end  p  snippet` rows, then a footer of listed, judged,
files read, bytes, requests, tokens, cost, and wall/API time. `details`
carries hits, coverage (`complete`, `partial`, or `unavailable`), and stats.
Zero hits is `no hits` and is marked useless. A partial judge failure adds a
line that unjudged files may still match. Every request failing yields
`find unavailable` and an error result whose text says this is not evidence of
absence. `omp find` prints `find unavailable` with the failed-request count,
omits that absence sentence, and sets exit code 1. `docs/tools/find.md` says
the CLI prints the same status.[^omp-find-cli][^omp-find-out][^omp-report][^omp-cli-src][^omp-cli-fail][^omp-cli-exit][^omp-prompt]

**Performance claims.** `docs/tools/find.md` states the budgets above and does
not publish a recall or latency table for the tool. Failure, coverage, and
benchmark limits for the cascade are in the
[semantic find study](../tool-harness/2026-09-24-semantic-find-judge/index.md).
jegrep's benchmark numbers are not OMP measurements.[^omp-find-flow][^prior-study]

**Languages.** Eligibility is by path filters and text reads, not by grammar.
Internal URL schemes are searched through the session URL filesystem. Scores
are documented as comparable 0–1 probabilities.[^omp-find-doc][^omp-find-flow][^omp-prompt]

**License.** MIT. The file names copyright holders Mario Zechner (2025), Can
Bölük (2025–2026), and Stencil Labs, Inc. (2026).[^omp-license]

**This inspection.** No `omp find` process was run. The coding-agent package
was not installed, and no judge credential was configured.[^cli-runs]

[^omp-find-doc]: [Tool page: semantic grep following jegrep](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/tools/find.md#L1-L18)

[^omp-find-cli]: [CLI, inputs, and find.enabled](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/tools/find.md#L20-L35)

[^omp-find-out]: [Model-facing text and details](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/tools/find.md#L37-L48)

[^omp-find-flow]: [Documented cascade flow and caps](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/tools/find.md#L50-L67)

[^omp-find-dirs]: [Directory folders are never judged](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/tools/find.md#L74-L77)

[^omp-cascade]: [Cascade constants in source](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/tools/jfind/cascade.ts#L1-L58)

[^omp-enable]: [20 second tool budget and native-judge gate](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/tools/jfind/index.ts#L41-L57)

[^omp-report]: [Strongest-first text, partial and unavailable lines](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/tools/jfind/index.ts#L149-L178)

[^omp-cli-src]: [omp find runs the same cascade](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/cli/find-cli.ts#L1-L4)

[^omp-cli-fail]: [CLI unavailable line omits the absence sentence](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/cli/find-cli.ts#L41-L44)

[^omp-cli-exit]: [CLI sets exit code 1 when coverage is unavailable](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/cli/find-cli.ts#L128-L129)

[^omp-prompt]: [Model-facing tool prompt](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/prompts/tools/find.md#L1-L4)

[^omp-jcache]: [Local answer cache backed by bun:sqlite](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/judgment/cache.ts#L1-L19)

[^omp-jcache-key]: [Lookup uses the state hash, model, and question fields](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/judgment/cache.ts#L184-L192)

[^omp-jcache-use]: [find passes the shared judgment cache](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/tools/jfind/index.ts#L100-L108)

[^omp-kind]: [Native judge means a judgment API](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/judgment/index.ts#L221-L231)

[^omp-native]: [find.enabled auto requires the first judge to be native](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/coding-agent/src/judgment/index.ts#L342-L350)

[^omp-jev]: [TypeSafe default model jev-1.14.0](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/packages/catalog/src/compat/rules/providers/typesafe.kdl#L1-L16)

[^omp-chain]: [Built-in judge chain](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/docs/environment-variables.md#L434)

[^omp-posix-find]: [POSIX find builtin, a different program](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/crates/pi-builtins/src/find.rs#L7)

[^omp-license]: [MIT license](https://github.com/can1357/oh-my-pi/blob/b32f6fa70c17ddd5600438e55fa1571060102b83/LICENSE#L1-L6)

[^prior-study]: [Semantic find and JUDGE study](../tool-harness/2026-09-24-semantic-find-judge/index.md)

[^cli-runs]: [CLI runs from this inspection](./probes/cli-runs.json)

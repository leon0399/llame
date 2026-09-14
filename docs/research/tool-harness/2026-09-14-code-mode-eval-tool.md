---
type: Research
title: "Code-driven tool calling (eval tool): prior art and issue plan"
description: "Compares eval and code-mode tools across peer harnesses, maps llame seams, and records the phase-1 decisions and issue plan for a Bun-backed eval tool."
tags: [tools, eval, code-mode, mcp, bun, sandbox]
status: stable
generated: { by: claude-code/claude-fable-5-1, at: 2026-09-14T00:00:00Z }
sources:
  - id: omp-eval-js-tool-bridge-l59-l70
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/tool-bridge.ts#L59-L70"
    title: "eval bridge tool lookup"
  - id: omp-eval-js-tool-bridge-l232-l260
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/tool-bridge.ts#L232-L260"
    title: "callSessionTool"
  - id: omp-mcp-tool-bridge-l680-l684
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/mcp/tool-bridge.ts#L680-L684"
    title: "MCP tool naming"
  - id: omp-session-tools-l437-l455
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/session/session-tools.ts#L437-L455"
    title: "shared tool registry and eval bridge names"
  - id: omp-eval-ts-l96-l98
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/tools/eval.ts#L96-L98"
    title: "per-language reset"
  - id: omp-docs-eval-md
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/docs/tools/eval.md"
    title: "eval architecture doc"
  - id: omp-worker-protocol-l1-l59
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/worker-protocol.ts#L1-L59"
    title: "worker message protocol"
  - id: omp-py-kernel-l1-l56
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/py/kernel.ts#L1-L56"
    title: "Python kernel and cancellation"
  - id: omp-py-tool-bridge-l90-l130
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/py/tool-bridge.ts#L90-L130"
    title: "loopback HTTP bridge"
  - id: omp-rewrite-imports-l3-l7
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/shared/rewrite-imports.ts#L3-L7"
    title: "import rewriting rationale"
  - id: omp-rewrite-imports-l513-l579
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/shared/rewrite-imports.ts#L513-L579"
    title: "lexical demotion across cells"
  - id: omp-eval-code-mode-md
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/prompts/tools/eval-code-mode.md"
    title: "code-mode prompt"
  - id: omp-code-mode-declarations-l50-l60
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/tools/eval-format/code-mode-declarations.ts#L50-L60"
    title: "TypeScript declaration generation"
  - id: omp-streaming-output-l9-l21
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/session/streaming-output.ts#L9-L21"
    title: "output caps"
  - id: openclaw-code-mode-ts-l69-l133
    resource: "https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode.ts#L69-L133"
    title: "bounded catalog index"
  - id: openclaw-guest-api-md
    resource: "https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/docs/tools/code-mode/guest-api.md"
    title: "guest API"
  - id: openclaw-internals-md
    resource: "https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/docs/tools/code-mode/internals.md"
    title: "runtime and security boundary"
  - id: openclaw-code-mode-execution-l598-l604
    resource: "https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode-execution.ts#L598-L604"
    title: "resume session ownership check"
  - id: codex-code-mode-rs
    resource: "https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/tools/src/code_mode.rs#L8-L99"
    title: "augment_tool_spec_for_code_mode and collect_code_mode_tool_definitions"
  - id: codex-execute-handler-rs
    resource: "https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/core/src/tools/code_mode/execute_handler.rs#L48-L78"
    title: "code-mode execute handler"
  - id: cloudflare-code-mode
    resource: "https://blog.cloudflare.com/code-mode/"
    title: "Cloudflare Code Mode"
  - id: goose-code-mode
    resource: "https://goose-docs.ai/docs/guides/managing-tools/code-mode/"
    title: "goose Code Mode"
  - id: anthropic-code-execution-mcp
    resource: "https://www.anthropic.com/engineering/code-execution-with-mcp"
    title: "Code execution with MCP"
  - id: anthropic-programmatic-tool-calling
    resource: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling"
    title: "Programmatic tool calling"
  - id: bun-auto-install
    resource: "https://bun.com/docs/runtime/auto-install"
    title: "Bun auto-install"
  - id: cve-2026-24910
    resource: "https://www.sentinelone.com/vulnerability-database/cve-2026-24910/"
    title: "CVE-2026-24910"
  - id: llame-tools-types
    resource: "../../../apps/api/src/tools/types.ts"
    title: "Tool and ToolContext"
  - id: llame-turn-tool-catalog
    resource: "../../../apps/api/src/tools/turn-tool-catalog.ts"
    title: "composeTurnToolCatalog"
  - id: llame-runner
    resource: "../../../apps/api/src/tools/runner.ts"
    title: "runTool"
  - id: llame-runs-repository
    resource: "../../../apps/api/src/runs/runs-repository.ts"
    title: "run event types"
  - id: llame-tool-search-design
    resource: "../../../openspec/changes/tool-search/design.md"
    title: "tool-search design D1"
  - id: harness-oh-my-pi
    resource: "../harnesses/oh-my-pi.md"
    title: "oh-my-pi reference entry"
  - id: harness-openclaw
    resource: "../harnesses/openclaw.md"
    title: "OpenClaw reference entry"
  - id: harness-codex-cli
    resource: "../harnesses/codex-cli.md"
    title: "Codex CLI reference entry"
---

# Code-driven tool calling (`eval` tool): prior art and issue plan

Noncanonical research. Date: 2026-09-14. Inspected revisions: oh-my-pi
`4267074ac91456866e95ed8de0b6353388f08502`, OpenClaw
`e3db9654277ba8ac19a6cd6bccbda57d13931924`, Codex CLI
`94697375cb9d2aa8ae74d61957c6b396819bec94`. Path citations below refer to those
checkouts; llame citations refer to `master` at the time of writing.

Reference entries in the harness bundle carry the mechanism-level findings:
[oh-my-pi](../harnesses/oh-my-pi.md) F22, [OpenClaw](../harnesses/openclaw.md)
F31, and [Codex CLI](../harnesses/codex-cli.md) item 3. This document retains
the comparison, llame fit, and decisions.

## Premise check

The proposal has two parts: (a) an `eval` tool running TS/JS under Bun and
Python, and (b) exposing native tools and MCP tools as callables inside the
script. Part (b) is not unique. Five shipped or documented systems already do it:

| System               | Runtime                                                     | Native tools in code                 | MCP tools in code                                                              | Isolation                                                 |
| -------------------- | ----------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| oh-my-pi `eval`      | Bun worker thread (JS), CPython subprocess (py)             | `tool.<name>(args)`                  | Same path: MCP tools are ordinary registry tools named `mcp__<server>__<tool>` | None beyond thread/process; full host FS, network, env    |
| OpenClaw Code Mode   | QuickJS-WASI in a Node worker                               | Global async function per tool       | `MCP.<server>.<tool>()` namespace                                              | No FS, network, imports, env; memory and interrupt limits |
| Codex CLI code mode  | In-process V8, migrating to out-of-process host (PR #27724) | TS signatures spliced into tool spec | Yes, MCP parsed into the same `ToolSpec`                                       | V8 sandbox                                                |
| Cloudflare Code Mode | Dynamic Worker (V8 isolate)                                 | Generated typed TS API               | Yes, MCP schema to TS API                                                      | Isolate, no FS/env, egress only via bindings              |
| goose Code Mode      | pctx (Deno-based)                                           | JS modules per extension             | Yes                                                                            | Deno permissions                                          |

Evidence per row: OMP bridge lookup[^omp-eval-js-tool-bridge-l59-l70], MCP
tool naming[^omp-mcp-tool-bridge-l680-l684], and the shared
registry[^omp-session-tools-l437-l455]; OpenClaw guest
API[^openclaw-guest-api-md] and internals[^openclaw-internals-md]; Codex
`augment_tool_spec_for_code_mode`[^codex-code-mode-rs] and execute
handler[^codex-execute-handler-rs]; Cloudflare Code Mode[^cloudflare-code-mode];
goose Code Mode[^goose-code-mode].

Anthropic's "Code execution with MCP" post[^anthropic-code-execution-mcp] and
its productized Programmatic Tool Calling[^anthropic-programmatic-tool-calling]
describe the same pattern. The differentiator available to llame is elsewhere:
durable, receipt-bound nested tool calls under owner-scoped permissions in a
multi-user server, plus real dependency imports. No listed system combines all
three; OMP has imports but no isolation, OpenClaw has isolation but no imports,
and none has durable per-call provenance.

## What OMP's `eval` does (the model to adapt)

F1. One cell per call; a persistent kernel per `${lang}:${sessionId}` keeps
variables and imports until `reset`, owner disposal, or process exit. No idle
reaper (eval architecture doc[^omp-docs-eval-md], per-language
reset[^omp-eval-ts-l96-l98]).

F2. JS: Bun `worker_threads` VM with a `run/tool-call/tool-reply/result`
message protocol[^omp-worker-protocol-l1-l59]. Python: CPython subprocess
speaking NDJSON, cancellation by SIGINT then SIGTERM/SIGKILL after
5 s[^omp-py-kernel-l1-l56]. Python tool calls go over a loopback HTTP server
with a per-run bearer token[^omp-py-tool-bridge-l90-l130]. Two transports for
one RPC.

F3. Bridge: `tool.<name>(args)` resolves through the session registry,
validates args against the tool's wire schema, executes the ordinary tool with
the ordinary permission gate, and returns `{text, details, images, hasError}`
(`callSessionTool`[^omp-eval-js-tool-bridge-l232-l260], registry
lookup[^omp-session-tools-l437-l455]).

F4. Imports: static and dynamic imports are rewritten with a Babel parse to a
worker-injected `__omp_import__` that resolves against the session
cwd[^omp-rewrite-imports-l3-l7]; bare specifiers keep normal cache identity, so
Bun auto-install applies (eval architecture doc[^omp-docs-eval-md]). Top-level
`const`/`let`/`class` are demoted to `var` so they persist across
cells[^omp-rewrite-imports-l513-l579].

F5. Prompt: the prelude is prose plus a generic `tool.<name>(args) -> unknown`
line; under Codex Code Mode the harness partitions tools into a small direct
set and splices TypeScript signatures for the rest (code-mode
prompt[^omp-eval-code-mode-md], declaration
generation[^omp-code-mode-declarations-l50-l60]). Declaration generation maps
JSON Schema to TS to depth 2.

F6. Limits: 30 s default cell timeout clamped 1 to 3600 s, watchdog paused
during host-side waits; 50 KiB inline output, 3000 lines, 512 columns, overflow
spilled to `artifact://` (output caps[^omp-streaming-output-l9-l21], eval
architecture doc[^omp-docs-eval-md]).

Do not copy: the missing sandbox, the dual transport, the absent kernel reaper,
and the Codex-shaped dual-mode partition.

## What OpenClaw adds

Bounded catalog index in the `exec` description capped at 8000 chars, sorted so
entries with trusted output hints come first, oversized entries skipped rather
than truncated[^openclaw-code-mode-ts-l69-l133], and MCP descriptions
deliberately omitted "so adversarial catalog prose cannot steer the
model"[^openclaw-guest-api-md]. `catalog.search()` and `handle.describe()` load
full schemas on demand. `exec` plus `wait` gives a suspend/resume model with
snapshot TTL[^openclaw-internals-md]. Resume checks session
ownership[^openclaw-code-mode-execution-l598-l604]. Caps are global per process
(64 suspended runs, one worker pool), a noisy-tenant surface llame must not
repeat.

## Bun facts that shape the design

- No `npm:` prefix and no `package.json` needed: bare specifiers auto-install
  at run time, versions pin inline (`"zod@^3.20.0"`), cached under Bun's
  install cache, offline fails outright when uncached[^bun-auto-install].
- `bun:sqlite`, `bun:test`, `bun:ffi` builtins. `bun:ffi` is a host-escape
  primitive and must be blocked in a tenant runtime.
- Bun has no runtime permission model. Lifecycle-script blocking is install-time
  only, and its trusted-dependency allowlist was spoofable
  (CVE-2026-24910[^cve-2026-24910], fixed 1.3.5). Isolation has to come from
  the OS layer.
- llame runs Node >= 22.19 and has no Bun dependency
  (`package.json` engines, `packages/bash-executor/src/execute.ts`). Bun would
  be a new managed runtime binary, resolved like the bash-executor allowlist.

## Fit with llame

Seams that already exist:

- `Tool<TArgs>` with `classification: execute_code` and `ToolContext` carrying
  `userId`, `tenantDb`, `runId`, `permissionPolicy`, abort and timeout
  signals[^llame-tools-types].
- `composeTurnToolCatalog()` produces the per-turn admitted set (native plus
  MCP) with canonical declarations and SHA-256
  `declarationHash`[^llame-turn-tool-catalog]. Declaration text for the script
  runtime derives from this manifest, so the receipt already covers what the
  script could call.
- `runTool()` is the single gate: schema, permission policy, timeout,
  truncation, structured errors[^llame-runner]. Nested calls from a script must
  enter here; there is no second path.
- `run_events` `tool.requested`/`tool.completed` and `native.attempt`/
  `native.result` are the durable receipt log[^llame-runs-repository]; replay
  reconstructs `ToolActivityPart`s from it
  (`apps/api/src/runs/assistant-transcript.ts`).
- `packages/bash-executor` owns managed child processes with byte bounds and
  a single-active-process rule.

Constraints:

- The tool-search design[^llame-tool-search-design] rejected "a code-mode
  `execute` tool (a new execution class, out of scope under §13.5)". The
  proposal must reopen that decision explicitly and define the classification.
- Host `bash` is documented as alpha host authority, not tenant isolation. An
  `eval` tool that auto-installs npm packages and runs them on the host widens
  that authority to arbitrary third-party code. It cannot ship as a multi-user
  capability without #756 (local managed Sandbox). Single-owner alpha can ship
  with the same host-authority disclaimer bash carries today, gated by
  `tools.nativeExecutorId`.
- Secrets: the script process must receive a declared environment only, never
  the API's `POSTGRES_URL` or provider keys. MCP `{env:}`/`{path:}` values are
  redacted from results already; the bridge inherits that because it returns
  `ToolResult`s, not raw transport payloads.
- Every nested call is a receipt. The context-saving property of code mode is
  that intermediate results stay out of model context, not out of the run log.

## Design decisions to carry into the proposal

D1. One transport for both languages: the script runtime is a child process;
tool calls are JSON-RPC over the child's stdio or a Unix socket, authenticated
by process identity, not a loopback HTTP port with a bearer token.

D2. Declarations are generated from the turn manifest into a TypeScript
`declare const tool: { ... }` block and Python stubs, MCP included, with
descriptions truncated and prose from MCP servers excluded from the inline
index (OpenClaw's rule). Full schema on demand via `tool.describe(name)`.

D3. Nested calls are ordinary `runTool()` invocations: same permission policy,
same timeout, same `tool.requested`/`tool.completed` receipts, parent
`toolCallId` recorded. The eval result returned to the model is the cell's
stdout/display plus a compact ledger of nested call ids and outcomes.

D4. Stateless cells: each call spawns a fresh child process and nothing
persists between calls. Replay-safe, and workers are pg-boss processes that
cannot hold kernels across restarts anyway. Add a persistent kernel only if
transcripts show cell chaining that stateless cells make expensive.

D5. Bun before Python. Python adds a second kernel protocol and a second
dependency story (uv/pip) for a smaller gain in llame's assistant use case.

D6. Isolation is a swappable executor concern (smolagents, Codex, Cloudflare
all separate it). Phase 1 runs the host-authority executor behind the same
gate as bash; the sandbox executor from #756 replaces it without changing the
tool contract.

## Issue plan

Tracker #833: `tracking: code-driven tool calling (eval tool)`. Outcome: a Run
can execute one cell of model-authored TypeScript that calls admitted native
and MCP tools as typed functions, with every nested call gated, receipted, and
replayable, under the owner's existing permissions. Predecessors: issues 735
and 763, both done. Related: 756 (sandbox executor), 338 (catalog size), 91
(budgets), 765 (subagents; `agent()` in the prelude is out of scope here).

I1 (#834). `design(api): eval tool contract and classification`. Reopens the
tool-search D1 rejection. Defines the `execute_code` classification rules for
a tool that itself dispatches tools, the availability gate
(`tools.allowed` + `tools.nativeExecutorId`), nested-call receipt shape, and
the host-authority disclaimer. Acceptance: OpenSpec proposal with delta specs
for `tool-calling`, `tool-call-permissions`, `durable-runs`; negative tests
named for cross-owner call, disallowed tool from script, secret env leak.

I2 (#835). `feat(api): managed Bun runtime and cell executor`. Adds Bun to the
managed-tool resolution of `packages/bash-executor` (or a sibling package),
spawns one child per Run with a declared environment and cwd, runs a cell over
stdio JSON-RPC, enforces cell timeout, byte bounds, and reap on run end.
Acceptance: cell with a bare npm import resolves via auto-install; `bun:ffi`
import refused; `POSTGRES_URL` absent inside the child; timeout kills the
process tree.

I3 (#836). `feat(api): tool bridge from script to runTool()`.
`tool.<name>(args)` in the child sends a JSON-RPC request; the host validates
against the admitted declaration, calls `runTool()` with the parent
`toolCallId`, writes `tool.requested`/`tool.completed`, returns the
`ToolResult`. Includes MCP tools with no special path. Acceptance: permission
`reject` clause inside a script yields `permission_denied` in the nested
receipt and a catchable error in the script; replay after worker restart
reconstructs nested parts.

I4 (#837). `feat(api): declaration rendering for the eval prompt`. Generate
the `declare const tool` block from the turn manifest, bounded by size with
skip rather than truncate, MCP prose excluded, `tool.describe()` on demand.
Acceptance: rendered text is deterministic for a given manifest hash and is
part of the Run receipt.

I5 (#838). `feat(web): render eval cells and nested call ledger`. Show the
cell source, output, and nested calls under the parent tool part.

I6. `feat(api): Python kernel for eval` (deferred, after I2 to I4 ship; no
issue filed).

I7. Sandbox executor for eval: child of #756, not this tracker.

Ordering: I1, then I2 and I4 in parallel, then I3, then I5. Multi-user
availability waits on I7.

## Decisions (2026-09-14)

Q1. Phase 1 ships under the same host-authority posture as `bash`:
single-owner alpha, gated by `tools.nativeExecutorId`, documented as host
authority rather than tenant isolation. Multi-user availability waits on #756.

Q2. Stateless one-shot cells (D4). No per-Run kernel.

Q3. No direct-tool restriction. The full direct catalog stays advertised
alongside `eval`; the model chooses. Revisit with #338 if catalog size forces
a partition.

[^omp-eval-js-tool-bridge-l59-l70]: [eval bridge tool lookup](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/tool-bridge.ts#L59-L70)

[^omp-eval-js-tool-bridge-l232-l260]: [`callSessionTool`](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/tool-bridge.ts#L232-L260)

[^omp-mcp-tool-bridge-l680-l684]: [MCP tool naming](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/mcp/tool-bridge.ts#L680-L684)

[^omp-session-tools-l437-l455]: [shared tool registry and eval bridge names](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/session/session-tools.ts#L437-L455)

[^omp-eval-ts-l96-l98]: [per-language reset](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/tools/eval.ts#L96-L98)

[^omp-docs-eval-md]: [eval architecture doc](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/docs/tools/eval.md)

[^omp-worker-protocol-l1-l59]: [worker message protocol](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/worker-protocol.ts#L1-L59)

[^omp-py-kernel-l1-l56]: [Python kernel and cancellation](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/py/kernel.ts#L1-L56)

[^omp-py-tool-bridge-l90-l130]: [loopback HTTP bridge](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/py/tool-bridge.ts#L90-L130)

[^omp-rewrite-imports-l3-l7]: [import rewriting rationale](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/shared/rewrite-imports.ts#L3-L7)

[^omp-rewrite-imports-l513-l579]: [lexical demotion across cells](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/shared/rewrite-imports.ts#L513-L579)

[^omp-eval-code-mode-md]: [code-mode prompt](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/prompts/tools/eval-code-mode.md)

[^omp-code-mode-declarations-l50-l60]: [TypeScript declaration generation](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/tools/eval-format/code-mode-declarations.ts#L50-L60)

[^omp-streaming-output-l9-l21]: [output caps](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/session/streaming-output.ts#L9-L21)

[^openclaw-code-mode-ts-l69-l133]: [bounded catalog index](https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode.ts#L69-L133)

[^openclaw-guest-api-md]: [guest API](https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/docs/tools/code-mode/guest-api.md)

[^openclaw-internals-md]: [runtime and security boundary](https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/docs/tools/code-mode/internals.md)

[^openclaw-code-mode-execution-l598-l604]: [resume session ownership check](https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode-execution.ts#L598-L604)

[^codex-code-mode-rs]: [`augment_tool_spec_for_code_mode` and `collect_code_mode_tool_definitions`](https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/tools/src/code_mode.rs#L8-L99)

[^codex-execute-handler-rs]: [code-mode execute handler](https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/core/src/tools/code_mode/execute_handler.rs#L48-L78)

[^cloudflare-code-mode]: [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/)

[^goose-code-mode]: [goose Code Mode](https://goose-docs.ai/docs/guides/managing-tools/code-mode/)

[^anthropic-code-execution-mcp]: [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)

[^anthropic-programmatic-tool-calling]: [Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)

[^bun-auto-install]: [Bun auto-install](https://bun.com/docs/runtime/auto-install)

[^cve-2026-24910]: [CVE-2026-24910](https://www.sentinelone.com/vulnerability-database/cve-2026-24910/)

[^llame-tools-types]: [`Tool` and `ToolContext`](../../../apps/api/src/tools/types.ts)

[^llame-turn-tool-catalog]: [`composeTurnToolCatalog`](../../../apps/api/src/tools/turn-tool-catalog.ts)

[^llame-runner]: [`runTool`](../../../apps/api/src/tools/runner.ts)

[^llame-runs-repository]: [run event types](../../../apps/api/src/runs/runs-repository.ts)

[^llame-tool-search-design]: [tool-search design D1](../../../openspec/changes/tool-search/design.md)

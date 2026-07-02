# MVP: tool-calling run loop

## Objective

Turn the answer-only chat loop into a **bounded, policy-gated tool-calling
loop** — the smallest change that makes llame an agent (not a chat UI) and
lights up infrastructure already built for it: the policy engine (#45, built
for `tool.invoke` gating), the per-run step budget (#91, explicitly deferred
"until the tool loop exists"), and the reserved `running_tool` run status.

## MVP scope & non-goals

**In:**
- A tool registry with **one** read-only built-in tool: `get_current_time`.
- The AI SDK v6 bounded multi-step loop (`streamText({ tools, stopWhen:
  stepCountIs(maxSteps) })`) wired through the existing `ModelClient` seam.
- A **permission PRE-FILTER** of the available tool set, computed once before
  the stream from a fail-closed, code-owned allowlist (see the Permission
  section — v2 supersedes v1's per-call gate).
- Durable `tool.call` / `tool.result` **run events** (replayable, #48/#49).
- Step budget from the run's config snapshot (#46/#91): `run.maxSteps`.
- System prompt permits tool use.

**Out (deferred, named so they're not silently dropped):**
- UI rendering of tool calls — the final text answer still streams through the
  existing bridge unchanged; tool activity is durable in run_events and visible
  in the run trace. Web tool-call UI is a follow-up.
- Any write / external / risky tool. Draft-vs-commit split (agents-best-
  practices) applies when the first risky tool lands, not now.
- Mid-loop `running_tool` status column transitions — emit the events; leave
  the status column at `running_model` for the MVP (note as refinement).
- Parallel tool calls, approval-pause/resume, sandboxing.

## Autonomy & risk

Autonomous within policy, but the only tool is **read_only / compute_only** —
no side effects, no secrets, no network. Per the agents-best-practices
permission matrix ("public read: allow", "compute-only: allow in bounded
environment"), a clock is auto-allowed; the gate still records the decision so
the enforcement seam is real when a risky tool arrives.

## Core loop (mechanism)

`streamText` auto-executes tools that declare `execute` and re-calls the model
until no tool call remains or `stopWhen` trips. We pass:
- `tools`: the **pre-filtered** tool set (see Permission), each mapped to an AI
  SDK `tool({ description, inputSchema: zod, execute })`.
- `stopWhen: stepCountIs(maxSteps)` — the hard step bound (loop invariant #5).

The model never executes a tool; the SDK calls our `execute` wrapper, which
(v3) flushes buffered deltas, appends `tool.call`, runs the built-in, appends
`tool.result` — all through the shared serialized event chain (not
`onStepFinish`, which would race the delta buffer; see Run events). Permission
is enforced BEFORE the stream by the pre-filter, so a tool the caller may not
use is never in the set the SDK can call.

## Tool contract

```
name:          get_current_time
purpose:       the current date/time in a given IANA timezone (models can't know it)
inputSchema:   { timezone?: string (IANA, default "UTC") }  — strict, additionalProperties:false
output:        { status:"success", iso, timezone, unixMs } | { status:"error", type, message }
riskClass:     read_only
timeout:       none needed (pure)
result limit:  tiny, fixed
```

Registry shape (extensible): `BuiltinTool = { name, description, riskClass,
inputSchema (zod), execute(args) -> StructuredResult }`. The registry maps each
to an AI SDK `tool()` whose `execute` is the permission-wrapped call.

## Permission: PRE-FILTER the tool set (v2 — was per-call gate)

**Decision (v2):** permission is a **pre-filter of the available tool set,
computed ONCE before the stream starts** — not a per-call gate inside the
SDK's `execute` callback. This is the open-webui/opencode-coarse pattern and
claude-code's "centralize the check" lesson, and it resolves three review
findings at once:
- **No mid-stream DB contention** (adversarial P1): the process shares one
  Postgres connection (`max: 1`). A per-call `PolicyService.check` from inside
  `execute`, mid-stream, would contend with delta writes for that one
  connection on every tool call. Pre-filtering runs the decision once, in a
  short transaction, before `streamText` — zero mid-stream DB work.
- **Fail-closed, centrally owned** (adversarial P1): the allowed set is a
  **code-owned allowlist of vetted safe built-in tool names** (`SAFE_BUILTIN_
  TOOLS`), NOT the tool's self-reported `riskClass`. Tagging a tool `read_only`
  cannot bypass policy; only an explicit entry in the central allowlist admits
  it. Unknown / unlisted tool → excluded (default-deny).
- **No dangling-tool-result risk**: a filtered-out tool is never offered to the
  model, so there is no denied tool call to pair a result with.

MVP allowed set = `{ get_current_time }`. **Policy-engine (#45) seam:** a
non-safe tool (not in `SAFE_BUILTIN_TOOLS`) routes through
`PolicyService.check({ action:'tool.invoke', resourceType:'tool', resourceId })`
and is admitted only on an explicit allow — default-deny otherwise. No such
tool exists in the MVP, so this path is exercised by a unit test, not the hot
path. Per-call ARG-conditional gating with a denial-as-tool-result (the
claude-code synthetic `is_error` result pattern) is the deferred follow-up for
when arg-sensitive or risky tools land — noted, not built.

## Run events (durable, replayable) — ordering

Per step (`onStepFinish`) append `tool.call` `{ toolName, args }` and
`tool.result` `{ toolName, status, summary }`.

**Ordering (v2 — resolves adversarial P0):** `model.delta` events are appended
through a serialized `deltaWrites` promise chain so DB insert order (which
assigns `run_events.sequence`) matches stream order. Tool events MUST be
appended through the **same chain** — a shared `appendRunEvent` that enqueues
onto `deltaWrites` — or a `tool.result` from `onStepFinish` can win the insert
race against a still-buffered `model.delta` from the same step and corrupt
replay order. The bridge ignores unknown event types (default case), so the UI
is unaffected either way; ordering matters for the durable trace, not today's
UI.

## Config / budget

`run.maxSteps` added to the effective-config consumed keys (default 4, env
`RUN_MAX_STEPS`), read via a new `snapshotMaxSteps` accessor in
`effective-config.ts` **mirroring the existing `snapshotMaxOutputTokens` /
`snapshotCompactionThreshold` pattern** (P2). Read from the run's config
snapshot at execution time (#46/#91) — a mid-flight change can't re-budget a
live run. `stopWhen: stepCountIs(maxSteps)` enforces the cap.

**Empty-text-on-cap edge (adversarial P1):** if the cap trips on a tool-only
step, the SDK returns whatever text accumulated — possibly empty. Default
`maxSteps: 4` with one simple tool means a normal turn is call→answer (2 steps)
and never hits the cap; the empty-text terminal case is a documented,
low-severity edge for the MVP (the run_events still record the tool activity),
not a forced-final-text-step complexity we take on now.

## Durability limitation (research finding — stated, not solved)

Neither opencode nor claude-code uses the AI SDK's in-memory `stopWhen`
multi-step loop for their durable core; both hand-roll a resumable outer loop
that persists state between provider turns. The SDK's loop holds intermediate
tool results in memory, so a worker crash MID-loop is not resumable from the
partial state — the run's single-flight + heartbeat/deadman (#48) would expire
and a retry re-runs the whole turn. For the MVP this is acceptable because the
only tool (`get_current_time`) is **idempotent and cheap** — re-running is
harmless. A durable outer loop (persist tool results as resumable run state,
resume the agent loop after restart) is the correct v0.7-era architecture and
is explicitly OUT of the MVP. Naming it so it isn't a silent assumption.

## Fake-client coverage note (adversarial P1)

The pervasive test fakes (`FakeStreamingModelClient`, `FakeWorkerModelClient`)
don't run the real SDK, so they ignore `tools`/`maxSteps`/`onStepFinish` — the
existing HTTP/worker e2e keep passing *because* they exercise the answer-only
path unchanged. `RunExecutionService`'s tool-wiring (building the allowed set,
step-event emission) is covered by the new `MockLanguageModelV3` integration
test that drives the REAL loop. This split is intentional and documented, not
an accidental coverage gap.

## Testability

- Pure unit tests: the registry, `get_current_time.execute`, the permission
  gate (allow read-only, deny → structured result, non-safe → policy verdict).
- Loop integration test with `ai/test` `MockLanguageModelV3`: script a
  tool-call step then a text step; assert (a) execute ran, (b) `tool.call` /
  `tool.result` events recorded in order, (c) final text streamed, (d)
  `stopWhen` caps a runaway (a model that always calls a tool stops at
  maxSteps). No real provider, fully deterministic.
- The existing chats-messages/worker e2e keep passing unchanged (no tools
  passed when the registry is empty for a turn == today's behavior).

## Non-negotiables honored

- Every tool call gets exactly one result (SDK guarantees; deny path returns a
  result, never throws).
- Permission decision before every side effect (gate inside execute).
- Hard step budget (`stopWhen`).
- Errors/denials are structured observations.
- Final answer based on observations (SDK feeds tool results back to the model).

## Minimal implementation path

1. `chats/tools/` — registry + `get_current_time` + types (pure). Unit tests.
2. Permission gate wrapper (needs `PolicyService`; `ChatsModule` imports
   `PoliciesModule`). Unit tests.
3. `ModelStreamInput` gains `tools?` + `maxSteps?`; the OpenAI/OpenRouter
   clients forward `tools` + `stopWhen: stepCountIs(maxSteps)` + `onStepFinish`.
4. `RunExecutionService`: build the allowed tool set for the run, wire
   step-event emission through the shared `deltaWrites` chain, read `maxSteps`
   from the snapshot. Replace the answer-only system prompt.
5. `MockLanguageModelV3` loop integration test.
6. Self-check: unit + rls-test.sh (e2e unchanged) + build.

## Revision history

- **v3 (2026-07-02):** Loop-wiring implemented per v2 with the fixes baked
  in: shared `enqueueEvent` chain for model.delta + tool.call/tool.result
  (P0), the tool wrapper flushes buffered deltas BEFORE emitting tool events
  (stream-order), `snapshotMaxSteps` accessor + `RUN_MAX_STEPS` instance
  layer, both provider clients forward `tools` + `stopWhen: stepCountIs(N)`,
  answer-only system prompt replaced. `MockLanguageModelV3` mechanism test
  proves auto-loop + ordered tool events + `stopWhen` cap. Known gap (as
  designed): the executeRun→run_events DB persistence of tool events is
  typechecked/built but not yet driven by a test (fakes ignore tools) — a
  mock-model-backed executeRun integration test is the follow-up.
- **v2 (2026-07-02):** Round-1 review (iterative-review-reviewer +
  adversarial-reviewer-fallback, both not-converged) + 3-repo reference
  research applied. **Permission redesigned per→pre-filter** (open-webui /
  opencode-coarse / claude-code-centralize): one decision per turn before the
  stream via a code-owned `SAFE_BUILTIN_TOOLS` allowlist — resolves the
  `max:1` mid-stream pool contention (adversarial P1) and the self-declared-
  `riskClass` fail-open (adversarial P1); arg-conditional denial-as-tool-result
  deferred (confirmed as opencode's second layer). **Ordering fix**: tool
  events share the `deltaWrites` serialized chain (adversarial P0). **Durability
  limitation stated**: SDK in-memory loop isn't crash-resumable mid-loop —
  acceptable only because the one tool is idempotent; durable outer loop is
  v0.7 (research). System-prompt prohibition **replaced not appended** (verifier
  P1). Added `snapshotMaxSteps` accessor + empty-text-on-cap + fake-client
  coverage notes (P2s). Implementation staged: pure registry first (this
  iteration), loop-wiring next.
- **v1 (2026-07-02):** Initial draft.

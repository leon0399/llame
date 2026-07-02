# Close the tool-event persistence coverage gap (integration test)

## Objective

Prove the just-shipped tool loop's **durable contract** in a REAL `executeRun`
against a REAL Postgres — the gap I flagged when shipping it: the fakes ignore
tools, and the mechanism test asserted against in-memory arrays, so the
`executeRun → run_events` persistence path (and the P0 ordering fix) is
typechecked and built but never *executed* by a test.

Grounding: agents-best-practices/observability — a trace must record "tool
calls, tool results summary" such that the run "could be audited or safely
rerun from recorded state." This test asserts exactly that recorded state.

## What it verifies

Given a mock-model `ModelClient` scripted to call `get_current_time` then
answer, driving the REAL AI SDK loop through `RunExecutionService.executeRun`
against a live DB:

1. **run_events land in insert (= stream) order**, the P0 fix holding for real.
   The mock's tool-call step MUST emit a text delta *before* the tool call, so
   there is a buffered delta the wrapper must flush — the test asserts
   `model.delta` lands BEFORE `tool.call` (delete the flush-before-tool code and
   this assertion fails). Full order: `run.started → model.requested →
   model.delta → tool.call → tool.result → … → model.completed → run.completed`;
   `run_events.sequence` is monotonic.
2. `tool.call` payload carries `{ toolName, args }`; `tool.result` carries
   `{ toolName, status }`.
3. The **assistant turn persists** with the model's final answer; the run
   reaches `completed`.
4. Regression guard: a turn with NO available tool still records the
   answer-only lifecycle (no tool events) — the fakes-ignore-tools path stays
   correct.

## Design

- New `run-execution-tools.integration.spec.ts`, `TEST_DATABASE_URL`-gated, run
  by `rls-test.sh` alongside the other `.integration` suites.
- A small reusable `createMockModelClient(languageModel)` helper: a
  `ModelClient` whose `streamText` calls the REAL `ai` `streamText` with the
  passed `MockLanguageModelV3`, forwarding ALL FIVE load-bearing wires —
  `system`/`messages`, `abortSignal`, `tools` + `stopWhen: stepCountIs(maxSteps)`,
  `onChunk`→`onTextDelta`, and `onFinish` (text/usage/finishReason). Missing any
  of `tools` (wrapper never runs), `onTextDelta` (no buffered delta to flush),
  or `onFinish` (no terminal events / assistant message) makes the test
  vacuous or hangs.
- Seed `user → chat → user message → run` via repos inside a `runAs` tx; build
  `RunExecutionService` with a real `TenantDbService` and **no-op
  `CompactionService`/`TitleService` stubs** — both are fire-and-forget and
  would otherwise call `client.streamText` again post-turn (a third mock call,
  exhaustion/leaked-promise risk). Stubbing them scopes the mock to the turn
  under test; they have their own suites.
- Drain via `await result.consumeStream()` (the runs-worker drain pattern), then
  `waitFor(run.completed)` before reading — `onFinish` awaits `deltaWrites`
  before the terminal events, so once `run.completed` exists the whole chain is
  persisted.

## Non-goals (deliberate, named)

- The **answer-only regression guard** is NOT built here: `hasTools` is always
  true today (`get_current_time` is unconditionally allowlisted), so a
  no-tools turn can't be constructed without module-mocking the registry — and
  the answer-only lifecycle is already covered by the fakes-ignore-tools
  chats-messages/worker e2e. Reframed from the v1 draft (which wrongly listed
  it as testable here).
- **`running_tool` status-column transitions** — redundant with the
  `run_events` trace (opencode uses events, not a status flip, for tool
  legibility), AND a per-tool status flip interacts with the #48
  redelivery-dedup gate (which skips a redelivered job only for a fresh
  `running_model`; a `running_tool` mid-flight would slip through). Deferred as
  a distinct, riskier change, not smuggled into a test iteration.
- UI rendering of tool calls (web work).
- A second tool (add only after this integration confidence exists).

## Revision history

- **v2 (2026-07-02):** Round-1 review (single specialist reviewer, cost-
  proportionate for a test verifying an already-deeply-reviewed feature)
  applied. Mandated a text-delta-before-tool-call in the mock script + the
  `model.delta < tool.call` assertion (P0 anti-vacuity); enumerated the five
  mock wires; corrected the false "same construction as chats-rls" claim (that
  spec builds ChatsService, not RunExecutionService) and specified no-op
  compaction/title stubs to avoid the fire-and-forget third mock call; named
  `consumeStream` + `waitFor` as the drain; reframed the unconstructable
  answer-only guard as a non-goal (covered by existing e2e). Implementation
  built to v2 and **verified green against the dev DB** (the ordering assertion
  holds — non-vacuous). The reviewer noted a second independent pass is ideal;
  given the change is a single test verifying an already-two-reviewer-reviewed
  parent, and it runs green proving the exact property, I ship it with the
  single-round disposition the loop instruction specified.
- **v1 (2026-07-02):** Initial.

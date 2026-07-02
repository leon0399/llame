# Browser proof of the tool loop end-to-end

## Objective

Close the one gap in the tool-UI feature: no test drives the WHOLE stack in a
real browser — model calls a tool → API executes it (policy-pre-filtered,
step-bounded) → run-events persist → bridge translates → SSE → `useChat` →
`ToolCallPart` renders. The bridge translator + persistence are unit/
integration-tested; the render path (does `useChat` parse the bridge's chunks
into a `dynamic-tool` part the web shows?) is the untested seam. Also unlocks
browser testing for all future tool work.

Grounding: agents-best-practices/evals — "task success" + "tool selection
precision" + "final answer grounded in tool results" are core eval categories;
this is the positive-path eval (the agent uses the right tool and answers).

## What it verifies

A new browser test sends "what time is it in UTC?"; asserts (a) a
`ToolCallPart` renders showing `get_current_time` (the tool use is visible),
and (b) the final answer streams. This exercises the real openai client + AI
SDK tool loop against the mock, the worker + bridge, and the web render path.

## Design

### Mock model server (`e2e/model-server.ts`) — emit tool calls

The mock speaks OpenAI-compatible `/chat/completions` streaming. Add a
tool-call path, gated so it CANNOT affect existing tests:

- Trigger ONLY when ALL hold: the request body contains `"tools"` (title-gen
  and non-tool turns don't pass tools — verified: TitleService calls
  streamText without tools), the **last `role:"user"` message content**
  matches the **word-boundary** regex `/\btime\b/i`, and the conversation has
  NO prior tool result. Existing browser prompts ("Hello from the browser
  e2e", "Route me through my own key") never mention "time" as a word →
  unaffected.
- **CRITICAL — do NOT `raw.includes("time")` (unlike the SLOW/title checks).**
  `hasTools` is unconditionally true for every real chat turn (`get_current_time`
  is always allowlisted), and the openai provider serializes the tool's
  DESCRIPTION — which contains "time"/"date" — into every request body. So a
  raw-body substring test would fire on ALL 45 e2e and break them. The gate MUST
  JSON-parse `raw`, take the last `role:"user"` message's content, and
  word-boundary-match only that. (Implemented as `classify()` in the mock.)
- First turn → stream one `tool_calls` delta in the AI-SDK-required shape
  (`{index:0, id, type:"function", function:{name:"get_current_time",
   arguments:"{\"timezone\":\"UTC\"}"}}`), then `finish_reason:"tool_calls"`,
  `[DONE]`. Args in one chunk (valid JSON, as the provider requires).
- Follow-up turn (the request now contains a `role:"tool"` result) → stream a
  distinct final answer, e.g. "Here is the current time you requested." — so
  the test can assert it and tell it from the fixed non-tool answer.
- The title-gen (`Generate a short chat title`) branch stays FIRST and returns
  early (unchanged). The tool branch is checked next — BEFORE the SLOW/normal
  answer path — and returns early on a match; SLOW is evaluated only if the
  tool branch didn't fire (harmless: no prompt says both "SLOW" and "time").

### Browser test (`e2e/chat/tool-loop.spec.ts`)

- Auth via the existing fixture; send "what time is it in UTC?".
- Assert the `ToolCallPart` shows `get_current_time` (scope to the message log)
  — the tool use is visible.
- Assert the final answer ("Here is the current time you requested.") renders.
- One focused test (Playwright flake budget — the suite already runs ~10 min).

## Risks / mitigations

- **Breaking existing browser tests** — mitigated by the triple-gate (tools +
  "time" + no prior tool result); existing prompts miss the "time" gate.
- **OpenAI SSE shape wrong → provider throws** — the first delta MUST carry
  `id` + `type:"function"` + `function.name` (provider validates and throws
  `InvalidResponseDataError` otherwise). Verified against `@ai-sdk/openai`
  (installed 3.0.79) `OpenAIChatLanguageModel.doStream`'s tool_calls delta
  branch (~`dist/index.mjs:1013-1034`); full args in one chunk is valid — the
  SDK emits `tool-call` as soon as the args string parses. Note: loop
  continuation is gated on tool-call/output parity, not on `finish_reason`, so
  `finish_reason:"tool_calls"` is correct-shape but not the continuation trigger.
- **Infinite tool loop** — the follow-up detection (tool result present →
  text) stops it; `stopWhen: stepCountIs(4)` is the backstop.
- **Playwright flake** — one test; reuse the hardened harness (60s model
  readiness, port cleanup) from prior iterations.

## Non-goals

- Multi-tool / multi-step scenarios; error/denied tool rendering.
- Asserting run_events over HTTP (covered by the integration test already).

## Revision history

- **v2 (2026-07-02):** Round-1 review (verifier + adversarial, both
  not-converged on spec fidelity — both independently confirmed the
  *implementation* correct). Fixes: (P0) made the "time" gate explicitly
  last-`role:"user"`-message-scoped + word-boundary `/\btime\b/i`, with a
  CRITICAL callout that `raw.includes("time")` would break all 45 e2e because
  the tool's description (containing "time"/"date") ships in every request body
  and `hasTools` is unconditionally true — the implementation already does the
  safe thing; (P1) corrected the SSE citation to `@ai-sdk/openai` 3.0.79's
  `doStream` tool_calls delta (~L1013-1034) — the wire format is
  version-invariant so the mock is correct regardless; noted `finish_reason` is
  not the continuation trigger; fixed the tool-vs-SLOW branch-order wording.
  Implementation built to v2; browser proof running.
- **v1 (2026-07-02):** Initial.

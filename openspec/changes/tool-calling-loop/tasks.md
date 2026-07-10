## 1. Registry + classification + config gate

- [x] 1.1 Tool type + registry module (`apps/api/src/tools/`): `{ id, description, inputSchema, classification, execute(ctx, args) }`; §13.5 classification enum; startup validation (unclassified/duplicate id → fail loud).
- [x] 1.2 Extend the instance-config schema with the `tools` namespace: `tools.allowed` (string array, default empty), `tools.maxStepsPerRun` (integer ≥1, built-in default 8), `tools.callTimeoutSeconds` (integer ≥1, built-in default 15); unknown tool ids in `allowed` fail boot naming the path; update `LlameConfig` type + loader + tests; commented `tools` block in `llame.config.json.example`.
- [x] 1.3 Availability gate: advertised toolset = allowlisted ∩ read_only; refusal path for unlisted/non-read-only/hallucinated tool requests (structured error result, run continues).

## 2. Run-loop execution

- [x] 2.1 Multi-step loop in the run executor (transport-agnostic): model → tool call(s) → execute → append result → continue; stop on final answer or step cap; cap event recorded; loop drives the model to answer at cap.
- [x] 2.2 Input validation against the tool's schema before execution; validation failure = structured error result.
- [x] 2.3 Tenant context: tools execute via `runAs(ownerUserId)` only; absent identity → fail-closed structured error, no reads.
- [x] 2.4 Failure semantics: tool throw → structured error result (no stack traces/config values), run continues; registry-owned timeout wrapper (`AbortSignal.timeout`, per-tool `timeoutSeconds` ?? `tools.callTimeoutSeconds`); ~16KB result truncation with visible marker.

## 3. Persistence + streaming

- [x] 3.1 AI SDK tool-part shapes (`type: "tool-<name>"`, `toolCallId`, `state`, `input`/`output`) persisted on the assistant message; step-cap marker part persisted alongside them when the cap fires (SDK data-part vocabulary); llame-owned tool event types in `run_events`; bridge maps between them (D5/D6).
- [x] 3.2 Run events for tool activity through the run-stream bridge; refresh-mid-tool replay reconstructs call → running → result.
- [x] 3.3 Pin the public-share egress test: tool parts never appear in shared-chat payloads.

## 4. First tool

- [x] 4.1 Conversation-search tool (read_only) calling the SAME search service the web chat search uses (one search path — no parallel query implementation); results scoped to the run owner via the tenant transaction; update the stale "only call site" comment in chats-repository.ts when the second call site lands.
- [x] 4.2 RLS negative tests: owner-only visibility; cross-tenant read returns nothing; absent identity denied.

## 5. Web rendering

- [x] 5.1 Tool-activity part renderer (call + args summary → running → result/error), consistent with existing part renderers; identical output for live-stream and persisted-history paths.
- [x] 5.2 Step-cap notice rendering (visible chip, D6) — rendered from the persisted cap-marker part so live and historical paths show it identically.

## 6. Tests + verification

- [x] 6.1 Unit/integration: every spec scenario mapped to a test (loop steps, cap, gate directions, classification refusal, timeout, failure semantics, no-checkpoint/no-re-execute-on-refresh, part persistence, shared-search-path). See scratchpad/tcl-api-report.md for the scenario→test table.
- [x] 6.2 Browser e2e: a run that calls the conversation-search tool renders live tool activity, survives refresh mid-tool, and renders identically from history. (Precision caveat: "mid-tool" is proven as "mid-run with the tool already resolved" — see spec-file docstring; genuine `input-available`-window reload isn't forceable from e2e without an api-side test hook.)
- [x] 6.3 `pnpm --filter api build`/`test`/`typecheck`/`lint`, web `test`/`typecheck`/`lint`, `rls-test.sh` (unique port) — all green; `openspec validate tool-calling-loop` clean. API side verified green this session (build/typecheck/oxlint/jest/rls-test.sh); web side not independently re-verified here (owned by the separate web cut) — do a final combined check before archiving.

## 7. Docs + follow-through

- [x] 7.1 SPEC §13 note: loop implements §13.5 classification, read-only-only pre-approvals; §7.5 approvals arrive with the first write tool; document the all-system-models-are-tool-capable assumption (capability flag → #167). CHANGELOG entry (same PR).
- [x] 7.2 Compare this spec against the rebased #142 (coupling/inventory report + diff); record salvage/partial/redo verdict and execute it (close #142 with rationale, or adopt its branch as the implementation base).

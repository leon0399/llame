Task groups map 1:1 onto branches in one linear stack, bottom to top, rooted on the
branch carrying this change:

```text
(master) ← spec ← settling ← replay ← json-schema
```

The order is a real dependency this time, not just a `gh stack` constraint. Replay
(group 2) uses the conventional tool-call/tool-result representation, in which every
replayed call must be paired with a result. Settling (group 1) is what guarantees
every call has an outcome available to pair with — without it, a call terminated
mid-flight has nothing to replay as its result.

There is no close-out group: `CHANGELOG.md` and documentation updates belong in the
PR that ships the work they describe, so each group carries its own.

## 1. Settle in-flight tool activity on termination (#293)

- [x] 1.1 Add a failing test proving the run-event translator leaves a tool part open when a run terminates with a call in flight (`tool.requested` → `run.cancelled` emits no tool-output chunk)
- [x] 1.2 Add a failing test proving persisted assistant parts drop an unsettled tool call, so a reload shows the call as absent
- [x] 1.3 In the run executor, emit a durable terminal `tool.completed` run event for every requested-but-unsettled call on the cancel/expire/fail paths, marked as produced by termination rather than by the tool. This is the persistence side; 1.4 is the separate live-stream close in the translator, and neither implies the other
- [x] 1.4 In the stream-bridge translator, close any open tool part on terminal events, alongside the existing text and reasoning closes. This is the live-stream side only; the durable event is 1.3
- [x] 1.5 Persist termination-settled calls instead of filtering them out, preserving occurrence order relative to text and reasoning parts
- [x] 1.6 Make settlement idempotent per `toolCallId` — the part collector currently appends a duplicate part when it sees an unknown id, so a tool that ignores cancellation and completes late would produce two records for one call
- [x] 1.7 Add a test asserting the live outcome and the outcome reconstructed from persistence agree for a run cancelled mid-tool
- [x] 1.8 Repeat 1.1, 1.2 and 1.7 for `run.expired` and `run.failed` — the requirement covers all three terminal paths, and only cancellation is exercised otherwise
- [x] 1.9 Add a test asserting a late completion after a settlement affects neither the live stream nor the persisted message, for each terminal path
- [x] 1.10 Extend `ToolHeader` in `packages/ui` with a cancelled presentation — the AI SDK's `ToolUIPart["state"]` has no cancelled value, and the bridge maps every structured error to `output-error`, which renders a red "Error" badge for a run the user cancelled themselves
- [x] 1.11 Add stories for the cancelled presentation and verify with `run-story-tests`, including the preview URLs in the handoff
- [x] 1.12 Render the cancelled tool state in the chat UI, live and from history
- [x] 1.13 Add the CHANGELOG entry for the settling fix
- [x] 1.14 Add a failing transport-boundary test proving the AI SDK accepts the live termination marker and reconstructs a cancelled tool part; replace the unsupported top-level `cancelled` chunk field with an SDK-supported representation
- [x] 1.15 Add failing tests for every out-of-executor terminal writer (retry-exhaustion expiry and progress-write failure), then centralize durable open-call settlement so `tool.completed` and the persisted assistant part precede the terminal run event
- [x] 1.16 Make the expanded cancelled presentation neutral as well as the badge — no "Error" heading or destructive styling — and pin it in the Cancelled story
- [x] 1.17 Re-run API unit/integration, web typecheck/lint, and Tool Storybook gates after the review repairs
- [x] 1.18 Add failing integration coverage and repair assistant messages synthesized by `settleTerminalRun` so they trigger post-commit chat touch and search reindex/fallback exactly once; preserve telemetry when locally available and do not fabricate it for dead-letter paths
- [x] 1.19 Correct the stale `RunsRepository` invariant comment that names `chat-loop`/`finalizeRun` as the sole terminal writer
- [x] 1.20 Stabilize the turn-telemetry acceptance gate after post-commit settlement repair: the terminal event may close SSE before awaited touch/reindex/telemetry work finishes, so assert telemetry at that documented eventual boundary instead of racing it synchronously
- [x] 1.21 Verify the completed-run/open-call review finding and retain the existing fail-closed rollback: manufacturing a failed tool result for a protocol-corrupt or crashed prior attempt would falsify a completed outcome; the progress-write and settlement-rollback integration cases already pin the reachable failure paths
- [x] 1.22 Verify `markFinished` returns the complete Drizzle `Run` row, including `chatId` and nullable `messageId`, and retain the explicit null guard plus synthesized-assistant integration assertion instead of adding a redundant reload
- [x] 1.23 Reject catch-and-log guards around `settleTerminalRun`: a failed terminal transaction must reject queue work, not be acknowledged; keep the later worker post-drain terminal-state verification as the defense against SDK `onFinish` swallowing callback rejection
- [x] 1.24 Retain durable event reconstruction when an in-memory assistant turn exists because a retried attempt can inherit open calls absent from process memory; do not trade retry correctness for an unmeasured terminal-path optimization
- [x] 1.25 Close the pre-existing Streamdown Mermaid image-load gap exposed by the root PR review: refuse image-capable source forms without rejecting comments or literal `img:` prose, disable HTML labels, pin diagram directives away from image-related configuration, and forbid HTML/SVG image tags with negative tests
- [x] 1.26 Make the eventual telemetry wait stop at the first call and preserve the separate exact-one assertion so duplicate telemetry fails diagnostically instead of timing out
- [x] 1.27 Pin dead-letter logging to the first-writer-won branch and prove first-writer-lost stays silent
- [x] 1.28 Replace the new search/reindex dependency casts in the settlement integration fixture with exported `Pick<>` capabilities and explicit Nest injection tokens
- [x] 1.29 Remove the duplicate cancelled-tool story query while preserving its interaction and neutral-style assertions
- [x] 1.30 Close the quoted-brace Mermaid image-attribute bypass found in post-push review: scan attribute blocks with quote and escape awareness, reject only an unquoted `img:` key, and pin both the exploit and quoted-label false-positive cases

## 2. Replay tool observations into later turns

- [x] 2.1 Add a failing test showing the defect end to end: a tool returns detail the assistant's visible answer does not restate, and the next turn's request carries none of it
- [x] 2.2 Widen the context builder's `ModelMessage` to the SDK's, so message content can carry tool-call and tool-result parts; `models/model-client.ts` already imports the SDK type and `estimateModelRequestTokens` serializes the whole array, so neither needs changing
- [x] 2.3 Delete the three `as AiModelMessage[]` casts this enables — one in `run-execution.service.ts` (`messages as AiModelMessage[]`) and two in `compaction.service.ts` — which exist only because a string-content `role: 'tool'` message does not satisfy `ToolModelMessage`. Leave the unrelated cast in `titles/title.service.ts`, which widens a plain user-role array literal
- [x] 2.4 Replay each round's tool activity as SDK tool-call and tool-result parts, carrying tool identity, arguments, and outcome
- [x] 2.5 Replay refused, errored, timed-out and cancelled calls with their outcome as the result; the cancelled case consumes the durable marker from group 1
- [x] 2.6 Add a test proving every replayed tool call is accompanied by a well-formed tool result, including calls that produced none, whose content reports the outcome rather than narrating an absence — the call/result pair is the trained shape, so this holds whether or not a given provider enforces it
- [x] 2.7 Label replayed result content as tool output whose instruction-like text is not authoritative, and neutralize it with the existing authored-text sanitizer so it cannot close a boundary it did not open or forge a reserved name
- [x] 2.8 Bound the projection per call and per turn
- [x] 2.9 Freeze a call's projection after first emission so the replayed prefix stays byte-identical across turns, with a test asserting two successive turns project it identically
- [x] 2.10 Clear replayed payloads at compaction while keeping the call and its outcome, with a test
- [x] 2.11 Add tests proving provider-native reasoning, provider metadata, credentials, and unrelated tool payloads are still never replayed
- [x] 2.12 Add a test proving a model or provider switch keeps observations in the new provider's representation and drops the original model's provider metadata
- [x] 2.13 Add a test proving a tool called during reasoning output is replayed on the same terms
- [x] 2.14 Add a test proving the live tool loop still observes its own results within the producing run
- [x] 2.15 Verify the replayed pairing survives the SDK's conversion for the provider type llame actually executes — `providerType` is enum `["openai"]` today (native OpenAI plus any OpenAI-compatible endpoint), so a second provider _family_ cannot be exercised yet; record this as a check to repeat when an Anthropic adapter lands
- [x] 2.16 Measure the effect on compaction trigger frequency, since replay adds per-turn context against a threshold proportional to the context window, and record what was measured
- [x] 2.17 Update the `tool-calling` capability **Purpose** in `openspec/specs/tool-calling/spec.md` by hand. It currently states that tool activity "is display-only — never re-fed into model context", which this group reverses. OpenSpec ignores a delta's Purpose for an existing capability and its archive path does not rewrite one, so without this edit the merged canonical spec asserts both the old Purpose and the new requirement
- [x] 2.18 Confirm the `model-system-prompts` delta landed. That capability carries a normative "MUST NOT replay ... display-only tool activity/results" which this group reverses; unlike Purpose it is a requirement, so it is carried by a delta in this change rather than a hand edit — verify after archive that the merged requirement reads the new way and that all eight of its scenarios survived
- [x] 2.19 Update **SPEC.md §28.2** (Model-input trust boundary). It states that "persisted display-only reasoning/tool parts are excluded from replayed context" — the tool half of which this group reverses, while the reasoning half stays true. This is the third shipped document carrying the claim, after the `tool-calling` Purpose (2.17) and the `model-system-prompts` requirement (2.18). It matters most of the three: §28.2 is the trust-boundary section a later capability author would cite to justify stripping tool parts, so leaving it would license reintroducing the defect from the canonical source
- [x] 2.20 Add the CHANGELOG entry for tool-observation replay
- [x] 2.21 Add failing replay tests for persisted `text → tool → text` and sequential multi-tool turns, then preserve that chronology as alternating assistant/tool messages instead of collapsing all text before all calls and all results after
- [x] 2.22 Add failing full-projection budget tests covering oversized inputs and many short observations; enforce the documented 8,000-code-unit per-call and 32,000-code-unit per-turn caps over the complete serialized call/result representation, oldest-first
- [x] 2.23 Add failing compaction tests that preserve bounded structured call/result identity and outcome while clearing payloads; persist a versioned, runtime-validated cleared ledger on the compaction row, carry it across lineage, keep it out of public DTO/search/export surfaces, and replay checkpoint + ledger before the live window instead of dropping every pair into prose
- [x] 2.24 Update the real-Postgres model-switch acceptance test to require portable tool observations while continuing to exclude provider metadata and reasoning; restore the stack's CI gate
- [x] 2.25 Record the repaired compaction measurement, rerun API unit/integration and OpenSpec validation, and leave 2.18 pending until the top layer performs the actual sync/archive verification
- [x] 2.26 Add a replay regression for termination-settled calls after the #296 metadata repair, then read `resultProviderMetadata.llame.cancelled` instead of the obsolete top-level `cancelled` field so cancellation remains distinguishable from a genuine tool error
- [x] 2.27 Resolve the impossible hard-cap/all-pairs-forever contract in the design and delta spec: preserve pairing first, clear oldest payloads next, and when irreducible paired envelopes still exceed a bounded live or compacted ledger, drop the oldest complete pairs atomically with one bounded omission count/marker; never emit an unmatched call or result
- [x] 2.28 Persist a structured error outcome on new tool activity parts so refused, timed-out, unavailable, execution-failed, and termination-settled calls remain distinguishable after replay and compaction; map legacy rows without that field to a generic error without parsing prose
- [x] 2.29 Repair the compaction fallback estimator to count the serialized structured tool projection and compacted ledger when provider usage is unavailable, then pin the trigger against a tool-heavy history
- [x] 2.30 Add a failing capped chronology test with visible text before and after omitted observations, then make live emission match the exact budgeted shape by keeping visible text and the omission marker in separate assistant messages from each assistant-call/tool-result envelope
- [x] 2.31 Add a replay-budget performance regression with thousands of small observations, then replace repeated whole-projection serialization with precomputed pair sizes and incremental accounting so bounding is linear in observation count and payload size
- [x] 2.32 Add hostile persisted-ledger regressions, then fail closed on invalid tool identities or outcomes so a compacted identity-only ledger cannot replay forged payload-like text
- [x] 2.33 Repair the standalone replay-layer model-switch acceptance expectation so visible assistant text, tool calls, and tool results remain separate chronological messages before the later reminder; verify the intermediate PR passes integration before JSON-Schema descendants are applied

## 3. Execute JSON-Schema tools

- [x] 3.1 Allow a tool's input schema to be declared as JSON Schema, accepted as the source ships it — no dialect requirement placed on sources, and no `$schema` rewriting
- [x] 3.2 Pass an `ajv`-backed `validate` to `jsonSchema()` so the SDK's own tool-call parsing validates arguments — `safeValidateTypes` returns success unconditionally when `schema.validate` is undefined, which is what `jsonSchema(doc)` leaves it as, so without this a JSON-Schema tool is unvalidated. Select the `ajv` constructor from the schema's declared `$schema` (`ajv@8` ships `dist/2020` and `dist/2019` beside the draft-07 default), defaulting to draft-07 when absent
- [x] 3.3 Do not add a second validation step in the runner; keep its existing `safeParse` as documented defense-in-depth, widened to handle both schema kinds
- [x] 3.4 Compare a bound JSON-Schema declaration against its live tool without round-tripping through the code-schema conversion
- [x] 3.5 Add a JSON-Schema test tool and prove the full advertise → validate → call → reconstruct-from-history path against it
- [x] 3.6 Add a test proving an unchanged JSON-Schema tool rebinds without being reported as drifted, one proving key-order differences are not drift, and one proving a real content change is
- [x] 3.7 Add tests for dialect handling: a 2020-12 schema validates under 2020-12 rules, a schema with no `$schema` validates under the draft-07 default, and a dialect with no available validator refuses that one tool without affecting others from the same source
- [x] 3.8 Add a test proving invalid arguments to a JSON-Schema tool are refused through the SDK's `InvalidToolInputError` path and surface as the existing non-fatal tool error, rather than merely being constrained at the provider
- [x] 3.9 Pass a cancellation signal into the tool execution context, derived from the run's abort signal and the per-call timeout, keeping a run-abort result distinguishable from a timeout result
- [x] 3.10 Replace the AI SDK `toolCalls` boundary cast in compaction with a typed adapter
- [x] 3.11 Update SPEC §13 and the `apps/api` agent docs for JSON-Schema tool declarations and the strengthened write-tool landmine wording, add the CHANGELOG entry, and remove #214 from ROADMAP once the stack lands
- [x] 3.12 Add RED mixed-catalog tests for malformed and unsupported JSON schemas, then compile/admit each tool before the immutable context snapshot so one bad declaration is refused with tool id/dialect diagnostics while valid siblings remain available
- [x] 3.13 Add RED coverage for supported draft-07 URI variants, then normalize canonical equivalents instead of rejecting a dialect Ajv can validate
- [x] 3.14 Add `ajv-formats` as a direct API dependency and RED valid/invalid standard-format tests so `email`, `uri`, and `date-time` constraints are enforced rather than silently ignored
- [x] 3.15 Add RED cooperative per-call-timeout and parent-run-abort tests, then share one timeout signal with execution and classify parent abort before timeout before ordinary failure so terminal settlement cannot be pre-empted by `execution_failed`
- [x] 3.16 Add real-AI-SDK/real-Postgres coverage for JSON Schema advertise → validate → execute → durable history, invalid SDK arguments continuing as `invalid_input`, and mixed valid/invalid sibling isolation
- [x] 3.17 Add a corrupted or legacy incompatible snapshot regression and replace compaction's nullable-schema non-null assertion with an explicit fail-closed result
- [x] 3.18 Reconcile the delta spec so malformed or invalid schemas, not only unsupported dialects, refuse the affected tool; rerun API and strict OpenSpec gates and record the repaired behavior
- [x] 3.19 Add a pre-aborted parent-signal regression and refuse before `tool.execute` so a tool cannot start new work after its run has already terminated
- [x] 3.20 Add RED coverage for swallowed parent-abort settlement persistence failures and resolved streams that leave a nonterminal run; make the worker reject nonterminal drains for queue retry, and route both cancel-before-start pickup races through central `settleTerminalRun` so durable open tool calls are reconstructed before the terminal event

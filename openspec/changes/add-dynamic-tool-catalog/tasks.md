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
- [ ] 2.18 Confirm the `model-system-prompts` delta landed. That capability carries a normative "MUST NOT replay ... display-only tool activity/results" which this group reverses; unlike Purpose it is a requirement, so it is carried by a delta in this change rather than a hand edit — verify after archive that the merged requirement reads the new way and that all eight of its scenarios survived
- [x] 2.19 Update **SPEC.md §28.2** (Model-input trust boundary). It states that "persisted display-only reasoning/tool parts are excluded from replayed context" — the tool half of which this group reverses, while the reasoning half stays true. This is the third shipped document carrying the claim, after the `tool-calling` Purpose (2.17) and the `model-system-prompts` requirement (2.18). It matters most of the three: §28.2 is the trust-boundary section a later capability author would cite to justify stripping tool parts, so leaving it would license reintroducing the defect from the canonical source
- [x] 2.20 Add the CHANGELOG entry for tool-observation replay

## 3. Execute JSON-Schema tools

- [ ] 3.1 Allow a tool's input schema to be declared as JSON Schema, accepted as the source ships it — no dialect requirement placed on sources, and no `$schema` rewriting
- [ ] 3.2 Pass an `ajv`-backed `validate` to `jsonSchema()` so the SDK's own tool-call parsing validates arguments — `safeValidateTypes` returns success unconditionally when `schema.validate` is undefined, which is what `jsonSchema(doc)` leaves it as, so without this a JSON-Schema tool is unvalidated. Select the `ajv` constructor from the schema's declared `$schema` (`ajv@8` ships `dist/2020` and `dist/2019` beside the draft-07 default), defaulting to draft-07 when absent
- [ ] 3.3 Do not add a second validation step in the runner; keep its existing `safeParse` as documented defense-in-depth, widened to handle both schema kinds
- [ ] 3.4 Compare a bound JSON-Schema declaration against its live tool without round-tripping through the code-schema conversion
- [ ] 3.5 Add a JSON-Schema test tool and prove the full advertise → validate → call → reconstruct-from-history path against it
- [ ] 3.6 Add a test proving an unchanged JSON-Schema tool rebinds without being reported as drifted, one proving key-order differences are not drift, and one proving a real content change is
- [ ] 3.7 Add tests for dialect handling: a 2020-12 schema validates under 2020-12 rules, a schema with no `$schema` validates under the draft-07 default, and a dialect with no available validator refuses that one tool without affecting others from the same source
- [ ] 3.8 Add a test proving invalid arguments to a JSON-Schema tool are refused through the SDK's `InvalidToolInputError` path and surface as the existing non-fatal tool error, rather than merely being constrained at the provider
- [ ] 3.9 Pass a cancellation signal into the tool execution context, derived from the run's abort signal and the per-call timeout, keeping a run-abort result distinguishable from a timeout result
- [ ] 3.10 Replace the AI SDK `toolCalls` boundary cast in compaction with a typed adapter
- [ ] 3.11 Update SPEC §13 and the `apps/api` agent docs for JSON-Schema tool declarations and the strengthened write-tool landmine wording, add the CHANGELOG entry, and remove #214 from ROADMAP once the stack lands

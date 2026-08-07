Task groups map 1:1 onto branches in one linear stack, bottom to top, rooted on the
branch carrying this change:

```
(master) ← spec ← continuity-eval ← settling ← boundary ← json-schema
```

The groups are **mutually independent** — nothing in the implementation forces an
order among them. The stack is linear because `gh stack` is. Two things drive the
order chosen:

- **The eval leads because its outcome is an input to #215, not to #214.** It
  measures the boundary as it behaves today, using the already-shipped
  `search_conversations` tool, so it needs none of the code below it. Running it last
  would mean planning #215 before its input exists.
- **Settling leads the code** because it fixes a live user-visible defect (#293).

There is no close-out group: `CHANGELOG.md` and documentation updates belong in the
PR that ships the work they describe, so each group carries its own.

## 1. Measure continuity

Runnable against current `master` — it exercises today's boundary with today's tool.

- [ ] 1.1 Add a model-graded eval under `RUN_MODEL_EVALS=1`: after a tool call whose result carried a fact the assistant's answer did not restate, does the next turn still answer correctly? CI never runs it, so this is a one-time judgement, not a gate
- [ ] 1.2 Run 1.1 by hand and record the outcome in this change, whichever way it goes, so #215 inherits an answer rather than the question
- [ ] 1.3 If the outcome is "insufficient", note in this change that the observation projection falls to #215, and point at the shape already designed in the harness audit

## 2. Settle in-flight tool activity on termination (#293)

- [ ] 2.1 Add a failing test proving the run-event translator leaves a tool part open when a run terminates with a call in flight (`tool.requested` → `run.cancelled` emits no tool-output chunk)
- [ ] 2.2 Add a failing test proving persisted assistant parts drop an unsettled tool call, so a reload shows the call as absent
- [ ] 2.3 Emit a terminal tool-completion for every requested-but-unsettled call on the cancel/expire/fail paths, marked as produced by termination rather than by the tool
- [ ] 2.4 Close any open tool part on terminal events in the translator, alongside the existing text and reasoning closes
- [ ] 2.5 Persist termination-settled calls instead of filtering them out, preserving occurrence order relative to text and reasoning parts
- [ ] 2.6 Make settlement idempotent per `toolCallId` — the part collector currently appends a duplicate part when it sees an unknown id, so a tool that ignores cancellation and completes late would produce two records for one call
- [ ] 2.7 Add a test asserting the live outcome and the outcome reconstructed from persistence agree for a run cancelled mid-tool
- [ ] 2.8 Add a test asserting a late completion after a settlement does not replace it or duplicate the record
- [ ] 2.9 Extend `ToolHeader` in `packages/ui` with a cancelled presentation — the AI SDK's `ToolUIPart["state"]` has no cancelled value, and the bridge maps every structured error to `output-error`, which renders a red "Error" badge for a run the user cancelled themselves
- [ ] 2.10 Add stories for the cancelled presentation and verify with `run-story-tests`, including the preview URLs in the handoff
- [ ] 2.11 Render the cancelled tool state in the chat UI, live and from history
- [ ] 2.12 Add the CHANGELOG entry for the settling fix

## 3. Pin the tool-observation replay boundary

- [ ] 3.1 Add characterization tests proving a later turn on the same model receives no raw persisted tool result, provider-native tool block, or provider-native reasoning
- [ ] 3.2 Add characterization tests proving the same exclusion across a model and provider switch
- [ ] 3.3 Add characterization tests proving compaction input excludes the same categories
- [ ] 3.4 Add a test proving the live tool loop still observes its own tool results within the producing run
- [ ] 3.5 Add a deterministic information-loss test: a fact present in a tool result and absent from the assistant's visible text does not reach the next turn's request. This is the CI-enforceable counterpart to group 1's eval and becomes the durable boundary contract
- [ ] 3.6 Add the CHANGELOG entry for the pinned boundary contract

## 4. Execute JSON-Schema tools

- [ ] 4.1 Allow a tool's input schema to be declared as JSON Schema, and validate arguments against whichever form the tool declared — the AI SDK's `Schema.validate` is optional and `jsonSchema()` leaves it undefined, so a JSON-Schema tool needs an explicit validator or it gets none; `ajv` is already a direct dependency (draft-07 needs the plain `Ajv` class, not the `Ajv2020` the config loader uses)
- [ ] 4.2 Compare a bound JSON-Schema declaration against its live tool without round-tripping through the code-schema conversion
- [ ] 4.3 Add a JSON-Schema test tool and prove the full advertise → validate → call → reconstruct-from-history path against it
- [ ] 4.4 Add a test proving an unchanged JSON-Schema tool rebinds without being reported as drifted
- [ ] 4.5 Add a test proving invalid arguments to a JSON-Schema tool are refused server-side, not merely constrained at the provider
- [ ] 4.6 Pass a cancellation signal into the tool execution context, derived from the run's abort signal and the per-call timeout, keeping a run-abort result distinguishable from a timeout result
- [ ] 4.7 Replace the AI SDK `toolCalls` boundary cast in compaction with a typed adapter
- [ ] 4.8 Update SPEC §13 and the `apps/api` agent docs for JSON-Schema tool declarations and the strengthened write-tool landmine wording, add the CHANGELOG entry, and remove #214 from ROADMAP once the stack lands

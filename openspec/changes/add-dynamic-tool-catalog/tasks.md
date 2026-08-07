Task groups map 1:1 onto branches in one linear stack, bottom to top, rooted on the
branch carrying this change:

```text
(master) ← spec ← settling ← replay ← json-schema
```

The order is a real dependency this time, not just a `gh stack` constraint: the
projection (group 2) must be able to represent a call that was cancelled, and the
durable record that makes that possible is what group 1 creates.

There is no close-out group: `CHANGELOG.md` and documentation updates belong in the
PR that ships the work they describe, so each group carries its own.

## 1. Settle in-flight tool activity on termination (#293)

- [ ] 1.1 Add a failing test proving the run-event translator leaves a tool part open when a run terminates with a call in flight (`tool.requested` → `run.cancelled` emits no tool-output chunk)
- [ ] 1.2 Add a failing test proving persisted assistant parts drop an unsettled tool call, so a reload shows the call as absent
- [ ] 1.3 Emit a terminal tool-completion for every requested-but-unsettled call on the cancel/expire/fail paths, marked as produced by termination rather than by the tool
- [ ] 1.4 Close any open tool part on terminal events in the translator, alongside the existing text and reasoning closes
- [ ] 1.5 Persist termination-settled calls instead of filtering them out, preserving occurrence order relative to text and reasoning parts
- [ ] 1.6 Make settlement idempotent per `toolCallId` — the part collector currently appends a duplicate part when it sees an unknown id, so a tool that ignores cancellation and completes late would produce two records for one call
- [ ] 1.7 Add a test asserting the live outcome and the outcome reconstructed from persistence agree for a run cancelled mid-tool
- [ ] 1.8 Repeat 1.1, 1.2 and 1.7 for `run.expired` and `run.failed` — the requirement covers all three terminal paths, and only cancellation is exercised otherwise
- [ ] 1.9 Add a test asserting a late completion after a settlement affects neither the live stream nor the persisted message, for each terminal path
- [ ] 1.10 Extend `ToolHeader` in `packages/ui` with a cancelled presentation — the AI SDK's `ToolUIPart["state"]` has no cancelled value, and the bridge maps every structured error to `output-error`, which renders a red "Error" badge for a run the user cancelled themselves
- [ ] 1.11 Add stories for the cancelled presentation and verify with `run-story-tests`, including the preview URLs in the handoff
- [ ] 1.12 Render the cancelled tool state in the chat UI, live and from history
- [ ] 1.13 Add the CHANGELOG entry for the settling fix

## 2. Replay tool observations into later turns

- [ ] 2.1 Add a failing test showing the defect end to end: a tool returns detail the assistant's visible answer does not restate, and the next turn's request carries none of it
- [ ] 2.2 Project each round's tool observations into later turns — tool identity, what it was asked, and outcome status — inside the existing portable message shape, never as provider-native tool blocks
- [ ] 2.3 Project refused, errored, timed-out and cancelled calls as having produced no result, rather than omitting them; the cancelled case consumes the durable marker from group 1
- [ ] 2.4 Fence and label projected observations as historical observation data, reusing the existing checkpoint-envelope and authored-text sanitizer rather than inventing a second mechanism
- [ ] 2.5 Bound the projection per call and per turn
- [ ] 2.6 Freeze a call's projection after first emission so the replayed prefix stays byte-identical across turns, and add a test asserting two successive turns project it identically
- [ ] 2.7 Clear projected payloads at compaction while keeping the call and its outcome, and add a test for it
- [ ] 2.8 Add tests proving provider-native tool blocks, provider-native reasoning, credentials, and unrelated tool payloads are still never replayed
- [ ] 2.9 Add a test proving a model or provider switch keeps observations but drops provider-native metadata
- [ ] 2.10 Add a test proving a tool called during reasoning output is projected on the same terms
- [ ] 2.11 Add a test proving the live tool loop still observes its own results within the producing run
- [ ] 2.12 Check the effect on compaction trigger frequency, since replay adds per-turn context against a threshold proportional to the context window, and record what was measured
- [ ] 2.13 Add the CHANGELOG entry for tool-observation replay

## 3. Execute JSON-Schema tools

- [ ] 3.1 Allow a tool's input schema to be declared as JSON Schema in the draft-07 dialect, refusing a declaration whose `$schema` names another dialect at contribution time, and validate arguments against whichever form the tool declared — the AI SDK's `Schema.validate` is optional and `jsonSchema()` leaves it undefined, so a JSON-Schema tool needs an explicit validator or it gets none; `ajv` is already a direct dependency (draft-07 needs the plain `Ajv` class, not the `Ajv2020` the config loader uses)
- [ ] 3.2 Compare a bound JSON-Schema declaration against its live tool without round-tripping through the code-schema conversion
- [ ] 3.3 Add a JSON-Schema test tool and prove the full advertise → validate → call → reconstruct-from-history path against it
- [ ] 3.4 Add a test proving an unchanged JSON-Schema tool rebinds without being reported as drifted, one proving key-order differences are not drift, and one proving a real content change is
- [ ] 3.5 Add a test proving a declaration in an unsupported dialect is refused at contribution
- [ ] 3.6 Add a test proving invalid arguments to a JSON-Schema tool are refused server-side, not merely constrained at the provider
- [ ] 3.7 Pass a cancellation signal into the tool execution context, derived from the run's abort signal and the per-call timeout, keeping a run-abort result distinguishable from a timeout result
- [ ] 3.8 Replace the AI SDK `toolCalls` boundary cast in compaction with a typed adapter
- [ ] 3.9 Update SPEC §13 and the `apps/api` agent docs for JSON-Schema tool declarations and the strengthened write-tool landmine wording, add the CHANGELOG entry, and remove #214 from ROADMAP once the stack lands

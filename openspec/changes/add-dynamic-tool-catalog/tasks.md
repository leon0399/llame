Task groups map 1:1 onto branches in the implementation stack, bottom to top.
Groups 1 and 2 are independent of each other and of the rest.

## 1. Settle in-flight tool activity on termination (#293)

- [ ] 1.1 Add a failing test proving the run-event translator leaves a tool part open when a run terminates with a call in flight (`tool.requested` → `run.cancelled` emits no tool-output chunk)
- [ ] 1.2 Add a failing test proving persisted assistant parts drop an unsettled tool call, so a reload shows the call as absent
- [ ] 1.3 Emit a terminal tool-completion for every requested-but-unsettled call on the cancel/expire/fail paths, marked as produced by termination rather than by the tool
- [ ] 1.4 Close any open tool part on terminal events in the translator, alongside the existing text and reasoning closes
- [ ] 1.5 Persist termination-settled calls instead of filtering them out, preserving occurrence order relative to text and reasoning parts
- [ ] 1.6 Add a test asserting the live outcome and the outcome reconstructed from persistence agree for a run cancelled mid-tool
- [ ] 1.7 Render the cancelled tool state in the chat UI, live and from history
- [ ] 1.8 Add the CHANGELOG entry for the settling fix

## 2. Pin the tool-observation replay boundary

- [ ] 2.1 Add characterization tests proving a later turn on the same model receives no raw persisted tool result, provider-native tool block, or provider-native reasoning
- [ ] 2.2 Add characterization tests proving the same exclusion across a model and provider switch
- [ ] 2.3 Add characterization tests proving compaction input excludes the same categories
- [ ] 2.4 Add a test proving the live tool loop still observes its own tool results within the producing run

## 3. Execute JSON-Schema tools

- [ ] 3.1 Allow a tool's input schema to be declared as JSON Schema, and validate arguments against whichever form the tool declared
- [ ] 3.2 Compare a bound JSON-Schema declaration against its live tool without round-tripping through the code-schema conversion
- [ ] 3.3 Add a JSON-Schema test tool and prove the full advertise → validate → call → reconstruct-from-history path against it
- [ ] 3.4 Add a test proving an unchanged JSON-Schema tool rebinds without being reported as drifted
- [ ] 3.5 Add the replay-safety flag to the tool contract and refuse to register a tool that omits it
- [ ] 3.6 Exclude an unsafe-to-replay tool from advertisement and execution, reporting the exclusion
- [ ] 3.7 Pass a cancellation signal into the tool execution context, derived from the run's abort signal and the per-call timeout
- [ ] 3.8 Replace the AI SDK `toolCalls` boundary cast in compaction with a typed adapter

## 4. Measure continuity

- [ ] 4.1 Add a multi-turn continuity test recording whether visible assistant text alone preserves the facts a later turn needs after a JSON-Schema tool call
- [ ] 4.2 Record the measured outcome in this change, whichever way it goes, so #215 inherits an answer rather than the question

## 5. Documentation and close-out

- [ ] 5.1 Update SPEC §13.5 for the replay-safety dimension
- [ ] 5.2 Update the `apps/api` agent documentation for JSON-Schema tool declarations
- [ ] 5.3 Add the CHANGELOG entry
- [ ] 5.4 Run lint, typecheck, unit, and integration suites across the stack and confirm the browser paths stay green

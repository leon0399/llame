Task groups map 1:1 onto branches in the implementation stack, bottom to top.
Groups 1 and 2 are independent of the catalog work and of each other; everything
from group 3 up is sequential.

## 1. Settle in-flight tool activity on termination (#293)

- [ ] 1.1 Add a failing test proving the run-event translator leaves a tool part open when a run terminates with a call in flight (`tool.requested` → `run.cancelled` emits no tool-output chunk)
- [ ] 1.2 Add a failing test proving persisted assistant parts drop an unsettled tool call, so a reload shows the call as absent
- [ ] 1.3 Emit a terminal tool-completion for every requested-but-unsettled call on the cancel/expire/fail paths, carrying a marker that identifies it as produced by termination rather than by the tool
- [ ] 1.4 Close any open tool part on terminal events in the translator, alongside the existing text and reasoning closes
- [ ] 1.5 Persist termination-settled calls instead of filtering them out, preserving occurrence order relative to text and reasoning parts
- [ ] 1.6 Add a test asserting the live stream outcome and the outcome reconstructed from persistence agree for a run cancelled mid-tool
- [ ] 1.7 Add a test asserting a termination settlement is distinguishable from a genuine tool error in the durable record
- [ ] 1.8 Render the cancelled tool state in the chat UI, live and from history
- [ ] 1.9 Add the CHANGELOG entry for the settling fix

## 2. Pin the tool-observation replay boundary

- [ ] 2.1 Add characterization tests proving a later turn on the same model receives no raw persisted tool result, provider-native tool block, or provider-native reasoning
- [ ] 2.2 Add characterization tests proving the same exclusion across a model and provider switch
- [ ] 2.3 Add characterization tests proving compaction input excludes the same categories
- [ ] 2.4 Add a test proving the live tool loop still observes its own tool results within the producing run
- [ ] 2.5 Confirm the tool-part egress exclusion for public shares still holds under the new part shapes from group 1

## 3. Widen the tool contract

- [ ] 3.1 Allow a tool's input schema to be supplied as JSON Schema as well as in code, without weakening validation for either form
- [ ] 3.2 Validate call arguments against whichever schema form the tool declared
- [ ] 3.3 Add the replay-safety dimension to the tool contract, separate from the SPEC §13.5 safety classification, and reject a tool declaring neither dimension
- [ ] 3.4 Refuse to advertise or execute a tool declaring itself unsafe to replay, and report the exclusion rather than dropping it silently
- [ ] 3.5 Add a declared origin to every catalog entry
- [ ] 3.6 Add a per-tool result limit to the contract (policy for deriving limits from the context window stays out — see #294)
- [ ] 3.7 Extract one canonicalization routine shared by snapshot-time hashing and bind-time comparison, and compare JSON-Schema-native tools without round-tripping through the code-schema conversion
- [ ] 3.8 Add a test proving a JSON-Schema-native tool binds and rebinds without manufacturing a declaration mismatch
- [ ] 3.9 Replace the AI SDK `toolCalls` boundary cast in compaction with a typed adapter

## 4. Catalog-driven resolution and the availability gate

- [ ] 4.1 Introduce the catalog interface and resolve both snapshot binding and execution through it
- [ ] 4.2 Make the in-code registry one contributing source rather than the catalog itself
- [ ] 4.3 Add the in-process dynamic tool source used as the test fixture (JSON-Schema-declared, no transport)
- [ ] 4.4 Fail closed and report when two sources contribute the same tool id
- [ ] 4.5 Enforce provider-legal tool ids and the reserved dynamic namespace at contribution time, including refusing a static id that occupies the reserved prefix
- [ ] 4.6 Split `tools.allowed` boot validation by id form: static ids resolve strictly, namespaced ids validate only that their source is declared
- [ ] 4.7 Fail boot when a namespaced id references a source that is not declared in configuration
- [ ] 4.8 Keep an allowlisted-but-unresolved namespaced id fail-closed and non-fatal to a run
- [ ] 4.9 Add tests covering the full advertise → validate → call → reconstruct-from-history path for the dynamic fixture tool
- [ ] 4.10 Update the published config JSON Schema and the `apps/api` config documentation for the split validation

## 5. Withdraw on declaration drift

- [ ] 5.1 Withdraw only the mismatched tool for the turn instead of failing the run, leaving other tools available
- [ ] 5.2 Withdraw on the same terms when a bound declaration has no live catalog entry at all
- [ ] 5.3 Record the withdrawal as durable run activity naming the tool
- [ ] 5.4 Route a model request for a withdrawn tool through the existing non-fatal refusal path
- [ ] 5.5 Add a test proving a drifted tool does not fail the run and does not return until a live entry matches its bound declaration

## 6. Payload hygiene

- [ ] 6.1 Apply redaction on the tool-activity persistence and streaming path, covering call arguments as well as results
- [ ] 6.2 Add tests proving credential-shaped values in arguments and in results do not reach durable run activity in recoverable form
- [ ] 6.3 Neutralize externally supplied tool descriptions and schema prose where the catalog entry is built, reusing the existing authored-text sanitizer
- [ ] 6.4 Add a test proving hostile description markup cannot escape its boundary in the snapshot, the hashes, or the receipt
- [ ] 6.5 Add a test proving ordinary description prose survives neutralization unchanged in meaning

## 7. Continuity measurement and conditional projection

- [ ] 7.1 Add a multi-turn continuity test recording whether visible assistant text alone preserves the facts a later turn needs after a dynamic tool call
- [ ] 7.2 Record the measured outcome in the change record, whichever way it goes
- [ ] 7.3 CONDITIONAL on 7.1 showing a real failure: implement the provider-neutral observation projection — labelled untrusted historical data, bounded, frozen once projected so the replayed prefix stays stable
- [ ] 7.4 CONDITIONAL on 7.3: add tests proving the projection excludes credentials, private metadata, provider-native blocks, and unrelated tool payloads
- [ ] 7.5 CONDITIONAL on 7.3: add a test proving a projection does not change on subsequent turns

## 8. Documentation and close-out

- [ ] 8.1 Update SPEC §13.5 for the replay-safety dimension and §9.4 for any new run-event family
- [ ] 8.2 Update SPEC §13 and the `apps/api` agent documentation for catalog-driven resolution and the split allowlist validation
- [ ] 8.3 Add the CHANGELOG entry for the dynamic tool catalog
- [ ] 8.4 Remove #214 from ROADMAP once the stack lands
- [ ] 8.5 Run lint, typecheck, unit, and integration suites across the full stack and confirm the browser paths stay green

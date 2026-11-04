## Context

See proposal.md "Why". Facts below are at `a969a445`.

- **Live loop.** `streamText` builds each step's input from its own messages and
  the response messages of earlier steps (`ai@6.0.256` `toResponseMessages`,
  `dist/index.js:4310-4443`). A step's response is one assistant message with
  its reasoning, text, and calls, then one tool message with the results. Text,
  reasoning, tool-call, and tool-result parts carry `providerOptions` from the
  adapter's `providerMetadata` (`:4328-4377`). llame's per-step seam is
  `installStepPreparation` (`apps/api/src/models/step-composer.ts:539-580`):
  it splices in-Run context items and composes media into a per-step copy.
- **Live rendering.** `toModelOutput` returns
  `modelToolOutput(renderToolResultForModel(id, output), mediaRef)` with no
  frame (`apps/api/src/runs/run-execution.service.ts:1879-1898`). JSON-kind
  tools give a `json` output (`apps/api/src/tools/model-text.ts:187-209`).
- **Storage.** `toolActivityPart` stores the capped `ToolResult`, the input,
  the outcome, and `artifact` (`apps/api/src/runs/assistant-transcript.ts:369-430`).
  Only reasoning parts keep `providerMetadata` (`:200-245`). No part keeps the
  step number. `tool.requested` events carry `stepNumber` (`run-execution.service.ts:1529`).
  `messages.parts` is `jsonb` (`apps/api/src/db/schema/chats.ts:251`), and
  `jsonb` stores object keys sorted by length, then bytewise:
  `'{"type":"error","message":"x","status":"error"}'::jsonb` returns
  `{"type": "error", "status": "error", "message": "x"}`.
- **Replay.** `buildContext` (`apps/api/src/chats/context-builder.ts:449-545`)
  sends text as its own assistant message and each tool pair as its own
  assistant and tool message (`:332-341`). `projectToolObservations`
  (`apps/api/src/chats/tool-observation-part.ts:605-622`) wraps each result in
  `prompts/tool-output-untrusted.md`, adds `Artifact:`, forces `text` output,
  and applies the 8,000 and 32,000 budget (`:40-41`, `:359-461`). Reasoning
  replays only for `requestKind: 'continuation'` (`context-builder.ts:419-424`).
  A compaction request carries none (`:513-516`).
- **Continue.** `continue-projection.ts` already sends kept results with the
  live builder, grouped by `run.continued.steps`, with no budget (`:160-215`, `:300-356`).
- **Compaction.** `planCompactionCheckpoint` absorbs every row below the
  trigger (`apps/api/src/compaction/compaction.ts:354-370`). The trigger,
  the fit check, and the summary request all measure `buildContext` output,
  so today they measure the budgeted size (`:203-233`, `:390-409`).
- **Responses wire.** `openai-model-client.ts:403-406` leaves `store` unset.
  `@ai-sdk/openai@3.0.97` then defaults it to `true` (`dist/index.js:5322`) and
  replays reasoning as `item_reference` (`:3344-3353`), as
  `continue-wire.test.ts:172-180` asserts. The Codex wire pins `store: false`.
- **Reply identity.** Each reply row records `usage.modelId` and
  `usage.status` (`completed`, `aborted`, or `error`; `running` while in
  flight), written by `apps/api/src/runs/run-reply-finalizer.ts:111-130`,
  `:160-176` and `apps/api/src/chats/turn-telemetry.ts`. A row from before usage
  existed has neither.
- **Refused calls.** `refuseUnavailableToolCalls` returns `null` from the repair
  hook (`apps/api/src/models/tool-call-gate.ts:120-137`). The SDK then sends a
  `tool-error` with `getErrorMessage(error)` as `error-text`, and `{}` for an
  input that is not an object (`ai` `dist/index.js:6854-6866`, `:4358`,
  `:4416-4428`). llame stores its own refusal message and the raw input.
- **Seams.** `onTextDelta(text)` carries no part id and no metadata
  (`apps/api/src/models/model-client.ts:161`), the collector appends each text
  delta to the previous text part (`assistant-transcript.ts:180-188`), and the
  plain Responses client ignores the `tool-call` chunk metadata.

## Goals / Non-Goals

**Goals:**

- One projection from parts to model messages, with the same output for a
  later turn, a Continue Run, and a compaction request.
- Within one llame version, turn N+1 starts with the messages of turn N's last
  request and its response, proved by one integration test.

**Non-Goals:**

- Byte identity on the provider wire. The SDK adapter and request-time media
  composition stay outside the projection. Both are deterministic for the same
  input (proposal A5).
- Cache-hit measurement (proposal A6).

## Prior art

Verified in source. Each harness rebuilds the request from a stored record and
removes nothing by turn age.

| Harness              | Stored unit                                             | Earlier reasoning and metadata                                                                         | Tool results on replay                            |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| OMP `ef3293b6`       | one assistant message per model call                    | kept while provider, api, and model match (`transform-messages.ts:528,1150`); a switch demotes to text | stored result, no budget                          |
| OpenCode `1bf08ae4`  | one assistant message per step (v1: `step-start` parts) | metadata reused when same model and no error (`to-llm-message.ts:142-143`)                             | stored result; only compaction prunes             |
| Codex CLI `d92aae55` | flat response items                                     | all kept, `store: false` (`client.rs:1163`); the server decides use (`:1010-1019`)                     | stored items; only compaction or rollback deletes |
| pi-mono `c856eb0b`   | one message per model call                              | kept when provider, api, and model match, else dropped (`transform-messages.ts:122-138`)               | stored result                                     |
| OpenClaw `d40aa7c6`  | session transcript                                      | signed reasoning kept, unsigned prior-turn reasoning dropped (`thinking.ts:106-122`)                   | stored result                                     |

llame stores one row per turn, so it is the only one that loses the step
boundary. D5 adds back exactly that bit.

## Decisions

Codes D1 to D14 are the grilling record, in proposal.md.

### D1: Remove the artifacts replay line here

`tool-result-artifacts` synced and archived during this review. Its
`tool-calling` requirement "A replayed pair keeps its artifact locator" adds the
`Artifact:` line under the budget, and its `web-search` text replays the result
as untrusted tool output. This change REMOVES the first and MODIFIES the second.
The cap notice keeps the locator in the live text.

### D2, D6: No replay budget, no new compaction path

Replay sends every part after the checkpoint. A request that does not fit goes
through the existing trigger: window compaction, or `context_incompatible`.
The window variant can still fail: it summarizes with the last completed Run's
model, it can absorb later failed replies of other models, and its fit check is
an estimate. That failure is the existing `context_incompatible` path. Rejected: a ceiling at the 16,000 execution cap
(it keeps the clearing code for error text and inputs, exactly the repro's
`edit` input); summarizer-only clearing; chunked summarization.

### D3: One rendering, no frame

Replay calls the live builder: `modelToolOutput(renderToolResultForModel(...))`
from the stored success object, or from the failure object that
`tool-result-rendering` already rebuilds from the stored outcome, error text,
and rejected locator. The frame template and the `Artifact:` line go; the cap
notice already names the artifact. A call that the SDK refused is the one case
where the live result does not come from llame's renderer. The repair hook
(`tool-call-gate.ts`) gets the same error object that the SDK reports, so it
stores `getErrorMessage(error)` and the SDK's form of the input in two
model-only fields. Their presence marks the call, because an executor that
returns `not_available` stores the same outcome and error text. Replay sends
the SDK's `error-text`; the owner-facing `errorText` stays llame's (proposal
A8). Rejected for that case: rewrite the SDK result in the live loop (it changes
what the model sees today and cannot reach the last step); overwrite
`errorText` (it shows the SDK's raw validation dump to the owner and cannot be
told apart from an executor's refusal). Rejected for all results: frame the live
loop too (about 140 units more on each live result, and Continue already sends
unframed); keep the replay frame (the prefix breaks at the first tool result).

The frame was the only untrusted label on replayed results. The live loop never
had it, so the model already acts on unframed results in the turn that runs the
tool. Neutralization of reserved delimiters stays on both paths.

### D4: Rebuild from parts within one version

No transcript column and no backfill. The equality guarantee holds for one llame
version; a renderer change between versions can change history once. To make
the rebuild exact, parts must hold what the live step held: the step number
(D5), the member order (D13), and the provider metadata of text and tool parts
(proposal A7). Rejected: a stored copy of the model messages per turn (a second
source of truth that Continue, regenerate, and forks must keep in step).

### D5: `step` on each part

The collector stamps the current SDK step number on each text, reasoning, and
tool part, on the live path and in the event-log rebuild (`tool.requested`
already carries `stepNumber`; text and reasoning events gain it). The SDK
numbers steps from 0 in each `streamText` call, so a Continue Run adds the
highest kept step plus one, as `continue-projection.ts` already offsets today.
Continue admission copies the step number of each kept tool part stored without
one from its `tool.requested` event, so an older Run keeps its boundaries.

The projection groups parts with the same `step` into one step. A step can
write text after its calls, because the SDK keeps `[text, call, text]` in one
message; a step number per part keeps that text in place. Rows stored before
this change use the Continue rule: a run of consecutive tool parts, with the
text and reasoning before it, is one step.

Each step becomes one assistant message (reasoning, text, calls, in stored
order) and one tool message (results in call order). A `data-context` part on
the reply follows the tool message of the step before it, which is where the
live splice puts it. Rejected: an AI SDK `step-start` part (a new part type and
a web hide rule); a step number on tool parts only (text after a step's calls
moves to the next step); reading events at replay time (a query per row).

### D7: Model rule for reasoning and provider metadata

A part's provider metadata, and an earlier turn's reasoning part, replay when
the row's `usage.modelId` equals the request's model id and `usage.status` is
`completed`. A row without them replays neither. Within a Run, the SDK carries reasoning between steps itself. A
Continue Run's kept parts are the same turn, so only the model check applies
(proposal A3). Rejected: send all reasoning and let adapters skip foreign
metadata (adapters warn on every switch, and `openai-completions` sends any
reasoning text as `reasoning_content`); prune at the turn boundary (breaks the
cache on keep-all models, and DeepSeek returns 400 with tools).

### D9: Compaction uses the same projection

`buildCompactionRequest` builds the absorbed rows like a later turn and appends
the instruction. The `ContextRequestKind` split goes. On the same model, the
summary request then shares the previous turn's prefix.

### A7: Provider metadata on text and tool parts

The `seams` layer adds a text-part seam to each model client: the adapter's
text part id and metadata, in stream order, the way reasoning already arrives.
`onChunk` carries the text id on `text-delta`, and `fullStream` carries the
metadata. The collector starts a new text part when the text id changes, so two
Responses `message` items stay two parts. Each client forwards the `tool-call`
chunk metadata, including a Chat Completions `thoughtSignature`. The metadata is
stored once, on the call; replay copies it to the result of a call that ran, as
the SDK does (`ai` `dist/index.js:3118-3126`). Event payloads carry both, so the
event-log rebuild keeps them. The chat DTO, the UI chunk stream, exports,
search, public shares, logs, and telemetry carry none of it, as for reasoning
metadata today.

### D11: One projection module

The later-turn path, Continue, and compaction call one function from stored
rows (and kept parts) to `ModelMessage[]`. `continue-projection.ts` keeps only
its kept-part selection. `run.continued` keeps `parts` and loses `steps` and
`results`: the stored parts now carry both.

### D12: `store: false` on `openai-responses`

The client adds `store: false` as an invariant, like the Codex client. The
`@ai-sdk/openai` adapter asks for `reasoning.encrypted_content` only when it
treats the model as a reasoning model, from a model-id prefix
(`dist/index.js:5357-5360`). The client therefore passes `forceReasoning: true`
for an entry that declares `reasoning`, so a reasoning entry under any id asks.
It passes nothing for another entry, so the adapter keeps its id rule: a
`gpt-5` id still asks and gets the `reasoningSummary` default, and `gpt-4.1`
does not ask, which OpenAI would reject. A part persisted with only an item id
is omitted by the SDK (`dist/index.js:3682-3691`). This layer lands before
`replay`, so the new text and tool item ids never replay as `item_reference`.

### D13: `messages.parts` as `json`

One Drizzle migration: `ALTER TABLE messages ALTER COLUMN parts TYPE json USING
parts::json`. The cast keeps the sorted order of existing rows. `hasVisibleText`
moves to `json_array_elements`. `json` keeps the written text, so JavaScript
`JSON.parse` returns members in written order. Integer-like keys sort first in
JavaScript on both the live and the replay side, so they still agree. No index,
view, or containment operator reads the column; chat search reads
`search_chat_documents`. `run_events.payload` stays `jsonb`. Parts rebuilt from
the event log and the kept `parts` of `run.continued` therefore come back with
sorted keys. They agree with each other, but only rows that the live collector
wrote keep the member order of the live step.

### D14: Prefix-equality integration test

An API integration test with the scripted model client and a test database runs
two turns. The scripted client records each prompt after
`installStepPreparation` today, but emits one call per step with no text and no
metadata. The `harness` layer extends it to emit a whole step through the same
seams as the production clients: parallel calls, text before and after a call,
reasoning start and end with metadata, text and call metadata, a refused call,
and a stream error after a reasoning part. Turn 1 holds a step with two parallel
calls, a step with text before a call, a refused call, a result over the cap
with an artifact, an MCP JSON result, an image read, and reasoning with
metadata. The test asserts three cases on the serialized messages of turn 2's
first request:

- **Same model, completed.** They start with those of turn 1's last request,
  then turn 1's last response messages.
- **Model switch.** Turn 2 runs on another model. The same prefix holds with no
  reasoning part and no provider metadata of turn 1.
- **Failed reply.** The scripted client ends turn 1 with a stream error after a
  reasoning part, so its Run fails, and turn 2 runs on the same model. The
  prefix of turn 1's last request and the stored part of its response holds,
  with no reasoning part and no provider metadata of turn 1.

## Risks / Trade-offs

- [A long Chat written before this change can fail its next turn with
  `context_incompatible`, because its full history replays for the first time]
  → Window compaction runs first. The changelog names the failure and the
  remedy (fork from a recent message). Leo's local data is backed up.
- [Later requests grow in tool-heavy Chats, so compaction fires earlier and
  costs more input] → A cached prefix offsets most of it on providers that
  cache; no new bound (D2).
- [Replayed results lose the untrusted label] → The live loop never had it;
  neutralization stays. Prompt injection inside tool output is the same risk
  live and on replay.
- [A live step shape the projection does not rebuild, for example an in-Run
  item staged before the first tool result, or provider metadata on a part
  type not covered] → D14 fails on the first such difference; each case found
  gets a scenario.
- [A return to an earlier Anthropic model puts back thinking blocks that were
  absent for a turn] → The blocks of the other model are omitted, not the
  returned model's; adaptive requests carry `drop_block` for any stale binding.
- [The `json` migration rewrites the table] → Before first production
  deployment; one-time lock on the dev database.

## Migration Plan

1. `seams`: the text-part seam in each client, and provider metadata on text
   and tool parts and in event payloads.
2. `storage`: `step` on each part, the model-only fields of refused calls, and
   `messages.parts` as `json`. Old rows keep working with the old projection.
3. `responses-store`: `store: false`, before any text or tool item id replays.
4. `live-rendering`: replayed results use the live builder; the frame and the
   `Artifact:` line go.
5. `harness`: the scripted client emits whole steps through the production
   seams.
6. `replay`: the new projection for later turns, with the equality test. The
   first turn of each old Chat takes one cache miss.
7. `compaction`: the compaction request through the projection, and the end of
   `ContextRequestKind`.
8. `continue`: Continue moves to the projection; `run.continued` loses its maps.

Rollback of `storage` needs a `json` to `jsonb` migration, which is lossless
except for member order. The other layers revert as code.

## Open Questions

None that change the specs or the tasks. The exact step a context item takes
when it was staged before any tool result is settled by D14.

## Revision history

- **v6 (2026-11-03), rebase.** `tool-result-artifacts` was archived on
  `master`. Its amendment is replaced by a REMOVED `tool-calling` requirement
  and a MODIFIED `web-search` requirement here; no other canonical block drifted.
- **v5 (2026-11-03), GitHub review round 2 (#1551).** pullfrog: 1 finding,
  accepted. D14 names its three cases, including the failed reply and the
  scripted stream error that makes it, and the `harness` layer (not `replay`)
  owns the scripted client.
- **v4 (2026-11-03), GitHub review round 1 (#1551).** pullfrog: 2 findings,
  both accepted. The prefix rule after a model switch or a failed reply is now
  its own requirement ("A model switch keeps the previous request less the
  omitted parts"), so the model-switch scenario no longer contradicts the
  same-model rule. The `tool-result-artifacts` amendment names the
  `live-rendering` layer, which deletes the `Artifact:` line. CodeRabbit and
  Indent were out of quota.
- **v3 (2026-11-03), review round 2.** Two reviewers; 0 P0, 4 P1, 20 P2.
  Fixed: refused calls keep the SDK text and input in model-only fields, and
  the owner-facing error stays (A8); `forceReasoning` is passed only for entries
  that declare `reasoning`; "Opaque continuation state is transient and
  private" is MODIFIED for A7; every part carries `step`, so text after a
  step's calls stays in it, and Continue copies step numbers for older Runs;
  the model-switch scenario names the media forms; A7 covers the Chat
  Completions call metadata and every metadata sink; `fidelity` splits into
  `seams` and `storage`, and `live-rendering` and `harness` leave `replay`.
  Rejected: nothing.
- **v2 (2026-11-03), review round 1.** Two reviewers (spec consistency,
  feasibility); 0 P0, 13 P1, 15 P2. Fixed: the prefix rule now applies only
  after a completed reply on the same model; steps split on a change of number,
  and Continue numbers after its kept steps; refused calls replay the SDK text
  (A8); text and tool metadata need a client seam (A7); `store: false` keys the
  encrypted-content include on the entry's `reasoning`; the window variant is
  no longer called safe by construction; `durable-runs` and
  `subscription-access-openai-codex` are MODIFIED; the `web-search` phrase is
  amended in `tool-result-artifacts`; `responses-store` moves before `replay`,
  and compaction gets its own layer. Rejected: nothing.
- **v1 (2026-11-03).** Initial draft.

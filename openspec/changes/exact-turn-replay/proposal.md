## Why

A later turn does not show the model what it saw. The live loop sends each tool
result whole. Replay then rebuilds the same turn under a budget of 8,000 UTF-16
units per call pair and 32,000 per stored assistant turn. It clears payloads and
inputs, oldest first, then drops whole pairs behind an omission marker.

- **Lost content.** In Chat `835f2f6e`, one fact-check turn made 19 calls with
  176,510 characters of tool parts. The next turns lost the `read` of the draft
  (8,629 characters) and the `edit` input (22,240 characters). The owner asked
  to restore the original tone, and the model no longer had the original. Each
  new result is capped at 16,000 units at execution, so even a result the model
  saw whole is cleared on the next turn.
- **Broken prompt cache.** Even with no clearing, the replayed bytes differ from
  the live request. The causes are listed below, so the provider cache misses
  from the first tool step of the previous turn on every turn.
  - Replay wraps each result in an untrusted-output frame that the live loop
    never sends. It adds an `Artifact:` line and sends JSON results as text.
  - Replay sends each call as its own step, because stored parts lose the step
    boundary.
  - `jsonb` reorders the object keys of the stored inputs and results.

The spec already says that tool activity "MUST stay available to the model
until a checkpoint absorbs it". The budget contradicts that.

Issue: [#1539](https://github.com/leon0399/llame/issues/1539). This change also
answers the research question of
[#599](https://github.com/leon0399/llame/issues/599), and it supersedes the
open proposal [#1257](https://github.com/leon0399/llame/pull/1257) for
[#891](https://github.com/leon0399/llame/issues/891).

## What Changes

- **New capability `turn-replay`.** One projection turns stored Chat rows into
  model messages. Every request that sends stored turns uses it: a later turn,
  a Continue Run, and a compaction request. Every future feature that sends
  stored turns to a model must use it too.
- **A later request starts with what the previous request sent.** With one
  llame version, when turn N completed on the model of turn N+1, the request of
  turn N+1 starts with the messages of the last request of turn N, then the
  response to that request. After a model switch or a reply that did not
  complete, the differences are the reasoning and provider metadata that the
  model rule omits, and the media forms that the new model's input selects.
- **BREAKING: no replay budget.** Replay removes nothing that a checkpoint has
  not absorbed. The 8,000 and 32,000 limits are removed. So are payload
  clearing, the `input: {}` substitute, the omission marker, and the
  `incomplete` outcome of a cleared partial result. A request that is too large
  goes through the existing compaction and `context_incompatible` rules.
- **BREAKING: tool results replay in their live rendering.** Replay uses the
  output type and the text that the live loop sent. The replay-only
  untrusted-output frame is removed, and so is the replay-only
  `Artifact: <locator>` line. The cap notice already names the artifact.
- **Steps replay as steps.** Each stored text, reasoning, and tool part records
  its model step, and a Continue Run numbers its steps after the kept ones. The calls of
  one step replay as one assistant message, then one tool message. A part with
  no step number uses today's Continue rule: consecutive tool parts are one
  step.
- **A refused call replays as the live step sent it.** For a call that the AI
  SDK refused (an unknown tool or invalid input), the live step sends the SDK's
  error text and the SDK's form of the input. The stored part keeps both in
  model-only fields, and replay sends them (A8).
- **Stored parts keep their bytes.** `messages.parts` changes from `jsonb` to
  `json`, so object keys keep the order in which they were written. Text and
  tool parts also keep the provider metadata of the live step (A7).
- **Earlier reasoning replays only for the model that produced it.** A
  reasoning part of an earlier turn replays only when its reply came from the
  same model entry and its Run completed. Within one turn, and in the kept
  parts of a Continue Run, reasoning replays as today. This replaces the
  current rule, which replays every reasoning part across model switches.
- **A compaction request replays the rows it absorbs like a later turn**, with
  their reasoning, then adds its instruction. Today it removes reasoning, so it
  never shares a cache prefix with the Run it summarizes.
- **Continue uses the same projection.** The `steps` and `results` maps of the
  `run.continued` event are removed. Its kept `parts` stay.
- **The `openai-responses` wire sends `store: false`**, as the Codex wire does.
  An entry that declares `reasoning` also asks for encrypted reasoning content.
  Today the wire replays reasoning as `item_reference` ids, which depend on
  server-side retention at OpenAI.
- **The synced `tool-result-artifacts` replay line goes.** The requirement "A
  replayed pair keeps its artifact locator" is removed, and the `web-search`
  stored-output requirement no longer says the result replays as untrusted tool
  output.

## Assumptions, confirmed with Leo

The grilling of 2026-11-02 and 2026-11-03 settled these. Codes come from the
decision record in design.md.

- **D1.** Branch from `master`. `tool-result-artifacts` synced and archived
  while this proposal was in review, so this change removes its replay line
  and its `web-search` phrase from the canonical specs.
- **D2, D6.** Remove the budget outright. Compaction is the only eviction
  boundary. A request that does not fit fails as `context_incompatible`, with
  no special compaction path.
- **D3.** Replay, Continue, and compaction use the live rendering. The
  replay-only frame and the `Artifact:` line go.
- **D4.** Rebuild from `messages` and `parts`, with no transcript column and no
  backfill. Equality must hold within one llame version, not across versions.
- **D5.** Record the step number on each tool part.
- **D7.** Replay an earlier turn's reasoning only for the same model, and only
  when its reply did not fail. This is the rule of OMP, OpenCode, and pi-mono,
  verified in their source.
- **D8.** Supersede #1257. File a new issue: llame counts reasoning tokens that
  the provider ignores.
- **D9.** The compaction request uses the same projection, reasoning included.
- **D10.** Close #599 through this change.
- **D11.** One projection for Continue and every future feature.
- **D12.** `store: false` and encrypted reasoning on `openai-responses`.
- **D13.** `messages.parts` becomes `json`.
- **D14.** A prefix-equality integration test is the proof.

Assumptions that follow from these but were never asked:

- **A1.** The model identity of a reply is the llame model id that its row
  records in `usage.modelId`, the same value the model-switch rule reads. A
  provider entry is part of that model entry, so "same provider entry and
  model id" means the same llame model id.
- **A2.** A reply "did not fail" when its row records `usage.status`
  `completed`. A reply with `error`, `aborted`, or no status (a row from before
  usage existed) does not replay its reasoning or its provider metadata on later
  turns. Its text and tool parts still replay, as today.
- **A3.** A Continue Run continues the same turn, so its kept reasoning replays
  under the same-model rule even when the source Run failed. This keeps the
  `turn-actions` scenario that continues a `failed` Run with encrypted
  reasoning.
- **A4.** Rows written before this change replay through the same projection.
  Their keys are already reordered and they have no step numbers, so each old
  Chat takes one cache miss on its next turn. Nothing is backfilled.
- **A5.** The equality guarantee covers the model messages that the projection
  builds. Media bytes and placeholders are still composed at request time under
  the epoch image window, and the provider adapter still converts the messages.
  Both are deterministic for the same input.
- **A6.** The prompt-cache gain is a provider effect that this change does not
  measure. The test proves request-prefix equality, not cache hits.
- **A7.** The live step sends provider metadata on text parts and tool calls
  (the item ids of the Responses wire, or a Gemini-style `thoughtSignature` on
  a Chat Completions call), and the SDK copies the metadata of a call onto its
  result. llame stores it only on reasoning parts today. To rebuild the live
  bytes from parts, text and tool parts keep it too, and it replays under the
  same model rule as reasoning, as OpenCode does. This needs a text-part seam in
  each model client. It was found after the grilling; please confirm.
- **A8.** For a call that the AI SDK refused, the live step sends the SDK's
  error text (for an unknown tool, it names the available tools) and the SDK's
  form of the input. llame stores its own refusal message and its own parse of
  the input, so replay cannot rebuild the live result today. The tool part keeps
  the SDK's text and input in two fields for the model only, which also mark the
  call as refused. The owner-facing error does not change. Found in review;
  please confirm.

## Capabilities

### New Capabilities

- `turn-replay`: how stored Chat turns become model messages. It covers the one
  projection, prefix equality with the previous request, no eviction before a
  checkpoint, the live rendering of tool results, step grouping, stored key
  order, stored provider metadata, and the compaction request.

### Modified Capabilities

- **`tool-calling`.**
  - REMOVED: "Tool observations survive into later turns as stored UI parts",
    and "A replayed pair keeps its artifact locator" from `tool-result-artifacts`.
    Its rules that stay true move to ADDED requirements here and in
    `turn-replay`, with their scenarios.
  - MODIFIED:
    - "Framing llame authors inside tool results is a packaged template", which
      no longer names the untrusted-output frame
    - "Code-owned Knowledge tools use the attempt-local read-only loop", which
      loses the cleared-payload `incomplete` outcome
    - "PDF tool observations are stored and replayed like image results", which
      loses the budget scenarios
  - ADDED: earlier tool activity takes part in later model context; a failed
    attempt stays in later context as the user saw it; a stored failure replays
    with its stored outcome; every replayed call has its result; absorbed tool
    activity crosses a checkpoint only as summary text; no tool observation is
    rebuilt from a checkpoint; a stored part records its model step; tool
    results store images without image data; no thumbnail or retained byte
    reaches the model; a replayed image result attaches under the epoch image
    window; a replayed image that cannot attach becomes a placeholder.
- **`context-injection`.** MODIFIED: "Stored parts cross a minimal SDK
  conversion boundary" and "User-authored text is neutralized before
  persistence". Both lose the #599 exception, the budget, and the
  unconditional reasoning replay.
- **`reasoning-output`.**
  - MODIFIED: "Reasoning is an ordered private assistant part", "Opaque
    continuation state is transient and private", and "Reasoning parts carry
    durable provider metadata". Compaction now carries reasoning, text and tool
    metadata persist, and replay follows the model rule.
  - ADDED: earlier reasoning replays only for the model that produced it.
- **`anthropic-messages-provider`.** MODIFIED: "Thinking blocks are persisted
  and replayed complete and unmodified". A model switch now omits earlier
  thinking.
- **`model-system-prompts`.** MODIFIED: "A model switch replaces the top-level
  prompt and preserves portable history", which loses the cross-model reasoning
  replay.
- **`turn-actions`.** MODIFIED: "Continue requests the next step of the same
  turn", which uses the shared projection and drops the 32,000 premise.
- **`tool-result-rendering`.** MODIFIED: "One rendering function produces every
  model-facing tool result", which drops the replay frame and names the
  refused call as the one result that the SDK renders.
- **`knowledge-tools`.** MODIFIED: "Retrieval persists safe response-time
  attribution", which drops clearing and the cleared `incomplete` outcome.
- **`media-attachments`.** MODIFIED: "Retained bytes count toward no text
  budget", which drops the replay budgets.
- **`web-search`.** MODIFIED: "Stored output is the normalized result only",
  which replays the result as the live loop sent it, not as untrusted tool
  output.
- **`provider-api-selection`.** ADDED: the Responses wire stores no response
  and carries encrypted reasoning.
- **`durable-runs`.** MODIFIED: "Final assistant-message projection preserves
  replay order". A failed attempt's reasoning follows the model rule.
- **`subscription-access-openai-codex`.** MODIFIED: "Preserve llame execution
  semantics". Text and tool metadata persist under `turn-replay`, and replay
  follows the model rule.

Deliberately unchanged, with the reading under which each holds:

- **`owner-chat-forks`.** "SHALL NOT … re-budget inherited content" stays
  true, because nothing re-budgets content after this change. Prefix equality
  "under identical continuation inputs and runtime versions" matches D4.
- **`provider-api-selection` "Model provider options are forwarded under a
  fixed precedence".** Its invariants are a list "for example". The ADDED
  Responses invariant joins it. "exactly the options the client sent before
  this rule existed" refers to the precedence rule.
- **`tool-result-rendering` "Tool result payloads are neutralized by the
  reserved-name rule".** One neutralization on every path holds for results
  that llame renders. The AI SDK's own refusal text is the one result llame
  never renders: the live step and its replay carry that text un-neutralized,
  because replay must send what the live step sent.
- **`media-attachments` epoch image window.** It depends on references and
  bounds, never on the replay budget.

## Impact

- **Database.** One migration changes `messages.parts` from `jsonb` to `json`.
  The only runtime SQL over it, `hasVisibleText` in `messages-repository.ts`,
  moves to `json_array_elements`. No index or view reads the column. Chat
  search reads its own projection table. Existing rows keep their sorted keys.
- **API.**
  - `apps/api/src/chats/context-builder.ts` and `tool-observation-part.ts`: the
    projection is rewritten, the budget passes are removed, and the frame
    template `prompts/tool-output-untrusted.md` is deleted.
  - `continue-projection.ts` is folded into the projection.
  - Each model client (`openai`, `openai-codex`, `openai-completions`,
    `anthropic`, and the scripted clients) gains a text-part seam, and
    `assistant-transcript.ts` keeps text and tool metadata and starts a new text
    part on a new text id.
  - `run-execution.service.ts` and `assistant-transcript.ts` record the step
    number on each part, and `tool-call-gate.ts` records the SDK text and input
    of a refused call.
  - `compaction.ts` builds its request through the projection with reasoning.
  - `openai-model-client.ts` sets `store: false`.
- **Model-facing text.** Replayed results lose the frame and the `Artifact:`
  line. Live results do not change.
- **Context size.** Later requests grow by the content the budget removed
  before. Compaction fires earlier in tool-heavy Chats. A long Chat written
  before this change can fail its next turn with `context_incompatible` when
  its full history does not fit.
- **Docs.** `SPEC.md` §28.2, `docs/product/reference/tools/model-output.md`,
  `docs/product/reference/continue-a-turn.md`, `tools/edit.md`, and
  `CHANGELOG.md`.
- **Other changes.** PR #1257 closes as superseded.

## Non-Goals

- Measured prompt-cache hit rates. The proof is request-prefix equality (A6).
- Equality across llame versions, or a stored copy of the wire request.
- A per-model reasoning policy. The provider decides what to use (D7).
- A token estimate for reasoning that the provider ignores. That is the new
  issue from D8.
- A new limit on history size. Compaction stays the only eviction boundary.
- The in-flight `tool-search` delta. It MODIFIES the requirement that this
  change REMOVES, and the framing requirement with the untrusted frame. Before
  it syncs, it must rebase those two blocks onto `turn-replay` and the ADDED
  `tool-calling` requirements.

## Acceptance

- A later turn replays every tool pair after the latest checkpoint, with the
  input and the result text that the live loop sent. No omission marker and no
  cleared payload appear.
- With one llame version, the second turn's first request starts with the first
  turn's last request and its response. This holds for a turn with a step of
  two parallel calls, text before a call, a spilled result, an MCP JSON result,
  an image result, and reasoning.
- A turn that exceeds the old 8,000 and 32,000 limits replays whole. This is the
  regression test.
- An earlier reasoning part replays on the same model, and is absent after a
  model switch or after a failed reply.
- A compaction request carries the absorbed rows with their reasoning, then its
  instruction.
- `openai-responses` requests carry `store: false` and no `item_reference`. An
  entry that declares `reasoning` replays its encrypted reasoning.
- A refused call replays the SDK error text and input that its live step sent.

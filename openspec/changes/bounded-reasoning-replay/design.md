## Context

See proposal.md (Why). Line references are to master `9a958cee`. Installed
versions: `ai@6.0.256`, `@ai-sdk/anthropic@3.0.118`, `@ai-sdk/openai@3.0.97`,
`@ai-sdk/openai-compatible@2.0.75`.

- Replay. `buildContext` with `requestKind: 'continuation'` emits every
  stored reasoning part in place, with its `providerMetadata` passed through
  as the prompt part's `providerOptions`
  (`apps/api/src/chats/context-builder.ts:341-355`). A reply holding only
  reasoning still enters context (`:443-458`). A compaction request carries
  none (D16).
- Request assembly. A Run's request is built only at attempt start, from rows
  up to and including the triggering user message
  (`run-execution.service.ts:2083-2122`). `prepareAttemptForFirstStep`
  (`:3658-3789`) assembles the estimate pass (`assembleAttemptRequest`,
  `:3798-3829`) and evaluates the compaction trigger on it (`:3691`). It then
  publishes a checkpoint if one was selected, rebuilds, and admits the request
  or throws "still exceeds … after one compaction" (`:3775-3787`). The tool
  loop then runs inside one `client.streamText` call (`:1682-1726`). The SDK
  holds the in-progress turn's step messages, and `onStepStart` only splices
  in-Run context items (`in-run-context-items.ts`). A redelivered job starts a
  fresh attempt from the triggering message (`runs-worker.service.ts:160-175`).
  There is no mid-turn resume from the database.
- Trigger. `evaluateCompactionTrigger` (`:2848-2888`) selects the window
  variant whenever `requestFitsContextWindow` is false. It throws
  `context_incompatible` when nothing is left to absorb. Otherwise it compares
  the measured size, meaning the previous reply's provider-counted context
  plus the estimate of later rows (`:2896-2934`), against the threshold
  (`COMPACTION_WINDOW_RATIO = 0.8`, `compaction.ts:36`). The window variant
  fails `context_incompatible` in five cases: no previous completed Run, no
  receipt, a source model that cannot execute, one that cannot fit the
  prefix, or an empty summary (`compaction.service.ts:233-320`). A checkpoint
  absorbs every row below the trigger (`planCompactionCheckpoint`,
  `compaction.ts:281-297`), so a post-compaction request replays no reasoning.
- Estimate. `estimateProjectionTokens` (`compaction.ts:104-135`) is chars/4
  over the JSON of system, messages, and tools. It counts reasoning text and
  strips each reasoning part's `providerOptions`. A test pins that a
  40k-character encrypted blob leaves the estimate unchanged
  (`compaction.test.ts:146-188`).
- Converters. The installed SDKs handle a reasoning prompt part as follows:
  - Anthropic sends a part with `anthropic.signature` as a `thinking` block and
    one with `redactedData` as `redacted_thinking`. It skips any other part with
    a warning (`@ai-sdk/anthropic` `convert-to-anthropic-messages-prompt.ts:631-687`).
  - Responses sends an `item_reference` when the part has an `itemId` and
    `store` is true. When `store` is false it sends an inline item with
    `encrypted_content`, accumulating every part of the item; the
    encrypted content rides on the item's last part. It skips a part with
    neither key (`convert-to-openai-responses-input.ts:577-680`). The default
    Responses client leaves `store` unset (SDK default `true`,
    `openai-model-client.ts:519-531`); Codex pins `store: false`
    (`openai-codex-model-client.ts:117`).
  - openai-compatible joins a message's reasoning text into `reasoning_content`
    and ignores metadata (`convert-to-openai-compatible-chat-messages.ts:171-209`).
- Messages-wire invariants. `sendReasoning: true` always, and
  `thinking.blockBinding.prefixMismatchBehavior: 'drop_block'` on the adaptive
  shape only (`anthropic-model-client.ts:86-96`, `anthropic-provider` D10).

### Prior art

- llame's tool-observation replay budget (`tool-observation-part.ts:24-29`,
  `TOOL_REPLAY_CALL_LIMIT`, `TOOL_REPLAY_TURN_LIMIT`) is the repository's
  existing replay-time bound. It omits whole observations and leaves a
  llame-authored notice. Reasoning gets no notice (D7).
- Anthropic's server-side context editing (`clear_thinking_20251015`) clears
  old thinking "by rule, oldest first"
  ([preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)).
- opencode adds an empty `reasoning` part to every DeepSeek assistant message
  that lacks one, "so the replay payload always carries the field"
  (`docs/research/harnesses/opencode.md`, finding 7). oh-my-pi has a similar
  synthetic placeholder (`docs/research/harnesses/oh-my-pi.md`).

## Goals / Non-Goals

**Goals:** a continuation that does not fit only because of replayed reasoning
proceeds without summarizing visible history and without failing. The bound
has no tunable constant. It is falsifiable by deterministic tests, and the
provider acceptance of oldest-first removal is confirmed by a bounded live
smoke.

**Non-Goals:** bounding inside the SDK's tool loop; weighing opaque metadata;
changing the threshold trigger; a configuration knob.

## Decisions

### D1: The bound is what the window leaves, applied at replay time before compaction selection

The bound is the existing admission predicate, `requestFitsContextWindow`
(window minus reserved output). The bound does not hold reasoning to a
fraction of the window. It drops just enough reasoning that the whole request
fits. It runs in request assembly, so the estimate pass hands
`evaluateCompactionTrigger` a request that is already bounded. The window
variant is selected only when the request does not fit with every droppable
reply's reasoning left out. The rebuild after a published checkpoint goes
through the same assembly, where the bound is a no-op because a checkpoint
leaves no replayed reasoning.

The threshold trigger is unchanged and still measures reasoning. A bounded
request close to the window can therefore still cross the threshold, and then
the threshold variant compacts with the target model itself. That outcome is
intended: it uses the cache-aligned path, and it no longer depends on a source
model that may be gone. Evicting down to the threshold instead was rejected.
In a long reasoning-heavy chat it would evict the next-oldest reply on every
turn, and since the evicted reply is always at the front of the history, every
turn would restart the provider prompt cache from that point. Compaction
restarts it once.

Rejected:

- Persist-time eviction. It loses reasoning a larger-window model or a later
  request could use, and it breaks D11's "persisted whole" scenario.
- Compaction-time eviction. A checkpoint already absorbs every reply.
- Bounding only after the window variant fails (**OPEN for Leo**, proposal.md).
  It keeps a lossy summary of visible history where dropping reasoning would
  have been enough.
- A per-turn or per-Chat cap, or a fixed fraction of the window. Each invents
  a number with no evidence, and D11 rejected a per-turn total.

### D2: Provider constraints the bound must respect

| Wire                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Consequence                                                                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anthropic-messages`                | "**Required:** within a tool-use turn, pass thinking blocks back. **Recommended:** across turns, pass everything back. **Allowed:** outside tool use, omit prior turns' thinking." "Within the latest assistant message, the sequence of consecutive `thinking` blocks must match … you can't rearrange, edit, or partially drop them." ([thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)). "You can remove thinking blocks from the start of the history (oldest first), from the end, or all of them. What fails is a gap … Once you remove a block, leave it out. Putting it back invalidates the thinking blocks produced while it was gone." The table of edits lists "Remove `thinking` blocks from the start of the history, from the end, or all of them" as "Valid (the model loses that reasoning)" ([preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)). Models before Opus 4.5 and Sonnet 4.6, and Haiku through 4.5, strip prior-turn blocks themselves. Later models keep them, and the kept blocks "count toward the context window" ([context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows)). | Oldest-first, whole-reply eviction keeps the remaining blocks an unbroken suffix and never splits a message's consecutive blocks. The in-progress turn is never touched (D4). Put-back is D8.                   |
| `openai-responses`, `openai-codex`  | "ensure all items between the last user message and your function call output are passed into the next response untouched." Models before GPT-5.6 default to `reasoning.context: current_turn`, which "does not render reasoning from earlier turns". GPT-5.6 renders "available" earlier reasoning, and "When you switch model families, the API omits incompatible reasoning" ([reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)). The converter already omits a part it cannot carry, and the canonical scenario "Responses replay skips parts its wire cannot carry" pins that omission as successful.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Omitting an earlier reply's items degrades and never fails. Dropping by reply never splits an item (D3).                                                                                                        |
| `openai-completions`, `opencode-go` | DeepSeek: "for requests carrying the tools parameter, the reasoning_content must be fully passed back to the API in all subsequent requests — even for turns where the model did not perform a tool call. If your code does not correctly pass back reasoning_content, the API will return a 400 error" ([thinking mode](https://api-docs.deepseek.com/guides/thinking_mode)). llame sends tools on nearly every request (`openai-compatible-provider` D7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Eviction on this wire turns today's working window compaction against DeepSeek into a provider 400. llame cannot identify DeepSeek on the wire (`openai-compatible-provider` D1), so the wire is excluded (D6). |

### D3: Evict all reasoning of one reply at a time, oldest reply first

The unit is every reasoning part of one assistant reply, together with each
part's metadata. Replies are dropped in sequence order. The dropped set is
therefore exactly "replies whose sequence is below a floor". `buildContext`
gains one optional continuation option naming that floor. When the option is
omitted, every stored part replays as today, and the request kind stays
mandatory (D16). Below the floor, a reply's
reasoning parts are not emitted. Its text, tool pairs, and context items are
emitted exactly as before. A reply that held only reasoning contributes
nothing.

Choosing the floor needs no rebuild per candidate. Each reply's reasoning is
weighed once, with the same chars/4 serialization the estimate uses. The
smallest floor that brings the estimate within the window is taken, and the
request is built once and confirmed with `requestFitsContextWindow`. If the
confirmation still fails because a wrapper message disappeared or rounding
differed, the floor advances one reply and the request is confirmed again.

Why a reply rather than a part or a run: one Responses item spans several
parts, and only the last carries `encrypted_content`. Anthropic forbids
partially dropping the latest assistant message's consecutive blocks. A
reply-level unit satisfies both by construction and keeps the remaining
blocks an unbroken suffix. It drops at most one reply's reasoning more than a
per-part bound would. Rejected: per-part or per-run eviction, which keeps
more reasoning but needs item grouping and latest-message guards.

### D4: The turn in progress is never droppable

Every reply the bound can drop precedes the request's triggering user
message, because the worker builds history only through that message. The
in-progress turn's reasoning, which Anthropic requires and which OpenAI asks
to be passed "untouched" within a tool loop, exists only in the SDK's step
messages. The bound never sees it. The requirement still states the rule, so
that a future mid-turn resume cannot silently inherit the bound.

### D5: Reasoning is weighed by the existing estimate

The bound fixes llame's own admission, so it uses the admission estimate:
text counts and opaque metadata does not. Changing that would be a change to
the metadata boundary, which the issue puts out of scope. Known ceiling:
reasoning whose cost travels in metadata has near-empty text. Two cases are
Anthropic `display: "omitted"` blocks on models that keep prior thinking, and
Codex encrypted items on GPT-5.6. Such reasoning weighs almost nothing here,
while the provider counts it. Those requests stay governed, as today, by the
threshold trigger's provider-counted measurement and by the provider's own
context error. A reply whose text is empty is still dropped in its turn,
which costs nothing and keeps the suffix property.

### D6: Each model client declares whether its wire tolerates the bound

The model-client contract gains one required declaration. It is true for the
Messages, Responses, and Codex clients and false for the completions and
OpenCode Go clients. On a client that declares false, the bound is not
applied and today's contract holds unchanged: the window variant, or
`context_incompatible`. The declaration lives on the client, which already
owns per-wire invariants. A per-provider flag was rejected: under
`openai-compatible-provider` D1, the wire is named and never inferred, and the
one known endpoint that needs exclusion shares the wire with endpoints that do
not. **OPEN for Leo**: bound the completions wire too and accept DeepSeek's
400, or synthesize empty `reasoning_content` placeholders as opencode does.
The placeholder is llame-authored replay content and would need its own
requirement.

### D7: Storage and display are untouched; the owner sees nothing new

The bound is a property of one request (D16). It never writes a row, so the
Thinking panel, markdown export, forks, and search see the same stored parts
as before, and a later request with room replays the part again. The owner
gets no marker or notice. A notice in the assistant turn would be
llame-authored text in the model-facing transcript. The providers' own
stripping of earlier reasoning is silent too, and a per-panel "not sent"
marker would be wrong for the next request, which may replay the part.
**OPEN for Leo** whether a signal is wanted. The smallest one would be a
count on `model.requested`, which would add a `durable-runs` delta.

### D8: No remembered floor

Each request derives its own floor. The floor rises with the chat in the
common case, because history is append-only and only the triggering message
varies. It can fall in two situations: a smaller trigger, or a switch to a
larger-window model. In either case a previously dropped Anthropic block comes
back, and Anthropic invalidates the blocks produced while it was gone. On
requests with adaptive thinking, llame's existing `drop_block` instruction
makes this a degrade: those blocks are dropped and the request succeeds. On
manual-budget, disabled, or reasoning-less entries, a prefix-checking account
can reject the request. That is the ceiling the operator documentation
already states for any prefix rewrite (`anthropic-messages-provider`,
"A request without adaptive thinking carries no drop instruction"). A
same-model fall is also short-lived. A bounded request sits near the window
and is then usually compacted by the threshold variant (D1), which removes
every earlier block. Rejected: persisting a per-Chat floor (new durable state
for a rare degrade), which is the alternative if Leo prefers strict
monotonicity.

### D9: Recording the trigger D11 names

D11 makes revisiting the cap conditional on "a measured context-build cost or
table growth". The bound has no constant to tune, so the measurement records
evidence rather than choosing a number. Task 2.1 runs read-only queries
against the operator's database:

- the distribution of reasoning text bytes and metadata bytes per assistant
  reply (p50, p95, max);
- reasoning's share of `messages` storage, and the size of the `messages`
  table and its TOAST;
- the count of Runs whose `error.code` is `context_incompatible` since #884
  merged;
- a one-off timing of request assembly for the chat with the most reasoning.

The numbers go in the task record and the PR body. They do not gate the
deterministic tests, which construct the failing case directly.

### Delivery layers

```text
master <- bounded-reasoning-replay/proposal <- bounded-reasoning-replay/bound <- bounded-reasoning-replay/finalize
```

One implementation layer, about 900 authored lines: the client declaration,
the `buildContext` floor option, the floor computation, the wiring, unit and
integration tests, the README and `SPEC.md` corrections, and a CHANGELOG
entry. Splitting it would publish a declaration with no consumer, or a bound
with no wire policy.

## Risks / Trade-offs

- [Eviction restarts the provider prompt cache at the first dropped block] →
  It runs only when the request would otherwise not fit, where the
  alternative (the window variant) restarts the cache as well. D1 rejects
  per-turn eviction to the threshold for this reason.
- [A dropped Anthropic block reappears (D8)] → `drop_block` degrades it on
  adaptive requests. Non-adaptive entries carry the documented ceiling.
- [The estimate cannot see metadata-borne cost (D5)] → The threshold
  measurement uses provider-counted tokens, and provider context errors stay
  loud.
- [Foreign-wire reasoning (another wire's metadata) is counted by the
  estimate but skipped by the converter] → Today it inflates the estimate
  after a cross-wire switch and can force a window compaction. Under the
  bound it is dropped oldest-first instead, which is an improvement, not a
  regression.
- [Less replayed reasoning can raise output tokens] → Anthropic documents
  this for dropped blocks. It happens only where the alternative is a summary
  or a failure.
- [Provider acceptance is documented but not exercised locally] → A bounded
  live smoke (task 2.6) drops the oldest reply's reasoning on a prefix-checking
  Anthropic model and on Codex, before the layer is ready.

## Migration Plan

No data or API change. Deploying enables the bound for every continuation
on the three wires. Reverting the layer restores unbounded replay, and
because nothing was persisted, nothing needs cleanup.

## Open Questions

None that can be deferred. The four in proposal.md change the specs or tasks
and need Leo's answer before approval.

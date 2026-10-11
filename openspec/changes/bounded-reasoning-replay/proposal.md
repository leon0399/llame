## Why

`openai-compatible-provider` deleted `REASONING_PERSIST_MAX` (its design D11)
and replays a Chat's persisted reasoning on every request that continues the
Chat (D15, D16). Replay has no bound, so replayed reasoning can push a request
over the target model's context window by itself. Issue #891 tracks this. It
was raised on PR #884 and deferred there, because enforcing a bound is new
behavior that needs its own requirement and tests.

The case the issue names changed after it was filed. Issue #891 (2026-09-18)
describes compaction that keeps a recent tail verbatim, so that the tail's
reasoning cannot be compacted away. `unify-compaction-checkpoints` (archived
2026-10-07, #1094) removed the retained tail. A checkpoint now absorbs every
user and assistant row below the triggering user message, so once compaction
runs, the request carries no replayed reasoning. On master the gap sits one
step earlier, in `evaluateCompactionTrigger`
(`apps/api/src/runs/run-execution.service.ts:2848-2888`):

- A prepared request that does not fit the target window always selects the
  window variant. That variant summarizes the whole visible history with the
  previous completed Run's model, even when the request would fit once older
  reasoning was left out. The provider may not use that reasoning at all:
  Anthropic models that strip earlier thinking drop it, and OpenAI reasoning
  models before GPT-5.6 default to the current turn (design D2).
- When the window variant cannot run, the attempt fails `context_incompatible`
  before the target call (`compaction.service.ts:233-320`). This happens when
  no previous completed Run exists, its receipt is gone, its model can no
  longer execute or cannot fit the prefix, or the summary comes back empty.
  The attempt fails even when dropping replayed reasoning would have let the
  request fit. One reachable path is a switch to a smaller-window model after
  the source model has been removed from the catalog.

D11 already names the shape a bound must take: "the bound goes on whole parts,
oldest first, dropped with their metadata rather than truncated." Anthropic now
documents that same shape as valid for signed thinking: "You can remove
thinking blocks from the start of the history (oldest first), from the end, or
all of them. What fails is a gap". (Design D2 cites the sources.)

## What Changes

- On every wire that tolerates omission, a request that continues a Chat
  bounds its replayed reasoning before compaction is selected. If the
  prepared request does not fit the target model's context window plus the
  reserved output budget, the worker stops replaying reasoning one assistant
  reply at a time, oldest reply first. Each dropped reply loses all of its
  reasoning parts together with their provider metadata. The worker stops as
  soon as the request fits, or once no droppable reasoning remains. The bound
  is the share of the window left after the rest of the request; there is no
  configured number (design D1, D3). Compaction selection then runs on the
  bounded request, unchanged. If it still does not fit, the window variant and
  its existing failures apply.
- A part is never truncated, edited, re-ordered, or split from the rest of its
  reply. A kept part is replayed byte-identically with its metadata. Only
  replies before the triggering user message are droppable. The turn in
  progress, whose reasoning the provider requires within a tool-use loop,
  lives in the SDK's step messages and is never touched (design D4).
- The bound weighs reasoning with the existing admission estimate: text
  counts, opaque provider metadata does not. The metadata privacy boundary is
  unchanged (design D5).
- The bound applies to `anthropic-messages`, `openai-responses`, and
  `openai-codex`. It does not apply to `openai-completions` or `opencode-go`.
  DeepSeek documents that with `tools` present, the `reasoning_content` of all
  previous turns must be passed back or the request fails with a 400, and
  llame cannot tell DeepSeek apart from other endpoints on that wire (design
  D6).
- Persisted reasoning is untouched. Display, markdown export, forks, and
  search behave exactly as before, and a later request with room replays the
  part again. The owner sees no new signal (design D7).
- The Messages-wire rule against llame-side pruning, and the model-switch
  "no pruning" clause, gain this single exception.
- The implementation layer records the measured trigger D11 names: reasoning
  bytes per reply, `messages` table growth, `context_incompatible` failures,
  and the context-build cost of the heaviest chat (tasks 2.1).

## Decisions on the issue's open questions

Each is recommended in `design.md`, and the delta specs follow the
recommendation. A different answer revises the specs before approval.

| Question                                  | Recommended                                                                                                                                                                                       | Alternative                                                                                                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bound per Chat, per turn, or window share | The share of the target window left after the non-reasoning request: drop until the existing admission check passes (D1)                                                                          | A per-turn or per-Chat cap, or a fixed fraction of the window: these invent a number with no evidence, and D11 rejects a per-turn total                                                                                                                |
| Persist, replay, or compaction time       | Replay time, before compaction selection (D1, D16)                                                                                                                                                | Persist time discards reasoning a larger-window model could use. Compaction time is already covered, since a checkpoint absorbs everything. Bounding only as a fallback after the window variant fails keeps the lossy summary where eviction suffices |
| Unit of eviction                          | All reasoning of one assistant reply, oldest reply first (D3)                                                                                                                                     | Per part or per run of parts: keeps more reasoning, but needs guards for Responses items that span parts and for Anthropic's consecutive-blocks rule                                                                                                   |
| Evicted parts in the Thinking panel       | Stay visible and exportable, display-only, with storage unchanged (D7)                                                                                                                            | Remove them from history: this destroys data that a later request, or another model, can still replay                                                                                                                                                  |
| Owner signal                              | None (D7). **OPEN for Leo**                                                                                                                                                                       | A count on `model.requested` or a "not sent" marker in the panel                                                                                                                                                                                       |
| Wire scope                                | Messages, Responses, Codex; completions excluded (D6). **OPEN for Leo**                                                                                                                           | Bound the completions wire too and accept DeepSeek's 400, or synthesize empty `reasoning_content` placeholders as opencode does                                                                                                                        |
| Remember what was dropped                 | No: each request derives its own bound (D8)                                                                                                                                                       | Record a per-Chat floor so a dropped block never comes back, which Anthropic's "once you remove a block, leave it out" favors                                                                                                                          |
| Eviction before window compaction         | Yes: a request that fits once older reasoning is dropped is not summarized, and the threshold trigger is unchanged (D1). **OPEN for Leo** to confirm that reasoning yields before visible history | Keep compaction first and bound only when compaction cannot run                                                                                                                                                                                        |

## Open for Leo

1. Should eviction run before the window variant (recommended), or only when
   that variant cannot run?
2. Should the bound exclude the Chat Completions wire (recommended)? The
   alternatives are bounding it and accepting a DeepSeek 400, or a placeholder
   for DeepSeek, which would need a per-provider declaration (D1 in
   `openai-compatible-provider` forbids inferring it).
3. Should the owner see anything when reasoning stops being replayed? The
   recommendation is no.
4. Task 2.1 runs read-only SQL against the operator's instance. Who runs it
   there and records the numbers?

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reasoning-output`: new requirements bound replayed reasoning by whole
  replies, oldest first, before compaction selection; keep the in-progress
  turn and the Chat Completions wire out of the bound; and keep dropped
  reasoning stored and displayed. "Reasoning is an ordered private assistant
  part" and "Reasoning parts carry durable provider metadata" name the bound as
  the one exception to replaying every stored part.
- `anthropic-messages-provider`: "Thinking blocks are persisted and replayed
  complete and unmodified" allows the oldest-first bound as the one exception
  to "SHALL NOT prune", with a scenario that the kept blocks form an unbroken
  run of the original sequence.
- `model-system-prompts`: "A model switch replaces the top-level prompt and
  preserves portable history" drops "pruning" from what the switch forbids
  except under the bound. A switch to a smaller-window model now compacts only
  when the request does not fit even with every droppable reply's reasoning
  left out.

Deliberately unchanged: the compaction trigger requirement (it evaluates the
prepared request, which the bound now shapes), `owner-chat-forks` (a fork
replays its stored parts under the same bound), `chat-search`, and
`durable-runs`.

## Impact

- `apps/api/src/runs/run-execution.service.ts` (request assembly before the
  compaction trigger), `apps/api/src/chats/context-builder.ts` (a continuation
  option naming the replies whose reasoning is not replayed),
  `apps/api/src/compaction/compaction.ts` (the bound, beside
  `requestFitsContextWindow`), and the model-client contract with each
  client's declaration (`model-client.ts`, `anthropic-model-client.ts`,
  `openai-model-client.ts`, `openai-codex-model-client.ts`,
  `openai-completions-model-client.ts`, `opencode-go-model-client.ts`).
- No schema, migration, API, or web change.
- `SPEC.md` §28.2 still says persisted reasoning parts "are excluded from
  replayed context", which has been stale since D15. The implementation layer
  corrects it, and updates the Messages-wire operator documentation and
  `CHANGELOG.md`.

## Non-Goals

- A per-part or per-turn character cap, and truncating any provider-authored
  block (the issue's out-of-scope list).
- Any change to the metadata privacy boundary, including weighing opaque
  metadata in the estimate.
- Bounding inside a Run's tool loop. There is no per-step fit check today, and
  the in-progress turn's reasoning is required.
- Changing the threshold trigger, the window variant, or their failure
  messages.
- Evaluating model quality with less reasoning replayed. Providers document
  omission of earlier turns as allowed.

## Acceptance

- `reasoning-output` specifies the bound, the request kind it applies to (a
  continuation, before compaction selection), and that it never truncates a
  part or its metadata.
- A continuation whose replayed reasoning would exceed the target window
  drops whole replies' reasoning, oldest first, and the request succeeds. A
  focused integration test covers the case that fails today: the request is
  over the window only because of replayed reasoning, and the window variant
  cannot run.
- A smaller-window model switch that fits once older reasoning is dropped is
  not compacted.
- On the Chat Completions wire, the same request keeps today's behavior.
- The Thinking panel and markdown export keep showing parts that a request
  dropped.
- The measured trigger D11 names is recorded with the implementation layer.

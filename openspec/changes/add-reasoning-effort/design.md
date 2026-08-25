# Design — per-request reasoning effort

## Context

See proposal.md — Why. The constraints that shape the approach:

- **No generation-parameter seam exists.** `ModelStreamInput` carries messages,
  system prompt, tools, and callbacks. `runs.maxOutputTokens` is read only to
  reserve context-window headroom and is never sent. This change introduces the
  first parameter that reaches the provider.
- **Two transports per provider.** `openai-model-client.ts` uses the Responses
  path only for `provider.id === "openai"` and `openai.chat()` for every other
  OpenAI-compatible endpoint. Anything sent must work on both.
- **The pinned SDK has no portable effort setting.** `ai@6.0.256`'s
  `CallSettings` stops at `headers`; the top-level `reasoning` parameter is an
  `ai@7` feature. `providerOptions` is the only mechanism on this line.
- **The SDK validates provider options against a closed enum on the chat
  path.** `@ai-sdk/openai@3.0.97` accepts `none | minimal | low | medium | high | xhigh | max`;
  the previously pinned 3.0.79 rejected `max` inside `parseProviderOptions`. The
  dependency bump landed as its own layer.
- **The SDK derives model capabilities from the model-id string.**
  `getOpenAILanguageModelCapabilities` parses `providerModelId` to decide
  whether a model reasons. That heuristic cannot be right for a compatible
  endpoint whose ids are gateway-assigned.
- **Run receipts are content-addressed and shared.**
  `model_context_snapshots` is deduplicated across runs with identical prompt,
  declarations, source, and availability manifest.
- **Compaction is deliberately prefix-aligned with the turn it follows.**
  `buildCompactionRequest` reuses the finished turn's exact system prompt and
  rebuilds the same message prefix, appending only a trailing instruction, and
  `CompactionService` runs immediately after the turn specifically so the call
  lands inside the provider's prompt-cache TTL.

## Goals / Non-Goals

**Goals:**

- One effort value per run, resolved once, persisted, and executed exactly as
  persisted.
- A provider-native vocabulary that survives provider releases without a llame
  release.
- Enough data on already-consumed surfaces for a later UI change to detect a
  turn-over-turn effort change and warn about cache cost.

**Non-Goals:**

- A llame-normalized cross-provider effort scale, or any claim that a level
  means the same thing on two providers.
- Validating declared levels against the provider at boot.
- Prompt-cache management. llame sets no `cacheControl` or `promptCacheKey`;
  `cacheInvalidatedByEffortChange` is a published fact, not a behavior.
- Sampling parameters. Their legality is downstream of effort — the OpenAI
  adapter drops `temperature`/`topP` on a reasoning model unless effort is
  exactly `none` — so they need this change to exist first.

## Decisions

### D1: Operator-declared opaque tokens, not a llame enum

`effortLevels` entries are strings llame never interprets. Validation is exact
byte matching against the selected model's own list.

_Why._ The vocabulary is unstable in both directions. OpenAI currently
documents `none | low | medium | high | xhigh | max` while the SDK's own enum
still carries the retired `minimal`; Anthropic's `effort` is
`low | medium | high | xhigh | max` and has neither `minimal` nor `none`. A
llame-owned enum would need a release every time any provider moved, and would
have been wrong about `max` on the day it was written.

_Why no character pattern either._ A regex is a llame-owned vocabulary in
disguise, and it fails the same way: a provider shipping `very-high` or
`effort_2` would be rejected by a rule that only ever encoded what today's
vocabularies happened to look like. Only three constraints survive, and all
three are integrity rather than format — nonblank, unique within the entry, and
`defaultEffort` must be a member. Byte-exact matching then needs no casing rule:
`High` against a declared `high` is simply not a match.

_Alternative — normalize to a llame scale and map per provider._ Rejected: it
forces a coercion policy for levels a provider lacks, and silent coercion is
exactly the wrong behavior when the user is paying for the difference.

_Alternative — the SDK's portable `reasoning` parameter._ Not available on the
pinned line, and it silently ignores itself when reasoning-related
`providerOptions` are also present. Revisit at `ai@7`: the internal value is
already a provider-neutral string, so adopting it is a change inside the model
client, not a config migration.

_Cost._ No cross-model semantics. `effortLevels` order is the only scale a
client gets, which is why the order is normative and why a level is specified as
an identifier rather than a display string.

### D2: Resolve at accept time, persist on `runs`

`runs.effort` is a new nullable text column. The API resolves
`request.effort ?? model.reasoning.defaultEffort` before creating the run and
stores the concrete value. The worker never re-resolves.

_Why._ `runs.model_id` already establishes this rule — "changing the system
default later must not silently alter an already queued run". Storing a default
marker would break it, and the receipt of what a past run actually did is worth
more than the byte it saves.

_Nullable, no backfill literal._ Pre-change rows had no effort concept, so NULL
is the honest value, matching `runs.model_context_snapshot_id`'s "nullable only
for pre-migration history". `runs.model_id` got a literal backfill because
execution cannot proceed without it; effort can.

_Never re-validated._ A persisted level that configuration later withdraws is
still sent verbatim. Re-validating at pickup would reintroduce the re-resolution
this decision forbids, and — for compaction (D6) — would silently change the
request shape, defeating the cache alignment that motivated inheriting it.

### D3: Effort stays out of `model_context_snapshots`

_Why._ Snapshots are content-addressed and reused across runs whose prompt,
declarations, source, and availability are identical — which is exactly the
condition under which effort varies. Including it would shatter reuse and grow
the table with rows that differ by one word. This is the same argument
`runs.context_items` already records for living on `runs`.

The context receipt still discloses effort (D8): it reads `modelId` from the
run rather than the snapshot already, so effort joins it there without entering
`contentHash` or `availabilityHash`.

### D4: No context-rail item for an effort change

`EFFECTIVE_CONTEXT_CHANGE_CAUSES` stays `['model']`.

_Why._ A model change tells the assistant that a different model is now reading
unchanged history — actionable. An effort change alters the budget for the
answer, which the model cannot act on and cannot verify. The producer union is
closed and will invite an `'effort'` member, so the spec states the exclusion
rather than leaving it to be inferred.

### D5: Wire mapping lives in the model client

`ModelStreamInput.effort?: string`, mapped in `openai-model-client.ts` onto
`providerOptions.openai.reasoningEffort` for both transports.

_Why the client and not the executor._ `RunExecutionService` is
transport-agnostic and must stay so; a future Anthropic adapter maps the same
neutral value onto `providerOptions.anthropic.effort` with no executor change.

_Presence, not truthiness._ The parameter is set when `effort !== undefined`. A
level denoting disabled reasoning is a real instruction to the provider and
differs from omitting the parameter; a truthiness check would silently drop it.

### D6: Compaction inherits effort; title generation does not

Compaction sends the effort of the run whose prefix it reuses. Title generation
sends nothing.

_Why compaction inherits._ This is a cache decision, not a quality one.
`CompactionService` runs fire-and-forget immediately after a completed turn
precisely so the call lands inside the provider's prompt-cache TTL, and
`buildCompactionRequest` reproduces that turn's exact system prompt and message
prefix to hit it. Anthropic documents that changing effort always invalidates
message blocks, with a model-specific effect on tool and system caches; OpenAI
effort changes are reported to cause full-prefix misses. Sending a different
effort than the prefix was built under would therefore invalidate exactly the
cache this request shape exists to exploit — the alignment would be defeated by
the one parameter llame newly controls.

_Why the source run for transition compaction._ `compactForTransition` builds
its request from `sourceRun.modelId` and `sourceSnapshot.systemPrompt` — the
previous model and previous prompt — so the source run's effort is the one that
matches the reused prefix. The incoming turn's effort is doubly wrong here: it
is not part of that prefix, and it was validated against the target model's
declared levels, which need not contain it.

_Why title generation does not._ The cache argument does not reach it. Title
generation runs on a separately configured `titleGenerationModelId` with its own
`TITLE_SYSTEM_PROMPT`, so it shares no prefix with any run, and the run's level
may not exist in that model's vocabulary. The asymmetry is deliberate:
compaction inherits because its request is prefix-aligned, and title generation
does not because its request is not.

_If compaction quality later proves effort-sensitive_, that is a separate
operator knob, not a change to this inheritance rule.

### D7: `cacheInvalidatedByEffortChange` is operator-declared, per model

_Why the name._ The fact is that _changing_ effort invalidates the cache, not
that effort does. That distinction is the entire warning condition — an owner
who keeps the same level pays nothing — so the field name states it.

_Why not derived._ The behavior is genuinely model-specific and partly
undocumented. Anthropic documents that changing effort always invalidates
message blocks, with the effect on tool and system caches depending on whether
the model renders the configuration ahead of them, and that setting effort to
the model's own default is equivalent to omitting it. OpenAI does not document
the interaction at all, but changing effort mid-session is reported to cause a
full-prefix miss, while returning to a previously used level hits the earlier
cache — and at least one model shows no miss. Nothing in the model id, the
provider, or the level list predicts this. The operator declares it or leaves it
`false`.

_Why publish it now with no UI._ The warning is a UI concern, but the data has
to come from somewhere, and the model catalog is the only place that knows.
Publishing it here means the UI change is purely presentational.

_Deliberately not modeled._ The "returning to a level already used in this chat
is free" nuance is a client-side computation over turn history, not a field.
Encoding it as server state would bake one provider's cache behavior into the
API contract.

### D8: Effort travels with `modelId`, everywhere and only there

Every surface that stores or returns the executing `modelId` also carries
`effort`; every surface that does not, does not. The audited set is the run
resource, the context receipt, assistant message usage, compaction usage, the
model-attribution run event, and the turn-telemetry log record — and, on the
excluded side, the active-runs list and the public shared-chat message view,
neither of which carries `modelId`.

_Why a rule rather than a list._ Stated as a list, the next surface that gains
`modelId` would silently omit effort. Stated as a rule, it inherits. The rule
also has a reason behind it: `modelId` and effort describe one execution
decision, and a surface carrying a cost, a latency, or a receipt without both
cannot attribute what it reports.

_The name is `effort` at every layer_ — wire field, run column, telemetry key,
receipt field — so one concept has one name. Absent rather than null when the
run carried none, matching the existing "omitted rather than fabricated" rule.

### D9: No chat-level effort state, and no new endpoint

The client derives the previous turn's effort from the last assistant message's
usage telemetry, which it already reads for `modelId`. Telemetry is written on
the error and abort paths too, so an interrupted turn does not create a hole.

_Why not a `chats.last_effort` column._ It would be a second source of truth
that can disagree with the receipt, for data already reachable. Whether the
composer preselects the last-used level or the model default is a UI decision
that this design supports either way — and today the client does not remember
the selected `modelId` either, so effort follows the same convention.

_Why not a chat-runs endpoint._ It would exist solely to expose effort history
that message usage already carries. Recorded here so the option is not
re-opened as an oversight.

## Risks / Trade-offs

- **A misdeclared level fails at request time, not boot** → Accepted, and
  specified. It matches the existing posture that provider credentials are not
  prevalidated. Boot-time probing would require a live request per model per
  start.
- **The SDK's chat-path enum can lag a provider again** → A future level the
  pinned `@ai-sdk/openai` rejects fails inside `parseProviderOptions` before the
  request leaves the process. Mitigation: the failure is loud and names the
  option, and the fix is a dependency bump rather than a llame release. The
  Responses path is free-form and unaffected.
- **The SDK may strip effort for a model its id heuristic thinks cannot
  reason** → Real for gateway-assigned ids. Mitigation: the SDK surfaces this in
  `result.warnings`; the run still succeeds at the provider default. Not worth
  `forceReasoning` in this change — that overrides more than effort.
- **The output-token reservation does not know about effort** → `runs.maxOutputTokens`
  reserves a fixed headroom for the context-fit check, and reasoning tokens count
  as output tokens, so a high-effort turn can overrun a reservation sized for a
  cheaper one. Accepted unchanged: the exposure predates this change (reasoning
  spend already varied per turn), and the alternatives are a per-effort
  reservation with no evidence behind it or — worse — scaling the reservation by
  a level's position in `effortLevels`, which infers a magnitude from list order
  and contradicts D1. Operators size the reservation conservatively.
- **Removing the `reasoning` boolean breaks existing config files** → Intended
  and specified as a loud boot failure. A coerced object would have to invent an
  effort vocabulary, which is a guess about the provider.
- **`cacheInvalidatedByEffortChange` can drift from provider reality** → It only
  drives a future warning. A stale `true` over-warns; a stale `false`
  under-warns. Neither affects execution.

## Migration Plan

Operator-facing, and deliberately breaking. Any `models[]` entry carrying
`reasoning: true` or `reasoning: false` must become either an object with
`effortLevels` and `defaultEffort`, or be removed entirely for a model that takes
no effort. The instance refuses to start until then, naming the model.

The database migration is additive — one nullable column — so rollback is a code
rollback with no data step. Runs created before rollback keep a column the old
code ignores.

This is **not** a coordinated API/worker revision boundary. No new message-part
schema is authored, and the one run-event payload that gains a field
(`model.requested`) gains it optionally, which readers on either version
tolerate. Nothing breaks in either deploy order, and no quiesce-and-drain
cutover is needed.

Deploy workers first anyway. While an old worker is still running, a new API can
accept and persist `runs.effort` that the worker ignores, executing at the
provider default instead — so the run row claims an effort the turn did not use,
and the owner is silently served a cheaper or slower answer than the one they
asked for. That is a cost and quality divergence rather than a failure, which is
why it is not a revision boundary in the schema sense; it is also invisible to
the owner, which is why the order is a recommendation rather than a free choice.
Telemetry is the authority for what actually ran: an old worker writes no effort
at all, so an absent telemetry effort beside a populated `runs.effort` is the
signature of this window. It closes when the last old worker is replaced.

## Open Questions

- Whether `effortLevels` entries should eventually carry per-level display
  metadata (label, cost hint) instead of being bare identifiers. Deferrable: the
  entry can widen from `string` to `string | { id, label }` additively, and the
  UI change is the first consumer able to judge what it needs.

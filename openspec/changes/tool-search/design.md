## Context

See `proposal.md` for motivation. Facts that shape the design, verified on 2026-09-27 against
`master` at `1bab08dc` and the installed packages (`ai@6.0.256`, `@ai-sdk/openai@3.0.97`,
`@ai-sdk/anthropic@3.0.118`):

- **Per-attempt catalogs.** The worker composes each attempt's admitted catalog in memory
  (`run-execution.service.ts:2825-2859`, `effective-context-resolver.ts:43-75`) and persists only a
  system-prompt receipt (`db/schema/system-prompt-receipts.ts:11-13`). No declaration hash,
  content hash, or availability manifest is stored; `runs.turn_tool_availability` keeps sorted
  `{id,state}` entries for the next turn's reminder diff and is written only on success
  (`run-execution.service.ts:387-393`, `2066-2069`). Workers execute only an exact
  declaration-hash match against the attempt's admitted catalog.
- **One tool loop for every wire.** `applyToolCallingOptions` (`openai-model-client.ts:91-143`)
  is shared by the Responses, Chat Completions, and Messages clients; Codex and OpenCode Go
  compose over the first two. Its `prepareStep` returns `{ activeTools: [] }` once the step cap
  is reached, and `experimental_repairToolCall` turns a call to an inactive tool into llame's
  `not_available` refusal.
- **`activeTools` edits the wire tools array.** `ai` filters the tool object before the provider
  call (`filter-active-tools.ts:3-19`, `stream-text.ts:1650-1663`), so any per-step change of the
  active set changes `tools` and breaks the provider's prefix cache. It is portable, not
  cache-preserving.
- **Tools are sorted by id** before they reach the SDK (`turn-tool-catalog.ts:492-508`), so the
  declared prefix is byte-stable while the admitted set is stable.
- **Anthropic.** `anthropic-messages` ships. Its adapter serializes a tool-level
  `providerOptions.anthropic.deferLoading` as `defer_loading` (`@ai-sdk/anthropic` `index.js:1519-1545`)
  and converts a tool-result content part `{ type: 'custom', providerOptions: { anthropic: {
type: 'tool-reference', toolName } } }` into a `tool_reference` block (`index.js:2548-2555`).
  Anthropic documents exactly that as custom client-side tool search: every candidate is sent in
  `tools` with `defer_loading: true`, deferred tools are excluded from the rendered prefix, and a
  `tool_reference` in a `tool_result` is expanded inline, "so prompt caching is preserved"; the
  API expands references throughout history, so a loaded tool stays callable on later turns
  ([tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool),
  [tool use with caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)).
  Support is per model: the tool-search table lists Haiku 4.5, Sonnet 4.5/4.6 and the current
  Opus, Fable and Mythos models; Sonnet 5 is absent. The adapter also emits mid-conversation
  `tool_addition`/`tool_removal` blocks from a `role: "system"` message's `toolChanges` option,
  under the reference-only `mid-conversation-tool-changes-2026-07-01` beta (`index.js:876-918`,
  `2291-2368`); that is the server-authored counterpart of a model search.
- **OpenAI.** The Responses adapter serializes a function tool's `deferLoading` as
  `defer_loading` (`@ai-sdk/openai` `index.js:5144-5156`), ships `openai.tools.toolSearch`
  with client execution, and on replay turns a `tool_search` call whose input carries `call_id`
  into a `tool_search_call` item and its `json` output `{ tools }` into a client
  `tool_search_output` item (`index.js:3165-3186`, `3446-3458`). Loaded tools are appended at
  the end of context, preserving the cached prefix; for an individual deferred function the
  model still sees its name and description; only `gpt-5.4` and later support `tool_search`
  ([tool search](https://developers.openai.com/api/docs/guides/tools-tool-search)). The adapter
  also emits `tool_choice: { type: "allowed_tools" }` from `providerOptions.openai.allowedTools`
  without removing declarations (`index.js:4860-4885`); llame currently strips `allowedTools`
  from operator options as a reserved key. `additional_tools` input items and
  `configuration_update` are not in the installed or latest adapter.
- **Chat Completions, OpenCode Go, Codex.** No native deferred loading is available or verified;
  whether the ChatGPT Codex backend accepts `tool_search` is unknown.
- **Frozen chat baselines.** The skill catalog and recency digest are resolved once per epoch,
  stored on the `chats` row with the compaction identity they were resolved under, reused while
  that identity matches the chat's latest compaction, and copied by owner forks
  (`skill-turn-state.ts:86-90`, `chats-repository.ts:393-397`, `fork-copy.ts:89-93`).
- **Where calls are recorded.** A settled assistant tool part is
  `{ type: 'tool-<id>', toolCallId, state, input, output?, errorText?, outcome }` inside
  `messages.parts` (`assistant-transcript.ts:307-348`), committed only with the winning
  attempt's assistant message. No invocation table or per-tool index exists.
- **Replay.** Ordinary tool observations replay as portable, text-bearing SDK call/result pairs
  under a per-pair and per-turn budget (`tool-calling` "Tool observations survive into later turns
  as stored UI parts"); compaction replaces absorbed observations with replacement records.

### Reference survey

The survey in the previous revision still holds (Claude Code `ToolSearch`, Codex `tool_search`,
OpenClaw catalog search, goose extension toggling). Two conclusions carry over: names alone are
enough of an inventory, and every harness with a real search tool either re-declares loaded
schemas or relies on provider history to keep them. What is new is that both large providers now
make the second option cache-preserving and application-driven.

## Goals / Non-Goals

**Goals:**

- Zero behavioral change for any model whose eligible MCP catalog fits its budget.
- Code-owned tools are always declared; MCP pre-declaration follows evidence of use, not id order.
- Within a chat epoch, loading a tool never edits the `tools` array on a `native` wire.
- One loaded-set rule across wires, derived from what the model can see, so retries, compaction,
  and model switches need no bookkeeping of their own.
- A later per-message selector is additive: it adds a second producer of loads, not a new
  delivery path.

**Non-Goals:**

- Shipping per-message selection, Jev, or any model call during preparation.
- Provider-executed search, OpenAI namespaces, BM25 or embeddings over the catalog.
- Cache-preserving handling of tools that become unavailable (#972 owns that direction).
- Owner-visible receipts of declarations; receipts stay system-only (SPEC §9.7).
- Any change to `tools.allowed` or to the availability comparison.

## Decisions

### D1. Admitted, declared, discoverable, callable

The admitted catalog is exactly today's (allowlist, classification, admission, attempt-local
declaration match). Within it:

- **declared** — offered to the model with its schema on this step;
- **discoverable** — admitted MCP tools not declared; reachable only through `tool_search`;
- **loaded** — discoverable tools whose load is visible to the model (D6);
- **callable** — declared tools plus loaded tools, minus everything once the step cap is reached.

Admitted code-owned tools are always declared, never discoverable, and never counted against the
budget, so an operator's first-party tools behave exactly as today regardless of MCP catalog
size. The split exists only for MCP because MCP is where catalogs grow without bound.

### D2. Per-model budget, unchanged in basis

`budget = models[].toolSearchThresholdTokens ?? floor(resolveCompactionThreshold(model) × 0.1)`,
reusing the resolver in `compaction.ts` so a future ratio change moves both. The window is the
wrong denominator: declarations compete with the conversation for the tokens available before
compaction. The estimate is the existing ~4 chars/token estimator over each eligible MCP
declaration's canonical JSON, computed once per attempt. Measured with `o200k_base` on three
representative declarations the ratio was 4.2–4.7 chars/token, so `chars / 4` slightly
over-counts and defers early, the cheap direction; no local tokenizer can be exact because each
provider renders tool definitions through its own template.

Tier computation engages only when the eligible MCP estimate exceeds the budget (strict). No
instance-level knob, per `instance-config`'s rule against instance-level context-window settings.

### D3. Over budget: declare the owner's most-used MCP tools

When deferral engages, the declared MCP tier is the longest prefix of the chat's frozen usage rank
(D4, D5), restricted to tools admitted in this attempt, whose declarations fit the budget together
with the inventory cost (D8). Everything else admitted from MCP is discoverable. A strict prefix,
not a knapsack, keeps the partition explainable: the tools declared are "the top N by use", and a
lower-ranked small tool never jumps a higher-ranked large one.

A tool with no recorded successful use is never pre-declared. For a new owner the declared MCP
tier is empty and every MCP tool is discoverable until used once, which is the previous
revision's behavior; the rank only ever adds declarations on evidence. The rejected alternatives
all invent an order: id order and first-N (arbitrary, the previous revision's reason for not
filling), operator-declared priority (a new config surface for a fact the history already
records), and server round-robin (still arbitrary within a server).

If the inventory alone exceeds the budget (a 1,000-id enum is ~16k tokens, above a 128k model's
budget), MCP tools are cut from the discoverable set, lowest-ranked first and by descending id
among unranked tools, until it fits. Cut tools are recorded unavailable with the closed reason
`declaration_budget_exceeded`, so the existing availability reminder discloses them rather than
letting them vanish. Declared tools are never cut.

### D4. The usage signal

For owner `U` at resolution time `T`, the rank is computed from `U`'s committed assistant message
parts under owner RLS:

- a use is a tool part whose id is an MCP id (`mcp__…`) and whose `outcome` is `success`;
  refusals, hallucinated names, errors, and cancellations are not use;
- the window is assistant messages created in `[T − 30 days, T)`, at most the 2,000 most recent,
  so resolution latency is bounded by a constant regardless of history size;
- a tool's score is the number of distinct assistant messages (one per completed Run) containing
  at least one use, so a Run that loops a tool thirty times counts once;
- order is score descending, then most recent use descending, then id; the stored rank keeps at
  most 256 ids with score ≥ 1.

The query scans `messages` joined to owner chats with `jsonb_array_elements` over `parts`. It runs
once per chat epoch, not per turn (D5). No index or rollup table is added: the scan is bounded by
the 2,000-message cap, and a periodic aggregate is a cache the task does not yet need. If a
measured resolution exceeds its latency target, the fix is an expression index or a rollup
maintained by an existing pg-boss schedule, decided then.

The rank is owner-scoped across all of the owner's chats, including earlier epochs of the current
chat; deleted chats drop out because the query reads live rows. Nothing is sent to the model as
text. The one model-visible effect is which MCP tools are declared.

This is conversation-derived information crossing chat boundaries, which SPEC §20.2 treats as a
separate consent decision for `shareRecentChats`. The rank is not gated on that setting: it
carries no content, title, or excerpt, only a choice among tools the operator already admitted
for every owner, and the provider already sees every admitted tool's declaration when the
catalog fits the budget. An owner who never uses MCP sees no difference. This is the design's
most debatable call; gating it on `shareRecentChats` is a one-line change if review prefers it.

### D5. The rank is a frozen chat baseline

The ordered id list is resolved in the accepted-turn transaction, stored on the `chats` row as
`mcp_tool_rank_baseline` with `mcp_tool_rank_rebaked_from` (the compaction identity it was
resolved under), and reused while that identity equals the chat's latest compaction, exactly the
skill-catalog pattern (`context-injection` "The skill catalog is a frozen prefix baseline stored
on the chat"). A chat that has never been compacted keeps its first rank. Owner forks copy both
columns with the rebake marker remapped like the skill marker. No baseline is written on an
instance with no configured MCP server.

Freezing is what makes the ranking cache-safe. A live rank would move whenever the owner uses a
tool in another chat, change the declared set, rewrite `tools`, and invalidate the whole prefix
on the next turn of every open chat. Frozen, the declared set changes only at compaction (which
rewrites the prefix anyway), on model switch (a different budget), or when the admitted catalog
changes (which already rewrites `tools`).

Resolving at acceptance rather than in the worker matches the skill baseline and keeps one
authority per epoch: a queue retry reuses the stored rank instead of recomputing it against a
history that moved. The worker intersects the frozen rank with the attempt's admitted catalog,
so a frozen id that is no longer admitted is simply skipped; the rank never grants anything.

### D6. The loaded set is what the model can see

A discoverable tool is loaded for a request iff that request's model context contains a
`tool_search` observation that loaded it, after compaction replacement and after the replay
budget has dropped whatever it drops. Within the current Run, loads from earlier steps count. The
loaded set is therefore derived at request assembly from the same projection that builds the
request, never from a separate record.

Consequences, all without new state:

- **Retry.** A queue retry starts from committed history. A failed attempt's loads were never
  committed, so they are absent; there is nothing to fence.
- **Compaction.** An observation absorbed into a checkpoint is no longer a load; the epoch
  resets. An observation retained in the kept tail stays a load, because the model can still
  see it.
- **Replay budget.** If the budget drops the pair that loaded a tool, the tool is no longer
  loaded. Callability never exceeds what the model was shown.
- **Model switch.** The stored observation is wire-neutral (D7), so each wire projects it in its
  own form (D9).
- **Revocation.** Declarations always come from the current attempt's admitted catalog. A loaded
  id that is no longer admitted is not declared, not referenced, and not callable; history never
  resurrects a capability.

The previous revision stored loaded ids on the Run row behind an attempt-token fence and promoted
them into the next Run's declared set. Deriving from history deletes that column, the fence, and
the promotion step, and it keeps cross-Run loads cache-safe on `native` wires, where promotion
would have rewritten `tools`.

### D7. `tool_search` is a reserved, llame-executed tool

Input: `{ select?: string[], query?: string, limit?: integer }`. `select` resolves exact ids;
`query` matches case-insensitive tokens against the id split on `_`/`-` and the neutralized
description, ranking exact id, then id token, then description token, ties by usage rank then
id. `limit` defaults to 5, maximum 20. Only discoverable ids of the current attempt are
candidates; admitted-but-declared, cut, unavailable, and unadmitted ids never appear.

The stored result is wire-neutral and small: `{ status: 'success', loaded: [ids], notFound: [...]
}`. It holds ids, not schemas; schemas are delivered by the wire (D9) from the current catalog.
That removes the previous revision's result-size accounting and its "loaded means delivered"
truncation rule, because the recorded result is bounded by 20 ids.

`tool_search` is refused by the registry and by `tools.allowed` validation, like `mcp__*`. It is
synthesized only when the discoverable set is non-empty, classified `read_only`, needs no tenant
database access, is absent from the availability manifest, and counts toward `maxStepsPerRun`;
the cap still wins in `prepareStep`.

llame executes the search on every wire, including `native` ones. Provider-executed search
(Anthropic BM25/regex, OpenAI hosted) is rejected: its results are provider-specific parts that
cannot replay on another wire after a model switch, and the ranking would be the provider's,
invisible to llame's usage signal and tie-breaks.

### D8. Inventory

The model must know what is discoverable:

- `harness`, and `native` on `anthropic-messages`: `select.items` carries a JSON Schema `enum` of
  the discoverable ids. Anthropic withholds deferred tools entirely, so the enum is the only
  inventory there. The enum also validates `select` for free.
- `native` on `openai-responses`: no enum. Deferred functions keep their names and descriptions
  visible natively, so an enum would duplicate them.

The inventory is charged against the budget with one strategy-neutral estimate (ids plus admitted
descriptions), so both strategies partition the same catalog identically. The enum is a
provider-native disclosure of callable-after-load tools; the rule that callable tools are never
listed in prose stays true.

### D9. Delivery is a per-model strategy

`models[].toolSearch` selects how declared and loaded schemas reach the model. Budget, rank,
partition, `tool_search` execution, the loaded-set rule, and the call gate (D10) are identical
under every strategy.

- **`harness`** (default; every wire). Discoverable tools are omitted from `tools`. The per-step
  active set is `declared ∪ loaded ∪ { tool_search }`, composed with the cap in `prepareStep`
  (cap reached → `[]`). The `tool_search` observation replays through the ordinary text
  projection, listing the loaded ids. Loading a tool edits `tools` and costs one prefix miss on
  that wire; later steps and later Runs of the epoch see the same sorted set and hit again.
- **`native` on `anthropic-messages`.** Every admitted tool is sent. Discoverable MCP tools carry
  `deferLoading: true`; `tool_search` and every declared tool do not, which also satisfies
  Anthropic's requirement that at least one tool stays non-deferred. A `tool_search` observation
  projects as a tool result whose content is a short text line plus one `tool_reference` per
  loaded id that is still admitted. The provider expands references inline and throughout
  history, so `tools` is constant for the epoch and a load costs only the appended result. No
  llame-authored block carries `cache_control`; deferred tools could not carry it anyway, and
  `anthropic-messages` keeps its request-level default.
- **`native` on `openai-responses`.** Discoverable functions carry `deferLoading: true`;
  `tool_search` is bound as `openai.tools.toolSearch({ execution: 'client', parameters })`. The
  observation projects as a `tool_search` call with `{ call_id, arguments }` and a `json` output
  `{ tools }` holding the current catalog's definitions of the loaded ids, which the adapter
  emits as `tool_search_call` and client `tool_search_output`. The execute adapter unwraps the
  SDK's `{ arguments, call_id }` into D7's input.

Startup fails when `native` is declared on `openai-completions`, `opencode-go`, or `openai-codex`,
naming the model and key. Codex can be admitted after a live check against its backend; until
then it is `harness` only. Model support is the operator's declaration, like `reasoning`: a
provider that rejects deferred tools or `tool_search` fails that request under the existing run
error contract, with no silent fallback to `harness`.

The `native` projection is a documented exception to "the ordinary projection stays portable",
scoped to `tool_search` observations. It changes representation, not meaning: the stored part is
the same wire-neutral record, and after a switch to a `harness` model it replays as text.

Why `native` is worth a second path: cache, not tokens. Under both strategies discoverable
schemas cost nothing until loaded. Under `harness` each first load in an epoch re-prefills the
whole conversation; under `native` it does not. On a long agentic chat that is the difference
between one prefix miss per newly used tool and none (see the prompt-cache study's F5 and F10).

### D10. The call gate

llame's execute wrapper refuses a call to a discoverable tool that is not loaded for the current
request with the recorded `not_available` outcome before any executor runs. Under `harness` the
SDK refuses earlier through `activeTools`; under `native` the deferred declaration is in the
request, so the wrapper is the only gate. llame cannot author the SDK's refusal text for
inactive tools (`Model tried to call unavailable tool '<id>'. Available tools: …`); because
`tool_search` is always active when anything is discoverable, that text already points the model
at it. The loading guidance lives in the `tool_search` description, which exists only when
deferral engages, so the packaged prompt and its receipt hash are unchanged for every Run.

### D11. Availability and receipts are unchanged

Tier membership is not availability. The in-memory manifest and the committed `{id,state}`
record keep describing admission and availability; a tier change never produces an `Added tools`
or `Removed tools` reminder. Only a D3 cut does, as an available-to-unavailable transition with
its closed reason. Receipts remain system-prompt-only; the partition is reproducible from the
chat's frozen rank, the model's budget, and the attempt's catalog, and every search is an
ordinary durable tool part the owner can see in the chat.

### D12. Road to per-message selection (not shipped)

A per-message selector would preload tools for the current user message before the first model
request, so the model skips the discovery round trip. The [System One study](../../../docs/research/tool-harness/2026-09-23-system-one-jev/report.md)
(D3, D4) gives its shape: filter by eligibility first, match explicit server or tool names
deterministically, ask a fast classifier (Jev, ~70–500 ms vendor-reported, $0.042/M input) a
multi-label relevance question only for ambiguous intent over a bounded shortlist, and on low
confidence, deadline, or failure preload nothing. A positive verdict never admits a tool policy
excludes.

What this change fixes so that selector is additive:

1. **A load is a history record.** D6 derives the loaded set from records in model context. A
   selector adds a second producer: a server-authored load recorded as a context item on the
   triggering user message (rail-resident under SPEC §9.8, because it is an account of something
   that happened). The derivation reads both producers; nothing else changes.
2. **Native delivery already has server-authored forms.** On `anthropic-messages` the item
   projects as a mid-conversation `role: "system"` message with `toolChanges: [{ type:
'tool_addition', toolName }]` placed right after the user message, which the installed
   adapter emits today; the model sees the tool without a search step and `tools` is untouched.
   On `openai-responses` the counterpart is an `additional_tools` developer item, absent from
   the adapter; until it lands, the selector can narrow instead of load, sending the full set
   with `allowedTools` (llame would stop stripping that key for its own use), which preserves
   the prefix but saves no schema tokens. Under `harness` a selected tool joins the declared set.
3. **`tool_search` stays the correction path.** A miss costs one search, never an unreachable
   tool.

Open before building it: a measured baseline (all-declared, rank-only, rank plus search) for
discovery round trips, latency, cost, and task success, including no-tool and mixed-server
requests; whether Anthropic's reference-only beta header or the newer `inline-tools-2026-09-15`
is required on the operator's models; and the Jev study's warning that routed tools reduced task
success in one probe (3/5 versus 5/5), which a selector must beat, not assume away.

### D13. Relation to #974 and #972

This change partitions the catalog an attempt composes at its start. Tools that #974's Workspace
MCP adds in the middle of a Run are outside that partition and follow #974's contract; whichever
change lands second states how mid-Run additions join the discoverable tier. On `native`
Anthropic wires, #974 can add them by value with `inline-tools-2026-09-15` without editing
`tools`. #972's direction of keeping unavailable tools declared and withdrawing them with
provider controls composes with D9: both keep `tools` constant and move change to the tail.

## Risks / Trade-offs

- [Weak tool-use models never call `tool_search`] → the refusal text names it; the per-model
  override raises the threshold for that model; the rank declares the tools the owner already
  relies on, so the common path needs no search at all.
- [A new owner starts with every MCP tool discoverable] → intended: the rank adds on evidence.
  The first use of each tool costs one search.
- [The rank lags within a long epoch] → a tool first used mid-epoch stays loaded through history
  (D6) and enters the declared tier at the next compaction.
- [Rank query latency on heavy histories] → bounded by the 2,000-message cap and run once per
  epoch; measured in the layer that adds it.
- [Crude token estimate] → errs toward deferring early; the override exists per model.
- [`native` on an unsupported model] → provider error through the existing run failure contract;
  operators declare `native` only on models listed as supporting it.
- [Anthropic references to a tool that stopped being admitted] → the projection omits references
  to ids absent from the current catalog, so the request never names an undeclared tool; that
  edit to replayed history costs a cache miss, which a change in `tools` already costs.
- [Replay budget drops an old search] → the tool silently stops being loaded; the model is
  refused once and searches again.
- [Cross-chat signal without `shareRecentChats`] → D4; flagged for review.

## Migration Plan

Additive: two nullable `chats` columns, one closed unavailable reason, two optional model keys.
Chats without a rank resolve one on their next accepted turn. A mixed-version window where an
older worker executes a Run accepted by a newer API only means the older worker declares every
admitted tool, as today; no stored state is misread. Rollback leaves unused columns and stored
`tool_search` parts, which replay as ordinary text observations of an unknown tool.

## Open Questions

- Q1: Gate the usage rank on `shareRecentChats` (D4)? The design says no.
- Q2: Is 30 days and 2,000 messages the right window, or should the score decay instead of
  cutting off? Chosen for simplicity; a decay adds a parameter without a measured need.

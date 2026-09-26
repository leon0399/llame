## Why

Assistant message usage and estimated cost count only the final model request of a tool loop, and a failed or cancelled Run records fabricated zeros or nothing at all ([#810](https://github.com/leon0399/llame/issues/810), [#594](https://github.com/leon0399/llame/issues/594)). The #810 reproduction undercounts cost by 63.5% for a two-step loop. The same final-request value also drives compaction, where it is the right signal, so a naive switch to cumulative usage would trigger compaction on long loops over a small reused context. Budget enforcement ([#91](https://github.com/leon0399/llame/issues/91)) and the usage ledger ([#170](https://github.com/leon0399/llame/issues/170)) both need a defined aggregate before they can build on it; no capability defines one today.

Separately, an operator may declare pricing on a subscription model to see what the same usage would have cost per token, but nothing records that such a figure is notional: the usage display renders it exactly like metered spend ([#959](https://github.com/leon0399/llame/issues/959)). The fix belongs with the aggregate because it writes the same usage record and changes the same display row.

## What Changes

- D1: An assistant message's usage is the sum of every provider-reported model request its Run attempt made, including the final tool-free answer. Each request is normalized and priced on its own before summing; reasoning stays a subset of output and cached/cache-write input stays a subset of input.
- D2: Usage carries a boolean `complete`. It is `false` when a request of the attempt completed without an input or output count; when the attempt ended failed, cancelled, or expired, or the Run's recorded status is not `completed` when the usage is written; when another attempt of the same Run reached prompt preparation; or when the usage replaces an earlier reply's usage to the same user message. When no request reported any count, the token fields are absent (unknown) rather than zero, and so is `costUsd` on a priced model; an unpriced model always records `costUsd: null`.
- D3: An incomplete aggregate keeps its known tokens and cost as a lower bound. `costUsd: null` keeps meaning only "no configured pricing".
- D4: Reasoning tokens are summed only when every request reported them; otherwise the field is absent (unknown), never zero.
- D5: Runs that fail, are cancelled, or expire, including cancellation while a tool call is open (#594), persist the known aggregate of their executing attempt instead of zeros or nothing, and, when that attempt wins the terminal transaction, emit it live through the existing `model.completed` event so the live view and reload agree. A request whose usage the provider delivered counts as reported even while the tools it requested are still running. Usage that replaces an earlier reply's usage to the same user message is marked incomplete, because the replaced spend is not carried forward. Settlements outside an executing attempt (dead-letter expiry, native-effect recovery, cancellation before an attempt starts) still record no usage.
- D6: Compaction receives the final completed request's input plus output as its own pressure signal, separate from the aggregate. Trigger behavior is unchanged.
- D7: A one-time migration records `complete` on historical assistant usage: `false` where the row has tool-call parts (persisted parts whose type starts with `tool-`), a non-completed status, or a recorded Run with prompt receipts from more than one attempt, and `true` otherwise. Stored token and cost values are never recomputed.
- D8: The usage badge shows `≥` on incomplete totals and cost with an explanation row, shows reasoning as `of which reasoning` under Output, and shows `—` for unknown values.
- D9: Message usage covers only the Run's own model requests. Compaction and title-generation spend, including compaction calls that never publish, are separate categories owned by #170; published compaction usage stays a single-request receipt in its existing record.
- D10: Every newly written usage record, on assistant messages and on published compactions, carries `billing`: `usage` (billed per token) or `subscription` (flat plan; any cost is notional). It is resolved at write time from the model entry's optional `billing`, then the provider entry's optional `billing`, then the provider type's default (`subscription` for `openai-codex` and `opencode-go`, `usage` otherwise), and is never recomputed. Billing mode does not change how cost is computed.
- D11: The usage display shows a subscription record's cost muted and struck through, labeled as a notional cost that was not billed. Records without `billing` display as before; they are not backfilled.

## Capabilities

### New Capabilities

- `run-usage-accounting`: Aggregation, completeness, pricing, billing mode, persistence, live/reload agreement, and display of assistant message usage across a Run's model requests; separation of the compaction pressure signal; scope boundaries against compaction, title, and ledger accounting.

### Modified Capabilities

- `instance-config`: MODIFIED provider list requirement so every provider variant, including the closed `opencode-go` shape, accepts the optional `billing` key; ADDED requirement for `billing` on provider and model entries, its closed value set, and boot failure on any other value.

Provider capabilities (`anthropic-messages-provider`, `opencode-go-provider`, `subscription-access-openai-codex`) keep their per-request recording and pricing rules, which now apply to each request before aggregation. `opencode-go-provider` already describes a declared price as llame's own accounting of a subscription quota; D10 records that fact rather than changing the rule. `available-models` keeps its no-recomputation rule; the D7 marker changes no computed value.

## Non-goals

- A durable per-request ledger, Chat/account rollups, or budget enforcement (#170, #91).
- Compaction storage unification (#806, #865) or the unified compaction request path (#866). This change adds nothing to the `compactions` table.
- Recording unpublished compaction calls or title-generation usage.
- Provider-specific pricing tiers, upstream-reported cost, or subscription-quota semantics (#208, #82, #808, #809, #751).
- Correcting the compaction pressure overestimate after a large in-loop tool read, where replay later caps the pair (existing behavior).
- Recovering exact spend of a reclaimed attempt; it is marked incomplete instead.

## Assumptions

- A Run executes one model at one price, so one price table applies to every request of an attempt.
- Aggregate `finishReason` is the final request's; `latencyMs` remains the attempt's wall-clock duration.
- Compaction continues to run only after completed Runs.
- Rows whose usage is null are left unmarked by D7.

## Impact

API: the model-client seam and its three wire adapters (`openai-responses`/`openai-codex`, `openai-completions` including `opencode-go`, `anthropic-messages`), test model clients, turn telemetry, Run terminal paths including parent-abort settlement, the compaction trigger argument, and one data migration on `messages.usage` with no schema change. Web: the message usage parser and badge. No OpenAPI change: `usage` is an untyped JSON object on message and event payloads. Existing fields keep their names and types; token and cost fields may now be absent when no request reported them, which the web parser already tolerates.

Behavior change in existing capabilities' inputs: a Run cancelled with an open tool call currently persists no usage, which makes its assistant turn immutable and eligible as conversation evidence. After D5 it records a non-completed status like every other cancelled turn, so it becomes retryable and is excluded from conversation search and reads, as those capabilities already specify for non-completed turns.

Configuration: the published JSON Schema, the config loader, the example config, and the Codex and OpenCode Go runbooks gain the `billing` key; existing configs keep booting because the key is optional.

Durable data: D7 writes a new key into existing JSON objects on the operator's running instance; it is idempotent and changes no existing value. Rollback leaves an unused key that older readers ignore. No tenancy or authorization boundary changes: usage stays on owner-scoped rows read under existing RLS, and the reclaim check reads only receipts of the Run being settled inside its owner's transaction.

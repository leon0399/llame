## Why

A Chat today names one exact model, and when that model fails or runs out of quota, the Run fails or
waits. Nothing lets the owner move the Chat to another model in a controlled way, and subagents
([#765](https://github.com/leon0399/llame/issues/765)) need unattended Runs that survive a provider
outage. [#1772](https://github.com/leon0399/llame/issues/1772) delivers operator-defined model
roles with ordered fallback chains, one owner action to continue on the next candidate, and an
opt-in automatic failover policy. Typed provider failures
([#1774](https://github.com/leon0399/llame/issues/1774)) and the continuation after a broken send
([#1828](https://github.com/leon0399/llame/issues/1828)) have shipped, so the failure classes that
failover keys on exist.

## What Changes

- **Model roles.** A top-level `modelRoles` map names ordered candidates, each a `models[].id` with
  an optional effort. A send names a role as `@name`, or an exact model id. An exact model never
  fails over.
- **BREAKING: `selector` replaces `modelId` on requests.** Chat sends, chat creation, Regenerate,
  `/compact`, and queued items name a `selector`. A send can omit it to use the Chat's stored
  selection. Runs and usage keep `modelId` for the model that served them, and a Run also records
  its `selector`. `GET /api/v1/models` returns `defaultSelector` in place of `defaultModelId`, and
  it publishes the roles.
- **BREAKING config.** `defaults.modelId` becomes `defaults.selector`, and
  `defaults.titleGenerationModelId` becomes `defaults.titleGenerationSelector`. Each accepts a role.
  A `models[].id` that starts with `@` fails startup.
- **The Chat stores its selection.** Each accepted send writes the selector, the effort, and a
  fallback hold when one applies. The picker reads it, so every device shows the same selection.
- **Fallback hold.** A switch to a later candidate holds the Chat on it until `revertAt`. The first
  send after `revertAt` returns to the primary. An owner pick clears the hold.
- **A model switch inside a Run opens a segment.** The failed reply closes, the output of the failed
  send is cut, and a host message carries one switch reminder to the new model. Each reply keeps one
  model. Tool-call ids are normalized for each request.
- **Continue on next candidate.** A failed reply, or a Run in a quota wait, offers the role's next
  candidate. The owner chooses it; the action labels a paid candidate.
- **`free` billing mode.** A free model is never billed. A declared price shows as notional cost.
- **Failover policy** (second cutover). A matrix per role, with an instance default, of failure
  groups (`availability`, `access`, `quota`) by Run origin (`owner`, `agent`). Every cell is off by
  default. A `quota` cell can wait for a near reset and switch for a far one. `allowPaidFallback`
  gates an automatic switch from a `subscription` or `free` candidate to a `usage` candidate.
- **Run origin.** Every Run records `owner` or `agent`. Only `owner` has a producer in this change.
- **Title generation through a role.** A title call walks the role's chain on a failure, with no
  hold and no quota wait.

## Assumptions, confirmed with Leo

Map decisions: [#1755](https://github.com/leon0399/llame/issues/1755),
[#1757](https://github.com/leon0399/llame/issues/1757),
[#1762](https://github.com/leon0399/llame/issues/1762),
[#1777](https://github.com/leon0399/llame/issues/1777),
[#1816](https://github.com/leon0399/llame/issues/1816),
[#1822](https://github.com/leon0399/llame/issues/1822), and the ADRs
[Automatic failover is opt-in per model role, failure group, and Run origin](../../../docs/adr/2026-11-20-automatic-failover-is-opt-in.md)
and [A model switch within a Run opens a new segment](../../../docs/adr/2026-11-20-a-model-switch-opens-a-segment.md).
This change adds the ADRs
[Requests name a selector, and `modelId` names the model that served](../../../docs/adr/2026-11-23-requests-name-a-selector.md)
and [A title call walks its model role's chain](../../../docs/adr/2026-11-23-a-title-call-walks-its-role-chain.md).
Spec grilling on 2026-11-23 ([record](https://github.com/leon0399/llame/issues/1772#issuecomment-7101877446)):

- grilling Q1 A: one top-level `modelRoles` map.
- grilling Q2 A: a role's `failover` overrides the instance default cell by cell.
- grilling Q3 B: `selector` on requests and in `defaults`; `modelId` stays the served model.
- grilling Q4: after a switch, the selected effort carries when the new model declares it; else the
  candidate's `effort`, else the model's `defaultEffort`.
- grilling Q5 A: an effort change during a hold keeps the hold.
- grilling Q6 B: `allowPaidFallback` gates only automatic failover.
- grilling Q7 A: the policy is read when the failure happens; a waiting Run keeps waiting after a
  restart.
- grilling Q8 A: the assistant-visible catalog waits for subagents (#765).
- grilling Q9 A: a title call walks its role's chain.

Assumptions that follow and were not asked separately:

- Existing Chats get a stored selection from their latest turn Run's model and effort, as an exact
  selector. Existing Runs get `selector` equal to their `modelId`.
- The chain never wraps to the primary.
- A stored selector that the config no longer offers falls back to `defaults.selector`, which the
  Chat then stores. Today the web picker makes the same fallback.
- A steer, interrupt, or queue send that names `selector` changes the stored selection for later
  sends; the live Run keeps its model.
- A compaction Run never switches, and the next-candidate action does not apply to it.
- The `read` Selector keeps its glossary meaning; this change adds the term "Model selector".
- A compaction request on the Run's current model follows the Run's rules. A window compaction on
  the previous Run's model is a side call and never fails over.
- The quota-cell duration is `switchAfterSeconds`, in the repository's existing seconds style,
  in place of the map's `switchAfter: <duration>`.

## Deviation from the grilling record

- #1839 listed the `allowPaidFallback` gate in the manual cutover. grilling Q6 B moved it to the
  automatic cutover, #1840. Both issue bodies are updated.
- #1757 Q4 says an owner fork copies "the pin". The glossary term is fallback hold; this change uses
  it.

## Capabilities

### New Capabilities

- `model-roles`: role configuration, selectors, the Chat's stored selection, the fallback hold, effort
  after a switch, the model-switch segment and its reminder, tool-call id normalization, Continue on
  next candidate, and the role catalog in `GET /api/v1/models`.
- `model-failover`: Run origin, the failover policy matrix, automatic failover by failure group,
  the quota-cell wait threshold, the paid gate, and title generation through a role.

### Modified Capabilities

- `available-models`: "Authenticated executable models endpoint" (`defaultSelector`, roles);
  "System model configuration is explicit" (`defaults.selector`); "Model use for compaction and title
  generation is explicit" (`defaults.titleGenerationSelector`); "Web sends only with valid selected
  model" (the stored selection); "Chat sends accept an optional reasoning effort" (effort against the
  resolved model). **Removed**: "Chat sends require explicit model id", replaced by `model-roles` "A
  send names a selector or uses the stored selection".
- `instance-config`: "Model catalog configuration" (the `@` rule and the `defaults` names);
  "First-slice setting surface" (the `defaults` names); "Providers and models may declare their
  billing mode" (`free`).
- `run-usage-accounting`: "Usage records its billing mode" (`free`); "The owner's usage display
  marks subscription cost as notional" (free cost).
- `turn-actions`: "A follow-up request is validated before any write" (`selector`, `candidate`);
  "Continue applies only to the reply of a failed, cancelled, or expired Run" (the next candidate);
  "Continue requests the next step of the same turn" (no kept parts on the next candidate); "The
  follow-up Run's usage replaces the reply's usage" (a switch writes a new reply); "The chat history
  read reports the latest Run" (`selector`); "The latest turn shows Continue and Regenerate actions"
  (the next-candidate action); "Regenerate offers a repeat and a choice of settings" (the stored
  selection).
- `quota-wait`: renames "Only the deadline job and a cancellation wake a quota wait" to "Only the
  deadline job, a cancellation, and the next-candidate action wake a quota wait"; "The web shows a
  quota wait above the composer" (the action).
- `provider-failures`: "A longer stated wait parks the request or ends it" and "A caller sees a failure
  only after the retries and the quota wait" (a `quota` cell can switch).
- `run-steering`: "A pending item records a producer and a sender" (selectors, not models).
- `background-jobs`: "A Run that the host starts uses the settings of its notice" (selector and origin).
- `model-system-prompts`: "A model switch replaces the top-level prompt and preserves portable
  history" (a role can switch); "Model switches use canonical persisted context text and metadata"
  (the `failover` cause on a host message, and its dedupe).
- `reasoning-output`: "Earlier reasoning replays only for the model that produced it" (the model of
  the reply, not of the Run).
- `tool-calling`: "A failed attempt stays in later context as the user saw it" (a switch cuts the
  failed send).
- `chat-commands`: "The API parses a command before it admits a send", "A bare rename regenerates
  the title", "A bare rename without a title model fails", and "Compact on an idle Chat starts a
  compaction Run" (selectors and the title selector).
- `chat-creation`: "A create request with a message validates it before any write" (`selector`).

Deliberately unchanged, with the reading under which each holds:

- `available-models` "Selected model id is persisted for execution": `runs.model_id` holds the
  model of the current segment. A switch records and announces the new id, so it is not "silently
  fall back to a different default".
- `available-models` "Resolved reasoning effort is persisted and executed per run": the rule forbids
  a new resolution "at pickup". A switch resolves the effort of its new segment and persists it before
  that segment sends, as `model-roles` defines.
- `available-models` "Available model entries use opaque ids and rich display metadata": "accepted as
  chat `modelId`" reads as "accepted as an exact selector".
- `durable-runs` "Run failures are classified — infra retries, model failure is terminal": a
  failure that a switch answers is not a run-level failure. A failure with no switch stays terminal.
- `quota-wait` "The quota wait covers every request of a Run to its model": "its model" is the model
  of the current segment.
- `run-steering` "A delivered message starts a segment and an attempt": a switch delivers its host
  message with cause `failover`, as a step-boundary compaction delivers its continue message.
- `run-steering` "A steer or an interrupt keeps the settings of the Run": a steer that names
  `selector` changes the stored selection of the Chat, not the live Run.
- `run-steering` "Queue items start one Run each after a completed Run": "the settings of the item"
  are its selector, effort, and permission mode, resolved at the start by `model-roles`.
- `provider-failures` "Some events end the counts of the next step": a switch is a delivery, so its
  segment starts with no carried count.
- `owner-chat-forks` "The fork's Chat row carries the source's frozen context": the list is of
  frozen prompt context; `model-roles` adds the selection copy as its own requirement. The active
  `tool-search` change also modifies that requirement, so this change does not.

## Impact

- Config: `llame.config.schema.json`, `config-loader.ts`, `llame-config.ts`, the example config,
  and the operator docs. Operators rename the two `defaults` keys before they upgrade.
- API: the send, chat-creation, follow-up, delivery, and `/compact` DTOs; `GET /api/v1/models`; the
  Chat read; a new action on a Run in a quota wait; `openapi.json` and the generated web client;
  the live protocol for new Run events.
- Database: `chats.model_selection`, `runs.selector`, `runs.origin`, the item settings in
  `chat_deliveries` and `chat_jobs`, with a backfill migration that discards no Chat.
- Worker: the failure seams in `run-execution.service.ts`, segment close and open, the context
  builder (reasoning replay, tool-call ids), title generation, and usage telemetry.
- Web: the model picker, the effort picker, the turn actions, the quota-wait box, and the usage
  display.

## Non-Goals

- The assistant-visible catalog and the assistant's own choice of role (#765).
- Owner overrides of roles or of the failover matrix.
- Context promotion, quota-aware preflight, and decision-model routing (#1612 C4-C6).
- A budget check before a switch to a paid candidate (#1758), and a cost ledger (#170).
- A destination or egress filter on candidates (#1762).
- `schedule` and `event` Run origins, which come with automations.
- A shared cache-routing key for owner forks (#1823).

## Acceptance

- An owner sends to `@coding`; the Run uses its primary, and the Chat stores `@coding`.
- With no failover policy, a failed `@coding` reply offers "Continue on next candidate"; the action
  starts a Run on the second candidate, and later sends stay there until `revertAt`.
- A Run in `awaiting_quota` on a role offers the same action, and the action ends the wait.
- With `agent × availability` on, an `agent` Run whose primary fails with `overloaded` after its
  retries continues on the next candidate in a new segment. An `owner` Run on the same role fails.
- An exact model selector never switches.
- An operator config with `defaults.modelId` fails startup with a message that names the key.

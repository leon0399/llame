# context-injection

## Purpose

The single rail on which llame injects server-authored context into a chat's model-visible conversation: one envelope, one provenance framing an operator cannot delete, one vocabulary of producer, form, and residency, and one durable record of what was actually injected. Producers own what their item says and when it fires; this capability owns everything they share, so that adding a context surface is an additive change rather than a new convention.

## Requirements

### Requirement: Server-authored context is injected as discrete items on one rail

Every server-authored contribution outside the system prompt MUST use one context item on one rail. Each item MUST use the canonical `<system-reminder>` envelope. A producer MUST NOT add its own top-level delimiter. Each item MUST occupy its own text block, separate from other items and owner text.

The provider wire role MUST remain `user`. The system MUST NOT invent a provider role. An accepted-turn item MUST attach to its triggering user message when that message can carry it. A producer without a triggering message MUST use its existing producer-owned message.

A compaction checkpoint MUST remain a rail item with producer `compaction` and form `checkpoint`. Its storage MUST be an ordinary `data-context` part on a checkpoint row. Replay MUST convert that part to one user-role message. Model-system-prompts MUST own its coverage and selection boundaries.

A recency-digest snapshot associated with a checkpoint MUST use a separate host-authored user-role message. That message MUST contain only its digest context item. Its payload MUST name the checkpoint. Both rows MUST commit atomically.

Replay MUST place the companion immediately after its checkpoint and before retained owner messages. No companion can enter the summary or start another Run. Duplicate publication MUST create no second companion.

An in-Run item MUST persist on the Run's assistant message immediately after its triggering step's last tool part. Its next and later steps MUST receive it as user-role text after that tool result. Live assembly MUST remove earlier copies and place one item after the matching tool-result message. That placement MUST remain independent of model-client override retention. The item MUST use ordinary envelope, provenance, and vocabulary rules.

The dispatch transaction of the first request with an in-Run item MUST persist it. Every terminal outcome MUST keep it. Only a retry or follow-up dispatch that resets the reply can remove it with that reply. A step-boundary compaction MUST absorb it once. It MUST NOT reappear outside the summary unless its producer defines a re-baseline snapshot.

A job item MUST NOT be an in-Run item. Run steering MUST deliver it through the owner's delivery message. Without an owner message, the host message MUST carry context items only and no text part. A host-started job-notice Run MUST use that same rule.

Ordinary persisted-literal items MUST commit in request dispatch before model I/O, regardless of the later outcome. A dispatch transaction that fails MUST send nothing. Accepted-turn items MUST precede the owner's text. The request MUST use their exact stored text.

A retry MUST keep earlier dispatched accepted-turn items unchanged and in place. It MUST derive each producer again against effective stored context. That comparison MUST count prior committed disclosure, seen state, and baseline items. Persist only newly derived items after the last stored item and before owner text. Order those new items by producer rank. A retry without earlier dispatch MUST use normal first-attempt ranks, relative to accepted prompt imports and skill activations.

Follow-up Runs MUST follow the same keep-and-append rule. They MUST reuse accepted prompt imports and skill activations without another read or activation. Regenerate MUST remove prior model-switch items with cause `model` or `failover` on its first dispatch. It MUST then append only the model switch its own comparison yields. Retry of that Regenerate MUST keep the newly stored switch.

Retry preparation MUST read ordinary history only through its triggering user message. It MUST also load the effective checkpoint and its associated companion. Its own reply MUST NOT enter that request. Only its dispatch can create or reset the reply to `running`. That reset MUST remove the dead attempt's output and in-Run items. Pre-dispatch failure MUST leave those records unchanged.

Preparation MUST also load an imported digest baseline associated with the effective epoch start, irrespective of its storage sequence. For the latest pre-conversion turn, retry and follow-up preparation MUST load its imported comparison notice. This notice MUST retain its distinct logical boundary. It MUST NOT enter an earlier fork through the baseline association.

Failed, cancelled, expired, or superseded output and items MUST remain historical records until an authorized follow-up resets the reply. Later turns MUST replay them like other committed history. Acceptance of an owner message MUST NOT publish a failed attempt's uncommitted context. Checkpoints, their companions, and epoch state MUST publish before the next model step, outside ordinary dispatch. A later attempt failure MUST NOT retract them.

#### Scenario: Regenerate retains imported epoch context

- **WHEN** an owner regenerates the latest unabsorbed turn after digest conversion
- **THEN** its request retains the imported epoch baseline and comparison notice despite their higher storage sequences
- **AND** disabled sharing neither loses the baseline nor resolves a fresh one

#### Scenario: Two items are injected on one turn

- **WHEN** the system injects two context items before a user's message
- **THEN** each item is in its own `<system-reminder>` envelope in its own text content block
- **AND** the visible text of the user is in a further block of the same message
- **AND** the system creates no additional conversation message

#### Scenario: A turn carries no injected item

- **WHEN** a turn has no context item to inject
- **THEN** the user message carries only the visible text of the user
- **AND** its serialized form is the same as the form of a turn from before this capability

#### Scenario: An item is not attached to a turn

- **WHEN** the producer of an item has no triggering user message to attach to
- **THEN** the message that its producer already owns carries the item
- **AND** the item uses the same envelope, frame, and vocabulary as an attached item

#### Scenario: An in-Run item follows its triggering tool result

- **WHEN** a producer authors an item after a tool result inside a Run
- **THEN** the system stores the item on the assistant message of the Run after that tool part
- **AND** each later model step of that Run receives it as a user-role message directly after that tool result
- **AND** the item stays on the assistant message whatever the outcome of the Run, until a dispatch replaces the reply
- **AND** only the dispatch of a retry of the same Run, or of a follow-up Run from `turn-actions`, replaces the reply
- **AND** that reset removes the item together with the output of that attempt

#### Scenario: A compaction checkpoint replaces history

- **WHEN** compaction publishes a checkpoint row for a superseded prefix
- **THEN** the row carries one persisted `data-context` part whose text is the complete final checkpoint envelope
- **AND** the envelope and the stored part keep producer `compaction` and form `checkpoint`, and replay uses that stored text with no rebuild from metadata

#### Scenario: A failed Run keeps the items it sent

- **WHEN** the worker of a Run dies after the first model request of the Run carried accepted-turn items, with an instruction bundle
- **THEN** those items stay on the triggering user message after the Run settles as failed
- **AND** the request of the next turn carries each stored item once and loads none of them again

#### Scenario: A retry keeps its stored accepted-turn items

- **WHEN** an earlier attempt dispatches accepted-turn items before a retry
- **THEN** the retry keeps their stored text once and compares against their effective disclosure
- **AND** it appends only newly derived items in producer order
- **AND** only retry dispatch resets the prior assistant output and in-Run items

#### Scenario: A retry that fails before dispatching changes nothing

- **WHEN** a retry of a Run fails before its own dispatch transaction commits, after an earlier attempt of the Run dispatched
- **THEN** the assistant message, the output, the in-Run items, and the stored accepted-turn items of the earlier attempt stay unchanged
- **AND** the retry stores no item and advances no told or baseline state

#### Scenario: A follow-up Run keeps the turn's stored items

- **WHEN** the first Run of a turn stored a `temporal` item and failed, and the owner regenerates the turn
- **THEN** the request of the Regenerate Run carries the stored `temporal` item unchanged
- **AND** the triggering user message holds one `temporal` item

#### Scenario: A follow-up Run appends a new availability change

- **WHEN** an operator enables a new tool after the first Run of a turn dispatched, and the owner continues the turn
- **THEN** the Continue Run compares tool availability with the first Run
- **AND** it stores one `tool-availability` item after the last stored context item of the triggering user message

#### Scenario: A Regenerate replaces the model-switch item

- **WHEN** the first Run of a turn stored a model-switch item from model `A` to model `B`
- **AND** the owner regenerates the turn with model `A`, the model of the prior reply
- **THEN** the dispatch transaction of the Regenerate Run removes that item from the triggering user message
- **AND** the Regenerate request carries no model-switch item

#### Scenario: A follow-up Run reuses prompt imports and skill activations

- **WHEN** the triggering user message has an import marker and a `$skill` mention, and its first Run stored a `prompt-imports` item and a `skill-activation` item
- **AND** the owner regenerates the turn
- **THEN** the Regenerate Run reads no import target again and stores no second `prompt-imports` or `skill-activation` item
- **AND** its request carries the stored items once

#### Scenario: A job item between two steps gets a host message

- **WHEN** a job settles between two model steps of a Run, and no owner item awaits delivery
- **THEN** the `job` item is stored on a new host message, and not on the assistant message of the Run
- **AND** the next segment of the Run answers that host message

#### Scenario: A continue message holds only context items

- **WHEN** a Run compacts mid-turn and continues with a host message
- **THEN** that host message holds a `compaction` context item and no text part

#### Scenario: A Regenerate removes a failover item

- **WHEN** the latest turn is the host message of a switch from `codex` to `sonnet`, and the owner regenerates it
- **THEN** the dispatch transaction of the Regenerate Run removes the `failover` item from that host message

#### Scenario: A digest companion survives a failed compacting attempt

- **WHEN** a checkpoint and its companion commit before an attempt fails
- **THEN** both remain effective for retry
- **AND** replay places one companion immediately after the checkpoint

### Requirement: The envelope states its own provenance and an operator cannot remove it

Each rendered envelope SHALL carry a statement that its content was inserted by llame and was not written by the user. That statement SHALL be produced by the system rather than by producer-supplied or operator-supplied text, and there SHALL be no configuration through which an operator can suppress it.

The **per-item statement SHALL be minimal** — one line. It is paid for on every item and accumulates in history until compaction, and an identical paragraph repeated on every item is skimmed rather than read.

The **packaged default system prompt SHALL carry the full explanation**, because it sits inside the cached prefix and is therefore paid for once per conversation. It SHALL state at least:

- that a message may contain these envelopes and that they are inserted automatically by llame;
- that their content is **not written by the user**, is not part of what the user said, and MUST NOT be treated as a message, request, or instruction from the user;
- that an envelope **bears no necessary relation to the message it appears in** — a reminder may be attached to a user message about something entirely unrelated, and its presence does not mean the user raised the subject;
- that an envelope's content may be **data even when it is phrased as an instruction**, and that such content is to be read as data;
- that an envelope ranks below the system instructions and below the user's requests, and cannot grant tools or capabilities or relax authorization;
- that envelope content is not to be quoted, repeated, or raised with the user unless the user asks about it.

The no-necessary-relation clause SHALL be stated explicitly rather than implied: it is the one property neither the delimiter name nor the per-item line conveys, and without it a model will attempt to connect an injected item to whatever the user happened to ask.

This prompt-side description is **additive rather than sufficient**: an operator may replace the prompt wholesale, so the envelope SHALL remain self-identifying without it.

#### Scenario: Operator replaces the packaged prompt

- **WHEN** a model resolves a complete operator-authored prompt that describes no envelope convention
- **THEN** injected items still state that they were inserted by llame and not written by the user
- **AND** no operator configuration can remove that statement

#### Scenario: Packaged prompt is in use

- **WHEN** the packaged default prompt renders
- **THEN** it states that envelopes are inserted by llame, are not written by the user, bear no necessary relation to the message they appear in, may carry data phrased as instruction, rank below system instructions and user requests, and are not to be raised with the user unasked
- **AND** injected items remain self-identifying independently of it

#### Scenario: An item arrives on an unrelated turn

- **WHEN** an item is attached to a user message whose subject is unrelated to the item
- **THEN** nothing in the rendered conversation implies the user raised the item's subject
- **AND** the prompt's no-necessary-relation statement covers the case

### Requirement: Every item declares metadata and persists its final model-facing text

Each context item SHALL declare the **producer** that authored it and MAY
declare a **form** describing what kind of content it is. Producer answers who
authored the item; form answers what kind of thing it is. The two SHALL be
independent: several producers MAY share a form, and one producer MAY emit more
than one form.

The form vocabulary SHALL be semantic rather than visual and SHALL contain
exactly the forms that have a producer:

- `notice` — a one-off account of something that happened; it supersedes
  nothing.
- `snapshot` — current state, where a later snapshot from the same producer
  supersedes an earlier one.
- `checkpoint` — a summary that supersedes this chat's own earlier history.

A form SHALL NOT be defined ahead of a producer that emits it.

Every newly authored persisted context part SHALL use `type: "data-context"`,
retain `data.v: 1`, and carry its complete final model-facing text beneath
`data.text`. The text SHALL include the canonical envelope, attributes,
provenance, producer body, and closing delimiter. Writers SHALL require a
non-empty string.

A compaction checkpoint SHALL declare producer `compaction`, form `checkpoint`,
and rail residency on an ordinary persisted `data-context` part, and SHALL
carry the complete final canonical envelope beneath `data.text` like every
other persisted item. It SHALL NOT need a second storage shape to preserve its
semantic form.

`data.text` SHALL be the sole replay authority, except that request assembly
emits the image and PDF parts or placeholders of a `prompt-imports` item from
the image and PDF entries in its payload, after `data.text`. Producer, form, Run linkage,
and payload SHALL remain non-rendering metadata for validated machine behavior,
owner UI, provenance, and inspection. A metadata/text disagreement SHALL NOT
cause text to be regenerated: text wins for model replay, while metadata
consumers validate and fail closed independently.

An unknown producer or form SHALL NOT prevent structurally valid non-empty text
from replaying. A stored context part with missing text or the empty string
SHALL remain stored but contribute no model-visible part. It SHALL NOT be
backfilled or rendered from metadata. Whitespace-only text SHALL survive
unchanged.

A `checkpoint` row is the one exception to that inertness. A checkpoint message
whose `data.text` is empty or missing SHALL fail request preparation closed
rather than replay as an inert part, because an inert checkpoint would hide every
row it absorbed and silently shrink the model-visible history. It SHALL NOT be
backfilled or reconstructed from its raw summary either.

#### Scenario: Reader encounters unknown metadata with persisted text

- **WHEN** a context part carries non-empty text and names an unrecognized
  producer or form
- **THEN** its text replays verbatim in the stored position
- **AND** the reader does not interpret the unknown payload

#### Scenario: Reader encounters an unrecognized producer

- **WHEN** a context part has non-empty text and an unrecognized producer
- **THEN** the text replays verbatim in its stored position
- **AND** a data-only part contributes no model-visible text

#### Scenario: Reader encounters an unrecognized form

- **WHEN** a context part has non-empty text and an unrecognized form
- **THEN** the text replays verbatim in its stored position
- **AND** no behavior is inferred from the unknown form

#### Scenario: Text and metadata disagree

- **WHEN** persisted context text disagrees with producer metadata
- **THEN** the model receives the stored text unchanged
- **AND** machine behavior validates metadata without rewriting that text

#### Scenario: Existing metadata-only part is replayed

- **WHEN** an existing context part carries metadata but no non-empty text
- **THEN** it contributes no model-visible part
- **AND** no current renderer is invoked to manufacture historical prose
- **AND** a `checkpoint` row is not treated as one of those inert parts: its
  request fails preparation instead of replaying without the rows it absorbed

#### Scenario: Client supplies control metadata

- **WHEN** a client request contains a context-item-shaped part
- **THEN** request validation rejects the message
- **AND** no client-authored part is persisted or trusted
- **AND** only server-derived state can author an item

#### Scenario: Service-level defense encounters control metadata

- **WHEN** a direct service caller bypasses request validation and supplies
  parts containing a context-item-shaped part
- **THEN** the part is discarded while the remaining user text parts retain
  their order
- **AND** the message is rejected before database work when neither a user text
  part nor a file part remains
- **AND** only server-derived state can author an item

#### Scenario: Service-level defense keeps an image-only message

- **WHEN** a direct service caller bypasses request validation and supplies a context-item-shaped
  part alongside one file part referencing the caller's own media and no text part
- **THEN** the forged part is discarded and the message is accepted with its file part
- **AND** only server-derived state can author an item

#### Scenario: Service-level defense does not count another owner's media

- **WHEN** a direct service caller supplies a context-item-shaped part alongside one file part
  referencing media owned by a different owner and no text part
- **THEN** the message is rejected before any row is written
- **AND** no part referencing the other owner's media is persisted

#### Scenario: A prompt-imports item's PDF entry replays after its text

- **WHEN** a stored `prompt-imports` item's payload holds one PDF entry
- **THEN** replay supplies the item's `data.text` followed by that entry's PDF file part or PDF
  placeholder, chosen as `media-attachments` requires
- **AND** the item's text is not regenerated from its payload

### Requirement: Producer item bodies are packaged templates rendered at author time

Each producer's model-facing body MUST be authored as a packaged template file owned by that producer and shipped with the executing process, rendered once when the item is authored or staged, and persisted under the existing persisted-literal rule. Packaged item templates SHALL NOT be operator configuration: no configuration key SHALL select, replace, or disable one, and an edit SHALL take effect only for items authored by a process built from the edited source.

Packaged item templates are outside the boot-time validation, path allowlist, and value escaping that `instance-config` defines for configured prompt files. The producer SHALL remain responsible for neutralizing untrusted text before it is rendered, using the reserved-delimiter rules `instance-config` defines and covering exactly the values it neutralizes before this change: owner-authored text, other chats' titles and excerpts, operator-authored catalog descriptions and instruction bodies, summarizing-model output, and tool result text. Grammar-constrained identifiers and published host paths SHALL continue to render as they do today. The engine SHALL add no escaping of its own, so that rendered bytes are exactly what the producer prepared.

The rail envelope, its `producer` and `form` attributes, and the provenance statement SHALL remain produced by the rail around the rendered body; a packaged item template SHALL render the body only.

#### Scenario: Rendered item bytes are unchanged by the move to a template

- **WHEN** a producer that previously rendered its body from code renders the same payload from its packaged template
- **THEN** the persisted item text is byte-identical to the previous rendering
- **AND** the envelope and provenance statement are unchanged

#### Scenario: The one body this change re-specifies

- **WHEN** the `effective-context-change` body renders after this change
- **THEN** it names both models, as `model-system-prompts` requires
- **AND** it is the only surface whose rendered bytes differ from before this change

#### Scenario: Untrusted text carries a reserved delimiter

- **WHEN** an untrusted text value the producer neutralizes today contains the rail's reserved delimiter name as a tag
- **THEN** the rendered body carries it neutralized exactly as before the template migration
- **AND** the rendered body contains one envelope

#### Scenario: A template edit does not alter stored items

- **WHEN** a packaged item template changes in a later release
- **THEN** every item persisted before that release replays its stored text unchanged
- **AND** only items authored by the new release use the new wording

#### Scenario: No configuration selects a packaged item template

- **WHEN** an operator configuration attempts to name a replacement for a producer's item template
- **THEN** startup rejects the unknown key under the closed schema
- **AND** no producer body is read from an operator path

### Requirement: Packaged item templates render from producer-owned values only

A packaged item template MUST receive only its producer payload and view values derived in that module. Those values can include closed-kind booleans, reason labels, and plural forms. Prefix projections MUST NOT enter that context. This includes owner, skill, and web-search projections. The digest producer MUST use only its own entries and comparison data.

`model`, `context`, and `tools` MUST remain reserved producer-value names. The temporal item MUST use its stored instant and zone, not the prefix anchor. Packaged item templates MUST remain separate from replaceable templates. The retired `chats.*` namespace MUST NOT exist as a supplied prefix projection.

#### Scenario: Owner personalization is not renderable in an item

- **WHEN** a packaged item references a per-user profile or identity path absent from its own values
- **THEN** that reference renders empty
- **AND** no prefix profile or identity enters the item

#### Scenario: The prefix digest projection is not renderable in an item

- **WHEN** a packaged item references an absent `chats.*` value
- **THEN** that reference renders empty without a prefix lookup
- **AND** digest content reaches the rail only through its producer payload

#### Scenario: A closed reason code renders its label

- **WHEN** the producer derives a human label for its closed reason code
- **THEN** the item renders that label
- **AND** it does not emit the internal code

### Requirement: Co-occurring items have a total author-time order

The system can inject more than one item on the same turn. The path that
authors items and prepares requests MUST then persist them in a fixed producer precedence
order. They MUST go before the user text in the user message of the turn:

1. `interrupted`
2. `provider-failure`
3. `job`
4. `compaction`
5. `effective-context-change`
6. `regenerate`
7. `tool-availability`
8. `project`
9. `workspace`
10. `git`
11. `instructions`
12. `skill-catalog`
13. `skill-activation`
14. `prompt-imports`
15. `recency-digest`
16. `temporal`

When one producer contributes more than one item, the system MUST store those
items in emission order. A producer added later MUST extend this list
in the rail specification.

The `interrupted` producer of `run-steering` attaches its item to a delivered message or the host message after an interrupt `/compact`.
The `job` producer of `background-jobs` attaches items to a delivered message, the user message of a send, or a host message.
The `compaction` producer attaches its `notice` item to the host message after a step-boundary compaction.
The `provider-failure` producer of `provider-failures` stores its `notice` item in the reply, directly after the last settled tool part of a failed send.

In-Run items MUST be in the order of the model step that caused them. In a step,
they MUST be in this same producer precedence. The system MUST NOT sort them
again against the attached items of the user message of the turn.

Replay MUST keep the stored part order. It MUST NOT sort historical items again
through the current precedence list. It MUST NOT merge adjacent text parts. A
`checkpoint` row of its own carries the compaction checkpoint. That row MUST
follow the placement rule of its capability, not this list of attached items.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, an availability change, and a chat-list change come with one user message
- **THEN** their final text blocks persist in the fixed author-time order
- **AND** each later replay keeps the stored order and part boundaries

#### Scenario: One producer contributes two items on one turn

- **WHEN** one producer emits two items before the same user message
- **THEN** both persist in the emission order of the producer
- **AND** the system does not merge or suppress either item

#### Scenario: A temporal item accompanies other items on one turn

- **WHEN** a temporal item comes with another context item
- **THEN** the system persists the temporal item last among the attached items
- **AND** replay keeps that stored position

#### Scenario: The precedence list changes later

- **WHEN** a later release adds a producer or changes the author-time precedence
- **THEN** new items follow the new precedence order
- **AND** the current messages keep their original stored order

When worker preparation adds attempt-owned items next to message facts that
persisted earlier, the final request MUST apply this same producer order. It
MUST keep the internal order of each producer and all user-authored content.
The transaction that dispatches the first model request MUST store that final
order atomically on the user message of the turn. It MUST put each item at its
producer rank, around the `prompt-imports` and `skill-activation` facts that
persisted before dispatch.

A retry of the same Run MUST keep the order that the dispatch transaction of an
earlier attempt stored, unchanged and in place. The retry MUST store each item
that it newly yields after the last stored context item and before the user
text. Its own new items MUST follow producer order. This rule MUST apply also
when the producer of that item ranks before a stored item.

A retry of a Run whose earlier attempts never dispatched MUST instead store each
item at its producer rank, as a first attempt does. When an earlier Run of the user message dispatched, a follow-up Run from `turn-actions` MUST follow the retry-after-dispatch rule.

#### Scenario: Workspace and skill catalog items share a turn

- **WHEN** one user message accompanies a Workspace state change and an effective skill catalog change
- **THEN** the `workspace` item comes before the `skill-catalog` item, and both come before the user text
- **AND** replay keeps those stored positions

#### Scenario: Workspace snapshot and root instructions share a turn

- **WHEN** an accepted turn sets up the Workspace snapshot again and stages the root instruction chain
- **THEN** `workspace` precedes `instructions`
- **AND** both precede any `skill-catalog` item

#### Scenario: Workspace and git snapshots share a turn

- **WHEN** an accepted turn yields a `workspace` snapshot, a `git` snapshot, and an `instructions` item
- **THEN** `workspace` precedes `git`, and `git` precedes `instructions`
- **AND** replay keeps those stored positions

#### Scenario: Skill activation and prompt imports share a turn

- **WHEN** an explicit skill activation and prompt imports come with one user message
- **THEN** each `skill-activation` item comes before the `prompt-imports` item, and both come before the user text
- **AND** replay keeps those stored positions

#### Scenario: A retry's new item follows the stored items

- **WHEN** an earlier Run attempt stored `instructions` and `skill-catalog` items in its dispatch transaction
- **AND** a retry of the Run detaches the Workspace binding
- **THEN** the retry stores its `workspace` detach narration after the stored items and before the user text
- **AND** this exception preserves earlier items despite the lower author-time rank of `workspace`
- **AND** the stored items keep their positions, and replay keeps the order that results

#### Scenario: A retry of a Run that never dispatched orders items by producer rank

- **WHEN** an earlier Run attempt persisted a `prompt-imports` item and failed before its dispatch transaction committed
- **AND** a retry yields `workspace`, `instructions`, and `temporal` items
- **THEN** the retry dispatch stores `workspace` and `instructions` before `prompt-imports`
- **AND** it stores the `temporal` item after it, as a first attempt does
- **AND** all of them come before the user text

#### Scenario: A Regenerate notice follows the stored items

- **WHEN** a turn's first Run stored `temporal` and dispatched
- **AND** a Regenerate of that turn yields a `regenerate` notice
- **THEN** the Regenerate dispatch stores the notice after the `temporal` item and before the user text

#### Scenario: An interrupted item comes before the owner text

- **WHEN** a Run delivers an interrupt as a user message
- **THEN** the `interrupted` item is the first attached item of that message
- **AND** the dispatch transaction of the next segment stores it

#### Scenario: A job notice follows the interrupted item

- **WHEN** a Run delivers an interrupt and a job notice in one user message
- **THEN** the `interrupted` item is the first attached item, and the `job` item is the second
- **AND** both come before the owner text

#### Scenario: A continue message after an interrupt and a job

- **WHEN** an interrupt `/compact` stops a step while a background job settles
- **THEN** the continue message holds the `interrupted` item, then the `job` item, then the `compaction` item

#### Scenario: A provider-failure notice comes first in its step

- **WHEN** a send fails after a settled `read` call, and the same step boundary yields a `tool-availability` in-Run item for the `read` result
- **THEN** the `provider-failure` item comes directly after the `read` part
- **AND** the `tool-availability` item comes after the `provider-failure` item

#### Scenario: Project context precedes Workspace context

- **WHEN** initial preparation yields `project`, `workspace`, `git`, and filesystem `instructions` items
- **THEN** the author-time order is `project`, `workspace`, `git`, then `instructions`
- **AND** the order creates no override hierarchy between their guidance

### Requirement: Residency determines whether a change re-renders the prompt or appends an item

Each contribution MUST have a residency class. Prefix-resident content MUST enter the system prompt in full on every request. Rail-resident events MUST enter as persisted items. Rail-only state MUST use snapshots and notices, not system-prompt content.

An event MUST be rail-resident. Rarely changed complete state MUST be prefix-resident unless its owning capability specifies rail-only residency. Frequently changed complete state MUST use a frozen prefix baseline with rail deltas, unless its owning capability specifies rail-only snapshots. Compact state can use rail-only snapshots after each checkpoint.

The Workspace and recency-digest producers MUST be rail-only. The digest MUST use one baseline snapshot per epoch plus bounded notices. Its companion snapshot MUST follow checkpoint publication. Residency MUST NOT create a second system-prompt carrier. Checkpoint re-baseline state MUST affect the request the checkpoint precedes and survive later attempt failure.

#### Scenario: A new surface reports an event

- **WHEN** a new context surface reports that something occurred
- **THEN** it is rail-resident
- **AND** it is not added to the system prompt

#### Scenario: A new surface states rarely-changing state

- **WHEN** a new context surface states current state that changes less often than the chat publishes checkpoints
- **THEN** it is prefix-resident unless its capability specifies rail-only residency
- **AND** when it is prefix-resident, a change to it re-renders the prompt rather than appending an item

#### Scenario: A new surface states frequently-changing state

- **WHEN** a new context surface states current state that changes more often than the chat publishes checkpoints
- **THEN** it follows its capability residency, with a frozen prefix baseline or rail-only snapshots and notices
- **AND** the baseline is re-resolved when a checkpoint is published rather than on every change

#### Scenario: A new surface states compact current state

- **WHEN** a new context surface states a small complete statement of current state whose re-statement after each checkpoint is cheaper than a prefix baseline
- **THEN** it can be rail-only, with a `snapshot` emitted when the state changes
- **AND** the snapshot is re-emitted after a checkpoint rather than changing the system prompt

### Requirement: A prefix change is announced only when history was conditioned on the old value

A change to prefix-resident content SHALL be **silent to the model by default**: the model reads the re-rendered prompt, so its content needs no announcement.

An announcement SHALL be injected as a rail item when the changed content is **assertional** — a fact the model may previously have denied, lacked, or answered around — because the conversation then contains turns that contradict the new prefix and the contradiction would otherwise be unexplained. An announcement SHALL NOT be injected when the changed content is **behavioral** — tone, format, working style, or comparable guidance — because the only history conditioned on it is the model's own prior output, which is not authoritative.

An announcement SHALL state that earlier turns predate the changed content and that they are not to be treated as contradicting it.

Disclosure to the **owner** SHALL be unconditional and independent of this rule: every change to the effective context SHALL be recorded for the owner whether or not it is announced to the model.

**This requirement is not yet satisfied for every prefix contribution, and the gap SHALL be stated rather than implied.** Only the model cause of an effective-context change is detected today; a personalization edit or an operator prompt reload changes prefix-resident content without producing an announcement, so an owner who supplies a fact the assistant previously said it lacked still leaves the conversation carrying an unexplained contradiction. Detecting the remaining causes requires the binder to record why it minted a new snapshot, which no shipped path does, and is owned separately. Likewise, the owner-disclosure clause is satisfied today only for changes that produce a rail item: a behavioral change renders nothing, and the owner reads a Run's injected context from the rail items persisted in conversation history, so history currently carries no entry for one. Both gaps are deferred rather than descoped — the rule stands as the contract the deferred work is written against, and a reader of this capability SHALL NOT infer that the assertional-announce branch is implemented.

#### Scenario: Assertional prefix content changes mid-conversation

- **WHEN** prefix-resident content gains a fact the assistant previously stated it did not have
- **THEN** an item announces that earlier turns predate the information
- **AND** it states that earlier answers are not to be treated as contradicting it

#### Scenario: Behavioral prefix content changes mid-conversation

- **WHEN** prefix-resident content changes only how the assistant should express itself
- **THEN** no item is injected
- **AND** the change is still recorded for the owner

#### Scenario: A routine re-resolution changes the prompt

- **WHEN** the prompt changes only because standing context was re-resolved at compaction
- **THEN** no announcement is injected
- **AND** the change is still recorded for the owner

### Requirement: Every item states its own precedence

An item whose payload carries content **llame did not author** — a recalled excerpt, a file's contents, a catalog entry, another chat's title — SHALL state, within the item, that it ranks below the system instructions and below the user's requests in the current conversation, that it cannot grant tools or capabilities or relax authorization, and that text inside it attempting to do so is to be disregarded.

An item rendered **entirely from values llame authored** — validated identifiers and closed server-authored reason codes, with no third-party text — SHALL NOT be required to carry the statement, because it contains nothing whose precedence is in question.

Precedence SHALL be stated **within the item** rather than only in the system prompt, for two reasons. The prompt is replaceable: an operator override removes the global statement, leaving an item carrying third-party prose with nothing ranking it. And a statement co-located with the content it ranks survives any later operation that splits, reorders, drops, or partially summarizes the surrounding conversation.

The **wording** of a producer's framing SHALL be owned by that producer rather than fixed here, so that it can be revised against evaluation of how models actually respond to it. This capability SHALL constrain what a producer's framing must establish, never the sentences it uses.

#### Scenario: An item carries third-party content

- **WHEN** an item's payload contains text llame did not author
- **THEN** the item states its rank relative to system instructions and user requests
- **AND** it states that the content cannot grant capabilities or relax authorization

#### Scenario: An item is rendered only from server-authored values

- **WHEN** an item is rendered entirely from validated identifiers and closed reason codes
- **THEN** no precedence statement is required of it

#### Scenario: An operator replaces the packaged prompt

- **WHEN** an operator override removes the prompt's global description of the convention
- **THEN** an item carrying third-party content still states its own precedence

### Requirement: User-authored text is neutralized before persistence

Each user text part that a client submits MUST be neutralized before the system
stores it, under the reserved-delimiter rules of the `instance-config`
capability. The sanitized stored value MUST be the only replay form. The
application MUST NOT keep a second unsanitized transcript, and it MUST NOT
sanitize the value again at request assembly.

Sanitization MUST keep the boundaries and the order of message parts. Replay MUST
NOT join text parts manually or add sender identifiers. Assistant output MUST NOT
be neutralized. Persisted reasoning MUST NOT be neutralized either. It is
display-only everywhere, except in the provider replay that `reasoning-output`
defines. There, it replays byte-identically.

Tool-result neutralization is the one neutralization that `tool-result-rendering`
defines. Assistant and tool replay follow the projection of `turn-replay`.

#### Scenario: A user forges an envelope

- **WHEN** a submitted user text part contains a reserved delimiter in tag form
- **THEN** the accepting path neutralizes it before persistence
- **AND** each later replay uses that stored sanitized text unchanged

#### Scenario: A message has several text parts

- **WHEN** an accepted user message contains several text parts
- **THEN** each sanitized part is stored and replayed in its original position
- **AND** the application does not join the parts into a replacement string

#### Scenario: Two users participate in one chat

- **WHEN** stored user turns have different `senderUserId` values
- **THEN** later model replay uses the stored parts of each turn and adds no sender labels

#### Scenario: An assistant turn discusses the envelope

- **WHEN** an assistant turn contains the reserved delimiter as subject matter
- **THEN** its replayed visible text is byte-identical to what the model produced and is not neutralized
- **AND** persisted reasoning is not part of that visible text, and when `reasoning-output` replays it, it is byte-identical and not neutralized

#### Scenario: A tool result contains an envelope

- **WHEN** a tool result contains a reserved delimiter in tag form
- **THEN** the rendering of `tool-result-rendering` neutralizes it once
- **AND** replay sends the same neutralized text that the live loop sent

### Requirement: Compaction is the rail's re-baseline boundary

A published checkpoint MUST be the rail re-baseline boundary. A delta producer MUST establish a new epoch instead of comparison across the boundary. Frozen prefix baselines MUST retain their owning lifecycle. Rail-only producers MUST re-establish state outside the summary for the request the checkpoint precedes.

The checkpoint, its companion snapshot, and epoch state MUST commit before that request. A later attempt failure MUST NOT retract them. Retry MUST reuse them. Enabled digest compaction MUST refresh its selection. Disabled digest compaction MUST carry only the frozen baseline without source reads.

The summary instruction MUST exclude standing context and every recency-digest item. This semantic exclusion MUST rely on model compliance, not a claim of structural erasure.

Runtime tool catalogs, descriptions, and owner-variable resolution MUST retain their per-attempt lifecycle. A Run MUST count as dispatched when `turn_tool_availability` is non-null or its status is completed. An empty stored record MUST count. Availability comparison MUST use the most recent prior dispatched Run within the current epoch, regardless of outcome. A non-dispatched attempt MUST establish no baseline. The active checkpoint boundary MUST still determine that epoch.

A new epoch MUST begin when the active absorbed boundary reaches the triggering user sequence of the last prior dispatched Run. The worker MUST NOT compare checkpoint UUID inequality as the epoch test. A baseline from an absorbed source Run MUST NOT survive merely because an unexecuted Run copied another checkpoint id.

The epoch test MUST NOT use checkpoint creation time or the assistant reply sequence. An in-place retry can retain its reply below a newer checkpoint.

#### Scenario: A delta producer crosses a compaction

- **WHEN** a checkpoint is published before a model step
- **THEN** a delta producer establishes a fresh baseline for that very request rather than comparing against pre-checkpoint state
- **AND** no transition is reported across the boundary

#### Scenario: A frozen baseline crosses a compaction

- **WHEN** a chat with a frozen prefix baseline publishes a checkpoint
- **THEN** the baseline is re-resolved in the same transaction, before the model step that follows
- **AND** it is not re-resolved by any other event

#### Scenario: A failed dispatched Run anchors the epoch boundary

- **WHEN** the most recent prior dispatched Run failed after dispatching, and the active checkpoint's absorbed-through sequence is at or above that Run's triggering user message
- **THEN** the next accepted turn begins a new rail epoch
- **AND** a Run accepted in between whose attempts dispatched no model request does not replace the failed Run as the most recent prior dispatched Run

### Requirement: An item is either persisted-literal or bind-time

Each item MUST be one of two kinds:

- **persisted-literal**: durable storage holds the complete final text that replay uses; or
- **bind-time**: the system computes the item for one request, and no durable historical text
  exists.

Replay MUST NOT use the metadata of a persisted-literal item as a source to rebuild its prose,
frame, attributes, sanitization, or order. A persisted context part with absent or empty text is
inert stored data, not a third render mode. The system MUST NOT persist a bind-time item
into message history, because a stored statement about the current request can become false
later.

#### Scenario: A persisted-derived item is replayed

- **WHEN** a conversation holds a context part with non-empty final text
- **THEN** replay uses that text directly
- **AND** renderer changes do not change it

#### Scenario: A data-only item is replayed

- **WHEN** a stored context part has no non-empty final text
- **THEN** it adds no model-visible part
- **AND** replay does not use its metadata to make one

#### Scenario: A bind-time item is replayed

- **WHEN** the system assembles a request for a turn that had a bind-time item before
- **THEN** no old copy of that item is in history

The system MUST persist an attempt-generated item for later conversation history as a
persisted-literal part. It MUST do this in the dispatch transaction of the first model request
that carries the item. That request MUST use the exact stored text. A failure of the
attempt MUST NOT discard the item. Only two dispatch transactions remove an attempt's in-Run
items, together with its output. The first is the dispatch of a retry of the same Run, which
replaces the attempt's non-completed reply. The second is the dispatch of a follow-up Run from
`turn-actions`, which replaces the reply. A Continue Run puts back the in-Run items of its kept
parts. A Regenerate dispatch also removes the model-switch items of the triggering user message,
as the rail requirement states. A compaction checkpoint row is not a contribution of a dispatch
transaction. It publishes
with the epoch state that it re-bakes, before the step that it precedes, and that state stays
after a failure of the attempt. This persistence adds no new wire-format item kind, and it does
not let a bind-time producer persist into message history. Content that the system copied from
outside the Chat into a persisted message part MUST stay after its source is deleted. That
limitation MUST stay documented.

#### Scenario: A source of injected content is deleted

- **WHEN** a reminder copied content from another Chat, and that Chat is deleted later
- **THEN** the persisted reminder part does not change
- **AND** the documentation states the deletion limitation

#### Scenario: A follow-up dispatch replaces in-Run items with the reply

- **WHEN** a `failed` reply holds an in-Run item after its first settled tool call, a second settled tool call, then partial text, and a Continue Run dispatches
- **THEN** the Continue reply holds the item in its stored position, after the first tool part
- **AND** the reply does not hold the partial text, which only the event log of the failed Run keeps

### Requirement: Worker-attempt cutover preserves existing conversation state

The coordinated cutover MUST preserve messages, literal reminders, checkpoints, epoch identity, and historical observations. It MUST add no retrospective replay filter or failed-attempt reconstruction. Post-cutover attempts MUST retain dispatched partial output and items under the ordinary lifecycle.

The digest-column retirement MUST use the explicit chat-recency-digest conversion rules. That conversion can omit only unprovable derived fields under Q11. It MUST preserve source parts and receipts and report omissions privately. Removing columns MUST NOT authorize a Chat reset or lost message. Other receipt/catalog migrations MUST confer no permission to rewrite history.

#### Scenario: An existing Chat crosses the worker-attempt cutover

- **WHEN** a Chat has literal reminders, a checkpoint, and digest state
- **THEN** cutover preserves its records and converts proven digest fields under the explicit migration rules
- **AND** it privately reports only unprovable derived omissions
- **AND** later compaction and updates follow the new rail lifecycle

#### Scenario: A post-cutover attempt fails in an existing Chat

- **WHEN** an attempt fails after dispatch under the new runtime
- **THEN** its stored output, items, and committed disclosure remain part of history
- **AND** the failure causes no retrospective reset of earlier state

#### Scenario: A pre-cutover failed Run is not backfilled

- **WHEN** an old failed Run never published its items
- **THEN** cutover invents none of those items
- **AND** later production uses stored effective history

### Requirement: Stored parts cross a minimal SDK conversion boundary

Request assembly MUST use `messages.parts` as the durable application and UI history. It MUST keep
the model-bearing stored parts and their order. Owner `file` parts are the one exception, and their
placement follows below. It MUST omit declared display-only parts, except reasoning parts.
`reasoning-output` decides which reasoning parts return to the provider.

Request assembly MUST map each remaining `data-context` part on a user message to one ordinary SDK
text part that contains `data.text`. `prompt-imports` can attach image and PDF entries to that
item. After the text part, each image entry with `retainedMedia` or `media` MUST map to one image part or
to the image placeholder text part. The image part is built from the image's model variant. Each such PDF entry MUST map to
one file part, built from the PDF's original, or to the PDF placeholder text part. An entry without
either key adds no part. The form of each
entry follows from three things, as `media-attachments` requires. These are the availability of the
variant or original, the epoch image window, and the declared input of the request model.

Request assembly MUST map a `data-context` part on an assistant message to one user-role message
with one text part that contains `data.text`. It MUST emit that message directly after the
tool message of the step that holds the tool part before it in stored order. It MUST NOT merge the text into the
assistant message's own content or into the tool message.

Request assembly MUST map a `data-context` part on a `checkpoint` row to one user-role message with
one text part that contains `data.text`. It MUST emit that message in place of the rows through the
checkpoint's absorbed-through sequence, before each later user and assistant row. That boundary
selects the checkpoint, not the checkpoint row's own sequence. A Run MUST take the latest checkpoint
whose absorbed-through sequence is below the sequence of the triggering user message. The reason is
that a checkpoint published before the step sits above the user row that it was published for.
Request assembly MUST then give the ordered parts to the AI SDK. It MUST NOT build a joined
transcript manually.

Request assembly MUST map each owner `file` part on a user message at request time from the media
object that it references. A stored `file` part MUST carry only its `media://` reference and never
image or PDF bytes. In that message, the mapped file parts MUST go, in their stored order, directly
after the last mapped `data-context` part, the temporal row included. When the message has no such
part, they MUST go at the start of the message. All other parts MUST keep their stored relative
order. Each image file part MUST map to one text part `Image n (media://<id>):`. Each file part whose
`mediaType` is `application/pdf` MUST map to one text part `PDF n (media://<id>):`. `n` counts the
file parts of the same kind in that message, from 1. After an image label, request assembly MUST
emit one image part built from the object's model variant, or the image placeholder text part.
After a PDF label, it MUST emit one file part built from the object's original, or the PDF
placeholder text part. That file part has `mediaType` `application/pdf` and the stored name as
`filename`. The epoch image
window and the declared input of the request model select each form, as `media-attachments`
requires.

A stored tool part whose result is an image result (`kind: "image"`) MUST map to a tool output of
type `content`. `media-attachments` can select an image part for that reference. Then the output
carries the result's text and then one image part built from the image's model variant. A result
without `retainedMedia` and without `media` is not a reference, so its output MUST carry only the
result's text. For each other result, the output MUST carry the result's text and then the image
placeholder in all other cases, with no image part. For a `media://` result or image entry, the
model variant is the stored object's. For each other image, it is the retained model variant in the
stored part. The display-only `thumbnail` of an
image result or image entry MUST NOT cross the boundary. Its retained bytes MUST cross it only as an
attached image part.

A stored tool part whose result is a PDF result (`kind: "pdf"`) MUST map to a tool output of type
`content`. `media-attachments` can select a file part for that reference. Then the output carries
the result's text and then one file part built from the PDF's original. A result without
`retainedMedia` and without `media` is not a reference, so its output MUST carry only the result's
text. For each other result, the output MUST carry the result's text and then the PDF placeholder
in all other cases, with no file part. For a `media://` result or PDF entry, the original is the
stored object's. For each other PDF, it is the retained original in the stored part.
`media-attachments` specifies the transport of image and PDF outputs on Chat Completions wires.

Media references MUST resolve only in the media of the Run owner. A `media://` reference that does
not resolve for that owner MUST add no byte or descriptor field of a media object to the request. It
MUST map to the unavailable placeholder that `media-attachments` defines, or to the PDF unavailable
placeholder for a PDF reference.

Request assembly MUST build assistant and tool messages through the projection of `turn-replay`.
The messages that it gives to the AI SDK MUST follow the prefix rule of `turn-replay`, where that
rule applies. This is a rule on those messages. It is not a promise of byte identity on the provider
wire, because SDK conversion, role grouping, and provider serialization can change.

The current top-level system prompt is outside message history and can change. A checkpoint can
replace only the prefix that it explicitly supersedes. It does this through the coverage boundary
and the replay-selection rule that `model-system-prompts` requires. The system MUST NOT replay a
different stored form of superseded history.

#### Scenario: A checkpoint row crosses the SDK boundary

- **WHEN** a chat's effective history is replayed for one triggering user message
- **THEN** the checkpoint supplied as one user-role message carrying its stored text is the latest checkpoint whose absorbed-through sequence is below that user message's sequence
- **AND** no user or assistant row through that checkpoint's absorbed-through sequence is supplied

#### Scenario: Context data crosses the SDK boundary

- **WHEN** a stored user message contains non-empty `data-context.data.text`
- **THEN** the transition supplies one `{ type: "text", text: data.text }` part in the same position
- **AND** no producer renderer, sanitizer, sorter, or manual join runs

#### Scenario: An assistant-message context part crosses the SDK boundary

- **WHEN** a stored assistant message contains a tool part followed by a non-empty `data-context` part
- **THEN** replay emits the assistant message and the tool message of that step, and then one user-role message with that text
- **AND** the context text is not part of the tool message

#### Scenario: SDK serialization changes

- **WHEN** an SDK or provider release changes its wire representation while accepting the same ordered UI parts
- **THEN** the application-level replay contract remains satisfied
- **AND** the system does not claim provider-wire or cache-byte identity

#### Scenario: Reasoning parts cross the boundary for their own Chat

- **WHEN** request assembly builds a Run's request from stored parts that include reasoning parts that the model rule of `reasoning-output` replays
- **THEN** those parts are passed to the AI SDK in their stored positions with any provider metadata they carry
- **AND** every other declared display-only part is still omitted

#### Scenario: Owner attachments are placed after context items and before text

- **WHEN** a stored user message holds an activation item, its temporal row, one text part, and two file parts stored after the text
- **AND** the request model declares `image` input, and the epoch image window attaches both references
- **THEN** the request supplies, in order, the activation text, the temporal row text, `Image 1 (media://<first id>):`, the first object's image part, `Image 2 (media://<second id>):`, the second object's image part, and then the owner's text
- **AND** each image part carries the referenced object's model variant, while the stored parts still carry only their `media://` references

#### Scenario: A text-only model receives labelled placeholders for attachments

- **WHEN** a stored user message holds one text part and one file part and the request model's `input` lacks `image`
- **THEN** the file part maps to `Image 1 (media://<id>):` followed by the image placeholder text part ahead of the owner's text
- **AND** no image part is supplied for that message

#### Scenario: An image read result crosses as tool content

- **WHEN** a later step of the Run that read an image replays that `read` tool part on a model with `image` input
- **AND** the epoch image window attaches the reference
- **THEN** the tool message carries an output of type `content` with the text of the result
- **AND** one image part built from the retained model variant in the stored tool part follows that text
- **AND** the output carries no `thumbnail`

#### Scenario: An image read result for a text-only model carries a placeholder

- **WHEN** the same stored tool part is replayed to a model whose `input` lacks `image`
- **THEN** the tool output carries the result's text followed by the image placeholder
- **AND** it carries no image part

#### Scenario: An earlier turn's image read result carries the not-retained placeholder

- **WHEN** a later turn on a model that declares `image` input replays a stored `read` image result
- **AND** that result has no `media` field and no `retainedMedia`
- **THEN** the tool output carries only the result's text
- **AND** it carries no image part and no placeholder

#### Scenario: An earlier turn's retained image read result crosses as tool content

- **WHEN** a later turn on a model that declares `image` input replays a stored `read` tool part that keeps retained bytes
- **AND** the epoch image window attaches the reference
- **THEN** the tool output carries the result's text and then one image part built from the retained model variant
- **AND** the output text carries no `thumbnail` and no retained bytes

#### Scenario: A prompt-import image crosses as an image part or a placeholder

- **WHEN** a stored user message holds a `data-context` item to which `prompt-imports` attaches one image entry
- **AND** the Run that imported it sent a request to a model with `image` input, and the epoch image window attached the reference
- **AND** a later Run replays it to a model whose `input` lacks `image`
- **THEN** the first request supplies the item's text followed by one image part built from the image's model variant
- **AND** the second supplies the item's text followed by the image placeholder text part and no image part for that entry

#### Scenario: Another owner's media never enters the request

- **WHEN** a stored file part or `media://` image or PDF result in owner A's chat references a media object owned by owner B
- **THEN** no byte, dimension, page count, name, or media type of B's object appears in A's request
- **AND** the reference maps to the unavailable placeholder, or to `[pdf media://<id> unavailable]` for a PDF reference

#### Scenario: Images and a PDF in one message are labelled by kind

- **WHEN** a stored user message holds one text part and file parts for two images followed by one PDF
- **AND** the request model declares `image` and `pdf` input, and the epoch image window attaches all three references
- **THEN** the request supplies, ahead of the owner's text, `Image 1 (media://<first id>):`, the first image part, `Image 2 (media://<second id>):`, the second image part, `PDF 1 (media://<pdf id>):`, and one file part with `mediaType` `application/pdf` and the stored name as `filename`, built from that object's original
- **AND** the stored parts still carry only their `media://` references

#### Scenario: A model without PDF input receives a labelled PDF placeholder

- **WHEN** a stored user message holds one text part and one file part that references a stored 15-page PDF named `paper.pdf`
- **AND** the `input` of the request model lacks `pdf`
- **THEN** the file part maps to `PDF 1 (media://<id>):` followed by `[pdf media://<id> paper.pdf 15 pages, omitted: this model has no PDF input]` ahead of the owner's text
- **AND** no file part is supplied for that message

#### Scenario: A PDF read result crosses as tool content

- **WHEN** a later step of the Run that read a PDF replays that `read` tool part on a model with `pdf` input
- **AND** the epoch image window attaches the reference
- **THEN** the tool message carries an output of type `content` with the text of the result
- **AND** one file part built from the retained original in the stored tool part follows that text

#### Scenario: An earlier turn's PDF read result carries the not-retained placeholder

- **WHEN** a later turn on a model that declares `pdf` input replays a stored `read` PDF result
- **AND** that result has no `media` field and no `retainedMedia`
- **THEN** the tool output carries only the result's text
- **AND** it carries no file part and no placeholder

#### Scenario: An earlier turn's retained PDF read result crosses as tool content

- **WHEN** a later turn on a model that declares `pdf` input replays a stored `read` tool part that keeps retained bytes
- **AND** the epoch image window attaches the reference
- **THEN** the tool output carries the result's text and then one file part built from the retained original

#### Scenario: A prompt-import PDF crosses as a file part or a placeholder

- **WHEN** a stored user message holds a `data-context` item to which `prompt-imports` attaches one PDF entry
- **AND** the Run that imported it sent a request to a model with `pdf` input, and the epoch image window attached the reference
- **AND** a later Run replays it to a model whose `input` lacks `pdf`
- **THEN** the first request supplies the item's text followed by one file part built from the PDF's original
- **AND** the second supplies the item's text followed by the PDF omitted placeholder text part and no file part for that entry

### Requirement: The skill catalog is a frozen prefix baseline stored on the chat

The proactively eligible skill catalog for a Chat SHALL be computed from that Chat's effective skill sources, as defined by `agent-skills`, and SHALL be classified as a frozen prefix-resident baseline with rail-resident deltas. The baseline SHALL be the `skills` prompt projection defined by `model-system-prompts`: admitted entries in code-point name order, each with name and description, plus the count of proactively eligible entries omitted. Admission SHALL retain whole entries while the admitted count stays within 256 and the cumulative UTF-8 length of name and description stays within 16 KiB, so that template-owned per-entry markup cannot multiply the bound; omission SHALL be disclosed through that count whenever the baseline admits at least one entry, and the proactively eligible set SHALL remain inspectable through `read("skill://")` regardless.

The baseline and the names of the entries the Chat was last told SHALL be persisted on the Chat row under owner isolation, following the recency-digest precedent, together with the identity of the checkpoint message under which the baseline was resolved. Accepted-turn preparation SHALL reuse the stored baseline only when a baseline is persisted and its recorded identity equals the Chat's latest checkpoint message — a Chat that has published no checkpoint records both as absent and keeps reusing its first baseline — and SHALL otherwise resolve the current catalog from that Chat's effective skill sources and start a new baseline and told state in the same accepted-turn transaction as the user message and Run. No baseline SHALL be written for a Chat whose effective skill source set is empty. Package edits, model switches, and other prompt contributions SHALL NOT refresh the baseline. A checkpoint published before a Run's first model request SHALL re-resolve the baseline in the same transaction as that checkpoint, so the request that follows it renders the refreshed baseline. Caller-supplied owner identifiers SHALL NOT authorize baseline or told-state reads or mutations. The epoch that identity comparison serves SHALL be the rail epoch that `Compaction is the rail's re-baseline boundary` defines, which states its boundary once.

The baseline SHALL enter the prompt only through the template projection. A template that does not reference `skills` SHALL render no catalog, and no server-rendered block SHALL be appended outside the template. Operator-authored descriptions SHALL be neutralized before composing the prompt or any item and SHALL replay from persisted text without another sanitization pass.

#### Scenario: Catalog is frozen within an epoch

- **WHEN** a package description changes or the model is switched between two user turns with no compaction between them
- **THEN** the next Run's prompt renders the stored baseline byte-for-byte
- **AND** the effective-context snapshot is reused rather than re-minted for that reason

#### Scenario: Compaction starts a new baseline

- **WHEN** a Chat publishes a checkpoint after catalog notices have accumulated
- **THEN** that checkpoint's publication resolves the current catalog as its new baseline and told state
- **AND** old deltas are not applied again against that new baseline

#### Scenario: A pre-step checkpoint refreshes the baseline inside a Run

- **WHEN** context fitting publishes a checkpoint before a Run's first model request
- **THEN** that Run's request renders the baseline the checkpoint refreshed
- **AND** the next accepted turn reuses that baseline rather than resolving another

#### Scenario: Operator template omits the namespace

- **WHEN** a model's template never references `skills`
- **THEN** its prompt carries no catalog and boot succeeds
- **AND** explicit `$skill` activation on that model still loads instructions through the rail

#### Scenario: Another owner targets catalog state

- **WHEN** owner A attempts to read or mutate owner B's Chat baseline or told state
- **THEN** datastore enforcement refuses access using the authenticated identity
- **AND** supplying owner B's identifier does not authorize the operation

#### Scenario: Workspace sources contribute to a bound Chat's baseline

- **WHEN** a new baseline is resolved for a Chat bound to a Workspace containing a proactively eligible skill
- **THEN** that skill is included in the Chat's baseline subject to the ordinary admission bounds
- **AND** a Chat without that Workspace binding continues to resolve its baseline from its own effective sources

### Requirement: Explicit activations are rail items carrying current instructions

Each explicit `$skill` selection SHALL produce one `skill-activation` item with form `notice` in the triggering user message before the first model request. A successful item SHALL state which mention selected the skill, the absolute skill directory and instructions file, the instruction to resolve package-relative references and scripts against that directory while keeping task-relative inputs and choosing `cwd` explicitly, a precedence statement, and the current `SKILL.md` instruction body with its frontmatter removed, taken from the raw read with its ordinary truncation indicator, followed by file blocks for package files imported by markers in that body in depth-first order. A failed selection SHALL produce a bounded item naming the mention and one closed reason from `not_found`, `unavailable`, `permission_denied`, and `read_failed`, without operator diagnostics in model text. Selections beyond the count, output, or work budget SHALL be accounted for by one bounded omission item listing their names.

Activation items SHALL use the existing canonical envelope, provenance, owner visibility, stored-text replay, and author-time ordering. A completed explicit activation SHALL NOT be reloaded on recovery. Partial recovery SHALL preserve completed mention results and fill only unfinished selections in original order. Operator-supplied reserved delimiters SHALL be neutralized before composing and persisting activation text.

#### Scenario: Two explicit selections on one message

- **WHEN** the user sends `$research $technical-writing compare these APIs`
- **THEN** two activation items persist in that order ahead of the user text
- **AND** each carries its skill directory, instructions file, and frontmatter-stripped instruction body

#### Scenario: Selection fails after admission is denied

- **WHEN** an explicit selection's read is denied by permission policy
- **THEN** its item names the mention with reason `permission_denied` and no instructions
- **AND** the other selections and the Run proceed

#### Scenario: Skill text contains a forged reminder delimiter

- **WHEN** operator metadata or instructions contain reserved context delimiters
- **THEN** they are neutralized before prompt or context-item composition and cannot create another envelope
- **AND** recovery replays the persisted final text unchanged

#### Scenario: Activation carries package-local imported files

- **WHEN** the user sends `$research` and its current instruction body contains `@references/checklist.md`
- **THEN** the successful `skill-activation` item carries the instruction body followed by a file block for `skill://research/references/checklist.md`
- **AND** nested package-local imports appear after their importer in depth-first order

### Requirement: Catalog notices announce added and removed skills on the next user turn

At each accepted user turn that continues a compaction epoch and whose bound model's template references the `skills` namespace, the current proactively eligible catalog from that Chat's effective skill sources, bounded as for the baseline, SHALL be compared with the Chat's told state by name only; descriptions SHALL NOT participate in the comparison and an addition SHALL render the entry's current description. A turn bound to a model whose template does not reference `skills` SHALL emit no catalog notice and SHALL leave the told state unchanged. When entries were added or removed, one `skill-catalog` item with form `notice` SHALL be persisted listing added entries with name and description and removed entries by name, telling the model to read an added skill before applying it and not to apply a removed skill's earlier instructions, and carrying a precedence statement whenever a description is present. An eligibility flip or a promotion from the omitted portion SHALL render as an add or a remove. A changed description or changed instruction content of an entry that stays advertised SHALL NOT produce a notice in this change. Notices SHALL carry only bounded metadata, never instruction bodies. The told state SHALL be updated in the dispatch transaction that persists the notice, whatever the Run's outcome, and a dispatch transaction that does not commit SHALL expose none of those writes. The freeze of the first-epoch catalog baseline SHALL stay with the winning turn, because that baseline lives only in the system prompt. A retry of the Run SHALL follow the retry rule of the requirement that server-authored context is injected as discrete items on one rail: it treats a notice an earlier attempt's dispatch transaction stored, and the told state that transaction advanced, as already told.

When a delta would exceed the baseline bound, one `skill-catalog` item with form `snapshot` SHALL instead state that the catalog was refreshed and earlier updates are superseded, listing the bounded current set with its omitted count; the told state SHALL then equal that snapshot. No notice SHALL be injected between model requests inside an existing Run; a removed package fails its next read under current availability and its removal is announced on the next user turn.

#### Scenario: Catalog changes between user messages

- **WHEN** one skill is added and another removed after a user turn in the same epoch
- **THEN** the next user turn carries one notice naming the addition with its description and the removal by name
- **AND** the immutable effective-context receipt retains the frozen baseline while the notice is persisted on the user message

#### Scenario: Template opts out of the catalog

- **WHEN** a skill is added while the Chat's bound model uses a template that never references `skills`
- **THEN** no catalog notice is emitted and the told state is unchanged
- **AND** after a switch to a model whose template renders the catalog, the next turn announces the additions since the baseline

#### Scenario: Description changes without membership change

- **WHEN** an advertised skill's description or `SKILL.md` content changes between user turns
- **THEN** no catalog notice is emitted in this change (tracked as [#821](https://github.com/leon0399/llame/issues/821))
- **AND** a later `skill://` read returns the current content

#### Scenario: Active Run sees a deleted skill

- **WHEN** a package disappears while a Run is making tool calls
- **THEN** its next skill read fails under current availability
- **AND** the removal notice waits for the next user turn

#### Scenario: Delta exceeds the bound

- **WHEN** the added and removed entries cannot be rendered within the baseline bound
- **THEN** a supersession snapshot with the bounded current set replaces the delta
- **AND** the told state equals the snapshot's admitted entries

#### Scenario: Told-state transaction is interrupted

- **WHEN** the dispatch transaction fails before commit after preparing a catalog notice
- **THEN** neither the notice nor the updated told state is visible, and no model request dispatches
- **AND** a retry produces one consistent notice without repeated or skipped catalog changes

#### Scenario: A failed Run's catalog notice is not repeated

- **WHEN** a Run's dispatched request carried a `skill-catalog` notice announcing an added skill and the Run then failed
- **THEN** the notice stays on the triggering user message and that dispatch transaction advanced the told state
- **AND** the next accepted turn in the same epoch, with the catalog unchanged, emits no catalog notice

#### Scenario: Workspace source changes affect only that Chat's delta

- **WHEN** a Chat enters a Workspace containing a skill that was absent from its effective sources, or detaches from a Workspace whose skill was previously effective, within the same compaction epoch
- **THEN** the next accepted turn compares the current effective catalog and announces the resulting addition or removal for that Chat
- **AND** another Chat without that Workspace binding compares only its own effective sources

### Requirement: Skill activations remain separate from immutable enqueue receipts

The enqueue-bound effective-context receipt SHALL retain its immutable prompt/tool snapshot and SHALL NOT be extended with post-claim activation results. Skill catalog notices and activations SHALL instead be persisted as rail items on the triggering user message, alongside all existing producers, under the owner-visibility rules that govern that message.

#### Scenario: Owner inspects before and after activation

- **WHEN** the owner reads the enqueue receipt before execution and again after skill activation
- **THEN** its snapshot content and hashes are unchanged
- **AND** the activation items are persisted on the triggering user message rather than in the receipt

#### Scenario: Activation succeeds but request preparation fails

- **WHEN** activation results have been persisted but window fitting fails before provider dispatch
- **THEN** those observations remain in the owner message
- **AND** the immutable enqueue receipt is not changed

### Requirement: Workspace binding changes are rail-resident context items

Attempt preparation MUST finish the Workspace binding re-check and any detach first. It MUST then resolve effective skill sources, explicit `$skill` activation, prompt imports, Workspace MCP clients or catalog, `workspace` items, and the accepted-turn `instructions` load. A detaching attempt MUST contribute no Workspace skill activation, no `skill://` resolution, no prompt imports, no Workspace tools, and no accepted-turn `instructions` item. It MUST stage no prompt-import instruction triggers, and it MUST still narrate the detach.

When an earlier attempt of the Run stored accepted-turn items and dispatched, a detaching retry MUST keep those items unchanged and in place. It MUST store its detach narration after them, ahead of the user text, in its own dispatch transaction. That narration is the detach notice and the snapshot of the unbound state. When no `prompt-imports` item from an earlier attempt of the Run is persisted, prompt-import markers MUST stay prose for that attempt. A `prompt-imports` item from an earlier attempt of the Run MUST stay on the user message. It MUST replay unchanged as stored text, without a new read or a removal.

Every other accepted-turn item that an earlier attempt persisted, an accepted-turn `instructions` item included, MUST also stay and replay unchanged. A retry that does not detach MUST rebuild prompt-import triggers from its persisted resolved paths. Skill-catalog baseline content that the accepted-turn transaction froze before worker preparation can still list Workspace skills for that attempt. The skill-catalog notice of the next accepted turn MUST remove them.

At each accepted user turn, accepted-turn preparation MUST compare two states. The first is the current Machine and the current Workspace root or its absence. The second is the Machine and root last narrated to the Chat. The stored told state MUST count as absent when `workspace_told_from` names a checkpoint message other than the latest checkpoint row of the Chat. When those identities match, the stored told state is used. When the current state and the told state differ, the `workspace` producer MUST emit a rail-resident item with form `snapshot`:

- In a bound Chat, the snapshot MUST name the canonical root and its Machine. It MUST state that tools resolve bare and relative paths and `file:` locators there. It MUST state that the Workspace does not confine the authority of that Machine user.
- In an unbound Chat, the snapshot MUST state that no Workspace is entered. It MUST name the current Machine and state that tools resolve bare and relative paths and `file:` locators on it.

The snapshot MUST NOT name the worker that runs the Run.

A detach reason that attempt preparation persisted MUST come from the persisted state of the Chat, not from the current unbound state. The producer MUST emit it as a separate rail-resident item with form `notice` in the same turn. The notice MUST name that reason. The transaction that persists the narrating notice MUST clear the persisted reason, whatever the outcome of the Run.

The producer MUST compute the narrated Machine and root, and the latest checkpoint message, as the told state and `workspace_told_from`. The transaction that dispatches the first model request of an attempt MUST write both, whatever the outcome of the Run. The only other writer MUST be the publication transaction of a checkpoint. It advances `workspace_told_from` to its own row and resets the told state, so a narration that the checkpoint replaced does not suppress the next one. The `workspace` producer derives its snapshot again after that transaction commits and before the model step that the checkpoint precedes.

The state thus takes effect for that request and not on a later turn. That snapshot persists as any other does. The transaction that dispatches the request after the checkpoint stores it. That transaction records the narrated state and the identity of the checkpoint, whatever the outcome of the Run. The next turn thus finds the state already told within the epoch. The system prompt MUST NOT contain Workspace state or the current Machine.

#### Scenario: Changed binding is narrated on the rail

- **WHEN** an accepted turn observes a current Machine or a Workspace binding different from the last state narrated to the Chat
- **THEN** a rail-resident `workspace` snapshot names the canonical root and its Machine when the turn has a bound root
- **AND** with no bound root, the snapshot states that no Workspace is entered and names the current Machine
- **AND** if preparation detached the binding, a separate rail-resident `workspace` notice consumes the persisted detach reason
- **AND** the system prompt does not contain the Workspace state

#### Scenario: Unchanged binding is not repeated

- **WHEN** an accepted turn observes the same current Machine and Workspace state already narrated in the active context epoch
- **THEN** the producer emits no duplicate state-change snapshot
- **AND** the narrated state stays the comparison state

#### Scenario: A failed Run's Workspace snapshot is not repeated

- **WHEN** the dispatched request of a Run carried a `workspace` snapshot for root R on Machine `devl` and the Run then failed
- **THEN** the snapshot stays on the triggering user message, and that dispatch transaction recorded `devl` and R as the told state against the latest checkpoint
- **AND** the next accepted turn, with the binding still R in the same epoch, emits no `workspace` snapshot

#### Scenario: A detaching retry after a dispatched attempt narrates the detach once

- **WHEN** an earlier attempt of a Run stored a `workspace` snapshot for root R and an `instructions` item, dispatched, and failed
- **AND** the preparation of the retry detaches the binding
- **THEN** the retry keeps both stored items unchanged and in place
- **AND** it stores its detach notice and the snapshot of the unbound state after them in its own dispatch transaction
- **AND** that transaction records the unbound state as told and clears the detach reason, so the next turn emits neither item again

#### Scenario: Compaction re-establishes Workspace state

- **WHEN** a checkpoint becomes active for a Chat and its stored `workspace_told_from` names an earlier checkpoint message or is null
- **THEN** the first request after the checkpoint counts the told state as absent
- **AND** that request carries a snapshot of the current Machine and Workspace state
- **AND** the snapshot stays rail-resident and does not change the system prompt
- **AND** the transaction that dispatches that request records that state against the identity of the checkpoint, whatever the outcome of the Run
- **AND** the next turn emits no second snapshot for the same state

#### Scenario: A never-bound Chat receives no Workspace notice

- **WHEN** a Chat that was never bound to a Workspace accepts its first turn, or its first turn after a compaction
- **THEN** no `workspace` notice is emitted
- **AND** one `workspace` snapshot states that no Workspace is entered and names the current Machine

#### Scenario: Detach reason clears with its persisted narration

- **WHEN** attempt preparation persists a detach reason, and the attempt whose request carries the narrating notice fails afterward
- **THEN** the notice stays on the user message, and the transaction that stored it cleared the reason
- **AND** the next turn emits no second notice, and the Chat stays unbound

#### Scenario: Detach reason waits for a completed narration

- **WHEN** attempt preparation persists a detach reason, and that attempt fails before the request that carries the narrating notice dispatches
- **THEN** a retry consumes the reason from the persisted state of the Chat and emits it as a separate `workspace` notice
- **AND** the reason stays persisted until a dispatch transaction stores the narrating notice, and the Chat stays unbound

#### Scenario: Run context record includes the Workspace notice

- **WHEN** a Run sends a Workspace snapshot or detach notice in a model request
- **THEN** the triggering user message holds each exact text as a context-item part with producer `workspace` and its form
- **AND** the part stays subject to the ordinary owner-isolation rules

#### Scenario: Detach is ordered before Workspace contributions

- **WHEN** attempt preparation detaches a binding before the accepted turn resolves Workspace sources or tools
- **THEN** the turn contributes no Workspace skill activation, no `skill://` resolution, and no MCP tools
- **AND** skill-catalog baseline content that acceptance froze can still list Workspace skills, and the skill-catalog notice of the next accepted turn removes them
- **AND** it always emits the separate detach `notice` and the snapshot of the unbound state

#### Scenario: Detaching attempt without a persisted item leaves markers as prose

- **WHEN** attempt preparation detaches a Workspace binding before prompt imports run, and the user text contains an import marker
- **AND** no `prompt-imports` item from an earlier attempt of the Run is persisted
- **THEN** no prompt import is produced for that attempt and no prompt-import instruction trigger is staged
- **AND** the marker stays prose for that attempt

#### Scenario: A persisted prompt-imports item replays on a detaching retry

- **WHEN** an earlier attempt persisted a `prompt-imports` item and a retry detaches before prompt imports run
- **THEN** the item stays on the user message and replays unchanged as stored text, without a new read or a removal
- **AND** no new prompt imports occur and no prompt-import instruction triggers are staged

#### Scenario: A persisted instructions item replays on a detaching retry

- **WHEN** an earlier attempt persisted an accepted-turn `instructions` item and a retry detaches before the accepted-turn `instructions` load
- **THEN** the item stays on the user message and replays unchanged as stored text, without a new read or a removal
- **AND** the retry loads no new accepted-turn `instructions` item

#### Scenario: A changed default Machine is narrated in an unbound Chat

- **WHEN** an unbound Chat was told the current Machine `devl`, and the operator changes `machines.default` to `gpu` before the next accepted turn
- **THEN** that turn carries a `workspace` snapshot that states that no Workspace is entered and names `gpu`

#### Scenario: The snapshot does not name the worker

- **WHEN** the current Machine is `devl` and the worker that runs the attempt hosts `gpu`
- **THEN** the `workspace` snapshot names `devl` and does not name `gpu`

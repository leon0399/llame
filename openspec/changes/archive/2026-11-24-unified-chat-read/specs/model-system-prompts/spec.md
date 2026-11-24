## REMOVED Requirements

### Requirement: Each model resolves one complete effective system prompt

**Reason**: The old requirement includes the retired chats namespace, digest template iteration, and its obsolete boot-probe dimension.

**Migration**: Remove chats expressions from operator templates. Preserve the remaining strict language through the current projection requirements below.

## MODIFIED Requirements

### Requirement: Compaction publishes a summary-only checkpoint before the Run's first model step

The worker MUST evaluate automatic compaction once before the first model step, against that attempt's prepared request. It MUST select exactly one variant. A request beyond the model window or reserved output budget MUST select the window variant, even above the threshold. Otherwise, measured context at or above the model threshold MUST select the threshold variant. The worker MUST NOT apply both variants.

Media overflow MUST also satisfy the threshold when two conditions hold. First, the request omits an image or PDF because the epoch media bounds are full. Second, a prior row contains a stored or retained reference of a kind the model accepts. The prior row MUST precede the triggering user message. A result without `media` or `retainedMedia` MUST NOT qualify. A non-fitting request MUST still select the window variant.

When media overflow alone triggers compaction, a failed summary MUST leave the attempt usable without a checkpoint. Overflowing references MUST retain their limit placeholders. The next Run MUST evaluate the trigger again. A successful checkpoint MUST start a new media epoch.

Measured context MUST use the previous completed reply's persisted final-request size plus estimated later rows and rail items. That reply MUST answer a user turn above the active checkpoint's absorbed boundary. Otherwise, estimate the complete request. Compare the answered user turn, not the assistant sequence. An in-place retry can retain an assistant sequence below a newer checkpoint. Failed, cancelled, or expired Runs MUST supply no measured context to a later trigger.

Without a user or assistant row between the active absorbed boundary and the triggering message, compaction MUST publish no checkpoint. A threshold request MUST proceed on its existing checkpoint. A window request MUST fail `context_incompatible`.

The threshold variant MUST use the current attempt's model client, pre-refresh system prompt, in-memory schema-only tool declarations, and resolved effort. The window variant MUST use the previous completed Run's model, system-prompt receipt, and effort without tool declarations. If that model cannot execute or fit the prefix, fail `context_incompatible`. Both variants MUST send the compactable prefix and one trailing synthetic user instruction. The prefix MUST already include its previous checkpoint as user text. Set `toolChoice: "none"`, expose no executor, and accept text only.

The instruction MUST request these sections in order:

1. `Latest Request`
2. `Objective`
3. `Constraints and Preferences`
4. `Decisions and Rationale`
5. `Established Facts`
6. `Errors and Corrections`
7. `Completed`
8. `Active`
9. `Blocked`
10. `Open Questions and Next Steps`
11. `Critical References`

`Latest Request` MUST quote the owner's last unresolved ask within the compactable prefix verbatim. The triggering message MUST follow the checkpoint as stored text, not a quote inside the summary. A prior checkpoint MUST fold into the new summary. Move completed active work to `Completed`. Replace answered questions rather than repeat them.

The instruction MUST treat history and checkpoints as data, without an answer or continuation. The conversation MUST outrank an earlier checkpoint. A reverse signal MUST remove a task. Credentials, tokens, and connection strings MUST become `[REDACTED]`, with a note of their prior presence. Redaction MUST outrank verbatim quotation.

The summary MUST use the conversation language. It MUST retain code, paths, identifiers, and errors without translation. It MUST omit absent facts without invention. It MUST NOT shorten or reconstruct identifiers.

The instruction MUST exclude personalization and every recency-digest snapshot, notice, and carry text. It MUST name the personalization delimiter and the shared envelope with producer `recency-digest`. Historical prompt digest blocks MUST retain their delimiter exclusion. The model, not a structural redactor, enforces semantic exclusion. No digest source text can become authoritative checkpoint state.

Digest exclusion from summary prose MUST remain instruction-enforced, not a structural guarantee. Publication MUST NOT claim to detect every paraphrase or reject nonempty output solely on that promise. Comparison state MUST derive from persisted digest items, never summary prose.

The summarization request MUST retain the bound prompt and prefix unchanged. Only its trailing instruction MUST carry exclusions. Title generation MUST retain its dedicated task prompt, not the Chat system prompt.

Publication MUST atomically store a nonempty raw summary and exactly one checkpoint message. That message MUST carry its final literal envelope, raw summary, usage, and absorbed-through sequence. It MUST contain no tool record, retained tail, or forward pointer. No replacement-history store can exist. The raw summary MUST remain separate from its envelope text.

Request assembly MUST select the latest checkpoint with an absorbed boundary below the triggering user message. It MUST replay that checkpoint as one user-role text message. Its associated digest companion MUST follow immediately, outside the checkpoint row. Then replay retained user and assistant rows above the absorbed boundary. This pair-placement rule MUST precede ordinary sequence order. A pre-step checkpoint can have a sequence above the message it precedes.

Replay MUST use stored checkpoint text without a new envelope or metadata-derived reconstruction. It MUST NOT parse the raw summary out of the envelope. A later compaction MUST consume the previous checkpoint plus newly absorbed rows and create a new checkpoint. Missing or invalid stored checkpoint text MUST fail preparation closed. No legacy renderer or compatibility fallback can exist.

The checkpoint, separate digest companion, and refreshed epoch state MUST commit in one fenced transaction before the next model step. Other epoch state MUST retain its temporal, skill-catalog, Workspace, and checkpoint-marker lifecycles. The attempt MUST resolve its subsequent prompt, items, and system-only receipt after that commit. Every refreshed value MUST affect that request. A later failure MUST preserve the published checkpoint and companion. Retry MUST reuse them without another summary call.

Publication MUST be idempotent across worker attempts. Stale work MUST NOT alter prepared live context. A digest companion MUST contain only its context item and MUST start no Run. Idle and step-boundary compaction MUST obey the same companion placement and persistence rule.

Estimate the actual request without a historical tool catalog. If the request still does not fit after this compaction, fail `context_incompatible`. Committed failed-attempt output MUST enter compaction like other committed history. Preserve the history boundary of context-injection. The stored checkpoint envelope MUST state that work can already affect session state. It MUST direct the assistant not to repeat that work.

#### Scenario: A pre-step trigger compacts before the first model request

- **WHEN** a prepared Run request reaches its threshold or exceeds its model window
- **AND** a user or assistant row sits between the active absorbed boundary and the triggering message
- **THEN** the selected variant summarizes before the first model step
- **AND** its checkpoint, raw summary, and required companion commit atomically before that step

#### Scenario: A request over both the window and the threshold takes the window variant

- **WHEN** a prepared request exceeds the Run model's threshold and also does not
  fit that model's context window or reserved output budget
- **THEN** only the window variant runs, with the previous completed Run's model,
  its system-prompt receipt and effort, and no tool declarations
- **AND** the threshold variant is not applied to the same request

#### Scenario: A retry with a large triggering message does not compact again

- **WHEN** an attempt evaluates the trigger with no user or assistant row
  between the active checkpoint's absorbed-through sequence and the triggering
  user message's sequence
- **THEN** no checkpoint is published for the absent absorb set
- **AND** a threshold-condition attempt proceeds on the published checkpoint
- **AND** a window-condition attempt fails `context_incompatible` instead of
  summarizing nothing

#### Scenario: Compaction excludes standing and digest rail context

- **WHEN** the summarized prefix contains personalization, a prefix digest, or
  digest rail appends
- **THEN** the trailing instruction names the applicable delimiters and producer
  and forbids carrying them into the summary
- **AND** the replayed system prompt and compactable history remain unchanged

#### Scenario: Compaction runs for an owner with personalization

- **WHEN** a bound prompt contains rendered personalization
- **THEN** the trailing instruction excludes that block from the summary
- **AND** the next Run supplies current personalization independently

#### Scenario: Compaction runs for a chat carrying a digest

- **WHEN** a bound prompt contains a rendered recency digest
- **THEN** the trailing instruction excludes that block from the summary
- **AND** the checkpoint message need not contain other-chat content

#### Scenario: Compaction leaves the cached prefix untouched

- **WHEN** a pre-step summarization request is assembled
- **THEN** the bound prompt and compactable history remain unchanged
- **AND** exclusions appear only in the trailing user instruction

#### Scenario: Both delimited blocks are excluded under either compaction mode

- **WHEN** personalization and recency digest both occur in the summarized
  prefix
- **THEN** the instruction excludes both standing-context blocks
- **AND** the bound system text and the compactable prefix remain unchanged

#### Scenario: Exclusion targets one producer under a shared envelope

- **WHEN** the instruction excludes recency-digest rail appends
- **THEN** it names the shared envelope and the `recency-digest` producer
- **AND** it does not infer producer identity from a private delimiter

#### Scenario: The instruction carries the data, supersession, secret, and language rules

- **WHEN** the summarization instruction renders
- **THEN** it specifies data-only history, conversation precedence, cancelled-task removal, and credential redaction
- **AND** it preserves language, code, paths, identifiers, and errors without invented facts

#### Scenario: Folding a prior checkpoint keeps the latest ask verbatim

- **WHEN** the summarized prefix already contains a checkpoint message
- **THEN** the summary places the owner's last unresolved ask verbatim under
  `Latest Request`
- **AND** it moves `Active` items to `Completed` and replaces an answered
  question instead of repeating it

#### Scenario: Provider returns a tool call during compaction

- **WHEN** a provider returns a tool call despite `toolChoice: "none"`
- **THEN** no executor is available or invoked
- **AND** the result is rejected rather than persisted as a checkpoint message

#### Scenario: The envelope marks absorbed work as already done

- **WHEN** a checkpoint message is published
- **THEN** its stored envelope states that the session state can already reflect
  the work the checkpoint describes
- **AND** it directs the assistant not to repeat that work

#### Scenario: Checkpoint renderer changes later

- **WHEN** a later release changes checkpoint framing or sanitization
- **THEN** an existing checkpoint replays its stored text unchanged
- **AND** the raw summary remains available separately

#### Scenario: The checkpoint does not absorb the triggering user message

- **WHEN** the triggering user message was persisted before the worker ran and a
  pre-step checkpoint publishes after it
- **THEN** the checkpoint's absorbed-through sequence is below its own sequence
  and below the triggering user message
- **AND** replay emits the checkpoint first and then every user and assistant row
  above that sequence

#### Scenario: Next turn follows a compaction

- **WHEN** a Run prepares after a checkpoint publication
- **THEN** assembly emits its current prompt and tools, checkpoint, associated digest companion, and retained rows
- **AND** replay uses stored checkpoint text without reconstruction

#### Scenario: Model changes after compaction

- **WHEN** a model switch follows a stored checkpoint
- **THEN** the target receives its current top-level prompt and tools
- **AND** the checkpoint replays as portable historical data before the new
  persisted switch reminder

#### Scenario: A checkpoint without stored text fails preparation closed

- **WHEN** request assembly encounters a checkpoint message without valid
  non-empty stored checkpoint text
- **THEN** preparation fails closed
- **AND** it does not render a checkpoint from the raw summary

#### Scenario: A window trigger precedes a smaller-context target

- **WHEN** a model switch requires compaction because the prepared request does
  not fit the target's window
- **THEN** the previous completed Run's model uses its last successful
  system-prompt receipt and its own effort to summarize only eligible committed
  history without tool declarations
- **AND** the target request uses the resulting checkpoint message before the
  triggering user message

#### Scenario: A target attempt fails after a pre-step checkpoint

- **WHEN** a checkpoint published before a model step and that attempt later
  fails
- **THEN** the checkpoint and the re-baked epoch state remain active
- **AND** a retry reuses them instead of paying a second summary call

#### Scenario: The receipt records the prompt sent after the re-bake

- **WHEN** a pre-step checkpoint and its re-baked epoch state commit inside an
  attempt
- **THEN** that attempt resolves its own system prompt, its rail items,
  and its system-prompt receipt only after that commit
- **AND** the receipt records the prompt actually sent, and every re-baked value
  takes effect for the request the checkpoint precedes

#### Scenario: A duplicate checkpoint publication is a no-op

- **WHEN** a worker-attempt cutover or a superseded attempt publishes a
  checkpoint
- **THEN** a second publication for the same chat and absorbed-through sequence is
  a no-op and the attempt reads the surviving checkpoint
- **AND** stale work does not alter a prepared live attempt's context

#### Scenario: Partial rewind is requested

- **WHEN** future functionality needs to summarize only a prefix or suffix
  around a retained historical boundary
- **THEN** it does not reuse this compaction
- **AND** it requires a separately specified summary contract

#### Scenario: Image overflow selects the threshold variant

- **WHEN** a fitting image-capable request exceeds epoch image bounds and a prior row holds an accepted image reference
- **THEN** the attempt selects the threshold variant before its first model step
- **AND** the new epoch admits images oldest first

#### Scenario: Image overflow in the triggering message alone does not compact

- **WHEN** only the triggering user message's own images exceed the epoch's
  bounds and no row before it carries a stored image or PDF reference
- **THEN** no checkpoint is published
- **AND** the overflowing images keep the limit placeholder and the attempt
  proceeds

#### Scenario: A stored PDF does not enable image overflow without PDF input

- **WHEN** a prepared request on a model that declares `image` but not `pdf`
  input carries only a stored PDF in the rows before the triggering user
  message, and that message's own images exceed the epoch's bounds
- **THEN** no checkpoint is published
- **AND** the overflowing images keep the limit placeholder and the attempt
  proceeds

#### Scenario: Image overflow alone never fails an attempt

- **WHEN** image overflow is the only trigger condition and its summarization
  call throws or returns no usable summary
- **THEN** the attempt proceeds without a checkpoint instead of failing
  `context_incompatible`
- **AND** the overflowing images keep the limit placeholder
- **AND** the next Run evaluates the trigger again before its first model step
  and, when its compaction succeeds, admits images oldest first under the new
  epoch

#### Scenario: PDF overflow selects the threshold variant

- **WHEN** a fitting PDF-capable request exceeds epoch PDF bounds and a prior row holds an accepted PDF reference
- **THEN** the attempt selects the threshold variant before its first model step
- **AND** the new epoch admits PDFs oldest first

#### Scenario: Compaction keeps the digest outside its summary row

- **WHEN** a checkpoint publishes with effective digest state
- **THEN** a separate atomic companion carries that state immediately after the checkpoint
- **AND** the checkpoint row contains only its summary part

### Requirement: Summarization instructions and the title prompts are packaged templates

Each owning module MUST package its summary instruction and title prompts as template files. They MUST use the producer-owned-values engine of context-injection. No operator key can select, replace, or disable them. They MUST remain outside system-prompt receipts.

Title prompts MUST retain their prior inline bytes. The summary template MUST contain the required sections and context exclusions. It MUST name the personalization delimiter and the shared envelope with producer `recency-digest`. Historical prompt digest blocks MUST retain their delimiter exclusion. Independently authored literal expectations MUST verify those contracts. The check MUST NOT compare a template with itself or derive both sides from one shared constant.

#### Scenario: Compaction request is unchanged by the template migration

- **WHEN** a checkpoint is created after the two summarization instructions
  merge
- **THEN** its trailing instruction is rendered from the single packaged
  summarization template
- **AND** the bound prompt, compactable prefix, and schema-only tool declarations
  of that request are unchanged

#### Scenario: Instruction template omits a stable section or the digest exclusion

- **WHEN** a packaged instruction template no longer contains one of the required
  section headings or no longer names the `recency-digest` producer under the
  shared envelope
- **THEN** the compaction contract check fails against its independently authored literal text
- **AND** a self-comparison cannot hide the omission

#### Scenario: Title generation keeps its dedicated prompts

- **WHEN** the system generates a Chat title
- **THEN** it uses its packaged title system and user prompts with unchanged prior bytes
- **AND** it uses no Chat system prompt or personalization

#### Scenario: No configuration replaces an instruction template

- **WHEN** an operator configuration attempts to name a replacement for a summarization instruction or a title prompt
- **THEN** startup rejects the unknown key under the closed schema
- **AND** the packaged template remains in use

## ADDED Requirements

### Requirement: Each model resolves a complete prompt without digest variables

Each model MUST use one complete effective system prompt. A model override MUST replace the project default, not inherit or compose it. Missing overrides MUST select the project default. System and tool-description templates MUST use the same validated Handlebars projection. That projection MUST exclude `chats` and `chats.*`, under instance-config. Receipts MUST contain rendered system text only.

#### Scenario: Model has no prompt override

- **WHEN** the selected model omits `systemPromptFile`
- **THEN** the project default supplies its complete prompt and receipt source

#### Scenario: Two models use materially different prompts

- **WHEN** two model entries select different valid files
- **THEN** each uses its complete file without inheritance or composition

#### Scenario: Configured override is broken

- **WHEN** a selected override cannot resolve to valid nonempty text
- **THEN** startup fails without fallback

#### Scenario: Retired digest paths fail startup

- **WHEN** a template references a digest path or `chats` gate
- **THEN** startup rejects it without source Chat resolution

### Requirement: The current prompt projection remains explicit

The projection MUST admit only `model.id`, optional `model.name`, declared owner paths, temporal scalars, skill fields, web-search fields, and conditional tool predicates. Preserve `webSearch` and `webSearch.engines` under tool-prompt-templates. An absent model name MUST render empty.

Both temporal scalars MUST remain unconditional. A bare `context` gate MUST fail startup. Model paths MUST resolve at boot. Owner and Chat values MUST resolve per attempt.

#### Scenario: Default prompt renders model id and name

- **WHEN** the selected model has an id and configured name
- **THEN** its receipt contains those rendered values

#### Scenario: Prompt references an absent model name

- **WHEN** the model omits its optional name
- **THEN** startup succeeds, its value is absent, and its conditional is false

#### Scenario: Prompt renders the temporal anchor

- **WHEN** a prompt references both temporal scalars
- **THEN** it renders the absolute timestamp, numeric UTC offset, and IANA timezone

#### Scenario: Temporal namespace is guarded as though it were optional

- **WHEN** a prompt checks the bare `context` namespace
- **THEN** startup rejects that construct without prompt contents

#### Scenario: Prompt references no temporal path

- **WHEN** a prompt omits both temporal scalars
- **THEN** the omitted anchor contributes no bytes

#### Scenario: Per-user paths survive boot unresolved

- **WHEN** a template references allowlisted owner paths
- **THEN** boot validates them without an owner lookup
- **AND** each attempt resolves the current values

### Requirement: Template syntax stays closed and single-pass

Validation MUST admit literal content, allowed values, comments, and `if`, `unless`, and `each` blocks only. It MUST reject partials, decorators, unescaped output, unknown paths, and other helpers. Parsed path segments and depth MUST govern admission. Blocks MUST accept exactly one parameter without hash arguments or block parameters. Rendered values MUST NOT undergo another parse. Literal engine escapes and whitespace-control syntax can remain.

#### Scenario: Literal expression is emitted

- **WHEN** a template uses the engine literal escape
- **THEN** the expression stays literal without recursive evaluation

#### Scenario: Prompt uses a conditional

- **WHEN** an allowed value controls an `if` block
- **THEN** only the applicable branch renders

#### Scenario: Prompt contains a disallowed construct

- **WHEN** a template uses an unknown path, partial, unescaped value, or forbidden helper
- **THEN** startup rejects the model and construct without source contents

#### Scenario: Rendered output is not re-evaluated

- **WHEN** an owner value contains template syntax
- **THEN** that syntax remains literal text

### Requirement: Template iteration stays bounded to declared fields

`each` MUST accept only an allowlisted collection. It MUST reject scalars, gates, nested iteration, index/key variables, hash arguments, and block parameters. Item expressions MUST use declared fields only. Collections MUST NOT render as scalar values. `skills.entries` MUST expose only `name` and `description`, in code-point name order. `skills.omitted` MUST be a non-iterable integer that is false at zero.

#### Scenario: Prompt iterates an allowlisted collection

- **WHEN** an `each` block selects `skills.entries` and its declared fields
- **THEN** one body renders per entry

#### Scenario: Iteration references an undeclared item field

- **WHEN** an iteration uses an undeclared field
- **THEN** startup rejects it without Chat disclosure

#### Scenario: Iteration is attempted over a non-collection

- **WHEN** `each` targets a scalar, gate, or unknown path
- **THEN** startup fails before any Run

#### Scenario: Iteration uses a forbidden escape construct

- **WHEN** a template uses nested iteration, index/key variables, hashes, or block parameters
- **THEN** startup rejects each construct

#### Scenario: Prompt iterates the skill catalog

- **WHEN** a template emits skill names and descriptions
- **THEN** entries follow code-point name order and descriptions receive tag neutralization

#### Scenario: A prompt gates an overflow line on the omitted count

- **WHEN** a template checks `skills.omitted`
- **THEN** the line appears only for a nonzero count
- **AND** iteration over that scalar fails

#### Scenario: A collection is emitted as a value

- **WHEN** a template emits `skills.entries` as a scalar
- **THEN** startup fails rather than stringify its structure

### Requirement: Owner and skill gates remain independent and absent-safe

Absent or whitespace-only owner fields MUST be absent from the projection. Empty personalization MUST remove that gate. No owner content MUST remove `user`. No proactively admitted skill entry MUST remove `skills`.

Boot MUST probe independent `user`, `skills`, and `webSearch` gate combinations with a representative anchor. It MUST reject every empty result. Tool predicates MUST follow tool-prompt-templates without an exhaustive membership probe.

#### Scenario: An entire skills section is gated on an admitted entry

- **WHEN** a template checks `skills`
- **THEN** its section appears only with admitted entries

#### Scenario: Boot records whether a template references the catalog

- **WHEN** worker boot validates a model template
- **THEN** turn preparation receives its skills-reference flag

#### Scenario: Skills gate is independent of the other gates

- **WHEN** a template becomes empty for only one owner/skills combination
- **THEN** boot detects that combination and rejects it

#### Scenario: Prompt references no per-user path

- **WHEN** a prompt has no owner expression
- **THEN** startup succeeds without personalization bytes

#### Scenario: Owner value absent at render time

- **WHEN** an owner field has no nonempty value
- **THEN** it remains absent, renders empty, and tests false

#### Scenario: An entire section is gated on the owner having any per-user context

- **WHEN** the owner supplies no profile or shared identity
- **THEN** the `user` section and its prose disappear

#### Scenario: Template renders non-empty without an owner

- **WHEN** a template becomes empty for an unpersonalized owner
- **THEN** boot rejects that empty combination

#### Scenario: Template is empty only for one gate combination

- **WHEN** one independent owner/skills combination yields empty text
- **THEN** the boot cross product rejects it

#### Scenario: Every boot probe carries an anchor

- **WHEN** boot probes the independent gates
- **THEN** each probe supplies a representative temporal anchor

### Requirement: Prompt values keep their escaping and omission rules

Model values, account identity, and grammar-constrained skill names MUST escape exactly `&`, `<`, and `>`. Owner-authored values and skill descriptions MUST use instance-config tag neutralization. Projection MUST apply those rules without a global engine-escape change. Catalog omission MUST retain its frozen-baseline semantics. Digest disclosure MUST use its own rail lifecycle and cannot make `user` present.

#### Scenario: Digest presence does not make the personalization gate true

- **WHEN** the owner has digest context but no profile or shared identity
- **THEN** the `user` gate remains false

#### Scenario: A prompt does not require a digest gate

- **WHEN** the digest has no eligible Chats
- **THEN** the system prompt has no digest field or empty digest framing

### Requirement: Owner prompt paths remain a closed projection

The owner paths MUST remain exactly `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name`, and `user.email`. The temporal scalars MUST remain exactly `context.systemTime` and `context.systemTimezone`. Skill fields MUST remain the declared `skills.entries` item fields and `skills.omitted`. No prefix-path wildcard can expose other configuration or owner data.

#### Scenario: An undeclared owner field remains unavailable

- **WHEN** a configured template references another owner field
- **THEN** boot rejects the unknown path without an owner lookup

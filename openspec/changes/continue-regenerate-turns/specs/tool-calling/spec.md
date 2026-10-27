## MODIFIED Requirements

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

The read-only loop can retry a claimable Run from its first step with new worker context. It can
do this only when that Run has no recorded native attempt or MCP dispatch. A retry MUST resolve its own prompt
and its own attempt-local catalog again, and MUST NOT use the preparation of the failed attempt.
It MUST compare availability with the id and state record that its Run stored when an earlier
attempt dispatched. When no such record exists, it MUST compare with the record of the most
recent prior dispatched Run. The persisted output of the failed attempt stays part of the
committed record that later turns load. A follow-up Run from `turn-actions` can replace that
reply. A Run that executed an alpha native `edit` or `write`
MUST NOT replay that mutation automatically. This applies after a worker failure, a timeout, or an
unknown settlement. A Run that dispatched an MCP operation MUST NOT replay that operation
automatically.
The host MUST stop the affected Run with `outcome_unknown` and require a new explicit user or
model attempt. A client reconnect MUST replay recorded tool activity and MUST NOT execute the
mutation or the MCP operation again. A redelivered Run with a recorded `native.attempt` MUST fail
as `outcome_unknown` and MUST NOT replay its loop. This recovery rule has no native-executor or
`workerId` precondition. Before terminal settlement, the host MUST settle each open call that has
a matching durable `native.result` from that result, whatever the tool source. An open `bash`,
native mutation, or MCP call with a recorded `native.attempt` and no matching result MUST settle
as `outcome_unknown`. Every other open call settles as the termination settlement rules require.
Only a Continue that the owner requests through `turn-actions` can carry the settled tool-loop
state of a terminal Run into a new Run. That Continue Run MUST replay the settled results, and
MUST NOT execute a settled call again. A future durable effect-dedupe capability can replace
this terminal behavior; it is outside this change.

#### Scenario: Known native mutation result is replayed without execution

- **WHEN** a native edit or write settled before a client reconnect
- **THEN** replay returns the recorded tool result
- **AND** the filesystem mutation does not execute again

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps, and the deadman expires the Run
- **THEN** the Run ends under the current semantics
- **AND** no new Run resumes the partial tool-loop state unless the owner requests a Continue

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live Run after tool steps completed
- **THEN** replay rebuilds those steps from durable events and does not execute a native mutation again

#### Scenario: Worker failure does not replay a native mutation

- **WHEN** a worker fails after a native mutation or an MCP dispatch can have started, but before its result is known
- **THEN** the host settles the effect as `outcome_unknown`, and the Run stops
- **AND** a queue retry does not invoke that mutation or MCP operation again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** the queue retries the job of a read-only Run, the Run is still claimable, and no `native.attempt` is recorded
- **THEN** its tool loop executes from the first step again
- **AND** it can invoke again the read-only tools that the previous attempt invoked

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** the queue retries a job for a Run that is already terminal
- **THEN** the Run does not open again, no tool executes, and its terminal state stays

#### Scenario: Read-only retry remains unchanged

- **WHEN** a claimable Run holds only read-only tools, has no recorded `native.attempt`, and its job retries
- **THEN** the current read-only retry behavior stays available
- **AND** the host infers no native mutation from the read-only result

#### Scenario: A Continue carries settled tool results into a new Run

- **WHEN** a Run failed after a settled `edit` call and a settled `bash` call with `outcome_unknown`, and the owner continues it
- **THEN** the Continue Run gives the model both stored results
- **AND** it does not execute either call again

### Requirement: Tool observations survive into later turns as stored UI parts

The prospective cutover boundary in `context-injection` MUST govern the retention of failed
attempts. The system MUST NOT filter or rebuild the current conversation state retrospectively. A
failed, cancelled, expired, or superseded attempt keeps its partial output and context as the user
saw them. That record takes part in later model context and compaction like any other committed
turn, until a follow-up Run from `turn-actions` replaces the reply. A single failed tool call in a
committed successful attempt MUST still keep its normal paired failure observation.

The tool activity of a round MUST stay available to the model in later turns, in the bounded
replay contract below. The next turn MUST be able to show what a tool was asked and what it
returned or failed to return. The only exception is an older complete observation that the system
must omit to keep the hard budget.

Each replayed observation MUST carry the tool identity, the input while its payload fits, and the
structured outcome. Calls that were refused, cancelled, timed out, unavailable, execution-failed,
search-failed, or errored in another way MUST keep that outcome and MUST NOT disappear. Legacy
output-error parts with no structured outcome MUST map to the generic `error`, and the system MUST
NOT parse human prose for them. Structured cancellation metadata can recover `cancelled`.

Ordinary stored assistant parts MUST replay through the current conventional AI SDK tool-call and
tool-result projection. This stays until #599 sets the canonical persistence contract for UI
messages. Each
projected call MUST come with its matching result. A call with no real tool result also gets a
well-formed result. Credentials and unrelated payloads MUST NOT replay. The tool projection MUST
NOT carry provider-native reasoning or metadata. Persisted reasoning parts and their provider
metadata reach the provider only through the same-Chat replay of `reasoning-output`, outside this
projection and its budget.

The ordinary projection MUST stay:

- portable, through SDK tool-call and tool-result parts, not provider-specific structures;
- labelled untrusted inside the result content;
- neutralized, so remote-authored result content cannot forge a reserved structural boundary;
- bounded in JavaScript UTF-16 code units over the exact serialized text of the pair. The limits
  are 8,000 for each pair and 32,000 for each stored assistant turn. An image in a result counts only as its
  stored result text, with no `thumbnail`;
- reduced so that it keeps pairing before budget, newer observations before older ones, and
  identity and outcome before payload; and
- stable for the same unchanged stored turn under the current explicit best-effort projector.

The system MUST clear payloads, oldest first, only when this makes the envelope smaller. When pairs
that cannot shrink more still go above a limit, the system MUST drop the oldest complete pairs
atomically until the projection fits. It adds one bounded omission count and marker. The system
MUST never emit a call or a result with no match.

The system MUST store an image in a tool result in the tool part as the native image result that
made it. It MUST NOT store the `media-store` media descriptor, image bytes, or base64 model content.
Only the result of a `media://` read names its image by a `media://` locator in `media`. Each other
image result has no `media` field. The system stores it with the display-only `thumbnail` that
`media-attachments` defines, when one fits its cap. The system MUST remove `thumbnail` from the
model-facing output and from each replayed result. `thumbnail` MUST NOT count toward the UTF-16
budgets, and the system MUST never accept it from a client. On replay, the text of the result MUST
follow the projection above. The image MUST become provider image content, built at request time,
only when three conditions are true. The model of the request declares `image` input, its model
variant is available, and the epoch image window of `media-attachments` attaches that reference.
For a `media://` result, the model variant is available from the media store. For each other image
result, it is available only from the memory of the attempt that read it. That memory is keyed by
the tool call id, as `media-attachments` defines. In other cases, the replayed result MUST carry the image
placeholder of `media-attachments` in its text. The memory of the current attempt can have no entry
for an image result. That result MUST then replay as the not-retained placeholder for a model that
declares `image` input. For other models, it MUST replay as the omitted placeholder. This applies in a later
turn, a retry or resume (a new attempt on any worker), a compaction request, or a fork. A
`media://` reference that does not resolve to media of the Run owner MUST replay as the
unavailable placeholder. These placeholders MUST NOT fail the request. Image content MUST NOT
count toward the UTF-16 budgets. An image MUST replay only with its kept result payload. When the
system clears a payload or drops a pair, it also removes the image from the request.

Visible assistant text and kept tool occurrences MUST keep their current chronology. Ordinary
stored messages do not prove parallel or step boundaries. Thus consecutive calls MUST continue to
project conservatively as separate sequential matched pairs. This change MUST NOT generalize or
rewrite this behavior; #599 owns its research and refactor. The kept parts of a Continue Run from
`turn-actions` are not later-turn replay. That capability owns their projection, which groups each
kept step and applies no replay budget.

Tool activity MUST stay available to the model until a checkpoint absorbs it. A tool record MUST
NOT cross that boundary. A checkpoint message MUST carry no tool part. It MUST select and re-bound no
payload, and it MUST compute no budget again. There MUST be no semantic observation ledger, no
bounded replacement set, and no compacted tool record to read back. Absorbed tool activity stays
only as summary text. The `Errors and Corrections`, `Completed`, and `Critical References` content
of the summary carries it. Rows after the latest checkpoint MUST keep the ordinary bounded
projection above unchanged. Replay of those rows MUST NOT read the checkpoint.

Checkpoint text MUST stay owner-scoped like the checkpoint row that carries it. The system MUST NOT
rebuild a tool observation from summary prose or from the text of an older checkpoint. It MUST NOT
rebuild one from any inference about the contents of an absorbed turn.

The live tool loop MUST continue to observe its own results in the turn that produced them.

#### Scenario: A later turn can use an earlier tool result

- **WHEN** a tool returns a result and the user asks about it later
- **THEN** the later request carries its identity, its input when kept, its result, and its outcome through the conventional SDK form

#### Scenario: An unsuccessful call is projected as unsuccessful

- **WHEN** an earlier call was refused, cancelled, errored, or timed out
- **THEN** later replay carries a matched result that reports that outcome
- **AND** the system does not omit the call only because it failed

#### Scenario: A cancelled call is projected as cancelled

- **WHEN** an unsuccessful Run termination settled an earlier call
- **THEN** operational and UI replay report its matching `cancelled` result
- **AND** the persisted output of that failed attempt stays part of model history like any other committed turn
- **AND** it stays different from an error that a tool produced

#### Scenario: A tool call made during reasoning is projected

- **WHEN** the model called a tool while it produced reasoning output
- **THEN** the call and result observation follows the same replay contract
- **AND** the tool projection does not carry the reasoning part, which replays under `reasoning-output` at its own occurrence position

#### Scenario: Every replayed call has a matching replayed result

- **WHEN** a later request replays stored tool activity
- **THEN** each kept call has its result directly after it
- **AND** the system omits calls and results with no match atomically

#### Scenario: A call with no genuine result still carries a well-formed result

- **WHEN** a call was cancelled, refused, errored, or timed out before a real tool result existed
- **THEN** replay gives a well-formed result that carries that outcome
- **AND** it does not tell about the absence as unrelated assistant prose

#### Scenario: Provider reasoning and metadata are never replayed

- **WHEN** stored tool activity includes reasoning or provider metadata
- **THEN** portable observations stay available across model and provider switches
- **AND** the tool projection carries no reasoning or metadata of the original provider; `reasoning-output` governs reasoning replay

#### Scenario: A model or provider switch keeps observations but not provider metadata

- **WHEN** a Chat with tool activity continues on another model or provider
- **THEN** portable matched observations stay available through the target SDK conversion
- **AND** the tool projection excludes the metadata of the original provider
- **AND** replayed reasoning parts pass back unchanged, and `reasoning-output` omits before the request the ones that the target wire cannot carry
- **AND** the target provider ignores or drops the rest

#### Scenario: The projection is labelled untrusted

- **WHEN** the system replays a tool result
- **THEN** its own result content identifies it as untrusted tool output
- **AND** payload text that looks like an instruction has no authority

#### Scenario: Replayed content cannot escape its boundary

- **WHEN** a tool result tries to forge or close a reserved boundary
- **THEN** the replayed result is neutralized under the tool projection contract
- **AND** the structure around it stays intact

#### Scenario: The projection is stable across turns

- **WHEN** the same unchanged ordinary stored tool part replays two times
- **THEN** the current projector produces the same application content
- **AND** the system makes no tool part at a checkpoint boundary

#### Scenario: Interleaved text and tools retain chronology

- **WHEN** an assistant turn contains visible text, tool calls, and later text
- **THEN** the current projector keeps their occurrence order as separate text and sequential matched pairs
- **AND** the implementation refers to #599 and does not claim proven step boundaries

#### Scenario: Visible text does not consume the observation budget

- **WHEN** visible assistant text surrounds capped tool observations
- **THEN** visible text keeps its occurrence order outside the observation budget
- **AND** it does not cause the system to drop a pair that it otherwise keeps

#### Scenario: Hard limits preserve pairing and newest observations

- **WHEN** a serialized pair or turn goes above its hard limit
- **THEN** payloads clear only when this helps, then the system omits the oldest complete pairs until the result fits
- **AND** exactly one bounded omission marker stays, and the counts of calls and results stay equal

#### Scenario: Absorbed tool activity crosses a checkpoint only as summary text

- **WHEN** a checkpoint message absorbs a range of history that contains tool activity
- **THEN** that activity is available to later requests only as summary text
- **AND** the checkpoint message carries no tool record, and replay of the rows above it uses the ordinary bounded projection

#### Scenario: Recursive compaction consumes the prior checkpoint's stored text

- **WHEN** a later checkpoint supersedes an earlier checkpoint
- **THEN** its summary input is the stored text of the earlier checkpoint, then the rows that it newly absorbs
- **AND** it writes no list of tool records, and it carries no record forward

#### Scenario: A checkpoint without stored text cannot recover absorbed observations

- **WHEN** an active checkpoint message has no valid non-empty stored text
- **THEN** request preparation fails closed
- **AND** the system invents no tool observation from summary prose or from any ledger

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a Run
- **THEN** its result stays available in the tool loop of that same Run

#### Scenario: An image result is stored without image data

- **WHEN** a `read` of `/work/shot.png` returns an image result
- **THEN** the stored tool part carries that native image result, with `kind: "image"`, `mediaType`, `width`, `height`, and `path`, and no `media` field
- **AND** its stored output carries the display-only `thumbnail` and no other image data, and no `provenance`, `byteSize`, or `model` descriptor field

#### Scenario: A media read result is stored as a media reference

- **WHEN** a `read` of `media://<id>` returns an image result
- **THEN** the stored tool part carries that native image result with `media` `media://<id>`
- **AND** it carries no `thumbnail`, no image bytes, and no base64 data

#### Scenario: An attached image result replays as image content

- **WHEN** a later step of the Run that read `/work/shot.png`, on a model that declares `image` input, replays its image result
- **AND** the epoch image window attaches the reference
- **THEN** the replayed result carries its text and the image as provider image content built from the model variant in the memory of that attempt
- **AND** the call stays directly paired with its result

#### Scenario: A media read result replays from the store in a later turn

- **WHEN** a later turn on a model that declares `image` input replays a stored `media://<id>` image result, and the epoch image window attaches its reference
- **THEN** the replayed result carries its text and the image as provider image content built from the stored model variant

#### Scenario: An earlier turn's image read replays as not retained

- **WHEN** a later turn on a model that declares `image` input replays the stored image result of `read("/work/shot.png")` for a 1600×900 image
- **THEN** the text of the replayed result carries `[image "/work/shot.png" 1600×900, not retained]`
- **AND** the request carries no image content for that result

#### Scenario: An unattached image result replays as a placeholder

- **WHEN** a request replays an image result
- **AND** its reference is outside the bounds of the epoch image window, or the model of the request does not declare `image` input
- **THEN** the text of the replayed result carries the matching image placeholder with the locator of the image
- **AND** the request carries no image content for that result

#### Scenario: Image content does not consume the observation budget

- **WHEN** the model variant of a replayed image result would serialize as base64 longer than 8,000 UTF-16 code units
- **AND** the text of the pair fits in the budget
- **THEN** the system does not clear or drop the payload of the pair because of the image
- **AND** the budgets measure only the text of the pair, with no `thumbnail`

#### Scenario: A thumbnail never reaches the model

- **WHEN** an image result stored with a `thumbnail` reaches the model live in its Run, or replays in a later request
- **THEN** no part of any request carries the `thumbnail` or any part of its data URL

#### Scenario: A dropped pair carries no image

- **WHEN** the hard budget drops an older complete pair whose result carries an image
- **THEN** neither the pair nor its image content is in the request
- **AND** the single omission marker counts the omission

#### Scenario: A replayed image reference never resolves another owner's media

- **WHEN** a stored tool part replayed in the Run of user A references a media id that user B owns
- **THEN** the replayed result carries the unavailable placeholder, and the request continues
- **AND** no image bytes or descriptor fields of the object of user B reach the request

#### Scenario: A follow-up Run replaces the record of a failed attempt

- **WHEN** a failed reply holds a settled tool pair and an unfinished step, and the owner regenerates the turn
- **THEN** after the Regenerate Run dispatches, later turns do not replay that tool pair or that step

## ADDED Requirements

### Requirement: A stored tool part records the classification of a call that started

When a tool call starts, the `tool.started` event and the stored tool part MUST record
`classification` with the classification of the tool that executes it. A call that the
availability gate or the permission policy rejects does not start. Its stored part MUST record
`classification: null`, also after a rebuild from events. The chat history response MUST return
the field. A tool part with no `classification` field is a part from before this rule.

#### Scenario: A started bash call records its classification

- **WHEN** a `bash` call starts and settles
- **THEN** its stored tool part records `classification: "execute_code"`

#### Scenario: A rejected call records no classification

- **WHEN** the availability gate or the permission policy rejects a tool call before it starts
- **THEN** its stored tool part records `classification: null`

#### Scenario: A rebuilt reply keeps the classification

- **WHEN** a settler without the live collector rebuilds a reply that holds a started `edit` call and a rejected `bash` call
- **THEN** the rebuilt `edit` part records `classification: "write_low_risk"` and the rebuilt `bash` part records `classification: null`

#### Scenario: An MCP call records unverified

- **WHEN** an allowlisted MCP tool call starts
- **THEN** its stored tool part records `classification: "unverified"`

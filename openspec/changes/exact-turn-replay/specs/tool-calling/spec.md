## ADDED Requirements

### Requirement: Earlier tool activity takes part in later model context

The tool activity of a committed turn MUST stay in later model context until a
checkpoint absorbs it, through the projection of `turn-replay`. A failed call
MUST keep its outcome and MUST NOT disappear. The live tool loop MUST observe its
own results in the Run that made them.

#### Scenario: A later turn can use an earlier tool result

- **WHEN** a tool returns a result and the user asks about it later
- **THEN** the later request carries its identity, its input, its result, and its outcome through the conventional SDK form

#### Scenario: An unsuccessful call is projected as unsuccessful

- **WHEN** an earlier call was refused, cancelled, errored, or timed out
- **THEN** later replay carries a matched result that reports that outcome
- **AND** the system does not omit the call because it failed

#### Scenario: A model or provider switch keeps observations

- **WHEN** a Chat with tool activity continues on another model or provider
- **THEN** the earlier calls and results replay through the target SDK conversion
- **AND** the reasoning parts of the earlier turns follow the model rule of `reasoning-output`

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a Run
- **THEN** its result stays available in the tool loop of that same Run

### Requirement: A failed attempt stays in later context as the user saw it

The prospective cutover boundary in `context-injection` MUST govern the retention
of failed attempts. The system MUST NOT filter or rebuild the current
conversation state retrospectively. A failed, cancelled, expired, or superseded
attempt MUST stay in later context as the user saw it. A follow-up Run from
`turn-actions` can replace the reply. Its reasoning parts follow the model rule of
`reasoning-output`.

#### Scenario: A cancelled call is projected as cancelled

- **WHEN** an unsuccessful Run termination settled an earlier call
- **THEN** operational and UI replay report its matched `cancelled` result
- **AND** the persisted output of that failed attempt stays part of model history
- **AND** it stays different from an error that a tool produced

#### Scenario: A follow-up Run replaces the record of a failed attempt

- **WHEN** a failed reply holds a settled tool pair and an unfinished step, and the owner regenerates the turn
- **THEN** after the Regenerate Run dispatches, later turns do not replay that tool pair or that step

### Requirement: A stored failure replays with its stored outcome

A replayed failure MUST carry the structured outcome that its tool part stores,
except a call that the AI SDK refused, which `turn-replay` covers.
A legacy failed part with no structured outcome MUST replay as the generic
`error`. The system MUST NOT parse human prose to find an outcome. Structured
cancellation metadata can recover `cancelled`.

#### Scenario: A legacy failed part replays as a generic error

- **WHEN** a later turn replays a failed tool part that stores error text and no structured outcome
- **THEN** the replayed result carries the outcome `error`
- **AND** the system does not read the error text to choose another outcome

### Requirement: Every replayed call has its result

Each replayed call MUST have its matched result in the tool message of its step.
A call with no real result MUST replay a well-formed result that carries its
outcome. The system MUST NOT send a call or a result with no match. Credentials
and unrelated payloads MUST NOT replay.

#### Scenario: Every replayed call has a matching replayed result

- **WHEN** a later request replays stored tool activity
- **THEN** each call has its result in the tool message that follows the assistant message of its step
- **AND** the counts of calls and results are equal

#### Scenario: A call with no genuine result still carries a well-formed result

- **WHEN** a call was cancelled, refused, errored, or timed out before a real tool result existed
- **THEN** replay gives a well-formed result that carries that outcome
- **AND** it does not tell about the absence as unrelated assistant prose

### Requirement: Absorbed tool activity crosses a checkpoint only as summary text

A tool record MUST NOT cross a checkpoint. A checkpoint message MUST carry no tool
part. There MUST be no observation ledger, no replacement set, and no compacted
tool record to read back. Absorbed tool activity stays only as summary text: the
`Errors and Corrections`, `Completed`, and `Critical References` content of the
summary. Replay of the rows after a checkpoint MUST NOT read the checkpoint.

#### Scenario: Absorbed tool activity crosses a checkpoint only as summary text

- **WHEN** a checkpoint message absorbs a range of history that contains tool activity
- **THEN** that activity is available to later requests only as summary text
- **AND** the checkpoint message carries no tool record, and the rows after it replay through the projection of `turn-replay`

#### Scenario: Recursive compaction consumes the prior checkpoint's stored text

- **WHEN** a later checkpoint supersedes an earlier checkpoint
- **THEN** its summary input is the stored text of the earlier checkpoint, then the rows that it newly absorbs
- **AND** it writes no list of tool records, and it carries no record forward

### Requirement: No tool observation is rebuilt from a checkpoint

Checkpoint text MUST stay owner-scoped like the checkpoint row that carries it.
The system MUST NOT rebuild a tool observation from summary prose or from the text
of an older checkpoint. It MUST NOT rebuild one from an inference about the
contents of an absorbed turn.

#### Scenario: A checkpoint without stored text cannot recover absorbed observations

- **WHEN** an active checkpoint message has no valid non-empty stored text
- **THEN** request preparation fails closed
- **AND** the system invents no tool observation from summary prose or from a ledger

### Requirement: A stored part records its model step

A stored text, reasoning, or tool part MUST record, as `step`, the number of the
model step that produced it. In a Continue Run, the numbers MUST continue after
the highest step of the kept parts. When a kept tool part has no `step`, Continue
admission MUST copy it from the `tool.requested` event of that call. The system
MUST NOT add `step` to a part stored before this change.

#### Scenario: Two parallel calls record one step

- **WHEN** one model response in step 2 writes text and calls `read("a.md")` and `read("b.md")`
- **THEN** the stored text part and both stored tool parts record `step: 2`

#### Scenario: A Continue Run numbers its steps after the kept steps

- **WHEN** the kept parts of a Continue Run end with a call at `step: 1`, and the first step of the Continue Run calls `read("c.md")`
- **THEN** the stored tool part of that call records `step: 2`

#### Scenario: A Continue of an older Run keeps its steps

- **WHEN** the owner continues a Run whose tool parts were stored with no `step`
- **THEN** each kept tool part gets the step number of its `tool.requested` event
- **AND** the sequential steps of that Run stay separate in the Continue request

#### Scenario: An old part keeps no step

- **WHEN** a part stored before this change replays on a later turn
- **THEN** it has no `step`, and the system writes none to it

### Requirement: Tool results store images without image data

The system MUST store a tool result with an image in its tool part as the native
image result. The result MUST NOT carry a media descriptor, image bytes, or base64
content. Only a `media://` read names its image, by a `media://` locator in
`media`. Each other image result has no `media` field, and the tool part keeps its
retained bytes and display `thumbnail` as `media-attachments` defines.

#### Scenario: An image result is stored without image data

- **WHEN** a `read` of `/work/shot.png` returns an image result
- **THEN** the stored tool part carries that native image result, with `kind: "image"`, `mediaType`, `width`, `height`, and `path`, and no `media` field
- **AND** its stored output carries the display-only `thumbnail` and no other image data, and no `provenance`, `byteSize`, or `model` descriptor field
- **AND** the tool part keeps the retained model variant beside the result

#### Scenario: A media read result is stored as a media reference

- **WHEN** a `read` of `media://<id>` returns an image result
- **THEN** the stored tool part carries that native image result with `media` `media://<id>`
- **AND** it carries no `thumbnail`, no image bytes, and no base64 data

### Requirement: No thumbnail or retained byte reaches the model

The system MUST remove `thumbnail` and retained bytes from each model-facing
result, live and replayed. The system MUST NOT accept them from a client.

#### Scenario: A thumbnail never reaches the model

- **WHEN** an image result stored with a `thumbnail` reaches the model live in its Run, or replays in a later request
- **THEN** no part of any request carries the `thumbnail` or any part of its data URL

### Requirement: A replayed image result attaches under the epoch image window

A replayed image MUST become provider image content, built at request time, only
when three conditions are true. The model declares `image` input, the model
variant is available, and the epoch image window attaches the reference. A `media://` result takes its variant
from the media store, and each other result from its retained bytes. This applies
to a later step, a later turn, a Continue Run, and an owner fork. It also applies
to a compaction request and to a reply rebuilt from the event log.

#### Scenario: An attached image result replays as image content

- **WHEN** a later step of the Run that read `/work/shot.png`, on a model that declares `image` input, replays its image result
- **AND** the epoch image window attaches the reference
- **THEN** the replayed result carries its text and the image as provider image content built from the retained model variant in its stored tool part
- **AND** the call stays directly paired with its result

#### Scenario: A media read result replays from the store in a later turn

- **WHEN** a later turn on a model that declares `image` input replays a stored `media://<id>` image result, and the epoch image window attaches its reference
- **THEN** the replayed result carries its text and the image as provider image content built from the stored model variant

#### Scenario: An earlier turn's retained image read replays as image content

- **WHEN** a later turn on a model that declares `image` input replays the stored image result of `read("/work/shot.png")`, and the epoch image window attaches its reference
- **THEN** the replayed result carries its text and the image as provider image content built from the retained model variant
- **AND** the call stays directly paired with its result

### Requirement: A replayed image that cannot attach becomes a placeholder

A result with neither `media` nor `retainedMedia` MUST replay as its text only,
with no image and no placeholder. Each other result that cannot attach MUST carry
the image placeholder of `media-attachments` in its text. A `media://` reference
that is not media of the Run owner MUST replay as the unavailable placeholder.
These placeholders MUST NOT fail the request.

#### Scenario: An earlier turn's image read replays as not retained

- **WHEN** a later turn on a model with `image` input replays the stored result of `read("/work/shot.png")` for a 1600×900 image
- **AND** that tool part has no `retainedMedia`
- **THEN** the text of the replayed result carries the fields of the result and no placeholder
- **AND** the request carries no image content for that result

#### Scenario: An unattached image result replays as a placeholder

- **WHEN** a request replays an image result
- **AND** its reference is outside the bounds of the epoch image window, or the model of the request does not declare `image` input
- **THEN** the text of the replayed result carries the matching image placeholder with the locator of the image
- **AND** the request carries no image content for that result

#### Scenario: A replayed image reference never resolves another owner's media

- **WHEN** a stored tool part replayed in the Run of user A references a media id that user B owns
- **THEN** the replayed result carries the unavailable placeholder, and the request continues
- **AND** no image bytes or descriptor fields of the object of user B reach the request

## MODIFIED Requirements

### Requirement: Framing llame authors inside tool results is a packaged template

Each closed notice that llame places inside a tool result MUST be a packaged
template file. These notices are the prior-conversation notice of
`conversation-reads`, the search-excerpt notice of `chat-search`, the Knowledge
content notice of `knowledge-tools`, and the path instruction of `agent-skills`.
The module that writes the text owns the file, and the process that runs the tool
ships it. The template renders under the producer-owned-values rule that
`context-injection` defines for item bodies. These templates MUST NOT be operator
configuration, and no configuration key can select, replace, or disable one. The
rendered notice bytes MUST stay identical to the previous inline text. A tool
result MUST NOT have an untrusted-output frame around it, live or replayed. Its
payload MUST be the rendering and the neutralization that `tool-result-rendering`
defines.

Result content that a tool implementation, the permission layer, or result
truncation writes is not a notice of this requirement. That content includes
error messages, permission rejections, and settlement and truncation notices.

#### Scenario: Wrapped tool output is unchanged by the template migration

- **WHEN** a tool result goes to a model, live or replayed
- **THEN** no untrusted-output frame and no outcome line surround it
- **AND** its payload is the rendering that `tool-result-rendering` defines, neutralized once

#### Scenario: A result notice is unchanged by the template migration

- **WHEN** a conversation read, search, Knowledge read, or skill read returns its closed notice
- **THEN** the notice text is byte-identical to the previous inline constant
- **AND** the capability that owns the notice still obeys its content rules

#### Scenario: No configuration replaces a result notice

- **WHEN** an operator configuration names a replacement for a result notice
- **THEN** startup rejects the unknown key under the closed schema
- **AND** the packaged template stays in use

### Requirement: Code-owned Knowledge tools use the attempt-local read-only loop

The code-owned tool inventory MUST include `knowledge_search` and
`search_conversations`. Knowledge file access is the `kb://` locator of the
native file tools. `knowledge_search` MUST declare `read_only` and MUST require
its own exact entry in `tools.allowed`. It MUST follow the same contracts as each
other code-owned tool. These contracts are declaration admission, the
attempt-local tool catalog, trusted executor binding, timeout, abort, and
settlement. They also include persistence, replay, compaction, result
neutralization, truncation, and browser rendering. The runtime
catalog MUST describe operation eligibility and declarations, not a Knowledge
resource inventory. The system MUST NOT persist the catalog.

The operator allowlist controls only whether these fixed operations are eligible.
It MUST NOT choose an owner, a configured root, a child directory, a path root, or
an execution location. A permitted Knowledge tool can accept a stable Knowledge
Space selector as its code-owned schema defines. The current authority for that
selector MUST come from the trusted Run owner at execution time. Model input MUST
NOT supply or expand ownership or local filesystem authority.

For each new execution attempt, the candidate resolver of the worker MUST find
Knowledge tool availability from four inputs. These are the source declaration,
the safety classification, the exact allowlist entry, and the configured
Knowledge root. It MUST NOT query
or snapshot the Knowledge Space inventory of the owner. With a configured root, an
owner with no current resources MUST still receive the callable tool
declarations, and a call MUST return `knowledge_space_not_configured`. Without a
configured root, each Knowledge tool that is otherwise eligible MUST keep the
closed `knowledge_space_unavailable` manifest state. The API acceptance path MUST
NOT resolve the catalog or probe the filesystem.

Worker execution MUST receive the private filesystem resolver through trusted
dependency injection or tool context. It MUST receive the current owner identity
through trusted Run context. It MUST resolve the current resources of the owner
under RLS for each call. It MUST NOT serialize local binding data into
declarations or accept it from model input.

Knowledge results and `grep` results MUST keep the global execution envelope
`status: "success" | "error"`. The system MUST NOT add a generic `partial`
status. A successful `knowledge_search` or `grep` can also declare
`complete: false` with bounded warnings. A later turn MUST replay that result as
the live loop sent it, with `complete: false` in its payload, under
`turn-replay`. No replay can clear that payload or show the call as complete.
This requirement does not define partial-result semantics for other tools.

New Knowledge results MUST persist and render the passage and range attribution
that `knowledge-tools` defines, with no content hash. A historical persisted
Knowledge result can keep its earlier shape with a hash. Execution, persistence,
replay, compaction, and browser rendering MUST keep each observation as written.
They MUST NOT change a historical result into the new shape or add a removed
field. A persisted call without the new optional range or cursor arguments MUST
stay a valid observation.

A change to execution semantics or to the meaning of stored Knowledge locators
MUST stay a coordinated API, worker, and data boundary. An edit to a description
template applies at restart. It adds no historical declaration-hash requirement
for a scheduled Run. Before a deployment replaces binaries for the passage-search
declaration, it MUST stop new Run acceptance. It MUST drain each accepted Run
that the prior declaration binds. It MUST deploy matching API and worker binaries
before it accepts Runs again. A rollback MUST stop acceptance and drain the Runs
that the newer declaration binds before it restores older API or worker
binaries. This requirement adds no executor fallback across revisions and no
declaration normalization.

The closed Knowledge reason vocabulary and its model-safe label map MUST keep
`knowledge_space_not_configured` and `knowledge_space_unavailable`. Zero
inventory does not change tool availability. Thus
`knowledge_space_not_configured` MUST appear only as a tool-call result, not as a
runtime availability state. When the process has no Knowledge configuration, the
system MUST use the safe `knowledge_space_unavailable` label. A recovery notice
MUST name the restored tool and MUST NOT state a prior cause. The previous
committed record stores only the id and the state.

#### Scenario: Knowledge tool is not allowlisted

- **WHEN** a Knowledge tool is registered but its exact id is not in `tools.allowed`
- **THEN** a new execution attempt does not advertise or execute it

#### Scenario: Allowlisted Knowledge tool is admitted at runtime

- **WHEN** an exact Knowledge tool id is allowlisted for a new execution attempt with a configured Knowledge root
- **THEN** the in-memory tool catalog of that Run includes its exact declaration, whatever the current owner inventory is
- **AND** execution requires the matching code-owned read-only executor

#### Scenario: Eligible Knowledge tool starts unavailable

- **WHEN** a Knowledge tool is allowlisted but the worker of the attempt has no configured Knowledge root
- **THEN** the runtime availability of the attempt records `knowledge_space_unavailable`
- **AND** the Run does not advertise the tool as callable

#### Scenario: Knowledge availability recovery does not infer a prior cause

- **WHEN** an attempt admits a Knowledge tool that the most recent prior dispatched Run in the disclosure epoch recorded as unavailable
- **THEN** its `Now available` transition names that exact tool and states no stored failure reason
- **AND** no root, host path, or free reason text appears

#### Scenario: Knowledge observation persists through reload and replay

- **WHEN** an allowlisted Knowledge tool completes with passage and range attribution and no content hash
- **THEN** its call and structured result persist and render after a browser reload
- **AND** later model replay carries the complete matched pair as the live loop sent it

#### Scenario: Historical Knowledge observation is not rewritten

- **WHEN** a persisted Knowledge observation uses the earlier result shape with a hash
- **THEN** reload and replay keep the observation as written
- **AND** no migration or projection adds new range fields or removes its historical fields

#### Scenario: Knowledge declaration cutover drains prior Runs

- **WHEN** a deployment changes the code-owned `knowledge_search` declaration
- **THEN** it stops new Run acceptance and drains the Runs that the prior declaration binds before it replaces API or worker binaries
- **AND** acceptance starts again only after each process that executes Runs exposes the matching declaration and executor

#### Scenario: Tool permission cannot alter filesystem authority

- **WHEN** an operator allowlists `knowledge_search`
- **THEN** the permission makes only that fixed operation eligible
- **AND** a supplied space selector still resolves only through the current trusted owner authority

#### Scenario: Zero inventory remains model-visible

- **WHEN** a Run owner has no current Knowledge Spaces but `knowledge_search` is otherwise eligible
- **THEN** the tool is advertised as callable
- **AND** a call returns the closed `knowledge_space_not_configured` result

#### Scenario: Removed reader is not recreated from history

- **WHEN** historical tool activity names the removed `knowledge_read` id
- **THEN** a new attempt does not rebuild or execute it from that history
- **AND** the system applies no shim, alias, or redirect to `read`

#### Scenario: Incomplete Knowledge search stays incomplete after payload clearing

- **WHEN** `knowledge_search` returns `status: "success"` with `complete: false`, and a later turn replays it
- **THEN** the replayed result carries `complete: false` as the live loop sent it
- **AND** no replay clears its payload or shows the call as complete

#### Scenario: Incomplete grep stays incomplete after payload clearing

- **WHEN** `grep` returns `status: "success"` with `complete: false`, and a later turn replays it
- **THEN** the replayed result carries `complete: false` as the live loop sent it
- **AND** no replay clears its payload or shows the call as complete

### Requirement: PDF tool observations are stored and replayed like image results

The system MUST store a PDF in a tool result in the tool part as the native PDF result. The result
MUST NOT carry a media descriptor, PDF bytes, or base64 content. The tool part MUST keep the
retained original of an unstored PDF beside the result, as `media-attachments` defines. On replay,
its text MUST be the live rendering that `turn-replay` defines. The PDF MUST become provider file content, built from
its original at request time, only when three conditions are true. The request's model declares
`pdf` input, the original is available, and the epoch image window attaches it. A result with neither
`media` nor `retainedMedia` MUST replay as its text only, with no file content and no placeholder. For each other
result, when the three conditions are not all true, its text MUST carry the matching PDF
placeholder.

#### Scenario: A PDF result is stored without PDF data

- **WHEN** a `read` of `/work/paper.pdf` returns a PDF result
- **THEN** the stored tool part carries that native PDF result, with `status: "success"`,
  `kind: "pdf"`, `mediaType` `application/pdf`, `pages`, `byteSize`, and `path`, and no `media` field
- **AND** its stored output carries no `thumbnail`, no PDF bytes, and no base64 data
- **AND** the tool part keeps the retained original beside the result

#### Scenario: A media read PDF result is stored as a media reference

- **WHEN** a `read` of `media://<id>` returns a PDF result
- **THEN** the stored tool part carries that native PDF result with `media` `media://<id>`
- **AND** it carries no `thumbnail`, no PDF bytes, and no base64 data

#### Scenario: An attached PDF result replays as file content

- **WHEN** a later step of the Run that read `/work/paper.pdf` replays its PDF result, on a model with `pdf` input
- **AND** the epoch image window attaches the reference
- **THEN** the replayed result carries its text and the PDF as provider file content built from the
  retained original in its stored tool part
- **AND** the call remains immediately paired with its result

#### Scenario: A media read PDF result replays from the store in a later turn

- **WHEN** a later turn on a model that declares `pdf` input replays a stored `media://<id>` PDF result
  whose reference the epoch image window attaches
- **THEN** the replayed result carries its text and the PDF as provider file content built from the
  stored original

#### Scenario: An earlier turn's PDF read replays as not retained

- **WHEN** a later turn, a Continue Run, a compaction request, or a fork replays the stored PDF result
  of `read("/work/paper.pdf")` for a 15-page PDF, on a model with `pdf` input
- **AND** that tool part has no `retainedMedia`
- **THEN** the replayed result's text carries the fields of the result and no placeholder
- **AND** the request carries no file content for that result and does not fail

#### Scenario: An earlier turn's retained PDF read replays as file content

- **WHEN** a later turn on a model that declares `pdf` input replays the stored PDF result of
  `read("/work/paper.pdf")`, and the epoch image window attaches its reference
- **THEN** the replayed result carries its text and the PDF as provider file content built from the
  retained original

#### Scenario: A model without PDF input receives the omitted placeholder

- **WHEN** a request whose model declares `image` but not `pdf` input replays the PDF result of
  `read("/work/paper.pdf")` for a 15-page PDF
- **THEN** the replayed result's text carries
  `[pdf "/work/paper.pdf" 15 pages, omitted: this model has no PDF input]`
- **AND** the request carries no file content for that result

#### Scenario: A PDF result beyond the window replays as the limit placeholder

- **WHEN** a request on a model with `pdf` input replays the PDF result of `read("/work/paper.pdf")`
  for a 15-page PDF
- **AND** its reference is beyond the bounds of the epoch image window
- **THEN** the replayed result's text carries
  `[pdf "/work/paper.pdf" 15 pages, not attached: this context's PDF limit is reached]`
- **AND** the request carries no file content for that result

#### Scenario: PDF content does not consume the observation budget

- **WHEN** a replayed PDF result's original would serialize as base64 longer than 8,000 UTF-16 code
  units
- **THEN** the replayed pair carries its whole text
- **AND** the retained bytes are not part of that text

#### Scenario: A dropped pair carries no PDF

- **WHEN** a checkpoint absorbs an older pair whose result carries a PDF
- **THEN** neither the pair nor its file content appears in a later request
- **AND** the checkpoint carries no tool record

#### Scenario: A replayed PDF reference never resolves another owner's media

- **WHEN** a stored `media://<id>` PDF result replayed in user A's Run references a media id owned by
  user B
- **THEN** the replayed result carries `[pdf media://<id> unavailable]` and the request proceeds
- **AND** no PDF bytes or descriptor fields of user B's object reach the request

## REMOVED Requirements

### Requirement: Tool observations survive into later turns as stored UI parts

**Reason**: The requirement held the 8,000 and 32,000 replay budget, payload
clearing, the omission marker, the untrusted-output frame of replayed results,
and the deferral of step boundaries to #599. This change removes all of them.

**Migration**: The rules that stay true move to ADDED requirements of this
capability, with their scenarios: earlier tool activity, stored failures,
matched results, checkpoints, stored steps, and images. The projection itself
moves to `turn-replay`. The scenarios on the budget, the frame, sequential
pairs, and stability move to `turn-replay` or end with the budget.

## MODIFIED Requirements

### Requirement: Tool observations survive into later turns as stored UI parts

The prospective cutover boundary in `context-injection` SHALL govern failed-attempt retention; existing conversation state SHALL not be retrospectively filtered or rebuilt. A failed, cancelled, expired, or superseded attempt keeps its partial output and context as the user saw them, and that record participates in later model context and compaction like any other committed turn. An individual failed tool call within a successfully committed attempt SHALL still retain its normal paired failure observation.

A round's tool activity SHALL remain available to the model in later turns
within the bounded replay contract below. What a tool was asked and what it
returned or failed to return SHALL be representable on the next turn unless an
older complete observation must be omitted to enforce the hard budget.

Each replayed observation SHALL carry tool identity, input while its payload
fits, and structured outcome. Calls refused, cancelled, timed out, unavailable,
execution-failed, search-failed, or otherwise errored SHALL retain that outcome
rather than disappearing. Legacy output-error parts without structured outcome
SHALL map to generic `error` without parsing human prose; structured
cancellation metadata MAY recover `cancelled`.

Ordinary stored assistant parts SHALL replay through the existing conventional
AI SDK tool-call/tool-result projection until #599 establishes the canonical UI
message persistence contract. Every projected call SHALL be accompanied by its
matching result, including a well-formed result for a call with no genuine tool
result. Credentials and unrelated payloads SHALL NOT replay, and the tool
projection SHALL NOT carry provider-native reasoning or metadata; persisted
reasoning parts and their provider metadata reach the provider only through
`reasoning-output`'s same-Chat replay, outside this projection and its budget.

The ordinary projection SHALL remain:

- portable through SDK tool-call and tool-result parts rather than
  provider-specific structures;
- labelled untrusted inside result content;
- neutralized so remote-authored result content cannot forge a reserved
  structural boundary;
- bounded in JavaScript UTF-16 code units over the exact serialized text of the
  pair, at 8,000 per pair and 32,000 per stored assistant turn, where an image
  in a result counts only as its stored media reference;
- reduced by preserving pairing before budget, newer observations before older
  ones, and identity/outcome before payload; and
- stable for the same unmodified stored turn under the current explicit
  best-effort projector.

Payloads SHALL clear oldest-first only when clearing shrinks the envelope. If
irreducible pairs still exceed a limit, the oldest complete pairs SHALL be
dropped atomically until the projection fits, with one bounded omission count
and marker. An unmatched call or result SHALL never be emitted.

An image in a tool result SHALL be stored in the tool part as the native image result that produced
it, which names the image by its `media://` locator in `media`, and never as the `media-store` media
descriptor, image bytes, or base64. On replay, the result's text SHALL follow
the projection above, and the image SHALL become provider image content, built at request time from
the stored model variant, only when the image window defined by `media-attachments` admits that
reference for the request's model. Otherwise the replayed result SHALL carry the image placeholder
defined by `media-attachments` in its text, and a reference that does not resolve to the Run owner's
media SHALL replay as the unavailable placeholder without failing the request. Image content SHALL
NOT count toward the UTF-16 budgets, and an image SHALL replay only together with its retained result
payload: clearing a payload or dropping a pair also removes its image from the request.

Visible assistant text and retained tool occurrences SHALL keep their current
chronology. Because ordinary stored messages do not prove parallel or step
boundaries, consecutive calls SHALL continue to project conservatively as
standalone sequential matched pairs. This behavior SHALL NOT be generalized or
rewritten by this change; its research/refactor is scoped by #599.

Tool activity SHALL remain available to the model until a checkpoint absorbs
it, and no tool record SHALL cross that boundary. A checkpoint message SHALL
carry no tool part, SHALL select and re-bound no payload, and SHALL recompute no
budget; there SHALL be no semantic observation ledger, bounded replacement set,
or compacted tool record to read back. Absorbed tool activity survives only as
summary text, where the summary's `Errors and Corrections`, `Completed`, and
`Critical References` content is the carrier. Rows after the latest checkpoint
SHALL keep the ordinary bounded projection above unchanged, and replay of those
rows SHALL NOT consult the checkpoint.

Checkpoint text SHALL stay owner-scoped like the checkpoint row that carries it,
and no tool observation SHALL be reconstructed from summary prose, from an older
checkpoint's text, or from any inference about what an absorbed turn contained.

The live tool loop SHALL continue to observe its own results within the turn
that produced them.

#### Scenario: A later turn can use an earlier tool result

- **WHEN** a tool returns a result and the user asks about it later
- **THEN** the later request carries its identity, input when retained, result,
  and outcome through the conventional SDK representation

#### Scenario: An unsuccessful call is projected as unsuccessful

- **WHEN** a prior call was refused, cancelled, errored, or timed out
- **THEN** later replay carries a matched result reporting that outcome
- **AND** the call is not silently omitted solely because it failed

#### Scenario: A cancelled call is projected as cancelled

- **WHEN** a prior call was settled by unsuccessful Run termination
- **THEN** operational/UI replay reports its matching `cancelled` result, and that failed attempt's persisted output remains part of model history like any other committed turn
- **AND** it remains distinguishable from a tool-produced error

#### Scenario: A tool call made during reasoning is projected

- **WHEN** a tool was called while reasoning output was produced
- **THEN** the call/result observation follows the same replay contract
- **AND** the reasoning part is not carried by the tool projection; it replays
  under `reasoning-output` in its own occurrence position

#### Scenario: Every replayed call has a matching replayed result

- **WHEN** a later request replays stored tool activity
- **THEN** every retained call is immediately paired with its result
- **AND** unmatched calls/results are omitted atomically

#### Scenario: A call with no genuine result still carries a well-formed result

- **WHEN** a call was cancelled, refused, errored, or timed out before a genuine
  tool result existed
- **THEN** replay supplies a well-formed result carrying that outcome
- **AND** it does not narrate the absence as unrelated assistant prose

#### Scenario: Provider reasoning and metadata are never replayed

- **WHEN** stored tool activity includes reasoning or provider metadata
- **THEN** portable observations remain available across model/provider switches
- **AND** the tool projection carries no originating-provider reasoning or
  metadata; reasoning replay is governed by `reasoning-output`

#### Scenario: A model or provider switch keeps observations but not provider metadata

- **WHEN** a chat with tool activity continues on another model or provider
- **THEN** portable matched observations remain available through the target
  SDK conversion
- **AND** originating-provider metadata is excluded from the tool projection;
  replayed reasoning parts are passed back unchanged, `reasoning-output` omits
  before the request the ones the target wire cannot represent, and the target
  provider ignores or drops the rest

#### Scenario: The projection is labelled untrusted

- **WHEN** a tool result is replayed
- **THEN** its own result content identifies it as untrusted tool output
- **AND** instruction-like payload text carries no authority

#### Scenario: Replayed content cannot escape its boundary

- **WHEN** a tool result attempts to forge or close a reserved boundary
- **THEN** the replayed result is neutralized under the tool projection contract
- **AND** surrounding structure remains intact

#### Scenario: The projection is stable across turns

- **WHEN** the same unmodified ordinary stored tool part replays twice
- **THEN** the current projector produces the same application content
- **AND** no tool part is materialized at a checkpoint boundary

#### Scenario: Interleaved text and tools retain chronology

- **WHEN** an assistant turn contains visible text, tool calls, and later text
- **THEN** the current projector retains their occurrence order as standalone
  text and sequential matched pairs
- **AND** the implementation points to #599 instead of claiming proven step
  boundaries

#### Scenario: Visible text does not consume the observation budget

- **WHEN** visible assistant text surrounds capped tool observations
- **THEN** visible text retains its occurrence order outside the observation
  budget
- **AND** it does not cause an otherwise-retained pair to be dropped

#### Scenario: Hard limits preserve pairing and newest observations

- **WHEN** a serialized pair or turn exceeds its hard limit
- **THEN** payloads clear only when useful, then oldest complete pairs are
  omitted until the result fits
- **AND** exactly one bounded omission marker is retained and call/result counts
  remain equal

#### Scenario: Absorbed tool activity crosses a checkpoint only as summary text

- **WHEN** a checkpoint message absorbs a range of history that contains tool
  activity
- **THEN** that activity is available to later requests only as summary text
- **AND** the checkpoint message carries no tool record and replay of rows above
  it uses the ordinary bounded projection

#### Scenario: Recursive compaction consumes the prior checkpoint's stored text

- **WHEN** a later checkpoint supersedes a prior checkpoint
- **THEN** its summary input is the prior checkpoint's stored text plus the
  newly absorbed rows
- **AND** it writes no list of tool records and no record is carried forward

#### Scenario: A checkpoint without stored text cannot recover absorbed observations

- **WHEN** an active checkpoint message lacks valid non-empty stored text
- **THEN** request preparation fails closed
- **AND** no tool observation is invented from summary prose or from any ledger

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a Run
- **THEN** its result remains available within that same Run's tool loop

#### Scenario: An image result is stored as a media reference

- **WHEN** a `read` of `/work/shot.png` returns an image result
- **THEN** the stored tool part carries that native image result, with `kind: "image"`, its
  `media://` locator in `media`, `mediaType`, `width`, `height`, and `path`
- **AND** it carries no `provenance`, `byteSize`, or `model` descriptor field, no image bytes, and no
  base64 data

#### Scenario: An image result inside the image window replays as image content

- **WHEN** a later request on a model that declares `image` input replays a stored image result whose
  reference the image window admits
- **THEN** the replayed result carries its text and the image as provider image content built from
  the stored model variant
- **AND** the call remains immediately paired with its result

#### Scenario: An image result outside the image window replays as a placeholder

- **WHEN** a later request replays a stored image result whose reference falls outside the image
  window, or the request's model does not declare `image` input
- **THEN** the replayed result's text carries the image placeholder with the image's `media://`
  locator
- **AND** the request carries no image content for that result

#### Scenario: Image content does not consume the observation budget

- **WHEN** a replayed image result's model variant would serialize as base64 longer than 8,000 UTF-16
  code units, and the pair's text fits within the budget
- **THEN** the pair's payload is neither cleared nor dropped on account of the image
- **AND** the budgets measure only the pair's text, including the stored media reference

#### Scenario: A dropped pair carries no image

- **WHEN** the hard budget drops an older complete pair whose result carries an image
- **THEN** neither the pair nor its image content appears in the request
- **AND** the omission is counted by the single omission marker

#### Scenario: A replayed image reference never resolves another owner's media

- **WHEN** a stored tool part replayed in user A's Run references a media id owned by user B
- **THEN** the replayed result carries the unavailable placeholder and the request proceeds
- **AND** no image bytes or descriptor fields of user B's object reach the request

### Requirement: Tool failure is an observation, not a crash

An uncertain native `edit` or `write` outcome SHALL abort the model execution
signal and settle the Run without further tool steps. Its tool observation SHALL
report `outcome_unknown` unless a known result is already durable. Ordinary
isolated failures retain the continuation behavior below.

A tool that throws, times out, becomes unavailable, dynamically loses its trusted executor, or returns invalid output SHALL produce a structured error result — recorded, streamed, and visible to the model — and the run SHALL continue whenever the failure is isolated to that tool. Tool execution SHALL be bounded by the global `tools.callTimeoutSeconds` (operator config, documented built-in default 120). A trusted per-tool registration MAY only reduce that value and MUST be finite, positive, and no greater than the configured global maximum; an invalid override SHALL fail registration/admission before advertisement. The effective abort signal SHALL be forwarded into the executor and remote transport, and a timed-out MCP request/body SHALL be aborted and cleaned up before the structured timeout result settles. Tool errors SHALL never expose internal stack traces, remote exception bodies, or secrets in the recorded result.

Oversized tool results SHALL be truncated to a documented cap, measured in JavaScript UTF-16 code units over the serialized result, after secret redaction. Truncation SHALL operate on the tool's own payload rather than on the result envelope: the `status` discriminant and every top-level field the tool declared SHALL survive, with values shrunk in place. Where the declared field names alone exceed the cap, the cap SHALL win over the declared shape — trailing fields SHALL be omitted and the marker SHALL state how many of how many — so a result above the cap is never emitted. A string value SHALL be cut only on a Unicode code-point boundary, so no truncated payload contains a lone surrogate. Truncation SHALL NOT re-serialize any part of the payload into a string field, so redaction performed before truncation cannot be defeated by an alternate typed representation. A truncated result SHALL carry one visible truncation marker stating how many characters were omitted and the recovery action available to the model. When truncation shortens a list, the marker SHALL also state how many elements of that list survived out of how many it held, naming the lists that lost the most and counting any remainder, so a count read off a shortened list is not mistaken for a complete one. Error results SHALL NOT be truncated, because every error message this loop produces is a short, statically authored string.

An image in a tool result SHALL be carried by its media reference, never by image bytes, so the cap
measures only the reference text. Truncation SHALL NOT cut, shorten, or omit the media reference of
an image result: other values SHALL be shrunk and, at the floor, other fields omitted in its place,
so a recorded image result always names the complete `media://` locator of the image it carries.

A code-owned tool whose executor is inconsistent with its admitted in-memory id/schema/classification SHALL fail attempt preparation before a provider request. Fresh attempts SHALL resolve from the executing worker's trusted registry; no historical description or template hash SHALL be required. A dynamic source tool that loses its executor, disconnects, or drifts after attempt preparation SHALL instead retain its attempt-local model-facing declaration with an unavailable executor for that Run, so a requested call settles non-fatally without substituting a changed contract.

#### Scenario: Tool error surfaces to the model and the run continues

- **WHEN** an executing tool throws
- **THEN** an error result part is recorded, the model observes it, and the run proceeds to a final answer

#### Scenario: Tool call times out

- **WHEN** a tool exceeds its effective timeout
- **THEN** execution and any remote request/body are aborted and cleaned up
- **AND** a structured timeout error result is recorded and the run continues

#### Scenario: Invalid trusted timeout override fails admission

- **WHEN** a trusted tool registers a non-finite, non-positive, or above-global timeout override
- **THEN** registration or admission fails before the tool is advertised

#### Scenario: Dynamic executor disappears after enqueue

- **WHEN** a dynamic tool was bound into an attempt but its source disconnects before the model requests it
- **THEN** the call settles as structured `not_available`, no substitute executes, and the Run continues

#### Scenario: Code-owned declaration drift remains fail-closed

- **WHEN** a prepared code-owned declaration has an id/schema inconsistent with its trusted attempt-local executor
- **THEN** the Run fails before the provider request rather than executing a different contract

#### Scenario: Code-owned executor loss remains fail-closed

- **WHEN** a prepared code-owned tool has no compatible trusted executor at execution
- **THEN** the Run fails before the provider request rather than returning a dynamic unavailability observation

#### Scenario: Error results carry no internals

- **WHEN** a tool error result is recorded
- **THEN** it contains a safe message, not a stack trace, raw remote error, or configuration value

#### Scenario: Truncated success result keeps its declared shape

- **WHEN** a successful result serializes above the cap
- **THEN** the recorded result keeps `status: "success"` and every top-level field the tool returned, with oversized values shrunk in place rather than replaced by a serialized fragment of the result

#### Scenario: Truncation cuts on a code-point boundary

- **WHEN** the cut point of an oversized string value falls between the halves of a surrogate pair
- **THEN** the truncated value is well-formed and contains no lone surrogate

#### Scenario: Truncation marker states omission and recovery

- **WHEN** a result is truncated
- **THEN** it carries a marker stating the number of omitted characters and that narrowing the call's arguments recovers the omitted content

#### Scenario: Cap outranks declared shape at the floor

- **WHEN** a successful result's top-level field names alone serialize above the cap
- **THEN** trailing fields are omitted so the recorded result still fits the cap
- **AND** the marker states how many fields of how many were omitted entirely

#### Scenario: Shortened list reports what survived

- **WHEN** truncation drops the tail of a list in the payload
- **THEN** the marker names that list and states how many elements were kept of how many it held
- **AND** when more lists were shortened than the marker names, the remainder is counted rather than named

#### Scenario: Error results are never truncated

- **WHEN** a structured error result is produced
- **THEN** it is recorded unchanged regardless of length

#### Scenario: Permission rejection is a non-fatal tool observation

- **WHEN** the execution policy rejects an otherwise valid available tool call
- **THEN** no tool executor or native effect attempt starts
- **AND** the model receives `permission_denied` and may continue within existing Run limits
- **AND** the system neither retries the rejected call automatically nor requests approval

#### Scenario: Truncation keeps an image result's media reference

- **WHEN** a result carrying an image serializes above the cap because another field is oversized
- **THEN** the recorded result carries the complete `media://` locator unchanged
- **AND** the oversized field is shrunk in place and the marker states the omitted characters

#### Scenario: The floor omits other fields before the media reference

- **WHEN** an image result's top-level field names alone serialize above the cap
- **THEN** fields other than the one carrying the media reference are omitted until the result fits
- **AND** the recorded result still carries the complete `media://` locator

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5 set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, `admin`, `unverified`). The loop SHALL execute allowlisted `read_only` tools and exact code-owned tools registered by an approved alpha-native capability only when the executing process's `tools.permissions` policy also allows the invocation. MCP tools SHALL declare `unverified`; their eligibility SHALL be determined by an admitted MCP declaration whose exact id matches either an exact `tools.allowed` entry or a validated namespace rule, not by a `read_only` classification. An MCP invocation SHALL execute only when its source is allowlisted and the executing process's `tools.permissions` policy allows that invocation. The initial native set is `read` classified `read_only`, plus `edit` and `write` classified `write_low_risk`; later native capabilities such as Knowledge submit or bash must declare their own exact tools and retry policy. Classification alone SHALL NOT admit any other write or execution tool. Alpha-native tools carry explicit host authority for absolute paths and owner-scoped Knowledge authority for `kb://` locators, and `read` alone carries owner-scoped, read-only media authority for `media://` locators, which resolves only the Run owner's media; they are not a general permission engine, and their host authority SHALL NOT grant authority to MCP tools. The candidate resolver SHALL admit `edit` and `write` when the process has accepted native host authority or has a configured Knowledge root, and SHALL leave them unavailable when it has neither. It SHALL admit `read` whenever `tools.allowed` names it, because skill, web, and `media://` locators need no host authority; an absolute path on a process without accepted native authority still fails closed with `executor_unavailable`. A configured Knowledge root admits only `read`, `edit`, and `write`; `bash`, `enter_workspace`, `exit_workspace`, and every other host-capability tool remain admitted solely by accepted native host authority. The exact host-capability set SHALL include `enter_workspace` and `exit_workspace`; `enter_workspace` SHALL be classified `execute_code`, `exit_workspace` SHALL be classified `write_low_risk`, neither SHALL record a `native.attempt` effect, both SHALL bind the Run to the executing native executor identity like other host tools, and both SHALL be idempotent over Chat state when retried after their state change commits. Every MCP source-inventory, advertisement, executable-binding, and unavailable-state gate SHALL use source admission, `tools.allowed`, and per-call `tools.permissions` as applicable; no MCP gate SHALL require or infer a `read_only` classification or attestation, and an unavailable MCP declaration SHALL retain at most its exact identity for availability disclosure without an executable binding.

The `mcp__` tool-id prefix SHALL be reserved for ids produced by the MCP capability. A code-owned or other non-MCP registry entry beginning with that prefix SHALL fail registration, so ID-only namespace permission matching cannot grant authority across source kinds.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called and its invocation passes the execution permission policy
- **THEN** it executes

#### Scenario: Alpha native file tool executes only in its host capability

- **WHEN** an exact code-owned native host tool, including `enter_workspace` or `exit_workspace`, is allowlisted, its trusted host capability is present, and the invocation passes execution permission checks
- **THEN** it executes with the host authority declared by that capability
- **AND** it is not substituted with a hosted path or remote MCP operation

#### Scenario: Native tools are admitted by Knowledge root alone

- **WHEN** a process has a configured Knowledge root, no `tools.nativeExecutorId`, and allowlists `read`, `edit`, and `write`
- **THEN** the three tools are advertised for `kb://` locators
- **AND** each call executes only when its `tools.permissions` policy allows it; without a matching allow the call receives `permission_denied`
- **AND** an absolute path fails closed with `executor_unavailable`

#### Scenario: Read is admitted by the allowlist alone

- **WHEN** a process has no `tools.nativeExecutorId` and no configured Knowledge root, and allowlists `read`, `edit`, and `write`
- **THEN** `read` is advertised and serves web locators under its permission policy
- **AND** `edit` and `write` are neither advertised nor executable, and an absolute-path `read` fails closed with `executor_unavailable`

#### Scenario: Knowledge root does not admit bash

- **WHEN** a process has a configured Knowledge root, no `tools.nativeExecutorId`, and allowlists `bash`
- **THEN** `bash` is neither advertised nor executable
- **AND** the Run manifest records it unavailable exactly as before this change

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a non-MCP tool outside the exact approved host-capability set is classified other than `read_only`, registered and allowlisted, and the model requests it
- **THEN** it is not advertised or executed
- **AND** a direct request receives a recorded non-fatal refusal

#### Scenario: Unclassified tool cannot register

- **WHEN** a tool without a classification is registered
- **THEN** registration fails at startup

#### Scenario: Duplicate tool id cannot register

- **WHEN** two tools register the same id
- **THEN** registration fails at startup naming the id

#### Scenario: Code-owned tool cannot occupy the MCP namespace

- **WHEN** a code-owned registry entry has an id beginning with `mcp__`
- **THEN** registration fails at startup naming the reserved prefix

#### Scenario: Write-capable MCP tool executes under both gates

- **WHEN** an MCP source supplies an admitted write-capable declaration whose exact id matches `tools.allowed`, and the invocation passes the executing process's `tools.permissions` policy
- **THEN** the tool executes despite its `unverified` classification

#### Scenario: Read serves media locators without host or Knowledge authority

- **WHEN** a process has no `tools.nativeExecutorId` and no configured Knowledge root, allowlists
  `read`, and the Run owner reads `media://<id>` of an image that owner holds
- **THEN** `read` returns the image result when its permission policy allows the call
- **AND** without a matching allow the call receives `permission_denied`

#### Scenario: Media authority does not cross owners

- **WHEN** user A's Run reads `media://<id>` of an image owned by user B, under a policy that allows
  the locator text
- **THEN** the call returns `not_found`, exactly as for an id that does not exist
- **AND** no bytes or descriptor fields of user B's image reach user A

#### Scenario: Media authority is read-only

- **WHEN** `edit` or `write` targets a `media://` locator
- **THEN** the call returns the existing unsupported-operation error
- **AND** no media object or stored variant changes

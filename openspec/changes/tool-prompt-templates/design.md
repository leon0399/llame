## Context

See [proposal.md](proposal.md) for the agreed scope. The existing acceptance path
in `apps/api/src/chats/chat-loop.service.ts` and `turn-context.ts` resolves owner
inputs and creates a combined prompt/catalog snapshot before queue dispatch.
`run-execution.service.ts`, `snapshot-tool-execution.ts`, receipt DTOs, and
transition compaction consume that snapshot. This change replaces that lifecycle.

OMP was inspected at `f97fa5c95010b62ac34c7357f9a1cae6975e12d6` on 2026-09-12.
Its [Bash description getter](https://github.com/can1357/oh-my-pi/blob/f97fa5c95010b62ac34c7357f9a1cae6975e12d6/packages/coding-agent/src/tools/bash.ts#L688-L704)
renders a bundled Markdown file with settings and active-tool predicates.
Its [renderer](https://github.com/can1357/oh-my-pi/blob/f97fa5c95010b62ac34c7357f9a1cae6975e12d6/packages/utils/src/prompt.ts#L529-L546)
caches compiled templates. The built-in tool files have no runtime override
loader; llame adds the agreed operator file precedence using its existing
Handlebars validator and context projection.

The existing worker-binding discussion is
[#319](https://github.com/leon0399/llame/issues/319). Acceptance-time binding,
one permanent context per Run, and worker-owned context per attempt were compared
during discovery. The agreed choice is the last: queue delay and retry may
change inputs. System-only receipts record what each attempt actually used.

## Goals / Non-Goals

Keep one worker path for co-located and dedicated execution. Resolve both prompt
surfaces from the same safe context, with trusted executor/schema admission and
current invocation permissions. Preserve owner isolation, single-flight, native
effect fences, and the order of committed conversation parts.

MCP description templating, schema/property-description templating, tool-result
rewrites, hot file reload, a template editor, and new feature flags beyond
`tools.<id>` are outside this change. Existing variables keep their owning
capabilities' meaning: a stored chat digest remains a digest, and a message's
received-time anchor does not become the retry's wall-clock time merely because
rendering moves. Current owner sharing/personalization settings are reread for
each attempt under those capabilities' existing retention rules.

Historical chat reconstruction is outside this change. The new failed-attempt
exclusion and successful-publication rules apply to attempts executed after the
coordinated runtime cutover. They do not retroactively reclassify existing chat
history, summaries, or digest state.

## Decisions

### D1. Packaged descriptions and one renderer

Move the seven current llame-owned descriptions to
`apps/api/src/prompts/tools/<tool-id>.md`: `read`, `edit`, `write`, `bash`,
`search_conversations`, `conversation_read`, and `knowledge_search`. Keep
schemas and parameter descriptions with their trusted code/source.

Reuse `instance-config/prompt-loader.ts` for validation, sanitization,
compilation caching, and construction of the explicit context. Every existing
allowed model, owner, chat, and temporal variable is available in both surfaces;
raw configuration records and credentials are never context.

Change the Nest asset glob from `prompts/*.md` to `prompts/**/*.md`. Extend
`prompt-built-runtime.contract.ts` to load and render every description from
compiled output. The source-tree presence of a Markdown file is insufficient.

### D2. File precedence and boot ownership

Select each description independently through
`models[].toolPromptFiles[id]`, then `tools.promptFiles[id]`, then the packaged
file. Overrides replace whole files. Missing/null entries and empty maps follow
the existing absence rules; they do not clear lower-priority entries.

Override keys must name registered llame-owned tools; reject MCP and wildcard
override keys. Resolve paths against the active config directory and apply the
existing newline/trailing-whitespace normalization. Validate every configured
file, including shadowed entries and disabled-tool overrides, in execution
workers. An explicitly invalid file never falls back silently.

Separate configuration-shape/model-reference validation from executable prompt
loading. API-only processes can accept a Run without loading prompt files or
resolving a tool catalog. A process hosting a Run consumer reads, validates, and
compiles its system and description templates at boot using its resolved model
and instance maps. Missing or invalid files fail that worker's startup. Workers
need no configured-server vocabulary to validate an absent-safe tool predicate.

Files and configuration are restart-applied. Rendering is per attempt; templates
and compiled functions may be cached, while owner-specific rendered text and
catalogs are never shared between attempts or tenants.

### D3. Attempt-local resolution and predicates

API acceptance validates and persists the user message, selected public model id
and effort, and Run identity under the existing single-flight transaction.
Those user choices remain fixed. It neither renders effective prompts nor binds
a tool catalog. Legitimate acceptance-time facts, including when a user message
was received, retain their existing producers.

On every allowed execution attempt:

1. Claim a fresh attempt identity under the Run owner's scope and current queue
   ownership. Run existing native recovery checks before starting another model
   loop; a possibly executed native mutation still forbids replay.
2. Resolve the selected model from the worker's boot-loaded configuration,
   reread the owner projection, and obtain current chat context and the worker's
   atomically published MCP inventory. A missing selected model fails explicitly;
   there is no replacement by another model or a newer default.
3. Apply existing allowlist, classification, native/Knowledge capability,
   collision, timeout, and input-schema admission. Retain each trusted executor
   with its admitted source declaration in memory.
4. Build one safe render context and a candidate target request. If transition
   compaction is needed, stage its replacement history and digest/anchor refresh
   in memory, then finalize both prompt surfaces against that staged context.
   Recheck target request size. MCP descriptions remain opaque text.
5. Persist the final target system-prompt-only receipt before target model I/O,
   conditional on still owning the attempt. A source-model transition summary
   uses its existing successful source receipt and is separately identified in
   operational events. Keep the finalized tool context in memory for the
   attempt's target-model steps and permitted calls.

`tools.<exact-id>` is a conditional-only boolean: true for an admitted id,
false otherwise, including an unknown native id or an id for an unconfigured
MCP server. Validate only supported path structure and exact-id syntax at boot,
not current registry membership. Missing tools never make a worker fail boot.
Override-target validation is separate from predicate validation.

Retain existing `if`/`unless` and bounded-`each` rules. Tool predicates cannot
be emitted as values or iterated; bare namespaces, deeper properties, wildcards,
parent traversal, and prototype access remain invalid. Build explicit own
boolean properties; do not expose the registry or source records. This iteration
adds no Knowledge-enabled or other capability namespace.

Boot validates template syntax and existing owner/digest probes. For tool-aware
templates, representative none/all membership probes are diagnostics only;
their emptiness cannot reject a syntactically valid template solely because a
tool is absent. A description's own predicate is true in its probes. Actual
rendering must reject an empty system prompt or admitted description before
target-model I/O, with safe static diagnostics. Fail the attempt, rather than
dropping a tool and rendering again. The accepted user message/Run still exists.

Within an attempt, both prompt surfaces and the advertised catalog remain fixed.
An MCP disconnect or source-declaration drift during that attempt uses the
existing unavailable-call path; it does not substitute newer definitions. Its
next retry obtains a fresh catalog. Template wording is never compared against a
database snapshot, and no packaged-template compatibility hash is persisted.

### D4. System receipts and minimal availability storage

Replace the combined context snapshot with an owner-scoped system prompt receipt
per execution attempt: Run/attempt identity, public model/effort, prompt source,
rendered system text, prompt hash, and time of resolution. It records the
attempt's text and is never used as a tool catalog or a retry input. Retain
receipts for attempts that reached prompt preparation even if they later failed;
inspection is separate from model-history replay. A receipt proves preparation;
correlated request events, not its mere existence, indicate dispatch. Before a receipt exists, the
owner API/UI reports pending or not produced, rather than disguising an owned
queued Run as not found. Non-owners still receive not found.

Keep one small comparison record per successfully committed turn, associated
with its existing message/Run identity: sorted exact tool ids and the state
`available` or `unavailable`. The record contains no schema, description,
template, source hash, declaration hash, endpoint, or failure detail. Current
safe unavailable reasons are used while rendering a reminder; they need not
be retained to compare the next turn's states. Empty observed state is `[]`;
absence means there has been no committed observation.

No full catalog is written into queue payloads, Run metadata, receipts,
context-item metadata, events, or new database columns. Rendered system text
may naturally mention tools through operator-authored conditionals; actual
tool-call ids/arguments/results and fixed availability reminder text remain
ordinary conversation/operational data. This is not a ban on those authored
messages. Eliminate the old combined content/tool/availability hash fields and
source-rebinding mechanism rather than adding a second compatibility path.

### D5. Compare with the previous committed turn

At attempt preparation, read the latest successful turn's minimal availability
record within the same owner's chat. After compaction removes the prior
disclosure epoch, use the existing initial/rebaseline behavior: emit only current
unavailable tools when degraded, and nothing for an all-available catalog.
Otherwise derive the existing added, removed, unavailable, and restored notices
from the current attempt versus that preceding committed turn. A description or
schema change with the same ids/states produces no availability reminder.

The prepared reminder is attempt-local model input. A failed attempt neither
persists it into canonical model history nor updates the comparison record.
Every retry therefore compares with the same preceding committed turn, not the
attempt it superseded. No additional cross-Run catalog cache is needed.

For a fresh worker whose configured MCP source is not ready, supplement the
availability-comparison input with matching ids from the previous successful
record. This is a separate non-admissible comparison input, never a
`TurnToolCandidate` or an input to catalog/schema/classification admission.
An id still permitted by the current allowlist and configured source is
unavailable, not removed; use the source's current closed reason. These ids
never supply a schema, classification, executor, or callable declaration.
Disallowed/unconfigured ids are absent; a ready source's fresh discovery is
authoritative about removal. This rule survives worker handoff without
restoring catalogs or inferring ids that have never been observed.

Example: M1 committed with grep available. M2 attempt A sees grep unavailable
and emits that transition, but fails. Attempt B sees grep available again and
compares with M1, so emits no restoration notice. Only B's successful commit
publishes M2's state. This remains true when B runs on another worker.

On successful completion, atomically publish the winning attempt's assistant
message, exact injected reminder text in the appropriate context-rail position,
its minimal availability record, and terminal completion. Preserve existing
user-authored content and stored part ordering when publishing attempt-owned
parts. Keep the prior baseline through retries, cancellation, terminal failure,
and expiry. Persisted user messages remain real user history even if no attempt
succeeds.

Attempt identity must fence receipt/context publication, new invocation
admission, and finalization. A worker superseded by queue recovery cannot publish
a competing answer, append its reminder, or advance the baseline. Compare
against the active attempt in tenant-scoped writes, alongside existing Run state
and native effect checks. Native effect admission must check that identity and
non-terminal uncancelled Run state atomically with its existing durable effect
record, before dispatch. Reclaim treats an admitted but unsettled effect as
potentially executed even if dispatch was not observed; the existing recovery
fence still blocks a fresh model loop or duplicate execution. Keep operational events/effect records and partial
output for diagnostic/UI replay; tag or scope them by attempt so they cannot
enter a retry, compaction input, or a later model-history projection. Existing
failure/partial-output UI retention is not permission to promote it as context.

Attempt-owned digest initialization, appends, and pre-request transition
refreshes follow the same successful-publication boundary. Recheck owner consent and the digest epoch
after candidate resolution, before target-model I/O. Discard new digest production
if that check observes withdrawal; retain existing baseline withdrawal semantics.
Later setting changes affect later attempts and cannot undo an already prepared
disclosure. The existing renderer returns private metadata for digest entry values actually
emitted along executed branches. Combine that metadata from both surfaces with
prior told state before deriving appends; commit the union only on success.
Do not recover identities by matching rendered strings or add template-visible
ids. A post-success compaction refresh starts an undisclosed epoch; its next
successful request accounts for the new baseline without storing descriptions.
The receipt can show exact digest text only where it appeared in the system
prompt; tool-only historical wording is intentionally unavailable.

Native executor identity and workspace/filesystem authority remain fixed by
their existing trusted execution contracts. Fresh membership or description
rendering cannot turn an effect-recovery record into permission to re-execute
a mutation, change the selected executor authority, or weaken its call fence.

### D6. Guidance, compaction, and adjacent proposals

Gate Bash's edit recommendation with `tools.edit` and search's reader
recommendation with `tools.conversation_read`. Preserve independent safety and
bounded-result statements. Audit the remaining migrated descriptions for the
same cross-tool pattern.

Post-success full-current compaction may use the winning attempt's in-memory
system/declarations, with tool execution disabled as today. It runs after the
turn's terminal commit and publishes its checkpoint and digest/anchor refresh
in a separate atomic compaction transaction. Fence that transaction by its
successful source Run, covered message range, and expected chat context epoch;
reject stale work rather than changing context beneath a prepared live attempt.
Later model-switch compaction retains
the source model/effort and successful source system-prompt receipt, but must
not reconstruct tool definitions from the database or claim an exact old tool
prefix. Send that transition-compaction request without tool declarations and
budget the actual request. The historical conversation includes the committed
tool calls/results it needs to summarize. This deliberately gives up exact
tool-prefix cache reproduction across worker lifetimes.

Transition compaction is preparation work: its checkpoint, context epoch,
digest/anchor refresh, and supersession marker remain staged until target-turn
success. Failure discards them. Finish the target prompt/description render and
write its receipt after transition preparation; fixed-within-attempt means the
finalized target-model context, not a preliminary size-estimation render.
A successful transition publishes its staged checkpoint and context state in
the same transaction as the winning turn. Ordinary post-success compaction
uses its own transaction because the source turn has already committed.

The pending `tool-search` proposal assumes persisted catalogs. Reconcile it with
attempt-local discovery and the no-catalog-storage rule before combining the
implementations, including any search result that would otherwise persist
complete tool declarations. This change neither implements tool-search nor
adds per-step activation predicates. System-provided skills remain their own
producer; no additional feature checks are introduced here.

## Storage and Cutover

Persist `activeAttemptId` on the Run, assigned atomically by each
queue-authorized claim/reclaim; keep it distinct from `workerId`, which remains
trusted native executor authority. Successful finalization records
`completedAttemptId`. Correlate attempt-owned events and receipts with the
attempt id; compare the expected id in tenant-scoped invocation/publication
writes. Run-level queue/cancellation events may have no execution attempt. A system receipt is append-only per attempt;
the Run's active attempt changes only through the claim protocol. Availability
records are written only in successful-turn finalization, not during claim or
receipt preparation. Keep forced RLS and trusted owner identity on all new or
reworked tables and composite ownership relationships.

Use a system-only receipt table with a unique owner/Run/attempt key and an
owner-matching Run reference. A Run has zero or more attempt receipts; the
successful attempt is identified explicitly at completion. Delete content-based
`createOrReuse` receipt identity and its uniqueness index: identical text/hash
in different attempts still produces distinct receipts. During migration,
retain one historical system receipt per linked Run with an explicit historical
identity, without inventing retry counts or dispatch times. Remove the old
`runs.modelContextSnapshotId` FK and required Run-create input after that copy;
acceptance must not create a placeholder snapshot. Source-model lookup follows
the successful Run's receipt instead.

Keep the existing owner-only `GET /api/v1/runs/:id/context-receipt` surface,
returning resolution state, active/completed attempt identifiers, and an ordered
list of system-only receipts keyed by attempt id. It loads on demand and permits
inspection of every prepared attempt, not merely the latest. Before preparation
the list is empty with an honest state. No new tool-inspection endpoint exists.

Quiesce acceptance and drain old active Runs before switching API/worker
protocols. Migrate existing combined snapshots to retain their system prompt
receipt content and owner linkage. Preserve only id/state availability
observations associated with successful historical turns; never infer an
observation from the old unobserved sentinel or a failed Run. Then remove the
stored tool declarations, schema/description payloads, and obsolete combined
hash/binding columns. Keep messages, effect records, and system receipts intact.

Preserve existing messages and reminders, active summaries/checkpoints, and
digest baseline/told-set state. Do not rebuild, clear, or retrospectively filter
them to enforce the new attempt-publication rules. Existing aggregates can
contain context produced by failed pre-cutover Runs; this change makes no claim
to remove it. Normal future compaction, digest lifecycle, and existing owner
access controls continue to apply. The receipt/catalog migration above does not
authorize rewriting conversation history or its aggregate state.

The removal of historical tool-catalog receipts is an intentional data-contract
change. Take a database backup before this migration. Rollback of the old
binaries requires the matching pre-migration database backup because removed
catalogs cannot be rebuilt honestly. Do not reset or discard the live chats.
No code, migration, or data change occurs while this is only a proposal.

## Verification

Tests must cover bootstrap from built assets; precedence and invalid files;
unknown/disabled/offline predicate targets; two owners on one model; delayed
execution after owner/config/catalog changes; fresh retry resolution; stable
within-attempt context; pre-request receipt visibility; no database/catalog
payload leaks; identical baseline comparison after worker handoff; stale attempt
writes; failure after receipt/reminder preparation; and native uncertain-effect
recovery. Exercise ordinary and transition compaction with request-size
estimation matching the actual declarations sent.

Verify rendered templates with the installed Handlebars runtime, then use the
repository's OpenSpec, Markdown, and formatting checks. Integration tests must
prove atomic successful publication, pending versus unauthorized receipts,
receipt immutability, and cross-owner denial.

## Revision history

- v7 (2026-09-12): Made native effect admission atomic with the owner/Run/attempt
  check and covered reclaim before admission or before observed dispatch.
  Aligned configuration boot probes with the existing independent user/chat
  cross-product and unconditional anchor. MCP result redaction remains governed
  by its unchanged canonical requirement and existing executor sanitization.

- v6 (2026-09-12): Corrected residual API-time Knowledge wording, clarified
  MCP availability-comparison terminology, renamed the conversation-reader
  requirement, and made canonical Purpose synchronization explicit after PR
  review. Clarified staged transition input. Per Leo's scope decision, preserved
  existing history, summaries, and digest state without retrospective cleanup;
  new attempt-publication rules apply prospectively. The receipt's prohibition
  on availability manifests remains intact.
- v5 (2026-09-12): Separated historical-id availability comparison from tool
  candidate admission and qualified target-request ordering after transition
  summarization throughout the deltas.
- v4 (2026-09-12): Clarified pre-request versus post-success compaction
  publication, absent-value versus empty-output validation, offline MCP
  identity comparison after worker handoff, distinct attempt receipt keys, and
  private render-time digest disclosure tracking. Specified the durable attempt
  columns, Run-to-receipt relation, old snapshot-FK removal, and multi-attempt
  inspection response.
- v3 (2026-09-12): Rewritten after the completed grilling: fresh context per
  execution attempt, runtime-only tool definitions, system-only receipts,
  absent-safe predicates, and committed-turn availability comparison.
- v2 (2026-09-12): Source review identified nested prompt asset packaging and
  boot-loading dependencies; the earlier binding design was superseded by v3.
- v1 (2026-09-12): Initial draft before the runtime/storage decisions were settled.

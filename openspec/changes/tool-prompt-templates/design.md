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
4. Build one safe render context from those inputs. Render the system prompt and
   all admitted llame-owned descriptions. MCP descriptions remain opaque text.
5. Persist the system-prompt-only receipt for this attempt before provider I/O,
   conditional on still owning the attempt. Keep the complete tool context only
   in memory for that attempt's model steps and permitted calls.

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
provider I/O, with safe static diagnostics. Fail the attempt, rather than
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
inspection is separate from model-history replay. Before a receipt exists, the
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
attempt it superseded. No in-memory cross-Run catalog cache is needed.

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
and native effect checks. Keep operational events/effect records and partial
output for diagnostic/UI replay; tag or scope them by attempt so they cannot
enter a retry, compaction input, or a later model-history projection. Existing
failure/partial-output UI retention is not permission to promote it as context.

Digest baseline/told-set changes and compaction refreshes follow the same
successful-publication boundary. Recheck owner consent and the digest epoch
after candidate resolution, before provider I/O. Discard new digest production
if that check observes withdrawal; retain existing baseline withdrawal semantics.
Later setting changes affect later attempts and cannot undo an already prepared
disclosure. The winning told-set accounts for entries actually rendered in
either the system prompt or admitted descriptions, without storing descriptions.
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

Same-attempt compaction may use the attempt's in-memory system/declarations,
with tool execution disabled as today. Later model-switch compaction retains
the source model/effort and successful source system-prompt receipt, but must
not reconstruct tool definitions from the database or claim an exact old tool
prefix. Send that transition-compaction request without tool declarations and
budget the actual request. The historical conversation includes the committed
tool calls/results it needs to summarize. This deliberately gives up exact
tool-prefix cache reproduction across worker lifetimes.

The pending `tool-search` proposal assumes persisted catalogs. Reconcile it with
attempt-local discovery and the no-catalog-storage rule before combining the
implementations, including any search result that would otherwise persist
complete tool declarations. This change neither implements tool-search nor
adds per-step activation predicates. System-provided skills remain their own
producer; no additional feature checks are introduced here.

## Storage and Cutover

Use a fresh trusted attempt id on each claim/reclaim and correlate its receipt
and emitted events with that id. A system receipt is append-only per attempt;
the Run's active attempt changes only through the claim protocol. Availability
records are written only in successful-turn finalization, not during claim or
receipt preparation. Keep forced RLS and trusted owner identity on all new or
reworked tables and composite ownership relationships.

Quiesce acceptance and drain old active Runs before switching API/worker
protocols. Migrate existing combined snapshots to retain their system prompt
receipt content and owner linkage. Preserve only id/state availability
observations associated with successful historical turns; never infer an
observation from the old unobserved sentinel or a failed Run. Then remove the
stored tool declarations, schema/description payloads, and obsolete combined
hash/binding columns. Keep messages, effect records, and system receipts intact.

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

- v3 (2026-09-12): Rewritten after the completed grilling: fresh context per
  execution attempt, runtime-only tool definitions, system-only receipts,
  absent-safe predicates, and committed-turn availability comparison.
- v2 (2026-09-12): Source review identified nested prompt asset packaging and
  boot-loading dependencies; the earlier binding design was superseded by v3.
- v1 (2026-09-12): Initial draft before the runtime/storage decisions were settled.

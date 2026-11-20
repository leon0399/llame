# Design

## Context

See [the proposal](proposal.md) for motivation and agreed scope. This branch contains planning artifacts and proposed ADRs, not an implementation.

Current facts at proposal base `993b8f5a0`:

- `apps/api/src/db/schema/projects.ts` stores names, descriptions, archive state, and a default executor, with owner RLS. It stores no instructions.
- `apps/api/src/projects/dto/projects.dto.ts` uses explicit response projections and partial updates. A runtime probe of its installed `class-validator` confirms that `MaxLength` counts Unicode code points.
- `apps/web/app/(chat)/projects/[id]/project-side-panel.tsx` keeps Instructions and Context sample data in local state. Repositories use real API reads.
- `apps/api/src/chats/context-item.ts` defines persisted text, producer names, payloads, and author-time order. Workspace told columns are not the pattern for this producer.
- `apps/api/src/runs/run-execution.service.ts` stages accepted-turn context and atomically publishes it at `dispatchAttempt` with the attempt fence and `model.requested`.
- `apps/api/src/runs/run-created-flags.ts` recovers immutable facts through `RunEventsRepository.findFirstByType`. `run_events` already has JSON payloads and owner-scoped policies.
- `openspec/specs/repositories/spec.md` defines absolute local checkout paths and canonical `machine://` locators. Those records describe registrations, not current availability.

The repository pins OpenSpec 1.13.1, TypeScript 5.9.3, pnpm 12.9.0, and Oxfmt 0.73.0. No dependency is needed. The runtime-plugin discussion supplies the relevant prior decision, not an implementation dependency. Its [told-state comment](https://github.com/leon0399/llame/issues/1489#issuecomment-6715360525) cites the existing instruction and git producers as precedents.

## Goals and non-goals

Use existing owner transactions, native read admission, text selectors, context templates, Run events, and dispatch fencing. Keep current repository and Workspace behavior intact.

Do not build a generic plugin framework, generic settings resolver, instruction importer, checkout inspector, navigation policy, or new approval mechanism. Do not migrate Workspace told columns as an incidental refactor.

## Decisions

### D1. Store one literal instructions field

Add nullable `projects.instructions`. Existing Projects receive null, without a content backfill. Extend the existing owner update DTO, repository projection, explicit response DTO, generated OpenAPI, and web client.

The initial API accepts instructions through PATCH, not through an additional creation form. Omission preserves the value. Null or all-whitespace text clears it. Preserve nonblank text as entered, including its surrounding whitespace. Reject more than 16000 Unicode code points before a write. This reuses the DTO's existing `MaxLength` semantics and bounds automatic context without a separate file service. Do not silently truncate instructions.

Use a real editor in the Project page's existing Instructions section. Keep a draft on failure, show the server error without the submitted text, and refresh the persisted value after success. Archived Projects remain readable and reject edits. Remove the Context-files section and its sample-card behavior. Keep #1330 for genuine context-file support.

The alternative, a file or import-backed instruction system, needs resolution and availability rules that the owner excluded. A second generic configuration layer adds no present value.

### D2. Freeze selection, derive told state

These are separate responsibilities.

| Responsibility                               | Source                                                                       | Lifetime                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Which Project guidance this Run applies      | A write-once `run.project_bound` event                                       | First successful dispatch through the Run's terminal state |
| What the model already received              | The latest text-bearing `project` item in reconstructed active-epoch context | Until a checkpoint ends that epoch                         |
| What an explicit Project detail read returns | Current owner-scoped Project and repository rows                             | That read only                                             |

Before first dispatch, resolve the current `chats.project_id` and Project fields in the worker's tenant-scoped preparation transaction. Capture a versioned selection value containing either null or `{id, name, description, instructions, locator}`. Neutralize authored values for model contributions. A missing affiliation is a real null selection. A datastore error is not a null selection and fails preparation.

Append `run.project_bound` in the same fenced transaction that stores first-dispatch context and appends `model.requested`. Its versioned payload contains the complete selection, including null. Reuse `findFirstByType` to recover it. Append it only when no event exists for that Run, under the existing attempt fence. It is not a `model.requested` field because later segments append that event again.

On subsequent steps, segments, worker recovery, quota wake, and compaction continuation, use the event selection. If a legacy Run already dispatched without the event, do not invent a historic selection from current rows. The rollout drains those Runs before new workers execute them. Invalid stored selection data fails closed before a model request.

The event records an input decision, not a told cache. It never suppresses reminder emission. Only reconstructed text-bearing Project items do that. It stays in the existing Run event store, so there is no new column, table, or per-producer schema ownership. Owner SSE consumers must tolerate the event without treating it as assistant output or copying it to public projections.

This resolves the otherwise difficult case where a Run emits no snapshot because its context equals a predecessor's. The Run still has a durable selection after that predecessor leaves the active epoch.

Rejected alternatives are a `project_told` column, a current-row lookup on each retry, and a metadata-only fake reminder. The first duplicates transcript state. The second violates fixed-within-Run behavior. The third changes the meaning of historical inert context parts.

See [Project context binds when a Run starts execution](../../../docs/adr/2026-11-20-project-context-binds-at-execution.md) and [Project reminders derive told state from reconstructed context](../../../docs/adr/2026-11-20-project-reminders-derive-told-state-from-context.md).

### D3. Add one rail-only producer

Add the bundled `project` producer after `tool-availability` and before `workspace`. Producer order determines authored position, not instruction authority. Existing stored history never re-sorts.

Use a packaged Handlebars body under the existing Chat prompt directory. Values come from the selected context, not raw database records. Persist its final text and a versioned payload through the existing dispatch transaction. Payload fields contain the neutralized selected values needed for comparison, not repository rows, checkout locations, or unrelated owner data.

A bound snapshot states the Project ID, name, description, literal instructions, and locator. It labels identity and description as data. It labels instructions as additive owner guidance. It retires all earlier Project guidance, including instructions that were cleared. It makes no statement that the agent must enter or leave a Workspace.

Compare canonical rendered content with the latest own text-bearing item in reconstructed context after the active checkpoint. Ignore mere row timestamps and Run IDs during comparison. A payload version change requires an explicit comparison policy rather than treating unknown data as absent. Unchanged selected text emits no item.

An absence snapshot says that no Project applies and earlier Project guidance no longer applies. An unfiled Chat with no Project history emits nothing. When a checkpoint can contain older Project guidance, use surviving durable Project history to distinguish that case from a never-filed Chat. This historic-presence check is not the active-epoch told comparison and stores no extra state.

For an initial or between-turn compaction, establish the newly selected context for the very next model request. For mid-Run compaction, restore the existing Run selection. The summary instruction excludes Project snapshots. This exclusion is advisory, so every replacement or absence snapshot also explicitly retires earlier guidance that a summary can retain.

A failed dispatch transaction stores neither the selection event nor its item. A dispatched failed Run keeps its item. A same-Run retry restores its selection and compares effective history after reply-reset effects. Continue and Regenerate are new Runs, so they select current Project state and append supersession without rewriting accepted-turn history. An owner fork inherits literal parts but no Project affiliation or Run selection. Its next Run clears inherited guidance. Shared forks receive neither.

### D4. Additive guidance has no relative override rule

Personalization and Project instructions occupy the same authored-guidance level below operator constraints and explicit current-Chat requests. Both remain available when compatible. Scope labels let the model interpret them together. Frame unresolved contradictions as a reason to use the current request and ask only when the conflict matters.

This is model guidance, not a deterministic conflict resolver. Tests prove framing, retained contents, and the independent permission boundary. They cannot prove that a model always resolves contradictory prose correctly.

Do not add Project template paths to the top-level system prompt. The rail item remains visible even when an operator replaces that prompt, and the system-only prompt receipt remains system-only. The existing owner context display exposes the exact persisted item.

### D5. Project locators are database-backed Markdown documents

Use three resource forms:

| Locator               | Source                               |
| --------------------- | ------------------------------------ |
| `projects://`         | Active owner Projects                |
| `projects://archived` | Archived owner Projects              |
| `projects://<uuid>`   | One active or archived owner Project |

Accept `projects:///` as the root alias, ASCII-insensitive schemes, and case-insensitive UUIDs. Canonical output uses a lowercase scheme and UUID. Refuse other path forms, percent escapes, query strings, and fragments. Selectors remain suffixes under the native grammar, not query parameters.

Share one pure resource parser between dispatch and permission projection. Remove selectors before permission matching. Do not introduce a second consumer-maintained list of schemes. Expose acceptance through the current native read acceptance function, which prompt imports already query. Runtime registration can replace that implementation later under #1489.

Each listing entry contains only ID, name, description, archive state, and detail locator. Render authored line breaks as escaped scalar content, not extra records. Sort by name, then UUID, using deterministic code-point order.

A detail contains the current Project metadata and instructions. Sort repository links by alias and repository ID. Sort checkouts by executor identity, canonical locator, then checkout ID. Return each repository's ID, alias, display name, canonical remote, and primary flag. Return each owner's checkout ID, kind, parent ID, executor identity, and canonical location. Explicit nulls and empty sections describe absence without invented paths.

Render these sources as Markdown text rather than filesystem directory listings. Reuse native text representations, line count, ranges, context lines, raw reads, outline reads, output bounds, and advancing continuation notices. Every entry remains reachable. A later page observes current rows again, so there is no cross-read snapshot promise.

Use existing repositories inside one tenant transaction. Do not call an application service that opens a second transaction. Project detail reads join only repositories linked to that owned Project and checkouts owned by the same owner. A foreign Project and a missing Project both return `not_found`.

### D6. Checkout locations are information, not authority

The owner explicitly asked to expose registered locations so the agent can decide how to enter a Workspace. This is a narrow extension of model-visible path disclosure. It does not publish server configuration.

Local checkout locations are the stored absolute paths. Machine checkouts retain canonical `machine://<name>/<path>` locators and their executor identities. Never strip Machine authority into a host path. Return both main and worktree records, without a recommendation. Do not include other Chats' IDs, worktree lease owners, SSH connection parameters, daemon root configuration, or the worktree-base setting.

Mark the location section as registered and unverified. Read no directory, run no git command, and contact no Machine. Tool admission applies to the Project resource. Later location reads and Workspace entries undergo their own existing admission. Do not filter registrations by whether a future tool call can access them. Their presence grants nothing.

The renderer says that a Project association is separate from the Chat's current Workspace. It does not direct the agent to enter, stay, switch, ask for confirmation, or create a worktree. Existing tools and the operator policy remain the approval boundary.

### D7. Every consumer retains the same authority

Explicit native reads require ordinary `read` admission and current tenant identity. No native executor is needed. Automatic current-Project context does not call native `read` and does not depend on its eligibility or rules.

Prompt markers for Project locators follow the existing generic acceptance path. They use one admitted system-origin native read with existing budgets and import framing. Imported instructions remain reference data. No instruction-file trigger runs for a Project document or any checkout locator printed within it.

`edit` and `write` return `unsupported_operation` for Project resources. They never turn the locator into a local path or a Project mutation. Advertise the new read scheme in tool descriptions and locator references. Do not advertise Project context as another tool.

## Risks and trade-offs

| Risk                                                      | Treatment                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A live row edit changes half of a Run's policy            | A write-once execution selection survives all segments and recovery.                                                    |
| A reminder cache disagrees with effective history         | Compare only reconstructed own items, including surviving in-Run items.                                                 |
| Compaction preserves obsolete instructions in its summary | Exclude snapshots by instruction and explicitly supersede guidance after the checkpoint.                                |
| Another owner's UUID reveals private data                 | Owner-scoped transaction, existing forced RLS, not-found equivalence, and negative API/tool/datastore checks.           |
| Checkout paths expose infrastructure intent               | Permit only owner-registered locations in admitted details. Exclude configuration, credentials, and public projections. |
| Project prose forges context envelopes                    | Apply existing authored-text and rail neutralization before persistence.                                                |
| Large inventories consume model context                   | Metadata-only listings, detail reads on demand, and native line continuation.                                           |
| A Run event is mistaken for model output                  | Add explicit owner-stream handling and recovery tests for the private selection event.                                  |

Automatic Project context deliberately shares instructions with the configured model provider. The editor must explain that previous private context and provider requests retain earlier copies. Instructions are not a secret-storage channel. Metadata-only listings and path disclosure still require tenant isolation.

## Migration plan

1. Generate the additive nullable instructions migration and preserve existing enabled and forced RLS. Add no told-state storage or selection column.
2. Deploy API persistence and generated client changes. Old workers ignore the new instructions until the context layer ships.
3. Drain executing Runs before the worker cutover. Deploy workers that understand `run.project_bound`, the Project producer, and its private stream handling together. Queued but never-dispatched Runs select current state normally.
4. Deploy the real editor and remove the Context demo. Deploy the locator with its parser, permission projection, prompt-import coverage, and documentation as one layer.
5. Roll back workers only after new-revision Runs drain. Do not delete the added field, Run events, or stored context to roll back application code. Historical unknown producer text retains verbatim replay.

The implementation records one API/worker revision boundary for the new selection event. It does not reset databases or rewrite old migrations. No populated Chat is discarded.

## Verification

- API integration and datastore checks prove save, clear, length bounds, archive rejection, and cross-owner isolation. Include missing-identity and no-text-in-errors cases.
- A deterministic worker fixture queues under A, moves to B before preparation, dispatches under B, edits to C, and checks step, recovery, and compaction requests. No live-model quality assertion replaces this check.
- Repeat with unchanged context that emits no new item. Recovery must still use the bound selection after compaction.
- Exercise initial null selection, clear, delete, owner fork, Continue, Regenerate, steer, interrupt, and quota wake. Observe exact model messages and persisted event/item boundaries.
- Tool fixtures prove canonical admission, foreign not-found equivalence, registered local and Machine locations, no executor contact, mutation refusal, paging, and prompt-import data framing.
- Existing Storybook consumer stories prove durable editing, failure drafts, archived read-only behavior, and removal of fake Context controls. Replace demo-interaction assertions instead of preserving them.
- Focused product E2E proves save, reload, a Project-bound Chat, and model receipt of guidance. CI owns full suites and builds. Each shipping layer updates its docs and dated changelog entry.

## Revision history

- v1, 2026-11-20. Initial proposal from confirmed grilling decisions. Two proposed ADRs record execution binding and transcript-derived told state.

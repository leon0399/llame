# Design

## Context

See proposal.md for motivation. Current state that shapes the approach:

- No `POST /api/v1/chats` exists. `apps/api/src/chats/chats.controller.ts:265-272`
  states the rule in a comment: "Chats are created exclusively by their first
  message — there is no separate empty-chat endpoint." Creation is
  `POST /api/v1/chats/:id/messages` (`:273`) with a client-generated chat id,
  and its body is `CreateMessageDto` (`apps/api/src/chats/dto/chats.dto.ts:163-202`):
  `{modelId, effort?, permissionMode?, message: {id, parts}}`.
- Filing is a separate `PATCH /api/v1/chats/:id` (`updateChat`, `:386`).
  `chats.project_id` is a nullable foreign key with `ON DELETE SET NULL`
  (`apps/api/src/db/schema/chats.ts:109-113`), and the filing gate lives in the
  chats RLS `WITH CHECK` (`chats.ts:185-191`): a chat can only be filed into a
  project the caller owns.
- `projects` is owner-only with policy `projects_owner` and a hand-appended
  `FORCE ROW LEVEL SECURITY` in migration `0021`
  (`apps/api/src/db/schema/projects.ts:10-56`). `apps/api/src/projects/*`
  serves `POST`, `GET`, `GET :id`, `PATCH :id`, and `DELETE :id` on
  `/api/v1/projects`.
- The Workspace binding is `chats.workspace_root`, `workspace_executor_id`,
  `workspace_generation`, and the told columns
  (`apps/api/src/db/schema/chats.ts:151-178`), with six DB-checked detach
  reasons. `WorkspaceBindingRepository.enter`
  (`apps/api/src/chats/workspace-binding.repository.ts:37`) fences a Run: it
  requires `runId` and `deliverySequence` and answers `fence_lost` when the
  delivery is stale. Creation has no Run, so the fence cannot be reused as is.
- `enter_workspace` (`apps/api/src/tools/workspace.ts`) decides the submitted
  path before any probe (`:501-511`), records the canonical path decision
  (`:157-177`), and classifies both under `execute_code`.
- The `repositories` change supplies `repositories`, `checkouts`, and
  `worktree_leases`, the typed git methods on the local executor and on a
  Machine daemon, and `enter_workspace(path, worktree?)` with the directory
  rule, the generated name, and the `llame/<name>` branch rule. This design
  consumes those and changes none of them.
- Web: the root page creates a chat lazily at `/chat/<uuid>?draft=fresh`. The
  project page composer is rendered but disabled
  (`apps/web/app/(chat)/projects/[id]/project-prompt-input.tsx:8-35`, with
  `TODO(#1328)`).
- `GET /api/v1/chats/:id/stream` (`chats.controller.ts:136`) replays the active
  Run from persisted events, so a client can open the stream after a create
  call. The enqueue behind it is fail-fast and idempotent per chat
  (`openspec/specs/durable-runs/spec.md`, "Enqueue is fail-fast and
  self-healing", "One in-flight run per chat (single-flight)").
- The `workspace` context producer already narrates the binding as a
  rail-resident item (`openspec/specs/context-injection/spec.md`, "Workspace
  binding changes are rail-resident context items").

Decision provenance is the grilling record behind the
[project, repository, and machine association study](../../../docs/research/product-vision/2026-10-24-project-repository-machine-association.md).

## Goals / Non-Goals

**Goals:**

- One request that cannot leave a chat half-created: the record, its project,
  and its Workspace agree, or the chat is filed and unbound.
- A location that the server resolves, not the model, and a client that never
  guesses.
- A composer that shows the resolved root before the send and needs no clicks
  in the common case.

**Non-Goals:**

- A second binding write path for Runs. Run-time binding stays the property of
  `enter_workspace` and `exit_workspace`.
- Changing the durable Run model, its enqueue contract, or its single-flight
  rule.
- Provisioning a clone. This change binds checkouts the owner already
  registered; cloning belongs to a later change.
- Project sharing, per-user Machine ownership, and multi-repository composite
  roots.

## Prior art

Session-creation shapes in peer harnesses and their treatment of location:

| Product           | Creation shape                                                                                                    | Location at creation                                               | Followed or rejected                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ACP               | `session/new {cwd, mcpServers, additionalDirectories?}`                                                           | `cwd` is a create parameter                                        | Followed: the location is an input of creation                                                                                                               |
| OpenCode          | `POST /session` with `x-opencode-directory`                                                                       | directory travels with the create call                             | Followed                                                                                                                                                     |
| Codex             | `thread/start {cwd, sandbox, approvalPolicy}`                                                                     | `cwd` plus policy at create                                        | Followed                                                                                                                                                     |
| bb                | `POST /threads {projectId, environment, input}`                                                                   | project and environment at create; `input` can be empty            | Followed: one request, optional input                                                                                                                        |
| Emdash            | `createTask` writes host state first, then one transaction, and provisions the worktree in the background         | chosen before create; a `provision-failed` stage lands on the task | Partly followed: the failure stage becomes the `workspace` status field; the background worktree is rejected as a second state machine                       |
| Synara            | `thread.create` returns a `worktree-pending` thread                                                               | chosen at create, but the Run waits behind a gate                  | Rejected: a created chat that cannot run yet is the failure this change removes                                                                              |
| Open WebUI        | `POST /api/v1/chats/new`                                                                                          | none                                                               | Rejected for located chats; kept as the shape of the unchanged first-message path                                                                            |
| Vercel ai-chatbot | lazy creation on the first message                                                                                | none                                                               | This is the current llame shape; kept only for clients that send no location                                                                                 |
| herdr             | `herdr worktree create --branch --base --path --label` with generated `worktree-<adjective>-<noun>-<4 hex>` names | explicit at create                                                 | Followed for naming (change 1 owns the rule); rejected for the default `worktree-` prefix, since the directory already sits under `.llame-worktrees/<repo>/` |

Composer and entry-point shapes:

| Surface                    | How location is chosen                                            | Followed or rejected                                                    |
| -------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| bb                         | only through the create call; no in-product picker                | Followed: the create request carries resolved ids                       |
| Emdash task creation       | a form picks project and worktree before create                   | Followed as the chip cascade                                            |
| Synara                     | pending gate after create                                         | Rejected                                                                |
| Open WebUI, ai-chatbot     | no location                                                       | Rejected for located chats                                              |
| ACP, OpenCode, Codex       | the host supplies the directory; the product resolves the default | Followed: one resolved default with an override, shown as a single chip |
| llame project page (#1328) | disabled composer                                                 | Replaced: the composer sends and creates in one call                    |

## Decisions

### D8. Project repositories: a link with an alias, one primary, and an isolation policy (Q13 A, Q8 B, Q14 A, Q22 A, Q24 A, Q28 A)

Schema:

- `project_repositories(project_id, repository_id, alias, is_primary, isolation)`
  with unique `(project_id, repository_id)` and a partial unique
  `(project_id) WHERE is_primary`. `isolation` is `inherit`, `always_worktree`,
  or `never`, default `inherit`.
- Per-executor defaults: `project_repository_defaults` with
  `(project_repository_id, executor_id, checkout_id, updated_at)` and a unique
  key on the first two columns. `checkout_id` must be a `main` checkout of that
  repository on that executor. The row is written from the last successful chat
  start, and each write replaces `updated_at`.
- Both edges of a defaults row cascade on delete: the foreign key to the link
  and the foreign key to the checkout. A deleted checkout and an unlinked
  repository therefore leave no default behind.
- `projects.default_executor_id`, nullable, no foreign key to Machine status.
- Deleting a project cascades links and defaults only. Chats keep their path
  strings, because the existing per-attempt re-check owns detachment.

API: `POST` and `DELETE` on
`/api/v1/projects/:id/repositories`, `PATCH` on
`/api/v1/projects/:id/repositories/:repositoryId` with `alias`, `isPrimary`,
and `isolation`, and `PATCH /api/v1/projects/:id` with `defaultExecutorId`.
Every write to an archived project answers 409 and changes nothing, as
canonical `projects` already requires.
RLS comes from project ownership: the policy admits a row only when the caller
can read the parent project under `projects_owner`, the same shape the chats
filing gate already uses. Negative tests cover reads and writes by a second
owner.

Rationale: the checkout path is a fact about a machine, so change 1 records it
once on the repository. A project-specific preference is therefore a small
defaults row, not a duplicated path. Two projects can share one clone or
default to separate clones. A moved clone is a one-row update. A repository is
optional at every level, so a notes-only project and an unbound project chat
both work.

Alternatives:

- A: the link table above (chosen).
- B: a single `projects.repository_id` column. One project cannot span two
  repositories, a multi-repo project needs duplicate projects, and the path
  preference has no home.
- C: derive project identity from the checkout path, as Emdash, Jean, Synara,
  and AO do. A project cannot span machines, and moving or renaming a path
  renames the project.
- Q8 A (require one repository per project): rejects a notes project and
  forces a catalog entry before the project exists.
- Q14, Q22, Q24: chosen A, the isolation policy on the link only, with a
  concurrency hint for `inherit`. B, always a worktree, surprises a single chat
  and breaks a build that mutates the clone. C, only a per-chat toggle, has no
  project intent and leaves fork and entry paths without a rule.
- The per-executor defaults chain came from the chat-start UX discussion on
  2026-10-24, not from a numbered question. One link can hold a defaults row
  per executor, so resolution reads the row most recently written
  (`updated_at`); the first catalog row would be nondeterministic across
  machines.
- Q28: chosen A, the project page. B, a global Settings repository page, adds
  a second surface for the same rows, and registration only matters relative
  to a project.

### D9. One create request that resolves, authorizes, and binds before the first Run (Q6 A, Q6b', Q13 A, Q25 A)

`CreateChatRequest` is its own OpenAPI schema, distinct from
`CreateMessageDto`, and shares only the message-parts schema. The message
carries its own client id, because the enqueue path admits a turn by
`message.id` and the web client compares the stored id with its optimistic
entry. The server reuses `CreateMessageBodyDto` for `{id, parts}`.

```text
{ id: uuid (client), projectId?, repositoryId?, executorId?, checkoutId?,
  worktree?: { name?, baseRef? },
  message?: { id: uuid, modelId, effort?, permissionMode?, parts } }
```

Server order:

1. Validate, with no write yet. When `message` is present, the model, the
   effort, the permission mode, the parts, and the media ownership are checked
   as the message route checks them. A `bypass` mode that this process's
   `tools.permissionModes` does not enable answers 422. Any failure stores
   nothing.
2. Validate the named ids and insert the chat row with `project_id` set, in one
   transaction. Every named id (project, repository, executor, checkout) is
   read under owner RLS. A foreign or missing id answers 404 and stores
   nothing, so another owner's row and a deleted row get one answer. An
   archived project answers 409 and stores nothing. The RLS filing gate
   rejects a project the caller does not own.
3. Resolve the location. Repository: the request, else the link marked
   primary, else the only linked repository, else none. Executor: the request,
   else the defaults row most recently written for that link, else
   `projects.default_executor_id`, else the only executor that holds a `main`
   checkout of the repository, else the lowest executor id. Checkout: the
   request, else the defaults row for that link and executor, else the only
   `main` checkout on that executor, else none. The implicit steps skip an
   offline Machine. An explicit `executorId`, or a defaults row, that names an
   offline Machine answers `machine_unavailable`. A local executor is this
   process's `tools.nativeExecutorId`, and it is never offline. Several linked
   repositories with no primary and no request answer none; the chat is
   created unbound. The server never picks a primary.
4. Authorize the Workspace. Canonicalize the source checkout on its executor
   through change 1's typed methods, then take the submitted path decision
   (the source clone) and the canonical path decision (the computed worktree
   directory when the request asks for a worktree, else the checkout). The
   mode is `message.permissionMode`, and `default` when the request omits it,
   evaluated against this process's config. Both decisions run in
   `enter_workspace`'s permission group. The step applies the availability
   gates too: `enter_workspace` must be in `tools.allowed`, and a local root
   needs `tools.nativeExecutorId` to equal the resolved executor id. Creation
   records no decision, because it has no Run and no open tool call; the first
   Run attempt re-checks the binding and records its own decision then. This is
   a server-owned action: no tool call, no model choice, no Run.
5. Create the worktree when `worktree` is present, through change 1's method
   with the registered `main` checkout as the source. Names, branches, base
   refs, the directory rule, the registered-root check, and the lease row are
   change 1's rules unchanged. Adoption does not run, because the source
   checkout is registered.
6. Store the binding: `workspace_root`, `workspace_executor_id`, and
   `workspace_generation + 1`, for the worktree path when one was created and
   for the checkout path otherwise.
7. Store the message and enqueue the first Run when `message` is present,
   through the existing durable enqueue, in the message transaction. The create
   response is JSON, so the call does not stream; the client opens
   `GET /api/v1/chats/:id/stream`, which replays the Run from its persisted
   events.

On a failure in steps 4, 5, or 6 the chat stays filed and unbound. The response
carries `workspace: {status, root?, executorId?, worktree?, code?, message?}`,
and `status` comes from one closed set: `bound`, `unbound`, `bind_failed`,
`worktree_failed`, `machine_unavailable`, `machine_update_required`. `bound`
names `root`, `executorId`, and for a worktree `{path, branch, baseCommit}`.
`unbound` means that no location resolved; the message is stored and the Run
starts. A failure stores no binding and no message, enqueues no Run, and writes
no defaults row.

- `bind_failed` carries `code` `permission_denied` when a path decision rejects
  the submitted or the canonical path, `tool_not_allowed` when
  `enter_workspace` is not in `tools.allowed`, and `executor_unavailable` when
  a local root has no native executor or the resolved executor is not
  configured.
- `worktree_failed` carries `code` `not_a_repository`, `timeout`, or
  `path_not_registered` from the worktree step. Other git failures carry the
  git standard error and no code.
- `machine_unavailable` covers an offline Machine, and
  `machine_update_required` a daemon without the typed git methods.

When step 6 fails after step 5 created a worktree, the call removes the new
worktree and deletes its checkout and lease rows, so no lease names a chat that
does not use it. A retry of the same create replays the recorded worktree
result instead of creating a second one.

A second create with a stored `id` answers 409 when that chat holds a message.
A same-owner create on a stored chat that holds no message re-runs validation,
resolution, the worktree step (an existing binding to the same root is a
no-op), and the message step, and answers 201: this is the resend after a
failed location. A stored id of another owner answers 404, as the first-message
route does, so the id reveals nothing. When the enqueue of step 7 fails, the
response is 5xx, no message is stored, the chat and its binding stay, and a
retry with the same id is allowed. The first-message route
`POST /api/v1/chats/:id/messages` is untouched.

The `workspace-entry` MODIFIED block in this change is written against the
`repositories` change's delta text for "The Workspace binding is Chat-scoped
and persists across Runs". Finalize re-bases it on the canonical requirement
before sync. Creation is the second binding writer that the block names.

Alternatives:

- Q6 A (chosen): one create request. B: create empty, then patch the location,
  then post the message. The client would orchestrate the order, three round
  trips would let a retry duplicate the chat, and a client bug would leave the
  steps out of order. C: add location fields to `POST /chats/:id/messages`.
  The create-or-append route would carry two contracts, and that route exists
  to serve lazy clients.
- Q6b' (chosen: an optional `message`). It settles the failure boundary: a
  failed bind or worktree keeps the filed chat and answers 201 with the
  `workspace` status. A, a required message: "New chat in project" and the
  deep link could not pre-create a chat, and an empty chat would still be
  impossible. B, a separate message call: one empty-chat window with no Run, a
  second failure surface, and no place to report the failing step in one
  answer.
- Reusing `WorkspaceBindingRepository.enter`: it fences a Run
  (`workspace-binding.repository.ts:37`), so a create call would need a
  synthetic `runId`. Chosen: extract the decision and binding write into a
  Run-free server path and leave `enter` unchanged for tools.
- Binding inside the first Run: this is the current behavior and it lets the
  model choose the location, which is the problem this change solves.
- Streaming from the create call: the failure field has no place before the
  stream starts, and the client would have to parse a stream to learn whether
  the chat was bound.

### D10. One chip, one cascade, and reasons in the labels (Q13, Q14, Q8 visibility, Q20)

The composer shows one editable chip with the resolved bound root:

```text
llame development · llame · nas · ~/src/llame (master)
llame development · llame · nas · ~/.llame-worktrees/llame/clear-field-0192
  (llame/clear-field-0192 ← master)
```

A click opens one popover with the cascade as stacked selects: project,
repository (only when the project has more than one), machine (an offline
machine is disabled with its reason), source checkout (only when the executor
holds more than one `main` checkout), isolation, then base ref and name. A
change at one level recomputes the levels below from their defaults.

Isolation defaults to the link policy: the policy selects the default that the
composer shows. Under `inherit`, another open chat that already binds the
source checkout turns it on. The request's `worktree` field decides the
outcome; the per-chat toggle sets that field, and its label names the reason.
The labels read `worktree (project policy)`, `worktree (clone in use by 1
chat)`, and `reuse (project policy)`. A step that cannot resolve renders the
chip in a warning state that names it, for example a missing primary. The
warning state also names a Machine whose daemon lacks the typed git methods,
which answers `machine_update_required`. Sending still works and creates the
chat filed and unbound.

Entry points pre-fill the chip: the project page composer, sidebar "New chat in
project", "New chat here" on an existing chat, and the deep link
`/chat/new?project=&repository=&executor=&checkout=&worktree=1`. "New chat
here" copies project, repository, executor, and checkout, and turns isolation
on, because the source chat holds the tree. The chat header shows the same chip
read-only from the binding.

The project page's "Repositories" section is the editing surface for D8: link
and unlink a repository, set the primary, alias, and isolation policy, register
a checkout by executor and path, and list the project's worktrees with the
owning chat and a guarded Remove button. The repository catalog appears only as
the picker inside this section.

Alternatives:

- A form with labelled selects above the composer: permanently costs vertical
  space for a decision most chats never change.
- A modal wizard before every send: adds a step to the common case that the
  server can already resolve.
- A read-only summary: leaves the post-create `enter_workspace` path as the
  only way to correct a location, which is the behavior being replaced.

### D11. No new model announcement

The `workspace` producer already narrates a binding change as a rail-resident
item on the first accepted turn, and creation bumps the binding generation, so
the existing item fires by itself. A creation-time item would state the same
fact twice in the first Run and spend tokens on it.

Alternatives: a new `location` producer item would duplicate the `workspace`
item and then need a deduplication rule against it. A system-prompt sentence
would break the existing pattern that the harness narrates state through the
rail, not the prompt.

## Risks / Trade-offs

- [A stale selection between compose and send] → the server re-resolves and
  validates before any write; a named id that the owner cannot see answers 404
  and stores nothing, and an offline Machine answers `machine_unavailable`,
  never a guessed fallback.
- [Double creation on a retry] → the client uuid is the idempotency key; a
  create on a chat that holds no message re-runs the location step and answers
  201, and one on a chat that holds a message answers 409; the composer keeps
  one id per draft.
- [An offline Machine at creation] → the machine option is disabled with its
  reason, and a forced create answers `machine_unavailable` with the chat left
  filed.
- [A crash between the chat insert and the binding] → the chat stays filed and
  unbound, the header chip shows the warning, and the owner resends with the
  same id or enters a Workspace later.
- [A filed, unbound chat with no Run] → the header chip shows the warning, the
  sidebar lists the chat, and the owner resends or enters a Workspace later.
- [The chip hides the real path] → the chip always prints the resolved root and
  the worktree branch, and the cascade shows why a worktree was chosen.
- [Cross-owner link access] → links and defaults are visible only through the
  owning project's RLS; negative tests cover reads, writes, and the primary
  update.
- [Project deletion with bound chats] → links and defaults cascade, while chats
  keep their path strings and detach only through the existing per-attempt
  re-check.
- [Worktree creation is synchronous] → a slow `git worktree add` delays the
  create response; the per-call timeout bounds it, and a failed add is the
  `worktree_failed` status, not a lost chat.

## Migration Plan

- Entry requires the `repositories` change to be merged through its finalize:
  its tables, `enter_workspace` worktree option, and typed git methods are
  prerequisites.
- Two new tables with `ENABLE` and hand-appended `FORCE ROW LEVEL SECURITY`,
  and one nullable column `projects.default_executor_id`. No backfill: no links
  exist before this change, and a project without a repository keeps working.
- API and web additions are additive. `POST /api/v1/chats/:id/messages`,
  `PATCH /api/v1/chats/:id`, and the project routes keep their contracts.
- Rollback withdraws the web entry points and the create route, then drops the
  two tables and the column. Existing chats keep `workspace_root` and
  `workspace_executor_id`; a removed worktree directory detaches at the next
  attempt as `root_missing`, which the existing CHECK already allows.
- Layer order inside the stack: `project-links-api` migrates and serves the
  link, defaults, and default-executor routes, `project-links-ui` renders them,
  `chat-creation` writes defaults and bindings, and the two composer layers
  write only through the create route.
- The `specs/workspace-entry/spec.md` MODIFIED block is written against the
  `repositories` change's delta text. Finalize re-bases it on the canonical
  requirement, then syncs it with `chat-creation` and `projects`.

## Open Questions

- Whether the composer should also offer an inline "register checkout"
  affordance. Today the project page owns registration, and the composer links
  to it.
- Whether the chip labels a Machine by its configured name or by a display
  name, if Machine display names arrive later. The executor id is the stable
  key either way.

# Design

## Context

See proposal.md for motivation. Current state that shapes the approach:

- No `POST /api/v1/chats` exists. `apps/api/src/chats/chats.controller.ts:265-272`
  states the rule in a comment: "Chats are created exclusively by their first
  message — there is no separate empty-chat endpoint." Creation is
  `POST /api/v1/chats/:id/messages` (`:273`), with a client-generated chat id.
  Its body is `CreateMessageDto`
  (`apps/api/src/chats/dto/chats.dto.ts:163-202`):
  `{modelId, effort?, permissionMode?, message: {id, parts}}`.

- The file action is a separate `PATCH /api/v1/chats/:id` (`updateChat`, `:386`).
  `chats.project_id` is a nullable foreign key with `ON DELETE SET NULL`
  (`apps/api/src/db/schema/chats.ts:109-113`). The file gate lives in the
  chats RLS `WITH CHECK` (`chats.ts:185-191`): the caller can file a chat only
  into a project that the caller owns.

- `projects` is owner-only with policy `projects_owner` and a hand-appended
  `FORCE ROW LEVEL SECURITY` in migration `0021`
  (`apps/api/src/db/schema/projects.ts:10-56`). `apps/api/src/projects/*`
  serves `POST`, `GET`, `GET :id`, `PATCH :id`, and `DELETE :id` on
  `/api/v1/projects`.

- The bound Workspace root is `chats.workspace_root`, `workspace_executor_id`,
  `workspace_generation`, and the told columns
  (`apps/api/src/db/schema/chats.ts:151-178`), with six DB-checked detach
  reasons. `WorkspaceBindingRepository.enter`
  (`apps/api/src/chats/workspace-binding.repository.ts:37`) fences a Run. It
  requires `runId` and `deliverySequence`, and it answers `fence_lost` when the
  delivery is stale. Creation has no Run, so the fence cannot be reused as is.

- `enter_workspace` (`apps/api/src/tools/workspace.ts`) decides the submitted
  path before any probe (`:501-511`). It records the canonical path decision
  (`:157-177`), and it classifies both under `execute_code`.

- The `repositories` change supplies `repositories`, `checkouts`, and
  `worktree_leases`. It supplies the typed git methods on the local executor
  and on a Machine daemon. It supplies `enter_workspace(path, worktree?)` with
  the directory rule, the generated name, and the `llame/<name>` branch rule.
  This design consumes those and changes none of them.

- Web: the root page creates a chat lazily at `/chat/<uuid>?draft=fresh`. The
  project page composer is rendered but disabled
  (`apps/web/app/(chat)/projects/[id]/project-prompt-input.tsx:8-35`, with
  `TODO(#1328)`).

- `GET /api/v1/chats/:id/stream` (`chats.controller.ts:136`) replays the active
  Run from persisted events. A client can therefore open the stream after a
  create call. The enqueue behind it is fail-fast and idempotent per chat
  (`openspec/specs/durable-runs/spec.md`, "Enqueue is fail-fast and
  self-healing", "One in-flight run per chat (single-flight)").

- The `workspace` context producer already narrates the bound root as a
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

- A second write path for the bound root during Runs. The run-time bound root stays the property of
  `enter_workspace` and `exit_workspace`.

- A change to the durable Run model, its enqueue contract, or its single-flight
  rule.

- A provisioned clone. This change binds checkouts that the owner already
  registered. A clone belongs to a later change.

- Shared projects, per-user Machine ownership, and multi-repository composite
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

- `project_repositories(owner_user_id, project_id, repository_id, alias,
is_primary, isolation)` with unique `(owner_user_id, project_id,
repository_id)` and a partial unique `(owner_user_id, project_id) WHERE
is_primary`. `isolation` is `inherit`, `always_worktree`, or `never`, default
  `inherit`.

- Per-executor defaults: `project_repository_defaults(owner_user_id,
project_repository_id, executor_id, checkout_id, updated_at)` with a unique
  key on `(owner_user_id, project_repository_id, executor_id)`. `checkout_id`
  must be a `main` checkout of that repository on that executor. The row is
  written from the last successful chat start, and each write replaces
  `updated_at`. A worktree start records its source `main` checkout.

- Every row carries `owner_user_id` with composite owner foreign keys:
  `(owner_user_id, project_id)` to `projects`, `(owner_user_id,
repository_id)` to `repositories`, `(owner_user_id, checkout_id)` to
  `checkouts`, and `(owner_user_id, project_repository_id)` to the link. Each
  parent needs its `(owner_user_id, id)` unique key: this change adds it to
  `projects` and to the link table, and change 1 already declares it on
  `repositories` and `checkouts`. `ON DELETE CASCADE` is defined only on these
  composite edges, because a foreign-key check bypasses row-level security. A
  deleted checkout, an unlinked repository, and a deleted project therefore
  leave no default behind. Chats keep their path strings, because the current
  per-attempt re-check owns detachment.

- `chat_creation_records(owner_user_id, chat_id, attempts jsonb, created_at)`
  with a composite owner foreign key to `chats`, FORCE RLS, and one row per
  chat. `attempts` holds one entry per create or resend, and each entry carries
  its decisions and its own `created_at`. It is the owner-only record of every
  create attempt on the chat.

- `projects.default_executor_id`, nullable, no foreign key to Machine status.

- A project delete cascades links and defaults only.

API reads: `GET /api/v1/projects/:id/repositories` returns every link with its
alias, `is_primary`, `isolation`, and its defaults rows with `updated_at`.
`GET /api/v1/projects/:id/start-location` with `repositoryId`, `executorId`,
and `checkoutId` returns the resolution without effects: repository, executor,
checkout, and the isolation default with its reason. `GET
/api/v1/chats/:id/creation-record` returns the creation record of an owner's
chat. The composer reads the first two routes, so the chip shows the root the
server will resolve.

API writes: `POST` and `DELETE` on `/api/v1/projects/:id/repositories`,
`PATCH` on `/api/v1/projects/:id/repositories/:repositoryId` with `alias`,
`isPrimary`, and `isolation`, and `PATCH /api/v1/projects/:id` with
`defaultExecutorId`. Every write to an archived project answers 409 and changes
nothing, as canonical `projects` already requires.

RLS comes from project ownership: the policy admits a row only when the caller
can read the parent project under `projects_owner`, the same shape the chats
file gate already uses. The owner column exists for the composite foreign
keys, not as a second policy. Negative tests cover reads, writes, and a link or
defaults row that names another owner's repository or checkout, which the
database refuses with `23503`.

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
  and AO do. A project cannot span machines, and a move or a rename of a path
  renames the project.

- Q8 A (require one repository per project): rejects a notes project and
  forces a catalog entry before the project exists.

- Q14, Q22, Q24: chosen A, the isolation policy on the link only, with a
  concurrency hint for `inherit`. B, always a worktree, surprises a single chat
  and breaks a build that mutates the clone. C, only a per-chat toggle, has no
  project intent and leaves fork and entry paths without a rule.

- The per-executor defaults chain came from the chat-start UX discussion on
  2026-10-24, not from a numbered question. One link can hold a defaults row
  per executor. So resolution reads the row that was written most recently
  (`updated_at`). The first catalog row is nondeterministic across machines.

- Q28: chosen A, the project page. B, a global Settings repository page, adds
  a second surface for the same rows, and registration only matters relative
  to a project.

### D9. One create request that resolves, authorizes, and binds before the first Run (Q6 A, Q6b', Q13 A, Q25 A)

`CreateChatRequest` is its own OpenAPI schema, distinct from
`CreateMessageDto`. It shares only the message-parts schema. `message` is a
`CreateChatMessageDto { id, parts, modelId, effort?, permissionMode? }`: it
composes the message-parts schema and does not reuse `CreateMessageBodyDto`,
which declares only `id` and `parts`. A field typed as that class rejects
`message.modelId` under a strict whitelist. The message carries its own client
id, because the enqueue path admits a turn by `message.id`.

```text
{ id: uuid (client), projectId?, repositoryId?, executorId?, checkoutId?,
  worktree?: { name?, baseRef? },
  message?: { id: uuid, parts, modelId, effort?, permissionMode? } }
```

Server order:

1. Validate, with no write yet. When `message` is present, the server
   validates the model, the effort, and the permission mode. It validates the
   parts and the media ownership as the message route does. A `bypass` mode
   that this process's `tools.permissionModes` does not enable answers 422. A
   `worktree.name` or `baseRef` that fails change 1's input rules answers 422.
   Any failure stores nothing.

2. Take the per-chat session advisory lock. `pg_try_advisory_lock` runs on the
   chat id, on one dedicated connection, and stays held for the whole request.
   The lock is released at the end of the request, or when that connection
   ends. A concurrent create with the same id answers 409 `creation_in_progress`
   and changes nothing. The steps keep their separate transactions, because the
   session lock spans all of them.

   The message route takes the same key with `pg_try_advisory_xact_lock` inside
   its admission transaction. A held lock answers 409 `creation_in_progress`.
   One shared function derives the key for both routes.

   The org-unit locks use `hashtextextended(<id>::text, 0)`
   (`apps/api/src/db/migrations/0019_wealthy_violations.sql:241`). The creation
   key therefore uses a different seed, or a two-key form that names the lock
   family. A session lock and a transaction lock on one key conflict across
   sessions, so the two routes must not share a key by accident. The message
   route holds the lock only for its admission transaction, not for its stream.
   It therefore never blocks a later create for the life of a Run.

3. Validate the named ids and insert the chat row with `project_id` set, in one
   transaction.

   - `projectId`, `repositoryId`, and `checkoutId` are read under owner RLS
   - A foreign or missing id answers 404 and stores nothing, so another owner's
     row and a deleted row get one answer
   - An archived project answers 409
   - `executorId` is configuration, not an owner row
   - An id that no configured executor carries answers 422 `executor_unknown`
   - A named `checkoutId` fixes its repository and its executor
   - It must be a `main` checkout
   - A `repositoryId` or `executorId` that conflicts answers 422
   - A `repositoryId` that the project does not link answers 422
   - A `checkoutId` whose repository the project does not link answers 422
   - Explicit ids always override remembered defaults

4. Resolve the location.

   - Repository: the request's `repositoryId`, else the primary link, else the
     single link, else none
   - Executor: the request, else the remembered default of the link
   - Else `projects.default_executor_id`, else the only executor that holds a
     `main` checkout of the resolved repository
   - Else the online executor with the lowest id that holds a `main` checkout of
     the resolved repository
   - Checkout: the request, else the remembered default for the link and
     executor
   - Else the only `main` checkout of the resolved repository on that executor,
     else none
   - The implicit steps skip an offline Machine
   - An explicit `executorId`, a named `checkoutId`, or a remembered default
     that names a configured offline Machine answers `machine_unavailable`
   - A local executor is this process's `tools.nativeExecutorId`, and it is
     never offline
   - Several linked repositories with no primary and no request answer none
   - The chat is then created unbound
   - The server never picks a primary
   - The projects delta owns the defaults rule, "Project repository defaults
     remember the last chosen checkout per executor"

5. Authorize the Workspace through change 1's decision function, in the order
   of `enter_workspace`.

   1. The submitted checkout path, before any filesystem probe.
   2. The canonical source clone by realpath, before any git call.
   3. The inspected main tree, after the read-only `git.inspect` and
      before any write.
   4. The canonical worktree directory, before `git.worktreeAdd`.

   - The mode is `message.permissionMode`, and `default` when the request omits
     it, evaluated against this process's config
   - Every decision runs in the `enter_workspace` permission group
   - The step appends one attempt, with every decision, when the first path
     decision runs
   - The attempt commits in its own transaction, before any git write, and it
     stays when a later step fails
   - A request that fails validation, answers 404 or 409, or resolves no
     location appends no attempt
   - The step applies the availability gates too
   - `enter_workspace` must be in `tools.allowed`
   - A local root needs `tools.nativeExecutorId` to equal the resolved executor
     id
   - A missing allowlist entry answers `bind_failed` with `tool_not_allowed`
   - That is the same code that the registration routes use
   - A missing native executor answers `executor_unavailable`
   - This is a server-owned action: no tool call, no model choice, no Run

6. Create the worktree when `worktree` is present, through change 1's rules,
   with the registered `main` checkout as the source and no Run fence. The call
   runs `git.worktreeAdd` under the step 2 lock. The worktree checkout row, its
   lease row, and the bound root then commit in one transaction. The lease names
   the chat and its worktree checkout, so one creation lease exists per chat.
   Adoption does not run, because the source checkout is registered. The step 5
   attempt records the canonical worktree directory before `git.worktreeAdd`.
   When the add succeeds and the transaction rolls back, the attempt stays. A
   resend reads that directory from the attempt and does not run
   `git.worktreeAdd` again. It answers `outcome_unknown` with `leftDirectory`
   set to the recorded directory.

7. Store the bound root: `workspace_root`, `workspace_executor_id`, and
   `workspace_generation + 1`, for the worktree path when one was created and
   for the checkout path otherwise. The writer stores the binding only when the
   chat holds no message and no Run. Otherwise the create answers 409 and stores
   no binding.

8. Store the message and its Run row when `message` is present. Both rows
   commit together, as on the message route. The enqueue runs after that
   commit. An enqueue failure fails the Run and answers 5xx, and the message
   stays. The create response is JSON, so the call does not stream. The client
   opens `GET /api/v1/chats/:id/stream`, which replays the Run from its
   persisted events.

9. Record the defaults after a successful bind: the source `main` checkout for
   the link and executor. A worktree start records its source and not the new
   worktree. The write runs after the commit, it is best-effort, and the last
   write wins. A failed write MUST NOT fail the create and MUST NOT change the
   response, the binding, the message, or the Run. The previous defaults row
   stays. The alternative is to join the bind transaction, and the design does
   not take it.

On a failure in steps 5, 6, or 7 the chat stays filed and unbound. The response
carries `workspace: {status, root?, executorId?, worktree?, code?, message?}`,
and `status` comes from one closed set: `bound`, `unbound`, `bind_failed`,
`worktree_failed`, `machine_unavailable`, `machine_update_required`,
`outcome_unknown`.

`bound` names `root`, `executorId`, and for a worktree
`{path, branch, baseCommit}`. `unbound` means that no location resolved. When
the request carries `message`, the message is stored and the Run starts. A
failure stores no bound root and no message, enqueues no Run, and writes no
defaults row. `code` is present only on the two statuses that carry one:

- `bind_failed` carries `permission_denied` for a rejected decision,
  `tool_not_allowed` for a missing allowlist entry, `executor_unavailable` for
  a missing native executor, and `not_found` for a source that disappeared.
- `worktree_failed` carries `path_not_registered` outside a Machine root.
  Every other git failure carries the git standard error in `message` and no
  `code`.
- `machine_unavailable` covers an offline Machine, and
  `machine_update_required` a daemon without the typed git methods.
- `outcome_unknown` means the Machine link dropped after `git.worktreeAdd` was
  sent. It carries `leftDirectory` when known, and the step wrote no rows.

A create on a stored chat that holds a message answers 409. A same-owner create
on a stored chat that holds no message is the resend: it re-runs validation,
resolution, and the message step, and answers 201. A resend reuses the creation
lease and the bound root of this chat when they exist, and it never creates a
second worktree.

An enqueue failure frees the single-flight slot of the failed Run. The client
then sends the draft again as a new message, with a new `message.id`, through
`POST /api/v1/chats/:id/messages`.

A resend into an archived chat or an archived project answers 409 and changes
nothing. A resend whose `projectId` differs from the stored chat's project
answers 409 `project_mismatch`. A stored id of another owner answers 404, as the
first-message route does, so the id reveals nothing.

A crash between `git.worktreeAdd` and the step 6 commit leaves a directory and
no rows. The owner API does not list that directory, and the owner removes it by
hand. The next resend creates a new worktree, because no creation lease exists.

The `workspace-entry` MODIFIED block in this change is written against the
`repositories` change's delta text for "The Workspace binding is Chat-scoped
and persists across Runs". Finalize re-bases it on the canonical requirement
before sync. Creation is the second writer of the bound root that the block names. When
it establishes the bound root, that bound root counts as an entry that
establishes a bound root, so the generation increments once.

Alternatives:

- Q6 A (chosen): one create request. B: create empty, then patch the location,
  then post the message. The client orchestrates the order. Three round trips
  let a retry duplicate the chat, and a client bug leaves the steps out of
  order. C: add location fields to `POST /chats/:id/messages`. The
  create-or-append route then carries two contracts, and that route exists to
  serve lazy clients.

- Q6b' (chosen: an optional `message`). It settles the failure boundary: a
  failed bind or worktree keeps the filed chat and answers 201 with the
  `workspace` status. A, a required message: "New chat in project" and the
  deep link cannot pre-create a chat, and an empty chat stays impossible.
  B, a separate message call: one empty-chat window with no Run, a second
  failure surface, and no place to report a failed step in one answer.

- A reuse of `WorkspaceBindingRepository.enter`: it fences a Run
  (`workspace-binding.repository.ts:37`), so a create call needs a synthetic
  `runId` and a tool call id. Chosen: a Run-free creation path through
  `WorkspaceBindingRepository.bindAtCreation(tx, { chatId, ownerUserId, executorId, root })`.

  The writer takes the caller's transaction, which runs under `runAs(owner)`.
  It locks the chat row. It requires no message and no Run on the chat. It
  requires the chat to be unbound, or bound to the root of its own creation
  lease, which is the resend case. It sets the root and the executor with
  `workspace_generation + 1`. It never takes a synthetic Run and never writes an
  unscoped update.

  The create request takes the chat's session advisory lock on one dedicated
  connection. It writes its own lease keyed by the chat. It commits the worktree
  rows and the bound root in one transaction. `enter` stays unchanged for tools.

- A bind inside the first Run: this is the current behavior and it lets the
  model choose the location, which is the problem this change solves.

- A stream from the create call: the failure field has no place before the
  stream starts, and the client must parse a stream to learn whether the chat
  was bound.

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
outcome. The per-chat toggle sets that field, and its label names the reason.

The labels read `worktree (project policy)`, `worktree (clone in use by 1
chat)`, and `reuse (project policy)`. A step that cannot resolve renders the
chip in a warning state that names it, for example a missing primary. The
warning state also names a Machine whose daemon lacks the typed git methods,
which answers `machine_update_required`. A send still works and creates the
chat filed and unbound.

Entry points pre-fill the chip: the project page composer, sidebar "New chat in
project", "New chat here" on a chat that exists, and the deep link
`/chat/new?project=&repository=&executor=&checkout=&worktree=1`. "New chat
here" copies project, repository, executor, and checkout, and turns isolation
on, because the source chat holds the tree. The chat header shows the same chip
read-only from the bound root.

The project page's "Repositories" section is the edit surface for D8. It
links and unlinks a repository. It sets the primary, the alias, and the
isolation policy. It registers a checkout by its `path`, and the executor
follows from that path. It lists the project's worktrees with the chat that owns each one
and a guarded Remove button. The repository catalog appears only as the picker
inside this section.

Alternatives:

- A form with labelled selects above the composer: permanently costs vertical
  space for a decision most chats never change.

- A modal wizard before every send: adds a step to the common case that the
  server can already resolve.

- A read-only summary: leaves the post-create `enter_workspace` path as the
  only way to correct a location, which is the behavior that this change replaces.

### D11. No new model announcement

The `workspace` producer already narrates a change of the bound root as a rail-resident
item on the first accepted turn. Creation bumps the generation of the bound root, so the
current item fires by itself. A creation-time item states the same fact twice
in the first Run and spends tokens on it.

Alternatives: a new `location` producer item duplicates the `workspace` item
and then needs a deduplication rule against it. A system-prompt sentence breaks
the current pattern that the harness narrates state through the rail, not the
prompt.

## Risks / Trade-offs

- [A stale selection between compose and send] → the server re-resolves and
  validates before any write. A named id that the owner cannot see answers 404
  and stores nothing. An unconfigured executor id answers 422
  `executor_unknown`. An offline Machine answers `machine_unavailable`, never a
  guessed fallback.

- [Double creation on a retry] → the client uuid is the idempotency key, and a
  per-chat session advisory lock serializes the request. A create on a chat
  that holds no message re-runs the remaining steps and answers 201. A create
  on a chat that holds a message answers 409. A concurrent same-id request
  answers 409 `creation_in_progress`. The composer keeps one id per draft.

- [An offline Machine at creation] → the machine option is disabled with its
  reason, and a forced create answers `machine_unavailable` with the chat left
  filed.

- [A crash between `git.worktreeAdd` and the commit of the bound root] → the chat stays
  filed and unbound. The directory stays on disk with no rows. The header chip
  shows the warning, and the owner resends with the same id or enters a
  Workspace later.

- [A filed, unbound chat with no Run] → the header chip shows the warning, the
  sidebar lists the chat, and the owner resends or enters a Workspace later.

- [The chip hides the real path] → the chip always prints the resolved root and
  the worktree branch. The cascade shows why a worktree was chosen, and the
  start-location read route returns the same resolution that the create uses.

- [Cross-owner link access] → links and defaults are visible only through the
  RLS of the project that owns them. Their composite owner foreign keys refuse another
  owner's repository or checkout with `23503`. Negative tests cover reads,
  writes, the primary update, and that refusal.

- [Project deletion with bound chats] → links and defaults cascade, while chats
  keep their path strings and detach only through the current per-attempt
  re-check.

- [Worktree creation is synchronous] → a slow `git worktree add` delays the
  create response and holds the chat's session advisory lock. The per-call
  timeout bounds it. A failed add is the `worktree_failed` status, not a lost
  chat.

## Migration Plan

- Entry requires the `repositories` change to be merged through its finalize:
  its tables, `enter_workspace` worktree option, and typed git methods are
  prerequisites.

- Three new tables with `ENABLE` and hand-appended `FORCE ROW LEVEL SECURITY`
  (`project_repositories`, `project_repository_defaults`,
  `chat_creation_records`), one unique `(owner_user_id, id)` key on `projects`
  for the composite owner foreign keys, and one nullable column
  `projects.default_executor_id`. No backfill: no links exist before this
  change, and a project without a repository still works.

- API and web additions are additive. `POST /api/v1/chats/:id/messages`,
  `PATCH /api/v1/chats/:id`, and the project routes keep their contracts.
  `GET /api/v1/projects/:id/repositories`, `GET
/api/v1/projects/:id/start-location`, and `GET
/api/v1/chats/:id/creation-record` are new reads with no effects.

- Rollback withdraws the web entry points and the create route, then drops the
  three tables, the unique key, and the column. Current chats keep
  `workspace_root` and `workspace_executor_id`. A removed worktree directory
  detaches at the next attempt as `root_missing`, which the current CHECK
  already allows.

- Layer order inside the stack:

  - `project-links-api` migrates and serves the link, defaults, and
    default-executor routes
  - `project-links-ui` renders them
  - `chat-creation` writes defaults, creation records, and bound roots
  - The two composer layers read the resolution routes
  - The two composer layers write only through the create route

- The `specs/workspace-entry/spec.md` MODIFIED block is written against the
  `repositories` change's delta text. Finalize re-bases it on the canonical
  requirement, then syncs it with `chat-creation`, `projects`, and
  `tool-call-permissions`.

## Open Questions

- Whether the composer also offers an inline "register checkout" affordance.
  Today the project page owns registration, and the composer links to it.

- Whether the chip labels a Machine by its configured name or by a display
  name, if Machine display names arrive later. The executor id is the stable
  key either way.

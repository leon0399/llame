## Why

A chat cannot open where its owner means it to work. llame creates a chat only
with its first message. So the project page composer stays disabled behind
`TODO(#1328)`, and every other composer starts an unfiled, unbound chat. The
owner files and enters that chat in later calls. This change makes the location
an input of creation: one request creates the chat already filed, resolves its
place from project defaults, binds it, and can start it inside a new worktree.

Decision provenance: Leo settled the design in a grilling session on
2026-10-24, recorded against the
[project, repository, and machine association study](../../../docs/research/product-vision/2026-10-24-project-repository-machine-association.md).
No issue tracks the change: Leo decided on 2026-10-24 to proceed without one,
as for `remote-machines`.

This change depends on the `repositories` change. That change supplies the
repository, checkout, and lease records, the `enter_workspace` worktree option,
and the typed git methods. Its implementation layers start only after
`repositories/finalize` merges.

## What Changes

- A new route creates a chat: `POST /api/v1/chats`.

  - Its own `CreateChatRequest` schema, separate from `CreateMessageDto`
  - The request names the project, the repository, and the executor
  - The request names the source checkout and an optional worktree
  - The request names an optional first message
  - The server resolves every omitted field from project defaults

- Creation runs its steps in one fixed order.

  - The chat record, the Workspace authorization, and the worktree
  - The bound Workspace root, and then the first Run
  - The create call does not stream
  - When a message is present, the server validates it before the first write
  - It checks the model, the effort, the permission mode, and the parts
  - It checks the media ownership too
  - The message and its Run row commit together, then the Run is enqueued
  - An enqueue failure fails the Run and answers 5xx, and the message stays
  - The client reads the reply from the current resume stream

- The create request is a second writer of the bound Workspace root.

  - It sits beside `enter_workspace`
  - It takes the same ordered path decisions
  - It takes the same `tools.allowed` rule and the same native executor rule
  - Each create or resend appends one attempt to the chat's creation record
  - That record is owner-only

- A failed bind or worktree leaves the chat filed and unbound.

  - The response is 201 with a `workspace` object of this shape:
  - `workspace: {status, root?, executorId?, worktree?, code?, message?}`
  - No Run is enqueued, and the server stores no message
  - The client keeps the draft
  - A same-owner resend on a chat that holds no message reuses the stored chat
  - That resend answers 201
  - A chat that holds a message answers 409
  - The client then sends the draft as a new message
  - A resend into an archived chat or project answers 409

- The server checks every named owner id before it stores the chat.

  - A foreign or missing id answers 404 and stores nothing
  - An archived project answers 409 and stores nothing
  - Another owner's chat id answers 404
  - An unconfigured executor id answers 422

- `POST /api/v1/chats/:id/messages` keeps its contract.

  - It still creates unfiled chats for clients that never send a location
  - A per-chat session advisory lock serializes the create requests
  - The lock sits on one dedicated connection for the whole request
  - A concurrent request with one id answers 409 `creation_in_progress`

- Project repositories become an owner-only link.

  - The link has an alias, one primary, and an isolation policy
  - The policy is `inherit`, `always_worktree`, or `never`
  - The policy selects the default that the composer shows
  - The request's `worktree` field decides the outcome
  - Each link remembers one source checkout per executor
  - A project can name a default executor
  - A successful chat start writes those defaults
  - A worktree start records its source checkout
  - A default is deleted with its checkout, with its link, and with its project
  - Two read routes serve the composer
  - The first route returns the project's links with their defaults
  - The second route returns a start-location preview with no effects

- The composer shows one editable chip with the resolved bound root.

  - One click opens one cascade popover
  - The levels are project, repository, and machine
  - Then the source checkout, the isolation, the base ref, and the name
  - The labels name the reason for a worktree
  - A warning chip names the unresolved or unavailable step
  - The warning chip still sends, and it creates an unbound chat

- Entry points pre-fill the chip.

  - The project page composer, which this change enables, closes #1328
  - The sidebar "New chat in project"
    - "New chat here" on a chat that exists
  - The deep link `/chat/new?project=&repository=&executor=&checkout=&worktree=1`
  - The chat header shows the same chip read-only

- The project page gains a "Repositories" section.

  - The owner links and unlinks repositories
  - The owner sets the primary, the alias, and the isolation policy
  - The owner registers a checkout by path on an executor
  - The owner lists the project's worktrees with a guarded remove action

- No new model announcement.
  - The current `workspace` producer already narrates the bound root
  - It narrates the bound root on the first accepted turn (D11)

## Assumptions, confirmed with Leo

Settled on 2026-10-24. Each code names one answered question in the grilling
record behind the research note.

- One `POST /api/v1/chats` request creates a chat with a location. The request
  carries an optional first message. It is not a create-then-patch sequence,
  and it does not use location fields on the first-message route. The create
  request has its own OpenAPI schema (Q6 A).

- A failed bind or worktree leaves the chat filed and unbound. The error sits
  on the response, because the common case is to send and walk away (Q6b'). A
  resend with the same id reuses the stored chat while it holds no message.

- A repository is optional at every level: project, link, and chat. The server
  never guesses a primary (Q13).

- The isolation policy lives on the project-repository link only
  (`inherit`, `always_worktree`, `never`). The policy selects the default that
  the composer shows. `inherit` applies the concurrency hint, and the
  triggered default is visibly labelled. The request's `worktree` field
  decides the outcome (Q8 B, Q14, Q22, Q24 A).

- The Workspace step of creation uses `message.permissionMode`, and `default`
  when the request omits it. A `bypass` request on a process whose
  `tools.permissionModes` does not enable bypass fails with 422 before any
  write. Creation appends one attempt, with each decision, to an owner-only
  creation record of the chat. The first Run attempt re-checks the bound root.

- An explicit `executorId`, a named `checkoutId`, or a remembered default that
  names an offline Machine answers `machine_unavailable`. Implicit steps skip
  offline Machines. A local executor is this process's
  `tools.nativeExecutorId`. "first" means the online executor with the lowest
  id that holds a main checkout.

- Explicit ids always override remembered defaults. A named checkout fixes its
  repository and its executor, and a disagreement answers 422.

- The worktree name, placement, and base ref reuse the `repositories` change's
  rules (Q17 B, Q18 A, Q20 A, Q21 A).

- The project page owns project repositories and the project's worktree list.
  The repository catalog appears only as the picker inside it (Q28 A).

- Each link remembers one source checkout per executor, written from the last
  successful start. A project can name a default executor. The `projects`
  capability owns this rule, and the create request cites it.

## Deviations from the grilling record

Three points differ from the record. Each needs Leo's confirmation.

- Resend: the record said that a second `POST /api/v1/chats` with a stored
  id answers 409. This change answers 409 only after the chat holds a message,
  because a failed location keeps the draft and the owner retries the same id.
  After an enqueue failure the owner sends the draft as a new message instead.

- Recorded decisions: the record expected creation to take path decisions
  without a record. This change appends one attempt, with every decision,
  and that includes a bypass decision, to an owner-only creation record of the
  chat.
  Canonical `tool-call-permissions` requires a recorded decision for every
  evaluation, and creation has no Run to attach one to.

- Request shape: `worktree` is an optional field of the create request, and the
  message is a nested `CreateChatMessageDto` with its own model, effort, and
  permission mode. The record described one create payload without these
  boundaries.

## Assumptions that follow, never asked

These are consequences the grilling session did not put to Leo. Each is small,
and a later change can reverse it without a data migration.

- The create call answers JSON and does not stream. When a message is present,
  the client reads the reply from the current resume stream.

- The 201 body carries the chat and a `workspace` object:
  `{status, root?, executorId?, worktree?, code?, message?}`. `status` is one
  of `bound`, `unbound`, `bind_failed`, `worktree_failed`,
  `machine_unavailable`, `machine_update_required`, and `outcome_unknown`. A
  bound status names `root`, `executorId`, and for a worktree
  `{path, branch, baseCommit}`. `code` is present only for `bind_failed` and
  `worktree_failed`. `unbound` stores the message and starts the Run, and
  `outcome_unknown` can name the directory it left behind.

- A same-owner create that repeats a stored id succeeds while that chat holds
  no message. It reuses the stored worktree and bound root, and it creates no
  second chat or worktree. Once the chat holds a message, the same id answers 409. The client then sends the draft as a new message with a new id through
  the message route. A stored id of another owner answers 404. A concurrent
  request with one id answers 409 `creation_in_progress`.

- A named owner id that the owner cannot see answers 404 before any write. A
  named executor that no configuration carries answers 422, and an archived
  project answers 409.

- An enqueue failure fails the Run and answers 5xx. The message and the Run row
  stay stored, and the same-id create then answers 409. The failed Run frees
  the single-flight slot. The owner sends the draft as a new message with a
  new id.

- A defaults row is written only by a start that bound successfully. A failed
  start leaves the previous row unchanged.

- The file action and the move action for a chat that exists resolve no location.
  Only the create call and Workspace entry write a bound root.

- A chat created without a message has no Run. The owner sends the first
  message later through the unchanged route.

- The project's worktree list shows registered worktrees only. A directory
  created outside llame appears after its registration.

## Capabilities

### New Capabilities

- `chat-creation`: one request that creates a chat with its project and
  location. The capability covers the resolution order and its defaults, the
  creation order, the failure boundary, idempotency by client id, and owner
  isolation. It adds these requirements:
  - "A chat can be created with its project and location in one request"
  - Location resolution uses project defaults and never a silent primary
  - Executor resolution skips offline Machines on implicit steps
  - Only an explicit executor, a named checkout, or a remembered default names
    an offline Machine
  - A create request with a message validates it before any write
  - Creation runs its steps in one fixed order
  - Creation serializes requests for one chat id
  - The Workspace step uses the request permission mode
  - The Workspace step requires the entry gates
  - A rejected path refuses the binding before any git command
  - A named checkout decides its repository and executor
  - The response workspace object has one closed status set
  - An unresolved location stores the message and starts the Run
  - Failure statuses name their cause
  - A failed workspace leaves the chat filed and unbound
  - The message step commits the message and its Run before the enqueue
  - A resent create request reuses the stored chat and its binding
  - Chat creation is owner-isolated
  - The first-message creation path is unchanged
  - The owner previews the start location without effects

### Modified Capabilities

- `projects`: the project↔repository link, its per-executor defaults, the
  project default executor, its cascade, its isolation, and the read routes.
  The entity, its ownership, and its chat association do not change. The
  links arrive as ADDED requirements. It adds these requirements:

  - A project links repositories with an alias and a primary link
  - An isolation policy selects the default isolation of a chat start
  - Project repository defaults remember the last chosen checkout per executor
  - A project can have a default executor
  - Project repository links are deleted with the project
  - Project repository links are owner-isolated
  - The owner reads a project's links and their defaults

- `tool-call-permissions`: ADDED requirement "Chat-creation path decisions are
  recorded with the chat". The create request has no Run, so it appends one
  attempt to an owner-only creation record of the chat. Each attempt carries
  every decision, a bypass decision included, and the provenance fields of a
  derived decision. The owner reads the record through
  `GET /api/v1/chats/:id/creation-record`.

- `workspace-entry`: MODIFIED requirement "The Workspace binding is Chat-scoped
  and persists across Runs". The owner's authenticated chat-creation request
  becomes a second writer of the bound root beside `enter_workspace`. It works under the
  same ordered path decisions and the same availability gates. When it establishes the bound root, that bound root counts as an entry that
  establishes a bound root. The requirement's text in this change is written against the
  `repositories` change's delta. Finalize re-bases it on the canonical text.

### Deliberately unchanged

- `durable-runs`: the first Run uses the current enqueue path with its
  fail-fast, retry, and single-flight rules. Creation adds no second way to
  start a Run. The message and its Run row commit as the message route
  commits them, and the enqueue stays outside that transaction.

- `context-injection`: no new announcement. The `workspace` producer already
  narrates a change of the bound root on the first accepted turn (D11).

## Impact

- `apps/api/src/chats/chats.controller.ts`: a new `POST /api/v1/chats` route,
  the new `GET /api/v1/chats/:id/creation-record` route, and the unchanged
  create-or-append route.

- `apps/api/src/chats/dto/chats.dto.ts`: `CreateChatRequest` and
  `CreateChatMessageDto` beside `CreateMessageDto`. They share only the
  message-parts schema.

- `apps/api/src/projects/*`: link, defaults, and default-executor writes. The
  link, start-location, and creation-record reads. The service and repository
  reads for resolution, and RLS tests.

- Database: `project_repositories`, `project_repository_defaults`,
  `chat_creation_records`, a unique `(owner_user_id, id)` key on `projects`, and
  a nullable `projects.default_executor_id`, with owner policies and FORCE RLS.

- OpenAPI document and the generated client, regenerated in one clean second
  generation.

- Delta specs: `specs/chat-creation/spec.md`, `specs/projects/spec.md`, the
  ADDED requirement in `specs/tool-call-permissions/spec.md`, and the MODIFIED
  requirement in `specs/workspace-entry/spec.md`. Finalize re-bases that
  MODIFIED requirement on the `repositories` delta before sync.

- `apps/web/app/(chat)/projects/[id]/project-prompt-input.tsx`: the composer
  becomes usable and closes #1328. The project page also gains the
  Repositories section.

- `apps/web`: the location chip and cascade popover, the sidebar entries, the
  read-only chat header chip, stories, and end-to-end tests.

- Docs: an operator section for project repositories. Reference pages for
  `POST /api/v1/chats`, the creation record, and the chip. A dated
  `CHANGELOG.md` entry.

## Non-Goals

- An inventory sweep of checkouts, a discovery scan, and a lost or moved
  state. The `repositories` change names those as later work.

- Agent-initiated worktree removal, and a model-facing announcement of the
  bound root.

- A composite parent root for a project with several repositories. The agent
  reaches sibling repositories by absolute path.

- Fork behavior changes. A fork keeps a copy of the bound Workspace root.

- Per-user credentials for Machines, and project access for other
  users.

## Acceptance

- On the project page, one send creates the chat already filed into that
  project and bound to the resolved root. Issue #1328 closes with the
  `chat-start-location/composer-chip` layer.

- `POST /api/v1/chats` with a valid location answers 201. The stored chat
  carries its project before the first Run.

- With isolation on, the chat binds the new worktree path under the source
  clone's parent, inside a registered root on a Machine. The project remembers
  the source checkout.

- A bind or worktree failure answers 201 with a `workspace` status from the
  closed set, stores no message, and enqueues no Run. A resend with the same
  id answers 201 while the chat holds no message, and it creates no second
  worktree.

- A second request with a stored client id answers 409 only when that chat
  holds a message, and another owner's id answers 404. An archived project
  answers 409. A concurrent request with one id answers 409
  `creation_in_progress`.

- The owner reads the chat's creation record, and no other principal reads it.

- A link or defaults row that names another owner's repository or checkout
  fails with `23503`, and the API answers 404.

- A negative test shows that another owner cannot read or change a link, a
  defaults row, or a chat created with a location.

- The current `POST /api/v1/chats/:id/messages` suite passes unchanged.

- `pnpm exec openspec validate chat-start-location --strict` passes.

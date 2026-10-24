## Why

A chat cannot open where its owner means it to work. llame creates a chat only
with its first message, so the project page composer stays disabled behind
`TODO(#1328)` and every other composer starts an unfiled, unbound chat that the
owner files and enters in later calls. This change makes the location an input
of creation: one request creates the chat already filed, resolves its place
from project defaults, binds it, and can start it inside a new worktree.

Decision provenance: Leo settled the design in a grilling session on
2026-10-24, recorded against the
[project, repository, and machine association study](../../../docs/research/product-vision/2026-10-24-project-repository-machine-association.md).
No issue tracks the change: Leo decided on 2026-10-24 to proceed without one,
as for `remote-machines`.

This change depends on the `repositories` change. That change supplies the
repository, checkout, and lease records, the `enter_workspace` worktree option,
and the typed git methods. This change cannot start before the `repositories`
change is canonical.

## What Changes

- New `POST /api/v1/chats` with its own `CreateChatRequest` schema, separate
  from `CreateMessageDto`. The request names the project, repository, executor,
  source checkout, and an optional worktree, plus an optional first message.
  The server resolves every omitted field from project defaults.
- Creation order is chat record, Workspace authorization, worktree, Workspace
  binding, then first Run. The create call does not stream. When a message is
  present, the server stores it and enqueues the Run through the existing
  durable enqueue, and the client reads the reply from the existing resume
  stream.
- A failed bind or worktree leaves the chat filed and unbound. The response is
  201 with `workspace: { status, message }`, and no Run is enqueued. The server
  does not store the message, so the client keeps the draft and resends after
  it corrects the location.
- `POST /api/v1/chats/:id/messages` keeps its contract, including creating
  unfiled chats for clients that never send a location.
- Project repositories become an owner-only link with an alias, one primary,
  and an isolation policy (`inherit`, `always_worktree`, `never`). Each link
  remembers one source checkout per executor, and a project can name a default
  executor. A successful chat start writes those defaults.
- The composer shows one editable chip with the resolved bound root. It opens
  one cascade popover: project, repository, machine, source checkout,
  isolation, base ref, and worktree name. Labels name the reason for a
  worktree, and a warning chip still sends and creates an unbound chat.
- Entry points pre-fill the chip: the project page composer (enables it and
  closes #1328), sidebar "New chat in project", "New chat here" on an existing
  chat, and the deep link
  `/chat/new?project=&repository=&executor=&checkout=&worktree=1`. The chat
  header shows the same chip read-only.
- The project page gains a "Repositories" section. The owner links and unlinks
  repositories, sets the primary, alias, and isolation policy, registers a
  checkout by path on an executor, and lists the project's worktrees with a
  guarded remove action.
- No new model announcement: the existing `workspace` producer already
  narrates the binding on the first accepted turn (D11).

## Assumptions, confirmed with Leo

Settled on 2026-10-24; each code names one answered question in the grilling
record behind the research note.

- A chat with a location is created by one `POST /api/v1/chats` request with an
  optional first message, and not by a create-then-patch sequence or by
  location fields on the first-message route; the create request has its own
  OpenAPI schema (Q6 A).
- A failed bind or worktree leaves the chat filed and unbound, with the error
  on the response, because the common case is to send and walk away (Q6b').
- A repository is optional at every level: project, link, and chat; the server
  never guesses a primary (Q13).
- The isolation policy lives on the project-repository link only
  (`inherit`, `always_worktree`, `never`); the link policy decides the default,
  `inherit` applies the concurrency hint, the triggered default is visibly
  labelled, and the per-chat choice is final (Q8 B, Q14, Q22, Q24 A).
- Worktree naming, placement, and base ref reuse the `repositories` change's
  rules (Q17 B, Q18 A, Q20 A, Q21 A).
- The project page owns project repositories and the project's worktree list,
  and the repository catalog appears only as the picker inside it (Q28 A).
- Each link remembers one source checkout per executor, written from the last
  successful start, and a project can name a default executor (chat-start UX
  discussion, 2026-10-24).

## Assumptions that follow, never asked

These are consequences the grilling session did not put to Leo. Each is small,
and a later change can reverse it without a data migration.

- The create call answers JSON and does not stream. When a message is present,
  the client reads the reply from the existing resume stream.
- The 201 body carries the chat and a `workspace` object. On success its status
  is bound, and it names the worktree path and branch when one was created.
- A defaults row is written only by a start that bound successfully. A failed
  start leaves the previous row unchanged.
- Filing or moving an existing chat into a project resolves no location. Only
  the create call and Workspace entry write a binding.
- A chat created without a message has no Run. The owner sends the first
  message later through the unchanged route.
- The project's worktree list shows registered worktrees only. A directory
  created outside llame appears after its registration.

## Capabilities

### New Capabilities

- `chat-creation`: one request that creates a chat with its project and
  location, the resolution order and its defaults, the creation order and the
  failure boundary, idempotency by client id, and owner isolation.
  Requirements:
  - A chat can be created with its project and location in one request
  - Location resolution uses project defaults and never a silent primary
  - Creation order is chat record, workspace, worktree, then first Run
  - A failed workspace leaves the chat filed and unbound
  - Chat creation is idempotent by client id
  - Chat creation is owner-isolated
  - The first-message creation path is unchanged

### Modified Capabilities

This capability gains ADDED requirements only. No canonical requirement is
MODIFIED, because the project entity, its ownership, and its chat association
keep their meaning; the links are adjacent records.

- `projects`: the project↔repository link, its per-executor defaults, the
  project default executor, its cascade, and its isolation. Requirements:
  - A project links repositories with an alias, a primary, and an isolation
    policy
  - Project repository defaults remember the last chosen checkout per executor
  - A project can have a default executor
  - Project repository links are deleted with the project
  - Project repository links are owner-isolated

### Deliberately unchanged

- `durable-runs`: the first Run uses the existing enqueue path with its
  fail-fast, retry, and single-flight rules. Creation adds no second way to
  start a Run.
- `workspace-entry`: entry and exit keep their requirements. Creation reuses
  the same path decisions and authorization, and writes no new tool behavior.
- `context-injection`: no new announcement. The `workspace` producer already
  narrates a binding change on the first accepted turn (D11).

## Impact

- `apps/api/src/chats/chats.controller.ts`: a new `POST /api/v1/chats` route,
  and the unchanged create-or-append route.
- `apps/api/src/chats/dto/chats.dto.ts`: `CreateChatRequest` beside
  `CreateMessageDto`, sharing only the message-parts schema.
- `apps/api/src/projects/*`: link, defaults, and default-executor routes, the
  service and repository reads for resolution, and RLS tests.
- Database: `project_repositories`, `project_repository_defaults`, and a
  nullable `projects.default_executor_id`, with owner policies and FORCE RLS.
- OpenAPI document and the generated client, regenerated in one clean second
  generation.
- `apps/web/app/(chat)/projects/[id]/project-prompt-input.tsx`: the composer
  becomes usable and closes #1328. The project page also gains the
  Repositories section.
- `apps/web`: the location chip and cascade popover, the sidebar entries, the
  read-only chat header chip, stories, and end-to-end tests.
- Docs: an operator section for project repositories, reference pages for
  `POST /api/v1/chats` and the chip, and a dated `CHANGELOG.md` entry.

## Non-Goals

- An inventory sweep of checkouts, a discovery scan, and a lost or moved
  state. The `repositories` change names those as later work.
- Agent-initiated worktree removal, and a model-facing announcement of the
  binding.
- A composite parent root for a project with several repositories. The agent
  reaches sibling repositories by absolute path.
- Fork behavior changes. A fork keeps copying the Workspace binding.
- Per-user credential scoping for Machines, and project sharing with other
  users.

## Acceptance

- On the project page, one send creates the chat already filed into that
  project and bound to the resolved root. Issue #1328 closes with this layer.
- `POST /api/v1/chats` with a valid location answers 201, and the stored chat
  carries its project before the first Run.
- With isolation on, the chat binds the new worktree path under the source
  clone's parent, inside a registered root on a Machine.
- A bind or worktree failure answers 201 with a `workspace` status, stores no
  message, and enqueues no Run. A resend after the fix succeeds.
- A second `POST /api/v1/chats` with an existing client id answers 409 and
  creates nothing.
- A negative test shows that another owner cannot read or change a link, a
  defaults row, or a chat created with a location.
- The existing `POST /api/v1/chats/:id/messages` suite passes unchanged.
- `pnpm exec openspec validate chat-start-location --strict` passes.

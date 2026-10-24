## Why

llame records where a Chat runs, but not what it runs on. `enter_workspace`
binds any absolute path or `machine://` locator that the model names, so no
record says that two clones are the same repository, that a worktree belongs to
a clone, or that a directory is a checkout at all; every session starts unbound
or from a retyped path, and two Chats on one clone edit the same files.

Decision provenance: the design was settled in a grilling session with Leo on
2026-10-24, recorded against the
[project, repository, and machine association study](../../../docs/research/product-vision/2026-10-24-project-repository-machine-association.md).
No issue tracks it: Leo decided on 2026-10-24 to proceed without one, as for
`remote-machines`.

## What Changes

- New owner-scoped repository catalog. A repository has a display name and an
  optional normalized remote; the remote is a pure normalization (scheme and
  credentials stripped, host lowercased, `.git` and trailing slash removed), so
  `git@github.com:leon0399/llame.git` and `https://github.com/leon0399/llame`
  are one repository. The owner declares aliases for renames and forks. A
  remote-less repository is identified by its first checkout.
- New checkouts. A checkout records that one repository exists at one canonical
  path on one executor (the local executor or `machine:<name>`), with kind
  `main` or `worktree`, a parent main checkout for a worktree, its branch, and
  its origin (`registered`, `adopted`, or `created`). One path per executor is
  one checkout.
- New informational worktree leases. A lease records which Chat created a
  worktree and from which base ref. It refuses nothing: a second Chat can bind
  a leased path, and a fork copies its binding as today.
- New owner API for repositories, aliases, checkouts, and guarded worktree
  removal. Registration inspects the path on its executor and trusts the
  inspected origin over any caller-declared one; an unreachable Machine fails
  registration as `machine_unavailable`.
- New typed git operations, `git.inspect`, `git.worktreeAdd`,
  `git.worktreeList`, `git.worktreeRemove`, and `git.status`. They take argv
  arrays, run with `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, and
  `GIT_OPTIONAL_LOCKS=0`, and return a typed failure with git's stderr. The
  hub's local executor runs them in-process; a Machine daemon answers them as
  protocol methods.
- Not breaking for installed daemons: the Machine protocol version stays at 1
  and the git methods are additive. The handshake result lists the git methods
  a daemon answers; a Machine whose daemon lists none fails a git call as
  `machine_update_required` before any request, while its file tools and
  `bash` keep working. The operator page names the daemon update step.
- `enter_workspace` gains one optional `worktree` field with an optional `name`
  and `baseRef`. With it, entry creates a worktree of the source clone, records
  a worktree checkout and a lease, and binds the new directory. Without it,
  entry behaves exactly as today.
- Worktree placement is
  `<parent of source clone>/.llame-worktrees/<display name>/<name>`, unless the
  main checkout carries a `worktree_base` override. The name is generated as
  `<adjective>-<noun>-<4 hex>` when absent, and the branch is `llame/<name>`
  unless the name already contains `/`. The base ref defaults to the source
  clone's current HEAD, with no fetch.
- Both paths of a worktree entry are decided before any git effect: the
  submitted source clone is the `path` decision, and the computed worktree
  directory is the `canonical` decision, both under the `enter_workspace`
  group. Classification stays `execute_code`.
- An unregistered source clone is adopted in the same call: inspection records
  the repository by normalized remote, or remote-less, and a main checkout with
  origin `adopted`. No project link is created.
- A failed `git worktree add` returns `worktree_failed` with redacted git
  stderr, leaves the binding unchanged, and writes no rows.
- Worktree removal is owner-initiated and guarded. It refuses a dirty worktree,
  refuses commits ahead of the upstream, and fails closed when the upstream is
  unknown. No agent-facing removal exists in this change.
- Row deletion cascades rows and never files. Deleting a repository deletes its
  checkouts and leases; deleting a main checkout deletes its worktree rows; the
  directories stay on disk, and Chats keep their path strings until the
  existing per-attempt re-check detaches them.

## Assumptions, confirmed with Leo

Settled on 2026-10-24; each code names one answered question in the grilling
record behind the research note.

- Repository identity is a normalized remote with owner-declared aliases, and
  not a root-commit witness or a shared hub-wide catalog (Q1 A, Q2 A).
- A checkout is the per-executor holding, and the path is recorded once per
  repository and executor, not per project (Q7 A, Q16 A, Q16' A).
- Registration always inspects the executor, and a typed repository or remote
  input only selects; the inspected origin is the authority (Q23 B).
- Worktree leases are informational receipts that refuse nothing, so
  `owner-chat-forks` stays unchanged (Q5).
- Worktree creation is an option on `enter_workspace`, not a second tool, and
  the agent addresses clones by path, not by repository alias (Q9 A, Q10 A).
- The submitted clone and the computed directory are both decided before any
  git call (Q25 A).
- The worktree name is an optional parameter; a generated name is
  `<adjective>-<noun>-<4 hex>`, one name derives both the directory slug and
  the branch (Q17 B, Q20 A, Q21 A).
- The base ref is the source clone's current HEAD, with no fetch (Q18 A).
- A worktree is placed under a `.llame-worktrees` directory beside the source
  clone, overridable per main checkout; a Machine path must lie inside a
  registered root (Q4 A).
- An unregistered source clone is adopted on worktree entry rather than refused
  (Q26 A).
- Removal is owner-initiated and guarded; the agent cannot remove a worktree in
  this change; row deletes cascade rows and never files (Q12 A, Q27 B).
- Typed git methods on the executors, narrow rather than a generic `git.run`
  (Q16 A, Q16' A).
- No inventory sweep and no observed status in this change (Q19 A).

## Assumptions that follow, never asked

These are consequences the grilling session did not put to Leo. Each is small,
and a later change can reverse it without a data migration.

- The repository display name is one path segment. The API rejects a name that
  contains `/`, a NUL byte, or is `.` or `..`, because the worktree directory
  embeds the name.
- A generated name retries with a new hex suffix until neither the directory
  nor the branch exists. A requested name is used verbatim; a collision fails
  as `worktree_failed` rather than silently renaming.
- A path that git reports as a linked worktree is registered as a `worktree`
  row whose parent is the main clone git names, not as a `main` row.
- `worktree_base` is set through `PATCH /api/v1/checkouts/:id` on a `main`
  checkout and stays null otherwise.
- Two concurrent registrations of one path resolve through the unique
  constraint as a conflict response, not a merge.
- `GET /api/v1/checkouts` filters by repository only, with no pagination, until
  an owner reports enough checkouts to need it.

## Capabilities

### New Capabilities

- `repositories`: the owner's repository catalog, checkouts on executors,
  worktree leases, typed git operations on the hub and on a Machine, guarded
  worktree removal, and row-only cascades. Requirements:
  - Repositories are owner-scoped and identified by their normalized remote
  - Checkouts record where a repository exists on an executor
  - Worktree checkouts are children of a main checkout
  - Worktree leases are informational ownership receipts
  - Checkout registration inspects the path on its executor
  - Executors expose typed git operations
  - Worktree removal is owner-initiated and guarded
  - Repository and checkout deletion cascades records and never files
  - Repository records are isolated per owner

### Modified Capabilities

These capabilities gain ADDED requirements only. No canonical requirement is
MODIFIED, because every existing sentence stays true for the path form that
this change leaves in place.

- `workspace-entry`: the `worktree` option, its naming and branch rule,
  adoption of an unregistered source clone, and the failure boundary.
  Requirements:
  - Workspace entry can create a worktree of the source clone
  - Worktree names and branches follow one naming rule
  - An unregistered source clone is adopted on worktree entry
  - Worktree creation failure leaves the binding unchanged
- `remote-machines`: the daemon's typed git methods and the registered-root
  rule for a worktree directory. Requirements:
  - Machine daemons answer typed git methods
  - Git methods are additive to the Machine protocol
  - Worktree directories on a Machine lie inside a registered root
- `tool-call-permissions`: the two path decisions of a worktree entry.
  Requirements:
  - Worktree entry decides the source clone and the worktree path

### Deliberately unchanged

- `owner-chat-forks`: a fork copies the Workspace binding as it does today.
  Leases are informational, so a fork needs no lease rule.
- `context-injection`: the `workspace` producer already narrates a binding
  change on the first accepted turn. Worktree entry is a binding change.
- `projects`: this change stores no project data. Project links and defaults
  belong to `chat-start-location`, which builds on this capability.

## Impact

- `apps/api/src/tools/workspace.ts`: the optional `worktree` field, the computed
  directory, the second permission decision, adoption, lease, and binding. The
  strict object at `:479` accepts exactly one field today.
- `apps/api/src/db/schema/`: four new tables and their Drizzle migration
  (`repositories`, `repository_aliases`, `checkouts`, `worktree_leases`) with
  owner policies and FORCE RLS.
- New `packages/git-executor`: the typed git operations over argv arrays, shared
  by the hub's local executor and the daemon.
- `packages/machine-protocol`: five new methods, their typed parameters and
  results, and `PROTOCOL_VERSION` 1 to 2.
- `apps/machine/src`: the daemon implementations, the root guard applied to the
  worktree directory, and the version handshake.
- New API module for repositories, aliases, checkouts, and worktree removal,
  with OpenAPI regeneration and the generated client.
- `apps/api/src/testing/`: the portable and permission fixtures that enumerate
  `enter_workspace` arguments, plus the tests that pin its schema.
- Docs: a new `docs/product/operator/repositories.md`, the `enter_workspace`
  reference page, the operator and reference indexes, and a dated
  `CHANGELOG.md` entry.
- `SPEC.md` placement section, to name the repository catalog beside the
  Workspace binding.

## Non-Goals

- An inventory sweep, an observation column, or reconciliation against
  `git worktree list` on a schedule. Leases and rows are intent, not
  observation.
- A discovery scan (`inventory.scan`) over registered roots or a Machine. The
  owner registers a checkout.
- Agent-initiated worktree removal. A later change can add
  `exit_workspace(remove)` with the same guard.
- An announcement of the new entities to the model beyond the existing
  `workspace` rail item.
- A project rail item, a composite parent root for multi-repo projects, or any
  project-to-repository link. The agent reaches sibling paths by absolute path
  or `..`.
- Any change to a Chat's binding model, its detach reasons, its generation
  fence, or its fork behavior.

## Acceptance

- An owner registers a local clone by path. The API records the repository from
  the inspected origin and one main checkout. A second registration of the same
  path fails as a conflict.
- `enter_workspace` with `worktree: {}` creates
  `<parent>/.llame-worktrees/<display name>/<generated name>`, records a
  worktree checkout and a lease, and binds the new directory. The result names
  the path, the branch, and the base commit.
- A permission reject on the computed worktree directory refuses the call
  before `git worktree add` runs, and `workspace_generation` does not change.
- A Machine source clone whose computed directory is outside every registered
  root fails as `path_not_registered` before any git call.
- An owner removes a clean worktree through
  `DELETE /api/v1/checkouts/:id/worktree`. A dirty worktree, an unpushed
  branch, and an unknown upstream are each refused, and the directory stays.
- Deleting a repository deletes its checkout and lease rows; the directories
  remain; a Chat bound to one of them keeps its path until its next attempt
  re-checks it.
- A Machine whose daemon predates the git methods fails `git.inspect` as
  `machine_update_required` before any request, and its `read` still works.
- Owner B cannot read, insert, change, or delete owner A's repositories,
  aliases, checkouts, or leases, through the API or through a direct query.

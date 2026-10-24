# Design

## Context

See proposal.md - Why. Current state that shapes the approach:

- The Workspace binding is `chats.workspace_root`, `workspace_executor_id`,
  `workspace_generation`, `workspace_told`, `workspace_told_available`,
  `workspace_told_from`, and `workspace_detach_reason`
  (`apps/api/src/db/schema/chats.ts:151-166`), with a closed CHECK on the six
  detach reasons (`:175-178`). `WorkspaceBindingRepository`
  (`apps/api/src/chats/workspace-binding.repository.ts:37`, `:85`, `:121`)
  owns `enter`, `exit`, and `detach`, and every write is a generation
  compare-and-set.
- `enter_workspace` is one tool with one input field:
  `inputSchema: z.strictObject({ path: z.string().min(1) })`
  (`apps/api/src/tools/workspace.ts:479`). The strict object rejects unknown
  keys, so a new field is an explicit schema change. The call rejects a NUL or
  relative path as `invalid_path`, parses `machine://` first (`:486`), decides
  the submitted path before any probe (`:501-511`), canonicalizes with
  `realpath` and `stat` (`:179-190`), records the canonical decision with
  `kind: 'canonical'` (`:157-177`), and binds through
  `bindCanonicalRoot` (`:332`). `claimTransition` (`:294`) allows one
  Workspace transition per model step. Classification is `execute_code`.
- Permission projection for entry is three evaluations of the same
  `enter_workspace` group: the submitted path, the canonical source clone, and
  the canonical worktree directory
  (`openspec/specs/tool-call-permissions/spec.md:803`). Bypass admits all three
  without evaluation (`:825`).
- Machines are operator-configured (`apps/api/src/instance-config/machines-config.ts:12-37`),
  addressed by the `machine://` grammar in
  `apps/api/src/machines/machine-locator.ts`, and reported through
  `machines_status` with a `roots jsonb` column
  (`apps/api/src/db/schema/machines-status.ts:26-62`). The daemon owns root
  enforcement: `RootGuard.resolvePath` refuses anything outside the registered
  roots with `path_not_registered` (`apps/machine/src/guard.ts:24-40`), and the
  roots file is edited with `llame-machine roots add|list|remove`
  (`apps/machine/src/roots.ts`).
- The Machine protocol is versioned by one integer,
  `PROTOCOL_VERSION = 1` (`packages/machine-protocol/src/constants.ts:2`). The
  daemon compares it at the handshake and stops the session on a mismatch
  (`apps/machine/src/serve.ts:130-141`); the hub maps the refusal to
  `machine_unavailable` with reason `incompatible_version`
  (`apps/api/src/tools/machine-call.ts:117`, `:170`), which is also a closed
  status reason (`apps/api/src/machines/machines-status.ts:17`).
- Git is not modeled anywhere. No git library is installed in `apps/api`,
  `apps/machine`, or `packages/machine-protocol`; the only process runner is
  `node:child_process` (`packages/bash-executor/src/execute.ts:2`), and git
  reaches a repository today only as opaque `bash` text.
- Owner isolation is table-level: `projects` carries an owner policy and gets
  FORCE RLS hand-appended in the migration, because Drizzle emits `ENABLE`
  only (`apps/api/src/db/schema/projects.ts:12-16`). A cross-owner `SELECT`
  returns no rows, a cross-owner `UPDATE` or `DELETE` affects zero rows, and an
  `INSERT` that names another owner fails with `42501`, which the API maps to 404.
- `enter_workspace` argument shapes are pinned by fixtures and tests:
  `apps/api/src/testing/portable-tool-policy.ts`,
  `apps/api/src/testing/tool-permission-policy.ts`,
  `apps/api/src/instance-config/tool-permissions-config.test.ts`, and
  `apps/api/src/tools/workspace.test.ts`.

The evidence base is the
[project, repository, and machine association study](../../../docs/research/product-vision/2026-10-24-project-repository-machine-association.md)
and the 2026-10-24 grilling record cited by Q code below. Where the study's
earlier sketch differs from the settled decisions, the settled decisions win:
leases are informational (not enforced), no sweep ships, and
`owner-chat-forks` is unchanged.

## Goals / Non-Goals

**Goals:**

- One place answers "where does this repository exist", and registration,
  worktree entry, and a later chat start all read it.
- The hub and a Machine run the same typed git operations, so no owner or model
  string becomes a command line on either side.
- Entry keeps its ordered decisions, one-transition, generation-fenced
  contract: the submitted path, the canonical source clone, and the canonical
  worktree directory. The `worktree` field adds a placement rule, not a second
  binding path.
- A failed worktree creation is invisible to the Chat: no repository,
  checkout, or lease row, no binding change, one typed error.

**Non-Goals:**

- An observation column or a sweep; intent rows only.
- A lease that refuses a second binding.
- A git library dependency.
- Owner UI. The project page form and the picker belong to
  `chat-start-location`.
- Any change to fork copying, the context rail, or project storage.

## Prior art

Twelve surveyed surfaces; the study's comparison table is the source. Cells
name what this design takes or avoids.

| Product    | Repository identity                                                                     | Per-machine location record                                                                                         | Worktree removal guard                                                    | Lesson taken                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Shipyard   | Project derived from the remote slug `owner/repo`, else `name:<location>`; no database  | `locations.json` per box, projects recomputed over online boxes                                                     | Git's own dirty refusal; main checkout guarded                            | Remote-derived identity merges two clones of one remote, so it cannot serve one repository in several projects. |
| Orca       | Project id from the remote (`github:o/r`, `git:host/path`); a repository is one clone   | `ProjectHostSetup` keyed `${projectId}::${hostId}`                                                                  | Target required; durable worktree id survives a rename                    | A worktree id that survives a rename is worth having; deriving the project from the remote is not.              |
| Emdash     | `(host, absolute path)`; the same path on another host is a different repository        | Host-truth `workspace_records` with `kind repository\|worktree`, `parent_id`, `origin registered\|adopted`          | Observed git state and tombstones                                         | The parent link and the `adopted` origin match this design; the observation column waits for the sweep.         |
| bb         | None; optional `projects.git_remote_url`                                                | `project_sources(project, host, path)`                                                                              | Force remove plus environment teardown                                    | Cautionary: a force path with no guard loses work.                                                              |
| Superset   | Host database `repo_path`; cloud clone URL with uniqueness dropped                      | Host-local SQLite per machine; `projects setup <id>` clones elsewhere                                               | Inspect, warn `hasChanges`/`hasUnpushedCommits`, tombstone, refuse dirty  | The strongest guard in the field. Reuse the refusal set; the tombstone needs the deferred sweep.                |
| Kandev     | Workspace-scoped repository row carrying a local path and a remote URL                  | Paths derived as siblings under `<base>/<task>/<repo>`                                                              | Dirty-check all, explicit discard, journaled repair                       | Sibling paths per work unit; multi-repo work units belong to a later change.                                    |
| Paseo      | Root path per daemon; opaque project key from the normalized remote                     | Project host entry per (project, daemon)                                                                            | Confirm, then delete                                                      | A normalized remote is the right grouping key; confirm-then-delete is the cautionary tail.                      |
| Jean       | Path string; the repository identifier is derived from `origin` on demand, never stored | None                                                                                                                | `remove --force` and `branch -D`                                          | Deriving identity on demand throws away rename tolerance; force removal is the cautionary tail.                 |
| Synara     | Realpath of the project root                                                            | None                                                                                                                | `remove` without force; the branch is deleted only if unchanged           | Refusing dirty without force is right; the missing location record is what this change adds.                    |
| AO         | Project path unique; repository identity used only for pull-request attribution         | None                                                                                                                | `ErrWorkspaceDirty` and explicit force destroy, with a preserve-ref stash | Multi-repo workspaces use sibling directories; the preserve-ref idea is a later option.                         |
| herdr      | Not a catalog; a worktree is an explicit command                                        | `herdr worktree create --branch --base --path --label`                                                              | Not recorded                                                              | Reuse the explicit branch, base, path, and label inputs and the generated name shape.                           |
| Daemon git | Seven products: Shipyard berthd, bb, Emdash, Kandev, Superset, Paseo, Orca              | Typed methods with struct input, argv arrays, sanitized env, timeouts, porcelain parsed host-side, stderr in result | Rollback on a failed create; none exposes a shell-string git path         | Reuse the typed surface and the sanitized environment. Version negotiation is an integer version, as llame has. |

Observations that shape the decisions:

- O1. No peer supports one repository in several projects and one project with
  several repositories. Identity by remote loses the first; identity by path
  loses rename tolerance. This change takes identity by remote and defers the
  project link.
- O2. Every peer that models machines records `(thing, host, path)`. Nobody
  indexes that row by a stable repository key; this design does.
- O3. The removal guards that survive contact with users refuse dirty trees and
  unpushed commits. The force paths are the cautionary tail.
- O4. Seven independent daemons converged on the same git surface, and none
  accepts a command string.
- O5. The reconciliation discipline that survives is "observe, mark, never
  auto-heal". This change ships intent rows and defers observation instead of
  half-shipping it.

## Decisions

### D1. Repository identity is a normalized remote plus declared aliases (Q1 A, Q2 A)

`repositories` holds `id`, `owner_user_id`, `display_name`, `canonical_remote`
(nullable), and unique `(owner_user_id, canonical_remote)`. Normalization is
pure and total:

- `git@github.com:leon0399/llame.git` and
  `https://github.com/leon0399/llame` both become
  `github.com/leon0399/llame`;
- a URL userinfo part, which can carry a token, is removed before storage;
- the host is lowercased and the path keeps its case;
- a trailing slash and one trailing `.git` are removed;
- a string that is not a remote keeps its trimmed text.

`repository_aliases` holds `(owner_user_id, repository_id, canonical_alias)`
with unique `(owner_user_id, canonical_alias)`, so an owner can declare a
rename or a fork equal to one repository. A null `canonical_remote` is a valid
repository, identified by its first checkout. Both tables carry an owner-only
policy declared with `pgPolicy` and `.enableRLS()`, with only
`FORCE ROW LEVEL SECURITY` hand-appended in the migration, as `projects` does
(`apps/api/src/db/schema/projects.ts:46-51`).

Rejected:

- A root-commit witness, alone or as a set of identity witnesses. A shallow
  clone has no root commit, and template-derived repositories share one.
- A three-tier identity with validity intervals. More than the per-machine
  record needs, and it duplicates history git already keeps.
- A hub-wide shared repository catalog with per-owner subscriptions. A shared
  table of remote URLs is a cross-owner disclosure path in an RLS product.
- Identity by path, as Emdash, Jean, and Synara do. A rename or a move creates
  a new identity, and one repository cannot serve two projects.
- Deriving the project from the remote, as Shipyard, Orca, and Paseo do. Two
  clones of one remote collapse into one project.

### D2. A checkout is a per-executor holding (Q7 A, Q16 A, Q16' A, Q19 A)

`checkouts` holds `id`, `owner_user_id`, `repository_id`, `executor_id`,
`path`, `kind` (`main` or `worktree`), `parent_checkout_id`, `branch`,
`origin` (`registered`, `adopted`, or `created`), and `worktree_base`, with
unique `(owner_user_id, executor_id, path)`. The owner column is part of the
key because the local executor and every Machine are shared by all owners. A
global key would turn a second owner's registration into a conflict, which
discloses that another owner holds the path. `executor_id` uses the existing
grammar: the local native executor id or `machine:<name>`. `path` is the
canonical form on that executor: the canonical absolute path for a local
checkout, and the canonical Machine locator (`machine://<name>/<abs path>`) for
a Machine checkout. That is the same form as `chats.workspace_root`, so a
checkout and a binding compare equal as strings. A worktree row names its
source `main` row in `parent_checkout_id`; both rows share one executor, which
the repository layer enforces and a test asserts. `branch` is set on worktree
rows. `worktree_base` is set on main rows only, as an absolute local path or a
canonical Machine locator, and the `PATCH` route rejects it on a worktree row.

Every child row uses a composite owner foreign key `(owner_user_id, x_id)` to
`(owner_user_id, id)` of its parent, with a unique `(owner_user_id, id)` key on
every parent: checkouts to repositories, a worktree checkout to its parent
checkout, leases to checkouts, leases to chats, and aliases to repositories.
Every one carries `ON DELETE CASCADE`. A single-column key would let a row name
another owner's parent, because a foreign-key check ignores RLS, and a cascade
would then delete across owners.

There is no foreign key to `machines_status`, which the hub probe rewrites, and
no `observed_status` column in this change. An unreachable Machine leaves its
checkouts inert, the way it leaves a binding in place today.

Rejected:

- The path on the project-to-repository link. It duplicates one path across
  every project that shares a repository, turns a move into N row updates, and
  hides from the inventory that two projects write one tree.
- Git as the only registry, with no rows. Then no record says which Chat
  created a worktree, and a lost directory is indistinguishable from one never
  created.
- One path per repository. A repository exists on several executors, and a
  remote clone can sit at two paths on one executor.
- A global unique `(executor_id, path)`. One Machine is operator-wide, so a
  second owner's registration of a held path would become a conflict, which is
  a cross-owner existence oracle on host paths.
- An observation column now, or a foreign key to `machines_status`. The probe
  rewrites status rows, and observation without the sweep would be a field that
  only ever says `present`.

### D3. A lease is an informational receipt (Q5)

`worktree_leases` holds `id`, `owner_user_id`, `chat_id`, `checkout_id`,
`base_ref`, and `created_at`, written when a Chat creates a worktree. It
refuses nothing: a second Chat can bind a leased path, and a fork copies its
binding as `owner-chat-forks` does today. `GET /api/v1/checkouts` is the owner
surface for the receipt: for each worktree row it returns the lease chat id and
the ids of the owner's chats whose binding root equals the row's path. Leases
cascade with their checkout, and their `chat_id` and `checkout_id` are
composite owner foreign keys as in D2.

Rejected: an enforced lease, with one active lease per worktree and a refusal
for a second binding, as the study's earlier sketch had. Enforcement needs a
release lifecycle, a lost-lease state, and a fork rule, and every one of them
is a new failure mode for a receipt the owner can read. The concurrency hint
that a UI needs comes from the binding and the lease together, without a
refusal. The study's OD4 (fork of a leased Chat) disappears with enforcement.

### D4. Registration inspects the executor through typed git operations (Q7 A, Q23 B, Q16 A, Q16' A)

New `packages/git-executor` exports five operations. It has no NestJS or
database dependency, in the shape of `packages/bash-executor` and
`packages/native-file-tools`. Both the hub's local executor and the daemon use
it, so one implementation defines the argv, the environment, and the timeout.

| Method               | Input                                    | Result                                                                                                |
| -------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `git.inspect`        | `{ path }`                               | `{ toplevel, commonDir, linked, mainWorktree?, remotes: [{ name, url }], branch, head }` or a failure |
| `git.worktreeAdd`    | `{ source, branch, baseRef, directory }` | `{ path, branch, head }` or `{ failed, stderr }`                                                      |
| `git.worktreeList`   | `{ source }`                             | `[{ path, branch, head, locked, prunable }]`                                                          |
| `git.worktreeRemove` | `{ path }`                               | ok, or `{ failed, stderr }`                                                                           |
| `git.status`         | `{ path }`                               | `{ dirty, ahead, upstream? }`                                                                         |

`git.inspect` reports `commonDir` from `git rev-parse --git-common-dir`, a
`linked` flag, and `mainWorktree` for a linked worktree. Registration and
adoption need those fields to store a linked worktree as a `worktree` row whose
parent is the main clone, without waiting for `git.worktreeList`.

Every call spawns `git` with an argv array, never a shell string, and a fixed
environment: `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, and `GIT_OPTIONAL_LOCKS=0`
on reads. Each call passes `--end-of-options`, or `--` where the subcommand
takes it, before every caller value. It runs with
`-c core.hooksPath=<empty directory>` and `-c core.fsmonitor=false`, so a
repository's own configuration never starts a command as the hub or daemon
user. Each call has a timeout. A non-zero exit becomes a typed result that
carries bounded, redacted standard error. No operation fetches, pushes, or
contacts a network. An operation rejects a `name` or `baseRef` that starts
with `-` as invalid input before git starts.

The owner API is `POST`/`GET /api/v1/repositories`,
`PATCH`/`DELETE /api/v1/repositories/:id`,
`POST /api/v1/repositories/:id/aliases`,
`POST /api/v1/checkouts` with `{ executorId, path, repositoryId? | remote? }`,
`GET /api/v1/checkouts?repositoryId=`, `PATCH /api/v1/checkouts/:id` with
`{ worktreeBase }` on a `main` checkout, `DELETE /api/v1/checkouts/:id`, and
`DELETE /api/v1/checkouts/:id/worktree`.

Every route that runs git is gated. The named executor must be configured: a
non-Machine `executorId` is the serving process's `tools.nativeExecutorId`, and
a mismatch or an unset native id fails as `executor_unavailable` (503).
`enter_workspace` must be in `tools.allowed`, else `permission_denied` (403).
The submitted path and its canonical form are both evaluated under the
`enter_workspace` group in `default` mode, with the same reject rules as entry.
No git call runs before those gates pass, so a route cannot probe a host path
that the owner may not enter. The process that serves the request runs the
local inspection; a split topology therefore needs the named executor on that
process, and answers `executor_unavailable` otherwise.

Registration always inspects. The inspected origin decides the repository: an
input that names a repository or a remote only selects, and a mismatch with
the inspected origin is a validation error. The canonical remote is the remote
named `origin`; a clone without `origin` has no remote. A remote-less clone
takes the repository input, or gets a new remote-less repository. Adoption
derives the display name from the last segment of the canonical remote, else
from the toplevel basename, sanitized to one path segment. A linked worktree is
stored as a `worktree` row whose parent is its main clone, from
`git.inspect`'s `linked` and `mainWorktree` fields.

Failures map to HTTP as follows: 404 for a missing or foreign id, with no
existence leak; 409 for a duplicate path in the owner's catalog; 422 for an
origin mismatch, an invalid name or base reference, or a path that is not a
git repository; 502 `git_failed` with redacted standard error for another git
failure, including a timeout; and 503 with a typed code for
`machine_unavailable`, `machine_update_required`, or `executor_unavailable`.

The daemon gains the five methods and the hub gains their local counterparts.
The protocol version stays at 1: the methods are additive, and the `hello`
result gains an optional `methods` list naming the git methods the daemon
answers. A daemon that omits the list predates them. The hub refuses a git
call on such a Machine as `machine_update_required` before any request, and
every other Machine operation keeps working. This follows the additive camp
(Emdash, Paseo) over bb's version-table camp, because a version bump would
take `read` and `bash` away from every Machine until the operator updates it.

Rejected:

- Running git through `bash` or `proc.bash`. That is a model-authored command
  string, outside the `enter_workspace` group, unbounded in effect, and
  invisible to the typed result.
- Trusting a caller-declared origin without inspection, which the rejected
  answer to Q23 proposed. A stale remote or a wrong repository id would be
  recorded as fact.
- A git library such as `simple-git` or `isomorphic-git`. It adds a dependency
  to both sides for argv, environment, and timeout control this package owns in
  a hundred lines, and its porcelain parsing would sit away from the git
  process.
- Returning raw porcelain text to the hub. Parsing belongs beside git, so the
  daemon and the local executor return the same typed shape.
- A discovery scan instead of explicit registration, which is deferred in D7.

### D5. Worktree creation is an optional field on `enter_workspace` (Q4 A, Q9 A, Q10 A, Q17 B, Q18 A, Q20 A, Q21 A, Q25 A, Q26 A)

The input becomes
`{ path, worktree?: { name?, baseRef? } }`. `path` is the source clone, an
absolute local path or a `machine://` locator, and it keeps today's meaning and
its submitted-path decision.

With `worktree`, the call takes three decisions in order:

1. the submitted `path`, before any filesystem probe or git call, exactly as
   today;
2. the canonical source clone, by `realpath` and `stat`, the existing
   `canonical` decision, recorded with policy provenance;
3. the computed worktree directory, before `git.worktreeAdd` and before any
   write, recorded like the canonical one.

A read-only `git.inspect` of the source clone may run between decisions 2 and 3. It supplies the toplevel, the remotes, the linked-worktree fields, and the
display name. The source clone is the toplevel that `git.inspect` reports.
Classification stays `execute_code`, and every decision evaluates the
`enter_workspace` group.

The directory is:

- `<parent>/.llame-worktrees/<repository display name>/<slug>`, where
  `<parent>` is the parent directory of the real path of the source clone's
  toplevel;
- `<worktree_base>/<repository display name>/<slug>` when the source clone's
  main checkout carries `worktree_base`.

The target is canonicalized by resolving its deepest existing ancestor, the
same rule as the Machine daemon guard (`apps/machine/src/guard.ts`), and that
canonical form is the decided path. After `git.worktreeAdd`, the real path of
the new directory must equal the decided path; otherwise the call removes the
new worktree and fails `worktree_failed`. A bound lexical path would fail the
next attempt's `root_moved` re-check, and a symlinked parent would place files
where the policy never looked.

The name is the owner's or model's text when present, used as written, and
`<adjective>-<noun>-<4 hex>` from small checked-in word lists when absent. A
generated name retries with a new suffix until neither the directory nor the
branch exists. A supplied name that collides fails `worktree_failed`. A name
must not start with `-`, must not contain a `.` or `..` segment, and must pass
git's branch-name rules. The slug is the name with `/` replaced by `-`. The
branch is `llame/<name>`, unless `name` contains `/`, and then `name` is the
whole branch. `baseRef` defaults to the source clone's current HEAD, with no
fetch, and must not start with `-`. A bad name or base reference fails as
`invalid_input` before any probe.

On a Machine, the directory must lie inside a registered root, including its
nearest existing ancestor. The daemon's guard decides that before any git call,
and the hub does not trust its cached root list.

On success the call runs one fenced transaction. It creates the worktree
checkout row with origin `created` and the source main row as parent, writes
the lease, creates the adopted repository and main rows when the source is
unregistered, and commits the binding through
`WorkspaceBindingRepository.enter` in the same transaction. The fence is a
native attempt keyed by the tool call id, and both operation unions gain a
`worktree` operation. The result names the worktree root, the branch, and the
base commit, and `workspace_generation` increments once. A call from a Chat
already bound to the source clone is not a no-op: it creates the worktree and
switches the binding with one increment.

The source clone needs no prior registration: inspection creates the
repository and a main checkout with origin `adopted`, and no project link. A
source that `git.inspect` reports as a linked worktree is adopted as a
`worktree` row whose parent is its main clone, and that main clone is the
source for the new worktree.

A queue retry of a committed worktree entry replays the recorded result, binds
the same root, and creates no second worktree. A failure before the add writes
no repository, checkout, or lease row, and leaves the binding and its
generation unchanged. The codes are `invalid_path` or `invalid_input` for a bad
input, `not_found` for a missing source, `permission_denied` for a rejected
submitted or canonical path, `path_not_registered` outside a Machine root,
`worktree_failed` for a git failure, timeout, realpath mismatch, or
non-repository source, `machine_unavailable`, and `machine_update_required` for
a daemon without the git methods. A fence lost after the add, or a lost Machine
link after the add was sent, writes no rows and leaves the binding unchanged;
the second reports `outcome_unknown`, and the orphan directory stays on disk.

Rejected:

- A separate `create_worktree` tool. It splits one intent across two calls and
  two transition slots, and leaves a directory the model must remember to
  enter.
- A `git` tool with a command argument. The model would author argv, and the
  permission surface would be a string prefix match.
- A per-executor base such as `~/.llame/worktrees`. Paths would leave the
  owner's project tree and be harder to find and delete. The rejected answer to
  Q17 proposed naming worktrees after the Chat id; the generated name is
  readable in a tokenizer and in a shell prompt.
- Refusing an unregistered source clone, the rejected answer to Q26. That
  forces a registration call before every first worktree.
- Running `git worktree add` before the canonical decision, the rejected answer
  to Q25. That writes to disk for a path the policy may reject.
- Trusting the hub's cached Machine roots. The daemon owns the roots file.

### D6. Removal is owner-initiated, guarded, and row-only (Q12 A, Q27 B)

`DELETE /api/v1/checkouts/:id/worktree` takes a worktree checkout and runs one
guard sequence on its executor: `git.status` reports `dirty`, `ahead`, and
`upstream`; a dirty worktree is refused; a missing upstream is refused, because
the guard cannot prove the branch is pushed; a non-zero `ahead` is refused.
Only then does `git.worktreeRemove` run, and only after it succeeds does the
row and its lease disappear. The route passes the same gates as registration
(D4): a configured executor, `enter_workspace` in `tools.allowed`, and both the
submitted and canonical checkout path accepted by the `enter_workspace` group
in `default` mode. Every git call uses the sanitized environment, so the
repository's hooks and `core.fsmonitor` never run. No agent-facing removal
exists in this change. A later change can add `exit_workspace(remove)` with the
same guard.

Row deletion cascades rows and never files: deleting a repository deletes its
main and worktree checkout rows and their leases; deleting a main checkout
deletes its worktree rows. Directories stay on disk. A bound Chat keeps its
path string and detaches only through the per-attempt re-check it already has,
which is the same outcome as a directory the owner deletes by hand. The
rationale is recorded in the study: most Chats are archived without
`exit_workspace`, so a cascade that deleted files would delete work.

Rejected:

- Agent-initiated removal now, the rejected answer to Q12. The model cannot see
  unpushed work, and removal is a destructive action that needs an owner
  decision.
- Force removal with a confirmation, as Jean, bb, and Paseo do. The study marks
  that path as the cautionary tail.
- A tombstone plus a sweep, as Superset and Emdash do. Correct, and deferred
  with the sweep.
- Deleting directories when rows are deleted, the rejected answer to Q27.
  llame did not create every directory it knows, and an owner's uncommitted
  work is not llame's to delete.

### D7. Deferred, with the reason it waits

- Inventory sweep and `observed_status`. It needs a schedule, a Machine
  round-trip budget, and a "never auto-heal" rule. Intent rows first.
- Discovery scan (`inventory.scan`). It is a read surface over every registered
  root, with its own bounds and disclosure rules, and it is advisory only.
- Agent-initiated removal. It needs a permission group and a clean check that
  the model cannot see.
- An announcement of repositories to the model. The `workspace` producer
  already narrates the binding, and a second narration is a second truth.
- A project rail item. Projects gain repositories in `chat-start-location`.
- A composite parent root for multi-repo projects. The agent reaches siblings
  by absolute path or `..`, and permissions still evaluate the projected path.

## Risks / Trade-offs

- [A remote URL carries a token] -> normalization removes the userinfo part
  before storage, a test covers `https://token@host/o/r`, and no response echoes
  the submitted remote.
- [Owner host paths reach another owner] -> owner-only policies with FORCE RLS
  on all four tables, the `42501` to 404 mapping, a cross-owner `SELECT` that
  returns no rows, and negative isolation tests for read, insert, update, and
  delete.
- [One owner's path hides another owner's] -> the unique key includes
  `owner_user_id`, so two owners register one executor path and each sees only
  its own row.
- [An owner probes a host path through the HTTP route] -> every git route needs
  a configured executor and an allowlisted submitted and canonical path, and
  runs git with an empty hooks path and `core.fsmonitor=false`.
- [The API replica is not the named local executor] -> a non-Machine executor
  must equal the serving process's `tools.nativeExecutorId`, else the route
  answers 503 `executor_unavailable` without a git call.
- [An installed daemon lacks the git methods] -> the handshake lists the
  methods a daemon answers, the hub fails a git call as
  `machine_update_required` before any request, file tools keep working, and
  the operator page states the daemon update step.
- [A git credential prompt hangs a daemon] -> `GIT_TERMINAL_PROMPT=0`, no
  network operation, a per-call timeout, and a typed failure.
- [A caller string becomes a command line] -> typed methods take argv arrays
  built on the server, no route accepts a command, and a test asserts the argv
  shape for each method.
- [A worktree directory escapes a Machine root or a policy reject] -> the
  target is canonicalized by its deepest existing ancestor, the daemon guard
  decides before any git call and answers `path_not_registered`, and the local
  decision uses the same canonical form; tests cover a display name with `..`,
  a symlinked parent, and a symlinked `.llame-worktrees`.
- [Removal destroys unpushed work] -> refuse dirty, refuse ahead, fail closed
  on an unknown upstream, and one test per refusal.
- [A cascade surprises an owner] -> rows only, directories stay, and both the
  API response and the operator page say so.
- [Two registrations race on one path] -> unique
  `(owner_user_id, executor_id, path)` becomes a conflict response for that
  owner, and a test covers it.
- [Adoption records the wrong repository] -> inspection is the authority, an
  alias match only selects, and a mismatch is a validation error.
- [Nested clones and worktrees of worktrees confuse the tree] -> registration
  records the toplevel git reports, and a test covers a linked worktree path.
- [Lease rows accumulate with no release] -> leases are informational, cascade
  with their checkout, and no behavior depends on them.
- [A failed worktree creation leaves a half state] -> the checkout, lease,
  adopted, and binding writes share one fenced transaction, so no row appears
  and the generation does not change; a fence loss or a lost Machine link after
  the add reports the possible directory and writes no row.
- [A queue retry creates a second worktree] -> the add is one fenced native
  attempt keyed by the tool call id with a `worktree` operation, and a retry
  after a committed entry replays the recorded result.
- [A Machine checkout path and a binding root disagree] -> both store the
  canonical Machine locator, so registration and entry compare equal strings.
- [A stale `worktree_base` points outside a root] -> the placement is checked on
  every entry and fails as `path_not_registered` on a Machine or `not_found`
  locally.
- [The strict tool schema rejects the new field] -> the field is added to the
  strict object in the same layer as its tests, and every fixture that
  enumerates `enter_workspace` arguments is updated there.

## Migration Plan

- Four new tables and no change to an existing table or column:
  `repositories`, `repository_aliases`, `checkouts`, and `worktree_leases`.
  Each owner policy is declared with `pgPolicy`, and `.enableRLS()` emits
  `ENABLE ROW LEVEL SECURITY`. Only `FORCE ROW LEVEL SECURITY` is hand-appended
  in the migration, with the header rationale that `apps/api/src/db/AGENTS.md`
  requires, as for `projects` (`apps/api/src/db/schema/projects.ts:46-51`).
  Drizzle generates the migration. Review the generated SQL for both RLS
  statements, the policies, the composite owner foreign keys, the cascades, the
  unique constraints, and the CHECK enumerations. A second `db:generate` must
  produce no diff.
- No data backfill. Existing Chats keep their `workspace_root` strings, and
  nothing reads the new tables for them. A Chat bound to a directory that the
  owner later registers is unaffected; the row describes the directory, not
  the Chat.
- Protocol: `PROTOCOL_VERSION` stays at 1. The `hello` result gains an
  optional `methods` list; an old daemon omits it and the hub reads that as
  "no git methods". No handshake fails because of this change. The operator
  page gives the daemon update step for Machines that should offer worktrees.
- Rollback: revert the daemon methods and the `methods` list, remove the routes
  and the package, and drop the four tables in a down migration. Chats are
  unaffected: a binding to a deleted worktree directory detaches on its next
  attempt with `root_missing`, and worktree directories stay on disk as the
  owner's files.

## Open Questions

- The size and vocabulary of the generated-name word lists. A later change can
  grow them without a spec change.
- Whether `GET /api/v1/checkouts` needs pagination. The repository filter is
  enough until an owner registers many checkouts.
- Whether `checkouts` gains an observation column when the sweep lands (D7).

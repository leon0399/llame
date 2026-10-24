# Design

## Context

See proposal.md - Why. Current state that shapes the approach:

- The bound Workspace root is `chats.workspace_root`, `workspace_executor_id`, `workspace_generation`, `workspace_told`, `workspace_told_available`, `workspace_told_from`, and `workspace_detach_reason` (`apps/api/src/db/schema/chats.ts:151-166`), with a closed CHECK on the six detach reasons (`:175-178`). `WorkspaceBindingRepository` (`apps/api/src/chats/workspace-binding.repository.ts:37`, `:85`, `:121`) owns `enter`, `exit`, and `detach`. Every write is a generation compare-and-set.
- `enter_workspace` is one tool with one input field: `inputSchema: z.strictObject({ path: z.string().min(1) })` (`apps/api/src/tools/workspace.ts:479`). The strict object rejects unknown keys, so a new field is an explicit schema change. The call rejects a NUL or relative path as `invalid_path`, parses `machine://` first (`:486`), and decides the submitted path before any probe (`:501-511`). It canonicalizes with `realpath` and `stat` (`:179-190`), records the canonical decision with `kind: 'canonical'` (`:157-177`), and binds through `bindCanonicalRoot` (`:332`). `claimTransition` (`:294`) allows one Workspace transition per model step. Classification is `execute_code`.
- Permission projection for entry is two evaluations of the same `enter_workspace` group today: the submitted path and the canonical root (`openspec/specs/tool-call-permissions/spec.md:803`). Bypass admits both without evaluation (`:832`). The main-clone and worktree-directory evaluations are new in this change.
- Machines are operator-configured (`apps/api/src/instance-config/machines-config.ts:12-37`), addressed by the `machine://` grammar in `apps/api/src/machines/machine-locator.ts`, and reported through `machines_status` with a `roots jsonb` column (`apps/api/src/db/schema/machines-status.ts:26-62`). The daemon owns root enforcement: `RootGuard.resolvePath` refuses anything outside the registered roots with `path_not_registered` (`apps/machine/src/guard.ts:24-40`). Operators edit the roots file with `llame-machine roots add|list|remove` (`apps/machine/src/roots.ts`).
- The Machine protocol carries one version integer, `PROTOCOL_VERSION = 1` (`packages/machine-protocol/src/constants.ts:2`). The daemon compares it at the handshake and stops the session on a mismatch (`apps/machine/src/serve.ts:130-141`). The hub maps the refusal to `machine_unavailable` with reason `incompatible_version` (`apps/api/src/tools/machine-call.ts:117`, `:170`), which is also a closed status reason (`apps/api/src/machines/machines-status.ts:17`).
- Git is not modeled anywhere. No git library is installed in `apps/api`, `apps/machine`, or `packages/machine-protocol`. The only process runner is `node:child_process` (`packages/bash-executor/src/execute.ts:2`), and git reaches a repository today only as opaque `bash` text.
- Owner isolation is table-level: `projects` carries an owner policy and gets FORCE RLS hand-appended in the migration, because Drizzle emits `ENABLE` only (`apps/api/src/db/schema/projects.ts:12-16`). A cross-owner `SELECT` returns no rows. A cross-owner `UPDATE` or `DELETE` affects zero rows. An `INSERT` that names another owner fails with `42501`, which the API maps to 404.
- Fixtures and tests pin the `enter_workspace` argument shapes: `apps/api/src/testing/portable-tool-policy.ts`, `apps/api/src/testing/tool-permission-policy.ts`, `apps/api/src/instance-config/tool-permissions-config.test.ts`, and `apps/api/src/tools/workspace.test.ts`.

The evidence base is the
[project, repository, and machine association study](../../../docs/research/product-vision/2026-10-24-project-repository-machine-association.md)
and the 2026-10-24 grilling record cited by Q code below. Where the study's
earlier sketch differs from the settled decisions, the settled decisions win:
leases are informational (not enforced), no sweep ships, and
`owner-chat-forks` is unchanged.

## Goals / Non-Goals

**Goals:**

- One place answers "where does this repository exist", and registration, worktree entry, and a later chat start all read it.
- The hub and a Machine run the same typed git operations, so no owner or model string becomes a command line on either side.
- Entry keeps its ordered decisions, one-transition, generation-fenced contract: the submitted path, the canonical source clone, the inspected main clone, and the canonical worktree directory. The `worktree` field adds a placement rule, not a second path for the bound root.
- A failed worktree creation is invisible to the Chat: no repository, checkout, or lease row, no change of the bound root, one typed error.

**Non-Goals:**

- An observation column or a sweep. Intent rows only.
- A lease that refuses a second bound root.
- A git library dependency.
- Owner UI. The project page form and the picker belong to `chat-start-location`.
- Any change to a fork copy, the context rail, or project storage.

## Prior art

Twelve surveyed surfaces. The study's comparison table is the source. Each cell
names what this design takes or avoids.

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

- O1. No peer supports one repository in several projects and one project with several repositories. Identity by remote loses the first. Identity by path loses rename tolerance. This change takes identity by remote and defers the project link.
- O2. Every peer that models machines records `(thing, host, path)`. Nobody indexes that row by a stable repository key. This design does.
- O3. The removal guards that survive contact with users refuse dirty trees and unpushed commits. The force paths are the cautionary tail.
- O4. Seven independent daemons converged on the same git surface, and none accepts a command string.
- O5. The reconciliation discipline that survives is "observe, mark, never auto-heal". This change ships intent rows and defers observation rather than a partial delivery.

## Decisions

### D1. Repository identity is a normalized remote plus declared aliases (Q1 A, Q2 A)

`repositories` holds `id`, `owner_user_id`, `display_name`, `canonical_remote`
(nullable), and unique `(owner_user_id, canonical_remote)`. Normalization is
pure and total:

- `git@github.com:leon0399/llame.git` and `https://github.com/leon0399/llame` both become `github.com/leon0399/llame`.
- A URL userinfo part, which can carry a token, is removed before storage.
- The host is lowercased and the path keeps its case.
- The normalizer removes the slash at the end and one `.git` suffix.
- A string that is not a remote keeps its trimmed text.

`repository_aliases` holds `(owner_user_id, repository_id, canonical_alias)`
with unique `(owner_user_id, canonical_alias)`, so an owner can declare a
rename or a fork equal to one repository. A null `canonical_remote` is a valid
repository, identified by its first checkout. Both tables carry an owner-only
policy declared with `pgPolicy` and `.enableRLS()`, with only
`FORCE ROW LEVEL SECURITY` hand-appended in the migration, as `projects` does
(`apps/api/src/db/schema/projects.ts:46-51`).

Rejected:

- A root-commit witness, alone or as a set of identity witnesses. A shallow clone has no root commit, and template-derived repositories share one.
- A three-tier identity with validity intervals. That is more than the per-machine record needs, and it duplicates history that git already keeps.
- A hub-wide shared repository catalog with per-owner subscriptions. A shared table of remote URLs is a cross-owner disclosure path in an RLS product.
- Identity by path, as Emdash, Jean, and Synara do. A rename or a move creates a new identity, and one repository cannot serve two projects.
- Derive the project from the remote, as Shipyard, Orca, and Paseo do. Two clones of one remote collapse into one project.

### D2. A checkout is a per-executor record (Q7 A, Q16 A, Q16' A, Q19 A)

`checkouts` holds `id`, `owner_user_id`, `repository_id`, `executor_id`,
`path`, `kind` (`main` or `worktree`), `parent_checkout_id`, `branch`,
`origin` (`registered`, `adopted`, or `created`), and `worktree_base`, with
unique `(owner_user_id, executor_id, path)`. The owner column is part of the
key because all owners share the local executor and every Machine. A global
key turns a second owner's registration into a conflict, and that conflict
discloses that another owner holds the path. `executor_id` uses the current
grammar: the local native executor id or `machine:<name>`.

`path` is the canonical form on that executor. A local checkout uses the
canonical absolute path. A Machine checkout uses the canonical Machine locator
(`machine://<name>/<abs path>`). That is the same form as
`chats.workspace_root`, so a checkout and a bound root compare equal as strings. A
worktree row names its source `main` row in `parent_checkout_id`. Both rows
share one executor, which the repository layer enforces and a test asserts.

`branch` is nullable: a registered or adopted row with a detached HEAD stores
no branch, and a worktree created by llame always has a branch. `worktree_base`
is set on main rows only, and the `PATCH` route rejects it on a worktree row.
Its value MUST use the executor of that main checkout: an absolute host path
for a local checkout, and `machine://<same name>/...` for a Machine checkout.
Another executor fails with 422.

Every child row uses a composite owner foreign key `(owner_user_id, x_id)` to
`(owner_user_id, id)` of its parent, with a unique `(owner_user_id, id)` key on
every parent: checkouts to repositories, a worktree checkout to its parent
checkout, leases to checkouts, leases to chats, and aliases to repositories.
Every one carries `ON DELETE CASCADE`. A single-column key lets a row name
another owner's parent, because a foreign-key check ignores RLS. A cascade then
deletes across owners.

There is no foreign key to `machines_status`, which the hub probe rewrites, and
no `observed_status` column in this change. An unreachable Machine leaves its
checkouts inert, the way it leaves a bound root in place today.

Rejected:

- The path on the project-to-repository link. It duplicates one path across every project that shares a repository. It turns a move into N row updates, and hides from the inventory that two projects write one tree.
- Git as the only registry, with no rows. Then no record says which Chat created a worktree, and a lost directory is indistinguishable from one never created.
- One path per repository. A repository exists on several executors, and a remote clone can sit at two paths on one executor.
- A global unique `(executor_id, path)`. One Machine is operator-wide, so a second owner's registration of a held path becomes a conflict, which is a cross-owner existence oracle on host paths.
- An observation column now, or a foreign key to `machines_status`. The probe rewrites status rows, and observation without the sweep is a field that only ever says `present`.

### D3. A lease is an informational receipt (Q5)

`worktree_leases` holds `id`, `owner_user_id`, `chat_id`, `checkout_id`,
`base_ref`, and `created_at`, written when a Chat creates a worktree. It
refuses nothing: a second Chat can bind a leased path, and a fork copies its
bound root as `owner-chat-forks` does today.

`GET /api/v1/checkouts` is the owner surface for the receipt: for every row it
returns the ids of the owner's chats whose bound root equals the row's path.
A worktree row also returns the lease chat id. Leases cascade with their
checkout, and their `chat_id` and `checkout_id` are composite owner foreign
keys as in D2.

Rejected: an enforced lease, with one active lease per worktree and a refusal
for a second bound root, as the study's earlier sketch had. Enforcement needs a
release lifecycle, a lost-lease state, and a fork rule. Every one of them is a
new failure mode for a receipt the owner can read.

The concurrency hint that a UI needs comes from the bound root and the lease
together, without a refusal. The study's OD4 (fork of a leased Chat) disappears
with enforcement.

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
`linked` flag, and `mainWorktree` for a linked worktree. Registration and adoption need those fields to store a linked worktree as a `worktree` row whose parent is the main clone. They run no `git.worktreeList` call.

Every call spawns `git` with an argv array, never a shell string, and a fixed
environment: `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, and `GIT_OPTIONAL_LOCKS=0`
on every call. It runs with `-c core.hooksPath=<empty directory>` and
`-c core.fsmonitor=false`, so a repository's own configuration never starts a
command as the hub or daemon user.

Each caller value MUST either fail as invalid input when it starts with `-` (a
name, a branch, or a base ref) or follow `--end-of-options`, or `--` where the
subcommand takes it. Paths are absolute paths. Each call has a timeout. A
non-zero exit becomes a typed result that carries bounded, redacted standard
error. No operation fetches, pushes, or contacts a network. An operation
rejects a `name` or `baseRef` that starts with `-` as invalid input before git
starts.

The owner API is `POST`/`GET /api/v1/repositories`,
`PATCH`/`DELETE /api/v1/repositories/:id`,
`POST /api/v1/repositories/:id/aliases`,
`POST /api/v1/checkouts` with `{ path, repositoryId? | remote? }`,
`GET /api/v1/checkouts?repositoryId=`, `PATCH /api/v1/checkouts/:id` with
`{ worktreeBase }` on a `main` checkout, `DELETE /api/v1/checkouts/:id`, and
`DELETE /api/v1/checkouts/:id/worktree`.

Registration takes one `path`: an absolute local path or a
`machine://<name>/<abs>` locator. The executor is derived: a local path runs on
the `tools.nativeExecutorId` of the process that serves the request, and a
locator names
`machine:<name>`. An unset native id, or a locator that names no configured
Machine, fails as `executor_unavailable` (503). No git method starts and no row
is stored in either case.

`enter_workspace` must be in `tools.allowed`, else `tool_not_allowed` (403).
The submitted path and its canonical form are both evaluated under the
`enter_workspace` group in `default` mode, with the same reject rules as entry.
A reject or no allow answers `permission_denied` (403). A Machine path is
evaluated in its locator form, as `projectNativeFilePath` projects it, so a
local rule cannot admit a remote address.

After inspection and before any write, the call evaluates the inspected
toplevel under the same group, when it differs from the decided canonical path.
For a linked worktree, it evaluates the main clone instead.

No git call runs before those gates pass, so a route cannot probe a host path
that the owner cannot enter. The process that serves the request runs the local
inspection. A split topology therefore needs that process to hold the derived
executor, and answers `executor_unavailable` otherwise.

Registration always inspects. The inspected origin decides the repository: an
input that names a repository or a remote only selects, and a mismatch with
the inspected origin is a validation error. The canonical remote is the remote
named `origin`. A clone without `origin` has no remote.

A remote-less clone takes the repository input, or gets a new remote-less
repository. Adoption derives the display name from the last segment of the
canonical remote, else from the toplevel basename, sanitized to one path
segment. A linked worktree is stored as a `worktree` row whose parent is its
main clone, from `git.inspect`'s `linked` and `mainWorktree` fields.

Failures map to HTTP as follows. 404 for a missing or foreign id, with no
existence leak. 409 for a duplicate path in the owner's catalog. 422 for an
origin mismatch, an invalid name or base reference, or `not_a_repository` for
a path that is not a git repository. 502 `git_failed` with redacted standard
error for another git failure, such as a timeout. 503 with a typed code for
`machine_unavailable`, `machine_update_required`, or `executor_unavailable`.

The daemon gains the five methods and the hub gains their local counterparts.
The protocol version stays at 1: the methods are additive, and the `hello`
result gains an optional `methods` list that names the git methods the daemon
answers. A daemon that omits the list predates them.

The hub refuses a git call on such a Machine as `machine_update_required`
before any request, and every other Machine operation still works. This
follows the additive camp (Emdash, Paseo) over bb's version-table camp. A
version bump takes `read` and `bash` away from every Machine until the operator
updates it.

Rejected:

- Git through `bash` or `proc.bash`. That is a model-authored command string, outside the `enter_workspace` group, unbounded in effect, and invisible to the typed result.
- A caller-declared origin without inspection, which the rejected answer to Q23 proposed. A stale remote or a wrong repository id becomes fact.
- A git library such as `simple-git` or `isomorphic-git`. It adds a dependency to both sides for argv, environment, and timeout control that this package owns in a hundred lines. Its porcelain parse then sits away from the git process.
- Raw porcelain text returned to the hub. A parse belongs beside git, so the daemon and the local executor return the same typed shape.
- A discovery scan instead of explicit registration, which is deferred in D7.

### D5. Worktree creation is an optional field on `enter_workspace` (Q4 A, Q9 A, Q10 A, Q17 B, Q18 A, Q20 A, Q21 A, Q25 A, Q26 A)

The input becomes
`{ path, worktree?: { name?, baseRef? } }`. `path` is the source clone, an
absolute local path or a `machine://` locator, and it keeps its current contract and its submitted-path decision.

With `worktree`, the call takes four decisions in order:

1. the submitted `path`, before any filesystem probe or git call, exactly as today.
2. the canonical source clone, by `realpath` and `stat`, recorded as the `canonical` derived decision with policy provenance.
3. after `git.inspect` and before any write, the inspected main tree. That is the toplevel, or the `mainWorktree` of a linked worktree by its real path. The call records it as the `main_clone` derived decision when it differs from decision 2.
4. the computed worktree directory, before `git.worktreeAdd` and before any write, recorded as the `worktree_directory` derived decision.

`main_clone` and `worktree_directory` are new `DerivedLocatorKind` values
beside `canonical`, so stored provenance tells the three records of one call
apart. A read-only `git.inspect` of the source clone runs between decisions 2
and 3. It supplies the toplevel, the remotes, the linked-worktree fields, and
the display name. The source clone is the toplevel that `git.inspect` reports.
Classification stays `execute_code`, and every decision evaluates the
`enter_workspace` group with the same reject rules as entry.

The directory is:

- `<parent>/.llame-worktrees/<repository display name>/<slug>`, where `<parent>` is the parent directory of the real path of the source clone's toplevel.
- `<worktree_base>/<repository display name>/<slug>` when the source clone's main checkout carries `worktree_base`.

The call canonicalizes the target through its deepest ancestor that exists,
the same rule as the Machine daemon guard (`apps/machine/src/guard.ts`). That
canonical form is the decided path. After `git.worktreeAdd`, the real path of
the new directory MUST equal the decided path. Otherwise the call removes the
new worktree and fails `worktree_failed`. A bound lexical path fails the next
attempt's `root_moved` re-check, and a symlinked parent places files where the
policy never looked.

The name is the owner's or model's text when present, and the call uses it as
written. When absent, the name is `<adjective>-<noun>-<4 hex>` from small
checked-in word lists. A generated name retries with a new suffix until neither
the directory nor the branch exists. A supplied name that collides fails
`worktree_failed`.

A name MUST NOT start with `-`, MUST NOT contain a `.` or `..` segment, and
MUST pass git's branch-name rules. The slug is the name with `/` replaced by
`-`. The branch is `llame/<name>`, unless `name` contains `/`. In that case
`name` is the whole branch. `baseRef` defaults to the source clone's current
HEAD, with no fetch, and MUST NOT start with `-`. A bad name or base reference
fails as `invalid_input` before any probe.

On a Machine, the directory MUST lie inside a registered root, and the check
uses its nearest ancestor that exists. The daemon's guard decides that before any git call,
and the hub does not trust its cached root list.

On success the call runs one transaction under the current fence. It
creates the worktree checkout row with origin `created` and the source main row
as parent. It writes the lease and creates the adopted repository and main rows
when the source is unregistered. It commits the bound root through
`WorkspaceBindingRepository.enter`, which receives the transaction. Before
`git.worktreeAdd`, the worker appends a `native.attempt` with the new `worktree`
operation. `'worktree'` joins the `NativeFilesRepository.begin` operation union
and `MachineMutationTarget.operation`.

That attempt's `native.result` arrives inside the same transaction as the rows.
The result names the worktree root, the branch, and the base commit, and
`workspace_generation` increments once. A call from a Chat already bound to the
source clone is not a no-op: it creates the worktree and switches the bound root
with one increment.

Adoption inserts or selects on its unique keys inside the transaction. A
concurrent adoption of one clone then reuses the winner's repository and main
checkout rows. The source clone needs no prior registration, and the call
creates no project link. A source that `git.inspect` reports as a linked
worktree becomes a `worktree` row whose parent is its main clone. That main
clone is the source for the new worktree.

A redelivered Run that carries the recorded `native.attempt` fails as
`outcome_unknown`, per the canonical rule in
`openspec/specs/tool-calling/spec.md`. It does not replay its loop, so it
creates no second worktree. A crash or a fence loss before the commit leaves an
orphan directory and no checkout, lease, adopted row, or bound root. A failure
before the add writes no repository, checkout, or lease row, and leaves the
bound root and its generation unchanged.

The codes are these. `invalid_path` or `invalid_input` covers a bad input.
`not_found` covers a missing source. `permission_denied` covers a rejected
decision.

`path_not_registered` covers a path outside a Machine root. `worktree_failed`
covers a git failure, a timeout, or a non-repository source.
`machine_unavailable` or `machine_update_required` covers the Machine cases.

A fence lost after the add writes no row, keeps the bound root, and reports
`executor_unavailable` with `leftDirectory` that holds the directory that remains.
A lost Machine link after the add was sent reports `outcome_unknown`, and the
orphan directory stays on disk.

Rejected:

- A separate `create_worktree` tool. It splits one intent across two calls and two transition slots, and leaves a directory the model must remember to enter.
- A `git` tool with a command argument. The model authors argv, and the permission surface is a string prefix match.
- A per-executor base such as `~/.llame/worktrees`. Paths leave the owner's project tree and are harder to find and delete. The rejected answer to Q17 proposed a worktree name from the Chat id. The generated name is readable in a tokenizer and in a shell prompt.
- A refusal of an unregistered source clone, the rejected answer to Q26. That forces a registration call before every first worktree.
- A `git worktree add` before the canonical decision, the rejected answer to Q25. That writes to disk for a path the policy can reject.
- Trust in the hub's cached Machine roots. The daemon owns the roots file.

### D6. Removal is owner-initiated, guarded, and row-only (Q12 A, Q27 B)

`DELETE /api/v1/checkouts/:id/worktree` takes a worktree checkout and runs one
guard sequence on its executor: `git.status` reports `dirty`, `ahead`, and
`upstream`. A dirty worktree is refused. A missing upstream is refused, because
the guard cannot prove the branch is pushed. A non-zero `ahead` is refused.

Only then does `git.worktreeRemove` run, and only after it succeeds does the
row and its lease disappear. The route passes the same gates as registration
(D4): a derived executor that is configured, `enter_workspace` in
`tools.allowed`, and both the submitted and canonical checkout path accepted by
the `enter_workspace` group in `default` mode. Every git call uses the
sanitized environment, so the repository's hooks and `core.fsmonitor` never
run. No agent-facing removal exists in this change. A later change can add
`exit_workspace(remove)` with the same guard.

Row deletion cascades rows and never files: a repository delete removes its main
and worktree checkout rows and their leases. A main-checkout delete removes its
worktree rows. Directories stay on disk. A bound Chat keeps its
path string. It detaches only through the per-attempt re-check it already has,
which is the same outcome as a directory the owner deletes by hand.

The study records the rationale: most Chats are archived without
`exit_workspace`, so a cascade that deletes files deletes work.

Rejected:

- Agent-initiated removal now, the rejected answer to Q12. The model cannot see unpushed work, and removal is a destructive action that needs an owner decision.
- Force removal with a confirmation, as Jean, bb, and Paseo do. The study marks that path as the cautionary tail.
- A tombstone plus a sweep, as Superset and Emdash do. That is correct, and deferred with the sweep.
- A directory delete when rows are deleted, the rejected answer to Q27. llame did not create every directory it knows, and an owner's uncommitted work is not llame's to delete.

### D7. Deferred, with the reason it waits

- Inventory sweep and `observed_status`. It needs a schedule, a Machine round-trip budget, and a "never auto-heal" rule. Intent rows first.
- Discovery scan (`inventory.scan`). It is a read surface over every registered root, with its own bounds and disclosure rules, and it is advisory only.
- Agent-initiated removal. It needs a permission group and a clean check that the model cannot see.
- An announcement of repositories to the model. The `workspace` producer already narrates the bound root, and a second narration is a second truth.
- A project rail item. Projects gain repositories in `chat-start-location`.
- A composite parent root for multi-repo projects. The agent reaches siblings by absolute path or `..`, and permissions still evaluate the projected path.

## Risks / Trade-offs

- [A remote URL carries a token] -> normalization removes the userinfo part before storage, a test covers `https://token@host/o/r`, and no response echoes the submitted remote.
- [Owner host paths reach another owner] -> the owner-only policy and FORCE RLS on all four tables. The `42501` to 404 map hides a foreign id. A cross-owner `SELECT` returns no rows, and negative isolation tests cover read, insert, update, and delete.
- [One owner's path hides another owner's] -> the unique key includes `owner_user_id`. Two owners register one executor path, and each sees only its own row.
- [An owner probes a host path through the HTTP route] -> every git route needs a derivable, configured executor. The route allowlists the submitted, canonical, and inspected main-clone paths. Each call runs git with an empty hooks path and `core.fsmonitor=false`.
- [The API replica is not the named local executor] -> a local path must run on the `tools.nativeExecutorId` of the process that serves the API. Else the route answers 503 `executor_unavailable` without a git call.
- [An installed daemon lacks the git methods] -> the handshake lists the methods a daemon answers. The hub fails a git call as `machine_update_required` before any request, file tools still work, and the operator page states the daemon update step.
- [A git credential prompt hangs a daemon] -> `GIT_TERMINAL_PROMPT=0`, no network operation, a per-call timeout, and a typed failure.
- [A caller string becomes a command line] -> typed methods take argv arrays that the server builds. No route accepts a command, and a test asserts the argv shape for each method.
- [A worktree directory escapes a Machine root or a policy reject] -> the call canonicalizes the target through its deepest ancestor that exists. The daemon guard decides before any git call and answers `path_not_registered`. The local decision uses the same canonical form. Tests cover a display name with `..`, a symlinked parent, and a symlinked `.llame-worktrees`.
- [Removal destroys unpushed work] -> refuse dirty, refuse ahead, fail closed on an unknown upstream, and one test per refusal.
- [A cascade surprises an owner] -> rows only, directories stay, and both the API response and the operator page say so.
- [Two registrations race on one path] -> the unique `(owner_user_id, executor_id, path)` key becomes a conflict response for that owner, and a test covers it.
- [Adoption records the wrong repository] -> inspection is the authority, an alias match only selects, and a mismatch is a validation error.
- [Nested clones and worktrees of worktrees confuse the tree] -> registration records the toplevel that git reports, and a test covers a linked worktree path.
- [Lease rows accumulate with no release] -> leases are informational, cascade with their checkout, and no behavior depends on them.
- [A failed worktree creation leaves a half state] -> the checkout, lease, adopted, and bound-root writes share one transaction under the fence. No row appears and the generation does not change. A crash or a fence loss before the commit leaves an orphan directory, and the call reports it.
- [Two Chats adopt one clone at once] -> adoption inserts or selects on its unique keys inside the transaction. Both calls reuse one repository and one main checkout row.
- [A queue retry creates a second worktree] -> the worker records a `native.attempt` with the `worktree` operation before the add. A redelivered Run then fails as `outcome_unknown` and creates no second worktree.
- [A Machine checkout path and a bound root disagree] -> both store the canonical Machine locator, so registration and entry compare equal strings.
- [A stale `worktree_base` points outside a root] -> placement canonicalizes the directory through its deepest ancestor that exists. Git creates missing parents, and a Machine placement outside every root fails as `path_not_registered` before any git call.
- [The strict tool schema rejects the new field] -> the field joins the strict object in the same layer as its tests. Every fixture that enumerates `enter_workspace` arguments changes there.

## Migration Plan

- Four new tables and no change to a table or column that exists: `repositories`, `repository_aliases`, `checkouts`, and `worktree_leases`. Each owner policy is declared with `pgPolicy`, and `.enableRLS()` emits `ENABLE ROW LEVEL SECURITY`. Only `FORCE ROW LEVEL SECURITY` is hand-appended in the migration, with the header rationale that `apps/api/src/db/AGENTS.md` requires, as for `projects` (`apps/api/src/db/schema/projects.ts:46-51`). Drizzle generates the migration. Review the generated SQL for both RLS statements, the policies, the composite owner foreign keys, the cascades, the unique constraints, and the CHECK enumerations. A second `db:generate` must produce no diff.
- No data backfill. Current Chats keep their `workspace_root` strings, and nothing reads the new tables for them. A Chat bound to a directory that the owner later registers is unaffected. The row describes the directory, not the Chat.
- Protocol: `PROTOCOL_VERSION` stays at 1. The `hello` result gains an optional `methods` list. An old daemon omits it, and the hub reads that as "no git methods". No handshake fails because of this change. The operator page gives the daemon update step for Machines that must offer worktrees.
- Rollback: revert the daemon methods and the `methods` list, remove the routes and the package, and drop the four tables in a down migration. Chats are unaffected: a Chat bound to a deleted worktree directory detaches on its next attempt with `root_missing`, and worktree directories stay on disk as the owner's files.

## Open Questions

- The size and vocabulary of the generated-name word lists. A later change can grow them without a spec change.
- Whether `GET /api/v1/checkouts` needs pagination. The repository filter is enough until an owner registers many checkouts.
- Whether `checkouts` gains an observation column when the sweep lands (D7).

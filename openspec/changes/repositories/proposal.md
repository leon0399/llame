## Why

llame records where a Chat runs, but not what it runs on. `enter_workspace`
binds any absolute path or `machine://` locator that the model names. No record
says that two clones are the same repository, or that a worktree belongs to a
clone. No record says that a directory is a checkout at all.

Every session starts unbound or from a retyped path. Two Chats on one clone
edit the same files.

Decision provenance: the design was settled in a grilling session with Leo on
2026-10-24, recorded against the
[project, repository, and machine association study](../../../docs/research/product-vision/2026-10-24-project-repository-machine-association.md).
No issue tracks it. Leo decided on 2026-10-24 to proceed without one, as for
`remote-machines`.

## What Changes

- New owner-scoped repository catalog. A repository has a display name and an optional normalized remote. Normalization is pure: it removes the scheme and the credentials, lowercases the host, and strips `.git` and the slash at the end. `git@github.com:leon0399/llame.git` and `https://github.com/leon0399/llame` are one repository. The owner declares aliases for renames and forks. A remote-less repository takes its identity from its first checkout.
- New checkouts. A checkout records that one repository exists at one canonical path on one executor (the local executor or `machine:<name>`). It has kind `main` or `worktree`, a parent main checkout for a worktree, its branch (nullable for a detached registration or adoption), and its origin (`registered`, `adopted`, or `created`). One path per owner and executor is one checkout. A local checkout stores the canonical absolute path. A Machine checkout stores the canonical Machine locator (`machine://<name>/<abs path>`), the same form as the bound root of a Chat.
- New informational worktree leases. A lease records which Chat created a worktree, from which base ref, and the base commit that `git.worktreeAdd` reports. It refuses nothing. A second Chat can bind a leased path, and a fork copies its bound root as today.
- New owner API for repositories, aliases, checkouts, and guarded worktree removal. Registration takes one `path`, an absolute local path or a `machine://<name>/<abs>` locator, and derives the executor from it. It inspects the path on that executor and trusts the inspected origin over any caller-declared one. It runs git only when the executor is configured and the submitted, canonical, and inspected main-clone paths pass the `enter_workspace` permission group. A missing allow answers 403 `tool_not_allowed`. Failures answer 403, 404, 409, 422, 502, or 503 with a typed code. An unreachable Machine answers 503 `machine_unavailable`.
- New typed git operations, `git.inspect`, `git.worktreeAdd`, `git.worktreeList`, `git.worktreeRemove`, and `git.status`. They take argv arrays. Each caller value either fails as invalid input when it starts with `-` (a name, a branch, or a base ref) or follows `--end-of-options`, or `--` where the subcommand takes it. They run with `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`, an empty hooks path, `core.fsmonitor=false`, and a per-call timeout. A failure is typed and carries git standard error. The hub's local executor runs them in-process. A Machine daemon answers them as protocol methods.
- No break for installed daemons: the Machine protocol version stays at 1, and the git methods are additive. The handshake result lists the git methods that a daemon answers. A Machine whose daemon lists none fails a git call as `machine_update_required` before any request, while its file tools and `bash` still work. The operator page names the daemon update step.
- `enter_workspace` gains one optional `worktree` field with an optional `name` and `baseRef`. With it, entry creates a worktree of the source clone. It records a worktree checkout and a lease, and it binds the new directory, even when the Chat already binds the source clone. Without it, entry behaves exactly as today.
- Worktree placement is `<parent>/.llame-worktrees/<display name>/<slug>`. `<parent>` is the parent of the real path of the source clone's toplevel, unless the main checkout carries a `worktree_base` override. The call canonicalizes the target through its deepest ancestor that exists before the decision. After `git.worktreeAdd`, the real path of the new directory MUST equal the decided path. Else the call removes the worktree and fails `worktree_failed`.
- Worktree name rule: the name is `<adjective>-<noun>-<4 hex>` when absent, and a generated name retries on collision. The call uses a supplied name as written. A collision fails `worktree_failed`. A name MUST NOT start with `-`, MUST NOT contain a `.` or `..` segment, and MUST pass git's branch-name rules. The directory slug is the name with `/` replaced by `-`. The branch is `llame/<name>` unless the name contains `/`. The base ref defaults to the source clone's current HEAD, with no fetch, and MUST NOT start with `-`.
- Worktree entry decides four paths in order. First the submitted `path`, before any probe or git call. Second the canonical source clone by `realpath`, as today. Third the inspected main tree after `git.inspect`, when it differs from the canonical path. Fourth the computed worktree directory, before `git.worktreeAdd` and any write. The source clone is the toplevel that `git.inspect` reports. The last three record the `canonical`, `main_clone`, and `worktree_directory` derived-decision kinds. Every decision evaluates the `enter_workspace` group. Classification stays `execute_code`.
- An unregistered source clone is adopted in the same call. Inspection records the repository by normalized remote, or remote-less, and a main checkout with origin `adopted`. A linked worktree uses its main clone as source and parent. No project link is created.
- A failed `git worktree add` returns `worktree_failed` with redacted git standard error. The call writes no repository, checkout, or lease rows, and the bound root and its generation stay unchanged. A source that is not a git repository, a git timeout, an offline Machine, and a daemon without the git methods fail the same way. They answer `machine_unavailable` or `machine_update_required` where those apply.
- Worktree entry is atomic. The checkout row, the lease row, the adopted rows, and the bound root commit in one transaction under the current fence. The worker appends a `native.attempt` with the new `worktree` operation before `git.worktreeAdd`, and its `native.result` in that transaction. A redelivered Run that carries a recorded attempt fails as `outcome_unknown` and does not replay its loop, so it creates no second worktree. This change MODIFIES the `tool-calling` registry requirement for that attempt. A plain entry and exit still record no attempt and stay idempotent after their state change commits. A fence loss after the add reports `executor_unavailable` with the remaining directory. A lost Machine link reports `outcome_unknown`.
- Worktree removal is owner-initiated and guarded. It refuses a dirty worktree. It refuses commits ahead of the upstream. It fails closed when the upstream is unknown, unless HEAD equals the base commit recorded at creation. The branch stays, so a clean removal loses no commit. No agent-facing removal exists in this change.
- Row deletion cascades rows and never files. A repository delete deletes its checkouts and leases. A main-checkout delete deletes its worktree rows. The directories stay on disk. Chats keep their path strings until the current per-attempt re-check detaches them.

## Assumptions, confirmed with Leo

The grilling session settled these on 2026-10-24. Each code names one answered
question in the grilling record behind the research note.

- Repository identity is a normalized remote with owner-declared aliases, and not a root-commit witness or a shared hub-wide catalog (Q1 A, Q2 A).
- A checkout is the per-executor record. The path is recorded once per repository and executor, not per project (Q7 A, Q16 A, Q16' A).
- Registration always inspects the executor. A typed repository or remote input only selects. The inspected origin is the authority (Q23 B).
- Worktree leases are informational receipts that refuse nothing, so `owner-chat-forks` stays unchanged (Q5).
- Worktree creation is an option on `enter_workspace`, not a second tool. The agent addresses clones by path, not by repository alias (Q9 A, Q10 A).
- The call decides the submitted clone before any probe, and the computed directory before any write. A read-only inspection can run between them. The call decides the inspected main clone after that inspection (Q25 A).
- The worktree name is an optional parameter. A generated name is `<adjective>-<noun>-<4 hex>`, and one name derives both the directory slug and the branch (Q17 B, Q20 A, Q21 A).
- The base ref is the source clone's current HEAD, with no fetch (Q18 A).
- A worktree is placed under a `.llame-worktrees` directory beside the source clone, overridable per main checkout. A Machine path MUST lie inside a registered root (Q4 A).
- The call adopts an unregistered source clone on worktree entry rather than a refusal of it (Q26 A).
- Removal is owner-initiated and guarded. The agent cannot remove a worktree in this change. Row deletes cascade rows and never files (Q12 A, Q27 B).
- Typed git methods on the executors, narrow rather than a generic `git.run` (Q16 A, Q16' A).
- No inventory sweep and no observed status in this change (Q19 A).

## Assumptions that follow, never asked

These are consequences the grilling session did not put to Leo. Each is small,
and a later change can reverse it without a data migration.

- The repository display name is one path segment. The API rejects a name that contains `/`, a NUL byte, or is `.` or `..`, because the worktree directory embeds the name. Adoption derives a valid name from the last segment of the canonical remote, else from the toplevel basename.
- A generated name retries with a new hex suffix until neither the directory nor the branch exists. The call uses a requested name verbatim. A collision fails as `worktree_failed` rather than a silent rename.
- Registration stores a path that git reports as a linked worktree as a `worktree` row. Its parent is the main clone that git names, not a `main` row.
- The owner sets `worktree_base` through `PATCH /api/v1/checkouts/:id` on a `main` checkout, and the route rejects it on a `worktree` row. It MUST use the executor of that main checkout: an absolute host path for a local checkout, and `machine://<same name>/...` for a Machine checkout. Else the route answers 422.
- The registration and removal routes derive the executor from the submitted `path`. They run git only when it is configured and the path is allowlisted. The route evaluates both submitted and canonical paths under the `enter_workspace` group. Every git call disables hooks and fsmonitor. A failure answers 403, 404, 409, 422, 502, or 503 with a typed code.
- Two concurrent registrations of one path by one owner resolve through the unique `(owner_user_id, executor_id, path)` constraint as a conflict response, not a merge. Two concurrent adoptions of one clone reuse one repository and one main checkout row.
- `GET /api/v1/checkouts` filters by repository only, with no pagination, until an owner reports enough checkouts to need it. Every row lists the ids of the owner's chats whose bound root equals its path. A worktree row also lists its lease chat.

## Deviation from the grilling record

- The record settled a protocol version bump, with an older daemon that answers `method_not_found`. That pair cannot work. The daemon stops the session on any version mismatch (`apps/machine/src/serve.ts:130-141`). A bump therefore removes `read` and `bash` from every Machine until the operator updates the daemon, and the old daemon never answers any method. This change keeps `PROTOCOL_VERSION` at 1. It adds the git methods as additive methods and adds the optional `methods` list to the handshake result. A daemon that omits the list fails a git call as `machine_update_required` before any request. Leo MUST confirm this replacement.

## Capabilities

### New Capabilities

- `repositories`: the owner's repository catalog, checkouts on executors, worktree leases, typed git operations on the hub and on a Machine, guarded worktree removal, and row-only cascades. Requirements:
  - Repositories are owner-scoped records with a display name
  - The canonical remote comes from the `origin` remote
  - Checkouts record one repository on one executor
  - A Machine checkout stores the canonical Machine locator
  - Worktree checkouts are children of a main checkout
  - A main checkout can carry a worktree base directory
  - Worktree leases are informational ownership receipts
  - Checkout lists report the lease chat and every bound chat
  - Checkout registration inspects the path on its executor
  - Registration and removal need a configured executor
  - Registration and removal obey the host access policy
  - Registration and removal map failures to typed statuses
  - Git calls cannot run repository hooks or monitors
  - Executors expose typed git operations
  - Git calls refuse option-like caller values
  - Worktree removal is owner-initiated and guarded
  - Repository and checkout deletion cascades records and never files
  - Repository records are isolated per owner

### Modified Capabilities

- `workspace-entry`: one MODIFIED requirement and six ADDED requirements. The MODIFIED block is "The Workspace binding is Chat-scoped and persists across Runs": model input contains only `path` and an optional `worktree` object with only `name` and `baseRef`. Every prohibition and scenario stays. Requirements:
  - The Workspace binding is Chat-scoped and persists across Runs (MODIFIED)
  - Workspace entry can create a worktree of the source clone
  - Worktree names, branches, and base refs follow one rule
  - Worktree placement follows the source clone and its worktree base
  - An unregistered source clone is adopted on worktree entry
  - Worktree creation failure leaves the binding unchanged
  - Worktree entry is fenced and atomic
- `remote-machines`: the daemon's typed git methods, their sanitized environment, their locator forms, and the registered-root rule for a worktree directory. Requirements:
  - Machine daemons answer typed git methods
  - Git methods are additive to the Machine protocol
  - Worktree directories on a Machine lie inside a registered root
  - Machine git calls run in a sanitized environment
  - Machine git results report locators and rewritten errors
- `tool-call-permissions`: the four path decisions of a worktree entry. Requirements:
  - Worktree entry decides the submitted path before any probe
  - Worktree entry decides the canonical path before any git call
  - Worktree entry decides the inspected main clone
  - Worktree entry decides the canonical worktree directory
  - Worktree creation verifies the decided path
- `tool-calling`: one MODIFIED requirement, "Tool registry with mandatory safety classification". An `enter_workspace` call with a `worktree` object appends a `native.attempt` with the `worktree` operation and its `native.result`. A redelivery fails as `outcome_unknown`. A plain entry and exit record no attempt and stay idempotent. Every canonical scenario stays.

### Deliberately unchanged

- `owner-chat-forks`: a fork copies the bound Workspace root as it does today. Leases are informational, so a fork needs no lease rule.
- `context-injection`: the `workspace` producer already narrates a change of the bound root on the first accepted turn. Worktree entry is such a change.
- `projects`: this change stores no project data. Project links and defaults belong to `chat-start-location`, which builds on this capability.

## Impact

- `apps/api/src/tools/workspace.ts`: the optional `worktree` field, the computed directory, the fourth permission decision, the fenced worktree transaction, adoption, lease, and the bound root. The strict object at `:479` accepts exactly one field today.
- `apps/api/src/db/schema/`: four new tables and their Drizzle migration (`repositories`, `repository_aliases`, `checkouts`, `worktree_leases`) with owner policies, composite owner foreign keys, cascades, and FORCE RLS.
- New `packages/git-executor`: the typed git operations over argv arrays, shared by the hub's local executor and the daemon.
- `packages/machine-protocol`: five new methods, their typed parameters and results, and an optional `methods` list in the `hello` result. `PROTOCOL_VERSION` stays 1.
- `apps/machine/src`: the daemon implementations, the root guard applied to the worktree directory, the sanitized git environment, and the `methods` list in the handshake result.
- `apps/api/src/machines/machine-results.ts`: `HelloResult` and `readHelloResult` carry the optional `methods` list, which gates every git call.
- New API module for repositories, aliases, checkouts, and worktree removal, with the `enter_workspace` gate, the typed failure map, OpenAPI regeneration, and the generated client.
- `apps/api/src/testing/`: the portable and permission fixtures that enumerate `enter_workspace` arguments, plus the tests that pin its schema.
- Docs cover the new `docs/product/operator/repositories.md` and the `enter_workspace` model-facing description (`apps/api/src/prompts/tools/enter_workspace.md`). They also cover the `enter_workspace` reference page. The Machines page gets a note that tells operators to register the parent directory or set `worktree_base` inside a root. The operator index and the reference index also change. A dated `CHANGELOG.md` entry records the change.
- `SPEC.md` placement section, to name the repository catalog beside the bound Workspace root.

## Non-Goals

- An inventory sweep, an observation column, or reconciliation against `git worktree list` on a schedule. Leases and rows are intent, not observation.
- A discovery scan (`inventory.scan`) over registered roots or a Machine. The owner registers a checkout.
- Agent-initiated worktree removal. A later change can add `exit_workspace(remove)` with the same guard.
- An announcement of the new entities to the model beyond the current `workspace` rail item.
- A project rail item, a composite parent root for multi-repo projects, or any project-to-repository link. The agent reaches sibling paths by absolute path or `..`.
- Any change to the bound root model of a Chat, its detach reasons, its generation fence, or its fork behavior.

## Acceptance

- An owner registers a local clone by path. The API records the repository from the inspected origin and one main checkout. A second registration of the same path by the same owner fails as a conflict. The same path on another owner's catalog succeeds, and neither owner sees the other row.
- A registration of a path outside the `enter_workspace` allowlist answers 403 `permission_denied` and starts no git command. A `machine://` locator that names no configured Machine answers 503 `executor_unavailable`, starts no git method, and stores no row. A local path on a process without `tools.nativeExecutorId` answers the same.
- A Machine registration stores the canonical Machine locator, so it equals the bound root that a later `enter_workspace` writes.
- `enter_workspace` with `worktree: {}` creates `<parent>/.llame-worktrees/<display name>/<generated name>`, records a worktree checkout and a lease, and binds the new directory. The result names the path, the branch, and the base commit.
- A Chat bound to a clone that calls `enter_workspace` with that clone and `worktree` binds the new worktree with one generation increment.
- A permission reject on the computed worktree directory refuses the call before `git worktree add` runs, and `workspace_generation` does not change.
- A Machine source clone whose computed directory is outside every registered root fails as `path_not_registered` before any git call.
- A failure after `git worktree add`, such as a lost fence or a lost Machine link, records no repository, checkout, or lease row. It leaves the bound root unchanged. A redelivered Run that carries the recorded native attempt fails as `outcome_unknown` and creates no second worktree.
- An owner removes a clean worktree through `DELETE /api/v1/checkouts/:id/worktree`. The route refuses a dirty worktree and an unpushed branch. It refuses an unknown upstream, unless HEAD equals the base commit recorded at creation, which a fresh worktree reaches. The branch remains.
- A repository delete deletes its checkout and lease rows, and the directories remain. A Chat bound to one of them keeps its path until its next attempt re-checks it.
- A Machine whose daemon predates the git methods fails `git.inspect` as `machine_update_required` before any request, and its `read` still works.
- Owner B cannot read, insert, change, or delete owner A's repositories, aliases, checkouts, or leases, through the API or through a direct query.

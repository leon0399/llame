---
summary: "Registering the git repositories and checkouts a Chat can start from, linking them to projects, and the host paths registration may inspect"
read_when:
  - you want llame to know which clone or worktree a Chat runs on
  - you need to register, inspect, or remove a checkout
  - you are linking a project to a repository or setting its isolation policy
  - you are deciding which host paths a checkout registration may inspect
behavior:
  - ../reference/tools/enter-workspace.md
---

# Repositories

A repository is the owner's record of one git repository, identified by its
normalized remote, and a checkout is where that repository exists: one
canonical path on one executor, either a `main` clone or a `worktree` of a
`main` checkout. The catalog is owner-scoped: each user sees only their own
repositories, aliases, checkouts, and worktree leases, and one host path may be
registered by two users independently.

The records are intent, not observation. llame never sweeps an executor, never
reconciles a row against `git worktree list`, and never deletes a directory:
removing a checkout or a repository deletes rows only. A Chat keeps its stored
Workspace path, and its next Run re-checks that binding as before.

One remote names one repository of an owner. An alias may not name a remote
that is already another repository's canonical remote, and a repository may not
take an alias's remote as its canonical one: both answer `409`, so a later
registration of that remote always joins the repository its alias names.

## Requirements

Registration runs git, so the serving process must be allowed to. Three
settings decide that, and none of them has a default that admits anything:

- `tools.nativeExecutorId` (in `llame.config.jsonc`) must be set. It is the
  identity a local checkout is stored under; a process without it answers
  `executor_unavailable` and starts no git.
- `enter_workspace` must be listed in `tools.allowed`. Otherwise registration
  answers `tool_not_allowed` before any git call.
- The `enter_workspace` group in `tools.permissions` must allow the path. The
  submitted path, its canonical form, the toplevel git reports (the path the
  checkout row is stored at), and the main clone git reports are each evaluated
  in `default` mode, so a path no allow covers answers `permission_denied`
  without an inspection. A submission that names a subdirectory therefore needs
  its clone's root admitted too. On a Machine the canonical form is the
  daemon's own real path from `fs.stat`, so a symbolic link is decided where it
  lands.

The recommended portable policy in
[tool-call-permissions](tool-call-permissions.md) already admits
`enter_workspace` for the directories it allows; copying its `enter_workspace`
group is enough, and a narrower group limits registration to the same
directories the model may enter.

The executor is derived from the submitted path. An absolute local path runs
in process on the serving process's `tools.nativeExecutorId`. A
`machine://<name>/<absolute path>` locator runs on that Machine through the
protocol, and the row stores the locator — the same text a Chat's bound root
carries — with the executor `machine:<name>`. A locator that names no
configured Machine answers `executor_unavailable` and starts no git call. A
git result path outside every registered root is the daemon's refusal, so the
route answers `403` `permission_denied` and stores no row.

A Machine must run a daemon that answers the typed git methods; see
[remote Machines](machines.md#install-the-daemon). Registration on a Machine
whose daemon predates them answers `503` `machine_update_required` and stores
no row, while every other Machine operation keeps working.

## The API

The catalog and checkouts are plain owner API routes; they use the session
identity and never take an owner from the request.

```bash
# Create one repository record (optional remote, stored normalized).
curl -X POST localhost:3001/api/v1/repositories -b "session=…" \
  -H 'content-type: application/json' \
  -d '{"displayName":"llame","remote":"git@github.com:leon0399/llame.git"}'

# List it, then declare an alternate remote for a rename or a fork.
curl localhost:3001/api/v1/repositories -b "session=…"
curl -X POST localhost:3001/api/v1/repositories/<id>/aliases -b "session=…" \
  -H 'content-type: application/json' \
  -d '{"remote":"https://github.com/leon0399/llame-old"}'

# Register a checkout: llame inspects the path and records what git reports.
curl -X POST localhost:3001/api/v1/checkouts -b "session=…" \
  -H 'content-type: application/json' -d '{"path":"/home/me/src/llame"}'

# Every checkout with the Chats bound to it and the Chat that leased a worktree.
curl 'localhost:3001/api/v1/checkouts?repositoryId=<id>' -b "session=…"

# Placement override for new worktrees of a main checkout.
curl -X PATCH localhost:3001/api/v1/checkouts/<id> -b "session=…" \
  -H 'content-type: application/json' -d '{"worktreeBase":"/home/me/trees"}'

# Rows only: the directories stay on disk.
curl -X DELETE localhost:3001/api/v1/checkouts/<id> -b "session=…"
curl -X DELETE localhost:3001/api/v1/repositories/<id> -b "session=…"

# Remove one clean worktree directory, then its row and lease.
curl -X DELETE localhost:3001/api/v1/checkouts/<id>/worktree -b "session=…"
```

### Registration

`POST /api/v1/checkouts` takes one `path` and, optionally, `repositoryId` or
`remote` as a selector. Registration always inspects the path with the
sanitized git surface (an empty hooks directory, `core.fsmonitor` off, a fixed
environment, and a timeout), and the inspected `origin` remote decides the
repository:

- The remote is normalized before it is stored: scheme and credentials are
  dropped, the host is lowercased, one `.git` is removed, and every trailing
  slash goes with it. `git@github.com:leon0399/llame.git` and
  `https://github.com/leon0399/llame` are therefore one repository. An explicit
  port stays in the host part, so `ssh://git@example.com:2222/o/r` stores
  `example.com:2222/o/r`, and submitting that stored value again (as a selector
  or in a patch) normalizes to itself.
- A selector only selects. A declared repository whose canonical remote
  disagrees with the inspected origin, and is not one of its aliases, answers
  `origin_mismatch`.
- A clone without an `origin` remote joins the selected repository, or gets a
  new remote-less repository whose display name comes from the clone's
  directory name.
- A repository llame has not seen before is adopted with the display name of
  the last remote segment, else of the clone directory.
- A path git reports as a linked worktree is recorded as a `worktree` row whose
  parent is the main clone, which is adopted as a `main` row when it is not
  registered yet. The stored branch is the worktree's own, and it is null for a
  detached HEAD.
- The stored path is the toplevel git reports, so registering a subdirectory
  inside a clone records that clone once rather than a second checkout.

One owner, executor, and path triple holds at most one checkout, so a repeated
registration of one path is a conflict, not a second row.

Failures answer with a typed `code`: `403` `tool_not_allowed` or
`permission_denied`; `404` for a missing or foreign identifier; `409`
`path_taken`, `worktree_not_clean`, `remote_taken`, or `alias_taken`; `422` `invalid_display_name`,
`invalid_path`, `invalid_remote`, `invalid_selector`, `invalid_worktree_base`,
`not_a_directory`,
`origin_mismatch`, or `not_a_repository`; `502` `git_failed` with the redacted
git standard error,
including a timeout; and `503` `executor_unavailable`, `machine_unavailable`,
or `machine_update_required`.

### The typed git surface

Both executors answer five typed methods, and no owner or model string ever
becomes a command line on either side:

| Method               | Inputs                                     | Answer                                                                        |
| -------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| `git.inspect`        | `path`                                     | toplevel, common directory, linked flag, main worktree, remotes, branch, head |
| `git.status`         | `path`                                     | dirty flag, commits ahead of the upstream, upstream, head                     |
| `git.worktreeAdd`    | `source`, `branch`, `baseRef`, `directory` | the new worktree's path, branch, and head                                     |
| `git.worktreeList`   | `source`                                   | each worktree: path, branch, head, locked, prunable                           |
| `git.worktreeRemove` | `path`                                     | success, or the git standard error                                            |

Each call takes one strict object, passes git an argument vector, runs under the
fixed environment with an empty hooks directory and `core.fsmonitor=false`, and
has a timeout. A value that starts with `-` is refused as invalid input before
git starts, and every path must be absolute. A failure is typed and carries the
bounded, redacted standard error.

On a Machine, every path in an answer is a locator, and each registered-root
prefix in a failure's standard error is rewritten to the locator form, so a host
path for a registered root never reaches the hub. The methods are additive: the
protocol version did not change, and the daemon's handshake lists the git
methods it answers.

### Hooks, monitors, and filter drivers

Every git call these routes start sets `core.hooksPath` to an empty directory
and `core.fsmonitor` to `false`. A `post-checkout`, `post-merge`, or
`post-index-change` hook, and a file-system monitor command, therefore never
run: a repository's own configuration cannot start a process in the hub or the
daemon through either of them.

Filter drivers do still run. `filter.<driver>.smudge`, `.clean`, and
`.process` from the repository or the user configuration run during the
operations that read or materialize a working tree, and they run as the
executor user — the same identity that runs `bash` for the owner. That is the
trust boundary `enter_workspace` already carries as `execute_code`: a clone
whose configuration names a filter command can run that command when llame
inspects it. Disabling filters entirely is rejected: it would break a Git LFS
checkout.

### Worktrees a Chat creates

`enter_workspace` takes an optional `worktree` object with `name` and `baseRef`,
and the model uses it when one Chat needs its own tree of the clone it names.
The submitted `path` is the source clone, which may be a subdirectory of it or a
linked worktree of it: the source is the main tree git reports.

- **Placement.** `<parent>/.llame-worktrees/<display name>/<slug>`, where
  `<parent>` is the parent directory of the clone's real path, and `<slug>` is
  the worktree name with each `/` replaced by `-`. A `worktree_base` on the main
  checkout replaces `<parent>/.llame-worktrees`, so one machine can keep every
  tree under one directory. Nothing is ever created inside the clone.
- **Name and branch.** An omitted name becomes `<adjective>-<noun>-<4 hex>`, and
  a supplied name is used as written. A name must not start with `-`, contain a
  `.` or `..` segment, or break git's ref rules. The branch is `llame/<name>`,
  or the name itself when it holds a `/` — so `feature/login` keeps its
  hierarchy. An omitted `baseRef` starts at the source clone's current HEAD, and
  no fetch runs.
- **Decisions.** The policy decides four paths in order: the submitted path, its
  canonical form, the main clone git reports, and the canonical worktree
  directory. The directory is resolved through its deepest existing ancestor, so
  a symlinked `.llame-worktrees` decides where it really lands, and a reject on
  any of the four refuses the call before the write it guards. On a Machine the
  daemon's registered roots bound the directory, and a path outside them fails
  as `path_not_registered`.
- **Order.** The worker records a `native.attempt` with the `worktree` operation
  before `git worktree add`, and the checkout, the lease, the adopted rows, the
  attempt's result, and the bound root commit in one transaction. A failed
  creation records nothing and leaves the Chat on its previous root with the same
  generation. A fence lost after the add answers `executor_unavailable` with
  `leftDirectory`; a Machine link that drops after the request was sent answers
  `outcome_unknown`, and the directory can remain on disk.
- **Adoption.** A source clone the owner has not registered is adopted with a
  repository from its `origin` remote (or none), a main checkout with origin
  `adopted`, and, for a linked-worktree source, that worktree's own row. Two
  Chats that adopt one clone at once end with one repository and one main
  checkout.

The removal route takes a worktree checkout and runs git's own status first. It
refuses a dirty tree, refuses commits the upstream does not have, and fails
closed when the branch has no upstream unless HEAD is still the base commit the
lease recorded — which is what a freshly created worktree looks like. It passes
the same three gates as registration, removes the directory with
`git worktree remove`, and deletes the row and its lease only after git succeeds.
The `llame/<name>` branch stays, so a removal loses no commit. A worktree row
without a lease keeps the fail-closed rule: no recorded base can prove the
branch is unchanged. Refusals answer `409` `worktree_not_clean`.

## Project links

A project links zero or more of its owner's repositories. A link is a row of its
own: an alias the project shows, a primary flag, and an isolation policy. The
alias defaults to the repository's display name and is stored, so renaming the
catalog entry later leaves the project's label alone. A project holds at most
one primary link, and a project with no link is still usable — its chats start
with no location.

An isolation policy is the default isolation the composer shows for a chat that
starts on that link, and the request's `worktree` field still decides the
outcome:

- `inherit` reuses the source checkout, and turns a worktree start on when
  another open chat already binds that checkout.
- `always_worktree` starts a worktree, so two chats never share one tree.
- `never` reuses the checkout.

### Defaults per executor

For each link and each executor, the project remembers one default checkout: the
one the last successful chat start used. A worktree start records the `main`
checkout it was cut from, and a worktree checkout is never a default target. The
row is replaced in place on every write, so `updated_at` is the time of the last
choice and the newest row wins when a link holds defaults on several executors.
Chat creation reads that row, then `projects.default_executor_id`, then the
executor that holds the repository's only `main` checkout.

Deleting a project removes its links and their defaults, and so does unlinking,
deleting the repository, and deleting the checkout a default names. No route
deletes a repository, a checkout, a directory, or a file because of a link.

### The link routes

```bash
# Link one catalog repository; the alias defaults to its display name.
curl -X POST localhost:3001/api/v1/projects/<project>/repositories \
  -b "session=…" -H 'content-type: application/json' \
  -d '{"repositoryId":"<repository>","isPrimary":true}'

# Change the alias, the primary flag, or the isolation policy.
curl -X PATCH localhost:3001/api/v1/projects/<project>/repositories/<repository> \
  -b "session=…" -H 'content-type: application/json' \
  -d '{"alias":"llame","isolation":"always_worktree"}'

# Unlink: the link and its defaults go, the repository and its checkouts stay.
curl -X DELETE \
  localhost:3001/api/v1/projects/<project>/repositories/<repository> \
  -b "session=…"

# Set or clear the project default executor.
curl -X PATCH localhost:3001/api/v1/projects/<project> -b "session=…" \
  -H 'content-type: application/json' -d '{"defaultExecutorId":"machine:nas"}'

# Read every link with its alias, flags, policy, and defaults rows.
curl localhost:3001/api/v1/projects/<project>/repositories -b "session=…"

# Preview the location a chat start resolves; nothing is written.
curl 'localhost:3001/api/v1/projects/<project>/start-location?repositoryId=<id>&executorId=<id>&checkoutId=<id>' \
  -b "session=…"
```

`GET /api/v1/projects/:id/repositories` returns each link with its alias,
primary flag, and isolation policy, and each defaults row with its executor,
checkout, and `updated_at`. `GET /api/v1/projects/:id/start-location` takes the
same `repositoryId`, `executorId`, and `checkoutId` the create request takes,
resolves them in its order, and answers the repository, executor, checkout, and
isolation default with its reason (`project_policy`, `clone_in_use`, or
`no_link`). It writes nothing and starts no git call.

A project or repository of another owner, and an id that no longer exists, both
answer `404`, so a foreign row is indistinguishable from a missing one. A
repository the caller owns but the project does not link answers `422`, as does
a named checkout that disagrees with the named repository or executor. Every
link write on an archived project answers `409` and changes nothing, including
a change to its default executor. Linking a repository the project already
links answers `409`, and so does a concurrent change that collides on the
one-primary rule; a sequential primary change clears the previous one and
answers `200`.

## Reading the catalog

`GET /api/v1/checkouts` lists every checkout of the caller, filtered by
`repositoryId`. Each row carries the ids of the caller's Chats whose Workspace
root equals its path, and a `worktree` row also carries the Chat that leased
it. A registration answers with that same row, so a Chat bound to the path
before the registration is listed there too. A lease is a receipt, not a reservation: a second Chat may bind a leased
path, and a fork copies its binding without writing a lease.

`GET /api/v1/repositories` and `POST /api/v1/repositories/:id/aliases` are the
other read and declaration surfaces; a repository lists its checkouts through
the filtered checkout list.

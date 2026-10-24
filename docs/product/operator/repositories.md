---
summary: "Registering the git repositories and checkouts a Chat can start from, and the host paths registration may inspect"
read_when:
  - you want llame to know which clone or worktree a Chat runs on
  - you need to register, inspect, or remove a checkout
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
  its clone's root admitted too.

The recommended portable policy in
[tool-call-permissions](tool-call-permissions.md) already admits
`enter_workspace` for the directories it allows; copying its `enter_workspace`
group is enough, and a narrower group limits registration to the same
directories the model may enter.

Only the local executor is supported so far: a `machine://<name>/<path>`
locator answers `executor_unavailable` rather than storing a row the hub cannot
inspect.

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
`path_taken`, `remote_taken`, or `alias_taken`; `422` `invalid_display_name`,
`invalid_path`, `invalid_remote`, `invalid_selector`, `invalid_worktree_base`,
`not_a_directory`,
`origin_mismatch`, or `not_a_repository`; `502` `git_failed` with the redacted
git standard error,
including a timeout; and `503` `executor_unavailable`.

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

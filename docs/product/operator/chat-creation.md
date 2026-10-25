---
summary: "Creating a Chat with its project and Workspace location in one request: the fields, the resolution order, the 201 body, the Workspace statuses and codes, and the creation record"
read_when:
  - you want a client or a script to create a Chat in a project at a chosen checkout
  - a create bound nothing and you need to know which status it answered, and why
  - you are reading a Chat's creation record to see what the server decided
behavior:
  - repositories.md
  - ../reference/tools/enter-workspace.md
---

# Chat creation

`POST /api/v1/chats` files a Chat into a project, resolves the checkout the
request names, authorizes the Workspace, optionally creates a worktree, and
optionally stores a first message and starts its Run — in that order, in one
request. The
client chooses the Chat id, so a request that fails can be sent again with the
same id instead of leaving a half-created Chat behind.

The route answers JSON, never a stream: a client that asked for a first message
resumes the Run from `GET /api/v1/chats/:id/stream`. A Chat with no message is
stored and waits for `POST /api/v1/chats/:id/messages`, which keeps working
exactly as before.

## Requirements

The Workspace step needs the same three settings that `enter_workspace` needs:

- `tools.nativeExecutorId` must be set for a local checkout, and it must equal
  the resolved executor id; otherwise the start answers `bind_failed` with
  `executor_unavailable`.
- `enter_workspace` must be listed in `tools.allowed`; otherwise the start
  answers `bind_failed` with `tool_not_allowed`.
- The `enter_workspace` group in `tools.permissions` must allow each decided
  path: the submitted checkout path, its canonical form, the main tree git
  reports when it differs, and the canonical worktree directory. A path no
  allow covers answers `bind_failed` with `permission_denied` before the git call
  it would have guarded.

A request that carries a message is validated as a send is: the model, its
effort, the permission mode, the parts, and the sender's ownership of every
media part. The `permissionMode` in the message decides the mode the Workspace
step evaluates, and it is `default` when omitted; a `bypass` request on a
process whose `tools.permissionModes` does not list `bypass` answers `422`
before anything is stored.

## The request

| Field          | Type   | Meaning                                                                             |
| -------------- | ------ | ----------------------------------------------------------------------------------- |
| `id`           | uuid   | Client-chosen Chat id. Required.                                                    |
| `projectId`    | uuid   | Files the Chat into this project.                                                   |
| `repositoryId` | uuid   | The repository to start from; it need not be linked to the named project.           |
| `executorId`   | string | The executor that holds the checkout: `tools.nativeExecutorId` or `machine:<name>`. |
| `checkoutId`   | uuid   | A `main` checkout; it decides its own repository and executor.                      |
| `worktree`     | object | `name` and `baseRef` of a worktree to create before the bind.                       |
| `message`      | object | `id`, `parts`, `modelId`, optional `effort` and `permissionMode`.                   |

The location is opt-in. A request that names no `repositoryId`, `executorId`,
or `checkoutId` binds nothing and answers `unbound`, whatever the project's
primary link and remembered defaults; a `worktree` with none of them answers
`422`.

The `worktree` field decides by its presence: omit it to reuse the source
checkout, and send an object — even an empty one — to create a worktree. An
empty object generates the name.

```bash
# File a Chat in a project without a Workspace.
curl -X POST localhost:3001/api/v1/chats -b "session=…" \
  -H 'content-type: application/json' -d '{"id":"<client uuid>","projectId":"<id>"}'

# Start in a repository's checkout, in a worktree of its own, with a message.
curl -X POST localhost:3001/api/v1/chats -b "session=…" \
  -H 'content-type: application/json' -d '{
    "id":"<client uuid>",
    "projectId":"<id>",
    "repositoryId":"<id>",
    "worktree":{"name":"clear-field-0192","baseRef":"main"},
    "message":{
      "id":"<client uuid>",
      "modelId":"system:openai:gpt-5.4",
      "parts":[{"type":"text","text":"Start here."}]
    }
  }'
```

## The resolution order

Once the request names a location, the server fills the levels it did not
name, and never picks a primary silently.

1. **Repository** — the request's `repositoryId` or `checkoutId`, else the
   project's primary link, else its only link, else none. Several links and no
   primary resolve no repository.
2. **Executor** — the request's `executorId`, else the most recently written
   default of the link, else the project's `default_executor_id`, else the only
   executor that holds a `main` checkout of the repository, else the online
   executor with the lowest id that holds one.
3. **Checkout** — the request's `checkoutId`, else the remembered default for
   the link and executor, else the only `main` checkout on that executor, else
   none.

The implicit steps skip an offline Machine. An explicit `executorId`, a named
`checkoutId`, or a remembered default that names an offline Machine answers
`machine_unavailable` instead of being skipped. An `executorId` that no
configuration provides answers `422` with `code` `executor_unknown`, and an
offline `projects.default_executor_id` is dropped from its step rather than
failing the start.

A named `checkoutId` must be a `main` row; a worktree answers `422`. A
`repositoryId` or `executorId` that disagrees with it answers `422`. A project
and a working directory are separate settings, so a named repository or
checkout need not be linked to the named project; a link adds only its
isolation policy and remembered defaults. With no ids,
`GET /api/v1/projects/:id/start-location` previews the project's suggested
location in this order; a composer shows it and names its ids explicitly to
bind it.

## The response

`201` carries the Chat and a `workspace` object whose `status` is one of a
closed set:

| Status                    | Meaning                                                                        | `code`                                                                       |
| ------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `bound`                   | The Chat is bound to `root` on `executorId`; `worktree` names it when created. | —                                                                            |
| `unbound`                 | No location resolved. The message still stores and its Run still starts.       | —                                                                            |
| `bind_failed`             | The Workspace step refused the binding.                                        | `permission_denied`, `tool_not_allowed`, `executor_unavailable`, `not_found` |
| `worktree_failed`         | A git worktree command failed. `message` carries its bounded, redacted error.  | `path_not_registered`, or none                                               |
| `machine_unavailable`     | The resolved Machine is offline.                                               | —                                                                            |
| `machine_update_required` | The Machine's daemon does not answer the git methods.                          | —                                                                            |
| `outcome_unknown`         | The Machine link was lost after a mutation; `leftDirectory` may remain.        | —                                                                            |

`code` appears only with `bind_failed` and `worktree_failed`. Every failure
status carries `message`; `leftDirectory` names the directory an
`outcome_unknown` can leave behind, when it is known. A failure keeps the Chat
filed and unbound: it stores no bound root, no lease, no defaults row, and no
message, and it starts no Run. The client keeps the draft for a later send.

A successful start records the source `main` checkout as the link's default for
that executor, so the next preview in the same project suggests it again. A
worktree start records the source checkout, never the worktree it just created.
That write runs after the commit, it is best-effort, and its failure changes
nothing else: the create still answers `bound`, and the previous default stays.

## Resends, and the creation lock

A create request holds a session advisory lock on its Chat id on one dedicated
connection for the whole request, while each step keeps its own transaction. A
request that cannot take the lock, and a message that arrives while a create
holds it, both answer `409` with `code` `creation_in_progress` and change
nothing. The message route takes the same key as a transaction lock, so an
overlapping send is refused instead of blocking.

A second create with a stored Chat id is a resend:

- An archived Chat answers `409`, and a `projectId` that differs from the stored
  Chat's answers `409` with `code` `project_mismatch`.
- A Chat that already holds a message answers `409`; send the draft through
  `POST /api/v1/chats/:id/messages` with a new message id instead.
- A stored bound root stays unchanged and no worktree command starts. A Chat
  with no bound root runs the location, worktree, and bind steps again, so a
  corrected location binds. A Chat that holds a creation lease reuses that
  worktree and its root.
- A Chat whose earlier attempt added a worktree and rolled back keeps the
  directory that attempt recorded, and the resend answers `outcome_unknown`
  with `leftDirectory` instead of adding a second worktree.
- A Chat id stored for another owner answers `404` and discloses no field of it.

## The creation record

`GET /api/v1/chats/:id/creation-record` returns every create and resend that
reached a path decision, newest last:

```json
{
  "chatId": "…",
  "attempts": [
    {
      "createdAt": "2026-10-24T16:00:00.000Z",
      "decisions": [
        {
          "path": "/home/me/src/llame",
          "policyId": "…",
          "decision": "allow",
          "reason": "matched_allow",
          "reference": {
            "groupId": "enter_workspace",
            "list": "allow",
            "clauseIndex": 0
          }
        }
      ]
    }
  ]
}
```

Each attempt commits in its own transaction before the first git write and stays
when a later step fails, so a refused start leaves the decision that refused it.
A request that fails validation, answers `404` or `409`, or resolves no location
appends no attempt. Only the owner reads the record; another owner answers
`404`.

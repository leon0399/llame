---
summary: "How the composer sets a new chat's project and working directory, what each chip cell changes, and which entry points pre-fill them"
read_when:
  - you are starting a chat in a project, in a working directory, from another chat, or from a link
  - you need to change or remove the project or working directory of a chat before its first message
spec: workspace-entry
configured_by: ../operator/repositories.md
---

# Chat location

A new chat has two separate, optional settings: a **project**, which files the
chat, and a **working directory**, which binds its Workspace before the first
Run. A chat can have either, both, or neither. The composer's `+` menu adds each
one, and each shows as a filled chip beside `+`:

```text
[+] [project: llame development ×] [docker | llame | master ×]
```

A chat with neither is an ordinary chat. It shows no chip and no warning.

## The project chip

"Add to project" in the `+` menu files the chat. The chip names the project:
its name opens the project list to change it, and only its × removes it. On a
project's own page the project is fixed, so the chip is disabled and "Change
project" in the `+` menu is disabled. An existing chat's chip files the chat in
place, as the sidebar's "Move to project" does.

## The working-directory pill

"Add working directory" in the `+` menu lists every registered `main` checkout,
the project's own repositories first, then "Other folder…". The pill has three
cells and a ×:

- **Machine** — every executor that holds a `main` checkout of the repository.
  An offline Machine is listed disabled with its reason (for example
  `Offline — Could not be reached`). A Machine whose daemon answered
  `machine_update_required` on the last create is disabled with that sentence.
  Choosing a Machine that holds one such checkout selects it at once.
- **Folder** — the checkout's folder name; its tooltip prints the path. Its
  menu lists the same checkouts as the `+` menu, and "Other folder…".
- **Mode** — the checkout's branch (for example `master`) while the chat works
  in the checkout, or `Worktree` once the chat starts in a new worktree cut
  from that branch. The server names the worktree's branch. The default follows
  the project link's isolation policy: `always_worktree`, or another open chat
  that already binds the same checkout, turns it on.

Only the × removes the working directory. Every other cell opens its menu.

**Other folder…** asks for a Machine (or this server) and an absolute path. A
path that is a registered checkout on that Machine selects it. Any other path is
registered first, through the same route as the project page's registration,
which refuses a folder that is not a git clone with the server's sentence.

## What the send binds

The send calls `POST /api/v1/chats`. Its location is opt-in: the request names
the checkout the pill shows, or no location. A project with a primary link
pre-fills the pill from the start-location preview, and removing the pill sends
the chat unbound, whatever the project's defaults. Nothing is written until the
send.

A start that would fail shows the reason: an offline Machine is disabled in its
menu, and a failed create — an offline Machine, an outdated daemon, a rejected
worktree — keeps the draft with the server's sentence above the input until the
draft changes.

## Entry points

Each entry point pre-fills the chips.

- **The project page composer.** The project is fixed. The working directory
  follows the project's links and the preview route.
- **The bare new-chat page.** Both settings start empty.
- **"New chat in project"** in a project's row menu. It links to
  `/chat/new?project=<id>`. An archived project's row is a disabled
  placeholder, because an archived project refuses a new chat.
- **"New chat here"** in an existing chat's row menu. It copies that chat's
  project, repository, executor, and source checkout, and asks for a worktree:
  the source chat already holds the tree. A chat bound to a worktree copies
  that worktree's source `main` checkout. A chat with no project or no bound
  root has nothing to copy, so its row is a disabled placeholder.
- **The deep link**

  ```text
  /chat/new?project=&repository=&executor=&checkout=&worktree=1
  ```

  `project` names the project; `repository`, `executor`, and `checkout` are ids
  (the same three the create request takes); `worktree=1` asks for a worktree
  and `worktree=0` asks to reuse. A blank or absent parameter is left to the
  preview's default. A named project forwards to
  `/projects/<id>?repository=&executor=&checkout=&worktree=1`; without a
  project the link opens an ordinary new chat.

The composer reads the pre-fill once, when it mounts: following a new entry
point from the same page re-seeds the chips, while editing them never rewrites
the URL.

## Changing the location afterwards

The chips set the location of a start. A chat that already exists changes its
root through `enter_workspace` and `exit_workspace`, and its project through
the project chip or `PATCH /api/v1/chats/:id`. See
[enter_workspace](tools/enter-workspace.md) and
[repositories](../operator/repositories.md).

---
summary: "How the composer sets a new Chat's Project and working directory, what each chip cell changes, and which entry points pre-fill them"
read_when:
  - you are starting a Chat in a Project, in a working directory, from another Chat, or from a link
  - you need to change or remove the Project or working directory of a Chat before its first message
spec: workspace-entry
configured_by: ../operator/repositories.md
---

# Chat location

A new Chat has two separate, optional settings: a **Project**, which files the
Chat, and a **working directory**, which binds its Workspace before the first
Run. A Chat can have either, both, or neither. The composer's `+` menu adds each
one, and each shows as a filled chip beside `+`:

```text
[+] [project: llame development ×] [docker | llame | master ×]
```

A Chat with neither is an ordinary Chat. It shows no chip and no warning.

## The project chip

"Add to project" in the `+` menu files the new Chat. The chip names the
Project: its name opens the Project list to change it, and only its × removes
it. On a Project's own page the Project is fixed, so the chip is disabled and
"Change project" in the `+` menu is disabled. A Chat that already exists has no
chip; the sidebar's "Move to project" files it.

A working directory need not belong to a repository the Project links: the two
settings are independent. A linked repository only adds its isolation policy
and remembered defaults.

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
- **Mode** — the checkout's branch (for example `master`) while the Chat works
  in the checkout, or `Worktree` once the Chat starts in a new worktree cut
  from that branch. The server names the worktree's branch. The default follows
  the Project link's isolation policy: `always_worktree`, or another open Chat
  that already binds the same checkout, turns it on.

Only the × removes the working directory. Every other cell opens its menu.

**Other folder…** asks for a Machine (or this server) and an absolute path. A
path that is a registered checkout on that Machine selects it. Any other path is
registered first, through the same route as the Project page's registration,
which refuses a folder that is not a git clone with the server's sentence.

## What the send binds

The send calls `POST /api/v1/chats`. Its location is opt-in: the request names
the checkout the pill shows, or no location. A Project with a primary link
pre-fills the pill from the start-location preview, and removing the pill sends
the Chat unbound, whatever the Project's defaults. Nothing is written until the
send.

A start that would fail shows the reason: an offline Machine is disabled in its
menu, and a failed create — an offline Machine, an outdated daemon, a rejected
worktree — keeps the draft with the server's sentence above the input until the
draft changes.

## Entry points

Each entry point pre-fills the chips.

- **The Project page composer.** The Project is fixed. The working directory
  follows the Project's links and the preview route.
- **The bare new-chat page.** Both settings start empty.
- **"New chat in project"** in a Project's row menu. It links to
  `/chat/new?project=<id>`. An archived Project's row is a disabled
  placeholder, because an archived Project refuses a new Chat.
- **"New chat here"** in an existing Chat's row menu. It copies that Chat's
  Project, repository, executor, and source checkout, and asks for a worktree:
  the source Chat already holds the tree. A Chat bound to a worktree copies
  that worktree's source `main` checkout. A Chat with no Project or no bound
  root has nothing to copy, so its row is a disabled placeholder.
- **The deep link**

  ```text
  /chat/new?project=&repository=&executor=&checkout=&worktree=1
  ```

  `project` names the Project; `repository`, `executor`, and `checkout` are ids
  (the same three the create request takes); `worktree=1` asks for a worktree
  and `worktree=0` asks to reuse. A blank or absent parameter is left to the
  preview's default. A named Project forwards to
  `/projects/<id>?repository=&executor=&checkout=&worktree=1`; without a
  Project the link opens an ordinary new Chat.

The composer reads the pre-fill once, when it mounts: following a new entry
point from the same page re-seeds the chips, while editing them never rewrites
the URL.

## Changing the location afterwards

The chips set the location of a start. A Chat that already exists changes its
root through `enter_workspace` and `exit_workspace`, and its Project through
the sidebar's "Move to project" or `PATCH /api/v1/chats/:id`. See
[enter_workspace](tools/enter-workspace.md) and
[repositories](../operator/repositories.md).

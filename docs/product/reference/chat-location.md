---
summary: "How the composer names a chat's start location, what each cascade level changes, and which entry points pre-fill it"
read_when:
  - you are starting a chat from a project, from another chat, or from a link
  - you need to read the location chip in a chat header or fix a warning it shows
spec: workspace-entry
configured_by: ../operator/repositories.md
---

# Chat location

A chat that starts from a project can bind its Workspace before the first Run.
The **location chip** names the root the start would bind. One click opens the
**cascade**, which changes any level. The chat header shows the same chip,
read-only, from the root the chat is actually bound to.

## The chip

The chip prints one segment per resolved level, separated by `·`:

```text
llame development · llame · nas · ~/src/llame (master)
llame development · llame · nas · ~/.llame-worktrees/llame/clear-field-0192
  (llame/clear-field-0192 ← master)
```

1. The project's name.
2. The repository's alias in that project.
3. The executor: the Machine's name, or the executor id for the local host.
4. The source checkout's path, with its branch when the chat reuses it. A
   worktree start prints the directory the new tree lands in instead, and the
   second line names the branch and its base (`<branch> ← <base>`).

A warning icon replaces the pin when the start cannot resolve its location. The
chip still sends. A level the project cannot resolve at all creates the chat
filed and unbound, and the header chip then warns; a location that resolves but
cannot start — an offline Machine, an outdated daemon, a rejected worktree —
answers its own failure, and the composer keeps the draft with the server's
sentence above it.

## The cascade

The popover lists levels top to bottom. A level the project has only one choice
for is omitted.

- **Project** — the page's project; it names the scope, not a choice.
- **Repository** — every repository the project links. It appears only when the
  project links more than one.
- **Machine** — every executor that holds a `main` checkout of the chosen
  repository. An offline Machine is listed disabled with its reason
  (for example `Offline — Could not be reached`), and the cascade never offers
  one as a default it would then refuse. A Machine whose daemon answered
  `machine_update_required` on the last create is disabled with that sentence.
- **Source checkout** — the `main` clones of the repository on the chosen
  executor. It appears only when the executor holds more than one.
- **Isolation** — `Reuse the checkout` or `Start a worktree`, labelled with the
  reason the default carries: `reuse (project policy)`,
  `worktree (project policy)`, `worktree (clone in use by N chats)`,
  `reuse (no linked repository)`, or `(your choice)` once the reader overrides
  the default.
- **Base ref** and **Name** — only while isolating. Both are optional: an
  omitted base ref uses the source checkout's branch, and an omitted name takes
  a server-generated one. The branch is `llame/<name>` unless the name already
  carries a `/`.

A change at one level recomputes the levels below it from their defaults. A
repository or Machine choice drops the source checkout; every level clears the
isolation override so the projected default applies again.

The values the cascade shows are not guessed. It reads the project's links and
the start-location preview, which runs the same resolver the create runs, so the
chip cannot show a location the create would not resolve. Nothing is written
until the send.

## Entry points

Each entry point pre-fills the same chip, and the send calls
`POST /api/v1/chats` with what the chip shows.

- **The project page composer.** Its chip follows the project's links and the
  preview route. This is the page every other entry point lands on.
- **"New chat in project"** in a project's row menu. It links to
  `/chat/new?project=<id>`, so the chip follows the project's own defaults. An
  archived project's row is a disabled placeholder, because an archived project
  refuses a new chat.
- **"New chat here"** in an existing chat's row menu. It copies that chat's
  project, repository, executor, and source checkout, and asks for a worktree:
  the source chat already holds the tree, so isolation defaults on. A chat
  bound to a worktree copies that worktree's source `main` checkout. A chat with
  no project or no bound root has nothing to copy, so its row is a disabled
  placeholder.
- **The deep link**

  ```text
  /chat/new?project=&repository=&executor=&checkout=&worktree=1
  ```

  `project` names the project; `repository`, `executor`, and `checkout` are ids
  (the same three the create request takes); `worktree=1` asks for a worktree
  and `worktree=0` asks to reuse. A blank or absent parameter is left to the
  preview's default. A named project forwards to
  `/projects/<id>?repository=&executor=&checkout=&worktree=1`, where the
  composer seeds its chip from the same parameters; without a project the link
  opens an ordinary new chat.

- **The chat header.** A read-only chip, described below.

The composer reads the pre-fill once, when it mounts: following a new entry
point from the same page re-seeds the chip, while editing the chip never
rewrites the URL.

## The chat header's chip

The header prints the chat's own `workspace_root`, so it also names a root the
owner never registered as a checkout. The catalog supplies only the labels — the
repository alias and the Machine name — and the branch line comes from the
checkout row.

A chat with no bound root shows a warning instead of a guess: the create's
Workspace step failed, or the chat never entered one. The owner resends the
create, enters a Workspace later, or starts a new chat here.

## Changing the location afterwards

The chip sets the location of a start. A chat that already exists changes its
root through `enter_workspace` and `exit_workspace`, and its project through
`PATCH /api/v1/chats/:id`; those remain the only writers after the first
message. See [enter_workspace](tools/enter-workspace.md) and
[repositories](../operator/repositories.md).

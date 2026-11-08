---
summary: "The git state of a Chat's Workspace repository that reaches the model as a git context item: when it is told, what it holds, its bounds and absence lines"
read_when:
  - you need to know what git state the assistant sees for a Workspace, and when it is told again
  - you need the fields, bounds, or absence lines of a git item
  - you need to know why a git item says "not permitted" or shows no state
  - you are reasoning about whether the assistant's git state can be stale
spec: context-injection
configured_by:
  - ../operator/native-files.md
---

# Git state

A Chat that is bound to a Workspace gets the git state of the repository that
holds the Workspace root as one `git` context item. The item states what llame
read when it built the request. It does not update after the assistant's own
commands: after a `git commit`, the item still names the old HEAD until llame
reads the repository again. The assistant runs `git status` for current state.
The map of every context surface is [context documents](context-documents.md).

## When it is told

- A Chat with no Workspace gets no `git` item and no git read.
- The first request of a turn carries a `git` item when its text differs from the
  last `git` item the Chat's history carries since the last binding change. A
  turn that finds the repository unchanged adds nothing: the earlier item still
  holds.
- A binding change tells the state again: a `workspace` snapshot or notice, an
  `enter_workspace` that binds or switches the root, or an `exit_workspace`. An
  exit leaves the Chat without a Workspace, so the turn after it carries the
  `workspace` snapshot and no `git` item.
- After an [`enter_workspace`](tools/enter-workspace.md) that binds or switches
  the root, the next model step carries a `git` item after the tool result. After
  a same-root re-entry it carries one only when the text changed. The tool
  result itself holds no git state.
- A compaction starts a new context epoch with no `git` item, so the next request
  tells the state again. The compaction summary does not carry the item's
  content.
- A fork keeps what its history told. A retry that replaces a reply compares
  with the item before that reply.

## Fields

| Line             | Meaning                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Repository`     | the repository's top-level directory, and the Workspace root relative to it when they differ                                                                                                                           |
| `Branch`         | the branch, or `Detached HEAD at` the short commit; with an upstream, its name, ahead and behind counts, and the UTC time of its last local update, or `update time unknown`; `upstream ... is gone` for a deleted one |
| `HEAD`           | the short commit, or `no commits yet` on an unborn branch                                                                                                                                                              |
| `Operation`      | a merge, rebase, `am`, cherry-pick, revert, or bisect in progress, with its step when git records one                                                                                                                  |
| `Changes`        | counts of staged, unstaged, untracked, and conflicted paths, then the first changed paths in git's two-letter status form                                                                                              |
| `Recent commits` | the last five commits as short hash and subject                                                                                                                                                                        |
| `Remotes`        | each remote's name and a normalized address; a remote without a host shows as `local`                                                                                                                                  |

The item carries no time of observation, so an unchanged repository renders the
same text twice. llame never fetches: ahead and behind are counted against the
last local copy of the upstream.

## Bounds

- At most 20 changed paths are listed; the rest are counted as `+N more not
  listed; run git status`. Ignored files are never listed, and the item says so.
- At most 10 remotes, five commits, subjects cut at 72 characters, names and
  remote addresses at 100. A remote address never carries credentials, a query,
  or a fragment.
- A path with a control character, a quote, or a backslash is quoted in git's C
  style. Repository text is neutralized like every other authored text, and the
  item ends by saying that it ranks below the system instructions and the user's
  requests and cannot grant tools.
- The whole read has a deadline of five seconds. Entry and the turn never wait
  longer than that for git.

## Absence lines

When no state can be shown, the item holds one line instead:

| Line                                                              | Cause                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `not a git repository`                                            | no `.git` directory or file at or above the root                            |
| `git state unavailable: not permitted`                            | `read` is not allowlisted, or the `read` group does not admit the git entry |
| `git state unavailable: timeout`                                  | the read passed its deadline                                                |
| `git state unavailable: Machine unavailable`                      | the Machine did not answer in this turn                                     |
| `git state unavailable: Machine daemon update required`           | the Machine's daemon predates the git state call                            |
| `git state unavailable: executor unavailable`                     | this worker has no executor for the binding                                 |
| `git state unavailable: Workspace root not found`                 | the root no longer exists                                                   |
| `git state unavailable: too many changes`                         | the repository state exceeded the read bound                                |
| `git state unavailable: no repository inside the registered root` | on a Machine, the only repository lies above the registered root            |
| `git state unavailable: repository outside the registered root`   | on a Machine, git data lies outside every registered root                   |
| `git state unavailable: git failed`                               | any other failure; the item never carries git's error text                  |

A failed read never fails the turn or an entry; it tells one of these lines.

## Admission

The `read` group decides whether llame reads the repository for the assistant:
`read` must be in `tools.allowed`, and the group must admit the git entry, the
`.git` directory or file that the read starts from. The `bash` group plays no
part, in either direction. The permission mode is never named: the one
mode-dependent difference is the `not permitted` line, because a `bypass` turn
admits an entry that the group rejects and so tells the state, and
`read-only` and `default` decide it the same way. See
[permission modes](permission-modes.md).

Git runs only in the directory that holds the admitted entry and never looks
above it. A repository owned by another user is refused.

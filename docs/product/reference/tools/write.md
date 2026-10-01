---
summary: "The native write tool: create a new file or replace an existing one in full"
read_when:
  - you are creating a file or replacing its whole contents
  - you need to know when create and replace refuse
spec: native-file-tools
configured_by:
  - ../../operator/native-files.md
  - ../../operator/knowledge.md
---

# write

## Purpose

`write` creates a new file, or with `replace: true` swaps an existing file's
entire contents. It is the tool for a whole-file change; use
[edit](edit.md) for a partial one.

## Arguments

| Argument  | Meaning                                                          |
| --------- | ---------------------------------------------------------------- |
| `path`    | a locator; a `kb://` locator takes no selector                   |
| `content` | the file's new contents; an empty string truncates to zero bytes |
| `replace` | optional; `true` replaces an existing file instead of creating   |

## Locators

An absolute host path, a `file://` alias, or a `kb://` locator; while a
Workspace is entered, a relative path is resolved beneath its root. See
[locators](../locators/index.md) and
[enter_workspace](enter-workspace.md#bounds).

The selector grammar is not part of `write`. A `kb://` locator that carries one
is refused with `invalid_selector`; on a host `path` or `file://` alias a
trailing `:N-M` or `:raw` is part of the filename, so such a write creates or
replaces a file whose name ends in that text.

## Result

A successful write reports the mutated locator and is marked `created` or
`replaced` accordingly.

## Behavior

`write({ path, content, replace? })` creates a new file, creating missing
intermediate directories beneath the resolved authority root on every scheme, or
— with `replace: true` — swaps an existing file's entire contents atomically.
Create mode refuses every existing target with `file_exists` and an intermediate
component that exists as a regular file with `not_regular_file`; on an absolute
path "existing" includes a dangling symbolic link, while a `kb://` locator
refuses a symbolic-link component as `not_found` before the target is reached.
Replace mode asserts an existing regular file and fails an absent or dangling
target with `not_found`, creating nothing. The flag's outcome by target
existence:

| Target | `replace`    | Result                                      |
| ------ | ------------ | ------------------------------------------- |
| absent | absent/false | file created, result marked `created`       |
| exists | absent/false | `file_exists`, bytes untouched              |
| exists | `true`       | contents replaced, result marked `replaced` |
| absent | `true`       | `not_found`, nothing created                |

Replacing an absolute path resolves a symbolic link to its target entry exactly
as `edit` does, preserving that file's permission bits; a `kb://` target must
have an existing regular-file leaf and creates no directory. Empty content
truncates the file to zero bytes. Each mode's refusal message names the other:
`file_exists` points at `replace: true`, and the replace `not_found` states that
omitting the flag creates a new file.

A `kb://` create builds missing directories one component at a time; see
[kb](../locators/kb.md#behavior).

A write is fenced by the same attempt record as every native mutation; see
[mutation recovery](../mutation-recovery.md). It also triggers the instruction
chain of the directory it touches; see
[instruction files](../instruction-files.md).

## Errors

`file_exists` for an existing target in create mode, `not_regular_file` for an
intermediate component that is a regular file, `not_found` for an absent replace
target or a refused `kb://` symbolic-link component, and `invalid_selector` for
a `kb://` locator carrying a selector. The shared vocabulary is in
[read](read.md#errors).

## Configured by

- [Native files](../../operator/native-files.md) enables the host executor and
  the `write` entry.
- [Personal Knowledge](../../operator/knowledge.md) configures the Knowledge root
  behind `kb://`.

A write is gated by the `write` permission group, described in
[tool-call permissions](../../operator/tool-call-permissions.md).

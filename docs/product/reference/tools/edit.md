---
summary: "The native edit tool: replace exactly one current match in a file the path names"
read_when:
  - you need to change part of a file and know when an edit is refused
  - you need to know which authority an edit writes to
spec: native-file-tools
configured_by:
  - ../../operator/native-files.md
  - ../../operator/knowledge.md
---

# edit

## Purpose

`edit` changes one passage of a file the `path` names, leaving the rest of the
file as it is. It is the tool for a partial change.

## Arguments

| Argument  | Meaning                                         |
| --------- | ----------------------------------------------- |
| `path`    | a locator; the selector grammar does not apply  |
| `oldText` | the exact current text to find                  |
| `newText` | the replacement; empty string deletes the match |

## Locators

An absolute host path, a `file://` alias, or a `kb://` locator; see
[locators](../locators/index.md). The selector grammar is not part of `edit`: a
`kb://` locator that carries one is refused with `invalid_selector`, and on a
host `path` or `file://` alias a trailing `:N-M` or `:raw` is part of the
filename, so the edit targets a file whose name ends in that text.

## Result

A successful edit returns a bounded diff plus the post-edit content with one
adjacent live line on each side when available. Bytes outside the replacement are
preserved. The result is the same for a `file://` alias, decoded to the same
identity as the path it names.

## Behavior

`edit({ path, oldText, newText })` replaces exactly one current match. Empty
`newText` deletes the match. Missing or ambiguous matches fail without changing
the file. No previous-read requirement is enforced yet.

An `oldText` copied from a prior `kb://` read must drop the generated
line-number prefixes, or be taken from a `:raw` read, which omits them; see
[kb](../locators/kb.md#authority).

An edit is fenced by the same attempt record as every native mutation; see
[mutation recovery](../mutation-recovery.md). It also triggers the instruction
chain of the directory it touches; see
[instruction files](../instruction-files.md#host-triggers).

## Errors

A missing or ambiguous match fails without a change; `not_regular_file` for a
target that is not a regular file; `not_found` for an absent path or a refused
`kb://` symbolic-link component. The shared vocabulary is in
[read](read.md#errors).

## Configured by

- [Native files](../../operator/native-files.md) enables the host executor and
  the `edit` entry.
- [Personal Knowledge](../../operator/knowledge.md) configures the Knowledge root
  behind `kb://`.

An edit is gated by the `edit` permission group, described in
[tool-call permissions](../../operator/tool-call-permissions.md).

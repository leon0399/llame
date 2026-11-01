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

An absolute host path, a `file://` alias, a `machine://` locator, or a `kb://`
locator; see [locators](../locators/index.md). The selector grammar is not part
of `edit`: a `kb://` locator that carries one is refused with
`invalid_selector`, and on a host `path` or `file://` alias a trailing `:N-M` or
`:raw` is part of the filename, so the edit targets a file whose name ends in
that text. A `machine://` mutation takes no selector either and never binds the
local executor; the attempt is fenced and recorded with the locator, and an
edit whose session is lost after dispatch settles as `outcome_unknown` rather
than being retried; see [machine](../locators/machine.md#behavior).

## Result

A successful edit returns the bounded post-edit region and the fields that
describe it. A model reads the result as plain text — one header line, the
attribution lines the source adds, and the numbered region — while the owner's
UI reads the stored object:

```text
edited src/app.ts: line 161, 4 -> 5 lines (563 lines total)
161:     case "web_search":
162:       return (
163:         <WebSearchTool {...props} Markdown={renderers.MessageResponse} />
164:       );
165:     case "bash":
[region cut at the bound]
```

The header names the region's first post-edit line, the replaced line count, the
replacement line count, and then, after one space, the post-edit file's line
count as `(<total> lines total)` when it is stored. The attribution lines follow
the header, and the numbered post-edit region follows them: the changed lines
plus two adjacent live lines on each side when available. A region the result
bound cut ends with `[region cut at the bound]`, and the shared cap's notice can
end the text in brackets. The result carries no diff, no old text, and no new
text as separate blocks, and bytes outside the replacement are preserved.

| Field          | Meaning                                                               |
| -------------- | --------------------------------------------------------------------- |
| `content`      | the bounded post-edit region, each line with its `N:` prefix          |
| `shownRange`   | the post-edit lines actually emitted                                  |
| `truncated`    | whether the result bound or the shared cap cut the result             |
| `cut`          | whether the result bound cut the region; the cap never sets it        |
| `lineCount`    | the post-edit file's line count                                       |
| `display`      | the region's `startLine`, `oldText`, and `newText` for the owner's UI |
| `replacements` | the number of replacements, always `1`                                |
| `path`         | the locator the result identifies itself by                           |

`display` is stored with the tool part for the chat UI only: a model never
receives it, and it counts toward no result or replay budget. On a Machine the
daemon answers with the region's start line alone and the hub rebuilds
`oldText` and `newText` from the call, so the stored part is the same as a local
edit and a large replacement crosses the connection once rather than twice. A
result stored before this shape carries `diff`, `content`, and `shownRange`
instead; its header is `edited <path>: region from line <N>`, the stored region
follows, and the stored diff is never rendered.

The result is the same for a `file://` alias, decoded to the same identity as
the path it names.

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

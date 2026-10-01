---
summary: "The native read tool: one path argument whose scheme selects the authority, plus line and representation selectors"
read_when:
  - you need to know what a read returns or how a selector changes the result
  - you need to know which scheme a path addresses or why a read failed
spec: native-file-tools
configured_by:
  - ../../operator/native-files.md
  - ../../operator/web-read.md
  - ../../operator/knowledge.md
  - ../../operator/skills.md
---

# read

## Purpose

`read` takes one `path` argument and returns a bounded view of what that path
addresses. The scheme of the path selects the authority — a host filesystem, a
Knowledge Space, a skill package, or a web URL — and the trailing selector
selects lines or a representation. It never changes the source.

## Arguments

| Argument | Meaning                                                  |
| -------- | -------------------------------------------------------- |
| `path`   | a locator with an optional trailing selector (see below) |

One argument only. There is no separate range, depth, or representation
argument: the selector in `path` carries all of that. See
[selectors](../selectors.md) for the full grammar.

## Locators

| Scheme                                         | Executor | Mutable | Authority and listing                    |
| ---------------------------------------------- | -------- | ------- | ---------------------------------------- |
| [absolute host path](../locators/host-path.md) | yes      | yes     | the worker's filesystem; depth-2 listing |
| [`file://`](../locators/host-path.md#form)     | yes      | yes     | the same path, decoded once              |
| [`kb://`](../locators/kb.md)                   | no       | yes     | the owner's Knowledge Space tree         |
| [`skill://`](../locators/skill.md)             | no       | no      | an installed skill package, read-only    |
| [`http(s)://`](../locators/web.md)             | no       | no      | the public web, through the API process  |

## Result

A successful read returns the selected content plus the fields that describe how
much of it was shown:

| Field                                | Meaning                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `content`                            | the emitted source lines, each with its `N:` prefix, or the verbatim bytes for a raw read |
| `requestedRange` / `requestedRanges` | the normalized source scope that was requested                                            |
| `shownRange` / `shownRanges`         | the source lines actually emitted                                                         |
| `truncated`                          | whether a bound cut the result                                                            |
| `nextOffset`                         | the zero-based index of the first omitted source line; resume at `nextOffset + 1`         |
| `realPath`                           | the canonical absolute path, when it differs from the path as given                       |
| `path`                               | the path the result identifies itself by                                                  |

A file read on an absolute path reports `realPath` when a symbolic link in the
path or in one of its components makes it differ from the normalized path as
given; `realPath` counts within the result bound, and the header and line
numbering stay those of the path as given. A directory listing never carries it,
and neither does a `kb://` or `skill://` read.

A multi-range read reports the plural `requestedRanges` (the merged request) and
`shownRanges` (emitted lines); continuation and trimming are under
[selectors](../selectors.md#result-bounds).

## Behavior

`read({ path: "/absolute/file.md:10-20" })` returns lines 10 through 20, plus one
live line of context on either side when available. `:raw` returns verbatim
source without line numbers or added context. The full line, raw, and
representation grammar is under
[selectors](../selectors.md#line-selectors).

A read never mutates its source. A read of a host path also triggers that
directory's instruction chain, and a `kb://` read triggers its Space's chain; see
[instruction files](../instruction-files.md). A `skill://`, `http(s)://`, or
`bash` call never triggers a load.

## Bounds

Every read shares the result bound documented in
[selectors](../selectors.md#result-bounds); a directory read has its own
traversal budget, in [host-path](../locators/host-path.md#listing).

## Errors

Knowledge identifier failures — `knowledge_space_not_found` and
`knowledge_space_unavailable` — are specific to `kb://`; see
[kb](../locators/kb.md#errors). Every other path and file failure a read can
return — `invalid_path`, `not_found`, `not_regular_file`, `invalid_utf8`,
`executor_unavailable`, `directory_too_large`, ... — is the same native
vocabulary regardless of scheme. `file_exists` is not one of them: it belongs to
the mutations, in [write](write.md#errors).

A selector the source does not accept fails with `invalid_selector`; see
[selectors](../selectors.md). `unsupported_operation` is a `skill://` mutation
refusal, and `skill_requires_explicit_selection` a manual-only package refusal;
both are in [skill](../locators/skill.md#errors).

## Configured by

- [Native files](../../operator/native-files.md) enables the host executor and
  the `read` entry.
- [Web reads](../../operator/web-read.md) configures `http(s)://` adapters and
  restrictions.
- [Personal Knowledge](../../operator/knowledge.md) configures the Knowledge root
  behind `kb://`.
- [Skills](../../operator/skills.md) installs the packages `skill://` reads.

A read is gated by the `read` permission group, described in
[tool-call permissions](../../operator/tool-call-permissions.md).

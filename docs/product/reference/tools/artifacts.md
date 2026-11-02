---
summary: "Stored tool-result artifacts: what the artifact:// locator addresses, how it is read, and how the operator bounds it"
read_when:
  - you need to know what artifact://<tool>-<n> addresses or how to read the rest of a result
  - you need to change the stored size bound for tool results
spec: native-file-tools
configured_by:
  - ../../operator/native-files.md
---

# artifacts

## Purpose

A tool result that does not fit the model-facing bound is stored whole as an
artifact, and the tool part carries the inline result plus the artifact
locator. The model reads the rest through `read` with an `artifact://` path, so
one bounded result does not lose the bytes it could not show. The store is the
Chat's own resource: it lives in Postgres under the Chat owner's row-level
security, and it lives until the Chat or its owner is deleted.

A producer writes an artifact only when the Run can read it back: `read` is in
`tools.allowed`, or `bash` runs on the llame host and gets host files. Without
a reader the tool returns its bounded inline result and states how many lines,
files, or results it left out.

## Locators

| Locator                            | Addresses                                          |
| ---------------------------------- | -------------------------------------------------- |
| `artifact://<toolName>-<n>`        | one artifact of the current Chat                   |
| `artifact://<toolName>-<n>/<part>` | one part of it; a `bash` artifact always has parts |

`<toolName>` is the registered name of the tool that made the artifact, and
`<n>` comes from one counter for each Chat, starting at 1. Two artifacts of
one Chat never share a number, and the number does not restart when another
tool writes. A `bash` artifact names each stream as its own part
(`stdout`, `stderr`); every other tool's artifact has one part, addressed
without a part segment.

The locator resolves only inside the Chat that made it. Another Chat of the
same owner, another owner, and a missing part all return `not_found`; a
process with no identity reads nothing.

## Reading

`read("artifact://grep-7")` serves the part's text with the ordinary record
selectors: `:N`, `:N-M`, `:N+K`, `:N-`, `:-K`, comma lists, and `:raw`. An
`:outline` works on a Markdown part. A part that is not Markdown refuses
`:outline` with `invalid_selector`.

Artifact line numbers count pieces: a source line longer than 8,000 UTF-16
code units is one line for each 8,000 units, and a piece ends on a code-point
boundary, so a long JSON line stays readable. Every notice, range, and
continuation line that names artifact lines uses that count. Host files, when
they exist, keep the source lines as written, so a `sed` count can differ on a
long line only.

`read("artifact://")` lists the Chat's artifacts, oldest first, with each
locator, tool name, size in lines and bytes, and creation time. Reading a
`bash` artifact's locator lists its streams in the same form.

`edit` and `write` refuse an `artifact://` path with `invalid_path`.

## Forks

An owner fork copies each artifact of the source Chat that a copied tool part
names, with the same locator, and continues from the source's counter. An
artifact that no copied part names is not copied, and a shared fork copies no
artifact because it copies no tool part. A deleted source Chat keeps its
fork's artifacts.

## Operator bound

One byte bound applies to every part:
`tools.artifacts.maxBytes`, default 8,388,608 (8 MiB), floor 131,072
(128 KiB). A producer that streams stops at the bound and marks its result
incomplete; a whole result above it is not stored.

```jsonc
{
  "tools": {
    "artifacts": {
      "maxBytes": 8388608,
    },
  },
}
```

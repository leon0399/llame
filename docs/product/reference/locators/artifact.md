---
summary: "The artifact:// locator: a read-only handle on a tool result the Chat stored whole"
read_when:
  - a tool result names an artifact://<tool>-<n> locator
  - you need to read the rest of a result that did not fit inline
  - a read of an artifact failed or you need to know why
spec: native-file-tools
configured_by:
  - ../../operator/native-files.md
---

# artifact://

## Form

`artifact://<toolName>-<n>` names one artifact of the current Chat, where
`<toolName>` is the registered name of the tool that made it and `<n>` is the
Chat's counter value. `artifact://<toolName>-<n>/<part>` names one part of it.
A `bash` artifact always names each stream as its part (`stdout`, `stderr`);
every other artifact has one part, addressed without a part segment.

The scheme is read case-insensitively, as every locator scheme is. `<n>` is a
Postgres `integer`, so a larger number is `invalid_path` rather than a store
error.

## Accepted by

| Tool    | Accepted | Effect                                   |
| ------- | -------- | ---------------------------------------- |
| `read`  | yes      | the part's text, with the read selectors |
| `edit`  | no       | `invalid_path`                           |
| `write` | no       | `invalid_path`                           |

A `bash` `cwd` does not accept it.

## Authority

The locator resolves only inside the Chat that made the artifact, under its
owner's row-level security. Another Chat of the same owner, another owner, and
a process with no identity read nothing; a missing part is `not_found`. The
read needs no native executor and no `bash`: the store is the Chat's own rows,
and a process that allowlists `read` serves it, gated by the `read` permission
group, which matches the locator without its selector. A field-allow `read`
group admits it only with a `^artifact://` allow; see
[artifact reads](../../operator/native-files.md) and
[tool-call permissions](../../operator/tool-call-permissions.md).

## Behavior

A tool whose result does not fit its inline bound stores the whole result and
keeps the locator in its tool part. The artifact holds the result as the tool
built it, so an inline passage or result line has the same number in the
artifact. Reading it changes nothing; the model reaches the content only through
`read`. An artifact lives as long as its Chat and is never expired, so replay
and compaction never include its content. An owner fork copies the artifacts
its copied tool parts name, with the same locators, and continues the source
Chat's counter; a shared fork copies none.

The stored read is not re-checked against `read` decisions at this stage: the
part serves the bytes the tool admitted.

## Bounds

A part serves the ordinary result bound, so a long part is cut and its
continuation line names the next read. Artifact lines count 8,000 UTF-16 code
units: a source line longer than that is one line for each piece, at most 8,000
units per line, and a piece ends on a code-point boundary so a surrogate pair is
never split. A line terminator is not counted, so a CRLF line counts its
content only. Each part is also bounded in bytes by the operator's artifact
bound, which [native files](../../operator/native-files.md#artifact-reads)
sets and explains.

## Listing

`read("artifact://")` lists the Chat's artifacts, oldest first, one line each:
the locator, the tool name, the size in lines and bytes, and the creation time.
Reading a `bash` artifact's locator lists its streams in the same form. Both
listings take a single `:N`, `:N-M`, `:N+K`, `:N-`, or `:-K` member; `:raw`,
`:outline`, and comma lists are `invalid_selector`. A listing longer than the
result bound is paged with a continuation line.

## Errors

| Error              | When                                                                |
| ------------------ | ------------------------------------------------------------------- |
| `invalid_path`     | a malformed locator, a number over the integer bound, or a mutation |
| `not_found`        | an absent artifact or part, another Chat, or another owner          |
| `invalid_selector` | a selector the read cannot serve, or one a listing refuses          |

## Configured by

The locator exists wherever `read` is allowlisted. The artifact byte bound and
the host-file behavior are operator settings; see
[native files](../../operator/native-files.md#artifact-reads).

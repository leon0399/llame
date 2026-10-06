---
summary: "kb:// Knowledge Space locators: owner-scoped reads, edits, writes, and directory listings"
read_when:
  - you are passing a kb:// locator to read, edit, or write
  - you are listing a Knowledge Space directory or hitting a Space identifier error
spec: knowledge-spaces
configured_by:
  - ../../operator/knowledge.md
  - ../../operator/native-files.md
---

# Knowledge Space locators

## Form

`read`, `edit`, and `write` accept `kb://<knowledgeSpaceId>/<path>[:selector]`;
a selector selects lines to read and is rejected on `edit` and `write`.

`<path>` applies component rules of its own: no empty component, no `.` or
`..`, no backslash, no absolute form, and no NUL or other control character,
with at most 1,024 UTF-8 bytes over 32 components — where a host path keeps `.`
and `..` as ordinary segments and bounds nothing that way. Split the locator
before decoding each path segment exactly once. Encode a literal `:`, `?`,
`#`, or `%` as `%3A`, `%3F`, `%23`, or `%25`; other characters, including spaces,
may be literal or encoded. Never encode `/`. Validation applies after decoding,
so encoded `..` is refused; every refusal is listed under [Errors](#errors). A
raw colon starts the selector; use `%3A` inside a filename. Existing literal
percent names now require `%25`, including locators saved before this change.
The Space identifier and selector are never decoded.

## Accepted by

`read`, `edit`, and `write`, on every process that has a configured Knowledge
root; a `kb://` call never binds or requires an executor.

## Authority

`<knowledgeSpaceId>` is resolved through the trusted Run owner's current
Knowledge Space access on every call, under RLS, with no filesystem probe.

Every path component is `lstat`ed and a symbolic link is refused without being
followed, returning `not_found`; the reader itself opens with `O_NOFOLLOW`, so a
link swapped in after validation also reads back as `not_found`.

Every successful `kb://` read, listing, or mutation carries the closed
untrusted-content `notice`, the Space identifier, and the Space display name.
Content is not neutralized, so an `edit` `oldText` can be copied from a prior
read — after removing the generated line-number prefixes, or by reading with
`:raw`, which omits them. Only a raw read is byte-for-byte source.

A `kb://` result never exposes a host path, an owner ID, credentials, or a raw
filesystem error; a failure names the Space, never what is behind it. Content is
untrusted and may be stale.

`kb://` carries no Markdown-only suffix rule and no 1 MiB size cap — a Space is a
directory of arbitrary files. Beyond the rules above, `kb://` targets follow the
same regular-file, directory, selector, context, truncation, and mutation
behavior as absolute host paths.

## Behavior

In create mode a `write` may name directories that do not exist yet. They are
created one component at a time, each checked after creation, because a
recursive create adopts an existing symbolic link without complaint and would
build the rest of the chain through it — placing the file outside the Space
while the result still named a locator inside it. A component that exists and is
not a directory fails `not_regular_file` and creates nothing. This matters most
on a host that allowlists `bash` alongside `write`: the shell can plant such a
link itself, so the boundary cannot rest on the model being unable to create
one.

A replace creates no directory: its target must already resolve, and a
symbolic-link component fails as `not_found` before the target is reached. Every
`kb://` mutation is fenced by the same durable attempt record as a host
mutation, without binding or requiring an executor identity; see
[mutation recovery](../mutation-recovery.md).

A `kb://` touch also triggers the Space's instruction chain; see
[instruction files](../instruction-files.md).

## Listing

`kb://<id>` and `kb://<id>/` list the Space's directory through the same depth-2
listing as an absolute directory path, except that every symbolic link renders
as the bare `- name@` with no target, because a `kb://` result exposes no
resolved host path.

## Errors

An absent, removed, malformed, or other-owner identifier returns
`knowledge_space_not_found`; a currently owned Space whose root or stable-ID
child cannot be resolved safely returns `knowledge_space_unavailable`. Neither
result reveals whether another owner, row, or directory exists.

A bare `kb://` or a locator with no identifier is `invalid_path`; a refused
symbolic-link component is `not_found`; a malformed locator part — a segment
that fails to decode, a traversal or control character, an encoded separator,
a slash-only resource path, or an unpaired surrogate after decoding — is
`invalid_path`, and it is judged before the suffix is, so a locator whose path
part is malformed answers `invalid_path` whatever its selector says. A
split-off suffix outside the selector grammar is `invalid_selector` with the
shared message: the working forms, then the `%3A` spelling of the same file,
which a Space directory has no resource path to offer and therefore names only
the forms ([selectors](../selectors.md#malformed-selectors)). Every other path
and file failure uses the shared native vocabulary, listed in
[read](../tools/read.md#errors).

## Configured by

- [Personal Knowledge](../../operator/knowledge.md) configures the Knowledge
  root and the Spaces `kb://` resolves.
- [Native files](../../operator/native-files.md) enables the `read`, `edit`, and
  `write` entries.

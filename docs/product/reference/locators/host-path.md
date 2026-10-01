---
summary: "Absolute host paths and file:// aliases, and the bounded depth-2 directory listing they return"
read_when:
  - you are passing an absolute path or a file:// alias to a native tool
  - you are reading or listing a host directory
spec: native-file-tools
configured_by: ../../operator/native-files.md
---

# Host paths

## Form

An absolute POSIX path is read, edited, or written as given, with an optional
trailing `[:selector]` (see [selectors](../selectors.md)). Relative paths are
valid only while a Workspace is entered; see
[enter_workspace](../tools/enter-workspace.md).

`read`, `edit`, and `write` also accept `file://` and RFC 8089 minimal `file:`
URLs as local-path aliases. Accepted forms are `file:///absolute/path`,
`file://localhost/absolute/path` (localhost is case-insensitive), and
`file:/absolute/path`. The scheme is ASCII case-insensitive, so `FILE:///x`
works.

Percent escapes decode once to bytes and then strict UTF-8; `.` and `..` retain
host-path semantics. `%3A` decodes to `:` and follows host selector rules after
a literal-path probe first; there is no escaped literal-colon form. Selectors
work the same way, so `file:///path:10-12` is equivalent to `/path:10-12`.

This is POSIX-only: `file:///C:/x` means `/C:/x`; drive handling is not
supported, and `file://C:/x` is refused as remote. A literal space, including a
trailing space, is a legal POSIX filename and is retained.

## Accepted by

`read`, `edit`, and `write`. An absolute path also serves as the `path`
argument of `enter_workspace`; `file://` does not, and `bash` uses its own
`cwd` argument.

## Authority

An absolute path or alias executes on the worker's filesystem with its OS user's
authority and binds the Run to the configured executor. A valid alias binds the
Run exactly as an absolute path does; Workspace root does not affect them.
Permission allows and rejects match the decoded host path, not the URL form;
the operator's regex recipes are under
[tool-call permissions](../../operator/tool-call-permissions.md).

Aliases are refused before filesystem access for a non-local authority, missing
path, a literal query (`?`), fragment (`#`), backslash, C0 control or DEL,
malformed or non-UTF-8 escape, `%2F`, or `%00`. Results report the decoded host
path, never the submitted URL.

## Listing

A read of a directory path returns a depth-2 listing: directories first, then
files, sorted by name under the host collation. A symbolic link sorts among the
files by name whatever its target kind. Each entry renders as `- name/`
(directory), `- name` (file), `- name@/ -> <target>` (symbolic link to a
directory), `- name@ -> <target>` (symbolic link to a regular file),
`- name@? -> <link text>` (a dangling link, or one resolving to a special entry),
or `- name?` (special entry). `<target>` is the canonical absolute path the link
resolves to, while a link that is dangling or resolves to a special entry shows
its raw link text instead. Symbolic links are never descended, even when the
target is a directory, and links and special entries are never opened. Child
directories show up to 20 entries followed by `… N more`. Empty directories
render `(empty directory)`.

A trailing separator is optional: `/dir/` and `/dir` both work. Range selectors
such as `:1-5` return a flat listing of root-level entries only, with no child
content. `:raw` is not supported for directories. Directories over 10,000
entries fail with `directory_too_large`.

Directory reads are bounded by a 10,000-entry traversal budget per directory.
When the rendered two-level listing exceeds the result cap, child blocks are
elided last-first into `… N entries` markers before root-level entries are
truncated with `nextOffset`.

## Errors

`invalid_path` for a refused alias; `not_found` for an absent path;
`directory_too_large` for a directory over the traversal budget; `not_regular_file`
and `file_exists` for mutations. `executor_unavailable` when the call needs the
host executor the operator did not enable. The shared vocabulary is in
[read](../tools/read.md#errors).

## Configured by

[native files](../../operator/native-files.md) enables the host executor and the
`read`, `edit`, and `write` entries.

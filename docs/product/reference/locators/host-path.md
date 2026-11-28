---
summary: "Absolute paths and file:// aliases on the current Machine, and the bounded depth-2 directory listing they return"
read_when:
  - you are passing an absolute path or a file:// alias to a native tool
  - you are reading or listing a directory on the current Machine
spec: native-file-tools
configured_by: ../../operator/machines.md
---

# Absolute paths

## Form

An absolute POSIX path is read, edited, or written as given; a `read` may carry
a trailing `[:selector]`, such as `:L10-20` or `:12:5` (see
[selectors](../selectors.md)), which `edit` and `write` take as part of the
filename. An absolute path addresses the current
Machine: the Machine of an entered Workspace, or `machines.default` when none is
entered. Relative paths are valid only while a
Workspace is entered; see [enter_workspace](../tools/enter-workspace.md).

`read`, `edit`, and `write` also accept `file://` and RFC 8089 minimal `file:`
URLs as local-path aliases. Accepted forms are `file:///absolute/path`,
`file://localhost/absolute/path` (localhost is case-insensitive), and
`file:/absolute/path`. The scheme is ASCII case-insensitive, so `FILE:///x`
works.

Percent escapes decode once to bytes and then strict UTF-8; `.` and `..` retain
host-path semantics. `%3A` decodes to `:` and follows host selector rules after
a literal-path probe first; there is no escaped literal-colon form. Selectors
work the same way, so `file:///path:L10-12` is equivalent to `/path:L10-12`.

This is POSIX-only: `file:///C:/x` means `/C:/x`; drive handling is not
supported, and `file://C:/x` is refused because a host other than `localhost`
names another Machine. A literal space, including a
trailing space, is a legal POSIX filename and is retained.

## Accepted by

`read`, `edit`, and `write`. An absolute path also serves as the `path`
argument of `enter_workspace`; `file://` does not, and `bash` uses its own
`cwd` argument.

## Authority

An absolute path or alias executes on the current Machine with that Machine's OS
user authority and records its attempt against the Machine locator; it does not
bind the Run to a worker. The Machine's daemon serves it, so the path must lie
inside that Machine's registered roots. A valid alias addresses the same Machine
exactly as an absolute path does; Workspace root does not affect them. Every
result reports the canonical `machine://` locator of the decoded path, never the
submitted spelling.
Permission matching strips a `read`'s selector and not an `edit`'s or `write`'s,
whose suffix is part of the filename; see
[tool-call permissions](../../operator/tool-call-permissions.md#matching).

Aliases are refused before filesystem access for a non-local authority, missing
path, a literal query (`?`), fragment (`#`), backslash, C0 control or DEL,
malformed or non-UTF-8 escape, `%2F`, or `%00`. Results report the decoded host
path, never the submitted URL.

## Listing

A read of a directory path returns a depth-2 listing: directories first, then
files, sorted by name under the Machine's collation. A symbolic link sorts among the
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

The listing follows the walk policy. An entry named `.git`, `.jj`, `.hg`,
`.svn`, or `node_modules` renders with no entries below it, even when an
ignore file names it. An entry that an `.ignore` or `.gitignore` rule excludes
does not render and does not count, under the same rules as a
[`grep` walk](../tools/grep.md). The directory the read names is never
filtered, so `read /repo/.git/` and `read /repo/dist/` still list their
entries.

A trailing separator is optional on a directory: `/dir/` and `/dir` both work.
On a file it fails with `not_found`, and the file is not read. A line member
selects a flat listing of root-level entries only, such as `:L1-5` (see
[selectors](../selectors.md#line-selectors)); directories over 10,000 entries
fail with `directory_too_large`.

Directory reads are bounded by a 10,000-entry traversal budget per directory.
When the rendered two-level listing exceeds the result cap, child blocks are
elided last-first into `… N entries` markers before root-level entries are
truncated with `nextOffset`.

## Errors

`invalid_path` reports a refused alias, and `invalid_selector` a suffix outside
the selector grammar ([selectors](../selectors.md#malformed-selectors)).
`not_found` reports an absent path or a trailing separator on a file, and
`directory_too_large` a directory over the traversal budget. `not_regular_file`
and `file_exists` belong to mutations. `path_not_registered` reports a target
outside the current Machine's registered roots, and `machine_unavailable` a
Machine that is unreachable. The shared vocabulary is in
[read](../tools/read.md#errors).

## Configured by

[Machines](../../operator/machines.md) declares the Machine an absolute path
addresses, and the `read`, `edit`, and `write` entries gate the tools.

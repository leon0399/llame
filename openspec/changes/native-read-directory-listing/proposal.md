## Why

The native `read` tool rejects a directory with `not_regular_file`, and the
bash-executor proposal does not advertise host `bash`, so the model has no way
to learn which files exist before it reads, edits, or creates one. An assistant
that cannot see a Knowledge vault's structure cannot place a new note where the
owner's conventions put it, and a coding agent cannot orient in a checkout. This is the first source-axis extension tracked under #701 and the direct
answer to issue #704.

## What Changes

- Make `read` on an absolute local directory return a bounded, deterministic
  depth-2 listing instead of an error. A trailing path separator is optional
  on a directory path.
- Render the listing as the absolute directory path followed by two-space
  indented entries: `- name/` for directories, `- name` for files, `- name@` for
  symbolic links, which are never descended. Empty directories render
  `(empty directory)`.
- Order entries with directories first, then names under the host collation.
- List the requested directory without a per-level cap, and each child
  directory up to 20 entries followed by `… N more`. Grandchildren are counted,
  never rendered.
- Keep the shared result envelope: when the rendered listing exceeds the common
  result cap, elide whole child blocks last-first with an explicit marker
  before truncating the requested level. A range selector switches the read to
  a flat, paged listing of the requested level only; the header line is never
  counted as an entry.
- Narrow `not_regular_file` to sockets, devices, FIFOs, and other special
  entries; `edit` and `write` on a directory keep failing with it.
- Show entries verbatim: no hidden-file, ignore-file, or metadata handling in
  this iteration. Those, recency ordering, and symlink following are tracked as
  separate children of #701.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: directories become a valid `read` target with a
  deterministic bounded listing contract; the non-regular-target failure
  requirement narrows accordingly, and the selector/context requirement scopes
  context expansion to regular-file reads.

## Impact

Implementation lives in `packages/native-file-tools` behind an injected
directory-reading port shaped like the Knowledge filesystem's `opendir`, so the
later `kb://` locator (#702) can reuse the walker under owner authorization
without a second implementation. The API tool declaration and operator docs
describe the listing. No new dependency, no Knowledge walker refactor, no
change to `edit`, `write`, the mutation fence, or tool admission.

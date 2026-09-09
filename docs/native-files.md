# Native file tools

Native `read`, `edit`, and `write` select their authority from the scheme of
their `path` argument. An absolute path executes on the worker's filesystem
with its OS user's authority, gated by `tools.nativeExecutorId`. A
`kb://<knowledgeSpaceId>/<path>[:selector]` locator resolves through the
trusted Run owner's current Knowledge Space access instead, gated by
`knowledge.root`, and never binds the Run to an executor. This alpha
capability supplies no per-user or per-path filesystem permissions or sandbox
on either path; `kb://` narrows exposure to one owner-scoped directory tree.

## Enabling

Absolute-path access and `bash` need a trusted host identity in
`llame.config.json`, then a restart of the API and worker:

```json
{
  "tools": {
    "nativeExecutorId": "personal-host-a",
    "allowed": ["read", "edit", "write", "bash"]
  }
}
```

`kb://` locators need only a configured `knowledge.root`; `tools.allowed`
still gates each tool id. A process with `knowledge.root` and no
`nativeExecutorId` advertises `read`, `edit`, and `write`, all usable with a
locator — an absolute path argument on that process fails closed with
`executor_unavailable` instead of resolving through the Knowledge root.

Optional trusted bash cwd (defaults to the API process cwd):

```bash
BASH_WORKING_DIRECTORY=/absolute/project
```

Keep any other desired tool ids in `allowed`. Each distinct host filesystem
needs a distinct, stable `nativeExecutorId`. Co-located API and worker processes
that use the same native filesystem should use the same identity. Without it,
absolute-path native access and `bash` are unavailable even when allowlisted.

## `kb://` locators

`read`, `edit`, and `write` accept `kb://<knowledgeSpaceId>/<path>[:selector]`;
a selector selects lines to read and is rejected on `edit` and `write`.
`<knowledgeSpaceId>` is resolved through the trusted Run owner's current
Knowledge Space access on every call, under RLS, with no filesystem probe. An
absent, removed, malformed, or other-owner identifier returns
`knowledge_space_not_found`; a currently owned Space whose root or stable-ID
child cannot be resolved safely returns `knowledge_space_unavailable`. Neither
result reveals whether another owner, row, or directory exists.

`<path>` follows the same component rules as an absolute path — no empty
components, `.`/`..`, backslashes, or NUL/control characters, and no more than
1,024 UTF-8 bytes or 32 components. Split the locator before decoding each
path segment exactly once. Encode a literal `:`, `?`, `#`, or `%` as `%3A`,
`%3F`, `%23`, or `%25`; other characters, including spaces, may be literal or
encoded. Never encode `/`: an encoded separator and malformed encoding return
`invalid_path`. Validation applies after decoding, so encoded `..` is refused.
A raw colon starts the selector; use `%3A` inside a filename. Existing literal
percent names now require `%25`, including locators saved before this change.
The Space identifier and selector are never decoded. Every
path component is `lstat`ed and a symbolic link is refused without being
followed, returning `not_found`; the reader itself opens with `O_NOFOLLOW`, so
a link swapped in after validation also reads back as `not_found`.
`kb://<id>` and `kb://<id>/` list the Space's directory through the same
depth-2 listing as an absolute directory path; a bare `kb://` or a locator
with no identifier is `invalid_path`.

A `write` may name directories that do not exist yet. They are created one
component at a time, each checked after creation, because a recursive create
adopts an existing symbolic link without complaint and would build the rest of
the chain through it — placing the file outside the Space while the result
still named a locator inside it. A component that exists and is not a directory
fails `not_regular_file`. This matters most on a host that allowlists `bash`
alongside `write`: the shell can plant such a link itself, so the boundary
cannot rest on the model being unable to create one.

`kb://` carries no Markdown-only suffix rule and no 1 MiB size cap — a Space
is a directory of arbitrary files. Beyond the rules above, `kb://` targets
follow the same regular-file, directory, selector, context, truncation, and
mutation behavior as absolute paths, and never bind or require the Run's
`tools.nativeExecutorId`. A `write` may name directories that do not exist
yet; a component that exists and is not a directory fails `not_regular_file`
and creates nothing.

Every successful `kb://` read, listing, or mutation carries the closed
untrusted-content `notice`, the Space identifier, and the Space display name.
Content is not neutralized, so an `edit` `oldText` can be copied from a prior
read — after removing the generated line-number prefixes, or by reading
with `:raw`, which omits them. Only a raw read is byte-for-byte source.

An unimplemented `scheme://` prefix — for example `vault://x` — fails closed
with `invalid_path` on `read`, `edit`, and `write` alike. It is never treated
as a literal relative or absolute filename, and no file named after the scheme
is read, created, or modified.

## Calls

- `read({ path: "/absolute/file.md:10-20" })` returns lines 10 through 20,
  plus one live line on either side when available. `:10+11` selects the same
  requested range. `:raw` and `:raw:10-20` return verbatim source, without line
  numbers or added context. Existing literal filenames take precedence over
  selector syntax.
- `read({ path: "/absolute/directory" })` returns a depth-2 listing:
  directories first, then files, sorted by name under the host collation.
  Each entry renders as `- name/` (directory), `- name` (file), `- name@`
  (symbolic link), or `- name?` (special entry). Symlinks are never descended;
  special entries are never opened. Child directories show up to 20 entries
  followed by `… N more`. Empty directories render `(empty directory)`.
  A trailing separator is optional: `/dir/` and `/dir` both work.
  Range selectors such as `:1-5` return a flat listing of root-level entries
  only, with no child content. `:raw` is not supported for directories.
  Directories over 10,000 entries fail with `directory_too_large`.
- `edit({ path, oldText, newText })` replaces exactly one current match.
  Empty `newText` deletes the match. Missing or ambiguous matches fail without
  changing the file. No previous-read requirement is enforced yet.
- `write({ path, content })` creates a new file, creating missing intermediate
  directories beneath the resolved authority root on every scheme. Every
  existing target, including a dangling symlink, returns `file_exists`; an
  intermediate component that exists as a regular file returns
  `not_regular_file` and creates nothing.

Knowledge identifier failures — `knowledge_space_not_found` and
`knowledge_space_unavailable` — are specific to `kb://`. Every other path and
file failure — `invalid_path`, `not_found`, `not_regular_file`, `file_exists`,
`executor_unavailable`, `directory_too_large`, ... — is the same native
vocabulary regardless of scheme.

Line numbers are display metadata, not source. Continuation uses zero-based
`nextOffset`; add one when composing the next one-based read selector.

Native files have no blanket size cap. Reads stream a bounded window; exact
editing currently buffers the file in memory. Normal reads default to 2,000
requested lines, plus available adjacent context. Serialized native results
are bounded to the shared 16,000 UTF-16 code-unit cap and retain whole source lines.
Markdown processing, URLs, and logical resource schemes other than `kb://` are
separate capabilities. Allowlisted `bash` shares the absolute-path native host
gate: the model supplies shell text and the host runs `bash -c` in
`BASH_WORKING_DIRECTORY` (or the API cwd). It is not tenant isolation.
`bash` accepts an optional literal `cwd` and string-record `env`. An absolute
`cwd` is used as given; a relative `cwd` resolves from `BASH_WORKING_DIRECTORY`
or the API cwd. When omitted, the default directory is used. The directory
must be enterable before the attempt is recorded, and no shell expansion is
applied to the argument. Each call starts a fresh process, so its working
directory, environment, and shell state do not persist. The child receives the
fixed managed base (`PATH`, `LANG=C.UTF-8`, `HOME`, `TMPDIR`, `USER`, `LOGNAME`
when set, and `TERM=dumb`) plus the call's additions as its initial
environment; base variables cannot be replaced. Bash, its launcher, or the
runtime may add variables such as `PWD`, `SHLVL`, and `_` before a command prints
its environment.
Command stdout and stderr are returned as produced up to the configured bound,
with truncation reported. Host-known protected values are redacted before the
result leaves the executor, and the shared model-facing neutralizer escapes
reserved tool delimiters in the copy sent to the model. Host `bash` can also
discover a mounted `knowledge.root` through ordinary filesystem commands; that
is separate from the owner-scoped `knowledge_search` and `kb://` capabilities.
After an unproven stop, the process-group quarantine is local to the worker and
is lost if that worker crashes. An in-flight shell process group can survive
that crash, so a replacement worker can admit a new bash command while the old
group remains alive because the replacement has no quarantine for the lost
worker. The durable `native.attempt` still prevents Run recovery from replaying
the command, and the Run becomes `outcome_unknown`.
Directory reads are bounded by a 10,000-entry traversal budget per directory.
When the rendered two-level listing exceeds the result cap, child blocks are
elided last-first into `… N entries` markers before root-level entries are
truncated with `nextOffset`.

## Mutation recovery

The first absolute-path native operation binds its Run to the configured
executor identity. A different executor cannot resolve those physical paths
on reattachment. Mutations are ordered in the host process, including
symlink aliases; external editors and other uncoordinated processes are
outside that guarantee.

Before an edit or write changes bytes, on either scheme, its attempt is
committed to the existing owner-scoped Run event log — for `kb://`, recorded
against the locator, never the resolved host path. The result is committed
before the model continues. A recovered open attempt returns
`outcome_unknown`; a queue retry of a Run that started a mutation terminates
instead of replaying its model loop. Reconnecting clients replay recorded
activity without running tools again. A `kb://` mutation uses this same fence
without binding or requiring an executor identity, so a retry on a different
worker still reports `outcome_unknown` rather than `executor_unavailable`.

After an unknown outcome, read the file's current state before authoring a new
attempt. Do not assume a timeout means the file was unchanged.

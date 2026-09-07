# Native file tools

Native `read`, `edit`, and `write` execute on the worker's filesystem with its
OS user's authority. This alpha capability is for an intentionally trusted
host. It supplies no per-user or per-path filesystem permissions or sandbox.

Enable it in `llame.config.json`, then restart the API and worker:

```json
{
  "tools": {
    "nativeExecutorId": "personal-host-a",
    "allowed": ["read", "edit", "write", "bash"]
  }
}
```

Optional trusted bash cwd (defaults to the API process cwd):

```bash
BASH_WORKING_DIRECTORY=/absolute/project
```

Keep any other desired tool ids in `allowed`. Each distinct host filesystem
needs a distinct, stable `nativeExecutorId`. Co-located API and worker processes
that use the same native filesystem should use the same identity. Without it,
native file tools and `bash` are unavailable even when allowlisted.

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
- `write({ path, content })` creates a new file in an existing parent directory.
  Every existing target, including a dangling symlink, returns `file_exists`.

Line numbers are display metadata, not source. Continuation uses zero-based
`nextOffset`; add one when composing the next one-based read selector.

Native files have no blanket size cap. Reads stream a bounded window; exact
editing currently buffers the file in memory. Normal reads default to 2,000
requested lines, plus available adjacent context. Serialized native results
are bounded to the shared 16,000 UTF-16 code-unit cap and retain whole source lines.
Markdown processing, URLs, and logical resource schemes are separate
capabilities. Allowlisted `bash` shares this native host gate: the model supplies
shell text and the host runs `bash -c` in `BASH_WORKING_DIRECTORY` (or the API
cwd). It is not tenant isolation. Directory reads are bounded by a 10,000-entry
traversal budget per directory. When the rendered two-level listing exceeds the
result cap, child blocks are elided last-first into `… N entries` markers before
root-level entries are truncated with `nextOffset`.

## Mutation recovery

The first native operation binds its Run to the configured executor identity.
A different executor cannot resolve those physical paths on reattachment.
Mutations are ordered in the host process, including symlink aliases; external
editors and other uncoordinated processes are outside that guarantee.

Before an edit or write changes bytes, its attempt is committed to the existing
owner-scoped Run event log. The result is committed before the model continues.
A recovered open attempt returns `outcome_unknown`; a queue retry of a Run that
started a mutation terminates instead of replaying its model loop. Reconnecting
clients replay recorded activity without running tools again.

After an unknown outcome, read the file's current state before authoring a new
attempt. Do not assume a timeout means the file was unchanged.

## Knowledge read removal

Track removal in [#691](https://github.com/leon0399/llame/issues/691).

Keep `knowledge_read` until a separate removal change updates every caller,
allowlist, prompt, and historical declaration compatibility path. Removal must
prove LF/CRLF/lone-CR, escaped output bounds, continuation, and owner-isolation
parity using the Knowledge acceptance suite. Native host paths do not replace
owner-scoped locators on hosted installations; those need an authority-aware
resource adapter before deletion. Track the removal independently from #212's
Git submission work.

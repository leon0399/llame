---
summary: "projects:// locators: read-only listings of the owner's Projects and one Project's current details and registered checkout locations"
read_when:
  - you need to discover the owner's Projects or read one Project's current details, Project instructions, and linked locations
  - a projects:// read failed or you need to know what a listing or detail contains
  - you are deciding whether a checkout location a Project read returned grants any access
spec:
  - native-file-tools
  - projects
  - project-discovery
  - tool-call-permissions
configured_by: ../../operator/tool-call-permissions.md
---

# projects://

## Form

Three resource forms exist:

| Locator               | Source                                      |
| --------------------- | ------------------------------------------- |
| `projects://`         | the owner's active Projects                 |
| `projects://archived` | the owner's archived Projects               |
| `projects://<uuid>`   | one active or archived Project of the owner |

`projects:///` is another spelling of `projects://`. The scheme is ASCII
case-insensitive, and a UUID is ASCII case-insensitive and canonicalizes to
lowercase. `<uuid>` is the plain 8-4-4-4-12 hexadecimal form with no braces,
`urn:` prefix, or other spelling.

A trailing `[:selector]` is the ordinary read selector. See
[selectors](../selectors.md). The selector is not part of the resource, so
permission matching uses the selector-free form, and two selector spellings
address the same Project.

A percent escape, a query string, a fragment, an extra path segment, a trailing
slash after a UUID, another path word, or a malformed UUID is `invalid_path`.
The read refuses these forms before any Project row is read, with no URL
decoding and no filesystem operation.

## Accepted by

| Tool    | Accepted | Effect                                              |
| ------- | -------- | --------------------------------------------------- |
| `read`  | yes      | a listing or detail, with the native read selectors |
| `edit`  | no       | `unsupported_operation`, with no effect             |
| `write` | no       | `unsupported_operation`, with no effect             |

A `bash` `cwd` does not accept the scheme. Prompt imports accept it through the
same `read` acceptance path as every other native scheme. See
[prompt imports](../prompt-imports.md).

## Authority

A read uses the Run owner's identity and tenant-scoped datastore access. The
active listing reads only that owner's active Project rows. The archived
listing reads only that owner's archived rows. An individual read returns an
active or archived Project of that owner. Row-level security and the owner
filter decide this. The locator text grants no cross-owner access.

The read needs no executor and no Workspace binding. It performs no filesystem
probe, git operation, Machine contact, or Workspace change. A Chat with a
Workspace reads the same owner Projects as one without, and a relative path or
Workspace root does not change the result.

Normal `read` admission applies to the canonical selector-free locator before
content access. An uppercase scheme, the root alias, an uppercase UUID, and a
selector all project to the same resource, so none of them can avoid a rule
that rejects it. Admission of a Project locator grants no access to any
location the result prints. A later read of a returned checkout, and every
Workspace entry into it, uses its own existing admission.

Another owner's UUID and a UUID that does not exist both return `not_found`.
Neither response carries metadata, Project instructions, or locations. A read
with no Run identity discloses no Project content.

## Behavior

A detail returns the current stored rows, not the Run's applied or selected
Project values. It contains the Project's ID, name, description, archive state,
and its literal Project instructions. It adds each linked repository's ID,
alias, display name, canonical remote, and primary flag. Under each repository
it adds every owner-registered checkout's ID, kind (`main` or `worktree`),
parent checkout ID (null for a main checkout), executor identity, and stored
canonical locator. A main checkout and each worktree appear as separate records,
with no recommendation among them. A null canonical remote and a repository with
no checkout are stated as absent, with no invented location.

The detail orders repositories by alias, then ID, and checkouts by executor
identity, then locator, then ID. The same stored rows produce the same order.
The Project instructions are the owner's literal text. The read frames the
whole detail as reference data: it does not activate Project instructions,
change the Run's Project affiliation, bind a Workspace, or make a checkout
current.

Every location is labelled registered and unverified. The locator is the stored
value: an absolute path for a main or worktree checkout on a local executor,
and a canonical `machine://` locator with its executor identity for a Machine
checkout. The read does not probe the location, run git, or contact the Machine.
A registered location that happens to equal a private configuration path is
returned as the registration's locator, without identifying or consulting that
configuration. The detail does not disclose SSH settings, daemon configuration,
Knowledge backing paths, credentials, Chat IDs, lease owners, or worktree-base
settings. A canonical remote is credential-free.

The detail does not direct the assistant to enter, switch, remain in, confirm,
or leave a Workspace, and it selects no worktree. An entry into a location is a
separate action under the existing tools and policy.

Every authored or registered scalar is contained as a JSON literal in a fenced
field body. The renderer JSON-encodes the value, then escapes every remaining
character with the Unicode `Cc` property and the line separators U+2028 and
U+2029. A fence is longer than every run of backticks in its encoded content.
Field text therefore cannot create a document heading, an entry, a location
label, a verification label, or a cap notice. Outline headings are generated by
the document, not by field text.

A value of at most 1000 code points occupies one fenced JSON string. A longer
value becomes a fenced JSON array of chunks of at most 1000 code points each,
one chunk per source line. The document instructs the reader to concatenate the
chunks without separators. Decoding and concatenation restore the original
value exactly.

The document is a Markdown text source. The rendered source lines, not the
lines of a stored field, are the selector coordinates. Native ranges, `:raw`,
`:outline`, and context lines apply to the rendered document. A long field's
chunks are ordinary source lines, so a range or raw read reaches the complete
value.

Each read renders its own current source. Two selector reads are two reads of
the rows as they then stand, so an owner change between them can move an entry
or a line. A page number, line number, or continuation is not a cross-read
snapshot, hash, lock, or authority token.

## Bounds

A listing or detail shares the native [result bound](../selectors.md#result-bounds).
The rendered source carries its total line count, so the header and the
continuation line state what was shown and what remains. A bound never drops a
Project, repository, or checkout without a continuation that reaches it. An
encoded value is chunked so that one escaped source line still fits below the
native 16,000 UTF-16 code-unit ceiling. No field is cut or silently shortened.

## Listing

`projects://` lists the owner's active Projects and `projects://archived` lists
the owner's archived Projects. Each Project has one entry carrying its ID, name,
description, archive state, and `projects://<uuid>` locator. A listing contains
no Project instructions, repository inventory, or checkout location. The active
and archived listings exclude each other's Projects. Entries sort by name, then
UUID, in code-point order. A selector pages entries by rendered source line, and
a long description's chunk lines remain within its one entry.

## Errors

| Error                   | When                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `invalid_path`          | an unknown path, a percent escape, a query, a fragment, an extra segment, a trailing slash, or a malformed UUID |
| `invalid_selector`      | a suffix outside the selector grammar, or a selector outside the rendered source                                |
| `not_found`             | a missing UUID, or another owner's UUID, both without content                                                   |
| `unsupported_operation` | an `edit` or `write` naming the locator                                                                         |

A rejected locator returns the ordinary read permission denial without Project
content. A datastore failure is reported as an error, never as an empty listing
or a missing Project. Missing Run identity returns no Project content.

## Configured by

- [Tool-call permissions](../../operator/tool-call-permissions.md#matching) sets
  the `read` rules that admit or reject a Project locator. A field-allow `read`
  group admits `projects://` only with a `^projects://` allow.

The scheme needs no executor and no separate operator enablement. It is served
wherever `read` is allowlisted and the owner has Projects.

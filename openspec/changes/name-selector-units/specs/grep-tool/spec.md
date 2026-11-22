## MODIFIED Requirements

### Requirement: Every hit is a locator that the read group admits

Before a file contributes a hit, the tool MUST evaluate the `read` group.
The evaluation sets `path` to the canonical locator of that file, under the
projection that `read` applies. When the `read` evaluation is not an allow,
the file contributes nothing. The tool MUST NOT emit, count as examined, or
name that file in the result. A host, Knowledge, or skill walk MUST NOT open
that file.

A Machine walk opens the file on the Machine, under the Machine's own
authority. The page of the daemon never reaches the model before the check.
The daemon counts those files as examined. An absent `read` group MUST make
every file contribute nothing.

The result MUST NOT tell the model how many files the `read` group refused.
The completion audit, which the owner sees, MUST carry that count. The
`tool-call-permissions` capability defines how the decisions are recorded.

When a scope has no glob operator, the tool MUST probe that path first. The
exact-path `read` check and the `not_found` answer apply only when that path
is one regular file. When the `read` group refuses that file, the tool MUST
return the same `not_found` result as for a missing path. The result then
does not reveal whether the file exists. The tool MUST walk a directory scope
with a `read` check per file, for every scheme. The tool MUST NOT count that
directory as a refused file.

An ignore file that the walker reads as walk policy is not a candidate. The
walker MUST NOT emit its content and needs no `read` decision for it.

Unless protected-key replacement changes it, every emitted `locator` MUST have the form
`<canonical file locator>:L<start>-<end>`, with a one-based inclusive line range in the canonical
selector spelling. That unprotected value MUST be a valid `read` argument.
Admission MUST still use the original canonical identity, before presentation replacement. In a `kb://` or
`skill://` locator the tool MUST spell each segment as the canonical
formatter of that scheme does. So a literal `*` stays `*` and a literal `?`
becomes `%3F`. To use such a locator as a later scope, the model writes `%2A`
for a literal `*`.

A `kb://` hit MUST carry the logical Knowledge locator. A `machine://` hit MUST carry
the Machine locator. A hit MUST NOT carry a configured root or a Machine host
path.

A result with at least one `kb://` passage MUST carry `notice`. The value
MUST be the closed Knowledge untrusted-content notice. That notice MUST be
the text that `read` and `knowledge_search` carry. A result with no `kb://`
passage MUST NOT carry `notice`.

#### Scenario: A read reject hides a file beneath an admitted scope

- **WHEN** the `grep` group allows `/home/u/repo/` and the `read` group rejects `regex: "\\.env$"` on `path`
- **THEN** a grep over `/home/u/repo/**` never opens `/home/u/repo/.env`
- **AND** the result does not name `.env` and carries no count of refused files
- **AND** the completion audit records one refused file

#### Scenario: A refused exact path looks missing

- **WHEN** the `read` group rejects `/home/u/.ssh/` and a scope is `/home/u/.ssh/id_ed25519`
- **THEN** the tool returns `not_found`
- **AND** the result is identical for `/home/u/.ssh/absent`

#### Scenario: A refused directory scope is still walked

- **WHEN** the `read` group allows `literal: "/home/u/repo/"` and a scope is `/home/u/repo`
- **THEN** the tool walks that directory
- **AND** a file beneath it contributes a passage
- **AND** the completion audit counts no refused file for the directory

#### Scenario: A Knowledge passage carries the notice

- **WHEN** a result holds one passage of `kb://<id>/notes/a.md`
- **THEN** the result carries `notice` with the closed Knowledge untrusted-content notice
- **AND** a result with no `kb://` passage carries no `notice`

#### Scenario: A hit is a valid read argument

- **WHEN** line 12 of `kb://<id>/notes/a.md` matches
- **THEN** the hit locator is `kb://<id>/notes/a.md:L11-13`
- **AND** a `read` of that locator shows lines 11 to 13 in its window

#### Scenario: A Knowledge file named with an asterisk returns as a scope

- **WHEN** line 3 of the Knowledge file `notes/a*.md` matches
- **THEN** the hit locator is `kb://<id>/notes/a*.md:L2-4`
- **AND** `kb://<id>/notes/a%2A.md` as a later scope searches that one file

#### Scenario: Another owner's Space is not found

- **WHEN** a scope names a Space that belongs to another owner
- **THEN** the tool returns `knowledge_space_not_found`
- **AND** no directory of that Space is probed

### Requirement: The remainder line names the next files

When the artifact holds passages after the inline part, the result MUST carry
one remainder line. The line MUST give the count of files and passages after
the inline part. It MUST name at most ten of the next files, each with its
line range in the artifact.

#### Scenario: The next files are named with their ranges

- **WHEN** the inline part holds 20 files and the artifact holds 140 more files with 610 passages
- **THEN** the remainder line counts 140 files and 610 passages
- **AND** it names the next ten files, each with its `artifact://grep-<n>:L<a>-<b>` range

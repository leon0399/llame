## MODIFIED Requirements

### Requirement: Skill locators provide live read-only package access

`read` SHALL accept `skill://<name>[:selector]` for a package's `SKILL.md`, `skill://<name>/<path>[:selector]` for supporting files, `skill://<name>/` for its directory, and `skill://` for the current bounded catalog. The catalog form SHALL support pagination through native directory range selectors. Skill names SHALL follow the Agent Skills name grammar. Resource segments SHALL follow the Knowledge locator's once-only decoding, selector separation, size/depth, and traversal validation rules. Native directory/read/range/raw/truncation behavior SHALL apply except for the explicit catalog representation. `edit` and `write` SHALL reject skill locators as unsupported operations without effects.

The resolver SHALL re-evaluate the current winning package on each call through the catalog port. It SHALL take the current turn's explicit selection set as a parameter: a manual-only package's body or resource read SHALL return a bounded structured refusal naming explicit selection unless that set contains the package, and the catalog listing SHALL omit manual-only packages not in that set. The Run supplies the set derived from its triggering user message to every skill read it performs, model-initiated reads included; a caller with no turn context supplies an empty set. Symbolic links beneath a source or inside a package follow ordinary operating-system semantics as `agent-skills` specifies; the resolver SHALL NOT resolve, verify, or contain them for access. Missing/invalid packages, unsupported operations, and invalid resource paths SHALL return bounded structured errors. The resolver SHALL NOT read special files.

Results SHALL carry the logical locator, selected source, absolute `resolvedPath`, and absolute `skillDirectory`, both as discovered beneath the configured source rather than resolved real paths. These paths and an instruction to resolve package-relative references/script paths into absolute paths using `skillDirectory` SHALL be present in model-facing output as well as owner metadata. That instruction SHALL distinguish task-relative inputs and explicit `cwd` from package-relative paths; the tool SHALL NOT rewrite commands. The result bound SHALL reserve space for this envelope before truncating resource content; if the envelope cannot fit, the read SHALL fail with a bounded error. This publication exception SHALL apply only to operator skill paths, not Knowledge paths. Ordinary permission admission SHALL match a pure canonical projection of the submitted skill locator before any resource open: decode resource segments once, validate and re-encode through the shared locator grammar, and omit read selectors. It SHALL never substitute a physical path. Existing configured/default read rules SHALL apply to that projection, including credential-path rejects; no skill-specific permission bypass or duplicate deny list SHALL be introduced.

#### Scenario: Skill resource exposes the execution base

- **WHEN** the model reads `skill://pdf/scripts/extract.py`
- **THEN** the result includes the current script content and model-visible file and package paths as discovered beneath the configured source, plus the real package directory
- **AND** no script executes during the read

#### Scenario: Skill root and directory differ

- **WHEN** the model reads `skill://pdf` and then `skill://pdf/`
- **THEN** the first reads `SKILL.md` and the second lists the package directory

#### Scenario: Raw root read returns the instructions verbatim

- **WHEN** the model reads `skill://pdf:raw`
- **THEN** the result carries the current `SKILL.md` bytes without line-number prefixes
- **AND** the skill result envelope with `skillDirectory` and `resolvedPath` is still present

#### Scenario: Manual-only package is not selected this turn

- **WHEN** a read targets `skill://review` and `review` is manual-only and absent from the turn's selection set
- **THEN** the read returns a bounded refusal naming explicit selection without opening the file
- **AND** `skill://` does not list `review`

#### Scenario: Special-file resource link fails

- **WHEN** a resource symlink resolves to a special file rather than a regular file or directory
- **THEN** the read fails `not_regular_file` without opening the target, because the followed target's kind is checked before any open

#### Scenario: Mutation is unsupported

- **WHEN** an edit or write targets `skill://pdf/SKILL.md`
- **THEN** it returns an unsupported-operation error without a mutation attempt or filesystem effect

### Requirement: Directory reads return a deterministic bounded listing

When `read` targets an existing directory without a range selector, it SHALL
return a listing of that directory and its immediate child directories'
entries, two levels deep. The first content line SHALL be the header: the
directory path as given by the caller. The header SHALL NOT count as a listing
entry. Each entry SHALL be rendered on its own line, indented two spaces per
level below the requested directory, as `- name/` for a directory, `- name` for
a regular file, `- name@/ -> <target>` for a symbolic link whose target is a directory,
`- name@ -> <target>` for a symbolic link whose target is a regular file,
`- name@? -> <link text>` for a symbolic link that is dangling or resolves to
a special entry, and `- name?` for any other entry kind such as a FIFO, socket,
or device. `<target>` SHALL be the canonical absolute path the link resolves
to, so that a model without shell access learns where a link leads; a
dangling link SHALL show its raw link text because it cannot resolve. A
`kb://` listing SHALL render every symbolic link as the bare `- name@` with no
target kind and no target, because a Knowledge result exposes no resolved host
path. Rendering a link SHALL read its metadata and target path only, SHALL do
so only for the entries the listing assembles (the requested level or the
requested slice of it, and the capped head of each child directory), and
SHALL NOT open it. Symbolic links
found as entries SHALL NOT be descended whatever their target kind, and
special entries SHALL NOT be opened or followed. A link whose target is a
directory SHALL order among non-directory entries by name, as a link does
today. A symbolic link given as the
target path SHALL resolve to its target directory as file reads resolve today.
Entries below the second level SHALL be counted but never rendered. A directory
with no entries SHALL render `(empty directory)` as its only line after the
header. Within one directory, entries SHALL be ordered with directories first
and then by name under the runtime's default `localeCompare`. Entries SHALL be shown verbatim:
hidden entries, ignore files, and entry metadata other than a link's target
kind and target SHALL NOT alter the listing in this iteration. The listing
SHALL be a pure function of entry names, kinds, counts, link target kinds and
targets, and that comparator, so two reads of a directory whose entries and
link targets are unchanged on one host produce identical content. The comparator resolves against the runtime's
default locale, so ordering is stable per host rather than defined across
hosts. Result details SHALL identify the path and the
directory kind, and listing lines SHALL carry no generated line-number
prefixes.

#### Scenario: Vault structure is listed in one read

- **WHEN** the model reads a directory containing files, subdirectories, and a symbolic link
- **THEN** content starts with the header, lists directories before files at each level, renders each child directory's entries indented beneath it, and marks the symbolic link with `@`, its target kind, and its canonical target without listing anything beneath it

#### Scenario: Special entry is marked and never opened

- **WHEN** the model reads a directory containing a FIFO
- **THEN** the FIFO appears as `- name?` in order among the files
- **AND** the read completes without opening it

#### Scenario: Symbolic link target is listed

- **WHEN** the model reads a path that is a symbolic link to a directory
- **THEN** the result lists the target directory's entries
- **AND** the header is the path as given

#### Scenario: Empty directory

- **WHEN** the model reads a directory with no entries
- **THEN** content is the header followed by `(empty directory)`

#### Scenario: Listing is deterministic

- **WHEN** the model reads the same unchanged directory twice
- **THEN** both results have byte-identical content and details

#### Scenario: Linked package directory shows where it leads

- **WHEN** the model reads a directory containing `octocat`, a symbolic link to a directory elsewhere on the host, and `herdr`, a symbolic link whose target no longer exists
- **THEN** the listing renders `- octocat@/ -> <canonical target directory>` and `- herdr@? -> <raw link text>`
- **AND** neither link is descended or opened

#### Scenario: Knowledge listing shows a link without its target

- **WHEN** the model lists a `kb://` directory containing a symbolic link
- **THEN** the link renders as `- name@` with no target kind and no target
- **AND** the read of that link still fails `not_found`

#### Scenario: Link rendering is deterministic and unaffected by siblings

- **WHEN** an entry is added beside a symbolic link and the directory is read again
- **THEN** the link's line is byte-identical to the previous read
- **AND** the entry order rule is unchanged

## ADDED Requirements

### Requirement: Reads through symbolic links report the real path

When a file `read` on an absolute host path opens a file whose canonical absolute path differs from the normalized path as given, because the path or any component of it is a symbolic link, the result SHALL carry that canonical path as `realPath`. A directory listing SHALL NOT carry `realPath`; its header is the path as given and its link entries carry their own targets. The header and line numbering SHALL remain those of the path as given; `realPath` SHALL count against the result bound like every other result field and SHALL be present before the result is measured, SHALL be absent when the two paths are equal, and SHALL be omitted with the read otherwise unaffected when the canonical path cannot be resolved. `kb://` and `skill://` reads SHALL NOT carry `realPath`. A `skill://` result SHALL instead carry the real package directory as `realSkillDirectory` in its envelope when it differs from `skillDirectory`, reserved before content exactly as the other envelope fields are; when the real directory cannot be resolved the field is omitted and the read is otherwise unaffected.

#### Scenario: File read through a linked directory

- **WHEN** the model reads `/home/u/.agents/skills/octocat/SKILL.md` and `octocat` is a symbolic link to `/home/u/dotfiles/skills/octocat`
- **THEN** content and header are exactly those of the path as given
- **AND** the result carries `realPath: /home/u/dotfiles/skills/octocat/SKILL.md`, counted within the result bound

#### Scenario: Ordinary read carries no real path

- **WHEN** the model reads a file whose normalized path contains no symbolic link, including one written with `..` segments
- **THEN** the result carries no `realPath`

#### Scenario: Skill result names both directories

- **WHEN** the model reads `skill://octocat` and the package is a symbolic link beneath its configured source
- **THEN** `skillDirectory` is the link path beneath the source
- **AND** the envelope also carries `realSkillDirectory` with the real package directory

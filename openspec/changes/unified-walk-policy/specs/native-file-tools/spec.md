## MODIFIED Requirements

### Requirement: Directory reads return a deterministic bounded listing

When `read` targets an existing directory without a range selector, it MUST
return a listing of that directory and of its immediate child directories'
entries, two levels deep. The first content line MUST be the header: the
directory path as the caller gave it. The header MUST NOT count as a listing
entry. Each entry MUST render on its own line. An entry indents two spaces per
level below the requested directory. The listing renders `- name/` for a
directory, `- name` for a regular file, `- name@/ -> <target>` for a symbolic
link whose target is a directory, and `- name@ -> <target>` for a symbolic link
whose target is a regular file. It renders `- name@? -> <link text>` for a
symbolic link that dangles or resolves to a special entry. It renders
`- name?` for any other entry kind, such as a FIFO, socket, or device.
`<target>` MUST be the canonical absolute path the link resolves to, so a
model without shell access learns where a link leads. A dangling link MUST show
its raw link text, because it cannot resolve. A link whose text cannot be read
MUST render as the bare `- name@`. A `kb://` listing MUST render every symbolic
link as the bare `- name@`, with no target kind and no target, because a
Knowledge result exposes no resolved host path. Rendering a link MUST read its
metadata and target path only. It MUST do so only for the entries the listing
assembles. These are the requested level, the requested slice of it, and the
capped head of each child directory the policy enters. It MUST NOT open a link.
Symbolic links found as entries MUST NOT be descended, whatever their target
kind. Special entries MUST NOT be opened or followed. A link whose target is a
directory MUST order among non-directory entries by name, as a link does
today. A symbolic link given as the target path MUST resolve to its target
directory, as file reads resolve today.

The listing MUST apply the walk policy to every entry it reaches by traversal.
The requested directory itself MUST NOT be filtered, whatever the policy names.
A fixed infrastructure entry MUST render as an entry, with no entries below
it. This holds when an ignore rule also names that entry, because the fixed
set decides first, as the walk policy states. An entry that an ignore rule
excludes, and that the fixed set does not name, MUST NOT render. Such an entry
MUST NOT count in the requested level's entry count. A host or Machine
listing MUST apply the ignore files of the walked tree, as the walk policy
defines them. A `kb://` listing MUST render a fixed infrastructure entry with
no entries below it, and it applies no ignore file.

The listing MUST count entries below the second level, and it MUST NOT render
them. A directory with no entries MUST render `(empty directory)` as its only
line after the header. Within one directory, directories MUST order first.
Then entries order by name under the runtime's default `localeCompare`. Hidden
entries MUST render. The listing MUST be a pure function of entry names,
kinds, counts, link target kinds and targets, the walk policy, and that
comparator. Two reads of a directory whose entries and link targets are
unchanged on one host MUST produce identical content. The comparator resolves
against the runtime's default locale. Ordering is therefore stable per host,
not defined across hosts. Result details MUST identify the path and the
directory kind. Listing lines MUST carry no generated line-number prefixes.

#### Scenario: Vault structure is listed in one read

- **WHEN** the model reads a directory containing files, subdirectories, and a symbolic link
- **THEN** content starts with the header, lists directories before files at each level, renders each child directory's entries indented beneath it, and marks the symbolic link with `@`, its target kind, and its canonical target without listing anything beneath it

#### Scenario: An infrastructure directory renders without its entries

- **WHEN** the model reads a repository root that holds `.git`
- **THEN** the listing renders `- .git/` among the directories
- **AND** no entry below `.git` renders

#### Scenario: An ignored entry is absent from the listing

- **WHEN** the model reads a repository root whose `.gitignore` names `dist/`
- **THEN** the listing holds no `dist` entry
- **AND** a read of `dist/` itself still lists that directory

#### Scenario: A gitignored fixed entry still renders without children

- **WHEN** the model reads a repository root whose `.gitignore` names `node_modules/`
- **THEN** the listing renders `- node_modules/` with no entries below it

#### Scenario: The requested directory is never filtered

- **WHEN** the model reads `/home/u/repo/.git/`
- **THEN** the listing shows the entries of that directory, header and children
- **AND** the policy does not apply to the requested path

#### Scenario: A Space listing renders its jj directory without entries

- **WHEN** the model reads a `kb://` Space root that holds `.jj` and `.git`
- **THEN** the listing renders `- .git/` and `- .jj/` with no entries below them
- **AND** `read kb://<space>/.git/HEAD` still opens that file

#### Scenario: A Machine listing omits an ignored tree

- **WHEN** a Machine directory holds `.ignore` naming `.agents/`
- **THEN** the listing of that directory holds no `.agents` entry
- **AND** a read of `.agents/` itself still lists that directory

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

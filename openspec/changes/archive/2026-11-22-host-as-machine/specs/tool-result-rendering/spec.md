## MODIFIED Requirements

### Requirement: An artifact notice is one bracketed line

The artifact notice MUST be one bracketed line that names each part as
`<locator> (<lines> lines)`, with a comma between two parts. A count of one
MUST read `1 line`. A `grep` or `web_search` notice MUST add
`; continue with <locator>:<next>-`. `<next>` is the artifact line after the
last inline passage or result. A notice for artifact files MUST add
`; host files in <locator>`, where `<locator>` is the `machine://` locator of
the directory, or `; host files only on Machine <name>`.

#### Scenario: A notice without a host file

- **WHEN** `artifact://grep-7` has 4,812 lines, the inline part ends at line 200, and no file exists
- **THEN** the notice is `[full result: artifact://grep-7 (4812 lines); continue with artifact://grep-7:201-]`

#### Scenario: A web notice continues after the inline results

- **WHEN** `artifact://web_search-4` holds 20 results and one answer, and the inline text shows results 1 to 10, which end at artifact line 40
- **THEN** the notice ends with `; continue with artifact://web_search-4:41-]`

#### Scenario: A bash notice without a host file

- **WHEN** only the stdout of `bash-5` spills, its artifact has 5,000 lines, and no file exists
- **THEN** the notice is `[full result: artifact://bash-5/stdout (5000 lines)]`

#### Scenario: A notice with a host file

- **WHEN** a `bash` artifact has two files on the `machines.local` Machine `devl`
- **THEN** the notice names both parts with their line counts and then the directory as a `machine://devl/...` locator

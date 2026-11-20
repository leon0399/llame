## Purpose

Expose the owner's Projects and registered checkout locations through read-only locators, so an agent can discover task context without implicit Workspace entry.

## ADDED Requirements

### Requirement: Project locators have explicit resource forms

`read` MUST accept `projects://` for active Projects, `projects://archived` for archived Projects, and `projects://<uuid>` for one Project. The scheme MUST match without ASCII case sensitivity. UUIDs MUST normalize to lowercase. The root alias `projects:///` MUST equal `projects://`. Unknown paths, queries, fragments, and malformed UUIDs MUST fail as `invalid_path` before a datastore read.

#### Scenario: Project identity does not depend on its name

- **WHEN** the owner has two Projects with the same name
- **THEN** their distinct UUID locators read the correct individual Projects

#### Scenario: Equivalent spellings share one identity

- **WHEN** `read` receives an uppercase scheme or uppercase UUID
- **THEN** dispatch and permission projection use the same lowercase canonical locator

#### Scenario: An invalid resource is refused

- **WHEN** `read` receives `projects://name`, `projects://id/other`, or a locator with a query or fragment
- **THEN** it returns `invalid_path` without a datastore read

### Requirement: Project reads use owner authority and read admission

A Project read MUST use authenticated Run identity and tenant-scoped datastore access. It MUST pass normal `read` admission on the canonical selector-free Project locator before content access. The read MUST require no executor or Workspace binding. Another owner's UUID and a missing UUID MUST both return `not_found`. Missing identity MUST disclose no Project content.

#### Scenario: An unbound Chat discovers Projects

- **WHEN** an admitted Run without a Workspace reads `projects://`
- **THEN** it lists only that owner's active Projects
- **AND** it binds no executor

#### Scenario: A rejected locator yields no content

- **WHEN** `read` policy rejects a canonical Project locator
- **THEN** the tool returns the existing permission denial without Project content

#### Scenario: Selectors cannot bypass a rejection

- **WHEN** policy rejects `projects://<uuid>` and the model uses a case variant with `:raw:1-10`
- **THEN** admission still rejects the same canonical resource

#### Scenario: A foreign Project is indistinguishable from a missing Project

- **WHEN** an admitted read targets another owner's Project or a nonexistent UUID
- **THEN** both return `not_found` without metadata, instructions, or locations

### Requirement: Project listings expose bounded discovery metadata

A Project listing MUST contain only Project IDs, names, descriptions, archive state, and individual locators. Active and archived listings MUST exclude each other's entries. Both MUST sort by name and then UUID. Listing text MUST encode authored line breaks without a second entry. Instructions, repository inventories, and checkout paths MUST NOT appear in a listing.

#### Scenario: Active discovery omits archived Projects

- **WHEN** the owner reads `projects://`
- **THEN** only active Projects appear with their detail locators

#### Scenario: Archived discovery is explicit

- **WHEN** the owner reads `projects://archived`
- **THEN** only archived Projects appear with their detail locators

#### Scenario: A crafted name does not forge an entry

- **WHEN** a Project name contains line breaks and locator-like text
- **THEN** the listing keeps that name inside its one entry

### Requirement: An individual Project read returns current reference data

An individual read MUST return the Project ID, name, description, archive state, literal instructions, and linked repositories. It MUST return current stored values, not the Run's selected reminder values. The result MUST frame all content as reference data. The read MUST NOT activate instructions, change Project affiliation, or bind a Workspace.

#### Scenario: Another Project's instructions stay reference data

- **WHEN** a Chat in A reads B's instructions
- **THEN** the result labels B's instructions as reference data
- **AND** A remains the Run's applied Project context

#### Scenario: Current stored instructions differ from selected instructions

- **WHEN** the owner edits instructions after dispatch and the agent reads that Project
- **THEN** the tool returns the new stored text
- **AND** it does not replace the Run's applied guidance

#### Scenario: An archived Project remains individually readable

- **WHEN** an admitted read names an archived Project's UUID
- **THEN** it returns that Project's current details

### Requirement: Repository details expose actionable registered locations

Each linked repository MUST expose its ID, alias, display name, canonical remote, and primary flag. Each of its owner's registered checkouts MUST expose its ID, kind, parent ID, executor identity, and stored canonical locator. Local locators MUST be absolute paths. Machine locators MUST retain `machine://` authority. The read MUST NOT disclose another owner's checkouts.

#### Scenario: One repository has local and Machine checkouts

- **WHEN** a linked repository has owner checkouts `/work/api` and `machine://nas/srv/api`
- **THEN** the detail returns both with their distinct executor identities
- **AND** each location can serve as an explicit Workspace-entry target under existing policy

#### Scenario: A repository has worktree checkouts

- **WHEN** the linked repository has a main checkout and two worktree checkouts
- **THEN** the detail identifies each kind and parent without choosing one

#### Scenario: Another owner registers the same remote

- **WHEN** another owner registers a checkout of the same canonical remote
- **THEN** that checkout does not appear in this owner's Project read

#### Scenario: A repository has no remote or checkout

- **WHEN** a linked repository has no canonical remote or has no registered checkout
- **THEN** the result states those absences without an invented location

### Requirement: Project discovery does not inspect or authorize locations

The result MUST label every checkout location as registered and unverified. A Project read MUST perform no filesystem probe, git operation, Machine contact, or Workspace mutation. Admission of the Project locator MUST grant no access to returned locations. The result MUST NOT require entry, switching, confirmation, or worktree selection.

#### Scenario: A Machine is offline

- **WHEN** a registered checkout names an offline Machine
- **THEN** its stored location still appears as unverified
- **AND** the read makes no contact with that Machine

#### Scenario: A discovered location is not admitted for entry

- **WHEN** a Project read returns a location that existing entry policy rejects
- **THEN** a subsequent entry request follows that rejection
- **AND** the discovery result confers no approval

### Requirement: Project documents use native text bounds and selectors

Project listings and details MUST render as Markdown text sources with total line counts. Native text ranges, `raw`, and `outline` MUST apply to rendered lines. Existing result bounds and continuation notices MUST keep every omitted entry and section reachable. A cap MUST NOT silently drop Projects, repositories, or checkouts. Detail order MUST remain stable for unchanged records.

#### Scenario: A listing exceeds the result bound

- **WHEN** the rendered listing exceeds the native result bound
- **THEN** its cap notice gives a progressing selector for the same resource
- **AND** later reads can reach every entry

#### Scenario: A detail has more checkouts than fit inline

- **WHEN** a detail's checkout section exceeds the result bound
- **THEN** native line selectors can reach the omitted locations
- **AND** the result does not claim that its inline subset is complete

#### Scenario: The owner changes data between pages

- **WHEN** the owner changes Project data between two selector reads
- **THEN** each read represents its own current source
- **AND** the tool makes no snapshot-pagination guarantee

### Requirement: Project locators remain read-only through every consumer

`edit` and `write` MUST reject Project locators without a mutation. Prompt imports MUST use the existing native-scheme acceptance path and `read` admission. An imported Project document MUST remain data. Consumers MUST NOT infer filesystem instruction triggers from checkout locators inside that document.

#### Scenario: A mutation names a Project locator

- **WHEN** the model calls `edit` or `write` on `projects://<uuid>`
- **THEN** the tool returns `unsupported_operation`
- **AND** no Project, checkout, or file changes

#### Scenario: An owner imports a Project document

- **WHEN** a prompt contains an admitted `@projects://<uuid>` marker with `read` available
- **THEN** the existing prompt-import flow imports its native read result as data
- **AND** it activates no Project or repository instructions from that result

### Requirement: Checkout disclosure excludes private configuration

Admitted detail reads MUST expose owner-registered checkout locators, even when their text equals a configured private path. They MUST NOT derive or disclose SSH configuration, daemon roots, Knowledge backing paths, prompt-file paths, or credentials from operator configuration. Canonical remote identities MUST exclude credentials. Automatic snapshots and collection listings MUST NOT derive checkout locators from registrations.

#### Scenario: Discovery returns a path without daemon configuration

- **WHEN** a Project detail contains a Machine checkout
- **THEN** it exposes the registered Machine locator and executor identity
- **AND** it exposes no SSH hostname, user, key, connection command, or daemon configuration

#### Scenario: Discovery does not expose credentials from a remote

- **WHEN** a repository's source remote used credentials
- **THEN** the Project detail returns only its credential-free canonical remote identity

### Requirement: Project documents contain text inside its source field

Listings and details MUST encode authored and registered text as literal field values. Such text MUST NOT create document headings, checkout entries, verification labels, or cap notices. Encoding MUST preserve the original value. Every rendered line MUST fit native result bounds, including maximum-length instructions after escaping. Selectors MUST reach the complete encoded value.

#### Scenario: A detail value cannot forge a checkout

- **WHEN** a name, description, instruction, or registered path contains Markdown headings, fences, line breaks, and a false verification label
- **THEN** the detail keeps that content inside its source field
- **AND** `outline` exposes no heading from that value

#### Scenario: Maximum-length instructions remain fully reachable

- **WHEN** 16000 non-BMP characters form one instruction line
- **THEN** the document encodes that field across bounded source lines
- **AND** native selectors can retrieve the whole value without character loss

#### Scenario: A registered location equals a private path

- **WHEN** an owner-registered checkout locator equals a configured daemon root or Knowledge backing path
- **THEN** the admitted detail returns only the registration's locator
- **AND** it reveals no equality, binding, or configuration-derived information

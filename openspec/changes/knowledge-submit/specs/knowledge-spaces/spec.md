## MODIFIED Requirements

### Requirement: Provisioning allocates one safe child beneath the configured root

For each hosted resource, trusted code SHALL generate the stable Knowledge Space
identifier and derive one direct child directory from it beneath the operator-
configured Knowledge root. It SHALL canonicalize the root, require it to be an
accessible directory, and prove the child resolves directly beneath that root. It
SHALL NOT scan for candidate directories, claim a caller-named directory, or fall
back to Home, the process working directory, a user-ID-derived location, another
owner's child, or remote storage.

Provisioning SHALL create and validate the exact stable-ID child and initialize a
validated empty Git repository with active branch `main` before inserting its
owner row in a PostgreSQL transaction. A committed authority row SHALL therefore
begin with a usable directory and repository. If directory or Git creation fails,
no authority row SHALL commit. If database insertion or commit fails after
directory/repository creation, the empty unauthoritative child MAY remain;
recovery SHALL NOT delete or repurpose it. A later `POST` is a new non-idempotent
creation attempt and MAY allocate a distinct resource.

Root resolution, child creation, Git initialization, or child validation failure
SHALL return the existing safe `503 knowledge_space_unavailable` API response and
SHALL expose no filesystem path, Git diagnostic, or raw diagnostic. Database
insertion or commit failure SHALL use the API's existing safe internal-error
response, expose no database, Git, or filesystem diagnostic, and leave any
created child unauthoritative. Successful item and list operations SHALL use
their declared `2xx` responses; malformed input SHALL return `400`, missing or
other-owner items SHALL return the same `404`, and missing authentication SHALL
return `401`.

Only an owner row visible under RLS grants authority to a child directory; an
unlinked directory or repository alone grants none. Existing Spaces are not
migrated by this requirement; the alpha operator may prepare them locally before
using `knowledge_submit`.

#### Scenario: Empty Space is created with Git main

- **WHEN** an owner creates a Space under a valid writable Knowledge root and Git is available
- **THEN** the exact stable-ID child exists with an empty validated repository whose active branch is `main` before the authority row commits
- **AND** no content file is staged or committed

#### Scenario: Empty space is created without Git

The legacy scenario name is retained for delta compatibility; this revised
requirement now initializes an empty repository, but still creates no content
commit or staged file.

- **WHEN** an owner creates a Space under a valid writable Knowledge root and Git initializes successfully
- **THEN** the Space contains no content commit or staged file before the owner row commits
- **AND** the empty repository is ready for a later local submit

#### Scenario: Partial filesystem failure is retryable

- **WHEN** creating, validating, or initializing the derived child fails before the owner row is inserted
- **THEN** provisioning returns a closed unavailable result and commits no authority row
- **AND** a later `POST` may make a new creation attempt without deleting the failed entry

#### Scenario: Database failure leaves no authority

- **WHEN** database insertion or commit fails after the child and repository were created
- **THEN** no owner row grants access to that child
- **AND** recovery does not delete the child or treat it as an existing authorized Space

#### Scenario: Missing or unusable root is closed

- **WHEN** the configured root is absent, not a directory, or unusable
- **THEN** provisioning returns `knowledge_space_unavailable`
- **AND** it does not create a child or repository elsewhere

#### Scenario: Git failure leaves no authority

- **WHEN** Git initialization or repository validation fails before owner-row commit
- **THEN** provisioning returns `knowledge_space_unavailable`
- **AND** no owner row grants access to the child

#### Scenario: Database failure preserves an unauthoritative repository

- **WHEN** database insertion or commit fails after directory and Git initialization
- **THEN** no owner row grants access
- **AND** recovery does not delete or repurpose the child or repository

#### Scenario: Existing Space is not migrated

- **WHEN** an existing Space has no valid Git repository
- **THEN** provisioning does not scan or initialize it
- **AND** `knowledge_submit` later reports repository unavailable until the operator repairs it

#### Scenario: Existing symlink child is refused

- **WHEN** the derived stable-ID child exists as a symbolic link or non-directory
- **THEN** provisioning fails closed
- **AND** it does not follow, replace, or expose the entry

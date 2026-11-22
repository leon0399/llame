## MODIFIED Requirements

### Requirement: Repository details expose actionable registered locations

Each linked repository MUST expose its ID, alias, display name, canonical remote, and primary flag. Each of its owner's registered checkouts MUST expose its ID, kind, parent ID, executor identity, and stored canonical locator. Every stored locator MUST be the canonical Machine locator `machine://<name>/<absolute path>` of its Machine. This MUST apply to a checkout on the host Machine. The read MUST NOT disclose another owner's checkouts.

#### Scenario: One repository has local and Machine checkouts

- **WHEN** a linked repository has owner checkouts `machine://devl/work/api` and `machine://nas/srv/api`
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

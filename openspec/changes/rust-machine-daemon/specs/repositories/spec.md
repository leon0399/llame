## MODIFIED Requirements

### Requirement: Registration and removal map failures to typed statuses

An unknown or foreign identifier MUST answer 404. A duplicate owner path MUST
answer 409. A validation failure MUST answer 422. A path without a repository
MUST answer 422 `not_a_repository`.

A missing allow MUST answer 403 `tool_not_allowed`. A refused path MUST answer
403 `permission_denied`. An executor failure MUST answer 503. Another git
failure or a timeout MUST answer 502 `git_failed` with the redacted standard
error.

#### Scenario: A git failure answers 502

- **WHEN** inspection fails with a git error
- **THEN** the request answers 502 with `git_failed` and the redacted standard
  error
- **AND** the system stores no row

#### Scenario: A git timeout answers 502

- **WHEN** inspection does not end within its timeout
- **THEN** the request answers 502 with `git_failed` and stores no row

#### Scenario: A path that is not a repository answers 422

- **WHEN** the owner registers an absolute path that holds no git repository
- **THEN** the request answers 422 with `not_a_repository` and stores no row

#### Scenario: An outdated daemon answers 503

- **WHEN** registration targets a Machine whose daemon reports another protocol version
- **THEN** the request answers 503 with `machine_update_required` and stores no
  row

#### Scenario: An unknown repository identifier answers 404

- **WHEN** the owner registers a checkout that names an unknown repository
  identifier
- **THEN** the request answers 404 and stores no row

## MODIFIED Requirements

### Requirement: The call removes the results that the read permission group rejects

This requirement applies when the effective permission mode is `default` or `read-only`. The call MUST remove each result and citation whose URL a `read` reject clause matches, as `read` decides for that URL. A whole-tool `read` reject or an absent `read` allow MUST NOT remove an entry. The `bypass` mode MUST NOT remove entries. These clauses MUST NOT admit or refuse the call.

#### Scenario: The call removes a rejected host

- **WHEN** the `read` group rejects `^https://grokipedia\.com/` and an engine returns a `grokipedia.com` result and two other results
- **THEN** the output contains only the two other results
- **AND** a note states that the call removed one entry and does not contain `grokipedia`

#### Scenario: No read allow keeps the results

- **WHEN** the `read` group has no allow for `^https://` and no reject that matches the results
- **THEN** the output keeps every result

#### Scenario: A whole-tool read reject keeps the results

- **WHEN** the `read` group sets `reject: true` for the whole tool
- **THEN** the output keeps every result

#### Scenario: Bypass keeps the results

- **WHEN** the effective permission mode of the attempt is `bypass` and the `read` group rejects a result host
- **THEN** the output keeps that result

#### Scenario: Read-only removes a rejected host

- **WHEN** the effective permission mode of the attempt is `read-only` and the `read` group rejects a result host
- **THEN** the output does not contain that result

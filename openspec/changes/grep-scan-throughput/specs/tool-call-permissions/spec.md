## ADDED Requirements

### Requirement: Grep evaluates excluded directories against the read group

The sixth named exception also covers each directory that a `grep` walk
excludes by an ignore rule. The system MUST evaluate the `read` group on that
directory locator as written and with a final separator. The system MUST NOT
record these decisions one by one. They MUST NOT count toward the refused-file
count of the completion audit. A `bypass` attempt MUST evaluate no such directory.

#### Scenario: Directory decisions are not recorded

- **WHEN** a grep walk excludes 12 directories and the `read` group refuses 2 of them
- **THEN** `tool.requested` carries one decision for the call
- **AND** the completion audit counts no refused file for those directories

#### Scenario: A bypassed Run names every excluded directory

- **WHEN** a `bypass` attempt runs a grep walk that excludes `/home/u/repo/node_modules`
- **THEN** the system evaluates no `read` group for that directory
- **AND** `ignored.locators` holds `/home/u/repo/node_modules`

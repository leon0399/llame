## MODIFIED Requirements

### Requirement: Grep scopes are admitted per scope and files per hit

The system MUST evaluate a `grep` call against the `grep` group once per
submitted scope, in scope order, before the tool opens any file. Each
evaluation uses the `grep` scope projection of `Match submitted string values
without serialization artifacts`, which the `grep-tool` capability defines. A
field clause on `scopes` MUST match the projected prefix.

Configuration validation MUST accept `scopes` as a declared field of the
`grep` group. Its schema is an array of strings, and each evaluation
substitutes one string. It is the only array-valued field that a clause can
name. An omitted `scopes` while a Workspace is entered uses the omitted-scope
exception of that requirement. The system MUST then evaluate the canonical
Workspace root as the one scope.

All-fields rejection MUST traverse `patterns`, each submitted scope, and each
projected prefix, as that requirement defines. A reject written
against a glob suffix or a pattern then still refuses. The call decision MUST
be the first rejection in scope order, or the allow of the last scope when
every scope is allowed. The system MUST record only that call decision on
`tool.requested`.

The per-file evaluation is the sixth named exception of that requirement. The
system MUST evaluate each candidate file against the `read` group. Its `path`
is the canonical locator of the file under the `read` projection of this
capability.
The system MUST NOT record these file decisions one by one. The completion
audit MUST carry the count of files the `read` group refused. The tool result
MUST NOT carry it. A bypassed Run MUST record one bypass decision for the call
and no file decision.

#### Scenario: All-fields reject sees the pattern

- **WHEN** the `grep` group has `reject: [{ allFields: true, regex: "BEGIN RSA" }]` and a pattern is `BEGIN RSA`
- **THEN** the call is refused
- **AND** no scope is searched

#### Scenario: All-fields reject sees the glob suffix

- **WHEN** the `grep` group rejects `literal: ".env"` across all fields and a scope is `/repo/**/.env`
- **THEN** the call is refused

#### Scenario: File refusals are counted, not listed

- **WHEN** the `read` group refuses 40 files beneath an admitted scope
- **THEN** `tool.requested` carries one allow decision for the call
- **AND** the completion audit reports 40 refused files and the result reports none

#### Scenario: A scopes clause passes configuration validation

- **WHEN** `tools.permissions.grep.allow` holds `{ field: "scopes", literal: "/home/u/" }`
- **THEN** worker boot succeeds

#### Scenario: An omitted scopes is evaluated as the Workspace root

- **WHEN** the Chat entered `/home/u/repo` and the model submits `grep` without `scopes`
- **THEN** the `grep` group is evaluated once with `scopes` set to `/home/u/repo/`

## ADDED Requirements

### Requirement: Artifact locators match as their logical text

For `read`, an `artifact://` locator MUST match as its submitted text with any
read selector removed. Policy matching MUST NOT see a host file path for it.
"Artifact reads evaluate each served finding" defines the finding re-check.

#### Scenario: A reject on an artifact locator refuses the read

- **WHEN** a `read` group rejects `path` with regex `^artifact://bash-` and the model reads `artifact://bash-3/stdout:1-50`
- **THEN** the matched text is `artifact://bash-3/stdout` and the reject refuses the call

#### Scenario: An allow on artifacts cannot reach another Chat

- **WHEN** a `read` group allows `^artifact://` and the model reads a locator that only another Chat has
- **THEN** the read returns `not_found`

### Requirement: Artifact reads evaluate each served finding

The sixth named exception also covers each finding that an artifact read
serves. The system MUST evaluate the `read` group on the recorded source
locator of that finding. The system MUST NOT record these decisions one by
one. They MUST NOT count toward the refused-file count of the completion
audit. A `bypass` attempt MUST evaluate no finding.

#### Scenario: Finding decisions are not recorded

- **WHEN** an artifact read serves 30 findings and the `read` group refuses 2 of them
- **THEN** `tool.requested` carries one decision for the call
- **AND** the completion audit counts no refused file for those findings

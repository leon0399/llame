## ADDED Requirements

### Requirement: Grep scopes are admitted per scope and files per hit

The system MUST evaluate a `grep` call against the `grep` group once per
submitted scope, in scope order, before the tool opens any file. Each
evaluation MUST see the submitted arguments with one change: the `scopes`
value is the projected literal prefix of that one scope, as the `grep-tool`
capability defines it. A field clause on `scopes` MUST match that prefix.

Configuration validation MUST accept `scopes` as a declared field of the
`grep` group. Its schema is an array of strings, but each evaluation
substitutes one string. This is the only array-valued field a clause can
name. When `scopes` is omitted and a Workspace is entered, the system MUST
evaluate the canonical Workspace root as the one scope. This exception
applies only to an omitted `grep` `scopes`, like the omitted `bash` `cwd`
exception.

An all-fields reject MUST traverse every submitted string value of the call:
`patterns`, `cursor`, and each submitted scope with its glob. It MUST also
traverse the projected prefix of every scope. A reject written against a glob suffix or a pattern then
still refuses. The call decision MUST be the first rejection in scope order,
or the allow of the last scope when every scope is allowed. The system MUST
record only that call decision on `tool.requested`.

The system MUST evaluate each candidate file against the `read` group with
`path` set to its canonical locator, under the `read` projection of this
capability. The system MUST NOT record these file decisions one by one. The
completion audit MUST carry the count of files the `read` group refused.
The tool result MUST NOT carry it. A bypassed Run MUST record one bypass decision for the
call and no file decision.

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

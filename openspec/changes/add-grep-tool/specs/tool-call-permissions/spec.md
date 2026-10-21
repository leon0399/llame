## ADDED Requirements

### Requirement: Grep scopes are admitted per scope and files per hit

The system MUST evaluate a `grep` call against the `grep` group once per
submitted scope, in scope order, before the tool opens any file. Each
evaluation MUST see the submitted arguments with one change: the `scopes`
value is the projected literal prefix of that one scope, as the `grep-tool`
capability defines it. A field clause on `scopes` MUST match that prefix.

An all-fields reject MUST traverse every submitted string value of the call,
`patterns` and `cursor` included. It MUST also traverse the projected prefix
of every scope. A reject written against a glob suffix or a pattern then
still refuses. The call decision MUST be the first rejection in scope order,
or an allow when every scope is allowed. The system MUST record only that
call decision on `tool.requested`.

The system MUST evaluate each candidate file against the `read` group with
`path` set to its canonical locator, under the `read` projection of this
capability. The system MUST NOT record these file decisions one by one. The
tool result and the completion audit MUST carry the count of files the
`read` group refused. A bypassed Run MUST record one bypass decision for the
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
- **AND** the result and the completion audit report `read_refused: 40`

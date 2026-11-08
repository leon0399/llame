# Spec Delta

## ADDED Requirements

### Requirement: The git entry check is a named synthetic read evaluation

The git state check of `workspace-git-state` is a named exception to matched
submitted values. It MUST evaluate the `read` group with the git entry path as
the `path` value. It is not a tool call. It MUST record no decision of its own.

#### Scenario: The git entry path is the evaluated value

- **WHEN** the system checks the git entry `/home/dev/src/llame/.git`
- **THEN** the `read` group evaluates `/home/dev/src/llame/.git` as the `path` value
- **AND** no tool call, decision record, or tool part results

### Requirement: The git entry check obeys modes and rejects

In `read-only`, the git entry check MUST occur as in `default`. In `bypass`, the
check MUST admit the entry without evaluation. A reject clause that matches the
git entry MUST refuse the check in `default` and `read-only`.

#### Scenario: A reject clause refuses the git entry

- **WHEN** the `read` group has a reject clause `/\.git(/|$)` and the system checks `/repo/.git`
- **THEN** the check refuses in `default` and `read-only`
- **AND** the check admits in `bypass`

#### Scenario: Read-only mode keeps git state

- **WHEN** a Run in `read-only` mode starts in a bound Chat and the `read` group admits the git entry
- **THEN** the Run carries the git snapshot

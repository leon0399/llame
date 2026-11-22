## ADDED Requirements

### Requirement: Every selector spelling leaves resource matching

For `read`, the evaluator MUST remove a split-off read selector in each spelling that `read`
accepts. This includes the `L` forms and the line-and-column form `N:M`. Thus a reject that names a
file MUST refuse a read of that file in every selector spelling. A web locator MUST lose its
fragment in the projected text, so a GitHub line anchor never changes the resource that the
evaluator matches.

#### Scenario: A reject refuses every selector spelling

- **WHEN** the `read` group rejects `path` matching `id_rsa$` on the current Machine `devl`
- **THEN** reads of `/home/u/.ssh/id_rsa:L1-5`, `/home/u/.ssh/id_rsa:l1-L5`, `/home/u/.ssh/id_rsa:-L5`, and `/home/u/.ssh/id_rsa:1:1` are each rejected before execution
- **AND** permission evaluation does no filesystem probe

#### Scenario: An exact allow admits the new spellings

- **WHEN** only an anchored exact allow for `machine://devl/tmp/file` exists
- **THEN** a read of `/tmp/file:L1-2` or `/tmp/file:12:5` on the current Machine `devl` is admitted

#### Scenario: A line anchor does not escape a web reject

- **WHEN** the `read` group rejects `path` matching `^https://github\.com/o/r/blob/main/secret\.ts$`
- **THEN** a read of `https://github.com/o/r/blob/main/secret.ts#L10-L20` is rejected before any request

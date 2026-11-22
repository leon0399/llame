## ADDED Requirements

### Requirement: A read selector of any spelling is removed before the resource match

For `read`, the evaluator MUST remove a split-off read selector in each selector shape that the
`read` split recognizes. These shapes include the `L` forms, the reserved-unit and misplaced-letter
members, and the line-and-column suffix `N:M`.
Thus a reject that names a file MUST refuse a read of that file in every selector spelling. A web
locator MUST lose its fragment in the projected text, so a GitHub line anchor never changes the
matched resource.

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

### Requirement: The literal-name gap covers the new selector shapes

The projection uses text only, so it MUST NOT probe whether a literal file has the removed suffix in
its name. The known text-only gap thus also covers a literal name that ends in a new shape:

- an `L`, `P`, or `M` member,
- a misplaced-letter member such as `L-5`,
- `:N:M`.

A reject that ends in `([/\\]|$|:)` MUST still refuse such a literal name.

#### Scenario: A literal name with a new shape is matched without its suffix

- **WHEN** a host file named `/home/u/secret:P3` exists and a reject matches `path` against `secret:P3$`
- **THEN** the projected text is `machine://devl/home/u/secret`, so that reject does not refuse the read
- **AND** a reject on `/home/u/secret` that ends in `([/\\]|$|:)` refuses it

## MODIFIED Requirements

### Requirement: Explicit mentions load skills before the first model request

The system MUST recognize exact `$skill-name` tokens in user-authored text. It MUST NOT
recognize them in fenced code, in inline code, or after an escaped dollar sign. A token MUST have
valid name boundaries. The system MUST load the distinct selected skills in first-mention order
before the first model request of the Run. For a message that a delivery of `run-steering` adds,
this is the first model request of its segment. The system MUST load a skill once when the user
turn mentions it more than once. Ordinary mentions stay model-selected.

Activation MUST use the read availability, input validation, permission admission, live resolver,
and result bounds of proactive reads. It MUST send the raw root read `skill://<name>:raw` with the
selection set of the turn. Thus the persisted instructions carry no line-number prefixes, and a
manual-only selection loads. The system MUST keep the user text under the reserved-delimiter
neutralization of today. Activation MUST NOT remove mention tokens or substitute arguments.

Explicit activation MUST attempt at most eight distinct selections. It has a 128 KiB aggregate
bound on serialized output, envelopes included. It has a 30-second aggregate work deadline, which
the Run deadline can make shorter. The output and time that are left MUST limit each read. When a
budget is used up, further reads MUST stop. The selections that were not attempted MUST give one
bounded omission notice, with no discovery or output per selection.

Each activation result MUST persist as an owner-visible context item, not as an invented model
tool call. An unavailable, invalid, or denied selection MUST give a bounded failure item. That
item carries one closed reason: `not_found`, `unavailable`, `permission_denied`, or
`read_failed`. A failure MUST NOT stop the other selections or the Run. The rendered activation
item MUST state the mention, the absolute skill directory, and the instructions file. It MUST
also state the relative-path and `cwd` guidance, a precedence statement, and the instruction body
without frontmatter, per `context-injection`.

#### Scenario: User selects two skills

- **WHEN** the user sends `$research $technical-writing compare these APIs`
- **THEN** both current instruction bodies load in that order before the first model request, under read admission
- **AND** the kept user text, with delimiter neutralization, follows the activation items

#### Scenario: Manual-only skill is selected explicitly

- **WHEN** the user sends `$review` and `review` is manual-only
- **THEN** its instructions load through the same read admission, with `review` in the selection set of the turn
- **AND** a `skill://review/references/checklist.md` read by the model in that Run succeeds with the same selection set
- **AND** the same read on a later turn without the mention is refused

#### Scenario: Example text is not an activation

- **WHEN** `$research` appears only in inline code, fenced code, or with an escaped dollar sign
- **THEN** it does not trigger explicit activation

#### Scenario: Explicit selection does not bypass permission

- **WHEN** the user selects a skill whose read is denied
- **THEN** no body is loaded and a persisted permission failure accompanies the user turn

#### Scenario: A delivered steer activates its skill

- **WHEN** a Run delivers a steer that names `$pdf`
- **THEN** the `pdf` instructions load before the first model request of the new segment

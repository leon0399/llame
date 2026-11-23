## MODIFIED Requirements

### Requirement: Unit letters are reserved

The grammar MUST reserve `L` for lines, `P` for pages, and `M` for messages, in either case. Only a Chat message index accepts `M`, under conversation-reads. No source accepts `P`.

Every non-Chat source MUST refuse an `M` or `P` member with `invalid_selector` after any literal-path probe. Remote SSH and Machine reads MUST also refuse those reserved units. An unknown letter MUST stay outside the grammar.

#### Scenario: A reserved unit fails on a text file

- **WHEN** the model reads `/tmp/notes.md:P3` or `/tmp/notes.md:-M2` and no file has that literal name
- **THEN** the tool returns `invalid_selector` with the shared refusal message

#### Scenario: A reserved unit is a selector on a remote path

- **WHEN** the model reads `ssh://box/notes:M2`
- **THEN** the tool returns `invalid_selector` and opens no file named `notes:M2`
- **AND** `ssh://box/notes%3AM2` reads the file named `notes:M2`

#### Scenario: A letter outside the reserved set stays on the path

- **WHEN** the model reads `ssh://box/notes:X5`
- **THEN** the read opens the file named `notes:X5`, because `X5` is not a selector shape there

#### Scenario: A literal file name wins over a reserved unit

- **WHEN** a host file named `/tmp/notes:P3` exists and the model reads `/tmp/notes:P3`
- **THEN** the read returns that file

## ADDED Requirements

### Requirement: Chat locators route to the owner datastore before Machine resolution

Native `read` MUST accept `chat://`, `chat://<uuid>`, and `chat://<uuid>/<seq>` under conversation-reads. Chat routing MUST precede Workspace projection and need no Machine. The reader MUST accept the resource-specific selectors of that capability. It MUST reject extra address components before datastore access. Chat scheme registration MUST NOT enable prompt imports. Mutations MUST follow the structured refusal of conversation-reads.

#### Scenario: Chat reads need no Machine

- **WHEN** an admitted Chat read runs without a reachable current Machine
- **THEN** it reads the owner datastore without binding or contacting a Machine

#### Scenario: Workspace does not alter Chat authority

- **WHEN** a bound Chat reads `chat://`
- **THEN** the result uses the trusted owner datastore, not a Workspace path

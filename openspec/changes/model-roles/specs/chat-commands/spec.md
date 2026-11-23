## MODIFIED Requirements

### Requirement: The API parses a command before it admits a send

A command is a send to `POST /api/v1/chats/:id/messages` for a Chat of the owner whose text part
starts with `/` and a command name. The name ends at whitespace or at the end of the text. A send
that also carries a file part is refused when its text part names a recognized command, as the
attachment requirement below states. The API MUST parse the send before it validates the selector or
admits a pending item.

#### Scenario: A command on the message endpoint

- **WHEN** the owner sends `/rename Release plan` to a Chat of the owner
- **THEN** the API runs the `/rename` command
- **AND** it does not check the `selector` of the send

#### Scenario: A first message is never a command

- **WHEN** the owner sends `/rename Foo` as the first message of a Chat id that does not exist
- **THEN** the API creates the Chat, stores the text as an ordinary message, and starts a Run

#### Scenario: Text with a space before the slash is a message

- **WHEN** the owner sends the text `/rename Foo` after one space
- **THEN** the API stores it as an ordinary message and starts a Run

### Requirement: A bare rename regenerates the title

`/rename` with no text after the name MUST ask the model of `defaults.titleGenerationSelector` for a new title. A title role follows `model-failover`. The new
title MUST replace the current title. The API MUST NOT record usage for this request. The request
MUST use the packaged title prompts that automatic titles use.

#### Scenario: A regenerated title follows the recent turns

- **WHEN** the newest turns of a Chat discuss a database migration and the owner sends `/rename`
- **THEN** the title model receives the text of those turns
- **AND** the Chat gets the title that the title model returns

#### Scenario: A regenerate does not use the chat model

- **WHEN** the owner sends `/rename` with the `selector` of a chat model
- **THEN** the request goes to the model of `defaults.titleGenerationSelector`

### Requirement: A bare rename without a title model fails

When `defaults.titleGenerationSelector` is absent, a bare `/rename` MUST answer 422 with a message
that says title generation is not configured. When the title request fails on each candidate, or
returns no usable title, the API MUST answer 502. In both cases the title MUST NOT change.

#### Scenario: No title model is configured

- **WHEN** no title selector is configured, and the owner sends `/rename`
- **THEN** the API answers 422, and the title does not change
- **AND** the API sends no model request

#### Scenario: A rename with a title still works without a title model

- **WHEN** no title selector is configured, and the owner sends `/rename Foo`
- **THEN** the title is `Foo`

### Requirement: Compact on an idle Chat starts a compaction Run

On a Chat with no live Run, `/compact` MUST start a compaction Run with the selector, effort, and
permission mode of the send. A send without `selector` MUST use the stored selection of the Chat, as
`model-roles` defines. The API MUST validate them as for a chat send. It MUST expire a stuck Run as a
chat send does. The command result MUST name the new Run id.

#### Scenario: Compact starts a Run

- **WHEN** the owner sends `/compact` to an idle Chat with five turns
- **THEN** the API answers 200 with a command result that names a Run
- **AND** that Run is a compaction Run

#### Scenario: Compact after a stuck Run

- **WHEN** the only non-terminal Run of the Chat is stuck, and the owner sends `/compact`
- **THEN** the API expires the stuck Run and starts a compaction Run

#### Scenario: A compact with an unknown model

- **WHEN** the owner sends `/compact` with a `selector` that the catalog does not offer
- **THEN** the API answers with the error of a chat send with that selector and starts no Run

#### Scenario: A compact on a held Chat

- **WHEN** the Chat holds `sonnet` for `@coding`, and the owner sends `/compact` with no `selector`
- **THEN** the compaction Run uses `sonnet`

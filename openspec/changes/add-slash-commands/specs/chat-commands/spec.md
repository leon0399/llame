## Purpose

Owner commands typed in the chat composer: one server-side parser at chat ingress, the command
result, and the `/rename` and `/compact` commands.

## ADDED Requirements

### Requirement: The API parses a command before it admits a send

A send is a command when it has exactly one part, that part is text, and the text starts with `/`
and a command name. The name ends at whitespace or at the end of the text. The API MUST parse the
send before it validates the model, creates a Chat, or admits a pending item. This MUST apply to
`POST /api/v1/chats/:id/messages` and to the first message of `POST /api/v1/chats`.

#### Scenario: A command on the message endpoint

- **WHEN** the owner sends `/rename Release plan` to a Chat of the owner
- **THEN** the API runs the `/rename` command
- **AND** it does not check the `modelId` of the send

#### Scenario: A command as the first message of a new Chat

- **WHEN** the owner sends `/compact` through `POST /api/v1/chats`
- **THEN** the API answers as `/compact` on a Chat with nothing to absorb
- **AND** it creates no Chat

#### Scenario: Text with a space before the slash is a message

- **WHEN** the owner sends the text `/rename Foo` after one space
- **THEN** the API stores it as an ordinary message and starts a Run

### Requirement: Only a recognized command name is a command

The recognized command names MUST be `rename` and `compact`. The match MUST be exact and case
sensitive. A send whose text starts with `/` and any other name MUST be an ordinary message. There
MUST be no escape syntax.

#### Scenario: A path is a message

- **WHEN** the owner sends `/etc/hosts is broken`
- **THEN** the API stores it as an ordinary message and starts a Run

#### Scenario: An unknown name is a message

- **WHEN** the owner sends `/summarize the chat`
- **THEN** the API stores it as an ordinary message and starts a Run

#### Scenario: A longer word is not a command

- **WHEN** the owner sends `/renamed files are missing`
- **THEN** the API stores it as an ordinary message

### Requirement: A command is never a message or model context

A command MUST NOT create a message row. Its text MUST NOT enter the model context of any Run. A
command that the API runs at once MUST answer with a JSON command result and status 200, not with a
Run stream. An error of a command MUST NOT store a message or start a turn Run.

#### Scenario: A rename leaves no trace in the history

- **WHEN** the owner sends `/rename Foo` and then reads the Chat history
- **THEN** the history holds no message with the text `/rename Foo`

#### Scenario: The answer is a command result

- **WHEN** the owner sends `/rename Foo`
- **THEN** the API answers 200 with a JSON body that names the command `rename` and the title `Foo`

### Requirement: A command with an attachment is refused

When a send has a file part and a text part that starts with a recognized command, the API MUST
answer 400. It MUST NOT store a message, start a Run, or change the Chat.

#### Scenario: A rename with an image

- **WHEN** the owner sends `/rename Foo` with an attached image
- **THEN** the API answers 400, and the Chat title does not change

### Requirement: A command follows the owner scope of its Chat

A command MUST read and change only a Chat of the authenticated owner. A command for a Chat of
another owner, or for a Chat that does not exist, MUST answer 404 and MUST NOT create a Chat. A
command for an archived Chat MUST answer 409.

#### Scenario: Another owner's Chat reveals nothing

- **WHEN** user B sends `/rename Foo` or `/compact` for a Chat of user A
- **THEN** the API answers 404
- **AND** the title, the checkpoints, the Runs, and the pending items of user A do not change

#### Scenario: A command for an absent Chat creates nothing

- **WHEN** the owner sends `/rename Foo` to a Chat id that does not exist
- **THEN** the API answers 404, and no Chat with that id exists after the request

#### Scenario: A command on an archived Chat

- **WHEN** the owner sends `/compact` to an archived Chat
- **THEN** the API answers 409 and starts no Run

### Requirement: Rename with a title sets that title

`/rename` with text after the name MUST set the Chat title to that text. The API MUST remove the
whitespace at the start and at the end. A title with 1 to 200 characters MUST replace the current
title, also while a Run is live. A longer title MUST get 400.

#### Scenario: A rename during a Run

- **WHEN** a Run of the Chat is `running_model` and the owner sends `/rename Release plan`
- **THEN** the Chat title is `Release plan`
- **AND** the Run continues, and no pending item is stored

#### Scenario: A title that is too long

- **WHEN** the owner sends `/rename` with 201 characters after the name
- **THEN** the API answers 400, and the title does not change

### Requirement: A bare rename regenerates the title

`/rename` with no text after the name MUST ask the configured title model for a new title. The
input MUST be the text of the newest user and assistant rows, at most 1,000 characters. It MUST
hold image and PDF placeholders as automatic titles do. The new title MUST replace the current title. The API
MUST NOT record usage for this request.

#### Scenario: A regenerated title follows the recent turns

- **WHEN** the newest turns of a Chat discuss a database migration and the owner sends `/rename`
- **THEN** the title model receives the text of those turns
- **AND** the Chat gets the title that the title model returns

#### Scenario: A regenerate does not use the chat model

- **WHEN** the owner sends `/rename` with `modelId` of a chat model
- **THEN** the request goes to the model of `TITLE_GENERATION_MODEL_ID`

### Requirement: A bare rename without a title model fails

When `TITLE_GENERATION_MODEL_ID` does not name a usable model, a bare `/rename` MUST answer 422
with a message that says title generation is not configured. When the title model request fails or
returns no usable title, the API MUST answer 502. In both cases the title MUST NOT change.

#### Scenario: No title model is configured

- **WHEN** no title model is configured and the owner sends `/rename`
- **THEN** the API answers 422, and the title does not change
- **AND** no model request is sent

#### Scenario: A rename with a title still works without a title model

- **WHEN** no title model is configured and the owner sends `/rename Foo`
- **THEN** the title is `Foo`

### Requirement: Compact on an idle Chat starts a compaction Run

On a Chat with no non-terminal Run, `/compact` MUST start a compaction Run with the model, effort,
and permission mode of the send. The API MUST validate them as for a chat send. The id of the send
message MUST become the Run id. The command result MUST name the Run id.

#### Scenario: Compact starts a Run

- **WHEN** the owner sends `/compact` with message id `M` to an idle Chat with five turns
- **THEN** the API answers 200 with a command result that names Run `M`
- **AND** Run `M` is a compaction Run

#### Scenario: A retried compact returns the same Run

- **WHEN** the owner sends `/compact` with message id `M` again after Run `M` started
- **THEN** the API answers with Run `M` and starts no second Run

#### Scenario: A compact with an unknown model

- **WHEN** the owner sends `/compact` with a `modelId` that the catalog does not offer
- **THEN** the API answers with the error of a chat send with that model and starts no Run

### Requirement: Compact with nothing to absorb is refused

A Chat can have no user or assistant row above the absorbed-through sequence of its active
checkpoint. Then `/compact` MUST answer 409 with the message `Nothing to compact.` It MUST NOT start a
Run. A Chat with one turn MUST compact.

#### Scenario: An empty Chat

- **WHEN** the owner sends `/compact` to a Chat with no user or assistant row
- **THEN** the API answers 409 with `Nothing to compact.` and starts no Run

#### Scenario: A second compact with no new turn

- **WHEN** the owner sends `/compact` again before any new turn after a checkpoint
- **THEN** the API answers 409 and starts no Run

#### Scenario: A short Chat compacts

- **WHEN** the owner sends `/compact` to a Chat with one completed turn
- **THEN** the API starts a compaction Run

### Requirement: Compact takes an optional focus

The text after `/compact` MUST be the focus of the compaction. The API MUST remove the whitespace at
the start and at the end. An empty focus MUST mean no focus. A focus with more than 1,000
characters MUST get 400, and the API MUST NOT start a Run or store a pending item.

#### Scenario: A focus is accepted

- **WHEN** the owner sends `/compact keep the migration plan`
- **THEN** the compaction Run has the focus `keep the migration plan`

#### Scenario: A focus that is too long

- **WHEN** the owner sends `/compact` with 1,001 characters after the name
- **THEN** the API answers 400 and starts no Run

### Requirement: Compact during a live Run is queued

When the Chat has a live Run, `/compact` MUST become a pending `queue` item, as `run-steering`
defines. A compaction Run MUST start only when the queue promotes that item. The API MUST answer 202
with the item.

#### Scenario: Compact during a Run

- **WHEN** a Run is `running_model` and the owner sends `/compact` with `delivery: "steer"`
- **THEN** the API answers 202 with a pending item in mode `queue`
- **AND** the live Run gets no steer

#### Scenario: Compact during a Run without a delivery mode

- **WHEN** a Run is live and the owner sends `/compact` with no `delivery`
- **THEN** the API answers 202 with a pending item in mode `queue`

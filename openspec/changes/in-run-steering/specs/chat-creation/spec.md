## MODIFIED Requirements

### Requirement: The first-message creation path is unchanged

`POST /api/v1/chats/:id/messages` MUST keep its current behavior, with two exceptions. The first
is the refusal while a create request holds the chat's creation lock. The second is a send with a
`delivery` mode during a live Run, which `run-steering` defines. A first message
to an unknown chat id MUST create a chat with no project and no bound root. A
message to a stored chat MUST NOT change its project or its bound root.
`PATCH /api/v1/chats/:id` MUST continue to file a chat.

#### Scenario: A first message creates an unfiled chat

- **WHEN** a client posts a first message for an unknown chat id
- **THEN** the chat is stored with no project and no bound Workspace root

#### Scenario: Filing stays a separate request

- **WHEN** the owner files the chat with `PATCH /api/v1/chats/:id`
- **THEN** the chat gains the project and no Workspace change of the bound roots

#### Scenario: A delivery send to a live Run is the second exception

- **WHEN** a client posts a message with `delivery: "queue"` to a stored chat with a live Run
- **THEN** the route answers as `run-steering` requires, and the chat keeps its project and bound root

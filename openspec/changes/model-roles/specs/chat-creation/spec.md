## MODIFIED Requirements

### Requirement: A create request with a message validates it before any write

When the request carries `message`, that field MUST be `CreateChatMessageDto`
(`id`, `parts`, and optional `selector`, `effort`, and `permissionMode`). It MUST
compose the message-parts schema and MUST NOT reuse `CreateMessageBodyDto`. The
server MUST validate the message before the first write. It MUST check the
selector, the effort, the permission mode, the parts, and the media ownership. A
failed check MUST answer as the message route does and MUST store nothing.

#### Scenario: An unavailable model stores nothing

- **WHEN** the request names an unavailable model
- **THEN** the response is 422 and no chat, bound root, or message is stored

#### Scenario: A media part of another owner stores nothing

- **WHEN** the request carries a media part that belongs to another owner
- **THEN** the response is 400 and no chat, bound root, or message is stored

#### Scenario: A create request names a role

- **WHEN** the request carries a message with `selector: "@coding"`
- **THEN** the chat stores the selection `@coding`, and its first Run uses the first candidate

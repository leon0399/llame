# Spec Delta

## ADDED Requirements

### Requirement: Chat-creation path decisions are recorded with the chat

The create request MUST record each path decision in an owner-only creation
record of the chat. The record MUST hold a list of attempts. Each attempt MUST
carry its decisions and its `created_at`. Each create or resend MUST append one
attempt in its own transaction. Each decision MUST carry the provenance fields
of a derived decision, and that includes a `bypass` decision. Only the owner
MUST read the record through `GET /api/v1/chats/:id/creation-record`, and
another principal MUST receive 404.

#### Scenario: A bypass create records its decisions

- **WHEN** the owner creates a chat with `bypass` enabled and the group rejects
  both paths
- **THEN** the creation record holds both decisions with `allow`, reason
  `permission_mode_bypass`, the policy-instance ID, and no clause reference

#### Scenario: A default-mode create records its decisions

- **WHEN** the owner creates a chat in `default` mode and the group allows both
  paths
- **THEN** the creation record holds both decisions with their clause and
  policy-instance provenance

#### Scenario: A resend after a rejected decision keeps both attempts' decisions

- **WHEN** a path decision rejects the first create and the owner resends the
  same chat id
- **THEN** the creation record holds two attempts, each with its decisions and
  its `created_at`
- **AND** the first attempt keeps its rejected decision

#### Scenario: Another principal cannot read the creation record

- **WHEN** another user requests the creation record of a chat
- **THEN** the response is 404 and it discloses no decision

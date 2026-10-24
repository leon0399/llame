# Spec Delta

## ADDED Requirements

### Requirement: Chat-creation path decisions are recorded with the chat

The create request MUST record every path decision it takes in an owner-only
creation record of the chat. Each record MUST carry the same provenance fields as
a derived decision. The record MUST include a `bypass` decision. The owner MUST
read the record through `GET /api/v1/chats/:id/creation-record`. Only the owner
MUST read it, and another principal MUST receive 404.

#### Scenario: A bypass create records its decisions

- **WHEN** the owner creates a chat with `bypass` enabled and the group would
  reject both paths
- **THEN** the creation record holds both decisions with `allow`, reason
  `permission_mode_bypass`, the policy-instance ID, and no clause reference

#### Scenario: A default-mode create records its decisions

- **WHEN** the owner creates a chat in `default` mode and the group allows both
  paths
- **THEN** the creation record holds both decisions with their clause and
  policy-instance provenance

#### Scenario: Another principal cannot read the creation record

- **WHEN** another user requests the creation record of a chat
- **THEN** the response is 404 and it discloses no decision

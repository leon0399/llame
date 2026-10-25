# Spec Delta

## ADDED Requirements

### Requirement: Chat-creation path decisions are recorded with the chat

The create request MUST record each path decision in an owner-only creation
record of the chat. The record MUST hold a list of attempts. Each attempt MUST
carry its decisions and its `created_at`. Each decision MUST carry the provenance fields
of a derived decision, and that includes a `bypass` decision. Only the owner
MUST read the record through `GET /api/v1/chats/:id/creation-record`, and
another principal MUST receive 404.

#### Scenario: A bypass create records its decisions

- **WHEN** the owner creates a chat that reuses its checkout, with `bypass`
  enabled, and the group rejects both paths
- **THEN** the creation record holds the submitted-path and `canonical`
  decisions with `allow`, reason
  `permission_mode_bypass`, the policy-instance ID, and no clause reference

#### Scenario: A default-mode create records its decisions

- **WHEN** the owner creates a chat that reuses its checkout, in `default`
  mode, and the group allows both paths
- **THEN** the creation record holds the submitted-path and `canonical`
  decisions with their clause and
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

### Requirement: A creation attempt is appended only after a path decision

A create or resend MUST append one attempt when its Workspace step takes a path
decision. The attempt MUST commit in its own transaction, before any git write,
and it MUST stay when a later step fails. A request that fails validation,
answers 404 or 409, or resolves no location MUST append no attempt.

#### Scenario: A 422 create appends no attempt

- **WHEN** the request sets `baseRef` to `--x` and the create answers 422
- **THEN** the creation record holds no attempt and the create stores nothing

#### Scenario: A rejected decision keeps its attempt

- **WHEN** a path decision rejects and the create answers `bind_failed`
- **THEN** the creation record holds one attempt with the rejected decision
- **AND** the attempt stays after the failed step

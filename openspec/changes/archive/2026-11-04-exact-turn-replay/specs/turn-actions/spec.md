## MODIFIED Requirements

### Requirement: Continue requests the next step of the same turn

The first model request of a Continue Run MUST carry the history through the triggering user
message, then the kept parts. It MUST build them through the projection of `turn-replay`. Each kept
step MUST be one assistant message with its reasoning, its text, and its tool calls, then one
message with their results. Kept results MUST be complete. The request MUST NOT add a user-role
message, except a kept context item. The Run MUST NOT execute a kept call again.

#### Scenario: Continue sends the kept steps with their reasoning

- **WHEN** the owner continues a `failed` Run whose kept step holds a reasoning part with encrypted provider metadata and two parallel tool calls
- **THEN** the first model request carries one assistant message with that reasoning part, its metadata, and both calls, then both results
- **AND** the request has no user-role message after those results

#### Scenario: Sequential steps stay separate

- **WHEN** the kept parts hold call `t1` from one model response and call `t2` from the next response, with no text or reasoning between them
- **THEN** the first model request carries `t1` and its result, then a second assistant message with `t2`, then its result

#### Scenario: Continue sends long results in full

- **WHEN** the kept parts hold tool results of more than 100,000 characters in total
- **THEN** the first model request carries each kept result as the live loop sent it, with no omission marker

#### Scenario: Continue does not repeat a settled call

- **WHEN** the kept parts hold a settled `edit` call
- **THEN** the Continue Run does not invoke `edit` for that call
- **AND** the model receives the stored result of that call

#### Scenario: Kept parts that do not fit fail the Run

- **WHEN** the history through the triggering user message and the kept parts do not fit the model window, even after compaction of the history
- **THEN** the Continue Run fails with the context-incompatible error
- **AND** no compaction absorbs a kept part

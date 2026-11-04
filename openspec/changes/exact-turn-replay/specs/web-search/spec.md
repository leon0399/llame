## MODIFIED Requirements

### Requirement: Stored output is the normalized result only

The persisted tool part MUST contain the normalized output of the inline
results and no raw vendor payload. When the call has an artifact, the part
MUST also name its locator. The part MUST replay into later turns as the live
loop sent it, like any other tool result. It MUST NOT appear in public chat
shares.

#### Scenario: Reload reproduces the output

- **WHEN** the owner reloads a chat after a `web_search` call completed
- **THEN** the reloaded tool part equals the normalized output of the results that the model received inline

#### Scenario: A public share omits the search

- **WHEN** the owner publicly shares a chat that contains a `web_search` call
- **THEN** the shared view contains no `web_search` tool part, input, output, or notes

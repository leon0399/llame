## MODIFIED Requirements

### Requirement: An interrupted reply keeps its complete output

The reply of an interrupted segment MUST keep its text and its settled tool calls. Later model
requests MUST carry them. An interrupt can end the wait for the started calls of a failed send.
The reply MUST then exclude the cut of that send, as `provider-failures` defines. Its reasoning parts follow the rule of `reasoning-output` for a reply
that an interrupt closed. The reasoning part that the interrupt cut MUST stay in the transcript.

#### Scenario: The cut reasoning part never replays

- **WHEN** an interrupt stops a response during its second reasoning part
- **THEN** the first reasoning part replays with its provider metadata
- **AND** the second reasoning part stays in the transcript, and no request carries it

#### Scenario: An interrupt during the wait of a failed send

- **WHEN** a send streams text, a complete `bash` tool-call part, and more text, then breaks, and the owner interrupts while `bash` runs
- **THEN** the reply keeps the first text and the `bash` part, and later requests do not carry the text after it

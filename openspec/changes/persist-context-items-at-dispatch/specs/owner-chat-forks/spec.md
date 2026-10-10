## MODIFIED Requirements

### Requirement: The owner selects a durable prefix

The owner SHALL be able to fork their own Chat as a whole or through an inclusive user or assistant message. A whole-chat fork SHALL copy every durable message; an explicit anchor SHALL copy every user and assistant row at or below that anchor together with every `checkpoint` row whose absorbed-through sequence is at or below it. Run status SHALL NOT gate a fork, so a fork taken while a source Run is executing succeeds and copies the accepted user message. Such a fork SHALL NOT copy that Run's assistant message while it is still `running`, nor the partial output and in-Run context items stored on it. The source and its messages, `checkpoint` rows included, SHALL be read from one datastore snapshot and committed as one destination without a message-count cap. Forking SHALL NOT mutate the source. An absent source, foreign-owner source, or anchor outside the owned source Chat SHALL retain not-found behavior.

#### Scenario: Whole-chat fork during an in-flight Run

- **WHEN** `U1 A1` is complete and the source has accepted `U2` whose Run is still executing
- **THEN** the whole-chat fork contains `U1 A1 U2` and no Run
- **AND** the source Run's `running` reply to `U2`, with its partial output and stored in-Run items, is not copied
- **AND** the Run's later settlement writes only to the source

#### Scenario: An explicit anchor is inclusive

- **WHEN** the source history is `U1 A1 U2 A2` and the owner selects `U2`
- **THEN** the fork contains exactly `U1 A1 U2`
- **AND** it remains idle until the owner submits a new message

## MODIFIED Requirements

### Requirement: A Run that the host starts uses the settings of its notice

A notice MUST record the model selector, the effort, the permission mode, and the origin of the Run
that started its job. A Run that the host starts MUST use the settings of the first pending notice.
It resolves the selector as `model-roles` defines. The system MUST validate those settings as
`run-steering` validates a queue item. When they are no longer valid, a Run MUST NOT start, and the
notices MUST stay pending.

#### Scenario: The recorded mode is no longer enabled

- **WHEN** a job started under `bypass`, and the operator removed `bypass` before the job settles
- **THEN** no Run starts, and the notice stays pending

#### Scenario: A notice uses the hold of the Chat

- **WHEN** a job started on a `@coding` Run, and the Chat has a fallback hold on `sonnet` when the job settles on an idle Chat
- **THEN** the Run that the host starts uses `sonnet`

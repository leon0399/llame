## ADDED Requirements

### Requirement: Provider failures never carry a configured credential

On every provider wire and every language-model request kind, each occurrence
of a member of the instance's configured credential set (`instance-config`) in
a failure's message SHALL be replaced with `[REDACTED]` before the message is
recorded on the run, shown to the owner, emitted on a run event, or logged,
including by a caller that supplies no error handler. A message that contains
no member SHALL be reported exactly as the wire's own failure contract says.

#### Scenario: An echoed credential is redacted on every wire

- **WHEN** a stubbed upstream for an `openai-responses`, `openai-completions`, `anthropic-messages`, `openai-codex`, or `opencode-go` entry fails with a message containing that entry's resolved `key`
- **THEN** the run's failure message and its terminal run event contain `[REDACTED]` and not the key
- **AND** the run's failure log line contains no key

#### Scenario: Every request kind is covered

- **WHEN** compaction, title generation, a hosted web search, or a structured generation fails with an upstream message containing a configured header substitution
- **THEN** its recorded or logged message contains `[REDACTED]` and not the substitution

#### Scenario: A failure without a credential is unchanged

- **WHEN** an upstream fails with `Invalid API key.` and no configured credential occurs in it
- **THEN** the reported message is exactly `Invalid API key.`

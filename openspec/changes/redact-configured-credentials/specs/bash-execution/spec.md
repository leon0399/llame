## ADDED Requirements

### Requirement: Bash results redact configured credentials

The values the host knows to be secret SHALL be the instance's configured
credential set (`instance-config`). Each occurrence of a member in a result's
stdout or stderr SHALL be replaced with `[REDACTED]`, longest member first,
before the output bound is applied and before the result is recorded,
replayed, or shown to the model.

#### Scenario: A printed provider key is redacted

- **WHEN** a provider `key` resolves to `sk-canary-1065` and a bash command prints a file containing it
- **THEN** the result's stdout contains `[REDACTED]` where the key was
- **AND** the recorded result and its replay contain no `sk-canary-1065`

#### Scenario: A header substitution printed on stderr is redacted

- **WHEN** an MCP server's header resolves a `{path:…}` substitution to `gw-canary` and a command writes it to stderr
- **THEN** the result's stderr contains `[REDACTED]` and no `gw-canary`

#### Scenario: Non-credential configuration survives

- **WHEN** `knowledge.root` resolves to `/srv/kb` and a command prints `/srv/kb/notes.md`
- **THEN** the result contains `/srv/kb/notes.md` verbatim

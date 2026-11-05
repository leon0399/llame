## MODIFIED Requirements

### Requirement: Interpolated header values get the provider key's non-disclosure

A header value that `{env:…}` or `{path:…}` resolves MUST get the protection
of a provider `key`. llame MUST NOT write it to a log, a diagnostic, or a
startup error. A resolved value with CR, LF, or NUL MUST fail startup and name
the path, because the header validation error quotes the value. llame MUST
redact such a value that a provider echoes in a failure (`provider-api-selection`,
"Provider failures never carry a configured credential").

#### Scenario: A startup error does not print a secret value

- **WHEN** a header value's `{path:…}` token fails to resolve at startup
- **THEN** the error names the configuration path and file location, not any resolved value

#### Scenario: A control character fails startup without disclosure

- **WHEN** a header value's `{env:…}` token resolves to text with a line feed
- **THEN** startup fails, names the header path, and does not print the resolved value

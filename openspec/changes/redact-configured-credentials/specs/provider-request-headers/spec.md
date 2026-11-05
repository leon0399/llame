## MODIFIED Requirements

### Requirement: Interpolated header values get the provider key's non-disclosure

A header value that `{env:…}` or `{path:…}` resolves MUST receive the same
protection as a provider `key`. llame MUST NOT write the value to a log, to a
diagnostic, or to a startup error. A resolved value that contains CR, LF, or
NUL MUST fail startup and name the path, because the runtime's header
validation error quotes the value. A provider can echo such a value in its own
error message. llame MUST redact that value from the failure as a configured
credential (`provider-api-selection`, "Provider failures never carry a
configured credential").

#### Scenario: A startup error does not print a secret value

- **WHEN** a header value's `{path:…}` token fails to resolve at startup
- **THEN** the error names the configuration path and file location, not any resolved value

#### Scenario: A control character fails startup without disclosure

- **WHEN** a header value's `{env:…}` token resolves to text with a line feed
- **THEN** startup fails, names the header path, and does not print the resolved value

## MODIFIED Requirements

### Requirement: Interpolated header values get the provider key's non-disclosure

A header value resolved from `{env:…}` or `{path:…}` SHALL receive the same protection as a provider `key`: llame SHALL NOT write it to a log, diagnostic, or startup error. A resolved value containing CR, LF, or NUL SHALL fail startup naming the path, because the runtime's header validation error would quote it. A provider that echoes such a value in its own error message has it redacted from the failure as a configured credential (`provider-api-selection`, "Provider failures never carry a configured credential").

#### Scenario: A startup error does not print a secret value

- **WHEN** a header value's `{path:…}` token fails to resolve at startup
- **THEN** the error names the configuration path and file location, not any resolved value

#### Scenario: A control character fails startup without disclosure

- **WHEN** a header value's `{env:…}` token resolves to text containing a line feed
- **THEN** startup fails naming the header path without printing the resolved value

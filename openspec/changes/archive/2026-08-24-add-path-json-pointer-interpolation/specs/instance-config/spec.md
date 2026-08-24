## MODIFIED Requirements

### Requirement: File-path (secret) interpolation in config values

String config values SHALL support a `{path:LOCATION}` interpolation token. Without a JSON selector, the token SHALL resolve to the trimmed contents of the file at `LOCATION`. `LOCATION` MAY end with `|json:POINTER`, where `POINTER` is an RFC 6901 JSON Pointer; the file SHALL be parsed as UTF-8 JSON and the pointer SHALL select a JSON string whose value is used as the resolution (without additional trimming). Token content runs to the first `}`; a `LOCATION` containing a literal `}` is unsupported and documented as such. A `LOCATION` whose path portion contains the literal substring `|json:` is unsupported and documented as such.

#### Scenario: Secret file exists

- **WHEN** a config value contains `{path:/run/secrets/openai_key}` and that file exists
- **THEN** the resolved value is the file's contents with surrounding whitespace trimmed

#### Scenario: Required secret file missing

- **WHEN** a config value contains `{path:LOCATION}` and no file exists at `LOCATION`
- **THEN** startup fails loudly, naming the config path and the missing file location
- **AND** the token is never left unresolved

#### Scenario: JSON pointer selects a string

- **WHEN** a config value contains `{path:/run/secrets/auth.json|json:/providers/openai/key}` and that file is valid JSON whose pointer selects a string
- **THEN** the resolved value is that string

#### Scenario: JSON pointer must select a string

- **WHEN** a `{path:…|json:…}` token's pointer selects a non-string JSON value
- **THEN** startup fails loudly, naming the config path and the file location
- **AND** the selected value does not appear in the error

#### Scenario: Invalid JSON or missing pointer

- **WHEN** a `{path:…|json:…}` token's file is not valid JSON, or the pointer does not select a value
- **THEN** startup fails loudly, naming the config path and the file location
- **AND** file contents do not appear in the error

## MODIFIED Requirements

### Requirement: Web adapter configuration is a closed operator replacement

The optional `tools.webAdapters` setting SHALL be an ordered array of unique
entries. Each entry SHALL have the shape `{ id, use, ... }`, where `id` is a
non-empty operator-chosen identifier and `use` is exactly `github`, `bluesky`,
`npm`, `huggingface`, `arxiv`, `stackexchange`, `crates`, `hackernews`, `doi`, `discourse`, `devto`, `substack`, `osv`, `wikipedia`, `telegram`, or `rewrite`. The array SHALL be an explicit replacement: absent SHALL mean
`[]`, while present SHALL enable exactly the listed entries. A `github` entry
SHALL have the shape `{ id, use: "github", token? }`; `token`, when present,
SHALL be an `{env:...}` or `{path:...}` interpolation token. A `bluesky` entry
SHALL have the shape `{ id, use: "bluesky" }` and accepts no credential; an
`npm` entry SHALL have the shape `{ id, use: "npm" }`, a `huggingface`
entry `{ id, use: "huggingface" }`, an `arxiv` entry
`{ id, use: "arxiv" }`, a `stackexchange` entry
`{ id, use: "stackexchange" }`, a `crates` entry `{ id, use: "crates" }`, a
`hackernews` entry `{ id, use: "hackernews" }`, a `doi` entry
`{ id, use: "doi" }`, a `devto` entry `{ id, use: "devto" }`, a `substack`
entry `{ id, use: "substack" }`, an `osv` entry `{ id, use: "osv" }`, a
`wikipedia` entry `{ id, use: "wikipedia" }`, and a `telegram` entry
`{ id, use: "telegram" }`; none accepts a credential. A `discourse` entry SHALL have
the shape `{ id, use: "discourse", hosts }`, where `hosts` is a non-empty
array of canonical lowercase hostnames without a port, validated like a
rewrite entry's `hosts`; it accepts no credential. A
`rewrite` entry SHALL
have the shape `{ id, use: "rewrite", hosts, pathPattern?, target }`, where
`hosts` is an array of exact canonical host matches,
`pathPattern` is an optional RE2-compatible regular expression compiled by
the same bounded matcher `tools.permissions` uses, searched unanchored
against the canonical path, and `target` is a literal `http` or `https`
origin followed by a path/query template. The target SHALL contain no
userinfo or fragment. `{path}` SHALL appear only in the path portion and
expands to the canonical path as-is; `{query}` SHALL appear only in the path
or query portion and expands to
`encodeURIComponent` of the canonical query without `?`. No other placeholder
is permitted.
Unknown fields, unknown uses, duplicate ids, invalid targets, malformed
templates, and invalid, oversized, or unsupported `pathPattern` values SHALL
fail startup before serving requests.
An `{env:...}` or `{path:...}` token in any non-secret field SHALL fail startup
naming the entry and field. A GitHub `token` SHALL be absent or use an
interpolation token; a literal token SHALL fail boot rather than be treated as
redacted. The loader SHALL reuse the existing single-pass interpolation and
redaction behavior for secret fields.

#### Scenario: An explicit empty list enables no adapter

- **WHEN** the file sets `tools.webAdapters: []`
- **THEN** no adapter is enabled
- **AND** a matching URL uses only the generic ladder, with no adapter origin
  contacted

#### Scenario: Declared rewrite is the only third-party contact

- **WHEN** the file declares one rewrite entry matching a URL
- **THEN** only that declared rewrite origin may be contacted for adapter
  fetching
- **AND** an unclaimed URL uses the generic ladder with no adapter request and
  no adapter note

#### Scenario: GitHub token uses existing secret interpolation

- **WHEN** a GitHub entry sets `token` to `{env:GITHUB_READ_TOKEN}` or
  `{path:/run/secrets/github-token}`
- **THEN** startup resolves the token through the existing interpolation
  resolver
- **AND** the resolved value is not written to logs, errors, diagnostics, or
  model-visible adapter notes

#### Scenario: Unknown adapter use fails closed

- **WHEN** an entry sets `use: "nitter"`
- **THEN** startup fails naming `tools.webAdapters` and that entry
- **AND** no partial adapter list is applied

#### Scenario: Duplicate adapter ids fail boot

- **WHEN** two entries use the same `id`
- **THEN** startup fails before serving requests
- **AND** neither entry is silently replaced

#### Scenario: Invalid rewrite target fails boot

- **WHEN** a rewrite target is non-http(s) such as `file:///tmp/x`, contains
  userinfo such as `https://user:secret@example.test/x`, has a fragment,
  places `{path}` in its scheme, host, port, or query, uses an unknown
  placeholder
  such as `{source}`, or has a malformed template
- **THEN** startup fails naming the entry and `target`
- **AND** the instance does not start with that rewrite enabled

#### Scenario: Invalid rewrite path pattern fails boot

- **WHEN** a rewrite entry supplies an invalid, oversized, or unsupported (for
  example a backreference or lookbehind) `pathPattern`
- **THEN** startup fails naming the entry and `pathPattern`
- **AND** no partial adapter configuration is applied

#### Scenario: Non-secret interpolation fails boot

- **WHEN** `{env:HOST}` or `{path:/run/secrets/value}` appears in
  `hosts`, `target`, `pathPattern`, or another non-secret field
- **THEN** startup fails naming the entry and field before resolving the token
- **AND** no partial adapter configuration is applied

#### Scenario: Literal GitHub token is rejected

- **WHEN** a GitHub entry supplies a literal token rather than an
  `{env:...}` or `{path:...}` interpolation
- **THEN** startup fails naming the token field because the literal cannot
  receive secret redaction
- **AND** no GitHub request is issued

#### Scenario: Adapter headers field fails boot

- **WHEN** any entry declares a `headers` field
- **THEN** startup fails naming the entry and unknown field
- **AND** no adapter request is issued

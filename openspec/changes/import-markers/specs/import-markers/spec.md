## Purpose

This capability defines the shared Markdown import-marker grammar and source-preservation behavior used by instruction-files, agent-skills/context-injection, and prompt-imports. Those consumer capabilities SHALL own target resolution, admission, loading, persistence, and disclosure; this capability only identifies markers and reports distinct targets in source order.

## ADDED Requirements

### Requirement: Markdown text recognizes only the three import marker shapes

The system SHALL recognize import markers in ordinary Markdown text only in these shapes: `@target`, `@[label](target)`, and `[label](target "import")`, where the link title is exactly `import`. It SHALL ignore text inside fenced code, inline code, and raw HTML.

#### Scenario: An email address is not a marker

- **WHEN** ordinary text contains `user@example.com`
- **THEN** no import marker is recognized

#### Scenario: An inline-code marker is not recognized

- **WHEN** `` `@README.md` `` appears in the text
- **THEN** no import marker is recognized

#### Scenario: A fenced-code marker is not recognized

- **WHEN** a fenced code block contains `@README.md`
- **THEN** no import marker is recognized

#### Scenario: Raw HTML containing a marker is not recognized

- **WHEN** raw HTML contains `@README.md`
- **THEN** no import marker is recognized

### Requirement: Bare markers obey boundary, token, and selector rules

A bare `@target` SHALL start only at the start of a text run or after whitespace or one of `(`, `[`, `{`, `<`, `"`, and `'`. Its target SHALL run to the next whitespace, after which trailing `.,;!?)]}"'` and one trailing bare `:` SHALL be removed; selector suffixes such as `:30-35`, `:outline`, and `:raw` SHALL remain part of the target.

#### Scenario: Sentence punctuation is excluded from a bare target

- **WHEN** the text says `see @docs/a.md.`
- **THEN** the marker target is `docs/a.md`

#### Scenario: A selector remains part of a bare target

- **WHEN** the text contains `@README.md:30-35`
- **THEN** the marker target is `README.md:30-35`

#### Scenario: An opening parenthesis provides a marker boundary

- **WHEN** the text contains `(@a.md)`
- **THEN** the marker target is `a.md`

### Requirement: Link markers require the import title and a valid at-sign boundary

The system SHALL recognize `@[label](target)` only when its `@` is at a bare-marker boundary, and SHALL recognize `[label](target "import")` only when the title is exactly `import`. A plain link without that title SHALL not be an import marker.

#### Scenario: A plain Markdown link is not an import marker

- **WHEN** the text contains `[docs](README.md)`
- **THEN** no import marker is recognized

#### Scenario: A titled Markdown link is an import marker

- **WHEN** the text contains `[docs](README.md "import")`
- **THEN** one import marker is recognized with target `README.md`

#### Scenario: An at-prefixed Markdown link is an import marker

- **WHEN** the text contains `@[docs](README.md)`
- **THEN** one import marker is recognized with target `README.md`

#### Scenario: A mid-word at-prefixed link is not an import marker

- **WHEN** the text contains `foo@[x](y)`
- **THEN** no import marker is recognized

### Requirement: Marker-bearing source text is preserved verbatim

The marker-bearing source text SHALL remain unchanged in stored, rendered, and replayed text, including its marker spelling and order. Imported content SHALL be injected beside that text and SHALL NOT remove or rewrite it.

#### Scenario: Imported content does not rewrite the marker text

- **WHEN** text containing `see @a.md and [docs](b.md "import")` is stored, rendered with imported content, and replayed
- **THEN** the marker-bearing text remains exactly `see @a.md and [docs](b.md "import")` in that order
- **AND** the imported content appears as additional content beside the unchanged text

### Requirement: Distinct targets are processed once in first-occurrence order

The system SHALL report or hand off each distinct parsed target at most once, in the order of its first marker occurrence. Target identity SHALL include any selector suffix, and consumer capabilities SHALL decide how each handed-off target is resolved.

#### Scenario: Repeated targets are deduplicated without changing order

- **WHEN** the text contains `@a.md`, `@[B](b.md)`, `[again](a.md "import")`, `@c.md`, and `@b.md`
- **THEN** consumers receive the distinct targets `a.md`, `b.md`, and `c.md` in that order
- **AND** `a.md` and `b.md` are each processed only once

#### Scenario: Selector variants are distinct targets

- **WHEN** the text contains `@README.md:raw` and `@README.md:outline`
- **THEN** consumers receive both targets in their first-occurrence order

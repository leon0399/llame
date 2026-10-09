## MODIFIED Requirements

### Requirement: Knowledge content is untrusted and potentially stale

The `knowledge_search` declaration, the native `read` declaration's `kb://` guidance, and every model-visible Knowledge result, including `kb://` reads and listings, SHALL identify filesystem content as owner-maintained, untrusted context that may be stale through the closed notice. `kb://` content SHALL NOT be rewritten or neutralized by the runtime; the framing is carried by the notice and the declarations so that returned bytes remain usable as exact `edit` targets. A `kb://` read whose file is an image SHALL return the image result with the closed notice and no file content; an image result is not an `edit` target, because it carries no text to copy as `oldText` and its `media://` locator is read-only. The tools SHALL NOT grant instructions inside notes authority over the system prompt, tool permissions, owner linkage, configured root, or execution environment. The model-facing contract SHALL direct materially volatile claims to appropriate external verification when those tools are available.

#### Scenario: Note attempts to widen authority

- **WHEN** a note instructs the model to select another directory, enable a tool, reveal a host path, or override system policy
- **THEN** no tool availability, linkage, or execution scope changes

#### Scenario: Knowledge read carries the notice verbatim

- **WHEN** the model reads a note through `kb://`
- **THEN** the result includes the closed untrusted-content notice
- **AND** the note's text is not neutralized: the selected source bytes are returned unchanged apart from the generated line-number prefixes, which `:raw` omits

#### Scenario: Note contains a volatile claim

- **WHEN** a retrieved note contains a claim whose current truth materially affects the answer
- **THEN** the model-facing contract identifies the note as potentially stale and directs external verification rather than treating filesystem presence as proof

#### Scenario: A Knowledge image carries the notice and no edit text

- **WHEN** the model reads `kb://<id>/diagrams/flow.png`, whose bytes are a PNG image
- **THEN** the result includes the closed untrusted-content notice and a `media://` locator, and carries no file content
- **AND** an `edit` or `write` of that `media://` locator returns the unsupported-operation error without changing the stored image

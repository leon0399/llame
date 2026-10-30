# Spec Delta

## MODIFIED Requirements

### Requirement: Knowledge content is untrusted and potentially stale

The `knowledge_search` declaration, the native `read` declaration's `kb://` guidance, and every model-visible Knowledge result, including `kb://` reads and listings, MUST identify filesystem content as owner-maintained, untrusted context that can be stale, through the closed notice. The runtime MUST NOT rewrite or neutralize `kb://` content, with one exception: the reserved-name rule of `tool-result-rendering` escapes a tag that names a reserved delimiter. The framing is carried by the notice and the declarations so that returned bytes remain usable as exact `edit` targets. A `kb://` read whose file is an image MUST return the image result with the closed notice and no file content. An image result is not an `edit` target, because it carries no text to copy as `oldText`, and it carries no `media://` locator because the image is not stored. The tools MUST NOT grant instructions inside notes authority over the system prompt, tool permissions, owner linkage, configured root, or execution environment. The model-facing contract MUST direct materially volatile claims to appropriate external verification when those tools are available.

#### Scenario: Note attempts to widen authority

- **WHEN** a note instructs the model to select another directory, enable a tool, reveal a host path, or override system policy
- **THEN** no tool availability, linkage, or execution scope changes

#### Scenario: Knowledge read carries the notice verbatim

- **WHEN** the model reads a note through `kb://`
- **THEN** the result includes the closed untrusted-content notice
- **AND** the note's text is not neutralized: the selected source bytes are returned unchanged apart from the generated line-number prefixes, which `:raw` omits, and a tag naming a reserved delimiter

#### Scenario: Note contains a volatile claim

- **WHEN** a retrieved note contains a claim whose current truth materially affects the answer
- **THEN** the model-facing contract identifies the note as potentially stale and directs external verification rather than treating filesystem presence as proof

#### Scenario: A Knowledge image carries the notice and no edit text

- **WHEN** the model reads `kb://<id>/diagrams/flow.png`, whose bytes are a PNG image
- **THEN** the result includes the closed untrusted-content notice, and carries no file content and no `media://` locator
- **AND** no media object is created for the image, and the stored Knowledge file is unchanged

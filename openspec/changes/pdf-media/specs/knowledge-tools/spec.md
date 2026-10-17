## ADDED Requirements

### Requirement: A kb:// PDF read returns the PDF result with the Knowledge notice

A `kb://` read whose file is a PDF SHALL return the PDF result with the closed untrusted-content notice and no file content. A PDF result is not an `edit` target, because it carries no text to copy as `oldText`, and it carries no `media://` locator because the PDF is not stored.

#### Scenario: A Knowledge PDF carries the notice and no edit text

- **WHEN** the model reads `kb://<id>/papers/paper.pdf`, whose bytes are a PDF
- **THEN** the result includes the closed untrusted-content notice, and carries no file content and no `media://` locator
- **AND** no media object is created for the PDF, and the stored Knowledge file is unchanged

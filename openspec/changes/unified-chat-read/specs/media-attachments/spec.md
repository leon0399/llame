## MODIFIED Requirements

### Requirement: Search, the recency digest, and public shares carry no image content

Search MUST index nothing from a file part, including its name and locator. A Chat row MUST omit its opening excerpt when the first user message has no text, even if that message contains files. Its latest excerpt can still use another eligible message's visible text. The digest MUST extract no file content, name, or locator. A public share read MUST omit file parts and retain message text.

#### Scenario: An attachment filename is not searchable

- **WHEN** an owner's only message carrying `quarterly.png` is a file part with that name
- **THEN** searching the owner's Chats for `quarterly` does not match that message

#### Scenario: A public share omits attachments

- **WHEN** an unauthenticated visitor reads a public share whose user message contains text and a file part
- **THEN** the response contains the text
- **AND** it contains no file part or `media://` locator

#### Scenario: An image-only opening leaves a later text excerpt available

- **WHEN** the first user message contains only an image and a later eligible reply contains visible text
- **THEN** the digest row omits the opening excerpt and can show the bounded latest excerpt
- **AND** it extracts nothing from the image or its file metadata

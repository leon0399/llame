## MODIFIED Requirements

### Requirement: Image preparation is shared with unstored image reads

The magic-byte detection, the decode refusals, the byte and pixel bounds, and the model-variant
rules of this capability MUST form one image preparation. Ingest MUST apply it before it stores an
upload. A `read` or prompt import of an image that is not a `media://` locator MUST apply the same
preparation. It MUST create no media object, MUST write no bytes to the media store, and MUST give
no `media://` locator. Its stored part keeps the model variant as the retained bytes that
`media-attachments` defines.

#### Scenario: A read image is prepared like an upload and stored nowhere

- **WHEN** a Run reads a host file whose bytes are a 4000×1000 PNG
- **THEN** its model variant is 2000×500, as an upload of the same bytes makes it
- **AND** no media object exists for those bytes, and no `media://` locator names them

### Requirement: PDF preparation is shared with unstored PDF reads

The `%PDF-` magic-byte check, the structural parse, and the 20 MiB and 100-page bounds MUST form one
PDF preparation with the refusal of unopenable and encrypted PDFs. Ingest MUST apply it before it
stores an upload. A `read` or prompt import of a PDF that is not a `media://` locator MUST apply the
same preparation. It MUST create no media object, MUST write no bytes to the media store, and MUST
give no `media://` locator. Its stored part keeps the original as the retained bytes that
`media-attachments` defines.

#### Scenario: A read PDF is prepared like an upload and stored nowhere

- **WHEN** a Run reads a host file whose bytes are a valid, unencrypted 15-page PDF
- **THEN** the read reports 15 pages, as an upload of the same bytes records
- **AND** no media object exists for those bytes, and no `media://` locator names them

#### Scenario: A read PDF over the page bound is refused like an upload

- **WHEN** a Run reads a host file whose bytes are a valid 101-page PDF
- **THEN** the read is refused as `media_too_large`, as an upload of the same bytes is refused
- **AND** no media object, no stored bytes, and no retained bytes exist for it

#### Scenario: An imported encrypted PDF is refused like an upload

- **WHEN** a prompt imports a host path whose bytes are an encrypted PDF
- **THEN** the import is refused as `unsupported_media_type`, as an upload of the same bytes is
  refused
- **AND** no media object, no stored bytes, and no retained bytes exist for it

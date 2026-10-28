## MODIFIED Requirements

### Requirement: Image reads are decoded without being stored

The worker MUST decode an image from a source other than `media://` with the `media-store` image
preparation. The worker MUST NOT write it to the media store, for a model read and for a
prompt-import read. The stored part MUST keep its model variant as the retained bytes that
`media-attachments` defines. Each such read MUST decode its bytes again and MUST reuse no image or
identifier from an earlier read.

#### Scenario: A read image creates no media object

- **WHEN** the model reads `/work/shot.png`, whose bytes are a PNG image
- **THEN** the Run owner holds no media object for those bytes
- **AND** the result names the image only by its `path`

#### Scenario: A prompt-import read is not stored either

- **WHEN** a prompt import reads `/work/shot.png` through `read` with system origin `prompt-import`
- **THEN** the result is the same image result that a model `read` returns
- **AND** no media object is created

#### Scenario: Re-reading an image decodes it again

- **WHEN** the model reads `/work/shot.png` in one turn and again in a later turn
- **THEN** the later read decodes the file again and returns an image result with no `media` field
- **AND** the later read's image is attachable in the later turn's Run
- **AND** the earlier read keeps its own retained bytes

### Requirement: PDF reads are parsed without being stored

The worker MUST parse a PDF from a source other than `media://` with the preparation that
`media-store` applies to an uploaded PDF. The worker MUST NOT write it to the media store, for a
model read and for a prompt-import read. The stored part MUST keep its original as the retained
bytes that `media-attachments` defines. Each such read MUST parse its bytes again and MUST reuse no
PDF or identifier from an earlier read.

#### Scenario: A read PDF creates no media object

- **WHEN** the model reads `/docs/paper.pdf`, whose bytes are a PDF
- **THEN** the Run owner holds no media object for those bytes
- **AND** the result names the PDF only by its `path`

#### Scenario: A prompt-import PDF read is not stored either

- **WHEN** a prompt import reads `/docs/paper.pdf` through `read` with system origin `prompt-import`
- **THEN** the result is the same PDF result that a model `read` returns
- **AND** no media object is created

#### Scenario: Re-reading a PDF parses it again

- **WHEN** the model reads `/docs/paper.pdf` in one turn and again in a later turn
- **THEN** the later read parses the file again and returns a PDF result with no `media` field
- **AND** the later read's PDF is attachable in the later turn's Run
- **AND** the earlier read keeps its own retained bytes

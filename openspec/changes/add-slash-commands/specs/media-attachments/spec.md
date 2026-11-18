## MODIFIED Requirements

### Requirement: Image overflow compacts at the start of the next Run

A request that is prepared before the first model step of a Run MUST count as at its compaction
threshold when two conditions are true. First, it carries an image or PDF reference that the epoch
image window does not attach, because the bounds of the epoch are reached. Second, a row before the
user message of the Run holds a stored or retained reference. The model of the request declares
the kind of that reference. The overflow MUST NOT count after the first model step of a Run.

#### Scenario: Image overflow triggers compaction at the next Run

- **WHEN** the epoch of a Chat on a vision model holds 100 attached owner images in earlier turns
- **AND** the request fits the window of the model, and the owner sends a message with one more image
- **THEN** the threshold compaction runs on the model of the Run before its first model step
- **AND** the request of the Run admits the new image under the new epoch and sends it as an image

#### Scenario: Overflow in the triggering message alone does not compact

- **WHEN** the epoch of a Chat on a vision model holds no image or PDF before the user message of the Run
- **AND** that message attaches 10 images, and their 5 MiB base64 model variants exceed the byte bound
- **THEN** no compaction runs
- **AND** the five oldest images go to the model as images, and the others as the limit placeholder

#### Scenario: An image read beyond the bounds inside a Run does not compact

- **WHEN** a Run on a vision model reads an image after the bounds of its epoch are reached
- **THEN** that `read` result goes to the next step as the limit placeholder
- **AND** the overflow starts no compaction before the Run ends
- **AND** the next Run compacts before its first model step, because that read is a retained reference in an earlier row

#### Scenario: PDF overflow triggers compaction at the next Run

- **WHEN** a Chat on a 400,000-token model that declares `pdf` input holds a stored 80-page PDF
- **AND** an earlier turn of the epoch attached that PDF, and the request fits the window of the model
- **AND** the owner sends a message that attaches a stored 30-page PDF
- **THEN** the threshold compaction runs on the model of the Run before its first model step
- **AND** the request of the Run admits the 30-page PDF under the new epoch and sends it as a PDF

#### Scenario: A stored PDF does not enable image overflow on a model without PDF input

- **WHEN** a Chat is on a model that declares `image` input and not `pdf` input
- **AND** the rows before the user message of the Run hold only a stored PDF
- **AND** the images of that message exceed the bounds of the epoch
- **THEN** no compaction runs
- **AND** the images that overflow go to the model as the limit placeholder

#### Scenario: A PDF over the model's page bound does not fail later turns

- **WHEN** a Chat on a 200,000-token model that declares `pdf` input has a first message with a stored 64-page PDF
- **AND** the owner then sends a second message that fits the window of the model
- **THEN** no turn fails, and the first turn continues with no compaction and the PDF limit placeholder in its request
- **AND** the second Run compacts on its threshold before its first model step
- **AND** that compaction absorbs the row of the first message, because the PDF is a stored reference in an earlier row

#### Scenario: The overflow trigger selects the compaction variant for its Run

- **WHEN** a request counts as at its compaction threshold because of overflow
- **THEN** it triggers the compaction variant that `model-system-prompts` selects for it

#### Scenario: An overflow compaction starts an epoch that admits oldest first again

- **WHEN** an overflow compaction completes
- **THEN** the new epoch admits images and PDFs oldest first again

#### Scenario: The stored reference must be of a declared input kind

- **WHEN** the earlier rows of a request that overflows hold a stored or retained image, or a stored or retained PDF
- **THEN** the image counts as that reference only on a model that declares `image` input
- **AND** the PDF counts as that reference only on a model that declares `pdf` input

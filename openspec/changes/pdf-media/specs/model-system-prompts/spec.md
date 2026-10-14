## ADDED Requirements

### Requirement: PDF overflow triggers compaction like image overflow

A prepared request on a model that declares `pdf` input SHALL also count as reaching the Run model's
threshold when it carries a PDF reference that `media-attachments` does not attach because its
epoch's bounds are reached and a stored image or PDF reference in a row before the triggering user
message, selecting the variant image overflow would. A failed compaction triggered only by overflow
SHALL NOT fail an attempt.

#### Scenario: PDF overflow selects the threshold variant

- **WHEN** a prepared request on a model that declares `pdf` input fits that model's window and its
  measured context size is below the threshold, but it carries a PDF reference beyond its epoch's
  bounds and a stored PDF reference in a row before the triggering user message
- **THEN** the threshold variant runs before the Run's first model step, with that attempt's own
  model client, system prompt, schema-only tool declarations, and effort
- **AND** the request after the checkpoint admits PDFs oldest first under the new epoch

#### Scenario: PDF overflow in the triggering message alone does not compact

- **WHEN** only the triggering user message's own PDFs exceed the epoch's bounds and no row before it
  carries a stored image or PDF reference
- **THEN** no checkpoint is published
- **AND** the overflowing PDFs keep the PDF limit placeholder and the attempt proceeds

#### Scenario: PDF overflow alone never fails an attempt

- **WHEN** PDF overflow is the only trigger condition and its summarization call throws or returns
  no usable summary
- **THEN** the attempt proceeds without a checkpoint instead of failing `context_incompatible`
- **AND** the overflowing PDFs keep the PDF limit placeholder
- **AND** the next Run evaluates the trigger again before its first model step and, when its
  compaction succeeds, admits PDFs oldest first under the new epoch

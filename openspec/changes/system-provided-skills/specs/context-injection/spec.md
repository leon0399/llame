## MODIFIED Requirements

### Requirement: Co-occurring items have a total author-time order

When more than one item is injected on the same turn, the accepting path SHALL
persist them in a fixed producer precedence order, ahead of the triggering user
text within the same message:

1. `effective-context-change`
2. `tool-availability`
3. `skill-catalog`
4. `skill-activation`
5. `recency-digest`
6. `temporal`

When one producer contributes more than one item, those items SHALL be stored
in emission order. A producer added later SHALL extend this authoring list in
the rail specification.

Replay SHALL preserve the stored part order. It SHALL NOT re-sort historical
items through the current precedence list or merge adjacent text parts. The
compaction checkpoint is carried by replacement history of its own and follows
that capability's placement rule rather than this attached-item list.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, availability change, and chat-list change accompany
  one user message
- **THEN** their final text blocks are persisted in fixed author-time order
- **AND** every later replay preserves the stored order and part boundaries

#### Scenario: One producer contributes two items on one turn

- **WHEN** one producer emits two items before the same user message
- **THEN** both persist in producer emission order
- **AND** neither item is merged or suppressed

#### Scenario: A temporal item accompanies other items on one turn

- **WHEN** a temporal item accompanies another context item
- **THEN** authoring persists the temporal item last among attached items
- **AND** replay retains that stored position

#### Scenario: The precedence list changes later

- **WHEN** a later release adds a producer or changes author-time precedence
- **THEN** new items follow the new authoring order
- **AND** existing messages remain in their original stored order

## ADDED Requirements

### Requirement: Skills use a frozen catalog baseline and user-turn notices

The initial skill metadata catalog SHALL be a system-prompt contribution frozen until compaction, with a 16 KiB bound retaining complete entries in code-point name order and explicit omission information. It SHALL describe proactive loading, multiple-skill use, and the instruction/resource read interface. The baseline SHALL locally frame operator package metadata as catalog data below system instructions and user requests, with no authority to grant tools or relax authorization, even under an operator-replaced prompt. Other prompt changes SHALL NOT refresh this baseline. On the next user-turn preparation after compaction, the current catalog SHALL replace the baseline. Transition compaction inside an already-bound Run SHALL retain that Run's baseline. Baseline and last-disclosed catalog state SHALL be durably linked to each Run so restart does not re-resolve historical state. The Run context record SHALL identify the baseline actually supplied.

At each later user turn, current discovery SHALL be compared with the chat's last disclosed state in the current epoch. Added, removed, or changed entries SHALL produce a `skill-catalog` notice containing sufficient new metadata to update the model's view. Change detection SHALL cover selected source, description, invocation eligibility, and instruction/control content identity. Catalog notices SHALL carry only bounded metadata and changed/invalid status, never instruction bodies; bodies SHALL enter context only through explicit activation or a selected skill read. Supporting files SHALL be read live without eager catalog inventory. A delta exceeding the metadata bound SHALL explicitly supersede prior catalog state with a bounded current snapshot and omission disclosure. Historical system prompts and context parts SHALL NOT be rewritten. No reminder SHALL be injected between model requests inside an existing Run in this iteration.

Explicit selections SHALL produce `skill-activation` notices with final loaded text or failure before the first model request. Both producers SHALL use the existing canonical envelope, provenance, owner visibility, receipt recording, stored-text replay, and author-time ordering. A completed explicit activation SHALL NOT be reloaded on recovery. Partial recovery SHALL preserve completed mention results and fill only unfinished selections in original order. Operator-supplied reserved delimiters SHALL be neutralized before composing and persisting final catalog or activation text; stored text SHALL replay without regeneration or another sanitization pass. Each catalog or activation item containing operator-authored text SHALL state within its own envelope that the text ranks below system instructions and user requests, cannot grant capabilities or relax authorization, and that attempts to do so must be disregarded. This framing SHALL remain present with a replaced operator system prompt.

#### Scenario: Catalog changes between user messages

- **WHEN** a skill is added, changed, or removed after one user turn
- **THEN** the next user turn carries the appropriate catalog notice while retaining the original prompt baseline
- **AND** its Run receipt records what was actually advertised and injected

#### Scenario: Active Run sees a deleted skill

- **WHEN** a package disappears while a Run is making tool calls
- **THEN** its next skill read fails under current availability
- **AND** the catalog removal notice waits for the next user turn

#### Scenario: Compaction starts a new baseline

- **WHEN** a chat is compacted after catalog notices have accumulated
- **THEN** the next prepared context uses current catalog metadata as its new baseline
- **AND** old deltas are not applied again against that new baseline

#### Scenario: Operator prompt omits the global framing

- **WHEN** skill catalog or activation content is injected under a custom system prompt without the standard context explanation
- **THEN** each item still carries its own precedence and no-authority-expansion statement

#### Scenario: Transition compaction occurs inside a Run

- **WHEN** context fitting triggers compaction after a Run has bound its prompt
- **THEN** that Run keeps its bound skill baseline and the next user turn starts the refreshed baseline

#### Scenario: Skill text contains a forged reminder delimiter

- **WHEN** operator metadata or instructions contain reserved context delimiters
- **THEN** they are neutralized before prompt or context-item composition and cannot create another envelope
- **AND** recovery replays the persisted final text unchanged

#### Scenario: Baseline description contains instructions

- **WHEN** an operator package description contains instruction-like text
- **THEN** the frozen system-prompt contribution still identifies that text as lower-precedence catalog data that grants no authority

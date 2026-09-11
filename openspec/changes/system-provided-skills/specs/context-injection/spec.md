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

### Requirement: The skill catalog is a frozen prefix baseline stored on the chat

The proactively eligible skill catalog SHALL be classified as a frozen prefix-resident baseline with rail-resident deltas. The baseline SHALL be the `skills` prompt projection defined by `model-system-prompts`: admitted entries in code-point name order, each with name and description, plus the admitted and eligible counts. Admission SHALL retain whole entries while the cumulative UTF-8 length of name and description stays within 16 KiB; omission SHALL be disclosed through the counts and remain inspectable through `read("skill://")`.

The baseline and the entries the chat was last told SHALL be persisted on the chat row under owner isolation, following the recency-digest precedent, together with the compaction identity under which the baseline was resolved. Accepted-turn preparation SHALL reuse the stored baseline while that identity matches the chat's latest compaction, or both are absent, and SHALL otherwise resolve the current catalog and start a new baseline and told state in the same accepted-turn transaction as the user message and Run. No baseline SHALL be written for a chat on an instance with no configured skill source. Package edits, model switches, and other prompt contributions SHALL NOT refresh the baseline. A transition compaction inside an already-bound Run SHALL leave that Run's bound prompt unchanged; the next accepted turn starts the refreshed baseline. Caller-supplied owner identifiers SHALL NOT authorize baseline or told-state reads or mutations.

The baseline SHALL enter the prompt only through the template projection. A template that does not reference `skills` SHALL render no catalog, and no server-rendered block SHALL be appended outside the template. Operator-authored descriptions SHALL be neutralized before composing the prompt or any item and SHALL replay from persisted text without another sanitization pass.

#### Scenario: Catalog is frozen within an epoch

- **WHEN** a package description changes or the model is switched between two user turns with no compaction between them
- **THEN** the next Run's prompt renders the stored baseline byte-for-byte
- **AND** the effective-context snapshot is reused rather than re-minted for that reason

#### Scenario: Compaction starts a new baseline

- **WHEN** a chat is compacted after catalog notices have accumulated
- **THEN** the next accepted turn resolves the current catalog as its new baseline and told state
- **AND** old deltas are not applied again against that new baseline

#### Scenario: Transition compaction occurs inside a Run

- **WHEN** context fitting triggers compaction after a Run has bound its prompt
- **THEN** that Run keeps its bound skill baseline and the next user turn starts the refreshed baseline

#### Scenario: Operator template omits the namespace

- **WHEN** a model's template never references `skills`
- **THEN** its prompt carries no catalog and boot succeeds
- **AND** explicit `$skill` activation on that model still loads instructions through the rail

#### Scenario: Another owner targets catalog state

- **WHEN** owner A attempts to read or mutate owner B's chat baseline or told state
- **THEN** datastore enforcement refuses access using the authenticated identity
- **AND** supplying owner B's identifier does not authorize the operation

### Requirement: Explicit activations are rail items carrying current instructions

Each explicit `$skill` selection SHALL produce one `skill-activation` item with form `notice` in the triggering user message before the first model request. A successful item SHALL state which mention selected the skill, the absolute skill directory and instructions file, the instruction to resolve package-relative references and scripts against that directory while keeping task-relative inputs and choosing `cwd` explicitly, a precedence statement, and the current `SKILL.md` verbatim as returned by the raw read with its ordinary truncation indicator. A failed selection SHALL produce a bounded item naming the mention and one closed reason from `not_found`, `unavailable`, `permission_denied`, and `read_failed`, without operator diagnostics in model text. Selections beyond the count, output, or work budget SHALL be accounted for by one bounded omission item listing their names.

Activation items SHALL use the existing canonical envelope, provenance, owner visibility, separate executed-context recording, stored-text replay, and author-time ordering. A completed explicit activation SHALL NOT be reloaded on recovery. Partial recovery SHALL preserve completed mention results and fill only unfinished selections in original order. Operator-supplied reserved delimiters SHALL be neutralized before composing and persisting activation text.

#### Scenario: Two explicit selections on one message

- **WHEN** the user sends `$research $technical-writing compare these APIs`
- **THEN** two activation items persist in that order ahead of the user text
- **AND** each carries its skill directory, instructions file, and verbatim instructions

#### Scenario: Selection fails after admission is denied

- **WHEN** an explicit selection's read is denied by permission policy
- **THEN** its item names the mention with reason `permission_denied` and no instructions
- **AND** the other selections and the Run proceed

#### Scenario: Skill text contains a forged reminder delimiter

- **WHEN** operator metadata or instructions contain reserved context delimiters
- **THEN** they are neutralized before prompt or context-item composition and cannot create another envelope
- **AND** recovery replays the persisted final text unchanged

### Requirement: Catalog notices announce added and removed skills on the next user turn

At each accepted user turn that continues a compaction epoch, the current proactively eligible catalog, bounded as for the baseline, SHALL be compared with the chat's told state. When entries were added or removed, one `skill-catalog` item with form `notice` SHALL be persisted listing added entries with name and description and removed entries by name, telling the model to read an added skill before applying it and not to apply a removed skill's earlier instructions, and carrying a precedence statement whenever a description is present. An eligibility flip or a promotion from the omitted portion SHALL render as an add or a remove. A changed description or changed instruction content of an entry that stays advertised SHALL NOT produce a notice in this change. Notices SHALL carry only bounded metadata, never instruction bodies. The told state SHALL be updated in the same accepted-turn transaction; a retried accepted message SHALL reuse its persisted state and a rollback SHALL expose none of those writes.

When a delta would exceed the baseline bound, one `skill-catalog` item with form `snapshot` SHALL instead state that the catalog was refreshed and earlier updates are superseded, listing the bounded current set with admitted and eligible counts; the told state SHALL then equal that snapshot. No notice SHALL be injected between model requests inside an existing Run; a removed package fails its next read under current availability and its removal is announced on the next user turn.

#### Scenario: Catalog changes between user messages

- **WHEN** one skill is added and another removed after a user turn in the same epoch
- **THEN** the next user turn carries one notice naming the addition with its description and the removal by name
- **AND** the immutable effective-context receipt retains the frozen baseline while the executed-context record captures the notice

#### Scenario: Description changes without membership change

- **WHEN** an advertised skill's description or `SKILL.md` content changes between user turns
- **THEN** no catalog notice is emitted in this change
- **AND** a later `skill://` read returns the current content

#### Scenario: Active Run sees a deleted skill

- **WHEN** a package disappears while a Run is making tool calls
- **THEN** its next skill read fails under current availability
- **AND** the removal notice waits for the next user turn

#### Scenario: Delta exceeds the bound

- **WHEN** the added and removed entries cannot be rendered within the baseline bound
- **THEN** a supersession snapshot with the bounded current set replaces the delta
- **AND** the told state equals the snapshot's admitted entries

#### Scenario: Told-state transaction is interrupted

- **WHEN** the accepted-turn transaction fails before commit after preparing a catalog notice
- **THEN** neither the message, Run linkage, notice, nor updated told state is visible
- **AND** retry produces one consistent accepted turn without repeated or skipped catalog changes

### Requirement: Skill activations remain separate from immutable enqueue receipts

The enqueue-bound effective-context receipt SHALL retain its immutable prompt/tool snapshot and SHALL NOT be extended with post-claim activation results. After final request preparation, the existing separate Run context-item record SHALL capture every context item actually sent, including skill catalog notices and activations alongside all existing producers. The endpoint SHALL expose that complete recorded array, not a skill-only projection. Authenticated owners SHALL inspect it through `GET /api/v1/runs/:id/context-items`; the response SHALL contain `items: null` before a final executed request has been recorded and the recorded array afterward. Preparation failure SHALL leave this record unrecorded. Non-owners SHALL receive not-found and this record SHALL remain excluded from public shares, exports, and search.

#### Scenario: Owner inspects before and after activation

- **WHEN** the owner reads the enqueue receipt before execution and again after skill activation
- **THEN** its snapshot content and hashes are unchanged
- **AND** the separate context-items response moves from unrecorded to the final executed items only when request preparation succeeds

#### Scenario: Activation succeeds but request preparation fails

- **WHEN** activation results have been persisted but window fitting fails before provider dispatch
- **THEN** those observations remain in the owner message while the executed-context record remains unrecorded
- **AND** the immutable enqueue receipt is not changed

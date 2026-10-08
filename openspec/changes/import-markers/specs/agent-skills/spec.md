## MODIFIED Requirements

### Requirement: Explicit activation work is bounded before model preparation

The system SHALL enforce the explicit-selection count, aggregate output, and aggregate work bounds before each activation read. Imported package files SHALL count against the same aggregate output and work bounds, and imports omitted because a bound is exhausted SHALL be named in the bounded notice. Discovery SHALL check cancellation between entries and file operations. It SHALL preserve completed activation results and account for unattempted selections and imports in one bounded notice. Limits SHALL NOT silently claim omitted skills were loaded or perform their filesystem scans.

#### Scenario: User names many distinct skills

- **WHEN** a user message names one thousand distinct skills
- **THEN** at most the first eight are attempted in order and one bounded notice reports the omitted remainder
- **AND** the remainder does not trigger skill discovery or create one context part per name

#### Scenario: Aggregate budget is exhausted

- **WHEN** selected reads consume the activation output or work budget before all admitted selections are attempted
- **THEN** no additional reads start, ordinary truncation remains explicit, and one bounded notice accounts for the unattempted selections

#### Scenario: Imported package files consume activation bounds

- **WHEN** an activated instruction imports package files until the aggregate output or work bound is exhausted
- **THEN** completed imported files remain in the activation item and no further import read starts
- **AND** one bounded notice names each imported target omitted by the exhausted bound

## ADDED Requirements

### Requirement: Activated instructions expand package-local imports

After an explicit skill activation, markers in the frontmatter-free instruction body SHALL resolve relative to the package directory as ordinary `skill://<name>/<rel>:raw` reads with `skill-activation` origin and exactly a proactive read's admission. Expansion SHALL recurse at most five hops, skip cycles and repeats, and leave absolute, `~/`, schemed, and package-escaping targets literal without triggering instruction chains. Symlink semantics SHALL remain as agent-skills defines.

#### Scenario: A package-local reference is carried after instructions

- **WHEN** an owner explicitly activates `research` whose instruction body contains `@references/checklist.md`
- **THEN** the activation reads `skill://research/references/checklist.md:raw` as a raw package-local file with origin `skill-activation` and exactly the admission a proactive read of that locator gets
- **AND** the activation item carries that file block after the instruction body

#### Scenario: A package-escaping reference remains literal

- **WHEN** an activated instruction body contains `@../other-skill/SKILL.md`
- **THEN** the marker remains unchanged in the instruction body
- **AND** no file block, read, or instruction-chain trigger is produced

#### Scenario: Non-package targets remain literal

- **WHEN** an activated instruction body contains absolute, `~/`, or schemed targets
- **THEN** each target remains literal and produces no imported file block
- **AND** none of those targets triggers an instruction chain

#### Scenario: Cycles and a sixth hop are bounded

- **WHEN** package-local imports repeat a target or reach a sixth import hop
- **THEN** each distinct package file is loaded at most once and only the first five hops load
- **AND** skipped markers remain literal without triggering an instruction chain

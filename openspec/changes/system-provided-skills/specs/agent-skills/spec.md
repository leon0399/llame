## Purpose

Provides operator-managed reusable skill packages with explicit and proactive activation, live resource reads, executable path disclosure, and durable owner-visible observations. Prompt advertisement is owned by `model-system-prompts`; rail items are owned by `context-injection`; this capability owns the catalog, invocation semantics, and reads.

## ADDED Requirements

### Requirement: Configured directories publish one operator catalog

The system SHALL discover immediate skill directories beneath configured operator sources, with later sources overriding earlier sources by package name. Each package SHALL contain valid Agent Skills frontmatter with a name matching its directory and a non-empty description. Invalid winning packages SHALL be unavailable with an operator diagnostic and SHALL NOT fall back to earlier packages of the same name. Unrelated valid packages SHALL remain available. Discovery SHALL NOT implicitly include personal, workspace, bundled, or remote sources. An unreadable or oversized source SHALL make discovery unavailable rather than resolve precedence from an incomplete scan.

#### Scenario: Directory contains several packages

- **WHEN** one configured source contains `pdf/SKILL.md` and `research/SKILL.md`
- **THEN** both packages are discovered without individual configuration entries

#### Scenario: Later source overrides the base

- **WHEN** two configured sources contain valid `review` packages
- **THEN** the later source supplies `review` and its selected source is inspectable

#### Scenario: Invalid override masks the base

- **WHEN** the later `review` package has malformed metadata
- **THEN** `review` is unavailable with a diagnostic and the earlier body is not substituted
- **AND** valid `pdf` remains available

### Requirement: Invocation controls distinguish explicit selection from proactive use

The system SHALL resolve the first present invocation-control value in this order: `agents/llame.yaml` `policy.allow_implicit_invocation`, then `SKILL.md` frontmatter `disable-model-invocation` with inverted boolean meaning, then `agents/openai.yaml` `policy.allow_implicit_invocation`, then proactive loading enabled by default. A configured boolean SHALL end resolution even when it enables proactive loading. Lower-priority invocation settings SHALL NOT be parsed, validated, or allowed to override that value. A sidecar with no control SHALL fall through. A malformed consulted sidecar or wrong-typed consulted control SHALL invalidate the package without fallback. Required `SKILL.md` package metadata SHALL always be parsed and validated independently of invocation-control selection; an ignored lower-priority invocation field SHALL NOT invalidate otherwise valid frontmatter. Manual-only packages SHALL be absent from the proactive `skills` prompt projection, SHALL be filtered from `skill://` listings unless selected in the current user turn, and SHALL require that selection for skill-locator body/resource reads. Authenticated owner inspection SHALL include manual-only packages. These controls SHALL NOT change ordinary absolute-path permissions or grant tool authority.

#### Scenario: Model combines skills

- **WHEN** a task matches two proactively eligible descriptions
- **THEN** the model can load both skills and neither activation replaces the other
- **AND** their unused resources are not eagerly injected

#### Scenario: llame policy takes precedence over disabling fallbacks

- **WHEN** llame policy sets `allow_implicit_invocation: true`, frontmatter sets `disable-model-invocation: true`, and the OpenAI sidecar is malformed
- **THEN** proactive invocation is enabled and the ignored fallback controls do not invalidate the package

#### Scenario: Frontmatter takes precedence over the OpenAI sidecar

- **WHEN** no llame control is present and frontmatter sets `disable-model-invocation: false`
- **THEN** proactive invocation is enabled regardless of a lower OpenAI disabling control

#### Scenario: Absent controls fall through

- **WHEN** neither llame policy nor frontmatter configures an invocation control and OpenAI policy sets `allow_implicit_invocation: false`
- **THEN** the skill is manual-only
- **AND** if that final control is also absent proactive invocation is enabled

#### Scenario: Malformed selected control does not fall through

- **WHEN** a consulted llame sidecar is malformed or its invocation control is not boolean
- **THEN** the package is unavailable even if a lower control is valid

#### Scenario: Required package metadata remains validated

- **WHEN** llame invocation policy is valid but `SKILL.md` has malformed required metadata
- **THEN** the package remains unavailable

### Requirement: Explicit mentions load skills before the first model request

The system SHALL recognize exact `$skill-name` tokens in user-authored text outside fenced code, inline code, and escaped dollar signs, with valid name boundaries. It SHALL load distinct selected skills in first-mention order before the Run's first model request, deduplicating repeated mentions within that user turn. Ordinary mentions SHALL remain model-selected. Activation SHALL use the same read availability, input validation, permission admission, live resolver, and result bounds as proactive reads, issuing the raw root read `skill://<name>:raw` with the turn's selection set so the persisted instructions carry no line-number prefixes and a manual-only selection loads. The user text SHALL be retained subject to existing reserved-delimiter sanitation; activation SHALL NOT remove mention tokens or perform argument substitution. Explicit activation SHALL attempt at most eight distinct selections, with a 128 KiB aggregate serialized output bound including envelopes and a 30-second aggregate work deadline further limited by the Run deadline. Remaining output/time SHALL constrain each read, and exhausted budgets SHALL stop further reads. Unattempted selections SHALL produce one bounded omission notice, without per-selection discovery or output. Each activation result SHALL be persisted as an owner-visible context item rather than a fabricated model tool call. An unavailable, invalid, or denied selection SHALL produce a bounded failure item carrying one closed reason from `not_found`, `unavailable`, `permission_denied`, and `read_failed`, without stopping other selections or the Run. The rendered activation item SHALL state the mention, the absolute skill directory and instructions file, the relative-path and `cwd` guidance, a precedence statement, and the instruction body without frontmatter, per `context-injection`.

#### Scenario: User selects two skills

- **WHEN** the user sends `$research $technical-writing compare these APIs`
- **THEN** both current instruction bodies are loaded in that order before the first model request, subject to read admission
- **AND** the retained user text, with existing delimiter sanitation applied, follows the activation items

#### Scenario: Manual-only skill is selected explicitly

- **WHEN** the user sends `$review` and `review` is manual-only
- **THEN** its instructions are loaded through the same read admission with `review` in the turn's selection set
- **AND** a model-initiated `skill://review/references/checklist.md` read during that Run succeeds with the same selection set, while the same read on a later turn without the mention is refused

#### Scenario: Example text is not an activation

- **WHEN** `$research` appears only in inline code, fenced code, or with an escaped dollar sign
- **THEN** it does not trigger explicit activation

#### Scenario: Explicit selection does not bypass permission

- **WHEN** the user selects a skill whose read is denied
- **THEN** no body is loaded and a persisted permission failure accompanies the user turn

### Requirement: Skill observations are live and replay remains historical

Each new skill-locator read SHALL re-evaluate current configured-source availability and read the current selected file. It SHALL NOT require equality with an earlier advertised or consumed revision. Completed observations SHALL persist selected source, resolved target, observed content identity, and actual model-facing content/truncation. Recovery and client replay SHALL reuse completed observations without re-reading. A resource edit SHALL NOT retroactively alter prior tool output or explicit activation text. No guarantee SHALL be made that bytes read earlier are the bytes an interpreter later executes.

#### Scenario: Resource changes after instruction loading

- **WHEN** the operator changes a reference before its next read
- **THEN** the new read returns current content without a changed-source refusal
- **AND** previously stored results remain unchanged

#### Scenario: Removal precedes the next reminder

- **WHEN** a package is removed during a Run that still advertises it
- **THEN** the next skill-locator load fails immediately
- **AND** no unsolicited catalog reminder is inserted in that active Run

#### Scenario: Retry follows completed explicit activation

- **WHEN** the worker resumes after activation was persisted and the package has since changed
- **THEN** the completed activation replays its stored text
- **AND** a separately requested new load can read the new content

### Requirement: References and scripts retain ordinary execution authority

Skill loading SHALL publish the selected package's real absolute directory and requested file path in model-visible output and owner-visible results, and SHALL instruct the model to resolve package-relative references and script paths against that directory into absolute tool arguments while preserving task-relative inputs and choosing `cwd` explicitly when required. Explicit activation SHALL carry the same instruction. References and scripts SHALL be accessible on demand within the package. Loading SHALL NOT execute scripts, rewrite Bash command text, change Bash working directory, install dependencies, or grant permissions. Scripts SHALL use ordinary available tools and executor checks. Unsupported vendor execution extensions SHALL not execute and SHALL be disclosed as unsupported. Removing a catalog source SHALL NOT delete its files or revoke permitted absolute-path or Bash access to surviving files.

#### Scenario: Relative script invocation becomes a usable command

- **WHEN** a loaded package instructs the model to use `./scripts/extract.py`
- **THEN** model-visible output supplies the real package directory from which it can construct an absolute script path
- **AND** Bash receives exactly the model-submitted command with its explicit working directory

#### Scenario: Package removal is not filesystem revocation

- **WHEN** an operator removes a source from configuration and restarts, leaving its files on disk
- **THEN** new skill-locator loads cannot use that source
- **AND** ordinary permitted Bash access to the remaining files retains its existing behavior

#### Scenario: Global skill cannot read another owner's Knowledge

- **WHEN** a skill instructs an owner Run to read another owner's Knowledge locator
- **THEN** normal owner isolation rejects the read and skill trust grants no exception

### Requirement: Owners can inspect the current catalog

Authenticated owners SHALL be able to inspect the same system catalog through `GET /api/v1/skills`, including source paths, invocation eligibility, unavailable entries, diagnostics, and pagination or explicit omission metadata. Unauthenticated requests SHALL fail. This surface SHALL NOT publish credentials or allow catalog mutation. Skill read listing at `skill://` SHALL be bounded and filter manual-only entries unless selected in the current user turn. Catalog bodies SHALL remain absent until selected. Prompt advertisement SHALL be limited to proactively eligible entries admitted to the chat's frozen baseline, and a description or content change of a still-advertised entry SHALL NOT be announced in this change.

#### Scenario: Two owners inspect shared packages

- **WHEN** two authenticated owners inspect available skills
- **THEN** both see the operator catalog and neither receives the other's private Run or Knowledge data

#### Scenario: Large catalog is disclosed honestly

- **WHEN** the catalog exceeds a response or model metadata bound
- **THEN** complete entries are returned with explicit continuation or omission information
- **AND** omitted bodies are not loaded to build the listing

### Requirement: Explicit activation work is bounded before model preparation

The system SHALL enforce the explicit-selection count, aggregate output, and aggregate work bounds before each activation read. Discovery SHALL check cancellation between entries and file operations. It SHALL preserve completed activation results and account for unattempted selections in one bounded notice. Limits SHALL NOT silently claim omitted skills were loaded or perform their filesystem scans.

#### Scenario: User names many distinct skills

- **WHEN** a user message names one thousand distinct skills
- **THEN** at most the first eight are attempted in order and one bounded notice reports the omitted remainder
- **AND** the remainder does not trigger skill discovery or create one context part per name

#### Scenario: Aggregate budget is exhausted

- **WHEN** selected reads consume the activation output or work budget before all admitted selections are attempted
- **THEN** no additional reads start, ordinary truncation remains explicit, and one bounded notice accounts for the unattempted selections

### Requirement: System-origin activations retain permission provenance without assistant tool parts

Explicit skill activation SHALL use the common awaited permission-admission callback. Before dispatch it SHALL durably record `tool.requested` with a trusted `origin: "skill-activation"` discriminator, activation identity, and the safe decision provenance required by tool-call permissions. Allowed reads SHALL emit started/completed activity; denied reads SHALL emit requested/completed without a started event. Required audit persistence failure SHALL prevent execution.

For this system-origin caller, the stored activation context item's private metadata SHALL mirror the safe permission record instead of a stored assistant tool part; model-origin tool calls SHALL retain the ordinary stored-tool-part requirement. The model SHALL NOT control the origin. Live tool-part translation, pending-call recovery/settlement, and durable assistant reconstruction SHALL exclude system-origin activation activity from assistant tool parts while retaining its owner-scoped audit events. Legacy events without an origin SHALL remain model-origin. Diagnostic permission metadata SHALL remain absent from model text, public shares, exports, and search. Completed activation ordinals SHALL replay stored observations; unfinished retries SHALL obtain a fresh decision and distinct attempt record.

#### Scenario: Allowed activation records admission before reading

- **WHEN** an explicit activation is allowed
- **THEN** its origin-qualified requested event and permission record are durable before the file read
- **AND** completion mirrors the safe record in private activation metadata without an assistant tool part

#### Scenario: Admission audit cannot be persisted

- **WHEN** the pre-dispatch decision write fails
- **THEN** the file is not opened and infrastructure-failure handling applies

#### Scenario: Recovery encounters a system-origin pending request

- **WHEN** a worker resumes with an unfinished skill-activation request event
- **THEN** it does not synthesize a pending assistant tool call or use the old allow decision for execution
- **AND** a new permitted attempt receives fresh admission provenance while completed activation ordinals remain unchanged

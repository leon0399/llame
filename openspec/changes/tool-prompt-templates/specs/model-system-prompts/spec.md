## MODIFIED Requirements

### Requirement: Each model resolves one complete effective system prompt

The system SHALL provide a versioned project-default system prompt and SHALL allow each configured model to replace it with one independently resolved complete prompt. A model without an override SHALL use the project default.

Both system-prompt file kinds and the llame-owned description templates defined by `tool-prompt-templates` SHALL use the same **Handlebars templates** language over one explicit context projection. The renderable context SHALL expose exactly `model.id` for the public llame model id and `model.name` for the configured public name, plus the requesting owner's **per-user paths** `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name`, and `user.email`, plus the requesting chat's **recency-digest collections** `chats.pinned` and `chats.recent`, and the digest's **scalar metadata** `chats.pinnedShown`, `chats.pinnedTotal`, `chats.recentShown`, `chats.recentTotal`, and `chats.compiledOn`, plus the **unconditional temporal-anchor paths** `context.systemTime` and `context.systemTimezone`, plus the conditional-only `tools.<exact-tool-id>` predicates defined by `tool-prompt-templates`. Operators MAY use the built-in `if` and `unless` conditionals, MAY use the built-in `each` block over an allowlisted collection, and MAY emit a literal expression by escaping it in the engine's own notation. Validation SHALL permit only an allowlisted set of node kinds — literal content, value expressions, block expressions, and comments — rejecting everything else by default, including partials in any form (plain, with a fallback block, or defined through a decorator). Referencing a context path outside the allowlist — evaluated on parsed segments and depth, so a bracketed path that merely displays as an allowlisted one is rejected — emitting unescaped output, invoking any helper other than `if`/`unless`/`each` (including one passed as a hash argument to an allowed block), giving a conditional or an iteration other than exactly one parameter, or declaring block parameters SHALL fail startup naming the model id and the offending construct without printing prompt contents. Referencing `model.name` when the selected model has no configured name SHALL **not** fail startup: the value renders empty, so that a conditional over a possibly-absent value is expressible. Fail-loud is preserved where it catches mistakes: an unknown path is still rejected at boot.

**Iteration SHALL be bounded rather than general.** `each` SHALL accept only an allowlisted collection path as its single parameter; it SHALL NOT iterate a scalar, a gate-only path, or any path not explicitly declared as a collection. Inside an `each` body, only that collection's **declared per-item fields** SHALL be referenceable, and each collection SHALL declare its item fields explicitly rather than exposing whatever the projected item happens to carry. Iteration SHALL NOT be nestable within another iteration, index or key variables SHALL NOT be exposed, and the collection itself SHALL remain gate-only in value position, so emitting it renders no stringified structure. The digest collections SHALL each declare exactly the item fields `title`, `date`, `messageCount`, and `excerpt`.

The digest's **scalar metadata paths are separate from the collections and are not iterable**: `chats.pinnedShown`, `chats.pinnedTotal`, `chats.recentShown`, `chats.recentTotal`, and `chats.compiledOn`. They exist because the digest capability requires the rendered block to state shown/total ratios and the date the list was compiled, and a template that can only iterate item fields has no way to produce either. They SHALL be escaped as model-class values rather than passed through the tag sanitizer, being server-computed numbers and a date rather than owner-authored text.

The digest collections SHALL be projected at the **top level as `chats`**, deliberately not beneath `user`. Nesting them under `user` would make `user` present for an owner who has chats but has authored no personalization and shares no account identity, which would render an operator's personalization block — framing prose included — around no content, contradicting the gate behavior the personalization capability requires.

**The temporal-anchor namespace `context` SHALL be unconditional**, and is the first projected namespace that is. Unlike `user` and `chats`, which are legitimately absent for some owners and some chats, `context.systemTime` and `context.systemTimezone` SHALL always be present in the projection, because an anchor instant and a timezone are always computable. `context` SHALL therefore NOT be a gate-only subject: a bare `{{#if context}}` SHALL fail startup as an unsupported construct, so that an operator is told the guard is unnecessary rather than silently compiling a branch that is always taken. A conditional over either scalar remains expressible, exactly as for any allowlisted value path, and is simply always true. The omission rule for absent-or-empty values SHALL NOT apply to these two paths, and they SHALL be escaped as model-class values rather than passed through the tag sanitizer, being server-computed rather than owner-authored.

Validation SHALL occur at boot against the template; rendering SHALL be lenient, so an allowlisted path with no value at request time renders empty rather than failing a run. **Model paths SHALL be resolved at boot, while per-user and per-chat paths SHALL be validated at boot and resolved per run**, because no owner and no chat are in scope at startup; boot therefore renders each template with BOTH an absent and a populated per-user context and fails if either is empty. A single no-owner probe is unsound: `unless` is permitted over the per-user gates, so a template whose only content sits behind an inverse user gate renders non-empty with no owner and empty for exactly the owners who personalized. The digest gates admit the same inversion, and because `user` and `chats` are **independent** gates the probe SHALL cover their **cross product** — every combination of absent and populated for both — rather than varying them together. Varying them in lockstep is unsound for the same reason a single probe is: a template whose content sits in `{{#if user}}` and `{{#unless chats}}` renders non-empty when both are absent and when both are populated, while rendering empty for exactly the owners who have chats but authored no personalization. **The temporal anchor SHALL add no dimension to this probe, precisely because it cannot be absent**: every probe combination SHALL supply a representative anchor, and no probe SHALL exercise its absence, since no run can produce it. Rendered model and account-identity values SHALL be escaped by replacing exactly `&`, `<`, and `>`, leaving all other punctuation verbatim; rendered owner-authored values and rendered digest item values SHALL instead be neutralized by the two tag rules defined in the instance-config capability — a value can never close a tag it did not open within that same value, and can never emit a reserved delimiter name as a tag at all, with unmatched or malformed closers escaped fail-closed and everything else passing verbatim. Both SHALL be applied when the context is built rather than by mutating the engine's global escaping. A value that is absent or empty after trimming SHALL be omitted from the context, since an already-safe wrapper is always truthy and would otherwise make conditionals over it evaluate true. **Omission SHALL apply at every level of the per-user projection**: an individual field with no value is absent, `user.personalization` is absent when personalization is disabled or every authored field is empty, and `user` itself is absent when nothing beneath it would render — so that `{{#if user}}` gates an entire section including its operator-authored framing prose. **The same omission discipline SHALL apply to the digest projection**: an empty collection is absent rather than an empty array, and `chats` itself is absent when neither collection would render, so that `{{#if chats}}` gates the whole digest section including its framing prose. Whitespace-control syntax is permitted. Resolution SHALL remain single-pass and non-recursive before hashing and snapshotting: rendered output, including substituted owner text and substituted digest entries, MUST NOT be re-parsed or re-evaluated as a template. Prompt resolution MUST NOT use prompt fragments, inheritance, arbitrary config traversal, or another model's prompt — the prohibition on fragments and inheritance is what requires partials to be rejected. Per-user and per-chat substitution is a projection into one already-complete template and MUST NOT compose two prompt files.

A run's rendered prompt MAY therefore derive from **stored per-chat state** as well as per-run owner state. That state SHALL be resolved and substituted before the snapshot's hashes are computed, exactly as per-user values are, so the snapshot remains addressed by what was actually sent.

#### Scenario: Model has no prompt override

- **WHEN** a run selects a configured model whose entry omits `systemPromptFile`
- **THEN** the run's effective system prompt is the project-default prompt
- **AND** the receipt identifies its source as the project default

#### Scenario: Two models use materially different prompts

- **WHEN** two configured models reference different valid prompt files
- **THEN** a run for each model receives that model's complete rendered contents as its top-level system prompt
- **AND** neither prompt is inherited or composed from the other

#### Scenario: Default prompt renders model id and name

- **WHEN** the project-default prompt references `model.id` and `model.name` and a configured model supplies both values
- **THEN** that model's effective prompt contains the public id and configured name
- **AND** its immutable snapshot contains the rendered text rather than the expressions

#### Scenario: Prompt references an absent model name

- **WHEN** a selected default or override prompt references `model.name` and that model omits `name`
- **THEN** startup succeeds and the expression renders empty
- **AND** a conditional over `model.name` in the same template evaluates false rather than failing

#### Scenario: Literal expression is emitted

- **WHEN** a prompt escapes an expression in the engine's literal notation
- **THEN** its effective prompt contains that expression as literal text
- **AND** the emitted literal is not recursively interpolated

#### Scenario: Prompt uses a conditional

- **WHEN** a prompt wraps a label and its value in an `if` conditional over an allowlisted path
- **THEN** the wrapped region renders only when that path has a value
- **AND** the surrounding prompt structure is otherwise unchanged

#### Scenario: Prompt iterates an allowlisted collection

- **WHEN** a prompt wraps entry markup in an `each` block over `chats.recent` and references that collection's declared item fields inside it
- **THEN** the block renders once per entry with those fields substituted
- **AND** startup succeeds

#### Scenario: Iteration references an undeclared item field

- **WHEN** a prompt references a field inside an `each` body that the collection does not declare
- **THEN** startup fails naming the model id and the offending construct
- **AND** no chat data is exposed through the unknown field

#### Scenario: Iteration is attempted over a non-collection

- **WHEN** a prompt applies `each` to a scalar path, a gate-only path, or an unknown path
- **THEN** startup fails naming the model id and the offending construct
- **AND** the template is rejected before any run uses it

#### Scenario: A prompt renders the digest's scalar metadata

- **WHEN** a prompt references `chats.pinnedShown`, `chats.pinnedTotal`, `chats.recentShown`, `chats.recentTotal`, or `chats.compiledOn` outside any iteration
- **THEN** each renders its server-computed value
- **AND** applying `each` to one of them fails boot, since they are scalars rather than declared collections

#### Scenario: Iteration uses a forbidden escape construct

- **WHEN** a prompt nests one `each` inside another, references `@index` or `@key` inside an iteration body, declares block parameters on an `each`, or passes a hash argument to one
- **THEN** startup fails in each case naming the model id and the offending construct
- **AND** no such template reaches a run, since these are the deny-by-default validator's escape paths rather than stylistic preferences

#### Scenario: A collection is emitted as a value

- **WHEN** a prompt references `chats.recent` in value position rather than as an iteration subject
- **THEN** startup fails naming the offending construct
- **AND** no stringified structure can reach a rendered prompt

#### Scenario: Prompt contains a disallowed construct

- **WHEN** a prompt references an unknown context path, emits unescaped output, references a partial, or invokes another helper
- **THEN** startup fails naming the model id and the offending construct
- **AND** no raw config, environment, or server-only field is exposed

#### Scenario: Configured override is broken

- **WHEN** a model declares `systemPromptFile` but the file cannot resolve to a valid non-empty prompt
- **THEN** instance startup fails
- **AND** the system does not silently substitute the project default

#### Scenario: Rendered output is not re-evaluated

- **WHEN** a rendered value itself contains template-looking text
- **THEN** that text appears literally in the effective prompt
- **AND** no second parse or render pass occurs

#### Scenario: Per-user paths survive boot unresolved

- **WHEN** a prompt file references per-user context paths at startup
- **THEN** startup succeeds and each is accepted as allowlisted
- **AND** no owner data is resolved at boot, because these resolve per run

#### Scenario: Digest paths survive boot unresolved

- **WHEN** a prompt file references the digest collections at startup
- **THEN** startup succeeds and each is accepted as allowlisted
- **AND** no chat data is resolved at boot, because these resolve per run

#### Scenario: Prompt references no per-user path

- **WHEN** a configured model's prompt references no per-user context path
- **THEN** startup succeeds and runs for that model execute with no per-user content
- **AND** the model forgoes personalization rather than failing startup or a run

#### Scenario: Owner value absent at render time

- **WHEN** an allowlisted per-user path has no value for the requesting owner
- **THEN** the path is absent from the render context, a conditional over it is false, and a bare reference renders empty
- **AND** the run executes normally

#### Scenario: An entire section is gated on the owner having any per-user context

- **WHEN** an operator wraps a block including its framing prose in a conditional over `user`, and the owner has authored nothing and shares no account identity
- **THEN** the whole block including its framing prose is omitted
- **AND** the resulting prompt remains valid and non-empty

#### Scenario: An entire digest section is gated on there being any listed chat

- **WHEN** an operator wraps the digest block including its framing prose in a conditional over `chats`, and the owner's digest is withheld or empty
- **THEN** the whole block including its framing prose is omitted
- **AND** the resulting prompt remains valid and non-empty

#### Scenario: Digest presence does not make the personalization gate true

- **WHEN** an owner with a rendered digest has authored no personalization and shares no account identity
- **THEN** a conditional over `user` evaluates false
- **AND** the operator's personalization block including its framing prose is omitted

#### Scenario: Template renders non-empty without an owner

- **WHEN** a configured template's content would be empty once every per-user path is absent
- **THEN** startup fails as empty against the boot render, which uses the model context alone
- **AND** no prompt that could render empty for an unpersonalized owner reaches a run

#### Scenario: Template is empty only for one gate combination

- **WHEN** a template's entire content sits inside `{{#if user}}` and `{{#unless chats}}`, so it renders non-empty when both gates are absent and when both are populated
- **THEN** startup fails, because the cross-product probe covers the combination where the owner has chats but no per-user context
- **AND** no prompt that would render empty for that population of owners reaches a run

#### Scenario: Prompt renders the temporal anchor

- **WHEN** a prompt references `context.systemTime` and `context.systemTimezone` outside any iteration
- **THEN** startup succeeds and both are accepted as allowlisted scalar paths
- **AND** each run renders an absolute timestamp carrying a numeric UTC offset, together with the IANA identifier of the timezone it is expressed in

#### Scenario: Temporal namespace is guarded as though it were optional

- **WHEN** a prompt wraps content in `{{#if context}}`
- **THEN** startup fails naming the model id and the offending construct, without printing prompt contents
- **AND** the operator is not left with an always-true branch implying the anchor can be absent

#### Scenario: Prompt references no temporal path

- **WHEN** a prompt references neither `context.systemTime` nor `context.systemTimezone`
- **THEN** startup succeeds
- **AND** the rendered prompt is byte-identical to what the same template rendered before the anchor existed

#### Scenario: Every boot probe carries an anchor

- **WHEN** boot validates a template across the cross product of the `user` and `chats` gates
- **THEN** every probe combination supplies a representative anchor value
- **AND** no probe exercises an absent anchor, because no run can produce one

#### Scenario: System and tool templates agree on tool membership

- **WHEN** a system template and an admitted tool's description test the same `tools.<exact-tool-id>` predicate
- **THEN** both use the same admitted catalog bound for that Run
- **AND** neither template can turn a permission rejection into execution authority

### Requirement: Every new run binds an immutable effective-context snapshot

Before a new run is enqueued, the system SHALL bind it to an immutable owner-scoped snapshot containing the selected model's effective system prompt **with the requesting owner's per-user context already substituted**, prompt source kind, exact model-facing tool ids/descriptions/input schemas, a canonical source-neutral tool-availability manifest for that turn, and private source-declaration hashes for exactly its admitted code-owned tools. Each source declaration SHALL contain the exact id, normalized packaged description template, and canonical input schema, excluding operator overrides and rendered values. Tool membership admission SHALL precede shared system/description rendering; both SHALL precede computation of the hashes. The stored tool descriptions SHALL be the exact rendered strings. Available manifest entries SHALL carry hashes of those same final declarations. The existing content hash SHALL continue to cover the rendered prompt plus advertised declarations and the canonical code-owned source-binding map, the tool hash SHALL continue to cover only the exact advertised declaration contract, and a separate availability hash SHALL cover the canonical availability manifest. The snapshot's exact effective-context identity and reuse key SHALL include both content and availability hashes, so availability-only changes bind a distinct snapshot without retroactively changing the meaning of historical content hashes.

The user message, semantic runtime reminder metadata, Run, and snapshot binding SHALL commit atomically in the chat owner's tenant transaction. The per-user read and in-memory projection of the latest atomically published process-local catalog MAY occur before that transaction, but turn binding SHALL perform no MCP network I/O and SHALL not hold the transaction open across either operation; a personalization or remote-catalog change published after resolution MAY apply only to the next Run. Queued execution and retry SHALL use the bound snapshot and persisted reminder metadata rather than rereading prompt files, re-reading personalization, refreshing remote catalogs, or rebinding newer tool availability. Snapshots MAY be content-addressed and reused only within the same owner and only when prompt, advertised declarations, source kind, availability manifest, and source-binding map are canonically identical. A new snapshot SHALL include the source-binding map even when it is empty. Historical receipts SHALL remain readable without fabricated source bindings; an execution snapshot missing required bindings SHALL fail before provider I/O.

#### Scenario: Personalization changes after enqueue

- **WHEN** an owner edits their personalization after a run is enqueued but before the worker executes it
- **THEN** that run executes with the personalization bound at enqueue
- **AND** the edited content applies only to subsequently enqueued runs

#### Scenario: Tool availability changes after enqueue

- **WHEN** a dynamic tool disconnects or reconnects after a Run is enqueued
- **THEN** that Run retains its bound declarations, availability manifest, and reminder metadata
- **AND** the changed availability is compared and disclosed on the next accepted turn

#### Scenario: Two owners share one model

- **WHEN** two owners with different personalization run the same configured model
- **THEN** each run binds its own owner's rendered values
- **AND** neither owner's authored text appears in the other's prompt or snapshot

#### Scenario: Prompt file changes after enqueue

- **WHEN** an administrator changes a prompt file after a run is enqueued but before the worker executes it
- **THEN** that run uses the prompt content bound at enqueue
- **AND** a later run uses the newly resolved content only after the instance reloads it

#### Scenario: Run is retried

- **WHEN** execution of a run is retried
- **THEN** every attempt uses the same effective prompt, advertised tool contract, availability manifest, and semantic reminders
- **AND** the context receipt remains unchanged

#### Scenario: Tool contract is incompatible at execution

- **WHEN** a snapshotted code-owned tool has no compatible trusted executor, its live packaged source declaration hash differs from the stored source binding, or its stored id/input schema differs from the live source declaration at execution time
- **THEN** the Run fails before making a provider request
- **AND** the system does not silently advertise or execute a different tool contract
- **AND** a dynamic source failure instead retains the snapshotted declaration with an unavailable executor under the `tool-calling` capability

#### Scenario: Dynamic tool contract is unavailable at execution

- **WHEN** a snapshotted dynamic tool no longer has its matching trusted executor at execution time
- **THEN** its snapshotted declaration remains unchanged and its executor settles a requested call as unavailable
- **AND** unrelated tools and answer generation remain usable

#### Scenario: Cross-tenant snapshot reference is attempted

- **WHEN** one tenant attempts to read or bind another tenant's effective-context snapshot
- **THEN** datastore constraints and FORCE RLS deny the operation
- **AND** no prompt, tool, or availability content is disclosed

#### Scenario: Operator description changes without source-contract drift

- **WHEN** operator description overrides or owner settings differ from those used at acceptance but the code-owned source contract still matches
- **THEN** execution sends the description stored at acceptance and preserves existing invocation permission checks
- **AND** it does not rebuild or substitute the description from the worker's current configuration

#### Scenario: Equal rendered text does not merge different source contracts

- **WHEN** two accepted contexts render identical prompt and description strings but have different packaged source-declaration hashes
- **THEN** they have different effective-context identities and do not reuse the same snapshot

#### Scenario: Required source binding is missing or malformed

- **WHEN** an execution snapshot lacks a required code-owned source hash or carries an extra, malformed, or inconsistent binding
- **THEN** the Run fails before a provider request or tool effect
- **AND** no compatibility fallback rereads settings or ignores source drift

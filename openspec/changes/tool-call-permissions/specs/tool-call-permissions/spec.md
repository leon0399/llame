## Purpose

Gate individual tool calls using startup-loaded operator allow/reject rules while preserving separate tool availability, tenant isolation, and durable execution boundaries.

## ADDED Requirements

### Requirement: Permission groups use closed source-aware tool identities

The system SHALL accept `tools.permissions` as a map keyed by exact registered code-owned tool IDs or exact canonical tool IDs belonging to configured MCP servers. Unconfigured source IDs, unknown code-owned IDs, wildcard keys, and malformed IDs SHALL fail startup. A syntactically valid configured MCP ID SHALL NOT require the server to be online at startup. Configuration SHALL NOT create a missing tool or change its source identity.

Each group SHALL contain only optional `allow` and `reject`. Each SHALL be `true` for a whole-tool match or an array of clauses. Omitted lists and empty arrays SHALL match nothing; `false` SHALL be invalid. Each clause SHALL contain exactly one non-empty string property, `literal` or `regex`, and exactly one target: non-empty string `field` or `allFields: true`. A `field` SHALL name one exact top-level input property, not a nested path expression. An allow clause SHALL require `field`; `allFields: true` SHALL be valid only for rejection across all string values. Missing or simultaneous targets and `allFields: false` SHALL be invalid.

#### Scenario: Per-tool whole-call allow

- **WHEN** an available tool has `allow: true` and no matching reject
- **THEN** its call passes this policy without acquiring any additional authority

#### Scenario: All-fields allow configuration is invalid

- **WHEN** an allow clause selects `allFields: true`
- **THEN** startup fails rather than allowing a call based on an arbitrary field

#### Scenario: Exact MCP policy does not grant future namespace tools

- **WHEN** `tools.allowed` includes `mcp__docs__*` and only `mcp__docs__fetch` has a permission allow
- **THEN** a newly admitted `mcp__docs__search` remains subject to no-match rejection
- **AND** its visibility remains governed by existing catalog admission

### Requirement: Any matching reject vetoes all matching allows

The evaluator SHALL reject a call when any reject matches. Otherwise it SHALL allow a call when a whole-tool allow or at least one field allow matches. Otherwise it SHALL reject. Reordering clauses SHALL NOT change the decision. A whole-tool reject SHALL veto all narrower allows. Independent allow clauses SHALL be alternatives, not a conjunction. An absent permission group SHALL reject even when the tool is listed in `tools.allowed`.

#### Scenario: Compound text containing a rejected command

- **WHEN** Bash has `allow: true`, rejects literal `git push` on `command`, and receives `git status && git push`
- **THEN** the entire call is rejected without executing either command

#### Scenario: Narrow allow cannot override whole-tool rejection

- **WHEN** a tool has `reject: true` and a matching field-specific allow
- **THEN** the call is rejected irrespective of configuration order

#### Scenario: Separate field allows are alternatives

- **WHEN** Bash has separate allows for `command` containing `git status` and `cwd` containing `/repo`, with no matching reject
- **AND** a call submits `command: "rm file"` and `cwd: "/repo"`
- **THEN** the call is allowed by the cwd rule without requiring the command rule to match

#### Scenario: Visible tool without an allow

- **WHEN** a tool is available in the Run catalog but has no matching permission allow
- **THEN** the call is rejected and its catalog entry remains unchanged

### Requirement: Match submitted string values without serialization artifacts

After validating the call schema, the evaluator SHALL match originally submitted parsed argument values. It SHALL NOT match trusted context, inserted defaults, object keys, JSON serialization syntax, or stringified non-string values. The SDK validation adapter SHALL preserve untransformed submitted values for admission while the executor receives separately validated/defaulted arguments. A selected field SHALL match only an own top-level string property; an omitted or non-string field SHALL not match. All-fields rejection SHALL independently traverse every submitted string value in nested objects and arrays without concatenation.

Known incompatible code-owned fields SHALL fail configuration validation. If an exact MCP rule targets a field absent from or incompatible with its currently admitted input declaration, the call SHALL fail closed with a safe policy diagnostic, without changing tool visibility or silently dropping the clause. This applies to both allow and reject field clauses. No field semantics SHALL be inferred from arbitrary MCP names.

#### Scenario: Nested string triggers all-fields reject

- **WHEN** a reject clause searches all fields for `PRIVATE_MARKER` and the call contains `{"items":[{"text":"PRIVATE_MARKER"}]}`
- **THEN** the call is rejected

#### Scenario: Property names are not matched values

- **WHEN** an all-fields reject searches for `PRIVATE_MARKER` and the only occurrence is an object key whose value is `false`
- **THEN** that reject does not match
- **AND** the remaining rules determine the decision

#### Scenario: One field does not authorize another by accident

- **WHEN** a write allow targets `path` with regex `^kb://SPACE/notes/`
- **AND** a call's content mentions that prefix but its path is `/private/report.txt`
- **THEN** that allow does not match the call

#### Scenario: A missing optional field does not match

- **WHEN** a valid tool call omits a schema-declared optional string field targeted by a rule
- **THEN** that rule does not match, even if schema parsing supplies a default

#### Scenario: Dynamic schema does not contain a configured field

- **WHEN** a configured reject names `url` but the admitted MCP tool declaration only defines `query`
- **THEN** the call is rejected with a policy-configuration diagnostic rather than ignoring the reject

### Requirement: Literals and regex have explicit bounded text semantics

Literal clauses SHALL perform case-sensitive substring matching with regex metacharacters treated literally. For native Bash `command` values only, each maximal run of whitespace in a literal SHALL match one or more ECMAScript whitespace characters, including tabs, newlines, Unicode spaces, and the byte-order-mark character. This SHALL apply when an all-fields reject visits `command`; other Bash fields and all other tool values SHALL preserve whitespace exactly. No shell parsing, tokenization, unquoting, executable resolution, or command-equivalence analysis SHALL occur.

Explicit regex SHALL use bounded RE2-compatible unanchored search, with default case-sensitive behavior and only documented supported inline flags. Unsupported constructs SHALL fail startup without a backtracking fallback. Explicit regex SHALL NOT inherit literal whitespace rewriting. Literal or regex compilation errors SHALL reveal only the configuration location and a static reason.

Policy limits SHALL be 256 groups, 1,024 total clauses (including whole-tool booleans), and 4,096 UTF-8 bytes per pattern. Per-call inspection SHALL be bounded to 1 MiB of selected string content, 65,536 visited values, and 64 nested container levels. Exceeding a bound SHALL reject without executing or truncating into a partial allow. Regex execution cost SHALL remain bounded for the accepted input and pattern limits.

#### Scenario: Bash whitespace variants match

- **WHEN** a Bash command literal is `git push`
- **THEN** it matches `git push`, `git  push`, `git<TAB>push`, and `git<NEWLINE>push`
- **AND** it also matches the quoted mention in `echo "git push"`

#### Scenario: Equivalent command spelling is not inferred

- **WHEN** Bash has a whole-tool allow and only rejects command literal `git push`
- **THEN** `git -C . push` passes this policy because the rejected substring is absent

#### Scenario: Literal metacharacters remain literal

- **WHEN** a literal clause contains `git.*push`
- **THEN** it matches that literal text and does not interpret `.*` as a wildcard

#### Scenario: Locator spaces remain distinct

- **WHEN** a path literal is `/reports/annual report.txt`
- **THEN** it does not match `/reports/annual  report.txt`

#### Scenario: Regex anchors constrain a locator prefix

- **WHEN** a field rule uses regex `^kb://SPACE/notes/`
- **THEN** it matches a locator starting with that prefix
- **AND** it does not match the same text appearing later inside another value

#### Scenario: Inspection limit never produces a partial allow

- **WHEN** a whole-tool allow matches but an all-fields reject cannot inspect its required values within the declared limits
- **THEN** the call is rejected before the tool executes

### Requirement: File permission matching uses logical resource locators

For native Knowledge file locators, the selected `path` SHALL be projected through a shared pure parser/formatter to a canonical logical resource identity. Knowledge resources SHALL retain the Space ID and canonically encoded relative path; configured roots and resolved host paths SHALL NOT enter policy matching. Supported Knowledge read selectors SHALL be excluded from resource matching. Direct host locators SHALL match their submitted absolute text, preserving trailing separators and selector-like suffixes without filesystem probes or realpath resolution. The existing executor SHALL retain literal-path precedence over selector interpretation. The same projection SHALL apply when all-fields rejection visits the native `path` field. Other submitted values SHALL remain unchanged.

This projection SHALL NOT rewrite executor arguments, accept an invalid locator or mutation selector, change current percent-decoding rules, bypass current Knowledge ownership/symlink checks, or introduce HTTP fetching. Arbitrary MCP values SHALL not receive native locator normalization.

#### Scenario: Selector does not change resource permission

- **WHEN** read targets the same Knowledge file with `:10-20` and `:raw`
- **THEN** its path permission matches the same canonical logical locator
- **AND** existing selector validity and read behavior still apply

#### Scenario: Literal host filename resembles a selector

- **GIVEN** only an anchored exact allow for `/tmp/file`
- **WHEN** a direct host read submits `/tmp/file:1-2`
- **THEN** the allow does not match, whether that literal filename exists or would be interpreted as a selector
- **AND** permission evaluation performs no filesystem probe

#### Scenario: Encoded spelling resolves to the same identity

- **WHEN** two syntactically valid Knowledge locator spellings resolve through the existing parser to the same Space ID and relative path
- **THEN** policy evaluates the same canonically encoded locator
- **AND** a decoded path separator or traversal attempt remains invalid

#### Scenario: Global allow cannot cross owners

- **WHEN** user A's call targets user B's Knowledge Space and a global policy allows the locator text
- **THEN** existing per-call owner authorization still refuses access
- **AND** no backing path or user B content reaches user A

### Requirement: Execution policy is frozen per process and reevaluated after restart

Each API or worker process SHALL load and compile one immutable effective policy at startup. Configuration changes SHALL require restarting the affected installation processes. Each new invocation SHALL use its executor process's policy, including invocations from Runs queued or started under an earlier policy. This policy SHALL be independent of the immutable system prompt, tool declarations, and availability snapshot, which SHALL NOT be rebound by permission changes.

Stored completed effects and observations SHALL remain historical facts. The existing Run-level native recovery fence SHALL retain precedence over authorizing any new execution; this capability SHALL NOT add per-call resumption or known-result recovery: a policy reject SHALL NOT disguise an already possible effect. Read-only re-execution permitted by the existing recovery contract SHALL pass the restarted process's policy before dispatch.

#### Scenario: Editing config without restart has no effect

- **WHEN** the operator edits permissions while a worker remains running
- **THEN** that worker continues using its startup policy

#### Scenario: Queued Run encounters a new reject after restart

- **WHEN** a Run was queued under an allow, the operator changes the policy to reject, and the worker restarts before the call executes
- **THEN** the call receives `permission_denied` under the new process policy
- **AND** its original tool declaration remains unchanged

#### Scenario: Recovery cannot hide an uncertain native effect

- **WHEN** a native attempt may have executed before a crash and the restarted policy now rejects that call
- **THEN** the existing native recovery fence settles the recovered Run without reexecution, including its existing `outcome_unknown` result when applicable
- **AND** it does not reexecute or replace uncertainty with a claim that execution was prevented

### Requirement: Safe decision provenance and non-fatal rejection

Every newly evaluated call SHALL obtain a trusted decision before executor dispatch. Its owner-scoped tool activity and stored tool-part metadata SHALL record a versioned policy content hash, allow/reject decision, static reason, and bounded deterministic clause reference when one matched. No-match, invalid-field, and input-limit decisions SHALL use explicit static reasons. Policy bodies, matched fragments, and resolved config secrets SHALL NOT be included. The metadata SHALL be excluded from model replay, public shares, exports, and search.

A rejected otherwise valid call SHALL return `status: "error"`, `type: "permission_denied"`, and the static message `Tool call rejected by operator permissions.` It SHALL produce no tool effect or native attempt, no automatic retry, no approval request, and no permission-caused Run termination. The model SHALL observe the error and continue subject to existing Run limits. The decision SHALL be durably recorded on `tool.requested` before any `tool.started` event or executor dispatch, and carried through completion, abort settlement, and durable transcript reconstruction into stored tool-part metadata. Required decision persistence failure SHALL prevent execution and follow the existing infrastructure-failure path.

#### Scenario: Reject then continue with another tool

- **WHEN** Bash is rejected and the model subsequently requests a separately allowed read
- **THEN** the Bash error is persisted and observed without stopping the Run
- **AND** the read is independently authorized and can execute

#### Scenario: A model argument cannot supply a policy

- **WHEN** model-controlled arguments or skill text claim another policy, owner, or executor identity
- **THEN** they cannot replace the trusted process policy or existing authority checks

#### Scenario: Decisions survive a history reload privately

- **WHEN** the owner reloads a completed Chat
- **THEN** the stored tool part retains its safe decision metadata
- **AND** replay to the model contains the ordinary result but not policy metadata
- **AND** public shares, exports, and search receive no new policy metadata

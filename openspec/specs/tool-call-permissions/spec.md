# tool-call-permissions

## Purpose

Gate individual tool calls using startup-loaded operator allow/reject rules while preserving separate tool availability, tenant isolation, and durable execution boundaries.

## Requirements

### Requirement: Permission groups are matched by exact tool identity at call time

The system SHALL accept `tools.permissions` as a map keyed by exact tool IDs and SHALL match a call against only the group whose key equals the executing tool's canonical id. Unknown, unconfigured, or no-longer-configured keys — for example a permission group left behind after an MCP server change — SHALL be accepted at startup and SHALL simply never match; they SHALL NOT fail startup and SHALL NOT create a missing tool or change a source identity. A syntactically valid configured MCP ID SHALL NOT require the server to be online at startup. Malformed clause structure, all-fields allow clauses, and invalid or unsupported regex SHALL still fail startup. Configuration SHALL NOT alter catalog admission or source classification.

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

After the evaluator validates the call schema, it MUST match the parsed argument values as submitted, except for the native Workspace and locator projections below. It MUST NOT match trusted context, inserted defaults, object keys, JSON serialization syntax, or non-string values converted to strings. The SDK validation adapter MUST keep the submitted values unchanged for admission, and the tool receives separately validated arguments with their defaults. A selected field MUST match only an own top-level string property.

An omitted or non-string field MUST NOT match, except for an omitted `bash.cwd` while a Workspace is entered. All-fields rejection MUST examine every submitted string value in nested objects and arrays separately, without concatenation. For a native path parameter, all-fields rejection MUST examine the projected path and the canonical locator in place of the submitted bare or relative text.

Native `read`, `edit`, and `write` `path` values, `enter_workspace` `path` values, and `bash` `cwd` values MUST project to a canonical `machine://` locator. An absolute path `p` projects to `machine://<name>p` on the current Machine. The projected path of every Machine value is its decoded absolute path without the scheme and the Machine name. This holds for a bare path, a `file:` locator, a `machine://` locator, a `grep` scope prefix, and each derived or stored value: a canonical root, a main clone, a worktree directory, and the re-checked Workspace root. While a Workspace is entered, a relative path MUST first resolve from the canonical Workspace root. Resolution MUST be lexical like POSIX `path.posix.resolve`, it MUST keep a trailing separator, and `..` can leave the root.

For `read`, the evaluator MUST remove the split-off read selector after resolution. The tool MUST receive exactly the projected path, with that trailing separator. Projection MUST NOT resolve symbolic links. The OS follows symbolic links in the projected path as for any absolute path.

Here, a relative value does not start with `/`. It also has no `scheme:` prefix that the shared locator parser or the `file:` classifier knows. An unknown scheme MUST stay `invalid_path` and MUST NOT become a relative path. A `file:` locator is always absolute, and the classifier runs before Workspace projection. A reject clause MUST match the submitted value, the projected path, or the canonical locator, and any match refuses the call. A bare-path reject in a spelling other than `^/` thus keeps its effect on every Machine. An allow clause MUST match only the canonical locator.

The evaluator MUST evaluate a `bash` call that omits `cwd` while a Workspace is entered as if it submitted the canonical Workspace root as `cwd`. This is the one exception to the rule that inserted defaults are not matched. `kb://`, `skill://`, and web locators MUST stay unchanged by Workspace projection. The evaluator MUST match `bash.command` only as the submitted text.

Calls in the same model step as an `enter_workspace` or `exit_workspace` call MUST project with the Workspace root that was committed before that step. A binding change MUST take effect from the next model step. With no Workspace entered, a relative native file path MUST stay invalid. An omitted `bash.cwd` then keeps its existing default behavior, and the evaluator MUST NOT match it as a submitted field.

The per-attempt re-check of the Workspace binding is a third named exception. It evaluates the `enter_workspace` group with the stored canonical Workspace root as the `path` value, not a value that the model submitted. That evaluation MUST get an allow and MUST match no reject, or the binding becomes invalid.

The evaluator MUST decide a `read` call whose `path` is an `http://` or `https://` locator over two texts. The first is the submitted locator without its split-off read selector. The second is the locator that the shared native projection returns. That is the text that the request uses, without its read selector and fragment, with a normalized host, port, and encoding. A reject clause that matches either text MUST refuse the call, so no spelling can miss a reject.

The evaluator MUST decide the allow on the projected text, because an allow names the resource that the call reaches. The evaluator itself normalizes nothing. The projection is the parser of the `read` tool, so the matched text and the requested text cannot differ.

The evaluator MUST decide a native `read`, `edit`, or `write` call whose `path` is a valid `file:` or `machine://` locator over three texts. The first is the submitted locator. The second is the canonical `machine://` locator with its path decoded once. The third is the projected path. All three texts MUST keep their `.` and `..` segments.

For `read`, all three texts MUST lose a split-off read selector. For `edit` and `write`, all three texts MUST keep a suffix that looks like a selector, because a mutation takes its decoded path literally. The `file:` classifier MUST run before Workspace projection. The evaluator thus matches a valid `file:` locator as an absolute path on the current Machine in every case. A reject that matches any of the three texts MUST refuse the call. The evaluator MUST decide an allow on the canonical locator. An invalid `file:` locator MUST stay unchanged in projection. Permission admission or native locator validation MUST then refuse it, and the evaluator MUST NOT turn it into a filesystem path.

The evaluator MUST evaluate each derived locator of a web read against the `read` group as if the model submitted it. A derived locator is a redirect hop, an announced alternate, a suffix candidate, an `llms.txt` candidate, or an adapter request. A hop is a different resource, so it needs its own allow. A hop locator is the `Location` value, resolved against the URL of the redirecting request by the WHATWG URL parser and serialized as its `href`.

It is canonical in the same way:

- a lowercase host, and an internationalized host as punycode,
- no default port, and an empty path as `/`,
- path and query escapes normalized to a fixed point with unreserved characters decoded,
- no fragment.

The matched text is thus the URL of the next request. An adapter locator MUST be the canonical target that the adapter actually requests, never an operator secret or an unbounded raw template. The same evaluator and projection MUST decide a derived locator.

No trusted context and no relaxation carry over from the admitted call or an earlier derived locator. The evaluator MUST NOT remove a read selector from a derived locator, because a server or an adapter chose it. A hop that ends in `:5` is thus judged with that text.

The evaluator MUST also evaluate each address that a web request connects to against the `read` group as an address locator. An address locator is the requested locator with its host replaced by that address, as the native-file-tools address-admission requirement defines it. Only reject clauses MUST judge an address locator. A matching reject refuses that address. An evaluation that exceeds the inspection limit refuses it, as every exceeded bound rejects.

The evaluator MUST admit an address that no reject matches and no bound refuses, also when no allow clause matches it. The evaluator MUST never decide an allow on an address locator. An allow names a resource, and a domain allowlist names hosts, not their addresses. The same evaluator and projection as the source locator decide an address locator. An evaluation without a compiled policy admits no address.

Configuration validation MUST fail on known incompatible code-owned fields. An exact MCP rule can target a field that the admitted input declaration does not contain or cannot hold. The call MUST then fail closed with a safe policy diagnostic. Tool visibility MUST NOT change, and the evaluator MUST NOT drop the clause. This applies to allow and reject field clauses. The evaluator MUST NOT infer field semantics from arbitrary MCP names.

Canonical-path evaluation of an instruction import is a fourth named exception. When the canonical path of an import differs from its resolved path, the `read` group MUST evaluate the canonical path. The completion payload MUST record that decision as a derived `canonical` decision when the call settles. A rejection MUST deny that call and the import.

The silent pre-evaluation of a prompt or instruction import target before any probe MUST record no decision of its own. The audited `read` that follows records the call decision. In `bypass`, it MUST admit without evaluation, as every other evaluation does.

The `grep` scope projection is a fifth named exception. Each evaluation of the `grep` group MUST see `scopes` as one string: the projected literal prefix of one scope. A host scope prefix MUST project to its canonical locator on the current Machine. A reject on `scopes` MUST also see the projected path of the prefix. While a Workspace is entered, the evaluator MUST evaluate an omitted `scopes` as the canonical Workspace root. All-fields rejection MUST also examine each projected prefix, so a reject that matches the submitted scope or its prefix refuses.

The per-file evaluation of a `grep` call is a sixth named exception. The `read` group MUST evaluate each candidate file with `path` set to its canonical locator under the `read` projection. The evaluator MUST NOT record these file decisions one by one.

#### Scenario: Nested string triggers all-fields reject

- **WHEN** a reject clause searches all fields for `PRIVATE_MARKER` and the call contains `{"items":[{"text":"PRIVATE_MARKER"}]}`
- **THEN** the call is rejected

#### Scenario: Property names are not matched values

- **WHEN** an all-fields reject searches for `PRIVATE_MARKER` and the only occurrence is an object key whose value is `false`
- **THEN** that reject does not match
- **AND** the remaining rules determine the decision

#### Scenario: One field does not authorize another by accident

- **WHEN** a write allow targets `path` with regex `^kb://SPACE/notes/`
- **AND** the content of a call mentions that prefix but its path is `/private/report.txt`
- **THEN** that allow does not match the call

#### Scenario: A missing optional field does not match

- **WHEN** a valid tool call omits a schema-declared optional string field that a rule targets, outside an entered Workspace
- **THEN** that rule does not match, even if schema parsing supplies a default

#### Scenario: Dynamic schema does not contain a configured field

- **WHEN** a configured reject names `url` but the admitted MCP tool declaration only defines `query`
- **THEN** the call is rejected with a policy-configuration diagnostic and the reject is not ignored

#### Scenario: A web locator is matched as submitted and as requested

- **WHEN** a `read` group allows `path` with regex `^https://docs\.example\.com/`
- **AND** a call submits `https://docs.example.com/guide:raw`
- **THEN** the allow matches and the call proceeds, because the submitted text is judged without its `:raw` selector
- **AND** a call that submits `https://DOCS.example.com/guide` also proceeds, because the allow is decided on the locator that the request uses
- **AND** a reject for that host refuses every spelling of it, `https://DOCS.example.com/guide` and `https://docs%2Eexample.com/guide` included
- **AND** a reject that matches the submitted or the requested text refuses the call

#### Scenario: A redirect hop is evaluated as a submitted locator

- **WHEN** an admitted read of `https://docs.example.com/start` gets a redirect to `http://docs.example.com/plain`
- **AND** the `read` group rejects `^http://`
- **THEN** the hop is decided as if the model submitted that URL
- **AND** the decision occurs before any request to the hop

#### Scenario: A hop does not inherit the call's admission

- **WHEN** the only allow of the `read` group is `^https://docs\.example\.com/` and the call is admitted by it
- **AND** the response redirects to `https://other.example/guide`
- **THEN** the hop matches no allow and is rejected
- **AND** the call ends without a request to the second host

#### Scenario: An address locator is judged by rejects only

- **WHEN** the only allow of a `read` group is `^https://docs\.example\.com/` and it rejects `^https?://10\.`
- **AND** `docs.example.com` resolves to `93.184.216.34`
- **THEN** the read is admitted although no allow matches `https://93.184.216.34/guide`
- **AND** when `docs.example.com` resolves to `10.0.0.5`, that address is refused and no connection opens

#### Scenario: Workspace-relative read path is matched after projection

- **WHEN** the entered Workspace root is `machine://devl/home/operator/project/subdirectory`, the `read` group allows the call but rejects `path` with regex `(^|[/\\])\.ssh([/\\]|$|:)`, and `read` submits the relative path `../../.ssh/id_ed25519`
- **THEN** the permission value is `machine://devl/home/operator/.ssh/id_ed25519` and the call is rejected before the file is read
- **AND** the submitted relative spelling is not matched

#### Scenario: Omitted bash cwd is matched as the Workspace root

- **WHEN** the entered Workspace root is `machine://devl/home/operator/project`, `bash` has a whole-tool allow with a reject for `cwd` with regex `^machine://devl/home/operator/project$`, and `bash` submits `git status` without a `cwd`
- **THEN** the permission value for `cwd` is `machine://devl/home/operator/project` and the call is rejected before execution

#### Scenario: Workspace projection does not change bash command matching

- **WHEN** a Workspace is entered, `bash` has a whole-tool allow with a reject for `command` with regex `^git push$`, and `bash` submits `git push` with a relative `cwd`
- **THEN** the `command` reject matches the submitted command text and the call is rejected
- **AND** only `cwd`, not `command`, is projected from the Workspace root

#### Scenario: Workspace projection preserves a trailing separator

- **WHEN** a Workspace with root `machine://devl/work/project` is entered and `read` submits `app.ts/`
- **THEN** the permission value is exactly `machine://devl/work/project/app.ts/` and the tool receives `/work/project/app.ts/` on `devl`
- **AND** the call follows absolute-path semantics and returns `not_found` for a regular-file target

#### Scenario: Unknown Workspace path scheme remains invalid

- **WHEN** a Workspace is entered and `read` submits `vault://notes/a.md`
- **THEN** the call returns `invalid_path`
- **AND** it is not projected as a relative path or sent to a Machine

#### Scenario: Same-step calls use the root committed before the step

- **WHEN** `machine://devl/work/old` is committed before a model step that calls `enter_workspace` for `/work/new` and `read` for `f`
- **THEN** the permission value of that `read` is `machine://devl/work/old/f`, and the tool reads `/work/old/f`
- **AND** the `/work/new` binding applies to projections from the next model step

#### Scenario: Workspace re-check matches the stored canonical root

- **WHEN** an attempt re-checks a bound Workspace before it resolves its sources
- **THEN** the `enter_workspace` permission group evaluates the stored canonical root as the `path` value
- **AND** that value must get an allow and match no reject for the binding to stay

#### Scenario: A minimal-form alias is matched as an absolute path in a Workspace

- **WHEN** a Workspace is entered at `machine://devl/work/project`, a `read` group rejects `^machine://[^/]+/etc/`, and the model submits `file:/etc/%70asswd`
- **THEN** the classifier runs before Workspace projection, the permission value is `machine://devl/etc/passwd`, and the call is rejected before the read
- **AND** an allow for `^machine://devl/work/project/` does not admit the locator

#### Scenario: A host-path reject catches a percent-encoded file alias

- **WHEN** a `read` group rejects `path` with regex `^machine://[^/]+/etc/` and the model submits `file:///etc/%70asswd`
- **THEN** the submitted text is examined first, and the projected `machine://devl/etc/passwd` matches the reject
- **AND** the native read is refused before filesystem access

#### Scenario: A host-path allow admits a file alias

- **WHEN** the current Machine is `devl`, a `read` group allows `path` with regex `^machine://devl/srv/docs(?:/|$)`, and the model submits `file:///srv/docs/guide.md`
- **THEN** the projection `machine://devl/srv/docs/guide.md` matches and the call is admitted
- **AND** the `devl` Machine daemon reads `/srv/docs/guide.md` and contacts no URL authority

#### Scenario: A submitted file spelling can be rejected independently

- **WHEN** a `read` group rejects `path` with regex `^file://` and the model submits `file:///srv/docs/guide.md`
- **THEN** the call is rejected on the submitted text
- **AND** an equivalent `/srv/docs/guide.md` call is not rejected by that clause

#### Scenario: A policy allow does not grant a remote file authority

- **WHEN** the only allow of a `read` group is `^file://` and the model submits `file://other.example/srv/docs/guide.md`
- **THEN** the projection returns the invalid locator unchanged, both texts match the allow, and permission admits the call
- **AND** native validation still returns `invalid_path` before filesystem access or network activity

#### Scenario: A file-form allow does not admit a valid alias

- **WHEN** the only allow of a `read` group is `^file:///srv/docs/` and the model submits `file:///srv/docs/guide.md`
- **THEN** the submitted text matches, but the projected `machine://devl/srv/docs/guide.md` matches no allow
- **AND** the call is rejected as `no_allow` with `permission_denied`
- **AND** an allow written as `^machine://devl/srv/docs/` is the form that admits the locator

#### Scenario: An invalid alias remains unchanged for permission matching

- **WHEN** the only allow of a `read` group is `^machine://devl/srv/docs/` and the model submits `file:///srv/docs/guide.md?`
- **THEN** projection returns the submitted text unchanged, and the call is rejected as `no_allow` with `permission_denied` before native validation
- **AND** under a whole-tool allow, the same submitted locator reaches native validation and returns `invalid_path`

#### Scenario: An adapter request earns independent admission

- **WHEN** an allow `^https://github\.com/` admits a source URL but the GitHub adapter derives `https://api.github.com/repos/o/r/readme`
- **AND** the `read` group has no allow for `api.github.com`
- **THEN** the adapter request is rejected before I/O
- **AND** the source read can fall through, and the source allow does not count as API authority

#### Scenario: A rewrite target is decided as its derived locator

- **WHEN** an enabled rewrite turns an admitted x.com source into `https://x.pcstyle.dev/jack/status/20`
- **THEN** policy decides the canonical target before its request
- **AND** a reject for that target prevents the request and keeps generic source fallthrough available

#### Scenario: A canonical-path rejection denies an instruction import

- **WHEN** the canonical path of an instruction import differs from its resolved path, the resolved path is allowed, and the `read` group rejects the canonical path
- **THEN** the rejection is recorded as a derived `canonical` decision on the first page read call of the import
- **AND** the call is denied with `requested` and `completed` events but no `started` event, and the import is denied

#### Scenario: A rejected import target records one decision

- **WHEN** the silent pre-evaluation rejects a prompt or instruction import target
- **THEN** exactly one decision is recorded, the decision of the audited `read`
- **AND** the silent pre-evaluation records no decision of its own

#### Scenario: A grep scope is evaluated as its projected prefix

- **WHEN** the `grep` group allows `field: "scopes"` with `literal: "machine://devl/work/project/src/"`, the current Machine is `devl`, and a call submits the scope `/work/project/src/**/*.ts`
- **THEN** the `grep` group is evaluated with `scopes` set to `machine://devl/work/project/src/`
- **AND** the call is allowed

#### Scenario: Each grep candidate file is evaluated as a read locator

- **WHEN** the `grep` group allows the call and the `read` group rejects `path` with regex `(^|/)\.env$`
- **AND** the walk meets the file `machine://devl/work/project/.env`
- **THEN** the file contributes no passage
- **AND** `tool.requested` records the call decision only, and the completion audit counts that file as refused

### Requirement: A path rule anchored at a bare root fails startup

A regex clause on a path parameter MUST NOT start with `^/`. The path parameters are `read`, `edit`, and `write` `path`, `grep` `scopes`, `enter_workspace` `path`, and `bash` `cwd`. Startup MUST fail and name the group, the list, and the clause index of such a clause, for an allow or a reject. The operator rewrites such a rule once in canonical form. A literal clause stays a substring match. A reject in another spelling, such as `^\/etc\/`, loads and keeps its effect, because rejects also see the projected path.

#### Scenario: A bare root regex fails startup

- **WHEN** the `read` group allows `path` with regex `^/srv/docs/`
- **THEN** startup fails and names the `read` allow clause
- **AND** no Run starts under that configuration

#### Scenario: A rule for every Machine is written once

- **WHEN** the `read` group rejects `path` with regex `^machine://[^/]+/opt/secret(/|$)` and the model reads `/opt/secret/key` with the current Machine `devl`
- **THEN** the call is refused
- **AND** a read of `machine://gpu/opt/secret/key` is also refused

#### Scenario: A literal path clause still matches a canonical locator

- **WHEN** the `read` group rejects `path` with literal `/opt/secret/` and the model reads `/opt/secret/key` on the current Machine `devl`
- **THEN** the literal matches `machine://devl/opt/secret/key` and the call is refused

#### Scenario: A reject in another bare spelling still refuses

- **WHEN** the `read` group rejects `path` with regex `^\/etc\/` and the model reads `/etc/passwd` on the current Machine `devl`
- **THEN** the reject matches the projected path `/etc/passwd` and the call is refused

#### Scenario: A file or Machine spelling does not miss a bare reject

- **WHEN** the `read` group rejects `path` with regex `^\/etc\/` and the model reads `file:///etc/passwd` or `machine://devl/etc/passwd`
- **THEN** the reject matches the projected path `/etc/passwd` and each call is refused

#### Scenario: A grep scope does not miss a bare reject

- **WHEN** the `grep` group rejects `scopes` with regex `^\/etc\/` and a scope is `machine://devl/etc/**`
- **THEN** the reject matches the projected prefix `/etc/` and the call is refused

#### Scenario: An all-fields reject sees the projected path

- **WHEN** an all-fields `read` reject matches `^/home/u/\.ssh/` and the model reads `.ssh/id_rsa` in a Workspace at `machine://devl/home/u`
- **THEN** the reject matches the projected path `/home/u/.ssh/id_rsa` and the call is refused

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

For native Knowledge file locators, a shared pure parser and formatter MUST project the selected `path` to a canonical logical resource identity. A Knowledge resource MUST keep the Space ID and the canonically encoded relative path. Configured roots and resolved paths of Knowledge resources MUST NOT enter policy matching. Supported Knowledge read selectors MUST NOT enter resource matching.

The evaluator MUST decide an allow for a path on a Machine on its canonical `machine://` locator, with its trailing separator and its `.` and `..` segments kept. A reject also sees the projected path without the scheme and the Machine name. This includes a bare absolute path and a `file:` locator on the current Machine. For `read`, the evaluator MUST remove a split-off read selector. Projection MUST NOT probe the filesystem or resolve symbolic links. An `edit` or `write` path MUST keep a suffix that looks like a selector, because a mutation takes its path literally.

The evaluator MUST match a web locator as its canonical URL without a split-off read selector, as it matches Knowledge and skill locators. The evaluator MUST match a `media://` locator as its canonical text: the lower-case `media://` scheme and the lower-case UUID, without a split-off read selector. Owner resolution and stored media metadata MUST NOT enter policy matching. An invalid media locator MUST stay unchanged, and native locator validation MUST refuse it.

Both projections MUST use text only. Neither can consult the filesystem to learn whether the removed suffix is a selector or part of a literal filename. When a Workspace is entered, a relative `path` of native `read`, `edit`, or `write` MUST resolve from the canonical root. Resolution MUST be lexical like POSIX `path.posix.resolve` and keep a trailing separator. Policy matching MUST use the projected canonical locator, for `read` without its split-off read selector after resolution. The tool MUST receive exactly the projected path, with its trailing separator.

This Workspace projection MUST NOT probe the filesystem or resolve symbolic links. Here, a relative value does not start with `/`. It also has no `scheme:` prefix that the shared locator parser or the `file:` classifier knows. An unknown scheme MUST stay `invalid_path` and MUST NOT become a relative path. `..` can resolve outside the Workspace root.

Workspace projection MUST NOT change an absolute path or a valid `file:` locator. A `file:` locator is always absolute, and its decoded path is matched on the current Machine in every case. The Machine daemon MUST keep literal-path precedence over selector interpretation. The locator projection, the removal of a `read` selector, and Workspace projection MUST also apply when all-fields rejection visits the native `path` field. Other submitted values MUST stay unchanged.

This logical-resource projection MUST NOT change tool arguments, except that Workspace projection passes its exact projected path. The removal of a read selector MUST NOT change the locator that the tool receives. The projection MUST NOT accept an invalid locator or mutation selector. It MUST NOT change the percent-decoding rules for Knowledge, skill, `file:`, or `machine://` locators. The escapes of a web locator follow the web normalization of the native `read` tool, which this projection uses again.

The projection MUST NOT bypass Knowledge ownership or symbolic-link checks, and it MUST NOT add HTTP fetching. Workspace projection MUST resolve only relative native paths. It MUST leave absolute paths, valid `file:` locators, `machine://` locators, Knowledge locators, skill locators, `media://` locators, and web locators unchanged. Arbitrary MCP values MUST NOT get native locator normalization.

#### Scenario: Selector does not change resource permission

- **WHEN** `read` targets the same Knowledge file with `:10-20` and `:raw`
- **THEN** its path permission matches the same canonical logical locator
- **AND** the existing selector validity and read behavior still apply

#### Scenario: Literal host filename resembles a selector

- **WHEN** only an anchored exact allow for `machine://devl/tmp/file` exists and a read on the current Machine `devl` submits `/tmp/file:1-2`
- **THEN** the projected text `machine://devl/tmp/file` matches the allow and the call is admitted, whether that literal filename exists or the suffix is a selector
- **AND** permission evaluation performs no filesystem probe
- **AND** a literal filename that ends in the removed suffix is a known text-only gap, the same gap as a `write` reject that names an alias in the repository

#### Scenario: Encoded spelling resolves to the same identity

- **WHEN** two syntactically valid Knowledge locator spellings resolve through the existing parser to the same Space ID and relative path
- **THEN** policy evaluates the same canonically encoded locator
- **AND** a decoded path separator or traversal attempt stays invalid

#### Scenario: Global allow cannot cross owners

- **WHEN** the call of user A targets the Knowledge Space of user B and a global policy allows the locator text
- **THEN** the per-call owner authorization still refuses access
- **AND** no backing path or content of user B reaches user A

#### Scenario: A file alias is matched as an absolute path in a Workspace

- **WHEN** a Workspace is entered at `machine://devl/work/project`, a permission group rejects `^machine://[^/]+/etc/`, and a call submits `file:/etc/%70asswd`
- **THEN** the classifier runs before Workspace projection and the projected permission value is `machine://devl/etc/passwd`
- **AND** the call is rejected before any filesystem probe, and an allow for `^machine://devl/work/project/` does not admit it

#### Scenario: A file alias selector stays outside the Workspace root

- **WHEN** a Workspace is entered at `machine://devl/work/project`, a permission group allows `^machine://devl/srv/docs/`, and a `read` call submits `file:///srv/docs/guide.md:10-20`
- **THEN** the projected permission value is `machine://devl/srv/docs/guide.md`, without the read selector
- **AND** it is not projected to `machine://devl/work/project/srv/docs/guide.md`

#### Scenario: File alias projection removes the selector

- **WHEN** a permission group allows `^machine://devl/srv/docs/` and a `read` call on the current Machine `devl` submits `file:///srv/docs/guide.md:10-20`
- **THEN** the projection for the allow is `machine://devl/srv/docs/guide.md`, without the read selector in the submitted locator and in the canonical locator
- **AND** selector validation and the Machine read still apply after permission admission, and the tool receives the submitted locator unchanged

#### Scenario: A reject sees decoded file URL text

- **WHEN** a permission group rejects `^machine://[^/]+/srv/private/` and a call submits `file:///srv/%70rivate/guide.md`
- **THEN** the projected text `machine://devl/srv/private/guide.md` matches the reject
- **AND** no filesystem probe occurs

#### Scenario: An allow does not authorize a remote file authority

- **WHEN** the only allow of a permission group is `^machine://devl/srv/docs/` and a call submits `file://other.example/srv/docs/guide.md`
- **THEN** the projection leaves the locator unchanged, no allow matches, and the call is rejected as `no_allow` with `permission_denied`
- **AND** the authority never becomes an admitted Machine path

#### Scenario: A minimal-form alias is projected like the authority form

- **WHEN** a permission group rejects `^machine://[^/]+/etc/` and a call submits `file:/etc/%70asswd`
- **THEN** the projected text `machine://devl/etc/passwd` matches the reject and the call is refused
- **AND** no filesystem probe occurs

#### Scenario: An anchored credential reject catches every read selector

- **WHEN** a `read` group rejects `path` with regex `^machine://[^/]+/home/u/\.ssh/id_rsa$`
- **AND** a call submits `/home/u/.ssh/id_rsa:1-5` or `/home/u/.ssh/id_rsa:raw`
- **THEN** each call is rejected, because the projected text is `machine://devl/home/u/.ssh/id_rsa`
- **AND** permission evaluation performs no filesystem probe

#### Scenario: A clause written against a selector spelling matches no read

- **WHEN** a `read` group rejects `path` with literal `:raw`
- **AND** a call submits a bare path, a `file:` locator, a `machine://` locator, a web locator, a Knowledge locator, or a skill locator with a read selector
- **THEN** that reject matches none of them, because no text that the evaluator sees for a `read` `path` contains the selector
- **AND** the other clauses decide each call

#### Scenario: A mutation path keeps a selector-shaped suffix

- **WHEN** the only allow of a `write` group is `^machine://devl/srv/app/config\.json$` and a call on the current Machine `devl` submits `write` with `path` `/srv/app/config.json:1-5`
- **THEN** the matched text is `machine://devl/srv/app/config.json:1-5`, no allow matches, and the call is rejected as `no_allow`
- **AND** a `read` of the same text is matched as `machine://devl/srv/app/config.json`

#### Scenario: A Workspace-relative read is matched without its selector

- **WHEN** a Workspace is entered at `machine://devl/work/project`, a `read` group allows `^machine://devl/work/project/` and rejects `^machine://devl/work/project/secret\.md$`, and a call submits `read` with `path` `secret.md:1-5`
- **THEN** the matched text is `machine://devl/work/project/secret.md` and the reject refuses the call
- **AND** the tool would receive `/work/project/secret.md:1-5` on `devl`

#### Scenario: A media locator is matched without its selector

- **WHEN** a `read` group rejects `path` with regex `^media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f$` and a call submits
  `media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f:raw`
- **THEN** the matched text is `media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f` and the reject refuses the call
- **AND** without that reject, the admitted call reaches native validation and returns
  `invalid_selector`

#### Scenario: A media allow cannot cross owners

- **WHEN** a `read` group allows `path` with regex `^media://` and user A submits `media://<id>` of an
  image that user B owns
- **THEN** permission admits the locator text, and the read returns `not_found`
- **AND** no bytes or descriptor fields of the image of user B reach user A

### Requirement: A path allow for one Machine does not admit another Machine

The evaluator MUST decide an allow for a path parameter on the canonical locator, with the Machine name. A rule that names one Machine MUST NOT admit the same path on another Machine.

#### Scenario: An allow for one Machine does not widen to another

- **WHEN** the `read` group only allows `path` with regex `^machine://devl/home/leo/proj(/|$)` and the Chat is bound to `machine://gpu/home/leo/proj`
- **AND** the model reads `/home/leo/proj/README.md`
- **THEN** the call is denied as `no_allow` for `machine://gpu/home/leo/proj/README.md`

### Requirement: Execution policy is frozen per process and reevaluated after restart

Each API or worker process MUST load and compile one immutable effective policy at startup. A configuration change MUST require a restart of the affected installation processes. Each new invocation MUST use the policy of its executor process. This rule also applies to invocations from Runs that were queued or started under an earlier policy. A process MUST read `tools.permissionModes` once at startup. The system MUST resolve the effective permission mode of an attempt with the rule of `A Run's effective permission mode selects whether the policy is evaluated`. The enabled modes of the process that executes the attempt are the input of that rule. This also applies to Runs accepted under an earlier configuration. Invocation policy MUST stay independent of attempt-local tool membership and system-prompt receipts. A policy rejection MUST NOT remove a tool from the catalog of that attempt. Each fresh attempt MUST still resolve the current catalog of the executing worker. The system MUST NOT restore a historical declaration snapshot.

Stored completed effects and observations MUST stay historical facts. The Run-level native recovery fence MUST keep precedence over the authorization of any new execution, in every permission mode. This capability MUST NOT add per-call resumption or known-result recovery. A policy reject MUST NOT disguise an effect that possibly occurred. A re-execution that the recovery contract permits for a call with no native mutation MUST pass the policy of the restarted process before dispatch. In an attempt whose effective mode is `bypass`, the system MUST instead record that re-execution as a bypass decision before dispatch.

#### Scenario: Editing config without restart has no effect

- **WHEN** the operator edits permissions while a worker stays in operation
- **THEN** that worker continues to use its startup policy

#### Scenario: Queued Run encounters a new reject after restart

- **WHEN** a Run was queued under an allow, the operator changes the policy to reject, and the worker restarts before the call executes
- **THEN** the call receives `permission_denied` under the new process policy
- **AND** its original tool declaration stays the same

#### Scenario: Recovery cannot hide an uncertain native effect

- **WHEN** a native attempt possibly executed before a crash, and the restarted policy now rejects that call
- **THEN** the native recovery fence settles the recovered Run without re-execution, with its `outcome_unknown` result when applicable
- **AND** it does not execute the call again or replace the uncertainty with a claim that the system prevented the execution

#### Scenario: Withdrawing bypass takes effect on restart

- **WHEN** a Run accepted with `bypass` is still queued, and the operator removes `bypass` from `tools.permissionModes` and restarts the worker
- **THEN** the next attempt of the Run executes with effective mode `default` under the policy of the worker

#### Scenario: Bypass does not override the recovery fence

- **WHEN** a native attempt of a `bypass` Run possibly executed before a crash
- **THEN** the native recovery fence settles the recovered Run without re-execution, exactly as in `default`

#### Scenario: Withdrawing read-only does not widen a queued Run

- **WHEN** a Run accepted with `read-only` is still queued, and the operator removes `read-only` from `tools.permissionModes` and restarts the worker
- **THEN** the next attempt of the Run executes with effective mode `read-only`

### Requirement: Safe decision provenance and non-fatal rejection

Every newly evaluated call SHALL obtain a trusted decision before executor dispatch. Its owner-scoped tool activity and stored tool-part metadata SHALL record an opaque random policy-instance ID independent of policy contents, allow/reject decision, static reason, and bounded deterministic clause reference when one matched. No-match, invalid-field, and input-limit decisions SHALL use explicit static reasons. Policy bodies, matched fragments, and resolved config secrets SHALL NOT be included. The ID SHALL remain fixed within its executor process and be regenerated on restart, even with unchanged configuration. It SHALL NOT expose a deterministic digest of interpolated private values. The metadata SHALL be excluded from model replay, public shares, exports, and search.

For a web read, every derived locator SHALL be decided before its request is
sent. The executor SHALL hand each derived-locator decision to the trusted
run execution through the tool context it was constructed with, never
through the model-visible result, and run execution SHALL record those
decisions beside the call decision in the completion payload when the tool
call settles, so the same owner-scoped tool activity and the same stored
tool-part metadata carry them, each with the same policy-instance ID as the
call decision plus the locator's own decision, its own static reason, and its
own bounded deterministic clause reference when one matched — never the call
decision's reason or clause; durable transcript
reconstruction SHALL read them from the same payload it reads the call
decision from. A call that never settles loses its derived-locator records
with its result. The existing `tool.requested` rule SHALL continue to cover
the call decision rather than each derived-locator record. A refused address
that a request would have connected to SHALL be recorded the same way, as a
derived-locator decision of kind `address` carrying its static reason and,
when one matched, its clause reference; an adapter request SHALL use kind
`adapter` and carry no target secret, resolved address, or credential value.
The address and its address locator SHALL NOT be recorded, and an admitted
address SHALL NOT produce a record. One record SHALL be kept per distinct refused address and decision per call, and at
most 16 `address` records per call, the first 16 in order, under a bound of
their own, so address records never displace the records of hops and probe
candidates.

A rejected otherwise valid call SHALL return `status: "error"`, `type: "permission_denied"`, and the code-owned message selected by the static decision reason below. It SHALL produce no tool effect or native attempt, no automatic retry, no approval request, and no permission-caused Run termination. A redirect hop rejected after the call
was admitted SHALL end that call before the hop's body is read, returning
`status: "error"` and `type: "permission_denied"` with the fixed hop message
below and a `rejectedUrl` result field carrying the hop locator's origin and
path (query and fragment removed) bounded to 2,048 characters with control
characters removed, and SHALL produce no
further request, no automatic retry, no approval request, and no
permission-caused Run termination. A request whose every address is refused,
whether resolved or given as an IP literal, SHALL NOT be issued; on the call's own request chain it SHALL end the
call with `status: "error"` and `type: "permission_denied"` with the fixed
refused-address message below, a refused hop carrying `rejectedUrl` as a hop
rejection does, and no result field or message SHALL carry an address the
host resolved to. A refused adapter request SHALL not produce a model-visible
error body: its decision is stored, its bounded failure note is attached to
adapter fallthrough, and the next adapter or ladder candidate may run. For a
refusal that ends the call, the model SHALL observe the error and continue
subject to existing Run limits. The decision SHALL be durably recorded on `tool.requested` before any `tool.started` event or executor dispatch, and carried through completion, abort settlement, and durable transcript reconstruction into stored tool-part metadata. Required decision persistence failure SHALL prevent execution and follow the existing infrastructure-failure path.

The model-visible message SHALL use one of these fixed templates. It SHALL NOT interpolate rule text, matching fragments, field names, private paths, operator-authored explanations, clause references, policy IDs, or secret
values; the rejected hop locator travels in the separate `rejectedUrl` field,
never inside the message. The static reason explanation is deliberately model-visible; the separate diagnostic metadata remains excluded from model context. These instructions guide model behavior and SHALL NOT be represented as an enforced sandbox or an equivalence detector. Every later submitted call still receives its own admission decision.

#### Message for `explicit_reject`

```text
Tool call rejected before execution by operator permissions. A reject rule matched. Do not retry this call, disguise the same action through different commands or tools, delegate it to another agent, or change permission settings to bypass the rejection. In-run approval is unavailable. Continue with other permitted work; if this action is required, explain the blocked step to the user.
```

#### Message for `no_allow`

```text
Tool call rejected before execution by operator permissions. No allow rule permits this call. Do not retry this call, disguise the same action through different commands or tools, delegate it to another agent, or change permission settings to bypass the rejection. In-run approval is unavailable. Continue with other permitted work; if this action is required, explain the blocked step to the user.
```

#### Message for `invalid_field`

```text
Tool call rejected before execution by operator permissions. The configured permission rule is incompatible with this tool. Do not retry this call or change permission settings yourself. Report the configuration problem to the user and continue with other permitted work. In-run approval is unavailable.
```

#### Message for `input_limit`

```text
Tool call rejected before execution by operator permissions. The submitted input exceeds the permission inspection limit. Do not retry unchanged or evade a reject by splitting, encoding, switching tools, or delegating. A smaller request may be submitted only as independently permitted work. In-run approval is unavailable; explain any blocked required step to the user.
```

#### Message for a rejected redirect hop

```text
Tool call stopped by operator permissions. A redirect target was refused before its content was read; the refused target is in rejectedUrl. Do not retry this call, disguise the same target through another tool, or delegate it to another agent. In-run approval is unavailable. Continue with other permitted work; if this content is required, explain the blocked target to the user.
```

#### Message for refused resolved addresses

```text
Tool call stopped by operator permissions. Every address of the target host was refused before a connection was opened; when the target was a redirect, it is in rejectedUrl. Do not retry this call, disguise the same target through another tool, or delegate it to another agent. In-run approval is unavailable. Continue with other permitted work; if this content is required, explain the blocked target to the user.
```

#### Scenario: Reject explains its effect without revealing policy

- **WHEN** a reject rule blocks a call
- **THEN** the result identifies rejection before execution, gives the fixed matching-reject reason, and instructs the model against retrying or bypassing it through other tools or agents
- **AND** neither interpolated private rule text nor matched input appears in the message
- **AND** other permitted work may continue without claiming that this call ran

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

#### Scenario: Policy identity cannot verify guesses of private values

- **WHEN** permission patterns include interpolated private values
- **THEN** the exposed policy ID is generated independently of those values
- **AND** restarting with identical configuration produces a new ID while decisions in one process retain the same ID

#### Scenario: A rejected hop is recorded with the call's policy identity

- **WHEN** a redirect hop is refused during an admitted web read
- **THEN** the tool activity and stored tool-part metadata record that hop's reject decision with the same policy-instance ID as the call decision and the hop's own static reason and clause reference
- **AND** the record is stored when the call settles and carries no policy body, matched fragment, or resolved secret

#### Scenario: A hop rejection is an error the model can continue from

- **WHEN** a redirect hop is rejected during an admitted web read
- **THEN** the call returns `status: "error"` and `type: "permission_denied"` with the fixed hop message and the hop locator in `rejectedUrl`, and the message itself contains no interpolated text
- **AND** no further request, command, script, or agent retries that target, and the Run continues with other permitted work

#### Scenario: A refused address is recorded without its text

- **WHEN** an admitted web read skips one refused resolved address and succeeds over another
- **THEN** the tool activity and stored tool-part metadata record one `address` decision with the call's policy-instance ID and the reject's static reason and clause reference
- **AND** the same address refused again by a later request of the call adds no second record, and a zone answering with more refused addresses than the bound cannot displace a hop or probe record
- **AND** neither the address nor its address locator is stored, and the admitted address produces no record

#### Scenario: Every address refused is an error the model can continue from

- **WHEN** every address of the submitted locator is refused
- **THEN** the call returns `status: "error"` and `type: "permission_denied"` with the fixed refused-address message and no `rejectedUrl`
- **AND** no connection is opened and the Run continues with other permitted work

#### Scenario: An adapter refusal is recorded without leaking its target

- **WHEN** a matched adapter's derived request is refused by the `read` group before I/O
- **THEN** trusted tool activity records an `adapter` decision with the call's policy identity and the adapter's own reason and clause reference
- **AND** the target URL, token, and matched secret are absent from model-visible output and stored provenance
- **AND** the adapter falls through without a model-visible status body

### Requirement: Recommended portable policy with explicit replacement

When `tools.permissions` is omitted, the system MUST create no permission groups, so every call is rejected. No built-in fallback policy exists. The shipped `llame.config.jsonc.example` MUST document exactly nine groups as the recommended portable map for operators to copy. The groups are `bash`, `read`, `edit`, `write`, `knowledge_search`, `search_conversations`, `conversation_read`, `enter_workspace`, and `exit_workspace`. It MUST also document the B1-B8, F1-F4, E1-E3, W1-W2, F5a-F5f, F6, and F7 rejects below. The groups `bash`, `read`, `edit`, `write`, `knowledge_search`, `search_conversations`, `conversation_read`, and `exit_workspace` MUST each have a whole-tool allow.

The `enter_workspace` group MUST instead use an operator-edited field allow on `path`, such as `{ "field": "path", "regex": "^machine://[^/]+/home/operator/projects/[^/]+/?$" }`. Its allow is not a whole-tool allow. It MUST contain the F1-F3 and E1-E3 path rejects against its `path` field and no other recommended rejects. Every directory that this field allow admits is trusted to run code and read secrets of its Machine through its Workspace MCP configuration.

The `edit` and `write` groups MUST contain the W1-W2 path rejects against their `path` fields. The W1 and W2 rejects match text only: aliases in the repository, such as symbolic links, can go around them, and no Machine-level guard exists. F4, F5a-F5f, F6, and F7 MUST stay `read` rejects and MUST NOT apply to `enter_workspace`. The `exit_workspace` group MUST have a whole-tool allow and no recommended rejects.

Future code-owned tools and all MCP tools MUST get no implicit group, and `tools.allowed` MUST stay empty by default. An explicitly supplied permission map MUST be the complete effective policy. A group that the map omits MUST reject its calls, and `{}` MUST reject all calls. Operator policy can remove any recommended reject. The system MUST NOT add a mandatory policy tier or an implicit merge.

The example and the shipped web-read operator runbook MUST also document the domain-restricted alternative for `read`. That alternative replaces the whole-tool allow of the group with field allows for `^machine://`, `^kb://`, `^skill://`, `^media://`, and `^https://docs\.example\.com/`, and it admits only those authorities. The runbook MUST state these facts:

- Such a clause matches the canonical locator text, not the address that the host resolves to. The canonical text has a lowercase punycode host, no default port, no root dot, a percent-encoded path with unreserved characters decoded, and no read selector.
- Reject clauses also see each resolved address as an address locator, and allows never do.
- A noncanonical submitted spelling becomes that text before the allow is decided. A reject refuses the call when it matches the submitted spelling or the normalized one.
- A read selector leaves the matched text on every source before admission. A clause written against a selector spelling such as `:raw:` thus matches no read.
- The `:` alternative in the F1-F4 path terminators stays necessary. F1-F3 also guard `edit`, `write`, and `enter_workspace`, where nothing is removed. A literal name with a colon outside the grammar, such as `/home/u/.ssh:old`, keeps its suffix in the matched text of a `read`.

The table below is the authoritative recommended reject list, shipped in the example. Regex cells contain engine input, not JSON string escapes. The example stores these spellings directly, ready to compile. Operators copy them, and configuration interpolation still applies to values that operators write. Operator JSON examples must escape backslashes and opening interpolation braces.

| ID  | Tool / field                                                   | Matcher | Value                                                                                                                                                           |
| --- | -------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `bash.command`                                                 | regex   | `(^\|[^A-Za-z0-9_])(sudo\|shutdown\|reboot\|halt\|poweroff\|mkfs([.][A-Za-z0-9_-]+)?)(\s\|$)`                                                                   |
| B2  | `bash.command`                                                 | regex   | `\brm\s+-(rf\|fr)\s+['"]?(/\*?\|~(\*\|/\*?)?\|\$HOME(/\*?)?\|\$\{HOME\}(/\*?)?)['"]?($\|[\s;&\|])`                                                              |
| B3  | `bash.command`                                                 | regex   | `\bdd\s+[^\r\n;&\|]*\bof=/dev/`                                                                                                                                 |
| B4  | `bash.command`                                                 | literal | `diskutil erase`                                                                                                                                                |
| B5  | `bash.command`                                                 | literal | `diskutil apfs delete`                                                                                                                                          |
| B6  | `bash.command`                                                 | literal | `git reset --hard`                                                                                                                                              |
| B7  | `bash.command`                                                 | literal | `chmod -R 777`                                                                                                                                                  |
| B8  | `bash.command`                                                 | regex   | `\b(curl\|wget)\s+[^\r\n;\|]*\x7c\s*(ba\|z\|da\|k)?sh(\s\|$)`                                                                                                   |
| F1  | `read.path`, `edit.path`, `write.path`, `enter_workspace.path` | regex   | `(^\|[/\\])(\.ssh\|\.aws\|\.azure\|\.gnupg\|\.kube)([/\\]\|$\|:)`                                                                                               |
| F2  | `read.path`, `edit.path`, `write.path`, `enter_workspace.path` | regex   | `(^\|[/\\])(\.git-credentials\|\.npmrc\|\.pypirc)([/\\]\|$\|:)`                                                                                                 |
| F3  | `read.path`, `edit.path`, `write.path`, `enter_workspace.path` | regex   | `(^\|[/\\])(\.docker[/\\]config\.json\|\.gem[/\\]credentials\|\.config[/\\]gh)([/\\]\|$\|:)`                                                                    |
| E1  | `enter_workspace.path`                                         | regex   | `(^\|[/\\])node_modules([/\\]\|$)`                                                                                                                              |
| E2  | `enter_workspace.path`                                         | regex   | `^machine://[^/]+/(tmp\|var/tmp)(/\|$)`                                                                                                                         |
| E3  | `enter_workspace.path`                                         | regex   | `(^\|[/\\])Downloads([/\\]\|$)`                                                                                                                                 |
| F4  | `read.path`                                                    | regex   | `(^\|[/\\])\.env($\|:\|\.(local\|development\|production\|staging\|test)(\.local)?($\|:))`                                                                      |
| W1  | `edit.path`, `write.path`                                      | regex   | `(?i)(^\|[/\\])\.mcp\.json$`                                                                                                                                    |
| W2  | `edit.path`, `write.path`                                      | regex   | `(?i)(^\|[/\\])\.(llame\|agents\|claude)[/\\]`                                                                                                                  |
| F5a | `read.path`                                                    | regex   | `^http://(?:[1-9]\|1[1-9]\|[2-9]\d\|10[1-9]\|11\d\|12[0-689]\|1[3-5]\d\|16[0-8]\|17[013-9]\|18\d\|19[013-9]\|2[0-4]\d\|25[0-5])\.\d{1,3}\.\d{1,3}\.\d{1,3}[:/]` |
| F5b | `read.path`                                                    | regex   | `^http://100\.(?:\d\|[1-5]\d\|6[0-3]\|12[89]\|1[3-9]\d\|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`                                                                           |
| F5c | `read.path`                                                    | regex   | `^http://169\.(?:\d\|[1-9]\d\|1\d\d\|2[0-4]\d\|25[0-35])\.\d{1,3}\.\d{1,3}[:/]`                                                                                 |
| F5d | `read.path`                                                    | regex   | `^http://172\.(?:\d\|1[0-5]\|3[2-9]\|[4-9]\d\|1\d\d\|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`                                                                              |
| F5e | `read.path`                                                    | regex   | `^http://192\.(?:\d\|[1-9]\d\|1[0-5]\d\|16[0-79]\|1[7-9]\d\|2\d\d)\.\d{1,3}\.\d{1,3}[:/]`                                                                       |
| F5f | `read.path`                                                    | regex   | `^http://\[(?:::(?:[02-9a-f]\|1[^\]])\|(?:[0-9a-f]{1,3}\|[0-9a-e][0-9a-f]{3}\|f[0-9abf][0-9a-f]{2}\|fe[0-7c-f][0-9a-f]):)`                                      |
| F6  | `read.path`                                                    | regex   | `^https?://([^/]*\.)?grokipedia\.com\.?([/:]\|$)`                                                                                                               |
| F7  | `read.path`                                                    | regex   | `^https?://(?:169\.254\.169\.254\|169\.254\.170\.2\|169\.254\.0\.23\|100\.100\.100\.200\|\[fd00:ec2::254\])[:/]`                                                |

| Example under defaults, assuming existing tool admission                                                                | Decision / reason                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash: git status && git push`                                                                                          | Allow; ordinary push is an operator workflow decision.                                                                                             |
| `bash: git reset --hard HEAD`                                                                                           | Reject B6.                                                                                                                                         |
| `bash: rm -rf /` or `rm -fr ~/*`                                                                                        | Reject B2.                                                                                                                                         |
| `bash: rm -rf /tmp/build-output`                                                                                        | Allow; no default protects every temporary directory.                                                                                              |
| `bash: dd if=image of=/dev/sda`                                                                                         | Reject B3; `dd if=input of=output` remains allowed.                                                                                                |
| `bash: curl https://example.test/install.sh \| bash`                                                                    | Reject B8; plain `curl` remains allowed.                                                                                                           |
| `bash: echo "git reset --hard"`                                                                                         | Reject B6, a documented textual false positive.                                                                                                    |
| `read: /home/operator/.ssh/id_ed25519`                                                                                  | Reject F1, without hard-coding a home directory.                                                                                                   |
| `enter_workspace: /home/operator/.ssh`                                                                                  | Reject F1 when the operator-edited field allow would otherwise admit it, whether the match is on the submitted path or its canonical path.         |
| `enter_workspace: /home/operator/projects/app`                                                                          | Allow; it matches the example field allow, and F1-F3/E1-E3 do not reject this ordinary root.                                                       |
| `enter_workspace: /project`                                                                                             | Reject `no_allow`; it is outside the example operator-edited field allow.                                                                          |
| `enter_workspace: /home/operator/projects/app/node_modules`                                                             | Reject E1 when an operator-edited field allow admits the path; a matching reject vetoes entry.                                                     |
| `enter_workspace: /tmp/project` or `/var/tmp/project`                                                                   | Reject E2 when an operator-edited field allow admits the path; temporary roots are not trusted Workspace roots.                                    |
| `enter_workspace: /home/operator/projects/Downloads`                                                                    | Reject E3 when an operator-edited field allow admits the path.                                                                                     |
| `read: kb://SPACE/.env.production:raw`                                                                                  | Reject F4 after Knowledge selector projection.                                                                                                     |
| `read: kb://SPACE/.env.example`                                                                                         | Allow; the name alone is not treated as a credential.                                                                                              |
| `read: /project/docker-compose.yml` or `/project/certificate.pem`                                                       | Allow; blanket extension/configuration bans obstruct routine inspection.                                                                           |
| `write: /project/.mcp.json` or `/project/.llame/skills/x/SKILL.md`                                                      | Reject W1 or W2 when the submitted text matches; an in-repository alias can bypass these text-only rejects because no executor-level guard exists. |
| A newly discovered MCP tool, even in an allowed namespace                                                               | Reject until an explicit permission group is supplied.                                                                                             |
| `read: http://example.test/page` resolving to `93.184.216.34`                                                           | Reject F5a on the address locator; cleartext to a public address is refused.                                                                       |
| `read: http://93.184.216.34/page`                                                                                       | Reject F5a before any connection; an IP-literal host is its own address.                                                                           |
| `read: http://localhost:3000/`, or `http://nas.lan/` resolving to `10.0.0.5`                                            | Allow; cleartext to loopback and internal ranges stays open.                                                                                       |
| `read: http://169.254.169.254/latest/meta-data/`, `http://100.100.100.200/latest/meta-data/`, or their `https://` forms | Reject F7, which covers the well-known metadata and credential endpoints inside ranges F5a–F5f leave open.                                         |
| `read: https://grokipedia.com/page` or `https://grokipedia.com./page`                                                   | Reject F6; subdomains and a trailing dot are covered.                                                                                              |
| `read: https://g%72okipedia.com/page` or `HTTPS://Grokipedia.com/page`                                                  | Rejected by F6, which matches the normalized text; no request.                                                                                     |
| `read: https://docs.example.com/guide`                                                                                  | Allow; the recommended `read` group stays whole-tool, so HTTPS remains open.                                                                       |

F5a-F5f MUST together match exactly the cleartext locators whose host is one of these:

- an IPv4 address outside `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, and `192.168.0.0/16`,
- a bracketed IPv6 address outside `::`, `::1`, `fc00::/7`, and `fe80::/10`.

They MUST match no hostname text, so the addresses that its host resolves to decide a cleartext read. The example matrix above MUST cover the recommended rules, with rejection cases and routine-work cases, and it MUST match the shipped example. The documentation MUST NOT describe native path rejects as `bash` confinement, search-result filtering, directory-listing filtering, or a policy on hidden backing paths.

#### Scenario: Omitted permissions reject every call

- **WHEN** both `tools.allowed` and `tools.permissions` are omitted
- **THEN** no permission group exists and no tool is advertised or executable
- **AND** a requested call would be rejected as `no_allow`

#### Scenario: Operator map is the complete policy

- **WHEN** the operator supplies only a `bash` group with `allow: true`
- **THEN** recommended Bash rejects are not inherited
- **AND** other tools receive no allow even if present in `tools.allowed`

#### Scenario: Ordinary cleanup and credential reads differ

- **WHEN** the recommended example policy and otherwise admitted native tools are in force and Bash submits `rm -rf /tmp/build-output`
- **THEN** it is allowed
- **WHEN** read submits `/home/operator/.ssh/id_ed25519`
- **THEN** it is rejected without resolving a backing path

#### Scenario: A domain allowlist rejects every other authority

- **WHEN** a `read` group's only allow is `{ "field": "path", "regex": "^https://docs\\.example\\.com/" }`
- **THEN** reading `https://docs.example.com/guide` is admitted
- **AND** reading `https://other.example/guide`, `/etc/hosts`, or `kb://SPACE/notes/a.md` is each rejected as `no_allow` without a fetch or file open

#### Scenario: Cleartext stays open to internal addresses only

- **WHEN** the recommended example policy is in force and read submits `http://localhost:3000/`, `http://nas.lan/` resolving to `10.0.0.5`, or a tailnet host resolving to `100.100.1.2`
- **THEN** each is fetched
- **WHEN** read submits `http://example.com/` resolving to `93.184.216.34`
- **THEN** it is rejected with no connection
- **AND** a cleartext host resolving to a public IPv6 address and to `10.0.0.5` is fetched over `10.0.0.5`

#### Scenario: Recommended entry policy rejects protected paths

- **WHEN** the recommended policy is in force with its operator-edited `enter_workspace.path` allow admitting `/home/operator/.ssh`, `/home/operator/.ssh` is a directory, and `enter_workspace` submits `/home/operator/.ssh`
- **THEN** the call is rejected by F1
- **AND** no Workspace binding is established

#### Scenario: Recommended write policy rejects Workspace control paths

- **WHEN** the recommended example policy is in force and `write` submits `/project/.mcp.json` or `/project/.llame/skills/x/SKILL.md`
- **THEN** each call is rejected by W1 or W2
- **AND** no file is created or modified

#### Scenario: Recommended entry policy rejects risky roots

- **WHEN** the operator-edited `enter_workspace.path` allow admits `/home/operator/projects/app/node_modules`, `/tmp/project`, and `/home/operator/projects/Downloads`, and the recommended policy is in force
- **THEN** the calls are rejected by E1, E2, and E3 respectively
- **AND** no Workspace binding is established for any of them

#### Scenario: Recommended entry field allow names trusted roots

- **WHEN** the recommended policy uses the example `enter_workspace.path` field allow and `enter_workspace` submits `/home/operator/projects/app`
- **THEN** the call is allowed when the directory exists and no canonical-path reject matches
- **AND** the admitted directory is trusted to run code and read host secrets through its Workspace MCP configuration

#### Scenario: Workspace control rejects do not resolve aliases

- **WHEN** `write` submits an in-repository symlink alias whose target is `.mcp.json` or a path beneath `.llame`, `.agents`, or `.claude`
- **THEN** the W1 or W2 text reject can miss the submitted alias
- **AND** no executor-level guard rejects the alias, so the remaining policy rules determine the decision

#### Scenario: The domain-restricted read alternative admits owner media

- **WHEN** a `read` group's allows are `^machine://`, `^kb://`, `^skill://`, `^media://`, and
  `^https://docs\.example\.com/`, and read submits `media://<id>` of an image the Run owner holds
- **THEN** the call is admitted and returns the image result
- **AND** reading `https://other.example/guide` is still rejected as `no_allow` without a fetch
- **WHEN** the group's only allow is `^https://docs\.example\.com/` and read submits the same
  `media://<id>`
- **THEN** the call is rejected as `no_allow` before any media lookup

### Requirement: Workspace entry permissions cover submitted and canonical paths

Permission evaluation for `enter_workspace` SHALL evaluate the submitted absolute `path` first, before any filesystem probe. Only after that submitted-path decision succeeds SHALL entry canonicalize the directory path and evaluate the canonical path. Both values SHALL independently obtain an allow, and neither value may match a reject. The canonical-path decision SHALL be recorded like a derived-locator decision, including the policy provenance required for such a decision. Any matching reject on either value SHALL veto entry, even if the other value has no matching reject or an allow also matches. Entry SHALL NOT establish or change a Workspace binding when either path is rejected or lacks an allow.

#### Scenario: A reject on the submitted entry path vetoes a safe canonical path

- **WHEN** `/tmp/.ssh` is a directory symlink to `/tmp/project`, the `enter_workspace` group rejects the F1 credential path, and `enter_workspace` submits `/tmp/.ssh`
- **THEN** the submitted path matches F1 and entry is rejected even though the canonical path is `/tmp/project`
- **AND** no Workspace binding is established

#### Scenario: A reject on the canonical entry path vetoes a safe submitted alias

- **WHEN** `/tmp/project` is a directory symlink to `/home/operator/.ssh`, the `enter_workspace` group rejects the F1 credential path, and `enter_workspace` submits `/tmp/project`
- **THEN** the canonical path matches F1 and entry is rejected even though the submitted path does not match
- **AND** no Workspace binding is established

#### Scenario: A canonical entry path without an allow rejects an allowed submitted path

- **WHEN** `/tmp/project-link` is a directory symlink to `/work/project`, the submitted path has an `enter_workspace` allow, the canonical path matches no allow, and neither path matches a reject
- **THEN** canonical-path evaluation returns `no_allow` and records its policy provenance
- **AND** no Workspace binding is established and no Workspace MCP client starts

### Requirement: A Run's effective permission mode selects whether the policy is evaluated

Each execution attempt MUST have one effective permission mode. The system MUST resolve it once, when the attempt is claimed. The effective mode is `bypass` when the Run has the accepted mode `bypass` and the executing process enables `bypass` in `tools.permissionModes`. The effective mode is `read-only` when the accepted mode of the Run is `read-only`, on every process. The effective mode is `default` in all other cases. A Run accepted with `bypass` on a process that does not enable `bypass` MUST execute in `default`.

In `default`, each requirement of this capability MUST apply without change.

In `read-only`, each evaluation of a permission group MUST occur exactly as in `default`. The read-only requirements of this capability add a ceiling before the call evaluation. The ceiling MUST NOT change any group evaluation.

In `bypass`, the system MUST NOT evaluate a permission group for that attempt at any point where this capability evaluates one. These points include the per-call admission of submitted and projected arguments. They also include each derived locator of a web read and each resolved web address. They also include the submitted and canonical paths of `enter_workspace`, and the per-attempt Workspace binding re-check. The system MUST admit each of those evaluations as an allow. In that attempt, this capability MUST NOT refuse anything through a group match, the reject veto, the no-allow rejection, or the invalid-field rejection. The same applies to the inspection-bound rejection, the omitted-policy rejection, and the recommended reject list. This capability MUST NOT produce a `permission_denied` result in that attempt.
The bypass list also includes the canonical-path evaluation of an instruction import when the canonical path differs from the resolved path. The system MUST admit it as an allow and MUST NOT evaluate the `read` group for it.

`bypass` MUST NOT relax any other gate. These gates MUST apply exactly as in `default`. They are `tools.allowed` availability and catalog admission, owner and tenant authorization with Knowledge Space ownership, and native locator validation. The same holds for Workspace path projection of executor arguments, the other Workspace re-check conditions, and the native recovery fence. It also holds for the web-read time, size, and redirect bounds, the Run step and call-timeout bounds, and MCP environment isolation.

#### Scenario: A rejected command runs under bypass

- **WHEN** the recommended policy is in force, the effective mode of an attempt is `bypass`, and Bash submits `git reset --hard HEAD`
- **THEN** the system admits and executes the call
- **AND** in a `default` attempt, B6 rejects the same call

#### Scenario: Omitted permissions admit every available call under bypass

- **WHEN** `tools.permissions` is omitted, `bypass` is enabled, and a `bypass` attempt calls an advertised tool
- **THEN** the system admits the call
- **AND** a tool that is not in `tools.allowed` stays unadvertised and does not execute

#### Scenario: Web-read hops and addresses are admitted under bypass

- **WHEN** the recommended policy is in force and a `bypass` attempt reads `http://169.254.169.254/latest/meta-data/`
- **THEN** F5a–F7 refuse neither the locator nor its address
- **AND** the web-read header, call, and body bounds still apply

#### Scenario: Workspace entry skips both path evaluations under bypass

- **WHEN** a `bypass` attempt calls `enter_workspace` for `/tmp/project`, E2 rejects that path, and the directory exists
- **THEN** the system admits the submitted path and the canonical path and binds the Workspace
- **AND** entry still requires `enter_workspace` in `tools.allowed`, a directory that exists, and the configured native executor

#### Scenario: A default attempt detaches a Workspace only bypass could enter

- **WHEN** a `bypass` Run bound a Workspace at `/tmp/project`, and the next `default` attempt re-checks it under a policy that rejects it
- **THEN** the system detaches the binding with reason `permission_rejected`
- **AND** a later `bypass` Run must call `enter_workspace` again to bind it

#### Scenario: Bypass cannot cross owners

- **WHEN** the `bypass` attempt of user A reads `kb://<user B's Space>/notes/a.md`
- **THEN** the per-call owner authorization refuses the read
- **AND** no content of user B gets to user A

#### Scenario: A worker that does not enable bypass applies its policy

- **WHEN** a worker whose `tools.permissionModes` is `["default"]` claims a Run accepted with `bypass`, and Bash submits `git reset --hard HEAD` under the recommended policy
- **THEN** the effective mode of the attempt is `default`, and B6 rejects the call with `permission_denied`

#### Scenario: Bypass admits an instruction-import canonical path

- **WHEN** a `bypass` attempt imports an instruction file whose canonical path differs from its resolved path
- **AND** the `read` group would reject the canonical path
- **THEN** the system admits the canonical-path evaluation and does not evaluate the `read` group
- **AND** the first page read call of the import carries a derived `canonical` decision, and the import continues

#### Scenario: Read-only stays read-only on a process that does not enable it

- **WHEN** a worker whose `tools.permissionModes` is `["default"]` claims a Run accepted with `read-only`, and the model calls `bash`
- **THEN** the effective mode of the attempt is `read-only`
- **AND** the call gets `permission_denied` with reason `permission_mode_read_only`

#### Scenario: Read-only evaluates an admitted call as default

- **WHEN** the recommended policy is in force and a `read-only` attempt reads `/home/me/.ssh/id_ed25519`
- **THEN** F1 rejects the call with reason `explicit_reject`, as in a `default` attempt

### Requirement: Bypassed evaluations are recorded as bypass decisions

Every evaluation that `bypass` admits SHALL still produce a trusted decision recorded wherever this capability records a decision of that kind: the call decision on `tool.requested` before any `tool.started` event or executor dispatch, each derived-locator decision of a web read, and the canonical-path decision of `enter_workspace`. A bypass decision SHALL carry the executing process's policy-instance ID, the decision `allow`, the static reason `permission_mode_bypass`, and no clause reference. Because an address record is kept only for a refused address, a `bypass` attempt SHALL produce no address record. Bypass decisions SHALL follow the existing privacy rules for decision metadata: owner-scoped, excluded from model replay, public shares, exports, and search, and carried through completion, abort settlement, and durable transcript reconstruction.
The recorded decisions also include the derived `canonical` decision attached to the first page read call of an instruction import when its canonical path differs from its resolved path; it is recorded in the completion payload's derived decisions when the call settles.

#### Scenario: A bypassed call records its reason

- **WHEN** a `bypass` attempt executes a Bash call
- **THEN** its tool activity and stored tool-part metadata record `allow` with reason `permission_mode_bypass`, the process's policy-instance ID, and no clause reference
- **AND** the record is durable before the call starts

#### Scenario: A bypassed redirect hop is recorded

- **WHEN** a `bypass` attempt's web read follows a redirect
- **THEN** the hop is recorded as a derived-locator decision with reason `permission_mode_bypass`

#### Scenario: Bypass decisions survive reload privately

- **WHEN** the owner reloads a chat containing a bypassed call
- **THEN** the stored tool part retains its `permission_mode_bypass` decision
- **AND** model replay, public shares, exports, and search receive no decision metadata

#### Scenario: A bypassed instruction-import canonical path records its decision

- **WHEN** a `bypass` attempt imports an instruction file whose canonical path differs from its resolved path
- **THEN** the import's first page read call records a derived `canonical` decision with `allow`, reason `permission_mode_bypass`, the process's policy-instance ID, and no clause reference
- **AND** the completion payload records it among its derived decisions when the call settles

### Requirement: Grep scopes are admitted per scope and files per hit

The system MUST evaluate a `grep` call against the `grep` group once per
submitted scope, in scope order, before the tool opens any file. Each
evaluation uses the `grep` scope projection of `Match submitted string values
without serialization artifacts`, which the `grep-tool` capability defines. A
field clause on `scopes` MUST match the projected prefix.

Configuration validation MUST accept `scopes` as a declared field of the
`grep` group. Its schema is an array of strings, and each evaluation
substitutes one string. It is the only array-valued field that a clause can
name. An omitted `scopes` while a Workspace is entered uses the omitted-scope
exception of that requirement. The system MUST then evaluate the canonical
Workspace root as the one scope.

All-fields rejection MUST traverse `patterns`, each submitted scope, and each
projected prefix, as that requirement defines. A reject written
against a glob suffix or a pattern then still refuses. The call decision MUST
be the first rejection in scope order, or the allow of the last scope when
every scope is allowed. The system MUST record only that call decision on
`tool.requested`.

The per-file evaluation is the sixth named exception of that requirement. The
system MUST evaluate each candidate file against the `read` group. Its `path`
is the canonical locator of the file under the `read` projection of this
capability.
The system MUST NOT record these file decisions one by one. The completion
audit MUST carry the count of files the `read` group refused. The tool result
MUST NOT carry it. A bypassed Run MUST record one bypass decision for the call
and no file decision.

#### Scenario: All-fields reject sees the pattern

- **WHEN** the `grep` group has `reject: [{ allFields: true, regex: "BEGIN RSA" }]` and a pattern is `BEGIN RSA`
- **THEN** the call is refused
- **AND** no scope is searched

#### Scenario: All-fields reject sees the glob suffix

- **WHEN** the `grep` group rejects `literal: ".env"` across all fields and a scope is `/repo/**/.env`
- **THEN** the call is refused

#### Scenario: File refusals are counted, not listed

- **WHEN** the `read` group refuses 40 files beneath an admitted scope
- **THEN** `tool.requested` carries one allow decision for the call
- **AND** the completion audit reports 40 refused files and the result reports none

#### Scenario: A scopes clause passes configuration validation

- **WHEN** `tools.permissions.grep.allow` holds `{ field: "scopes", literal: "/home/u/" }`
- **THEN** worker boot succeeds

#### Scenario: An omitted scopes is evaluated as the Workspace root

- **WHEN** the Chat entered `/home/u/repo` and the model submits `grep` without `scopes`
- **THEN** the `grep` group is evaluated once with `scopes` set to `/home/u/repo/`

### Requirement: Worktree entry decides the submitted path before any probe

With `worktree`, `enter_workspace` MUST decide the submitted `path` under the
`enter_workspace` group. That decision MUST precede any filesystem probe and any
git call. A reject, or no allow, on that decision MUST refuse the call as
`permission_denied`. The call MUST NOT then create a worktree, a checkout
record, or a bound root. Under `bypass`, it MUST record that decision as a
bypass decision.

#### Scenario: A submitted path reject refuses creation

- **WHEN** the `enter_workspace` group rejects `/home/operator/src/llame`, and
  `enter_workspace` submits that path with `worktree`
- **THEN** the submitted-path decision is `reject`, and the call returns
  `permission_denied` before any filesystem probe or git call
- **AND** no `canonical` decision is recorded, and the bound Workspace root and
  its generation are unchanged

### Requirement: Worktree entry decides the canonical path before any git call

After the submitted-path decision, `enter_workspace` MUST decide the canonical
form of the submitted `path` under the `enter_workspace` group. That decision
MUST carry the `canonical` kind and its provenance. A reject, or no allow, on
either decision MUST refuse the call as `permission_denied` before any git call.
After that decision, one read-only `git.inspect` call can supply the toplevel
and the display name. No git call that writes can run before the
worktree-directory decision.

#### Scenario: A symlinked path refuses before any git call

- **WHEN** `/tmp/project` is a directory symlink to `/home/operator/.ssh`, the
  `enter_workspace` group rejects the credential path, and `enter_workspace`
  submits `/tmp/project` with `worktree`
- **THEN** the `canonical` decision uses `/home/operator/.ssh` and returns
  `reject`
- **AND** the call returns `permission_denied` before any git call, and the
  bound Workspace root and its generation are unchanged

#### Scenario: Inspection runs after the canonical decision

- **WHEN** the worktree directory needs the clone toplevel and the display name
- **THEN** one read-only `git.inspect` call runs after the canonical decision
- **AND** no git call that writes runs before the worktree-directory decision

### Requirement: Worktree entry decides the inspected main clone

After `git.inspect`, the call MUST decide the inspected main tree under the
`enter_workspace` group when that path differs from the canonical decision. For
a linked worktree the value MUST be its main worktree. That decision MUST carry
the `main_clone` kind and MUST precede every write. A reject, or no allow, MUST
refuse the call as `permission_denied`. Under `bypass`, it MUST record that
decision as a bypass decision.

#### Scenario: A rejected main clone behind an allowed subdirectory

- **WHEN** the group allows `/home/dev/src/llame/apps/` and rejects
  `/home/dev/src/llame`, and `enter_workspace` submits
  `/home/dev/src/llame/apps/web` with `worktree`
- **THEN** the `main_clone` decision uses `/home/dev/src/llame` and returns
  `reject`
- **AND** the call returns `permission_denied` before `git.worktreeAdd` and any
  write

#### Scenario: A rejected main clone behind an allowed linked worktree

- **WHEN** the group allows a linked worktree path and rejects its main clone,
  and `enter_workspace` submits that linked worktree with `worktree`
- **THEN** the `main_clone` decision uses the main clone and returns `reject`
- **AND** the call returns `permission_denied` before `git.worktreeAdd` and any
  write

### Requirement: Worktree entry decides the canonical worktree directory

The call MUST compute the worktree directory and canonicalize it by its deepest
ancestor that exists. It MUST decide that canonical locator under the
`enter_workspace` group. That decision MUST carry the `worktree_directory` kind
and its provenance. It MUST precede `git.worktreeAdd` and every write. A reject,
or no allow, on it MUST refuse the call as `permission_denied`, with no
worktree, checkout record, or bound root. Under `bypass`, it MUST record that
decision as a bypass decision.

#### Scenario: A worktree directory reject refuses creation

- **WHEN** the `enter_workspace` group rejects every path that contains
  `\.llame-worktrees/`, and `enter_workspace` submits
  `/home/operator/src/llame` with `worktree: {"name": "clear-field-0192"}` on the current Machine `devl`
- **THEN** the `worktree_directory` decision for
  `machine://devl/home/operator/src/.llame-worktrees/llame/clear-field-0192` is `reject`
- **AND** the call returns `permission_denied` before `git.worktreeAdd` and any
  write, and the bound Workspace root and its generation are unchanged

#### Scenario: A symlinked worktree parent is decided on its canonical form

- **WHEN** `/home/operator/src/.llame-worktrees` on `devl` is a directory symlink to
  `/tmp/elsewhere`, the `enter_workspace` group rejects `^machine://[^/]+/tmp/`, and
  `enter_workspace` submits `/home/operator/src/llame` with
  `worktree: {"name": "clear-field-0192"}`
- **THEN** the `worktree_directory` decision uses
  `machine://devl/tmp/elsewhere/llame/clear-field-0192` and returns `reject`
- **AND** the call returns `permission_denied` before `git.worktreeAdd`

#### Scenario: Allows on every decision create the worktree

- **WHEN** the `enter_workspace` group allows `machine://devl/home/operator/src/llame` and
  `machine://devl/home/operator/src/.llame-worktrees/`, and `enter_workspace` submits
  `/home/operator/src/llame` with `worktree: {"name": "clear-field-0192"}` on the current Machine `devl`
- **THEN** the submitted-path, `canonical`, and `main_clone` decisions for
  `machine://devl/home/operator/src/llame` record `allow` with their policy provenance
- **AND** the `worktree_directory` decision for
  `machine://devl/home/operator/src/.llame-worktrees/llame/clear-field-0192` records `allow`
  with its policy provenance
- **AND** one `git.worktreeAdd` call runs, and the Workspace binds the worktree
  directory

#### Scenario: Bypass records the worktree decisions

- **WHEN** a `bypass` attempt calls `enter_workspace` for `/home/operator/src/llame` with `worktree`, and the group rejects both paths
- **THEN** the submitted-path, `canonical`, `main_clone`, and `worktree_directory` decisions are all recorded with `allow`, reason `permission_mode_bypass`, the policy-instance ID of the process, and no clause reference
- **AND** the worktree is created

### Requirement: Worktree creation verifies the decided path

After `git.worktreeAdd`, the real path of the new directory MUST equal the
decided worktree path. A difference MUST make the call remove the new worktree
and fail as `worktree_failed`. The bound Workspace root and its generation MUST
NOT change.

#### Scenario: A realpath mismatch after creation removes the worktree

- **WHEN** `git.worktreeAdd` creates the directory and its real path differs
  from the decided path
- **THEN** the call removes the new worktree and returns `worktree_failed`
- **AND** the bound Workspace root and its generation are unchanged

### Requirement: Chat-creation path decisions are recorded with the chat

The create request MUST record each path decision in an owner-only creation
record of the chat. The record MUST hold a list of attempts. Each attempt MUST
carry its decisions and its `created_at`. Each decision MUST carry the provenance fields
of a derived decision, and that includes a `bypass` decision. Only the owner
MUST read the record through `GET /api/v1/chats/:id/creation-record`, and
another principal MUST receive 404.

#### Scenario: A bypass create records its decisions

- **WHEN** the owner creates a chat that reuses its checkout, with `bypass`
  enabled, and the group rejects both paths
- **THEN** the creation record holds the submitted-path and `canonical`
  decisions with `allow`, reason
  `permission_mode_bypass`, the policy-instance ID, and no clause reference

#### Scenario: A default-mode create records its decisions

- **WHEN** the owner creates a chat that reuses its checkout, in `default`
  mode, and the group allows both paths
- **THEN** the creation record holds the submitted-path and `canonical`
  decisions with their clause and
  policy-instance provenance

#### Scenario: A resend after a rejected decision keeps both attempts' decisions

- **WHEN** a path decision rejects the first create and the owner resends the
  same chat id
- **THEN** the creation record holds two attempts, each with its decisions and
  its `created_at`
- **AND** the first attempt keeps its rejected decision

#### Scenario: Another principal cannot read the creation record

- **WHEN** another user requests the creation record of a chat
- **THEN** the response is 404 and it discloses no decision

### Requirement: A creation attempt is appended only after a path decision

A create or resend MUST append one attempt when its Workspace step takes a path
decision. The attempt MUST commit in its own transaction, before any git write,
and it MUST stay when a later step fails. A request that fails validation,
answers 404 or 409, or resolves no location MUST append no attempt.

#### Scenario: A 422 create appends no attempt

- **WHEN** the request sets `baseRef` to `--x` and the create answers 422
- **THEN** the creation record holds no attempt and the create stores nothing

#### Scenario: A rejected decision keeps its attempt

- **WHEN** a path decision rejects and the create answers `bind_failed`
- **THEN** the creation record holds one attempt with the rejected decision
- **AND** the attempt stays after the failed step

### Requirement: Web search result removal is not native path enforcement

The rule that native path rejects are not search-result filters MUST keep its scope: native tools. The removal of `web_search` results by `read` reject clauses is a separate `web-search` behavior. It MUST NOT change a native tool decision, and a native tool MUST NOT rely on it for confinement.

#### Scenario: A read reject still refuses the read

- **WHEN** a `read` reject clause matches `https://grokipedia.com/page` and `web_search` removed that URL from its results
- **THEN** a `read` of that URL is refused as `explicit_reject`, exactly as without the search

### Requirement: Grep evaluates excluded directories against the read group

The sixth named exception also covers each directory that a `grep` walk
excludes by an ignore rule. The system MUST evaluate the `read` group on that
directory locator as written and with a final separator. The system MUST NOT
record these decisions one by one. They MUST NOT count toward the refused-file
count of the completion audit. A `bypass` attempt MUST evaluate no such directory.

#### Scenario: Directory decisions are not recorded

- **WHEN** a grep walk excludes 12 directories and the `read` group refuses 2 of them
- **THEN** `tool.requested` carries one decision for the call
- **AND** the completion audit counts no refused file for those directories

#### Scenario: A bypassed Run names every excluded directory

- **WHEN** a `bypass` attempt runs a grep walk that excludes `/home/u/repo/node_modules`
- **THEN** the system evaluates no `read` group for that directory
- **AND** `ignored.locators` holds `/home/u/repo/node_modules`

### Requirement: Artifact locators match as their logical text

For `read`, an `artifact://` locator MUST match as its submitted text with any
read selector removed. Policy matching MUST NOT see a host file path for it.
"Artifact reads evaluate each served finding" defines the finding re-check.

#### Scenario: A reject on an artifact locator refuses the read

- **WHEN** a `read` group rejects `path` with regex `^artifact://bash-` and the model reads `artifact://bash-3/stdout:1-50`
- **THEN** the matched text is `artifact://bash-3/stdout` and the reject refuses the call

#### Scenario: An allow on artifacts cannot reach another Chat

- **WHEN** a `read` group allows `^artifact://` and the model reads a locator that only another Chat has
- **THEN** the read returns `not_found`

### Requirement: Artifact reads evaluate each served finding

The sixth named exception also covers each finding that an artifact read
serves. The system MUST evaluate the `read` group on the recorded source
locator of that finding. The system MUST NOT record these decisions one by
one. They MUST NOT count toward the refused-file count of the completion
audit. A `bypass` attempt MUST evaluate no finding.

#### Scenario: Finding decisions are not recorded

- **WHEN** an artifact read serves 30 findings and the `read` group refuses 2 of them
- **THEN** `tool.requested` carries one decision for the call
- **AND** the completion audit counts no refused file for those findings

### Requirement: A read-only attempt admits only reads and plain Workspace transitions

A `read-only` attempt MUST admit a tool call only in three cases. The tool has the `read_only` classification. The call is an `exit_workspace` call. The call is an `enter_workspace` call without a `worktree` argument. The attempt MUST reject every other call. This rule applies to each MCP call. An admitted call MUST then obtain a decision from the operator policy as in `default`.

#### Scenario: Write and execution tools are rejected

- **WHEN** a `read-only` attempt calls `bash`, `edit`, or `write`, and the operator policy allows each call
- **THEN** each call gets `permission_denied` with reason `permission_mode_read_only` and does not start

#### Scenario: An MCP tool is rejected

- **WHEN** a `read-only` attempt calls an allowlisted MCP tool, and the operator policy allows it
- **THEN** the call gets `permission_denied` with reason `permission_mode_read_only` and does not start

#### Scenario: A read tool still needs the policy

- **WHEN** a `read-only` attempt calls `grep`, and the `grep` group of the operator policy has no allow
- **THEN** the call gets `permission_denied` with reason `no_allow`

#### Scenario: A read call that the policy allows executes

- **WHEN** a `read-only` attempt calls `read` for a path that the `read` group allows
- **THEN** the call executes and records `allow` with reason `matched_allow`

#### Scenario: Workspace exit is admitted

- **WHEN** a `read-only` attempt of a bound Chat calls `exit_workspace`, and the `exit_workspace` group allows the call
- **THEN** the system clears the binding

#### Scenario: Plain Workspace entry is admitted

- **WHEN** a `read-only` attempt calls `enter_workspace` for a directory that exists, without `worktree`, and the operator policy allows both paths
- **THEN** the system binds the Workspace

### Requirement: A read-only rejection is recorded before the policy is evaluated

After the system validates the call arguments, it MUST decide the read-only ceiling before any other admission step. Thus no SSH host resolution and no permission group occur for a rejected call. A rejected call MUST get the static reason `permission_mode_read_only`. The decision MUST carry the policy-instance ID of the process and no clause reference. The system MUST record it where it records a `default` call decision.

#### Scenario: The ceiling reason wins over a policy reject

- **WHEN** a `read-only` attempt calls `bash` with `git reset --hard HEAD` under the recommended policy
- **THEN** the call decision records `reject` with reason `permission_mode_read_only` and no clause reference
- **AND** the decision does not name B6, although B6 matches the command

#### Scenario: A remote command is rejected before host resolution

- **WHEN** a `read-only` attempt calls `bash` with `cwd` `ssh://devbox/repo`
- **THEN** the call gets `permission_denied` with reason `permission_mode_read_only`
- **AND** the system resolves no SSH host configuration for the call

#### Scenario: The decision survives a reload privately

- **WHEN** the owner reloads a chat that contains a call that the ceiling rejected
- **THEN** the stored tool part keeps the `permission_mode_read_only` decision
- **AND** model replay, public shares, exports, and search receive no decision metadata

### Requirement: A read-only rejection uses a fixed message

A `permission_mode_read_only` rejection MUST return a `permission_denied` result with exactly this message: `Tool call rejected before execution. This Run permits only reads and Workspace entry or exit without a worktree. Do not retry this call, disguise the same action through different commands or tools, or delegate it to another agent. In-run approval is unavailable. Continue with other permitted work; if this action is required, explain the blocked step to the user.`

#### Scenario: The rejection text is fixed

- **WHEN** a `read-only` attempt receives a `permission_mode_read_only` rejection
- **THEN** the result message is exactly the message of this requirement
- **AND** the message names no permission mode and no setting

#### Scenario: Invalid arguments are refused before the ceiling

- **WHEN** a `read-only` attempt calls `bash` with an argument that the `bash` schema rejects
- **THEN** the call gets the invalid-arguments refusal, not `permission_mode_read_only`

### Requirement: A read-only attempt rejects worktree entry

A `read-only` attempt MUST reject an `enter_workspace` call that carries a `worktree` argument. This rule applies to a host path and to a `machine://` path. The rejection MUST occur before any filesystem probe, git command, `native.attempt`, or binding change.

#### Scenario: A worktree entry changes nothing

- **WHEN** a `read-only` attempt calls `enter_workspace` with `path` `/repo` and `worktree` `{ "name": "fix" }`
- **THEN** the call gets `permission_denied` with reason `permission_mode_read_only`
- **AND** no worktree directory, git reference, checkout row, or binding change exists after the call

#### Scenario: A worktree entry to an absent directory gets the mode reason

- **WHEN** a `read-only` attempt calls `enter_workspace` with `worktree` and a `path` that does not exist
- **THEN** the call gets `permission_denied` with reason `permission_mode_read_only`, not an error for an absent directory

### Requirement: The git entry check is a named synthetic read evaluation

The git entry check of `workspace-git-state` is the seventh named exception of
the requirement on matched submitted values. It MUST evaluate the `read` group
with the git entry path as the `path` value. It is not a tool call. It MUST
record no decision of its own.

#### Scenario: The git entry path is the evaluated value

- **WHEN** the system checks the git entry `/home/dev/src/llame/.git`
- **THEN** the `read` group evaluates `/home/dev/src/llame/.git` as the `path` value
- **AND** no tool call, decision record, or tool part results

### Requirement: The git entry check obeys modes and rejects

In `read-only`, the git entry check MUST occur as in `default`. In `bypass`, the
check MUST admit the entry without evaluation. A reject clause that matches the
git entry MUST refuse the check in `default` and `read-only`.

#### Scenario: A reject clause refuses the git entry

- **WHEN** the `read` group has a reject clause `/\.git(/|$)` and the system checks `/repo/.git`
- **THEN** the check refuses in `default` and `read-only`
- **AND** the check admits in `bypass`

#### Scenario: Read-only mode keeps git state

- **WHEN** a Run in `read-only` mode starts in a bound Chat and the `read` group admits the git entry
- **THEN** the Run carries the git snapshot

### Requirement: Job locators match as their logical text

For `read`, a `job://` locator MUST match with its scheme in lower case and with any read
selector removed. Policy matching MUST NOT see a host path or a process identity for it.
Workspace projection MUST NOT change a job locator. `wait` and `stop` MUST be evaluated by their
own groups. Each entry of their `jobs` input MUST match with its scheme in lower case.

#### Scenario: An upper-case scheme does not pass a reject

- **WHEN** the `read` group rejects `^job://`, and the model reads `JOB://bash-4/stdout:1-5`
- **THEN** the policy matches `job://bash-4/stdout` and rejects the call

#### Scenario: A stop needs its own group

- **WHEN** `tools.permissions` has no group for `stop`, and the model calls `stop`
- **THEN** the call is rejected with no allow, and the job does not change

### Requirement: Project locators match their canonical logical identity

For Project locators, permission projection MUST use the resource grammar of `project-discovery`. It MUST lowercase the scheme and UUID, normalize the root alias, and remove read selectors. It MUST perform no filesystem or executor probe. Workspace projection MUST NOT change the locator. A permitted Project read MUST grant no permission for locations in its result.

#### Scenario: Case and selectors cannot bypass a reject

- **WHEN** the `read` group rejects `projects://<uuid>` and a call uses an uppercase scheme and UUID with `:raw:1-5`
- **THEN** the same canonical Project resource matches the reject
- **AND** no content access occurs

#### Scenario: Root aliases share one decision

- **WHEN** `read` receives `projects:///` or `PROJECTS://`
- **THEN** both match permission rules as `projects://`

#### Scenario: A returned location needs independent admission

- **WHEN** an admitted Project detail returns `machine://nas/srv/api`
- **THEN** subsequent file access or Workspace entry uses its own existing permission decision
- **AND** the Project read grants no Machine authority

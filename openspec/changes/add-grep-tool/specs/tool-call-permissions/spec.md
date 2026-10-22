## ADDED Requirements

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

All-fields rejection MUST traverse `patterns`, `cursor`, each submitted scope,
and each projected prefix, as that requirement defines. A reject written
against a glob suffix or a pattern then still refuses. The call decision MUST
be the first rejection in scope order, or the allow of the last scope when
every scope is allowed. The system MUST record only that call decision on
`tool.requested`.

The per-file evaluation is the sixth named exception of that requirement: the
system MUST evaluate each candidate file against the `read` group with `path`
set to its canonical locator under the `read` projection of this capability.
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
- **AND** the `grep` group is evaluated once with `scopes` set to `/home/u/repo/`

## MODIFIED Requirements

### Requirement: Match submitted string values without serialization artifacts

After validating the call schema, the evaluator SHALL match originally submitted parsed argument values, except for the native Workspace and locator projections defined below. It SHALL NOT match trusted context, inserted defaults, object keys, JSON serialization syntax, or stringified non-string values. The SDK validation adapter SHALL preserve untransformed submitted values for admission while the executor receives separately validated/defaulted arguments. A selected field SHALL match only an own top-level string property; an omitted or non-string field SHALL not match, except for an omitted `bash.cwd` while a Workspace is entered as specified below. All-fields rejection SHALL independently traverse every submitted string value in nested objects and arrays without concatenation; for a native relative `read.path`, `edit.path`, `write.path`, or `bash.cwd` field while a Workspace is entered, it SHALL inspect the projected absolute value rather than the submitted relative text.

While a Workspace is entered, for native `read`, `edit`, and `write` calls with a relative string `path`, and `bash` calls with a relative string `cwd`, the value evaluated by permissions SHALL be the absolute path obtained by resolving the relative path from the canonical Workspace root, for `read` with its split-off read selector removed after that resolution; resolution SHALL be lexical like POSIX `path.posix.resolve`, preserving a trailing separator, and `..` SHALL be allowed to leave the root. The executor SHALL receive exactly the projected absolute string, including that trailing separator. Projection SHALL NOT perform realpath resolution; symlinks inside the projected path SHALL be followed by the OS as for any absolute path. For this requirement, "relative" means a value not starting with `/` and without a `scheme:` prefix recognized by the shared locator parser or the file-alias classifier (case-insensitive `scheme://` and `file:` forms); an unknown scheme SHALL remain `invalid_path` rather than being treated as a relative local path. A `file:` alias is always absolute and is classified before this Workspace projection. The submitted relative text SHALL NOT be matched. A `bash` call that omits `cwd` SHALL be evaluated as if the canonical Workspace root had been submitted as `cwd`; this is an explicit exception to the rule that inserted defaults are not matched. This exception SHALL apply only to omitted `bash.cwd` while a Workspace is entered. Absolute paths and valid file aliases SHALL remain unchanged by Workspace path projection. `kb://`, `skill://`, and web locators SHALL remain unchanged by Workspace path projection. The `bash.command` value SHALL continue to be matched only as submitted text. For tool calls issued in the same model step as an `enter_workspace` or `exit_workspace` call, projection SHALL use the Workspace root committed before that step began; a binding change SHALL take effect from the next model step. With no Workspace entered, relative native file paths SHALL remain invalid and an omitted `bash.cwd` SHALL retain its existing process-default behavior without being matched as a submitted field.

The per-attempt Workspace binding re-check is a third named exception: it evaluates the `enter_workspace` group with the stored canonical Workspace root as the `path` field value rather than a model-submitted value. That synthetic evaluation SHALL obtain an allow and SHALL match no reject for the binding to remain valid.

A `read` call whose `path` is an `http://` or `https://` locator SHALL be
decided over two texts: the locator as submitted with any split-off read
selector removed, and the locator the shared native projection returns, which
is the text the request will use — its read selector removed, its fragment cut,
its host, port, and encoding normalized. A reject clause
matching either text SHALL refuse the call, so a spelling cannot be arranged
to miss a reject; the allow SHALL be decided on the projected text, because
an allow names the resource the call will reach and the two texts address one
resource. The evaluator itself normalizes nothing: the projection is the read
tool's own parser, so the text matched and the text requested cannot drift.
A native `read`, `edit`, or `write` call whose `path` is a valid file alias,
in either the `file://` or the minimal `file:` form, SHALL be decided over
the submitted locator and the projection's percent-decoded absolute host path,
each with its `.` and `..` segments preserved and, for `read`, with any
split-off read selector removed; an `edit` or `write` alias keeps any
selector-shaped suffix in both texts, because a mutation takes its decoded
path literally. Every text
the evaluator matches for a `read` `path`, the submitted value included,
SHALL have its split-off read selector removed and nothing else changed. The
classifier SHALL run before Workspace projection, so a valid alias is matched
as an absolute host path whether or not a Workspace is entered. A reject
matching either text SHALL refuse the call, and an allow SHALL be decided on
the projected host path. An invalid file alias SHALL remain unchanged in
projection and SHALL be refused by permission admission or by native locator
validation; the permission evaluator SHALL not turn it into a filesystem path.
Each derived locator a web read issues, meaning a
redirect hop, an announced alternate, a suffix candidate, an `llms.txt`
candidate, or an adapter request, SHALL be evaluated against the `read` group as if the model had
submitted it — a hop is a different resource, so it earns its own allow
rather than inheriting one. A hop locator is the `Location` value resolved
against the redirecting request's URL by the WHATWG URL parser and serialized
as its `href`, so it is canonical in the same way (lowercase host,
internationalized host as punycode, default port dropped, empty path as `/`,
path and query percent-escapes normalized to a fixed point with unreserved
characters decoded, fragment dropped so the matched text is the
URL the next request uses). An adapter locator SHALL be the canonical target actually requested by the
adapter, never an operator secret or an unbounded raw template. A derived
locator is decided through the same evaluator and the same projection, with no
trusted context and no relaxation carried over from the admitted call or from
an earlier derived locator, except that no read selector is removed from it:
a derived locator is chosen by a server or an adapter, carries no selector of
the model's, and is matched exactly as it will be requested, so a hop ending
in `:5` is judged with that text.

Each address a web request would connect to SHALL additionally be evaluated
against the `read` group as an address locator: the requested locator with its
host replaced by that address, as the native-file-tools address-admission
requirement defines it. An address locator SHALL be judged by reject clauses
only: a matching reject refuses that address, an evaluation that exceeds the
inspection limit refuses it as every exceeded bound rejects, an address that
no reject matches and no bound refuses SHALL be admitted even when no allow
clause matches it, and an allow
SHALL never be decided on an address locator, because an allow names the
resource a locator addresses and a domain allowlist names hosts, not the
addresses they resolve to. An address locator is decided through the same
evaluator and projection as the locator it was derived from; a call evaluated
without a compiled policy admits no address.

Known incompatible code-owned fields SHALL fail configuration validation. If an exact MCP rule targets a field absent from or incompatible with its currently admitted input declaration, the call SHALL fail closed with a safe policy diagnostic, without changing tool visibility or silently dropping the clause. This applies to both allow and reject field clauses. No field semantics SHALL be inferred from arbitrary MCP names.

Instruction-import canonical-path evaluation is a fourth named exception: when an import's canonical path differs from its resolved path, the `read` group SHALL evaluate the canonical path. The resulting decision SHALL be recorded as a derived `canonical` decision in the completion payload when the call settles, and a rejection SHALL deny that call and the import.

The silent pre-evaluation of a prompt or instruction import target before any probe SHALL record no decision of its own, because the audited `read` that follows records the call decision; in `bypass`, it SHALL admit without evaluating, like every other evaluation.

The `grep` scope projection is a fifth named exception: each evaluation of the
`grep` group SHALL see `scopes` as the one string that is the projected literal
prefix of one scope, and an omitted `scopes` while a Workspace is entered SHALL
be evaluated as the canonical Workspace root. All-fields rejection SHALL also
traverse each projected prefix, so a reject matching either the submitted scope
or its prefix refuses.

A `grep` call's per-file evaluation is a sixth named exception: the `read`
group SHALL evaluate each candidate file with `path` set to its canonical locator
under the `read` projection; these file decisions SHALL NOT be recorded one by
one.

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

- **WHEN** a valid tool call omits a schema-declared optional string field targeted by a rule outside an entered Workspace
- **THEN** that rule does not match, even if schema parsing supplies a default

#### Scenario: Dynamic schema does not contain a configured field

- **WHEN** a configured reject names `url` but the admitted MCP tool declaration only defines `query`
- **THEN** the call is rejected with a policy-configuration diagnostic rather than ignoring the reject

#### Scenario: A web locator is matched as submitted and as requested

- **WHEN** a `read` group allows `path` with regex `^https://docs\.example\.com/`
- **AND** a call submits `https://docs.example.com/guide:raw`
- **THEN** the allow matches and the call proceeds, because the submitted text is judged without its `:raw` selector
- **AND** a call submitting `https://DOCS.example.com/guide` also proceeds, because the allow is decided on the locator the request will use
- **AND** a reject naming that host refuses every spelling of it, including `https://DOCS.example.com/guide` and `https://docs%2Eexample.com/guide`, because a reject matching either the submitted text or the requested one refuses the call

#### Scenario: A redirect hop is evaluated as a submitted locator

- **WHEN** an admitted read of `https://docs.example.com/start` is answered with a redirect to `http://docs.example.com/plain`
- **AND** the `read` group rejects `^http://`
- **THEN** the hop is decided as if the model had submitted that URL
- **AND** the decision is reached before any request to the hop

#### Scenario: A hop does not inherit the call's admission

- **WHEN** the `read` group's only allow names `^https://docs\.example\.com/` and the call is admitted by it
- **AND** the response redirects to `https://other.example/guide`
- **THEN** the hop matches no allow and is rejected
- **AND** the call ends without a request to the second host

#### Scenario: An address locator is judged by rejects only

- **WHEN** a `read` group's only allow is `^https://docs\.example\.com/` and it rejects `^https?://10\.`
- **AND** `docs.example.com` resolves to `93.184.216.34`
- **THEN** the read is admitted although no allow matches `https://93.184.216.34/guide`
- **AND** when `docs.example.com` resolves to `10.0.0.5` instead, that address is refused and no connection is opened

#### Scenario: Workspace-relative read path is matched after projection

- **WHEN** the entered Workspace root is `/home/operator/project/subdirectory`, the `read` group allows the call but rejects `path` matching `(^|[/\\])\.ssh([/\\]|$|:)`, and read submits the relative path `../../.ssh/id_ed25519`
- **THEN** the permission value is `/home/operator/.ssh/id_ed25519` and the call is rejected before reading the file
- **AND** the submitted relative spelling is not matched

#### Scenario: Omitted bash cwd is matched as the Workspace root

- **WHEN** the entered Workspace root is `/home/operator/project`, Bash has a whole-tool allow with a reject for `cwd` matching `^/home/operator/project$`, and Bash submits `git status` without a `cwd`
- **THEN** the permission value for `cwd` is `/home/operator/project` and the call is rejected before execution

#### Scenario: Workspace projection does not change bash command matching

- **WHEN** a Workspace is entered, Bash has a whole-tool allow with a reject for `command` matching `^git push$`, and Bash submits `git push` with a relative `cwd`
- **THEN** the `command` reject matches the submitted command text and the call is rejected
- **AND** only `cwd`, not `command`, is projected from the Workspace root

#### Scenario: Workspace projection preserves a trailing separator

- **WHEN** a Workspace with root `/work/project` is entered and `read` submits `app.ts/`
- **THEN** the permission value and executor argument are exactly `/work/project/app.ts/`
- **AND** the call follows absolute-path semantics and returns `not_found` for a regular-file target

#### Scenario: Unknown Workspace path scheme remains invalid

- **WHEN** a Workspace is entered and `read` submits `vault://notes/a.md`
- **THEN** the call returns `invalid_path`
- **AND** it is not projected as a relative path or sent to the executor

#### Scenario: Same-step calls use the root committed before the step

- **WHEN** `/work/old` is committed before a model step that calls `enter_workspace` for `/work/new` and `read` for `f`
- **THEN** the same-step `read` permission value and executor argument use `/work/old/f`
- **AND** the `/work/new` binding applies to projections beginning with the next model step

#### Scenario: Workspace re-check matches the stored canonical root

- **WHEN** an attempt re-checks a bound Workspace before resolving its sources
- **THEN** the `enter_workspace` permission group evaluates the stored canonical root as the `path` field value
- **AND** the synthetic value must obtain an allow and match no reject for the binding to remain

#### Scenario: A minimal-form alias is matched as an absolute path in a Workspace

- **WHEN** a Workspace is entered at `/work/project`, a `read` group rejects `^/etc/`, and the model submits `file:/etc/%70asswd`
- **THEN** the classifier runs before Workspace projection, the permission value is `/etc/passwd`, and the call is rejected before reading
- **AND** a `^/work/project/` allow does not admit the alias

#### Scenario: A host-path reject catches a percent-encoded file alias

- **WHEN** a `read` group rejects `path` with regex `^/etc/` and the model submits `file:///etc/%70asswd`
- **THEN** the submitted text is inspected first and the projected `/etc/passwd` text matches the reject
- **AND** the native read is refused before filesystem access

#### Scenario: A host-path allow admits a file alias

- **WHEN** a `read` group allows `path` with regex `^/srv/docs(?:/|$)` and the model submits `file:///srv/docs/guide.md`
- **THEN** the projection matches `/srv/docs/guide.md` and the call is admitted
- **AND** the executor reads that host path rather than a URL authority

#### Scenario: A submitted file spelling can be rejected independently

- **WHEN** a `read` group rejects `path` with regex `^file://` and the model submits `file:///srv/docs/guide.md`
- **THEN** the call is rejected on the submitted text
- **AND** an equivalent `/srv/docs/guide.md` call is not rejected by that clause

#### Scenario: A policy allow does not grant a remote file authority

- **WHEN** a `read` group's only allow is `^file://` and the model submits `file://other.example/srv/docs/guide.md`
- **THEN** the projection returns the invalid alias unchanged, both texts match the allow, and permission admits the call
- **AND** native authority validation still returns `invalid_path` before filesystem access or network activity

#### Scenario: A file-form allow does not admit a valid alias

- **WHEN** a `read` group's only allow is `^file:///srv/docs/` and the model submits `file:///srv/docs/guide.md`
- **THEN** the submitted text matches but the projected `/srv/docs/guide.md` matches no allow
- **AND** the call is rejected as `no_allow` with `permission_denied`
- **AND** an allow written as `^/srv/docs/` is the form that admits the alias

#### Scenario: An invalid alias remains unchanged for permission matching

- **WHEN** a `read` group's only allow is `^/srv/docs/` and the model submits `file:///srv/docs/guide.md?`
- **THEN** projection returns the submitted text unchanged and the call is rejected as `no_allow` with `permission_denied` before native validation
- **AND** under a whole-tool allow, the same submitted locator reaches native validation and returns `invalid_path`

#### Scenario: An adapter request earns independent admission

- **WHEN** a source URL is admitted by `^https://github\.com/` but the GitHub adapter derives `https://api.github.com/repos/o/r/readme`
- **AND** the `read` group has no allow for `api.github.com`
- **THEN** the adapter request is rejected before I/O
- **AND** the source read can fall through without treating the source allow as API authority

#### Scenario: A rewrite target is decided as its derived locator

- **WHEN** an enabled rewrite turns an admitted x.com source into `https://x.pcstyle.dev/jack/status/20`
- **THEN** policy decides the canonical target before its request
- **AND** a reject for that target prevents the request while leaving generic source fallthrough available

#### Scenario: A canonical-path rejection denies an instruction import

- **WHEN** an instruction import's canonical path differs from its resolved path, the resolved path is allowed, and the `read` group rejects the canonical path
- **THEN** the rejection is recorded as a derived `canonical` decision on the import's first page read call
- **AND** the call is denied with `requested` and `completed` events but no `started` event, and the import is denied

#### Scenario: A rejected import target records one decision

- **WHEN** the silent pre-evaluation rejects a prompt or instruction import target
- **THEN** exactly one decision is recorded, the audited `read`'s decision
- **AND** the silent pre-evaluation records no decision of its own

#### Scenario: A grep scope is evaluated as its projected prefix

- **WHEN** the `grep` group allows `field: "scopes"` with `literal: "/work/project/src/"` and a call submits the scope `/work/project/src/**/*.ts`
- **THEN** the `grep` group is evaluated with `scopes` set to `/work/project/src/`
- **AND** the call is allowed

#### Scenario: Each grep candidate file is evaluated as a read locator

- **WHEN** the `grep` group allows the call and the `read` group rejects `path` matching `(^|/)\.env$`
- **AND** the walk meets the file `/work/project/.env`
- **THEN** the file contributes no passage
- **AND** `tool.requested` records the call decision only, and the completion audit counts that file as refused

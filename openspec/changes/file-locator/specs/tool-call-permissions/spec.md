## MODIFIED Requirements

### Requirement: Match submitted string values without serialization artifacts

After validating the call schema, the evaluator SHALL match originally submitted parsed argument values, except for the native Workspace path projections defined below. It SHALL NOT match trusted context, inserted defaults, object keys, JSON serialization syntax, or stringified non-string values. The SDK validation adapter SHALL preserve untransformed submitted values for admission while the executor receives separately validated/defaulted arguments. A selected field SHALL match only an own top-level string property; an omitted or non-string field SHALL not match, except for an omitted `bash.cwd` while a Workspace is entered as specified below. All-fields rejection SHALL independently traverse every submitted string value in nested objects and arrays without concatenation; for a native relative `read.path`, `edit.path`, `write.path`, or `bash.cwd` field while a Workspace is entered, it SHALL inspect the projected absolute value rather than the submitted relative text.

While a Workspace is entered, for native `read`, `edit`, and `write` calls with a relative string `path`, and `bash` calls with a relative string `cwd`, the value evaluated by permissions SHALL be the absolute path obtained by resolving the relative path from the canonical Workspace root; resolution SHALL be lexical like POSIX `path.posix.resolve`, preserving a trailing separator, and `..` SHALL be allowed to leave the root. The executor SHALL receive exactly the projected absolute string, including that trailing separator. Projection SHALL NOT perform realpath resolution; symlinks inside the projected path SHALL be followed by the OS as for any absolute path. For this requirement, "relative" means a value not starting with `/` and without a `scheme:` prefix recognized by the shared locator parser or the file-alias classifier (case-insensitive `scheme://` and `file:` forms); an unknown scheme SHALL remain `invalid_path` rather than being treated as a relative local path. A `file:` alias is always absolute and is classified before this Workspace projection. The submitted relative text SHALL NOT be matched. A `bash` call that omits `cwd` SHALL be evaluated as if the canonical Workspace root had been submitted as `cwd`; this is an explicit exception to the rule that inserted defaults are not matched. This exception SHALL apply only to omitted `bash.cwd` while a Workspace is entered. Absolute paths and valid file aliases SHALL remain unchanged by Workspace path projection. `kb://`, `skill://`, and web locators SHALL remain unchanged by Workspace path projection. The `bash.command` value SHALL continue to be matched only as submitted text. For tool calls issued in the same model step as an `enter_workspace` or `exit_workspace` call, projection SHALL use the Workspace root committed before that step began; a binding change SHALL take effect from the next model step. With no Workspace entered, relative native file paths SHALL remain invalid and an omitted `bash.cwd` SHALL retain its existing process-default behavior without being matched as a submitted field.

The per-attempt Workspace binding re-check is a third named exception: it evaluates the `enter_workspace` group with the stored canonical Workspace root as the `path` field value rather than a model-submitted value. That synthetic evaluation SHALL obtain an allow and SHALL match no reject for the binding to remain valid.

A native `read`, `edit`, or `write` call whose `path` is a valid file alias,
in either the `file://` or the minimal `file:` form, SHALL be decided over
the submitted locator and the projection's percent-decoded absolute host path,
including its trailing selector and preserved `.` and `..` segments. The
classifier SHALL run before Workspace projection, so a valid alias is matched
as an absolute host path whether or not a Workspace is entered. A reject
matching either text SHALL refuse the call, and an allow SHALL be decided on
the projected host path. An invalid file alias SHALL remain unchanged in
projection and SHALL be refused by permission admission or by native locator
validation; the permission evaluator SHALL not turn it into a filesystem path.
Each derived locator a web read issues, meaning a
redirect hop, an announced alternate, a suffix candidate, or an `llms.txt`
candidate, SHALL be evaluated against the `read` group as if the model had
submitted it — a hop is a different resource, so it earns its own allow
rather than inheriting one. A hop locator is the `Location` value resolved
against the redirecting request's URL by the WHATWG URL parser and serialized
as its `href`, so it is canonical in the same way (lowercase host,
internationalized host as punycode, default port dropped, empty path as `/`,
path and query percent-escapes normalized to a fixed point with unreserved
characters decoded, fragment dropped so the matched text is the
URL the next request uses). A derived locator is decided through the same
evaluator and the same projection, with no trusted context and no relaxation
carried over from the admitted call or from an earlier derived locator.

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
- **THEN** the allow matches and the call proceeds
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

### Requirement: File permission matching uses logical resource locators

For native Knowledge file locators, the selected `path` SHALL be projected through a shared pure parser/formatter to a canonical logical resource identity. Knowledge resources SHALL retain the Space ID and canonically encoded relative path; for Knowledge resources, configured roots and resolved host paths SHALL NOT enter policy matching. Supported Knowledge read selectors SHALL be excluded from resource matching. Direct host locators SHALL match their submitted absolute text, preserving trailing separators and selector-like suffixes without filesystem probes or realpath resolution. When a Workspace is entered, a relative direct host `path` for native `read`, `edit`, or `write` SHALL instead be resolved from its canonical root using lexical path resolution like POSIX `path.posix.resolve`, preserving a trailing separator, and policy matching SHALL use that projected absolute path; the executor SHALL receive exactly that projected string, including the trailing separator. This Workspace projection SHALL perform no filesystem probe or realpath resolution. For this requirement, "relative" means a value not starting with `/` and without a `scheme:` prefix recognized by the shared locator parser or the file-alias classifier (case-insensitive `scheme://` and `file:` forms); an unknown scheme SHALL remain `invalid_path` rather than being treated as a relative local path. `..` SHALL be allowed to resolve outside the Workspace root. Absolute direct host locators and valid file aliases SHALL remain unchanged by Workspace path projection; a file alias is always absolute and its decoded path is matched as a host path whether or not a Workspace is entered. The existing executor SHALL retain literal-path precedence over selector interpretation. The applicable Knowledge locator projection or Workspace path projection SHALL also apply when all-fields rejection visits the native `path` field. Other submitted values SHALL remain unchanged.

This logical-resource projection SHALL NOT rewrite executor arguments except that Workspace path projection SHALL pass its exact projected string as specified above; it SHALL NOT accept an invalid locator or mutation selector, change current percent-decoding rules for Knowledge, skill, or direct host locators (a web locator's escapes follow the native `read` tool's web normalization, which this projection reuses), bypass current Knowledge ownership/symlink checks, or introduce HTTP fetching. Workspace path projection SHALL resolve only relative native host paths as defined above; it SHALL leave absolute host paths, valid file aliases, Knowledge locators, skill locators, and web locators unchanged. Arbitrary MCP values SHALL not receive native locator normalization.

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

#### Scenario: A file alias is matched as an absolute path in a Workspace

- **WHEN** a Workspace is entered at `/work/project`, a permission group rejects `^/etc/`, and a call submits `file:/etc/%70asswd`
- **THEN** the classifier runs before Workspace projection and the projected permission value is `/etc/passwd`
- **AND** the call is rejected before any filesystem probe, while an allow for `^/work/project/` does not admit it

#### Scenario: A file alias selector stays outside the Workspace root

- **WHEN** a Workspace is entered at `/work/project` and a permission group allows `^/srv/docs/`, and a call submits `file:///srv/docs/guide.md:10-20`
- **THEN** the projected permission value is `/srv/docs/guide.md:10-20`
- **AND** it is not projected to `/work/project/srv/docs/guide.md`

#### Scenario: File alias projection preserves the selector

- **WHEN** a permission group allows `^/srv/docs/` and a call submits `file:///srv/docs/guide.md:10-20`
- **THEN** the projection used for the allow is `/srv/docs/guide.md:10-20`
- **AND** selector validation and host execution still apply after permission admission

#### Scenario: A reject sees decoded file URL text

- **WHEN** a permission group rejects `^/srv/private/` and a call submits `file:///srv/%70rivate/guide.md`
- **THEN** the projected text `/srv/private/guide.md` matches the reject
- **AND** no filesystem probe occurs

#### Scenario: An allow does not authorize a remote file authority

- **WHEN** a permission group's only allow is `^/srv/docs/` and a call submits `file://other.example/srv/docs/guide.md`
- **THEN** the projection leaves the locator unchanged, no allow matches, and the call is rejected as `no_allow` with `permission_denied`
- **AND** the authority is never converted into an admitted host path

#### Scenario: A minimal-form alias is projected like the authority form

- **WHEN** a permission group rejects `^/etc/` and a call submits `file:/etc/%70asswd`
- **THEN** the projected text `/etc/passwd` matches the reject and the call is refused
- **AND** no filesystem probe occurs

## MODIFIED Requirements

### Requirement: Match submitted string values without serialization artifacts

After validating the call schema, the evaluator SHALL match originally submitted parsed argument values. It SHALL NOT match trusted context, inserted defaults, object keys, JSON serialization syntax, or stringified non-string values. The SDK validation adapter SHALL preserve untransformed submitted values for admission while the executor receives separately validated/defaulted arguments. A selected field SHALL match only an own top-level string property; an omitted or non-string field SHALL not match. All-fields rejection SHALL independently traverse every submitted string value in nested objects and arrays without concatenation.

A `read` call whose `path` is an `http://` or `https://` locator SHALL be
decided over two texts: the locator as submitted, and the locator the shared
native projection returns, which is the text the request will use — its
fragment cut, its host, port, and encoding normalized. A reject clause
matching either text SHALL refuse the call, so a spelling cannot be arranged
to miss a reject; the allow SHALL be decided on the projected text, because
an allow names the resource the call will reach and the two texts address one
resource. The evaluator itself normalizes nothing: the projection is the read
tool's own parser, so the text matched and the text requested cannot drift.
A native `read`, `edit`, or `write` call whose `path` is a valid file alias, in
either the `file://` or the minimal `file:` form, SHALL be decided over the
submitted locator and the projection's percent-decoded absolute host path,
including its trailing selector and preserved `.` and `..` segments. A reject
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

- **WHEN** a valid tool call omits a schema-declared optional string field targeted by a rule
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

For native Knowledge file locators, the selected `path` SHALL be projected through a shared pure parser/formatter to a canonical logical resource identity. Knowledge resources SHALL retain the Space ID and canonically encoded relative path; configured roots and resolved host paths SHALL NOT enter policy matching. Supported Knowledge read selectors SHALL be excluded from resource matching. Direct host locators SHALL match their submitted absolute text, preserving trailing separators and selector-like suffixes without filesystem probes or realpath resolution. A valid `file://` alias SHALL be projected to its percent-decoded absolute POSIX host path without lexical dot-segment normalization while preserving a trailing selector for matching; its submitted URL is not replaced in the first admission pass. The existing executor SHALL retain literal-path precedence over selector interpretation. The same projection SHALL apply when all-fields rejection visits the native `path` field. Other submitted values SHALL remain unchanged.

This projection SHALL NOT rewrite executor arguments, accept an invalid locator or mutation selector, change current percent-decoding rules for Knowledge, skill, or direct host locators (a web locator's escapes follow the native `read` tool's web normalization, which this projection reuses), bypass current Knowledge ownership/symlink checks, or introduce HTTP fetching. A file alias with a non-local authority, query, fragment, backslash, control character, DEL, empty path, malformed or non-UTF-8 escape, encoded `/`, or NUL SHALL remain invalid even when a policy clause would otherwise allow its submitted spelling. An invalid file alias SHALL be returned unchanged by projection. Arbitrary MCP values SHALL not receive native locator normalization.

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

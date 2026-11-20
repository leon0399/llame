## ADDED Requirements

### Requirement: A path rule anchored at a bare root fails startup

A regex clause on a path parameter MUST NOT start with `^/`. The path parameters are `read`, `edit`, and `write` `path`, `grep` `scopes`, `enter_workspace` `path`, and `bash` `cwd`. Startup MUST fail and name the group, the list, and the clause index of such a clause. A literal clause stays a substring match. A reject in another spelling, such as `^\/etc\/`, loads and keeps its effect, because rejects also see the projected path.

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

#### Scenario: An all-fields reject sees the projected path

- **WHEN** an all-fields `read` reject matches `^/home/u/\.ssh/` and the model reads `.ssh/id_rsa` in a Workspace at `machine://devl/home/u`
- **THEN** the reject matches the projected path `/home/u/.ssh/id_rsa` and the call is refused

### Requirement: A path allow for one Machine does not admit another Machine

The evaluator MUST decide an allow for a path parameter on the canonical locator, with the Machine name. A rule that names one Machine MUST NOT admit the same path on another Machine.

#### Scenario: An allow for one Machine does not widen to another

- **WHEN** the `read` group only allows `path` with regex `^machine://devl/home/leo/proj(/|$)` and the Chat is bound to `machine://gpu/home/leo/proj`
- **AND** the model reads `/home/leo/proj/README.md`
- **THEN** the call is denied as `no_allow` for `machine://gpu/home/leo/proj/README.md`

## MODIFIED Requirements

### Requirement: Match submitted string values without serialization artifacts

After the evaluator validates the call schema, it MUST match the parsed argument values as submitted, except for the native Workspace and locator projections below. It MUST NOT match trusted context, inserted defaults, object keys, JSON serialization syntax, or non-string values converted to strings. The SDK validation adapter MUST keep the submitted values unchanged for admission, and the tool receives separately validated arguments with their defaults. A selected field MUST match only an own top-level string property.

An omitted or non-string field MUST NOT match, except for an omitted `bash.cwd` while a Workspace is entered. All-fields rejection MUST examine every submitted string value in nested objects and arrays separately, without concatenation. For a native path parameter, all-fields rejection MUST examine the projected path and the canonical locator in place of the submitted bare or relative text.

Native `read`, `edit`, and `write` `path` values, `enter_workspace` `path` values, and `bash` `cwd` values MUST project to a canonical `machine://` locator on the current Machine. An absolute path `p` projects to `machine://<name>p`. The projected path is `p` itself. While a Workspace is entered, a relative path MUST first resolve from the canonical Workspace root. Resolution MUST be lexical like POSIX `path.posix.resolve`, it MUST keep a trailing separator, and `..` can leave the root.

For `read`, the evaluator MUST remove the split-off read selector after resolution. The tool MUST receive exactly the projected path, with that trailing separator. Projection MUST NOT resolve symbolic links. The OS follows symbolic links in the projected path as for any absolute path.

Here, a relative value does not start with `/`. It also has no `scheme:` prefix that the shared locator parser or the `file:` classifier knows. An unknown scheme MUST stay `invalid_path` and MUST NOT become a relative path. A `file:` locator is always absolute, and the classifier runs before Workspace projection. A reject clause MUST match the projected path or the canonical locator, and either match refuses the call. An existing reject written against a bare path thus keeps its effect on every Machine. An allow clause MUST match only the canonical locator.

The evaluator MUST evaluate a `bash` call that omits `cwd` while a Workspace is entered as if it submitted the canonical Workspace root as `cwd`. This is the one exception to the rule that inserted defaults are not matched. `kb://`, `skill://`, and web locators MUST stay unchanged by Workspace projection. The evaluator MUST match `bash.command` only as the submitted text.

Calls in the same model step as an `enter_workspace` or `exit_workspace` call MUST project with the Workspace root that was committed before that step. A binding change MUST take effect from the next model step. With no Workspace entered, a relative native file path MUST stay invalid. An omitted `bash.cwd` then keeps its existing default behavior, and the evaluator MUST NOT match it as a submitted field.

The per-attempt re-check of the Workspace binding is a third named exception. It evaluates the `enter_workspace` group with the stored canonical Workspace root as the `path` value, not a value that the model submitted. That evaluation MUST get an allow and MUST match no reject, or the binding becomes invalid.

The evaluator MUST decide a `read` call whose `path` is an `http://` or `https://` locator over two texts. The first is the submitted locator without its split-off read selector. The second is the locator that the shared native projection returns. That is the text that the request uses, without its read selector and fragment, with a normalized host, port, and encoding. A reject clause that matches either text MUST refuse the call, so no spelling can miss a reject.

The evaluator MUST decide the allow on the projected text, because an allow names the resource that the call reaches. The evaluator itself normalizes nothing. The projection is the parser of the `read` tool, so the matched text and the requested text cannot differ.

The evaluator MUST decide a native `read`, `edit`, or `write` call whose `path` is a valid `file:` or `machine://` locator over two texts. The first is the submitted locator. The second is the canonical `machine://` locator with its path decoded once. Both texts MUST keep their `.` and `..` segments.

For `read`, both texts MUST lose a split-off read selector. For `edit` and `write`, both texts MUST keep a suffix that looks like a selector, because a mutation takes its decoded path literally. The `file:` classifier MUST run before Workspace projection. The evaluator thus matches a valid `file:` locator as an absolute path on the current Machine in every case. A reject that matches either text MUST refuse the call.

The evaluator MUST decide an allow on the canonical locator. An invalid `file:` locator MUST stay unchanged in projection. Permission admission or native locator validation MUST then refuse it, and the evaluator MUST NOT turn it into a filesystem path.

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

The `grep` scope projection is a fifth named exception. Each evaluation of the `grep` group MUST see `scopes` as one string: the projected literal prefix of one scope. A host scope prefix MUST project to its canonical locator on the current Machine. While a Workspace is entered, the evaluator MUST evaluate an omitted `scopes` as the canonical Workspace root. All-fields rejection MUST also examine each projected prefix, so a reject that matches the submitted scope or its prefix refuses.

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

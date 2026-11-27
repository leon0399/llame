# Worktree copy authorization

## ADDED Requirements

### Requirement: Worktree creation authorizes the selected environment copy

The admitted Worktree creation MUST authorize the manifest read and selected
file copies as one operation. The system MUST NOT apply separate `read`,
`edit`, or `write` permission decisions to those files. Their groups and
allowlist entries MUST NOT cause a skip or refusal of the copy. Machine roots,
OS access, and Worktree creation gates MUST still apply.

#### Scenario: A read-rejected environment file still copies

- **WHEN** Worktree creation is admitted and the manifest selects `.env`
- **AND** the `read` group rejects the source `.env`
- **THEN** the copy includes `.env` without a separate read decision
- **AND** the operation returns no file contents

#### Scenario: No file-write tool is required

- **WHEN** Worktree creation is admitted and `write` is absent from the tool allowlist
- **THEN** selected file copies can complete without a `write` call

#### Scenario: Later reads use destination permissions

- **WHEN** a copied `.env` has a destination that the `read` group allows
- **AND** the source `.env` has a path that the `read` group rejects
- **THEN** a later admitted `read` can return the destination contents
- **AND** a read rejection that also covers the destination still refuses that later call

### Requirement: A derived copy source root needs Worktree entry admission

If inspection reports a selected Checkout root whose locator differs from both the
canonical decision and the `main_clone` decision, the system MUST decide that root
as a derived decision of kind `copy_source` under the `enter_workspace` group
before the copy accesses it, and before Worktree add. When the root equals either
locator, that existing decision MUST cover it and no `copy_source` decision MUST
be recorded. This MUST NOT substitute the main Checkout's root for the selected
Checkout's root. A rejection, or no allow, MUST refuse the call as
`permission_denied` and prevent the copy and Worktree add. Under `bypass`, it MUST
record the decision as a bypass decision.

#### Scenario: An allowed subdirectory does not authorize a rejected root

- **WHEN** a source subdirectory of a linked Worktree is admitted but its selected Checkout root is rejected
- **THEN** the `copy_source` decision uses that root and returns `reject`
- **AND** creation fails before manifest access and before Worktree add

#### Scenario: An existing decision covers an equal root

- **WHEN** the selected Checkout root equals the canonical or `main_clone` locator
- **THEN** no `copy_source` decision is recorded

#### Scenario: Bypass records the copy source decision

- **WHEN** a `bypass` attempt creates a Worktree from a subdirectory of a linked Worktree and the group rejects its root
- **THEN** the `copy_source` decision is recorded with `allow`, reason `permission_mode_bypass`, the policy-instance ID of the process, and no clause reference
- **AND** the copy proceeds

### Requirement: Aggregate copy authority does not bypass creation refusal

A refused Worktree creation MUST NOT read its manifest or copy files. A model
attempt in `read-only` mode MUST still refuse Worktree creation. An
owner-started Chat creation in `read-only` mode MUST retain its existing entry
rules and can copy selected files after admission.

#### Scenario: A rejected destination prevents all copying

- **WHEN** the `enter_workspace` group rejects the new Worktree directory
- **THEN** no manifest read, file copy, or Worktree add starts

#### Scenario: Model read-only mode rejects the mutation

- **WHEN** a model in `read-only` mode requests a Worktree
- **THEN** the existing mode gate refuses the request before any copy

#### Scenario: Owner read-only creation seeds the environment

- **WHEN** the owner creates a Chat in enabled `read-only` mode with an admitted Worktree request
- **THEN** the Worktree receives its selected files before the first Run

## MODIFIED Requirements

### Requirement: Match submitted string values without serialization artifacts

After the evaluator validates the call schema, it MUST match the parsed argument values as submitted, except for the native Workspace and locator projections below. It MUST NOT match trusted context, inserted defaults, object keys, JSON serialization syntax, or non-string values converted to strings. The SDK validation adapter MUST keep the submitted values unchanged for admission, and the tool receives separately validated arguments with their defaults. A selected field MUST match only an own top-level string property.

An omitted or non-string field MUST NOT match, except for an omitted `bash.cwd` while a Workspace is entered. All-fields rejection MUST examine every submitted string value in nested objects and arrays separately, without concatenation. For a native path parameter, all-fields rejection MUST also examine the projected path and the canonical locator.

Native `read`, `edit`, and `write` `path` values, `enter_workspace` `path` values, and `bash` `cwd` values MUST project to a canonical `machine://` locator. An absolute path `p` projects to `machine://<name>p` on the current Machine. The projected path of every Machine value is its decoded absolute path without the scheme and the Machine name. This holds for a bare path, a `file:` locator, a `machine://` locator, a `grep` scope prefix, and each derived or stored value: a canonical root, a main clone, a copy source, a worktree directory, and the re-checked Workspace root. While a Workspace is entered, a relative path MUST first resolve from the canonical Workspace root. Resolution MUST be lexical like POSIX `path.posix.resolve`, it MUST keep a trailing separator, and `..` can leave the root.

For `read`, the evaluator MUST remove the split-off read selector from the
texts it matches, after resolution. The tool MUST keep the selector as the
window of the read, and MUST reach the resolved path. That path MUST keep its
trailing separator. Projection MUST NOT resolve symbolic links. The OS follows
symbolic links in the projected path as for any absolute path.

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

### Requirement: A Run's effective permission mode selects whether the policy is evaluated

Each execution attempt MUST have one effective permission mode. The system MUST resolve it once, when the attempt is claimed. The effective mode is `bypass` when the Run has the accepted mode `bypass` and the executing process enables `bypass` in `tools.permissionModes`. The effective mode is `read-only` when the accepted mode of the Run is `read-only`, on every process. The effective mode is `default` in all other cases. A Run accepted with `bypass` on a process that does not enable `bypass` MUST execute in `default`.

In `default`, each requirement of this capability MUST apply without change.

In `read-only`, each evaluation of a permission group MUST occur exactly as in `default`. The read-only requirements of this capability add a ceiling before the call evaluation. The ceiling MUST NOT change any group evaluation.

In `bypass`, the system MUST NOT evaluate a permission group for that attempt at any point where this capability evaluates one. These points include the per-call admission of submitted and projected arguments. They also include each derived locator of a web read and each resolved web address. They also include the submitted and canonical paths of `enter_workspace`, the derived `copy_source` decision of Worktree creation, and the per-attempt Workspace binding re-check. The system MUST admit each of those evaluations as an allow. In that attempt, this capability MUST NOT refuse anything through a group match, the reject veto, the no-allow rejection, or the invalid-field rejection. The same applies to the inspection-bound rejection, the omitted-policy rejection, and the recommended reject list. This capability MUST NOT produce a `permission_denied` result in that attempt.
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

Every evaluation that `bypass` admits SHALL still produce a trusted decision recorded wherever this capability records a decision of that kind: the call decision on `tool.requested` before any `tool.started` event or executor dispatch, each derived-locator decision of a web read, the canonical-path decision of `enter_workspace`, and the derived `copy_source` decision of Worktree creation. A bypass decision SHALL carry the executing process's policy-instance ID, the decision `allow`, the static reason `permission_mode_bypass`, and no clause reference. Because an address record is kept only for a refused address, a `bypass` attempt SHALL produce no address record. Bypass decisions SHALL follow the existing privacy rules for decision metadata: owner-scoped, excluded from model replay, public shares, exports, and search, and carried through completion, abort settlement, and durable transcript reconstruction.
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

#### Scenario: A bypassed copy source records its decision

- **WHEN** a `bypass` attempt creates a Worktree from a subdirectory of a linked Worktree
- **THEN** the `copy_source` decision is recorded with `allow`, reason `permission_mode_bypass`, the process's policy-instance ID, and no clause reference

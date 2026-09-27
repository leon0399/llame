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
Each derived locator a web read issues, meaning a
redirect hop, an announced alternate, a suffix candidate, an `llms.txt`
candidate, or an adapter request, SHALL be evaluated against the `read` group
as if the model had submitted it — a hop is a different resource, so it earns
its own allow rather than inheriting one. A hop locator is the `Location` value
resolved against the redirecting request's URL by the WHATWG URL parser and
serialized as its `href`, so it is canonical in the same way (lowercase host,
internationalized host as punycode, default port dropped, empty path as `/`,
path and query percent-escapes normalized to a fixed point with unreserved
characters decoded, fragment dropped so the matched text is the
URL the next request uses). An adapter locator SHALL be the canonical target
actually requested by the adapter, never an operator secret or an unbounded
raw template. A derived locator is decided through the same evaluator and the
same projection, with no trusted context and no relaxation carried over from
the admitted call or from an earlier derived locator.

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

#### Scenario: An adapter request earns independent admission

- **WHEN** a source URL is admitted by `^https://github\.com/` but the GitHub adapter derives `https://api.github.com/repos/o/r/readme`
- **AND** the `read` group has no allow for `api.github.com`
- **THEN** the adapter request is rejected before I/O
- **AND** the source read can fall through without treating the source allow as API authority

#### Scenario: A rewrite target is decided as its derived locator

- **WHEN** an enabled rewrite turns an admitted x.com source into `https://x.pcstyle.dev/jack/status/20`
- **THEN** policy decides the canonical target before its request
- **AND** a reject for that target prevents the request while leaving generic source fallthrough available

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
address SHALL NOT produce a record. One record SHALL be kept per distinct
refused address and decision per call, and at most 16 `address` records per
call, the first 16 in order, under a bound of their own, so address records
never displace the records of hops and probe candidates. Adapter records
SHALL be bounded by the eight-request adapter budget and SHALL never displace
the submitted call decision.

A rejected otherwise valid call SHALL return `status: "error"`, `type: "permission_denied"`, and the code-owned message selected by the static decision reason below. It SHALL produce no tool effect or native attempt, no automatic retry, no approval request, and no permission-caused Run termination. A redirect hop rejected after the call
was admitted SHALL end that call before the hop's body is read, returning
`status: "error"` and `type: "permission_denied"` with the fixed hop message
below and a `rejectedUrl` result field carrying the hop locator's origin and
path (query and fragment removed) bounded to 2,048 characters with control
characters removed, and SHALL produce no
further request, no automatic retry, no approval request, and no permission-
caused Run termination. A request whose every address is refused, whether
resolved or given as an IP literal, SHALL NOT be issued; on the call's own
request chain it SHALL end the call with `status: "error"` and `type:
"permission_denied"` with the fixed refused-address message below, a refused
hop carrying `rejectedUrl` as a hop rejection does, and no result field or
message SHALL carry an address the host resolved to. A refused adapter
request SHALL not produce a model-visible error body: its decision is stored,
its bounded failure note is attached to adapter fallthrough, and the next
adapter or ladder candidate may run. The model SHALL observe the
error and continue subject to existing Run limits. The decision SHALL be
durably recorded on `tool.requested` before any `tool.started` event or
executor dispatch, and carried through completion, abort settlement, and
durable transcript reconstruction into stored tool-part metadata. Required
decision persistence failure SHALL prevent execution and follow the existing
infrastructure-failure path.

The model-visible message SHALL use one of these fixed templates. It SHALL NOT interpolate rule text, matching fragments, field names, private paths, operator-authored explanations, clause references, policy IDs, or secret
values; the rejected hop locator travels in the separate `rejectedUrl` field,
never inside the message. The static reason explanation is deliberately model-
visible; the separate diagnostic metadata remains excluded from model context.
These instructions guide model behavior and SHALL NOT be represented as an
enforced sandbox or an equivalence detector. Every later submitted call still
receives its own admission decision.

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
- **AND** the target URL, service headers, token, and matched secret are absent from model-visible output and stored provenance
- **AND** the adapter falls through without a model-visible status body

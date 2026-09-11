## Context

See [proposal.md](proposal.md) for scope and the confirmed pre-drafting decisions.

`tools.allowed` already filters exact code-owned tools and configured MCP namespaces into immutable Run catalogs. `runTool` in `apps/api/src/tools/runner.ts` validates trusted owner context and tool arguments before invoking an executor. Native file mutations and Bash persist pre-effect attempts and refuse replay after uncertain outcomes. MCP rechecks declaration identity and transport availability. None of these boundaries is replaced.

Threats are model-controlled arguments widening authority, a harmless argument authorizing a different resource, policy parsing or regex causing denial of service, hidden policy data entering model context, and retries executing under an incorrectly assumed policy revision.

## Goals / Non-Goals

Define a deterministic call gate with readable operator configuration and independent execution provenance. Keep the evaluator source-neutral and small; native locator interpretation remains owned by the native file contract.

This is not command containment. An allowed interpreter retains its executor's authority. A denied native read does not constrain a separate Bash call. The proposal's non-goals remain binding, including no tool hiding from permission rules.

## Decisions

### D1: A closed configuration grouped by exact tool identity

Add optional `tools.permissions`, defaulting to the explicit built-in map in D8. A supplied map replaces that entire map; `{}` explicitly denies every call. There is no implicit deep merge or append. Keys are exact registered code-owned IDs or exact canonical IDs for configured MCP servers. No new tool-name wildcard language is added; operators may still use namespace wildcards in `tools.allowed`, but each executing tool needs its own permission group. This prevents a newly discovered MCP tool from acquiring call permission merely through namespace membership.

Each group has optional `allow` and `reject` values, each either `true` (whole-tool match) or an array of clauses. Omitted values and empty arrays do not match; `false` is invalid. A clause contains exactly one of `literal` or `regex`, plus exactly one target: `field` or `allFields: true`:

- `field` is one literal, top-level argument property name, not JSONPath or a nested expression. Its value must be a string to match. Missing, null, boolean, numeric, object, and array values do not match.
- `allFields: true` explicitly selects all submitted string values recursively, including arrays and nested objects, and is valid only under `reject`. A missing target, both targets, or `allFields: false` is invalid.
- One selected value matching a reject is sufficient. Values are never concatenated, stringified from non-strings, or mixed with object keys or JSON syntax.
- Clauses are OR alternatives. There are no condition conjunctions or child-rule exceptions.
- For known code-owned schemas, invalid field names or fields that cannot be strings fail startup. A dynamic MCP field is checked against its admitted declaration before execution; absent/incompatible declaration fields cannot grant an allow, and an invalid configured field makes that call fail closed with a policy-configuration diagnostic. This check does not alter catalog visibility or recompile the policy.

Example `tools` fragment (replace the illustrative Space ID with an owned Space). It assumes an already configured `docs` MCP server and the native capability needed for Bash; their existing configuration is omitted:

```json
{
  "tools": {
    "allowed": ["bash", "read", "write", "mcp__docs__fetch"],
    "permissions": {
      "bash": {
        "allow": true,
        "reject": [{ "field": "command", "literal": "git push" }]
      },
      "read": {
        "allow": [{ "field": "path", "regex": "^kb://SPACE/notes/" }]
      },
      "write": {
        "allow": [{ "field": "path", "regex": "^kb://SPACE/notes/" }],
        "reject": [{ "allFields": true, "literal": "PRIVATE_MARKER" }]
      },
      "mcp__docs__fetch": { "allow": true }
    }
  }
}
```

No match rejects, including an absent permission group. Permission `allow: true` does not add a tool to `tools.allowed`, satisfy its classification, admit a missing executor, or grant access to another owner's resources. `reject: true` rejects every attempted call but leaves visibility entirely to the existing availability logic.

### D2: Literal search plus bounded explicit regex

Literal matching is case-sensitive substring search. Metacharacters remain literal. Only values selected from the native Bash tool's `command` field use whitespace-flexible literals, including when an all-fields reject visits that field. Escape non-whitespace text and replace each maximal run of whitespace in the literal with a one-or-more whitespace matcher equivalent to ECMAScript `\s+`. Use a fixed character class covering tabs/newlines, space, U+00A0, U+1680, U+2000-U+200A, U+2028-U+2029, U+202F, U+205F, U+3000, and U+FEFF; do not assume RE2's narrower `\s` class is equivalent. Do not trim either side or interpret quotes, escapes, comments, operators, variables, wrappers, or shell syntax. Bash `cwd` and `env` values retain exact whitespace like other fields.

Regex is case-sensitive, unanchored search unless the expression supplies anchors. It receives the selected string as-is after the native locator projection below. Do not rewrite regex whitespace. Select the pure-JavaScript `re2js` engine with its default RE2 syntax and no opt-in lookbehind extension. Backreferences and unsupported constructs fail compilation; never fall back to native backtracking `RegExp`. No separate flags setting is introduced; operator documentation names supported inline regex flags and syntax.

Keep structural config validation synchronous in `loadInstanceConfig`. Add an awaited policy-provider factory that resolves code-owned schemas through `resolveJsonSchema`, validates configured fields, compiles patterns, and freezes the policy. API startup and worker consumption must depend on this provider resolving successfully; do not rely on ordering between unrelated module-init hooks. No network discovery is required to validate configured MCP identities. Compile once before serving requests or claiming jobs. Bound the policy to 1,024 clauses, each pattern to 4,096 UTF-8 bytes, and group count to 256. A whole-tool boolean counts as one clause. Bound per-call matching to 1 MiB of selected UTF-8 string content, 65,536 visited values, and 64 nested container levels. These are code-owned limits, not new configuration knobs. Exceeding an input traversal/matching limit rejects the call without partial matching or execution, even if an allow was found earlier. Match all required rejects before granting. Implementation must validate the package's syntax and worst-case matching behavior against these limits.

Regex provides anchors and alternatives without introducing glob, prefix, or expression-tree languages. The [RE2JS documentation](https://github.com/le0pard/re2js) describes linear-time matching and unanchored search; no upstream tests were run during this proposal.

### D3: Logical locator projection is local to file tools

For native `read`, `edit`, and `write`, use a pure logical locator projection before matching. Extract the existing Knowledge parser/formatter into a shared helper rather than duplicating encoding logic; preserve empty Space roots and the current colon/percent-decoding rules. For Knowledge, use the canonical `kb://<space-id>/<encoded-relative-path>` identity, encoded once with the existing locator formatter. Exclude read selectors from this resource identity; ranges and raw display modes do not change file permission. Keep the Space ID and logical path, never the configured root or resolved host path. Do not resolve filesystem backing paths merely to evaluate policy.

For direct native host paths, match the submitted absolute locator text exactly, including trailing separators and selector-like suffixes. The shipped resolver probes a literal path before interpreting a missing path as a selector: `/tmp/file:1-2` can be a real filename. A pure admission gate cannot determine that filesystem-dependent distinction. Therefore it must not strip host selectors or claim filesystem identity normalization. An anchored allow for `/tmp/file` does not also allow `/tmp/file:1-2`; operators can explicitly allow the additional submitted locator. This remains host-user authority. Invalid locators fail through the existing native validation contract before any effect; policy cannot make an invalid scheme or mutation selector executable.

All-fields rejection sees the same projected `path` value and the other submitted string values. Do not rewrite the arguments sent to the tool. Arbitrary MCP arguments remain literal strings: no field-name guessing, URL parsing, percent decoding, shell parsing, or inferred filesystem access. HTTP is a later resource capability, not a new native read scheme here.

### D4: One mandatory gate before invoking any executor

Inject the immutable process policy through trusted executor dependencies, never model arguments or caller-selected user IDs. Enforce it inside the common `runTool` admission path after identity and schema checks and before `tool.execute`, MCP dispatch, or native attempt creation. Match originally submitted, parsed argument values after successful schema validation, not schema-inserted defaults or trusted context fields. Preserve original parsed input at the SDK schema adapter: validate a separate copy, return the untransformed original value on success, and keep declarations unchanged. `runTool` validates separately and retains its parsed/defaulted executor arguments apart from the submitted permission input. Do not recover originals by deleting default-valued properties or depend on streamed tool-call callback ordering. Direct callers provide original input to that same runner boundary. Test a schema with a string default and a string transform through the real SDK execution path: neither may replace the submitted matching value. Property lookup uses own properties only. Direct runner callers must supply the same trusted policy dependency; absence cannot bypass the gate.

The decision algorithm is: check all applicable rejects and input limits; reject if any matches or evaluation cannot complete safely; otherwise allow if the whole-tool allow or any field allow matches; otherwise reject. Existing cancellation, invalid-input, and unavailable-executor behavior remains applicable; this change does not convert every failure into a permission error.

Rejected calls produce the stable model-visible result:

```json
{
  "status": "error",
  "type": "permission_denied",
  "message": "Tool call rejected by operator permissions."
}
```

Do not invoke the tool, create a native attempt, automatically retry the rejection, prompt for approval, or terminate the Run because of this result. Continue through existing tool observations and step limits. A later explicitly requested call is independently checked. A failure of required event persistence remains an infrastructure failure, not a permission rejection.

### D5: Process policy identity is separate from immutable model context

Generate an opaque policy-instance ID with `crypto.randomUUID()` after successful policy compilation. Freeze the compiled policy and ID for the process lifetime. The ID is independent of policy contents, including interpolated secrets; never expose a deterministic digest of those contents. Restarts and separate processes receive different IDs even with identical configuration. This identifies the actual executor policy instance, not content equality across processes. Do not put rules or their ID into the effective system prompt, tool declarations, availability manifest, or model-context snapshot hash.

At each new executor attempt, use that executor's current process policy, even when the Run predates its startup. A configuration edit without restart has no effect. All API/co-located/dedicated-worker processes must load the same intended configuration when operators restart the installation; this slice adds no cross-process reload coordinator. Mixed-version/mixed-policy operation is unsupported for applying an installation-wide change. Record actual policy identity so an inconsistent rollout is diagnosable.

Extend existing owner-scoped tool activity and stored tool-part metadata with a trusted `permission` record containing `policyId`, `decision`, a static reason (`explicit_reject`, `no_allow`, `invalid_field`, `input_limit`, or `matched_allow`), and deterministic matching clause references (group ID, decision list, array index; booleans use a fixed whole-tool reference). Store at most the first matching reject or allow, using sorted group identity and configured clause index for diagnostic selection; order never changes the decision.

Move the current wrapper-level `tool.started` emission behind admission. Add an awaited runner admission callback carrying the trusted decision; the Run wrapper records it on `tool.requested`, awaits the serialized durable write, checks persistence failure, and only then records/flushes `tool.started` for an allowed call and permits dispatch. Apply this ordering to every executor, not only host capabilities. A failed required write prevents dispatch. Invalid/unavailable calls retain their existing request/completion behavior without a fabricated permission decision. Carry `permission` through the open-call map, completion/abort settlement, assistant part collector, and `assistant-transcript.ts` reconstruction from `tool.requested` to `toolActivityPart`, including recovery of a request whose completion was interrupted. Persist the decision before invoking an allowed executor through the existing tool-activity write path; a rejected call records requested/completed activity without pretending an executor started. Mirror the safe metadata on the stored tool part so history does not depend on indefinite Run-event retention. Extend the typed part/event contracts explicitly and strip this metadata from model replay, public shares, exports, and search. Do not store matched input fragments, patterns, resolved config secrets, or host-path diagnostics in this record. Existing tool output remains unchanged apart from the new rejection result.

This may require owner-facing type/generated-client updates, but no new UI or endpoint. Existing owner tool records remain the inspection surface. Record the policy ID once in private startup diagnostics alongside the evaluator version, without policy values, so the operator can correlate it with that process and deployment; the owner sees a bounded decision, not the private rule text.

### D6: Restart does not rewrite execution history

A queued call that has not executed uses the restarted worker's new policy. Already persisted tool observations are replayed without reauthorization or replacement. Preserve the existing Run-level native recovery check before model execution: a prior native mutation/command can make the recovered Run stop with `outcome_unknown`, without a new permission decision. Do not add per-call resumption or known-result recovery. Previously recorded outcomes remain historical observations; a new deny must not conceal an earlier uncertain effect. Only a genuinely new invocation reaches the permission gate. Allowed read-only retries can repeat under existing rules, but must pass the restarted process's policy first.

### D7: Prior-art choices and rejected alternatives

- OpenCode V2's ordered `action/resource/effect` shape is compact, but last-match precedence permits later allows to override rejects. The confirmed llame contract instead uses grouped deny-veto rules. [V2 documentation](https://opencode.ai/v2/docs/permissions).
- OpenCode changed absolute/relative path matching, demonstrating why the resource basis must be explicit. Use llame's existing logical locator parser, not an unrelated relative-path convention. [Path-matching fix](https://github.com/anomalyco/opencode/commit/d335b04b764c50c73568fdb94a227a62b6c26ee7).
- OMP fixed a quoting-related compound-approval bypass by restricting its parser to known POSIX shells. llame deliberately adds no shell parser in this cut. [Fix](https://github.com/can1357/oh-my-pi/commit/adf68c990496c265b1dba92b8f3111ff3455321b).
- OpenClaw corrected durable approvals that omitted cwd/argument binding. Those approval mechanics belong to #778; here the actual submitted fields and process policy are evaluated at each new call. [Cwd fix](https://github.com/openclaw/openclaw/commit/1c37c8cdc71bd2738b35bb5c433b3d545e040501).
- Claude Code limits generic parameter allows, and both Claude Code and Codex expose programmable whole-input checks through hooks. A built-in bounded string matcher meets this request without adding a general hook runtime. [Claude rules](https://code.claude.com/docs/en/permissions#match-by-input-parameter), [Codex hooks](https://learn.chatgpt.com/docs/hooks#pretooluse).

### D8: Portable defaults and local-only policy

The source image supplies examples of destructive host operations, not a complete permission model. The inspected `~/.claude/settings.json` mixes credential protection with one operator's developer tools, MCP servers, personal instruction files, and workflow preferences. These inform the following default map; neither source's syntax is imported. Sources: [provided image](https://pbs.twimg.com/media/HReP41pbsAA6Bdz?format=png&name=900x900), local permission settings inspected on 2026-09-11, and [Claude's documented settings shape](https://code.claude.com/docs/en/settings). The local nested `permissions.read`/`permissions.write` blocks are treated as stated intent, not evidence of effective enforcement by that installation.

Only these seven current code-owned tools receive built-in groups: `bash`, `read`, `edit`, `write`, `knowledge_search`, `search_conversations`, and `conversation_read`. Each group has `allow: true`; file groups and Bash add the rejects below. No current/future MCP tool or future code-owned tool acquires an implicit group. `tools.allowed` still defaults to empty, and native authority/owner checks remain mandatory. Enabling Bash therefore deliberately admits arbitrary host commands except the listed textual rejects; these defaults catch common mistakes and do not restrict Bash to a safe command subset.

A supplied `tools.permissions` map replaces the complete built-in map. This avoids hidden inheritance and makes `{}` an explicit reject-all policy. Operators customizing one group must copy every other group they want to retain; examples must say this clearly. Built-in rejects are replaceable operator defaults, not a mandatory tier.

The [portable policy requirement](specs/tool-call-permissions/spec.md#requirement-portable-built-in-policy-with-explicit-replacement) owns the exact B1-B8/F1-F4 default rules. They are compile-time constants; operator JSON examples must escape backslashes and opening interpolation braces appropriately.

F1-F3 protect explicit credential locations from native reads and mutations. F4 covers common secret-bearing environment files on reads; editing environment configuration remains available because deployment work needs it. Rules apply to logical Knowledge locators and submitted absolute host locators. They do not inspect private Knowledge backing paths, enumerate hidden files inside a directory listing, filter search excerpts, or prevent Bash from accessing those files. `knowledge_search` is owner-scoped retrieval; file-call rules do not become an implicit indexing policy. A future content-exclusion capability would need its own enforcement.

B1 and B4-B5 cover host administration across common operating systems; including macOS command spellings introduces no macOS dependency. B2 targets obvious root/home recursive removal rather than every `rm -rf`, preserving ordinary build cleanup. B3 targets device writes rather than every use of `dd`. B8 covers the common download-pipe-to-shell spelling. None parses shell syntax: reordered options, wrappers, expansions, aliases, or alternate encodings can evade a textual rule. Quoted mentions can also match. Explicit regex whitespace follows D2's engine syntax; literal defaults receive Bash whitespace flexibility.

The capability spec owns the acceptance/rejection matrix. During proposal validation, RE2JS 2.8.6 compiled all eight regex defaults and passed 25 representative acceptance/rejection checks in a disposable environment; repository dependencies remain unchanged. Literal matcher behavior remains covered by the implementation tasks.

Local-only examples should explain decisions without copying Leo's machine paths or server grants into shipped configuration:

- L1: CLI/package-manager lists (`brew`, `composer`, `pnpm`, `docker`, `gh`) describe an installed toolchain. Do not turn them into substring allows. Retain the selected host authority baseline or write explicit workload restrictions.
- L2: `origin`, `main`/`master`, force-push restrictions, and broad recursive-removal bans encode repository workflow preferences. Keep them in an operator replacement map; for example, an additional Bash reject literal `git push` blocks every matching submitted push command under that local policy.
- L3: MCP namespaces, named skills, and personal instruction-file edit exceptions are installation-specific. No MCP wildcard permission groups, skill permission engine, HTTP tool, or imported `auto`/`ask` mode is introduced here.
- L4: Generic `secrets`/`credentials` directories, all `.key`/`.pem` files, `.npm` caches, `docker-compose*.yml`, and `config/database.yml` may contain secrets or ordinary fixtures/configuration. Keep broader bans explicit and local; standard credential locations are the narrower global default.

## Risks / Trade-offs

- R1: Text patterns reject quoted mentions and miss differently spelled commands. Publish the example matrix in the capability spec; make no sandbox or command-equivalence claim.
- R2: A field allow authorizes the whole call. Keep all-fields allows invalid and document that separate field allows are alternatives, not combined constraints.
- R3: A broad whole-tool reject prevents every narrower allow. Keep unconditional catalog exclusion in `tools.allowed`; no implicit precedence exceptions.
- R4: Restart changes permission for unfinished Runs while declarations stay frozen. Record execution policy separately and test a real recovery boundary without weakening native effect fencing.
- R5: Regex syntax is smaller than JavaScript regex. Fail startup with the config location and a static reason; never print the pattern or fall back to an unbounded engine.

## Migration Plan

1. Extend the schema and evaluator, then wire the mandatory gate and private metadata in one deployable implementation layer. Update shipped config examples and execution fixtures to distinguish built-in defaults from complete operator replacement maps.
2. Document the default policy and breaking explicit-map/no-match rejection behavior and inspect the operator's intended configuration before deployment. Do not generate wildcard allow rules or change Leo's live config automatically.
3. Stop all affected API/worker processes, deploy the implementation with its intended config, and restart them. The absent setting applies the built-in code-owned defaults; explicit maps replace them, so customized deployments must supply every group they intend to retain. MCP execution requires explicit groups.
4. Verify allow, deny-with-continuation, unchanged visibility, restart policy, and two-owner isolation. No chat deletion, schema reset, or new table is needed.
5. Roll back by restoring the previous binary and its compatible config together. The old binary cannot accept the new closed-schema key; rolling back also removes this call-policy gate and must be an explicit operator decision.

## Revision history

- v5 (2026-09-11): Added source-derived portable defaults and explicit whole-map replacement, separated local workflow policy, and corrected the Knowledge-only execution scenario.

- v4 (2026-09-11): Replaced the owner-visible content hash with a random process policy-instance ID so interpolated private values cannot be guessed against a deterministic digest.

- v3 (2026-09-11): Specified awaited boot and durable admission seams, preserved submitted arguments across schema validation, and made direct host matching textual to preserve literal selector-like filenames without filesystem probes.

- v2 (2026-09-11): Made all-fields targeting explicit and clarified that existing Run-level native recovery is preserved without adding resumption.
- v1 (2026-09-11): Initial proposal from the confirmed grilling contract; configuration, bounded regex, execution metadata, and delivery boundaries made concrete.

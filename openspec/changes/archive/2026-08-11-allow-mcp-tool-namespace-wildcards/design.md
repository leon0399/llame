## Context

See [proposal.md](proposal.md) for motivation. Today `tools.allowed` is validated into a string array and then converted to `Set<string>` at turn acceptance. The code-owned registry, MCP candidate snapshot, turn catalog, and effective-context resolver all use exact `Set.has(id)` checks. The MCP runtime currently iterates exact permissions and can therefore synthesize an unavailable identity that its source has never discovered. This change corrects that inversion: source inventory owns identities and `tools.allowed` only filters them.

The existing lifecycle has two separate concerns that must stay separate: disconnect immediately withdraws the callable catalog, while the availability manifest may still describe an eligible exact id as unavailable. Immutable Runs already persist exact admitted declarations and rebind exact ids with declaration-hash checks.

## Goals / Non-Goals

**Goals:**

- Make source inventory authoritative and centralize exact-or-namespace permission matching as a filter applied after admission.
- Preserve exact ids and declarations at every model-facing, durable, and execution boundary.
- Preserve meaningful unavailable/reconnected transitions for wildcard-selected tools without retaining stale callable declarations.
- Keep boot validation independent of MCP connectivity.

**Non-Goals:**

- A general glob engine, deny/precedence semantics, live permission reload, or user-scoped grants.
- Inferring safety from MCP annotations or verifying the operator's read-only attestation.
- Persisting wildcard policy or a server catalog across process restarts.

## Decisions

### 1. Keep the validated allowlist raw and use one shared ID matcher

Configuration loading will retain the existing `readonly string[]` representation after validating every entry. One shared matcher receives `tool.id` plus those strings and returns true when any rule is exact-equal or is a validated `__*` rule whose prefix, after removing the terminal `*`, matches the id. Matching is case-sensitive. It does not build rule objects, parse candidate ids, inspect source metadata, or enumerate candidates. The code-owned registry plus MCP runtime first produce the complete safely admitted current or remembered-unavailable inventory, and effective-context composition filters that inventory through this matcher.

Tool selection filters each inventory candidate once with `allowed.some(rule => matches(rule, tool.id))`. Duplicate rules and exact-plus-namespace overlap therefore do not duplicate a candidate, while distinct candidates remain distinct for existing collision checks. This same path handles exact and namespace MCP permissions; neither can manufacture or deduplicate candidates.

The code-owned registry will reject ids beginning with `mcp__`, formally reserving that prefix for MCP-generated tools. The namespace rule's trailing `__` distinguishes `mcp__web__*` from a server such as `webExtra`, so no runtime source check is needed.

Rejected alternative: compile typed rule objects or parse every candidate and compare its source metadata. Boot validation plus the reserved `mcp__` prefix make both redundant; the raw validated full prefix already preserves the namespace boundary.

Rejected alternative: expand patterns once at boot. It requires connectivity, cannot admit later catalog additions, and contradicts offline startup.

### 2. Use a dedicated strict wildcard parser, not `mcp-tool-id-v1`

`mcp__<server>__*` is a permission expression, not a tool id. The parser accepts it only when `<server>` is canonical and names an existing `mcpServers` entry. Every other `*` placement fails boot. Exact entries continue through the existing exact-id parser and 64-character executable-id constraint.

This keeps provider tool-name validation and availability-manifest v1 semantics unchanged: `*` can never become a candidate id.

### 3. Filter the admitted source inventory at API acceptance

For a ready server, candidate construction returns its atomically published admitted catalog without consulting permissions. During an outage it returns the last completely admitted exact identities as unavailable candidates without retaining declarations or executors. Refused declarations never become candidates. Successful complete discovery replaces this source inventory, so omitted and newly refused identities disappear.

At API acceptance, effective-context composition applies the shared matcher to code-owned and MCP candidates. Exact MCP entries and namespace entries use the same predicate path. The resulting filtered exact candidates drive provider declarations and availability state. A fresh process with no successful discovery has no MCP candidates, so neither exact nor namespace permission entries produce unavailable identities.

The turn catalog receives a deterministic candidate list and binds only exact ids. Once a Run is accepted, its immutable exact declaration is the authorization and integrity boundary for retries and execution rebinding; the wildcard is not consulted again for that Run.

Rejected alternative: persist the wildcard in Run snapshots and re-expand at execution. That would let a remote catalog change mutate authority after acceptance and would break immutable declaration binding.

### 4. Retain last admitted identities, never stale declarations

Each process-local MCP server record will keep a separate, bounded set of exact ids from its last completely published admitted catalog. Catalog withdrawal clears clients, executors, schemas, and declarations immediately but leaves that identity set as unavailable source inventory. Fresh complete discovery atomically replaces both the callable catalog and remembered identity set; shutdown or a fresh process starts with no remembered identities. Permission filtering happens after this lifecycle projection and therefore behaves identically for exact and namespace entries.

This produces `Became unavailable` / `Now available` for previously visible permitted tools while satisfying the existing ban on stale re-advertisement. A successful catalog that omits a prior identity produces `Removed`; a server that has never connected produces no MCP unavailable entries because there is no safe exact identity to disclose.

Rejected alternative: drop every wildcard-derived identity on disconnect. It is simpler, but it misclassifies a transport outage as Removed/Added and loses the availability signal #215 deliberately introduced.

Rejected alternative: retain the prior declaration catalog. It risks stale advertisement and execution and violates reconnect's fresh-discovery boundary.

### 5. Keep exact surfaces and existing snapshot formats

Provider requests, availability manifests/reminders, model-context snapshots, receipts, run events, persisted tool parts, and runtime rebinding continue to contain exact canonical ids and admitted declarations only. No migration or manifest version is required. Pattern changes take effect at restart for newly accepted Runs; existing Runs keep their exact bound contracts.

## Risks / Trade-offs

- [A remote server can silently add a newly executable tool] → Treat the wildcard as an explicit namespace-wide current-and-future read-only attestation; document exact ids as the safer default and forbid wildcarding a mixed-effect server.
- [Remembered identities could be mistaken for a stale catalog] → Store ids separately from declarations/executors and permit their use only for unavailable manifest entries.
- [Different API/worker processes may observe different catalogs during rollout or outages] → Preserve the existing process-local model; each accepted Run binds one exact immutable snapshot, and execution still requires exact declaration-hash rebinding.
- [Mixed-version deployment rejects the new configuration] → Deploy wildcard-capable API and worker binaries before adding a wildcard. Roll back by restoring exact entries before starting an older binary.
- [Changing exact permissions to filter-only removes fresh-offline synthetic identities] → Specify and test this correction explicitly; availability reflects source inventory, not permission strings.
- [A future bundled tool could imitate an MCP id] → Reserve `mcp__` at code-owned registration so ID-only namespace matching remains source-safe.
- [Permission matching drifts across consumers] → Route filtering through one raw-array ID matcher; add contract tests for exact/wildcard parity, prefix boundaries, advertisement, reconnect, snapshot/receipt exactness, and execution rebinding.

## Migration Plan

1. Deploy binaries that understand exact entries and namespace wildcards while keeping existing exact-only configuration.
2. Verify API and every worker process run the compatible binary.
3. Replace selected exact entries with a namespace wildcard only after auditing that server's entire current catalog and ownership boundary as read-only.
4. To roll back, restore exact entries, restart all processes, then deploy the older binary if required. Accepted Runs remain valid because they contain only exact bound ids and declarations.

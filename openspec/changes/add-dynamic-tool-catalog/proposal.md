## Why

The Run tool loop can only execute tools the API was compiled against. Its
declaration path is already JSON-Schema-driven end to end, but the executor side
binds to an in-code Zod registry, the operator allowlist is validated at boot
against that registry, and a tool whose declaration no longer matches its executor
fails the entire Run. None of that can admit a tool discovered at runtime, so
remote MCP (#215) cannot be additive — it would have to reopen the tool contract
and instance config, which is exactly what #214 exists to prevent.

Independently, an in-flight tool call is settled in neither direction when its Run
is cancelled or expires: the live stream leaves the tool rendered as running
forever, while persistence drops the call entirely, so a reload shows that it never
happened (#293, verified against the run-event translator). That is a defect today
and an audit hole the moment an untrusted party is on the other end of a tool call.

## What Changes

- The tool contract gains what a non-first-party tool needs to be governed: an
  input schema that may be JSON Schema as well as Zod, a **replay-safety axis
  modelled separately from the SPEC §13.5 safety classification**, a declared
  origin, and a per-tool result limit.
- Tool resolution becomes catalog-driven. The in-code registry becomes one source
  among several rather than the source, and both advertisement (snapshot binding)
  and execution resolve through the same injected catalog.
- Tool ids gain a reserved, provider-legal namespace form for dynamically sourced
  tools, so an id survives contact with providers that constrain function names to
  `[A-Za-z0-9_-]`.
- `tools.allowed` boot validation splits by id namespace: statically-registered ids
  stay strictly validated at boot; a namespaced dynamic id validates only that its
  source is declared, and the tool itself stays unavailable and fail-closed until
  discovery resolves it.
- **BREAKING** (runtime behavior, not config): a bound snapshot declaration that no
  longer matches its live executor withdraws **that tool** for the turn and records
  the withdrawal, instead of failing the whole Run. Failing the Run is correct for a
  redeploy and wrong for an upstream source that edits a schema.
- Every in-flight tool call settles when a Run is cancelled or expires — in the live
  stream, in persisted history, and in the event log — and a synthetic settlement
  stays distinguishable from a tool that genuinely failed. (#293)
- Tool inputs and results are redacted on the persistence path, not only in logs.
- Descriptions and schema prose from a dynamic source are neutralized before they
  enter the hashed, immutable model-context snapshot and the owner-visible receipt.
- Whether tool observations survive into later turns is **measured, not assumed**.
  The current text-only replay boundary is pinned by tests across same-model
  continuation, model and provider switches, and compaction. A provider-neutral,
  injection-safe observation projection ships only if that measurement demonstrates
  a real continuity failure.

## Capabilities

### New Capabilities

None. This change extends the existing tool loop rather than introducing a
capability; remote transport and connector configuration remain #215's.

### Modified Capabilities

- `tool-calling`: the registry requirement becomes a catalog requirement admitting
  dynamically sourced tools; classification gains a separate replay-safety
  dimension; declaration drift withdraws a tool instead of failing the Run;
  cancellation and expiry must settle in-flight tool activity truthfully; tool
  payloads are redacted before persistence; dynamic tool descriptions are treated
  as untrusted input; the context boundary for tool observations is stated as a
  measured, testable contract rather than an implicit one.
- `instance-config`: `tools.allowed` validation splits by id namespace, so a
  configured dynamic tool id no longer has to exist in the in-code registry at boot
  while unknown static ids still fail boot.

## Impact

- `apps/api/src/tools/` — tool contract, catalog resolution, validation, result
  handling.
- `apps/api/src/runs/` — snapshot binding and drift policy, tool-event emission and
  settling on the abort path, the run-event to UI-chunk translator's terminal
  handling.
- `apps/api/src/instance-config/` — allowlist validation split.
- `apps/api/src/compaction/` — schema-only tool declarations continue to round-trip;
  the AI SDK `toolCalls` boundary cast is replaced with a typed adapter.
- SPEC §9.4 (run-event families) and §13.5 (classification) gain the new event and
  the replay-safety dimension when this change syncs.
- No database migration. No transport, connector configuration, permission UI, or
  policy evaluation.

Scope notes: #294 (tool-result truncation corruption) is deliberately **not** in
this change — it is an independent defect, and the per-tool and
context-window-derived caps that depend on the widened contract here are the only
part that waits. This change is authored as one specification and is expected to be
implemented as a stack of separately reviewable branches.

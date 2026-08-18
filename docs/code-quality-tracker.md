# Code Quality Taser Tracker

Living tracker for the constraints and refactors that make low-quality generated
code fail early. This is not a claim that automation creates good code. It records
which failure modes are measured, which gates exist, and where judgment is still
required.

**Baseline:** `master` at `8bca868e`, measured 2026-08-14.

**States:** `done` shipped; `ready` complete locally and awaiting submission;
`active` current stack ownership; `queued` evidence-backed; `investigate`
measurement needed before implementation.

## Merged stack (2026-08-16)

The 25 `done` layers below merged into `master` on 2026-08-16 through
GitHub stack #369 (47 PRs, #359–#407). States are the final record; the
`investigate` row is unclaimed future work, and unshipped inventory
remains under `queued`/`investigate` in the sections below.

| Order | State       | Layer                                   | Acceptance evidence                                                                                                                                                        |
| ----: | ----------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | done        | Tracker and design baseline             | Documents match live configuration, issue #268, and measured debt                                                                                                          |
|     2 | done        | Web test doubles                        | Web has zero matches using Vitest, Storybook, and native Web API types; 340 unit and 300 browser tests pass                                                                |
|     3 | done        | Complexity ceiling and first extraction | Four native Oxlint configs enforce modified complexity 35; the 53-point function measures 30 after a boundary extraction                                                   |
|     4 | done        | AI SDK model doubles                    | 14 assertions removed; focused units 11/11, compaction integration 17/17, and API typecheck/lint pass                                                                      |
|     5 | done        | Remaining cast slices                   | Standard SDK/framework types and real database transactions remove all 80 assertions across owned application and test code                                                |
|     6 | done        | Full-tree double-assertion prohibition  | Maintained anti-slop Oxlint rejects every chained assertion across all five owned lint scopes in hooks and CI                                                              |
|     7 | done        | Constructor decorator placement (#286)  | All 46 `@Inject` constructor parameters use split placement; native ast-grep rejects inline regressions                                                                    |
|     8 | done        | Semantic Markdown and lint ratchets     | Pinned markdownlint-cli2 scanned the 200 product-owned files measured at adoption with zero findings through the same local/CI command (191 after the working-doc removal) |
|     9 | done        | Unused lint-disable ratchet             | Native Oxlint enforcement removed 48 stale directives and reports zero across all four lint-owning workspaces                                                              |
|    10 | done        | Contributor documentation contracts     | Runtime, migration, formatting, and test-cache claims match their executable configuration                                                                                 |
|    11 | done        | Shared TypeScript config ownership      | The final workspace has focused instructions naming preset fan-out, boundaries, and sequential consumer verification                                                       |
|    12 | done        | Mutation-testing pilot                  | PR #390 carries the native baseline; PRs #391–#394 repair all four child slices; no useful pilot `U` gap remains                                                           |
|    13 | investigate | Modular/service refactors               | Only measured coupling or responsibility hotspots become layers                                                                                                            |
|    14 | done        | Unsafe assertion boundary foundation    | One shared JSON-record guard replaces four duplicates; bounded-fetch removes one unsafe cast and the native inventory falls from 282 to 281                                |
|    15 | done        | Persisted tool-observation validation   | Runtime record and safe-integer guards remove seven assertions; malformed replay and checkpoint writes fail closed; inventory reaches 274/81                               |
|    16 | done        | MCP declaration-schema canonicalization | A truthful outer-record overload plus typed fixtures remove five assertions without widening canonicalization; inventory reaches 269/79                                    |
|    17 | done        | MCP SDK executor binding                | Two assertions removed; direct 59/59; `constructor` accepted; accessors/prototype-only names refused; inventory 267/77                                                     |
|    18 | done        | Tool schema admission                   | Three production assertions removed; structural Zod evidence and owned generated schemas; focused 89/89; inventory 264/76                                                  |
|    19 | done        | MCP HTTP test fixture                   | Four assertions removed through shared record evidence and native address narrowing; focused 76/76; inventory 260/75                                                       |
|    20 | done        | Tool-result truncation boundary         | Seventeen assertions removed through parsed success-record evidence and Zod-backed tests; focused 46/46; inventory 243/72                                                  |
|    21 | done        | Anti-slop foundation                    | Base `446268e` + documented non-null-wrapper patch; five rules enforced; 1,117 findings remain across ten layers                                                           |
|    22 | done        | Product E2E deterministic readiness     | Owned production boot, mounted-chat foreground ownership, and browser-initiated revoked-session navigation; run 31905421872 passed 21/21 without retries; issue #403       |
|    23 | done        | Owned object-parameter contracts        | Five lint scopes enforce `no-object-parameters`; three helpers use endpoint DTO variants or exact service capabilities; PR #404                                            |
|    24 | done        | Domain-owned symbol names               | Five structural placeholder references now name prompt scenarios, rendered conversation nodes, or admitted MCP payloads; PR #405                                           |
|    25 | done        | First-send render identity              | Canonical draft routes, URL-only chat identity, and Run-ID render keys; Product E2E passed first attempt pre-rebase (run 31952264163); PR #406                             |
|    26 | done        | Superpowers working-doc removal         | All 27 dated `docs/superpowers` plans/specs deleted; semantic Markdown lint covers 191 files with zero findings; PR #407                                                   |

## Published PR stack

All 47 PRs below merged into `master` on 2026-08-16; the table is the
historical publication record of stack #369.

| Order | PR   | Layer                                 |
| ----: | ---- | ------------------------------------- |
|     1 | #359 | Tracker and design baseline           |
|     2 | #360 | Web test doubles                      |
|     3 | #361 | Native complexity ceiling             |
|     4 | #362 | AI SDK model doubles                  |
|     5 | #363 | AI SDK tool-callback types            |
|     6 | #364 | API HTTP/framework test doubles       |
|     7 | #365 | Chats controller test doubles         |
|     8 | #366 | Chat-loop integration test doubles    |
|     9 | #367 | Search worker test doubles            |
|    10 | #368 | Compaction integration test doubles   |
|    11 | #370 | Pins test doubles                     |
|    12 | #371 | Worker AI SDK and abort settlement    |
|    13 | #372 | Remaining AI SDK stream doubles       |
|    14 | #373 | Auth service test doubles             |
|    15 | #374 | Tenant DB service test doubles        |
|    16 | #375 | Session cookie header types           |
|    17 | #376 | Instance config test doubles          |
|    18 | #377 | Tool tenant-context types             |
|    19 | #378 | Source-owned service capabilities     |
|    20 | #379 | Runtime-boundary negative fixtures    |
|    21 | #380 | Worker database/lifecycle fixtures    |
|    22 | #381 | Model-context repository coverage     |
|    23 | #382 | Chats repository query coverage       |
|    24 | #383 | Chat-loop transaction binding         |
|    25 | #384 | Full-tree double-assertion gate       |
|    26 | #385 | Constructor decorator placement       |
|    27 | #386 | Semantic Markdown lint                |
|    28 | #387 | Unused lint-disable ratchet           |
|    29 | #388 | Contributor documentation contracts   |
|    30 | #389 | Shared TypeScript config ownership    |
|    31 | #390 | Bounded mutation-testing pilot        |
|    32 | #391 | MCP tool-ID mutation repairs          |
|    33 | #392 | Protected-value mutation repairs      |
|    34 | #393 | Bounded-fetch limit mutation repairs  |
|    35 | #394 | Bounded-fetch SSE mutation repairs    |
|    36 | #395 | Unsafe assertion boundary foundation  |
|    37 | #396 | Persisted tool-observation validation |
|    38 | #397 | MCP schema canonicalization           |
|    39 | #398 | MCP SDK executor binding              |
|    40 | #399 | Tool schema admission                 |
|    41 | #400 | MCP HTTP test fixture                 |
|    42 | #401 | Tool-result truncation boundary       |
|    43 | #402 | Anti-slop foundation + E2E readiness  |
|    44 | #404 | Owned object-parameter contracts      |
|    45 | #405 | Domain-owned symbol names             |
|    46 | #406 | First-send render identity            |
|    47 | #407 | Superpowers working-doc removal       |

## Current submission

Arc 2 opens with `no-reflect-apply` (branch `quality/no-reflect-apply`,
stacked on `quality/unsafe-assertion-misc-tail`, itself stacked on
`quality/unsafe-assertion-chats-tail`, PR #430, PR #429, PR #428, PR #423,
and PR #422). This vendored anti-slop rule is a JS plugin, not a native
type-aware one: the `-D anti-slop/<rule>` CLI flag silently matches
nothing for it (confirmed empirically — even a nonexistent rule name
no-ops the same way), so its inventory is measured by temporarily
enabling the rule in a scratch copy of `.oxlintrc.json` with an absolute
`jsPlugins` specifier (its own relative path only resolves against the
real config's location) and running `oxlint -c <scratch-config>`. The
stale queued count (two diagnostics in one file) predates the chats/
domain tail slice, which introduced a third `Reflect.apply` call as its
own `no-unsafe-type-assertion` fix; the fresh count was three diagnostics
across two files.

`mcp-failure-policy.test.ts`'s two calls tested `classifyMcpFailure`'s
fail-closed behavior for a stage/kind it doesn't recognize — exactly the
case its own switch/if `default` branches were already written to handle,
even though the exported `McpFailureSignal` parameter type claimed the
input was closed to `McpFailureStage`/`McpFailureKind` literals only.
`classifyMcpFailure`'s own parameter type now honestly says so: the
`(string & {})` branded-string widening (the same idiom the tools/MCP
cluster used for a protocol-version test fixture) accepts any string
alongside the closed unions, so the tests call it directly instead of
routing through `Reflect.apply`. `chat-loop.integration.test.ts`'s
`Reflect.apply` was itself a `no-unsafe-type-assertion` repair for a real
gap — this project's `strictBindCallApply: false` makes
`Function.prototype.call`/`.apply`/`.bind` fall through to the untyped
legacy `Function` overload (confirmed with isolated probes: property
access on the result compiles clean instead of erroring, proving it
resolved to `any`) — but the deeper fix needed no dynamic-dispatch
mechanism at all: `mockImplementationOnce` intercepts only the one
re-check call the test targets, so calling `spy.mockRestore()` before
re-invoking the method as a plain, ordinarily-typed `this.findActiveByChatId(...)`
correctly resolves through the now-restored prototype method — no
`.call`/`.apply`/`.bind`/`Reflect.apply` anywhere. `no-reflect-apply` is
now enforced at error in `apps/api/.oxlintrc.json`, in a separate commit
from the remediation so the flip alone is revertable. Repair evidence:
`pnpm --filter api lint`/`typecheck` clean, `pnpm --filter api test`
1153/1153, focused `test:integration` on `chat-loop.integration.test.ts`
19/19 against real Postgres.

`no-reflect-get` (branch `quality/no-reflect-get`, stacked on
`quality/no-reflect-apply`) is next in Arc 2's smallest-first order, and
is a **partial** slice pending a decision — not enabled this round. The
fresh count was 6 diagnostics across 6 files (the queued baseline's 4/4
predates `vitest.integration.setup.ts`'s two `Reflect.get`/`Reflect.set`
calls, added in the misc infra tail). Those two are removed here: a
`Symbol.for(...)`-keyed idempotency flag on `process` (needed because this
setup file re-evaluates per test file in the same worker, so a
module-level variable would reset every time, but `process` itself
persists) is now typed via `declare global { namespace NodeJS { interface
Process { [HANDLER_INSTALLED]?: boolean } } }` instead of bypassing
`NodeJS.Process`'s type with `Reflect.get`/`Reflect.set`; Vitest's own
undocumented `__vitest_worker__` worker-context global gets the same
typed-global treatment, still read defensively through `isRecord` since
Vitest doesn't export a type for it. The remaining 4 diagnostics
(`worker-harness.ts`, `testing/support.ts`, `models/fake-model-client.ts`,
`models/openai-model-client.ts`) are the SAME pattern in every file: a
pass-through `Proxy` `get` trap wrapping the AI SDK `streamText()` result
to override 1–2 properties (`text`, `consumeStream`) while forwarding
everything else, using `Reflect.get(target, property, receiver)` — the
MDN-documented, invariant-preserving idiom for proxy trap forwarding,
specifically because it threads the correct `receiver` through to any
getter the AI SDK's result object defines (`text`/`content`/`reasoning`/
etc. are documented as `PromiseLike<...>` properties that "automatically
consume the stream" on access, strongly implying they're lazy getters with
internal state, not eagerly-resolved data). Replacing `Reflect.get` with
direct `target[property]` access would silently change which object
getters see as `this`; replacing the `Proxy` with `Object.create(target,
descriptors)` prototypal delegation might reproduce the same receiver
semantics, but `Object.create`'s own descriptor-map overload is typed
`any` in `lib.es5.d.ts`, trading one unsafe construct for another, and
neither alternative has been proven safe against the AI SDK's actual
getter implementations without a real risk of a subtle streaming
regression. This slice stops here pending a decision on whether these
four sites justify a documented rule exception, rather than forcing an
unverified rewrite into production streaming code to chase the metric.

## Inventory

### Typing and assertions

| State       | Finding                                                                                                  | Evidence / exit condition                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| done        | API convention bans `as unknown as T` and gives the `Pick<>` plus explicit Nest injection-token recipe   | `apps/api/AGENTS.md`; PR #285                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| done        | Double assertions are prohibited across all five owned lint scopes                                       | Maintained anti-slop Oxlint scans root E2E plus API, web, UI, and Storybook through their normal Lefthook/Turbo/CI paths                                                                                                                                                                                                                                                                                                                                                              |
| done        | Web test and story doubles contained 19 assertions across 14 files                                       | Zero web matches; 340 web unit tests and 300 Storybook browser tests pass                                                                                                                                                                                                                                                                                                                                                                                                             |
| done        | `MessagePart` explicitly names `ModelSwitchPart`, `ToolAvailabilityPart`, and `RecencyDigestPart`        | Corrects the pre-existing stored-message type gap without an assertion                                                                                                                                                                                                                                                                                                                                                                                                                |
| done        | AI SDK model doubles removed 13 assertions from `model-client.test.ts` and 1 from `fake-model-client.ts` | Partial Vitest mocks, `MockLanguageModelV3`, and real `streamText` with typed provider chunks; units 11/11                                                                                                                                                                                                                                                                                                                                                                            |
| done        | OpenAI adapter tool-loop tests removed 9 assertions without OpenAI-specific model doubles                | Provider-boundary `MockLanguageModelV3` drives real SDK scheduling, validation, and repair; focused units 8/8                                                                                                                                                                                                                                                                                                                                                                         |
| done        | API app-setup, auth, models, and runs tests removed 16 assertions                                        | Narrow Nest capabilities, `ExecutionContextHost`, Express `Pick<>`, and `drizzle.mock`; focused units 29/29                                                                                                                                                                                                                                                                                                                                                                           |
| done        | Chats controller tests removed 6 assertions                                                              | Real Node writable streams, typed Vitest spies, Drizzle mock DB, and provider-neutral AI SDK stream result; units 22/22                                                                                                                                                                                                                                                                                                                                                               |
| done        | Chat-loop integration tests removed 7 assertions                                                         | Existing narrow service contracts and complete built-in config; real-Postgres integration 19/19                                                                                                                                                                                                                                                                                                                                                                                       |
| done        | Search worker tests removed 6 assertions                                                                 | Nest `TestingModule`, public bootstrap lifecycle, provider overrides, and prototype logger spies; units 4/4                                                                                                                                                                                                                                                                                                                                                                           |
| done        | Compaction continuity integration removed 5 assertions                                                   | AI SDK `MockLanguageModelV3`, real `streamText`, typed provider chunks, and public `asSchema`; integration 17/17                                                                                                                                                                                                                                                                                                                                                                      |
| done        | Pins tests removed 4 assertions                                                                          | Nest `TestingModule` provider overrides replace forged concrete service and tenant DB instances; units 11/11                                                                                                                                                                                                                                                                                                                                                                          |
| done        | Worker harness removed 1 forged AI SDK result                                                            | Provider-neutral `MockLanguageModelV3` drives real `streamText`; worker integration 10/10 and model units 15/15                                                                                                                                                                                                                                                                                                                                                                       |
| done        | Shared and worker-mode integration fakes removed 4 forged AI SDK results                                 | One shared provider-neutral `MockLanguageModelV3` client drives real `streamText`; support unit 1/1 and affected integration suites 24/24                                                                                                                                                                                                                                                                                                                                             |
| done        | Auth service tests removed 3 concrete-class double assertions                                            | Exported `Pick<>` capabilities plus explicit Nest injection tokens preserve mock metadata and runtime DI; units 3/3                                                                                                                                                                                                                                                                                                                                                                   |
| done        | Tenant DB service tests removed 2 forged Drizzle database assertions                                     | Narrow transaction capability, Drizzle's mock driver, and typed Vitest spies replace partial database objects; units 6/6                                                                                                                                                                                                                                                                                                                                                              |
| done        | HTTP integration support removed 3 `set-cookie` header assertions                                        | Superagent's typed `get('Set-Cookie')` overload and the shared cookie extractor replace direct header-map coercions; integrations 15/15                                                                                                                                                                                                                                                                                                                                               |
| done        | Instance config consumers removed 2 concrete-service assertions                                          | Existing `InstanceConfigReader`, explicit Nest tokens, and complete built-in config fixtures replace partial config objects; units 15/15                                                                                                                                                                                                                                                                                                                                              |
| done        | Tool-context units removed 2 concrete tenant-database assertions                                         | Existing `TenantRunner`, Drizzle's mock DB, and a repository spy exercise the real callback boundary; units 23/23                                                                                                                                                                                                                                                                                                                                                                     |
| done        | Remaining service fixtures removed 2 concrete-service assertions                                         | Existing `RunStreamResponder` plus source-owned `ChatReindexDispatcher` capabilities replace concrete bridge/dispatch fixtures                                                                                                                                                                                                                                                                                                                                                        |
| done        | Negative runtime fixtures removed 3 double assertions                                                    | Structural supersets and accurately broad validated inputs replace casts without weakening `User`, registered `Tool`, or `MessagePart`                                                                                                                                                                                                                                                                                                                                                |
| done        | Database/lifecycle boundaries removed 2 double assertions                                                | Native Drizzle mock replaces an unused forged chain; typed factory client ownership preserves graceful worker teardown                                                                                                                                                                                                                                                                                                                                                                |
| done        | Model-context repository removed 1 forged database assertion                                             | Real Postgres covers five reachable hash-collision branches; impossible simulated source/availability collisions are deleted                                                                                                                                                                                                                                                                                                                                                          |
| done        | Chats repository removed 1 forged fluent database assertion                                              | Drizzle's native mock and public logger compile real SQL/params; focused units 35/35 and >500-row fork integration 6/6                                                                                                                                                                                                                                                                                                                                                                |
| done        | Chat-loop transaction binding removed the final forged database assertion                                | 17 orchestration cases use the real `TenantDbService`/Drizzle transaction boundary; 3 pre-transaction guards remain fast units                                                                                                                                                                                                                                                                                                                                                        |
| done        | Zero owned application/test matches remain                                                               | Full-tree inventory reports zero across tracked TS/TSX/MTS/CTS; no grandfathered baseline                                                                                                                                                                                                                                                                                                                                                                                             |
| done        | Five-scope chained-assertion enforcement                                                                 | Maintained anti-slop Oxlint covers root E2E plus four workspaces in Lefthook/CI; the old diff script and two bespoke ast-grep rules are deleted                                                                                                                                                                                                                                                                                                                                       |
| queued      | API unsafe narrowing assertions are measured for zero-baseline migration                                 | Native type-aware Oxlint fell from 282/83 through 281/82, 274/81, 269/79, 267/77, 264/76, 260/75, 243/72, then 196/68, forking to 169/66, 143/60, 134/58, 111/48, 94/41, 78/27, then 57/8 (chats-integration/memory-compaction/MCP-runtime/runs/tools-MCP/chats-tail/misc-tail) and separately to 158/67 then 147/64 (run-execution-tools/prompt-loader, now both merged); a fresh combined measurement is pending (see Current submission); slices must reach zero before enablement |
| investigate | Direct `any` and non-null assertions                                                                     | Classify production vs test/integration scaffolding before enabling restriction rules                                                                                                                                                                                                                                                                                                                                                                                                 |

The unsafe-assertion baseline was measured from
`quality-taser/mutation-bounded-fetch-sse` at
`4b65d3a1eacf6de98b7cafa109775df9715f8616` with one foreground thread:

```bash
cd apps/api
pnpm exec oxlint --threads=1 --type-aware \
  -D typescript/no-unsafe-type-assertion --format=json .
```

The native JSON result contains 282 diagnostics across 83 files. This is a debt
inventory, not an accepted baseline: no suppressions, allowlist, or per-file
override may survive the migration. Enable the rule only after the same full-tree
command reports zero. The first boundary slice centralizes the recurring JSON-
record predicate and removes the bounded-fetch cast; the same command then reports
281 diagnostics across 82 files. The persisted tool-observation slice then replaces
five record assertions and two number assertions with runtime narrowing, reducing the
same inventory to 274 diagnostics across 81 files. The rule remains diagnostic until
every existing finding is refactored. The MCP declaration-schema slice then removes
one production and four direct-test assertions through a truthful outer-record
canonicalization overload and typed fixtures, reducing the same inventory to 269
diagnostics across 79 files. The SDK executable-binding layer then replaces the
final MCP production assertion and its direct-test parser assertion with own data-
property evidence and runtime JSON validation. The same inventory now reports 267
diagnostics across 77 files; MCP production files have zero remaining findings,
while MCP test, integration, and fixture debt remains in later slices.
The tool schema-admission layer then replaces three production assertions with
structural Zod evidence and owned copies of AI SDK-generated schemas. Raw JSON
Schema documents retain their identity and draft-specific behavior; the inventory
now reports 264 diagnostics across 76 files.
The shared MCP HTTP fixture then replaces three parsed-JSON record assertions and
one native server-address assertion with the existing record guard and explicit
control-flow narrowing. Malformed and non-record request bodies retain their
summary behavior, string socket addresses are closed before rejection, and the
inventory now reports 260 diagnostics across 75 files. Remaining MCP assertion
debt is confined to later test and integration slices.
The tool-result truncation layer then removes two production and fifteen test
assertions. Parsed oversized results must still be success records before
recursive truncation; malformed array, string, missing-status, and wrong-status
projections fail closed through the runner's static execution error. Zod-backed
tests inspect dynamic output without assertions, and the same inventory now
reports 243 diagnostics across 72 files.
The instance-config loader slice then removes 20 production assertions from
`config-loader.ts`, 2 from `schema.ts`, and 25 from their direct unit tests.
`schema.ts` parameterizes the ajv validator as `ValidateFunction<RawInstanceConfig>`,
so `assertValidRaw` becomes a real `asserts raw is RawInstanceConfig` type
predicate backed by ajv's own runtime check — every downstream read of
`raw.mcpServers`/`workers`/`providers`/`models` in `config-loader.ts` is typed
through that one assertion instead of a cast at each call site. Scalar leaf
resolvers (`resolveNullableString`, `resolveNumeric`, `resolveToolAllowlist`)
add their own `typeof`/`Array.isArray` runtime guards rather than trusting the
schema silently, matching this migration's fail-closed-on-malformed-input
policy; a new `requireResolvedNumber` helper narrows `resolveNumeric`'s
`number | null` result at every `nullable: false` call site without widening
the function's own honest return type. `Object.create(null) as Record<...>`
becomes `Object.setPrototypeOf` on a typed empty object (`Object.create`'s
single-argument overload types as `any`; `setPrototypeOf` does not). The same
inventory now reports 196 diagnostics across 68 files.
Two parallel forks continue from this 196/68 point.

The run-execution tool-loop layer then removes 36 test assertions from
`run-execution-tools.integration.test.ts`, plus 2 more the same constructor
narrowing exposed as newly-unnecessary in
`compaction-context.integration.test.ts` and
`mcp-operator.integration.test.ts`. `RunExecutionService`'s constructor takes
`CompactionCapability`/`TitleCapability` (new `Pick<>` types) plus the
existing `InstanceConfigReader` instead of three concrete service classes,
bound through explicit `@Inject(ConcreteClass)` tokens; `TOOL_REGISTRY`
keeps its exported `ReadonlyMap` view backed by an internal mutable store,
exposing `registerTestOnlyTool`/`unregisterTestOnlyTool` as the only
supported test-only mutation seam. Scripted `MockLanguageModelV3` steps now
build typed `LanguageModelV3StreamPart[]` chunks instead of `as any`-wrapped
literals, correcting fixture data that had drifted to a stale flat
`usage`/string `finishReason` shape behind the casts. The same inventory now
reports 158 diagnostics across 67 files.
The prompt-loader layer then removes the remaining 11 findings in the
instance-config module, completing it to zero. handlebars types every AST
node's `type` field as plain `string`, so `node.type === 'X'` alone never
narrowed `node` itself; four explicit type-predicate functions replace the
check-then-cast pattern at every AST-walking call site, and the two touched
test files reuse the shared `isRecord` guard and an `instanceof`-narrowing
error helper. The same inventory now reports 147 diagnostics across 64
files. This fork's stack (`quality/unsafe-assertion-run-execution-tools` ←
`quality/unsafe-assertion-prompt-loader`) has since merged into `master`
(#425, #426).

Independently, the chats-integration cluster removes 27 of 30 findings in
`reasoning-loop.integration.test.ts`'s AI SDK stream fixtures/message-part
narrowing, `chats-messages.integration.test.ts`'s HTTP body/run-event
narrowing, and `shared-chats.integration.test.ts`'s HTTP body narrowing —
typed `LanguageModelV3StreamPart[]` fixtures, the shared `isRecord` guard,
and `zod`-parsed response bodies replace every cast, all fail-closed on
malformed shape. `reasoning-loop.integration.test.ts` keeps 3 `as never`
casts on `RunExecutionService`'s constructor deps, pending the
run-execution-tools fork's `Pick<>` capability types (now merged above);
measured against its own 196/68 fork point, this slice's inventory now
reports 169 diagnostics across 66 files. This slice's own stack continues
from that number below, since it does not touch the run-execution-tools/
prompt-loader files.

The memory/compaction cluster then removes 26 of 27 findings across
`compaction.service.ts` (a shared `toStoredMessages` helper narrows read-back
`Message[]` JSONB parts the same way), `compaction-context.integration.test.ts`,
`compactions.integration.test.ts`, `compaction.test.ts`,
`memory.integration.test.ts`, `memory.service.test.ts`, and
`personalization.integration.test.ts`. `MemoryService`'s constructor narrows
from concrete `TenantDbService` to the existing `TenantRunner` capability
(explicit `@Inject(TenantDbService)` token, matching the `apps/api/AGENTS.md`
recipe); `drizzle.mock({ schema })` replaces a forged `Db`. Every
`expect.stringContaining`/`stringMatching(...) as string` site (Vitest's own
matcher types return `any`) splits into a plain-string `.toBe`/`.toContain`/
`.toMatch` pair instead, since the asymmetric matcher can never carry real
`string` evidence into a strictly-typed `toEqual` position.
`compaction-context.integration.test.ts` keeps 1 `as never` cast, the same
deferred `RunExecutionService` constructor pattern; the inventory now reports
143 diagnostics across 60 files.
The MCP runtime cluster then removes 9 of 11 findings across
`mcp-runtime.service.test.ts` (4, a shared `TenantRunner` fake replaces four
forged-empty `TenantDbService` casts — dynamic MCP executor contexts never
reach `.runAs`), `mcp-runtime.module.test.ts` (3, `Reflect.getMetadata`
results stay `unknown` rather than casting to `readonly unknown[]`; Vitest's
`toContain`/`toContainEqual` accept `unknown` directly), and
`mcp-operator.integration.test.ts` (2 of 4; typed `TextPart[]` literals
replace two read-back `MessagePart[]` casts, the same pattern as the
chats-integration slice). `mcp-operator.integration.test.ts` keeps 2 more
`as never` casts, the same deferred `RunExecutionService` constructor
pattern as the other two slices; the inventory now reports 134 diagnostics
across 58 files.
The runs/ cluster then removes all 23 findings across `run-queues.ts`,
`run-stream-bridge.ts`, `worker-harness.ts`, `effective-context-resolver.test.ts`,
`context-receipt.integration.test.ts`, `runs-worker.service.test.ts`,
`model-context-snapshot.test-fixture.test.ts`, `snapshot-tool-execution.test.ts`,
`worker-concurrency.integration.test.ts`, and `worker-liveness.integration.test.ts`.
`payloadField`/`run-queues.ts` narrow with the shared `isRecord` guard and
`Array.prototype.every(isRecord)`; a plain (non-mocked) arrow function
assigned to `TenantRunner['runAs']`'s generic-typed slot lets TS infer the
real generic signature where a `vi.fn()` mock can't express it structurally
(same fix for `consumeSpy`'s generic `consume` method, via an explicit
`vi.fn<ConsumeMockFn>()` type parameter instead of casting `.mock.calls`);
a local `assertModelToolDeclaration` predicate reasserts a JSON round-trip's
erased type. The same inventory now reports 111 diagnostics across 48 files.
The tools/MCP cluster then removes all 17 findings across
`turn-tool-catalog.ts`, `runner.ts`, `worker-mode.integration.test.ts`,
`mcp-stdio-server-client.test.ts`, `mcp-test-fixture.test.ts`,
`turn-tool-catalog.test.ts`, and `search-conversations.test.ts`. A widening
cast (`readonly ToolUnavailableReason[]` to `readonly string[]`) replaces a
narrowing one on the searched value; `runner.ts` now fails a malformed
non-object parsed tool argument closed instead of casting it past the
type system; a test-fixture's own options type is widened with the
`T | (string & {})` branded-string idiom so a negative test can pass an
unsupported protocol version without fighting its real (already
runtime-validated) type; the newly-exported `isZodSchema` guard replaces a
production import-path type assertion. The `expect.stringMatching(...) as
string` pattern recurs at three more discriminated-union call sites and
gets the same map-then-narrow treatment as the chats-integration slice. The
same inventory now reports 94 diagnostics across 41 files.
The chats/ domain tail then removes all 16 findings across
`tool-availability-part.ts`, `context-builder.ts`, `chat-loop.service.ts`,
`dto/chats.dto.ts`, `chats.controller.ts`, `chats.service.ts`,
`chat-sharing.integration.test.ts`, `chat-loop.integration.test.ts`,
`chats-rls.integration.test.ts`, `fork-chat.integration.test.ts`,
`context-builder.test.ts`, `reasoning-parts.test.ts`,
`recency-digest.service.test.ts`, and `dto/chats.dto.test.ts`. A widening
cast replaces a narrowing one at a second `.includes()` discriminant site;
`.filter()` type predicates replace two `.filter().map()` narrowing gaps;
`toSharedChatResponse` narrows from the full `Chat` type to `Pick<Chat, 'id'
| 'title'>`, the only fields it reads (the "narrow the dependency, not the
fake" recipe). `chats.controller.ts`'s streaming response body no longer
bridges DOM's and Node's mutually-unassignable `ReadableStream`
declarations with a cast: a runtime `Symbol.asyncIterator in body` check
lets `Readable.from` (not `Readable.fromWeb`) consume it directly, verified
against real SSE integration coverage. `chat-loop.integration.test.ts`
found a genuine tsgo gap — `Function.prototype.call`'s generic overload
does not preserve an extracted method's return type, silently inferring
`any` — where `Reflect.apply` does; the fix trades one instance of debt
into the not-yet-enabled `no-reflect-apply` queued rule, which will
re-measure fresh when its layer starts. The same inventory now reports 78
diagnostics across 27 files.
The misc infra tail then removes 21 findings across 19 files spanning test
bootstrap (`vitest.integration.setup.ts`), opt-in evals
(`mcp-web-search-eval.test.ts`, `qa-evals.test.ts`), the queue layer
(`queue.ts`, `pgboss-queue.service.ts`, `queue.integration.test.ts`), the
shared Postgres-error-code helper duplicated across `auth.service.ts`,
`pins.service.ts`, and `identity.service.ts`, `identity/dto/identity.dto.ts`,
`app.setup.ts` and its integration coverage, `db/migration-journal.test.ts`,
`identity-invariants.integration.test.ts`, `db/tenant-db.service.test.ts`,
`models.controller.test.ts`, `models.service.test.ts`, and
`model-client.test.ts`. Repair idioms: the shared `isRecord` guard covers
most sites, including a case that disproves an earlier over-generalized
"preceding `typeof`-narrowing exempts the cast" theory (`queue.ts`'s
`expectRecord` and `auth.service.ts`'s `isUniqueViolation` were both still
flagged despite a preceding `typeof === 'object'` check — every occurrence
needed its own `isRecord`-backed guard). `pgboss-queue.service.ts` escapes a
`Q extends QueueDefinition<any>`-constraint-widening gap (member access
through the generic parameter itself resolves to `any`-based types even
though the extracted payload type is exact) by re-binding `queue` to a
locally-declared, concretely-typed `const` — a plain assignment, not a cast,
because both sides ultimately name the same underlying type. `app.setup.ts`'s
narrow `AppSetupApplication` test-seam type drops its `getHttpAdapter`
`Pick<>` wrapper in favor of the concrete return shape callers actually use,
turning `app.getHttpAdapter().getInstance().set(...)` into a direct call
instead of a cast, verified against all thirteen `configureApp` call sites.
`db/tenant-db.service.test.ts` replaces a `PgDialect.sqlToQuery` argument
cast with Drizzle's own `is(value, SQL)` entity-check guard, since
`execute`'s declared return type is `string | SQLWrapper` but `sqlToQuery`
needs the concrete `SQL<unknown>`. `search-index.integration.test.ts`'s
generic `ownedRows<T>` helper hit a distinct, unresolvable TypeScript
generic-constraint gap: assigning a raw-driver row value typed as `T`'s own
constraint back into the caller-supplied `T` is unsound in general (`T`
could be instantiated narrower than its constraint), so no re-binding or
intersection trick converts it to a plain assignment; `ownedRows` now takes
a `z.ZodType<T>` and calls `.array().parse(...)`, giving every one of its
fourteen call sites real per-row runtime evidence instead of a compile-time-
only assertion, following the repo's existing Zod-for-boundary-validation
convention. `model-client.test.ts`'s `expect.any(Function) as () => void`
casts (Vitest's `expect.any` is declared `any`, so removing the cast just
traded `no-unsafe-type-assertion` for `no-unsafe-assignment` on the same
line) are replaced by capturing the actual mock call arguments, asserting
the typed fields with `toMatchObject`, and checking `onAbort` is callable
with a plain `typeof` check — real runtime evidence instead of an
asymmetric-matcher placeholder embedded in a strictly-typed literal. The
same inventory now reports 57 diagnostics across 8 files, all owned by the
unmerged `quality/unsafe-assertion-prompt-loader`/run-execution-tools peer
stack (#425/#426); `reasoning-loop.integration.test.ts`'s 3 remaining
`as never` casts are downstream of #425's `CompactionCapability`/
`TitleCapability`/`InstanceConfigReader` constructor narrowing and are
expected to resolve for free once that stack merges and this branch rebases.

Both forks are merged into `master` as of this rebase. The deferred casts
this fork left behind (3 in `reasoning-loop.integration.test.ts`, 1 in
`compaction-context.integration.test.ts`, and 2 in
`mcp-operator.integration.test.ts` from a later slice) are now resolvable
against the merged `CompactionCapability`/`TitleCapability` types; a fresh
full-tree measurement after the rebase is the authoritative current count.

### Lint and formatting

| State  | Finding                                                                                                         | Evidence / exit condition                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| done   | Prettier checks all owned repository files, including Markdown/MDX, JSON(C), YAML, and CSS                      | Root `format:check`, `.prettierignore`, lint workflow, staged hook                                                                                                           |
| done   | Oxlint runs with warnings denied in API, web, UI, and Storybook                                                 | Workspace `lint` scripts and Turbo                                                                                                                                           |
| queued | API is type-aware; other workspaces are substantially lighter                                                   | Compare the four `.oxlintrc.json` files; enable supported rule families only after violation review                                                                          |
| done   | Semantic Markdown is linted across all product-owned files (200 at adoption; 191 after the working-doc removal) | Pinned markdownlint-cli2 0.23.2 reports zero findings; only upstream/generated integrations and symlink aliases are excluded                                                 |
| done   | Unused lint-disable directives are rejected in every lint-owning workspace                                      | Native Oxlint enforcement removed 48 stale directives; API, web, UI, and Storybook each report zero                                                                          |
| queued | Four Vitest rules are disabled in API                                                                           | Ratchet one rule per slice and repair findings, as already required by `docs/testing.md`                                                                                     |
| done   | Constructor parameter decorator placement is standardized (#286): 46 split, zero inline                         | Native ast-grep scopes enforcement to `@Inject` constructor parameters; no wrapper, diff parser, or custom harness                                                           |
| queued | All 15 `dmmulroy/anti-slop` Oxlint rules are adoption targets                                                   | Five zero-baseline rules use base `446268e` plus one documented correctness patch; ten rules require remediation; only validated `unknown` inputs may carry local exceptions |

#### `anti-slop` rule qualification (2026-08-15)

Source review and the vendor base are pinned to
`dmmulroy/anti-slop@446268e`. A Git dependency is not viable because Node refuses
to strip the package's exported TypeScript under `node_modules`; compiling a
private package fork would add needless ownership. The provenance-pinned vendor
carries one enumerated correctness patch: transparent non-null expressions cannot
split a chained assertion. Oxlint's standard `RuleTester` protects the bypass,
and `UPSTREAM.md` owns reconciliation. Oxlint and `@oxlint/plugins` are paired at
mature 1.77.0, with type-aware `oxlint-tsgolint` 7.0.2001; this avoids bypassing
the seven-day release-age gate for 1.78.0. A rule becomes an error only in the PR
that removes every existing owned finding; no baseline, allowlist, or file-level
override is acceptable.

| State  | Upstream rule                               | llame disposition                                                                                                                      |
| ------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| done   | `no-chained-type-assertions`                | Zero across five scopes; standard `RuleTester` covers parentheses, non-null wrappers, and angle/`as` chains.                           |
| queued | `no-conditional-empty-object-spread`        | 147 diagnostics/50 files; preserve exact omission semantics rather than replacing omission with unconditional `undefined`.             |
| queued | `no-known-value-widening`                   | 47 diagnostics/30 files; repair with inference, `satisfies`, or named owner contracts.                                                 |
| queued | `no-module-mocking`                         | 81 diagnostics/34 files; replace module mocks with real dependency seams or faithful implementations, never overrides.                 |
| done   | `no-object-parameters`                      | Zero across five scopes; endpoint DTO variants preserve deliberate invalid-field tests and Pins uses an exact service capability seam. |
| done   | `no-reflect-apply`                          | Zero across three call sites in two files; enforced at error in `apps/api/.oxlintrc.json`.                                             |
| queued | `no-reflect-get`                            | Fresh count was 6/6 (`vitest.integration.setup.ts` added 2 since the baseline); down to 4/4, blocked pending a decision — see below.   |
| queued | `no-runtime-typeof`                         | 202 diagnostics/77 files; replace ad hoc representation narrowing with boundary schemas and parsed domain values.                      |
| done   | `no-shape-in-symbol-names`                  | Zero across five scopes; prompt scenarios, rendered conversation nodes, and admitted MCP payloads now carry their domain roles.        |
| queued | `no-unknown-parameters`                     | 142 diagnostics/64 files; only immediate validation may retain a local suppression with a specific explanation.                        |
| queued | `no-unknown-returns`                        | 18 diagnostics/15 files; parse where the producing layer owns the contract instead of exporting raw `unknown`.                         |
| done   | `no-unknown-type-aliases`                   | Zero across five owned scopes and enforced through root plus workspace Oxlint.                                                         |
| queued | `no-unsafe-dictionary-type`                 | 88 diagnostics/50 files; replace open top-type dictionaries with schema/owner-derived contracts, never `any`.                          |
| done   | `no-widen-then-assert`                      | Zero across five owned scopes; blocks local evidence erasure before it becomes unsafe-assertion debt.                                  |
| queued | `require-safety-comment-for-type-assertion` | 386 diagnostics/142 files; enable after unsafe assertions reach zero, documenting only rare unexpressible invariants.                  |

The remaining 1,117 diagnostics are remediation inventory, not a tolerated
baseline. Adopt rules in reviewable layers rather than enabling the all-on preset
over unrepaired source; newness is not a rejection criterion.

### Complexity and structure

| State       | Finding                                                                                                                      | Evidence / exit condition                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| queued      | Lower-threshold debt remains: modified complexity over 20 is API 12, web 3, UI 1 (unchanged in the 2026-08-14 remeasurement) | Ratchet toward 30 and then 20 remains queued evidence-driven work                                                                           |
| done        | Four lint-owning workspaces enforce modified complexity 35 with Oxlint's native rule                                         | `apps/api/.oxlintrc.json`, `apps/web/.oxlintrc.json`, `packages/ui/.oxlintrc.json`, and `apps/storybook/.oxlintrc.json`; forced lint passes |
| done        | `chat-loop.service.ts` accepted-turn callback measures 30 after 53 before; private `buildTurnContextAndParts` measures 24    | Context-builder + chat-loop units 83/83; real-Docker chat-loop integration 19/19; forced lint and API typecheck pass                        |
| queued      | Next API values above 30: MCP client callback 34, prompt assertion 32                                                        | Lower the ceiling only after each is repaired in a separate evidence-backed slice                                                           |
| queued      | Files over 1,000 lines include production services/repositories and large test suites                                        | File length is triage only; split by responsibility, not arbitrary line count                                                               |
| investigate | `run-execution.service.ts`, `mcp-server-client.ts`, and `chats-repository.ts` are production hotspots                        | Map responsibilities and dependency fan-in before proposing interfaces/modules                                                              |
| investigate | Web `chat-page.tsx` and conversation tree are large UI orchestrators                                                         | Require render/interaction evidence and consult `DESIGN.md` before any UI split                                                             |

### Test quality

| State       | Finding                                                                                          | Evidence / exit condition                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| done        | Unit, real-Postgres integration, Storybook browser, and product E2E are separate enforced layers | `docs/testing.md`, CI workflow                                                                                                                                                                                                                                                                                                                                                                                           |
| done        | Bounded mutation-testing command and configuration                                               | `apps/api/stryker.config.json` limits mutation to three pure MCP utilities, uses pinned `@stryker-mutator/vitest-runner@9.6.1`, keeps Stryker and Vitest at one worker, and emits native reports; no broad CI gate initially                                                                                                                                                                                             |
| done        | First pilot candidate: three pure MCP utilities with direct unit tests                           | PR #390: 33 tests and 425 mutants; the 2026-08-15 baseline is 69.41% with 101 survivors, 29 no-coverage mutants, and 6 timeouts; disposition inventory follows below                                                                                                                                                                                                                                                     |
| done        | Child layer 1: tool-id canonicalization/parser                                                   | PR #391: three behavior assertions cover invalid-format parsing, edge trimming, and the exact 64-character boundary; six baseline `U` gaps are repaired and 12 baseline survivors are reclassified `R` with exact manual evidence                                                                                                                                                                                        |
| done        | Child layer 2: protected-values normalization/propagation                                        | PR #392: 17 baseline `U` gaps are killed, marker `S169` is reclassified `R` with an exact manual failure, and comparator/tie mutants `S191`–`S195` plus `S255` are reclassified `E`; no useful protected-values gap remains                                                                                                                                                                                              |
| done        | Child layer 3: bounded-fetch request parsing/body sizing/response byte-limit semantics           | PR #393: 39 baseline `U` gaps are killed and `S12`, `S16`, and `NC58` are reclassified `E` for the supported `BodyInit` domain; no useful layer-3 gap remains                                                                                                                                                                                                                                                            |
| done        | Child layer 4: bounded-fetch SSE recognition/framing plus wrapper cancellation/metadata          | PR #394: eight behavior assertions kill all 16 queued `U` mutants; the native 169-mutant run kills 152 at 89.94%, and no useful layer-4 gap remains                                                                                                                                                                                                                                                                      |
| done        | API README command inventory                                                                     | The workspace README lists executable commands only; it does not document a nonexistent coverage script or invent coverage tooling                                                                                                                                                                                                                                                                                       |
| queued      | Four disabled Vitest style rules remain known follow-ups                                         | Enable one rule at a time and repair its full owned scope; no baseline, blanket suppression, or source-regex proxy                                                                                                                                                                                                                                                                                                       |
| investigate | The committed OpenAPI contract has no generated property-based conformance run                   | Pilot Schemathesis against the throwaway API/Postgres environment; measure auth and tenant setup, status/schema findings, replayability, runtime, and false positives before gating                                                                                                                                                                                                                                      |
| investigate | The chat-message single-flight integration test flakes only under suite load                     | Timed out on PR #361 and locally in the full 329-test run; isolated rerun passes 1/1; treat the flake as a latent architecture defect and remove the scheduling/state coupling with a deterministic readiness boundary before changing any timeout                                                                                                                                                                       |
| done        | Product E2E startup, settlement, and foreground-notification boundaries                          | PR #402 removes dev compilation races, orders modal interaction after stream settlement, and makes mounted ownership authoritative for notifications; run 31905421872 passed 21/21 first attempt without timeout/retry inflation                                                                                                                                                                                         |
| done        | PR #405 exposed a remaining first-send route/render-identity defect                              | Run 31915773223 detached the modal close button while live messages were replaced by durable history, then passed on retry; the repair uses canonical draft routes, URL-only identity, Run-ID React keys, and an exact held-history browser proof; PR #406's pre-rebase head (`381c127f`) passed Product E2E first attempt (run 31952264163) with `failOnFlakyTests` retained; the rebase onto PR #405 changed docs only |

#### Mutation-testing pilot baseline (2026-08-15)

The bounded baseline used the committed `apps/api/stryker.config.json`: three pure MCP
utilities, their three direct Vitest files, the native Vitest runner, and
`concurrency: 1`. The native report is `apps/api/reports/mutation/mutation.json`
(ignored generated output). The mutation counts, scores, per-file totals, and
survivor inventory below are native JSON report facts. Runtime, memory, and failure
observations are identified separately as foreground command output. The committed
thresholds are high 80%, low 60%, with no break threshold.

| Provenance                                      | Metric               | Result                                                                                                                                                                                                                                        |
| ----------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator-observed foreground Vitest/time output | Command              | `/usr/bin/time -v pnpm --filter api test:mutation`                                                                                                                                                                                            |
| Operator-observed foreground Vitest/time output | Exit status          | 0                                                                                                                                                                                                                                             |
| Operator-observed foreground Vitest/time output | Test scope           | 3 files, 33 tests; the direct Vitest preflight also passed 33/33                                                                                                                                                                              |
| Native JSON report fact                         | Mutation scope       | 3 source files, 425 instrumented mutants                                                                                                                                                                                                      |
| Native JSON report fact                         | Outcomes             | 289 killed; 101 survived; 29 no coverage; 6 timeout; 0 compile errors; 0 ignored; 0 pending                                                                                                                                                   |
| Native JSON report fact                         | Mutation score       | 69.41% (covered-mutant rate 74.49%)                                                                                                                                                                                                           |
| Operator-observed foreground Vitest/time output | Wall time            | 2:30.62                                                                                                                                                                                                                                       |
| Operator-observed foreground Vitest/time output | Maximum resident set | 250388 kB; 0 swaps                                                                                                                                                                                                                            |
| Operator-observed foreground Vitest/time output | Dry-run reference    | 4.23 s, 279432 kB maximum resident set, 33 tests, 425 mutants                                                                                                                                                                                 |
| Operator-observed foreground Vitest/time output | Memory preflight     | 6.6 GiB available and 34 MiB swap used before the direct tests; 6.7 GiB available and 35 MiB swap used afterward                                                                                                                              |
| Committed config / installed runner             | Process budget       | Stryker `concurrency: 1`; the package/lockfile pin plus installed `@stryker-mutator/vitest-runner@9.6.1` source force `maxThreads`, `maxWorkers`, and `maxConcurrency` to 1; any upgrade must reverify these options and peak-memory evidence |

Operator-observed foreground Stryker/time output recorded one network-disabled invocation
that failed before Stryker started because its logging server attempted to bind
`0.0.0.0` and received `EPERM`; the one authorized network-enabled retry above is
the only mutation result. No configuration, source, test change, or custom log
artifact was made to obtain it.

| Source file            |   Total |  Killed | Survived | No coverage | Timeout | Mutation score |
| ---------------------- | ------: | ------: | -------: | ----------: | ------: | -------------: |
| `mcp-bounded-fetch.ts` |     169 |      97 |       59 |          13 |       0 |         57.40% |
| `protected-values.ts`  |     166 |     120 |       28 |          12 |       6 |         75.90% |
| `tool-id.ts`           |      90 |      72 |       14 |           4 |       0 |         80.00% |
| **All files**          | **425** | **289** |  **101** |      **29** |   **6** |     **69.41%** |

The native JSON report contains 130 survivor/no-coverage entries. `S` means survived and
`NC` means no coverage; the number is the native Stryker mutant ID. `U` is a useful
behavior gap to repair with a focused test, `E` is a likely equivalent mutant for
the supported input domain, `I` is an intentionally untested implementation detail
outside the current contract, and `R` is a narrowly evidenced runner/static-mutant
activation artifact disproven by applying the exact replacement. `R` is not a test
gap, equivalent mutant, ignored mutant, or waiver. Grouped rows retain every ID and
its file:line/mutator location. At baseline, S170 was the only `R`.

The disposition count is 100 useful behavior gaps, 20 likely equivalent mutants,
9 intentionally untested implementation details, and 1 runner/static-mutant
activation artifact.

The native JSON reports six Stryker `Timeout` statuses for mutants 230, 231, 259, 261,
262, and 265. Operator-observed manual code interpretation identifies these as
mutation-induced nontermination in the `redactProtectedString` cursor loop; that
interpretation is not native JSON evidence. They are timeout statuses, not repair
backlog entries.

##### `src/mcp/mcp-bounded-fetch.ts`

| Native IDs                   | File:line (mutator)                                               | Disposition | Evidence-backed reading / next evidence                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1, S2, S4, S5               | 3, 4, 10, 11 (`StringLiteral`)                                    | I           | Error message and `name` spellings are observable labels, but no current contract pins them; keep them out of the first repair slice.                      |
| S7                           | 29 (`MethodExpression`)                                           | U           | `httpMethod` is exposed to `onBytes`; add uppercase normalization and `Request` fallback assertions.                                                       |
| S10                          | 30 (`StringLiteral`)                                              | U           | The default `GET` context is untested when the request is a URL or has no method; assert the context.                                                      |
| S12, S16                     | 32 (`ConditionalExpression`, `BlockStatement`)                    | U           | Non-string request bodies must produce a null RPC method without changing the HTTP context; add a typed-body case.                                         |
| S17                          | 33 (`ObjectLiteral`)                                              | U           | Non-string request bodies must produce a null RPC method without changing the HTTP context; add a typed-body case.                                         |
| NC29, NC30                   | 37, 38 (`BlockStatement`, `ObjectLiteral`)                        | E           | JSON arrays, primitives, and `null` cannot carry a JSON `method` property; the alternate non-object guard still yields `rpcMethod: null`.                  |
| S20, S21, S22, S23, S24, S26 | 37 (`ConditionalExpression`, `LogicalOperator`)                   | E           | The parser's non-object alternatives are observationally equivalent for JSON values; only a non-JSON object with custom properties could distinguish them. |
| S33                          | 43 (`ConditionalExpression`)                                      | U           | A JSON object with a non-string `method` must remain `null`; add number, boolean, and object method cases.                                                 |
| NC37, NC38                   | 45, 46 (`BlockStatement`, `ObjectLiteral`)                        | U           | Invalid JSON request bodies must not throw or invent an RPC method; add a malformed-body context case.                                                     |
| S39                          | 52 (`BlockStatement`)                                             | U           | Removing request-size calculation defeats the request budget for supported bodies; add a small-body and no-limit control case.                             |
| NC51, NC52, NC53             | 56 (`ConditionalExpression`, `BlockStatement`)                    | U           | `URLSearchParams` sizing is an explicit `BodyInit` branch and is not covered; add exact and over-limit byte cases.                                         |
| NC54, NC55                   | 59 (`ConditionalExpression`)                                      | U           | `ArrayBuffer` request sizing is untested; add an exact and over-limit case.                                                                                |
| NC56, NC57                   | 60 (`ConditionalExpression`)                                      | U           | Typed-array request sizing is untested; add an exact and over-limit case.                                                                                  |
| NC58, NC59                   | 61 (`ConditionalExpression`)                                      | U           | `Blob` request sizing is untested; add an exact and over-limit case.                                                                                       |
| S41, S42, S43, S45           | 53 (`ConditionalExpression`, `LogicalOperator`)                   | U           | `undefined`/`null` must count as zero bytes when a request limit exists; add no-body and null-body cases.                                                  |
| S47, S48, S49, S50           | 54 (`ConditionalExpression`, `EqualityOperator`, `StringLiteral`) | U           | String byte sizing and UTF-8 behavior need a small-body boundary assertion independent of the existing oversized request.                                  |
| S65, S66                     | 76 (`LogicalOperator`, `ConditionalExpression`)                   | U           | The limit guard must not reject bounded bodies incorrectly or enforce a missing limit; add below-limit and omitted-limit cases.                            |
| S68, S70, S71, S73           | 77 (`ConditionalExpression`, `EqualityOperator`)                  | U           | Unsupported bodies and the exact byte boundary are untested; add `undefined` size and exactly-at-limit cases.                                              |
| S79, S81                     | 86 (`ConditionalExpression`, `OptionalChaining`)                  | U           | An absent session ID must not call an optional callback, and an absent callback must not throw when a session exists.                                      |
| S85                          | 90 (`MethodExpression`)                                           | U           | `text/event-stream; charset=utf-8` must be recognized; add a parameterized content-type case.                                                              |
| S89                          | 93 (`StringLiteral`)                                              | U           | Treating every content type as an event stream changes byte accounting; add a successful non-SSE response with a content type.                             |
| S99                          | 97 (`ConditionalExpression`)                                      | E           | When the header is absent, the following anchored numeric regex still rejects `null`; replacing the null check is observationally redundant.               |
| S101, S102, S103             | 98 (`Regex`)                                                      | U           | Numeric-prefix, numeric-suffix, and one-digit content-length mutations accept malformed claims; add malformed-header cases.                                |
| S106                         | 99 (`EqualityOperator`)                                           | U           | A claimed response exactly at the limit should be allowed; add the exact-boundary case.                                                                    |
| S109                         | 101 (`OptionalChaining`)                                          | U           | A claimed oversized response may have a null body; preserve the custom limit error rather than dereferencing `null`.                                       |
| S111                         | 104 (`ConditionalExpression`)                                     | U           | Bodyless responses must be returned unchanged; add a null-body response case.                                                                              |
| S113                         | 110 (`BooleanLiteral`)                                            | U           | An event stream beginning with an LF has a distinct blank-line boundary; add an LF-only framing case.                                                      |
| S123                         | 116 (`EqualityOperator`)                                          | U           | A non-SSE body exactly at the response limit should not fail; add the exact-size case.                                                                     |
| S136                         | 127 (`BlockStatement`)                                            | U           | Bare-CR line delimiters are not covered; add a CR-only SSE framing case.                                                                                   |
| S137, S139                   | 128 (`ConditionalExpression`, `EqualityOperator`)                 | U           | CR blank-line versus nonblank-line event resets need a multi-line event that exceeds the per-event budget.                                                 |
| S140                         | 130 (`BooleanLiteral`)                                            | U           | Initial CR state affects a leading LF boundary; add a stream beginning with an empty LF line.                                                              |
| S146                         | 132 (`ConditionalExpression`)                                     | U           | Processing LF after CR would reset every CRLF line instead of only blank lines; add a multi-line CRLF event.                                               |
| S149, S151                   | 133 (`ConditionalExpression`, `EqualityOperator`)                 | U           | LF blank-line detection needs nonblank and blank lines in the same event; add both boundary forms.                                                         |
| S153                         | 137 (`BlockStatement`)                                            | U           | Ordinary SSE bytes must advance line state; add a multi-line event with ordinary data.                                                                     |
| S155                         | 139 (`AssignmentOperator`)                                        | E           | Only zero versus nonzero `lineBytes` is observed, so incrementing or decrementing remains equivalent after a nonempty byte.                                |
| S163                         | 159 (`ArrowFunction`)                                             | U           | Explicit cancellation of the returned bounded body must cancel the upstream reader; add a direct consumer-cancel assertion.                                |
| S164                         | 161 (`ObjectLiteral`)                                             | U           | The wrapper must preserve response status, status text, and headers; add metadata assertions.                                                              |
| S165, S166, S167, S168       | 166-169 (`ObjectLiteral`)                                         | U           | `redirected`, `type`, and `url` are fetch response metadata; add a transparent-wrapper metadata case.                                                      |

#### Child layer 3 repair result (2026-08-15; PR #393 active)

The baseline inventory above remains historical. This active child layer adds
request-context, request-size, session, and non-SSE response-limit assertions
only; `mcp-bounded-fetch.ts` is unchanged
(`sha256 8b6a369cfd943073043f393ce4ff4ce67106ba0aad9e6bbb8b0a56af0cb7eeef`).
The direct suite grows from 11 to 38 tests and covers HTTP/RPC context fallback,
every explicitly sized `BodyInit` branch, zero/exact/unsupported request limits,
session callback absence, strict `Content-Length` parsing, bodyless responses,
and exact streamed response boundaries.

- Native Stryker killed 39 of the 42 baseline layer-3 `U` mutants, including
  every request-size, session, strict-header, claimed-length, bodyless-response,
  and streamed exact-boundary mutant.
- `S12` and `S16` are reclassified `E` for supported `BodyInit`: bypassing the
  non-string early return only sends those values through `JSON.parse`
  coercion, which fails and reaches the same catch result
  `{ httpMethod, rpcMethod: null }`.
- `NC58` is reclassified `E`: making the final Blob condition unconditional
  still returns `undefined` for the remaining supported unsized bodies
  (`ReadableStream` and `FormData`), while every sized type returned earlier.
  A custom non-`BodyInit` object with a numeric `size` is outside the fetch
  contract.
- The exact layer-4 set remains queued unchanged: `S85`, `S113`, `S136`,
  `S137`, `S139`, `S140`, `S146`, `S149`, `S151`, `S153`, `S163`, `S164`,
  `S165`, `S166`, `S167`, and `S168`.

The final native one-file command was
`/usr/bin/time -v pnpm --filter api exec stryker run --mutate src/mcp/mcp-bounded-fetch.ts --testFiles src/mcp/mcp-bounded-fetch.test.ts`.
It measured 169 mutants: 136 killed, 31 survived, 2 no coverage, 0 timeout,
and 0 errors; mutation score 80.47% (covered-mutant rate 81.44%), 2:01.14 wall
time, 237760 kB peak RSS, and 0 swaps. The memory preflight found 2.0 GiB
available and no sustained swap traffic before the single-worker foreground
run. No useful layer-3 `U` mutant remains; the 16 useful survivors are exactly
the separately scoped layer-4 backlog.

#### Child layer 4 repair result (2026-08-15; PR #394 active)

The baseline inventory above remains historical. This child layer adds eight
behavior assertions for parameterized SSE recognition, LF/CR/CRLF blank-line
and multi-line framing, explicit consumer cancellation, and transparent
response metadata. The direct suite grows from 38 to 46 tests. Production
`mcp-bounded-fetch.ts` remains unchanged
(`sha256 8b6a369cfd943073043f393ce4ff4ce67106ba0aad9e6bbb8b0a56af0cb7eeef`).

- Native Stryker kills all 16 exact layer-4 `U` mutants: `S85`, `S113`,
  `S136`, `S137`, `S139`, `S140`, `S146`, `S149`, `S151`, `S153`, `S163`,
  `S164`, `S165`, `S166`, `S167`, and `S168`.
- The remaining 15 survivors are the existing `I` error-label mutants and
  existing `E` request-context, request-body, absent-header, and SSE line-counter
  mutants. The two no-coverage mutants are unchanged. This layer adds no
  suppression, ignore, threshold, or reclassification.
- The native one-file result is 169 mutants: 152 killed, 15 survived, 2 no
  coverage, 0 timeout, and 0 errors; mutation score 89.94% and covered-mutant
  rate 91.02%.
- The foreground run completed in 2:36.37 at 238988 kB peak RSS and zero
  swaps, with one Stryker worker after a 2.0 GiB available-memory preflight and
  no sustained swap growth.

No useful bounded-fetch `U` mutant remains after child layers 3 and 4.

##### `src/mcp/protected-values.ts`

| Native IDs                                                    | File:line (mutator)                                                                         | Disposition | Evidence-backed reading / next evidence                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NC196, NC197, NC198, NC199, NC200, NC201, NC202, NC203, NC204 | 22 (`ConditionalExpression`, `EqualityOperator`, `UnaryOperator`)                           | U           | Equal-length protected values are absent; add a tie case that independently asserts deterministic lexical ordering.                                                                                                                                                                     |
| S169                                                          | 1 (`StringLiteral`)                                                                         | U           | Tests import the redaction marker for their expected value, so the marker mutation can escape; assert the literal redaction contract independently.                                                                                                                                     |
| S170                                                          | 7 (`ArrowFunction`)                                                                         | R           | Operator-observed manual mutation evidence, not a native JSON fact: applying the exact replacement `() => undefined` made three existing `protected-values.test.ts` behaviors fail (recursive object redaction, protected-key fail-closed, direct argument detection); source restored. |
| S171, S173, S174, S175, S176, S178                            | 8 (`ConditionalExpression`, `LogicalOperator`)                                              | E           | The record predicate is reached only after all supported JSON kinds have been handled; alternate predicates are equivalent on that domain.                                                                                                                                              |
| S183                                                          | 18 (`MethodExpression`)                                                                     | U           | Dropping sorting weakens longest-first replacement and deterministic normalization; add reversed overlapping and equal-length inputs.                                                                                                                                                   |
| S191, S192, S193, S194, S195                                  | 19-21 (`BlockStatement`, `ArithmeticOperator`, `ConditionalExpression`, `EqualityOperator`) | U           | The comparator's ordering and tie behavior need direct assertions; current setup coverage does not independently kill these mutations.                                                                                                                                                  |
| S220, S221                                                    | 40 (`LogicalOperator`, `ConditionalExpression`)                                             | E           | Non-finite numbers are outside canonical JSON scalar handling; finite JSON numbers take the same branch.                                                                                                                                                                                |
| S228, S232                                                    | 58, 60 (`EqualityOperator`, `StringLiteral`)                                                | E           | With normalized nonempty protected values, the extra terminal loop and initial empty match do not change output.                                                                                                                                                                        |
| S250, S252, S253, S255                                        | 68 (`ConditionalExpression`, `EqualityOperator`)                                            | U           | Longest-match tie breaking is security-relevant when callers provide overlapping values; add an unsorted-overlap case.                                                                                                                                                                  |
| S275                                                          | 113 (`ConditionalExpression`)                                                               | U           | Direct numeric, boolean, and null protected-value detection is not independently covered; add scalar containment cases.                                                                                                                                                                 |
| S280                                                          | 116 (`MethodExpression`)                                                                    | U           | Array detection must be existential, not universal; add a mixed safe/protected array case.                                                                                                                                                                                              |
| NC285, S284                                                   | 121 (`BooleanLiteral`, `ConditionalExpression`)                                             | I           | Unknown non-record inputs are outside the JSON-like contract; retain the fail-closed implementation without a first-slice test.                                                                                                                                                         |
| S313                                                          | 173 (`ConditionalExpression`)                                                               | U           | A nested protected object key inside an array must propagate failure instead of being retained; add the nested-array case.                                                                                                                                                              |
| NC319, NC320, S318                                            | 179 (`ObjectLiteral`, `BooleanLiteral`, `ConditionalExpression`)                            | I           | The fallback handles non-JSON unknown values such as `undefined` or functions; those are not current persistence inputs.                                                                                                                                                                |
| S331                                                          | 187 (`ConditionalExpression`)                                                               | U           | Nested object-key failures must propagate without returning a successful payload; add a nested-object case.                                                                                                                                                                             |

#### Child layer 2 repair result (2026-08-15; PR #392 active)

The baseline inventory above remains historical. This active child layer adds
behavior assertions only; `protected-values.ts` is unchanged
(`sha256 127ef3c429c59645907d18c8ee49f73a43fbac5fe0f2a8e3801cff20ecc3e652`).
The direct suite is 16/16. It now fixes the literal marker contract, all six
equal-length input permutations, longest-first normalization, direct redactor
same-position and earlier-position precedence, scalar and existential-array
detection, and nested protected-key failure propagation through arrays and
objects.

- `NC196`–`NC204`, `S183`, `S250`, `S252`, `S253`, `S275`, `S280`, `S313`,
  and `S331` are killed or covered by the focused behavior assertions: 17
  baseline useful gaps repaired.
- `S169` remains a native survivor because the runner does not activate the
  static exported marker mutation. Applying its exact `''` replacement made
  the literal marker assertion fail while the other 15 tests passed; the
  source was restored. It is `R`, not a waived or equivalent gap.
- `S191`–`S195` are reclassified `E`. `Set` removes duplicate strings before
  sorting, so `<=`/`>=` equal-operand variants cannot diverge. For distinct
  equal-length strings, the remaining comparator variants preserve the only
  observable contract—ascending lexical order—and survived assertions over all
  six three-value permutations.
- `S255` is reclassified `E`: changing `>` to `>=` can only switch between
  equal-length protected strings starting at the same index, which must be the
  same string; normalized callers also deduplicate it.

The final native one-file command was
`/usr/bin/time -v pnpm --filter api exec stryker run --mutate src/mcp/protected-values.ts --testFiles src/mcp/protected-values.test.ts`.
It measured 166 mutants: 137 killed, 20 survived, 3 no coverage, 6 timeout, and
0 errors; mutation score 86.14% (covered-mutant rate 87.73%), 28.19 seconds
wall time, 226028 kB peak RSS, and 0 swaps. The six timeouts remain the baseline
cursor-loop nontermination cases. No useful `U` mutant remains in this file.

##### `src/mcp/tool-id.ts`

| Native IDs                 | File:line (mutator)                                                          | Disposition | Evidence-backed reading / next evidence                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| NC387, NC388, NC389, NC390 | 55-56 (`BlockStatement`, `ObjectLiteral`, `BooleanLiteral`, `StringLiteral`) | U           | A non-`mcp__` input is not tested; add the invalid-format parser case with an independent literal result.                                            |
| S335, S336, S337, S338     | 1 (`Regex`)                                                                  | U           | Anchoring and complete server-ID validation are core canonicalization behavior; add invalid-prefix, invalid-suffix, and multi-character valid cases. |
| S339, S340                 | 2 (`Regex`)                                                                  | U           | Unsafe runs must collapse to one underscore and safe runs must remain unchanged; add repeated-separator and mixed-name cases.                        |
| S341, S342, S343, S344     | 3 (`Regex`)                                                                  | U           | Leading and trailing underscore trimming needs independent edge assertions.                                                                          |
| S345, S346                 | 5-6 (`StringLiteral`)                                                        | U           | Prefix and separator literals define the persisted tool-ID format; assert them independently of parser reuse.                                        |
| S374                       | 46 (`EqualityOperator`)                                                      | U           | The 64-character boundary is not tested; add exactly-at-limit and one-over-limit cases.                                                              |
| S385                       | 55 (`ConditionalExpression`)                                                 | U           | Noncanonical parser inputs need a direct invalid-format branch assertion.                                                                            |

#### Child layer 1 repair result (2026-08-15; PR #391 active)

The baseline inventory above is historical and remains unchanged. This child
layer is complete locally but is not merged or shipped. The source file was
temporarily mutated only with the exact native replacements listed above and
restored byte-for-byte (`sha256 e39d27869998b3d3b87fa2faedeb97cdd1bc60074f77533610f1a33a8e2f44b2`).
The three added assertions cover invalid-format parsing for a non-`mcp__` id,
trimming every safe underscore at both tool-name edges while preserving
interior separators, and acceptance of the serialized 64-character boundary;
the existing 65-character rejection remains in place.

- Parser prefix and invalid-format result (`NC387`–`NC390`, `S385`): exact
  NC387 block deletion and exact S385 `false` condition each made the new
  non-`mcp__` assertion fail (`noncanonical` instead of `invalid_format`);
  source restoration returned the direct suite to green. All five are killed;
  the four baseline no-coverage mutants are covered.
- Server-id validation (`S335`–`S338`): exact S335 replacement
  (`/[A-Za-z0-9_-]+$/u`) made the existing invalid-server assertions fail.
  Exact S336 (`/[A-Za-z0-9_-]+/u`) failed two tests: `bad/server` was accepted
  as `mcp__bad/server__search`, and the parser accepted
  `mcp__bad/server__search` instead of returning `invalid_server_id`. Exact
  S337 (`/^[A-Za-z0-9_-]$/u`) and S338 (`/^[^A-Za-z0-9_-]+$/u`) each failed
  10/17 tests: every valid multi-character-server create/parse behavior
  returned `invalid_server_id`, including the expected `empty_tool_name`,
  `overlength`, `noncanonical`, and successful canonical results. Each source
  restoration returned the clean hash; all four native survivors are `R` from
  these exact direct-test failures.
- Unsafe-run collapse (`S339`, `S340`): exact S339 replacement
  (`/[^A-Za-z0-9_-]/gu`) made the existing normalization assertion fail with
  repeated underscores. Exact S340 (`/[A-Za-z0-9_-]+/gu`) failed 9/17 tests:
  the two normalization cases produced `mcp__Web_Server-1__/` and
  `"mcp__web__  _..._///_  "`, edge trimming returned `empty_tool_name`, `東京`
  was accepted unchanged, overlength/exact-64/canonical-parse cases returned
  `empty_tool_name`, and the parser accepted `mcp__web__東京` while rejecting
  the 55-character case as `empty_tool_name`. Both native survivors are `R`
  from these exact direct-test failures.
- Edge trimming (`S341`–`S344`): exact S341 (`/_+|_+$/gu`) and S343
  (`/^_+|_+/gu`) each failed 4/17 tests: the three create/canonicalization
  cases lost interior underscores (`FindDocs`, `FindDocsNOW`, and `FindDocs`),
  and canonical parsing returned `noncanonical`. Exact S342 (`/^_|_+$/gu`)
  failed the new edge-trim assertion after passing the old suite. Exact S344
  (`/^_+|_$/gu`) failed the new edge-trim assertion with
  `mcp__web__Find__Docs_` (the trailing underscore remained). All four native
  survivors are `R` from these exact direct-test failures.
- Persisted prefix/separator (`S345`, `S346`): exact S345 prefix replacement
  (`''`) made existing generated/parser assertions fail. Exact S346 (`''`)
  failed 10/17 tests: the three normal create cases omitted the `__` separator,
  the 55-character input was accepted instead of `overlength`, the exact-64
  result omitted the separator, canonical parsing failed as `invalid_server_id`,
  and four parser cases returned `invalid_server_id` instead of their expected
  format/canonical/tool-name/length reasons. Both native survivors are `R` from
  these exact direct-test failures.
- Serialized length (`S374`): exact `>=` replacement passed the old suite, then
  failed the new exact-64 assertion; restoration returned 17/17 green. The
  mutant is killed and the 65-character rejection remains covered.

The post-repair direct suite is 17/17. The native one-file run used the
committed Stryker configuration with CLI scope overrides (no temporary config,
wrapper, parser, or custom harness):
`/usr/bin/time -v pnpm --filter api exec stryker run --mutate src/mcp/tool-id.ts --testFiles src/mcp/tool-id.test.ts`.
It measured 90 mutants: 78 killed, 12 survived, 0 no coverage, 0 timeout, and
0 errors; mutation score 86.67% (covered-mutant rate 86.67%), 16.56 seconds
wall time, 223048 kB peak RSS, and 0 swaps. The scoped report renumbered these
survivors `0`–`11`; identical file lines and replacements map them to baseline
`S335`–`S346`. All are `R` based on the exact manual failures above, and no
useful `U` survivor remains in `tool-id.ts`. The literal task command
with `pnpm --filter api test:mutation -- --mutate ...` forwarded an extra
separator and failed before Stryker started, so it was not retried.

The remaining repair slices should target the `U` rows that guard byte limits,
SSE framing, and protected-value propagation. `E` rows should not be
suppressed or changed in Stryker configuration; they remain documented hypotheses
until a supported-input contract changes. `I` rows are deliberately outside the
pilot's first contract and should not be converted into broad robustness tests
without an explicit caller requirement. `R` is evidence-only: retain the exact
replacement and manual failure proof, and never use it as a waiver or ignore bucket.

### Conventions and governance

| State  | Finding                                                                                                                                                               | Evidence / exit condition                                                                                                                                                                                                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| active | **No-go: trade reviewable delivery for local batching or further polish**                                                                                             | Publish the ready current pilot without waiting for repairs, then submit the four queued child layers independently; do not batch the 100 useful gaps into one local-only repair commit                                                                                                                                                                |
| active | **No-go: run resource-unbounded aggregate builds on agent workstations**                                                                                              | Build affected workspaces sequentially; if the aggregate is required, use Turbo `--concurrency=1` and keep it foreground/observable                                                                                                                                                                                                                    |
| active | **No-go: classify recurrent flakes as test noise or make them green through timeout/retry inflation, forced actions, sleeps, source-regex acceptance, or rerun luck** | Treat recurrence as evidence of a latent product, lifecycle, isolation, or test-architecture defect; remove the nondeterministic dependency, prove behavior through the owning standard runner, order interactions behind observable application readiness, retain `failOnFlakyTests`, and use retries only to diagnose rather than accept the failure |
| active | **No-go: claim a vendored dependency is unmodified while carrying local patches**                                                                                     | Enumerate each patch and regression in `UPSTREAM.md`, reconcile it on every upstream refresh, and delete it once upstream carries the equivalent fix                                                                                                                                                                                                   |
| active | Existing conventions are defaults, not immunity from architectural review                                                                                             | Replace a convention when evidence shows material quality, readability, or architecture gains; document and migrate the owned scope, never create a silent one-off divergence                                                                                                                                                                          |
| active | Keep this tracker current in every quality stack layer                                                                                                                | Layer changes state and adds PR/evidence before submission                                                                                                                                                                                                                                                                                             |
| active | Modified cyclomatic complexity must stay at `<= 35` and refactors must follow real responsibility boundaries                                                          | `AGENTS.md`; arbitrary helper extraction, inline disables, and other metric gaming are prohibited; active until remote merge                                                                                                                                                                                                                           |
| queued | Root convention must distinguish capability interfaces from interface ceremony                                                                                        | State the four valid boundary reasons and reject one-interface-per-service cargo culting                                                                                                                                                                                                                                                               |
| queued | Complexity exceptions need local rationale and owner                                                                                                                  | No directory-wide exemption; temporary exception names issue and measured value                                                                                                                                                                                                                                                                        |
| queued | Gate runtime budgets are unrecorded                                                                                                                                   | Record local and CI duration before making mutation or expensive analysis blocking                                                                                                                                                                                                                                                                     |
| queued | Quality work must update `CHANGELOG.md`; roadmap entries are removed only when shipped                                                                                | Follow root documentation contract in implementation layers                                                                                                                                                                                                                                                                                            |

### Documentation, specification, and ownership drift

| State  | Finding                                                                    | Evidence / exit condition                                                                                                    |
| ------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| done   | Runtime floor is consistently documented as Node 22.19+                    | `package.json`, `.npmrc`, `pnpm-workspace.yaml`, and runtime decision doc agree; `.node-version` pins 22.23.1                |
| done   | Root migration policy matches the API's reviewed exception ledger          | Drizzle generation remains the default; security/data-transition exceptions require documented regeneration and verification |
| done   | Test documentation matches uncached execution                              | `docs/testing.md` now reflects `turbo.json` for unit/Storybook and direct non-Turbo integration/eval/e2e gates               |
| done   | Root formatting command documents its real owned surface                   | `pnpm format` is described as ignore-pruned repository-wide Prettier with cache, matching `package.json`                     |
| queued | `SPEC.md` links an archived OpenSpec change as if it were active authority | Retarget canonical behavior to `openspec/specs` and provenance to the archive; add link validation                           |
| queued | OpenSpec project rules and strict CI validation are absent                 | Define project context/rules, measure current validation failures, then add an authoritative check                           |
| queued | API and security-sensitive paths have no CODEOWNER                         | Assign explicit owners for backend, migrations, auth/security configuration, and workflows                                   |
| queued | Story provenance and documentation conventions are advisory only           | Add an AST/static metadata guard with an explicit exception manifest                                                         |
| done   | Every workspace has focused child instructions                             | `packages/config-typescript/AGENTS.md` names preset consumers, config-only boundaries, and sequential verification           |

### Generated API and queue contracts

| State       | Finding                                                                                           | Evidence / exit condition                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| queued      | The web app uses a hand-maintained `ky` API client and duplicates backend contract types          | Generate the TypeScript client and types from committed `apps/api/openapi.json` with a maintained OpenAPI generator; prove auth, errors, streaming exceptions, and drift in CI |
| investigate | Queue payloads and operations are code-first `defineQueue<T>` contracts with no AsyncAPI artifact | Inventory every producer, consumer, retry/dead-letter path, and schedule; prove AsyncAPI can be the canonical schema before replacing the existing types                       |
| investigate | AsyncAPI's maintained generators may not model the pg-boss transport adapter                      | Prototype a standard generator/template extension first; custom pg-boss codegen is allowed only for documented unsupported gaps and must have contract fixtures and an owner   |

### Workflow and supply-chain checks

| State  | Finding                                                                          | Evidence / exit condition                                                                                                                        |
| ------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| done   | Workflow syntax and action-pin validation are shipped and green on the baseline  | Workflow-lint CI owns both gates; `actionlint` and `pinact run --check` re-run locally on 2026-08-14                                             |
| queued | Pedantic workflow security reports seven findings, concentrated in `git-ai.yaml` | Review broad write permission, installer provenance, concurrency, job naming, and reusable-workflow permissions; rerun actionlint/zizmor/pinact  |
| done   | Structural ast-grep enforcement is full-tree and shared by local/CI gates        | `pnpm lint:ast-grep` owns only API decorator placement; maintained anti-slop Oxlint replaces the two bespoke double-assertion rules (#287, #286) |
| done   | Semantic Markdown enforcement is shared by local/CI gates                        | `pnpm lint:markdown` owns the explicit product-documentation scope with zero baseline, inline disable, or custom wrapper                         |
| done   | Native Oxlint rejects unused disable directives in all four workspaces           | Existing Turbo, Lefthook, and CI lint paths share the workspace commands; 48 stale directives removed with no baseline                           |

## Rejected shortcuts

- Enable every Oxlint category and suppress the fallout.
- Set complexity just above the current maximum and call it enforcement.
- Generate an interface for every service without a second implementation or narrow
  consumer boundary.
- Add mutation testing to the full monorepo or browser suite before a measured pilot.
- Convert all 113 cast lines in one unreviewable PR; use coherent boundary slices,
  but finish every slice before closing #268.
- Keep a diff-scoped gate, baseline, or allowlist as the finished state.
- Build repository-specific parsers or rule-test harnesses when a maintained tool
  provides native configuration and execution.
- Enable all 15 anti-slop rules at once, or reject the whole project because it is
  new; qualify each rule against real llame code, prefer native coverage where it
  is equivalent, and migrate every adopted rule to a zero baseline.
- Treat Prettier as semantic Markdown linting.

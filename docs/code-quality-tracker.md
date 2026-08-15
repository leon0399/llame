# Code Quality Taser Tracker

Living tracker for the constraints and refactors that make low-quality generated
code fail early. This is not a claim that automation creates good code. It records
which failure modes are measured, which gates exist, and where judgment is still
required.

**Baseline:** `master` at `8bca868e`, measured 2026-08-14.

**States:** `done` shipped; `ready` complete locally and awaiting submission;
`active` current stack ownership; `queued` evidence-backed; `investigate`
measurement needed before implementation.

## Active stack

| Order | State       | Layer                                   | Acceptance evidence                                                                                                                          |
| ----: | ----------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | active      | Tracker and design baseline             | Documents match live configuration, issue #268, and measured debt                                                                            |
|     2 | active      | Web test doubles                        | Web has zero matches using Vitest, Storybook, and native Web API types; 340 unit and 300 browser tests pass                                  |
|     3 | active      | Complexity ceiling and first extraction | Four native Oxlint configs enforce modified complexity 35; the 53-point function measures 30 after a boundary extraction                     |
|     4 | active      | AI SDK model doubles                    | 14 assertions removed; focused units 11/11, compaction integration 17/17, and API typecheck/lint pass                                        |
|     5 | active      | Remaining cast slices                   | Standard SDK/framework types and real database transactions remove all 80 assertions across owned application and test code                  |
|     6 | active      | Full-tree double-assertion prohibition  | Maintained anti-slop Oxlint rejects every chained assertion across all five owned lint scopes in hooks and CI                                |
|     7 | active      | Constructor decorator placement (#286)  | All 46 `@Inject` constructor parameters use split placement; native ast-grep rejects inline regressions                                      |
|     8 | active      | Semantic Markdown and lint ratchets     | Pinned markdownlint-cli2 scans 200 product-owned files with zero findings through the same local/CI command                                  |
|     9 | active      | Unused lint-disable ratchet             | Native Oxlint enforcement removed 48 stale directives and reports zero across all four lint-owning workspaces                                |
|    10 | active      | Contributor documentation contracts     | Runtime, migration, formatting, and test-cache claims match their executable configuration                                                   |
|    11 | active      | Shared TypeScript config ownership      | The final workspace has focused instructions naming preset fan-out, boundaries, and sequential consumer verification                         |
|    12 | active      | Mutation-testing pilot                  | PR #390 carries the native baseline; PRs #391–#394 repair all four child slices; no useful pilot `U` gap remains                             |
|    13 | investigate | Modular/service refactors               | Only measured coupling or responsibility hotspots become layers                                                                              |
|    14 | active      | Unsafe assertion boundary foundation    | One shared JSON-record guard replaces four duplicates; bounded-fetch removes one unsafe cast and the native inventory falls from 282 to 281  |
|    15 | active      | Persisted tool-observation validation   | Runtime record and safe-integer guards remove seven assertions; malformed replay and checkpoint writes fail closed; inventory reaches 274/81 |
|    16 | active      | MCP declaration-schema canonicalization | A truthful outer-record overload plus typed fixtures remove five assertions without widening canonicalization; inventory reaches 269/79      |
|    17 | active      | MCP SDK executor binding                | Two assertions removed; direct 59/59; `constructor` accepted; accessors/prototype-only names refused; inventory 267/77                       |
|    18 | active      | Tool schema admission                   | Three production assertions removed; structural Zod evidence and owned generated schemas; focused 89/89; inventory 264/76                    |
|    19 | active      | MCP HTTP test fixture                   | Four assertions removed through shared record evidence and native address narrowing; focused 76/76; inventory 260/75                         |
|    20 | active      | Tool-result truncation boundary         | Seventeen assertions removed through parsed success-record evidence and Zod-backed tests; focused 46/46; inventory 243/72                    |
|    21 | active      | Anti-slop foundation                    | Vendored upstream at `446268e`; three clean rules enforced; 1,125 findings measured for twelve remediation layers                            |
|    22 | active      | Product E2E deterministic readiness     | Owned production boot + post-settlement MCP UI; run 31902894988 passed 21/21 without retries; issue #403                                     |

## Published PR stack

Publication here means the PR exists in the remote stack; it does not mean the
layer is merged or shipped. Layer state remains active until merge.

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

## Current submission

| State     | Layer                                   | Commit evidence                                                                                                                       | PR   |
| --------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| submitted | MCP declaration-schema canonicalization | `0bf5468` removes five schema-boundary assertions with a truthful record overload and typed fixtures; native inventory reaches 269/79 | #397 |
| submitted | MCP SDK executor binding                | `d9c96cb6` removes the final MCP production and paired test assertions; inventory 267/77                                              | #398 |
| submitted | Tool schema admission                   | `24905194` removes three production assertions while preserving raw schema identity and dialects; inventory 264/76                    | #399 |
| submitted | MCP HTTP test fixture                   | `6b4daa8a` removes four fixture assertions while preserving request summaries and loopback cleanup; inventory 260/75                  | #400 |
| submitted | Tool-result truncation boundary         | `7e7d2bff` removes 17 assertions and rejects malformed oversized projections; focused 46/46; inventory 243/72                         | #401 |
| submitted | Anti-slop foundation                    | `6bd13fdb` replaces the bespoke double-assertion gate with three zero-baseline rules; the remaining twelve total 1,125 diagnostics    | #402 |
| submitted | Product E2E deterministic readiness     | `b3837fd1` owns production readiness and orders streamed UI after settlement; run 31902894988 passed 21/21 without retries            | #402 |

## Inventory

### Typing and assertions

| State       | Finding                                                                                                  | Evidence / exit condition                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| done        | API convention bans `as unknown as T` and gives the `Pick<>` plus explicit Nest injection-token recipe   | `apps/api/AGENTS.md`; PR #285                                                                                                                           |
| active      | Double assertions are prohibited across all five owned lint scopes                                       | Maintained anti-slop Oxlint scans root E2E plus API, web, UI, and Storybook through their normal Lefthook/Turbo/CI paths                                |
| active      | Web test and story doubles contained 19 assertions across 14 files                                       | Zero web matches; 340 web unit tests and 300 Storybook browser tests pass                                                                               |
| active      | `MessagePart` explicitly names `ModelSwitchPart`, `ToolAvailabilityPart`, and `RecencyDigestPart`        | Corrects the pre-existing stored-message type gap without an assertion                                                                                  |
| active      | AI SDK model doubles removed 13 assertions from `model-client.test.ts` and 1 from `fake-model-client.ts` | Partial Vitest mocks, `MockLanguageModelV3`, and real `streamText` with typed provider chunks; units 11/11                                              |
| active      | OpenAI adapter tool-loop tests removed 9 assertions without OpenAI-specific model doubles                | Provider-boundary `MockLanguageModelV3` drives real SDK scheduling, validation, and repair; focused units 8/8                                           |
| active      | API app-setup, auth, models, and runs tests removed 16 assertions                                        | Narrow Nest capabilities, `ExecutionContextHost`, Express `Pick<>`, and `drizzle.mock`; focused units 29/29                                             |
| active      | Chats controller tests removed 6 assertions                                                              | Real Node writable streams, typed Vitest spies, Drizzle mock DB, and provider-neutral AI SDK stream result; units 22/22                                 |
| active      | Chat-loop integration tests removed 7 assertions                                                         | Existing narrow service contracts and complete built-in config; real-Postgres integration 19/19                                                         |
| active      | Search worker tests removed 6 assertions                                                                 | Nest `TestingModule`, public bootstrap lifecycle, provider overrides, and prototype logger spies; units 4/4                                             |
| active      | Compaction continuity integration removed 5 assertions                                                   | AI SDK `MockLanguageModelV3`, real `streamText`, typed provider chunks, and public `asSchema`; integration 17/17                                        |
| active      | Pins tests removed 4 assertions                                                                          | Nest `TestingModule` provider overrides replace forged concrete service and tenant DB instances; units 11/11                                            |
| active      | Worker harness removed 1 forged AI SDK result                                                            | Provider-neutral `MockLanguageModelV3` drives real `streamText`; worker integration 10/10 and model units 15/15                                         |
| active      | Shared and worker-mode integration fakes removed 4 forged AI SDK results                                 | One shared provider-neutral `MockLanguageModelV3` client drives real `streamText`; support unit 1/1 and affected integration suites 24/24               |
| active      | Auth service tests removed 3 concrete-class double assertions                                            | Exported `Pick<>` capabilities plus explicit Nest injection tokens preserve mock metadata and runtime DI; units 3/3                                     |
| active      | Tenant DB service tests removed 2 forged Drizzle database assertions                                     | Narrow transaction capability, Drizzle's mock driver, and typed Vitest spies replace partial database objects; units 6/6                                |
| active      | HTTP integration support removed 3 `set-cookie` header assertions                                        | Superagent's typed `get('Set-Cookie')` overload and the shared cookie extractor replace direct header-map coercions; integrations 15/15                 |
| active      | Instance config consumers removed 2 concrete-service assertions                                          | Existing `InstanceConfigReader`, explicit Nest tokens, and complete built-in config fixtures replace partial config objects; units 15/15                |
| active      | Tool-context units removed 2 concrete tenant-database assertions                                         | Existing `TenantRunner`, Drizzle's mock DB, and a repository spy exercise the real callback boundary; units 23/23                                       |
| active      | Remaining service fixtures removed 2 concrete-service assertions                                         | Existing `RunStreamResponder` plus source-owned `ChatReindexDispatcher` capabilities replace concrete bridge/dispatch fixtures                          |
| active      | Negative runtime fixtures removed 3 double assertions                                                    | Structural supersets and accurately broad validated inputs replace casts without weakening `User`, registered `Tool`, or `MessagePart`                  |
| active      | Database/lifecycle boundaries removed 2 double assertions                                                | Native Drizzle mock replaces an unused forged chain; typed factory client ownership preserves graceful worker teardown                                  |
| active      | Model-context repository removed 1 forged database assertion                                             | Real Postgres covers five reachable hash-collision branches; impossible simulated source/availability collisions are deleted                            |
| active      | Chats repository removed 1 forged fluent database assertion                                              | Drizzle's native mock and public logger compile real SQL/params; focused units 35/35 and >500-row fork integration 6/6                                  |
| active      | Chat-loop transaction binding removed the final forged database assertion                                | 17 orchestration cases use the real `TenantDbService`/Drizzle transaction boundary; 3 pre-transaction guards remain fast units                          |
| done        | Zero owned application/test matches remain                                                               | Full-tree inventory reports zero across tracked TS/TSX/MTS/CTS; no grandfathered baseline                                                               |
| active      | Five-scope chained-assertion enforcement                                                                 | Maintained anti-slop Oxlint covers root E2E plus four workspaces in Lefthook/CI; the old diff script and two bespoke ast-grep rules are deleted         |
| active      | API unsafe narrowing assertions are measured for zero-baseline migration                                 | Native type-aware Oxlint fell from 282/83 through 281/82, 274/81, 269/79, 267/77, 264/76, 260/75, then 243/72; slices must reach zero before enablement |
| investigate | Direct `any` and non-null assertions                                                                     | Classify production vs test/integration scaffolding before enabling restriction rules                                                                   |

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

### Lint and formatting

| State  | Finding                                                                                    | Evidence / exit condition                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| done   | Prettier checks all owned repository files, including Markdown/MDX, JSON(C), YAML, and CSS | Root `format:check`, `.prettierignore`, lint workflow, staged hook                                                                                                                    |
| done   | Oxlint runs with warnings denied in API, web, UI, and Storybook                            | Workspace `lint` scripts and Turbo                                                                                                                                                    |
| queued | API is type-aware; other workspaces are substantially lighter                              | Compare the four `.oxlintrc.json` files; enable supported rule families only after violation review                                                                                   |
| active | Semantic Markdown is linted across 200 product-owned files                                 | Pinned markdownlint-cli2 0.23.2 reports zero findings; only upstream/generated integrations and symlink aliases are excluded                                                          |
| active | Unused lint-disable directives are rejected in every lint-owning workspace                 | Native Oxlint enforcement removed 48 stale directives; API, web, UI, and Storybook each report zero                                                                                   |
| queued | Four Vitest rules are disabled in API                                                      | Ratchet one rule per slice and repair findings, as already required by `docs/testing.md`                                                                                              |
| active | Constructor parameter decorator placement is standardized (#286): 46 split, zero inline    | Native ast-grep scopes enforcement to `@Inject` constructor parameters; no wrapper, diff parser, or custom harness                                                                    |
| active | All 15 `dmmulroy/anti-slop` Oxlint rules are adoption targets                              | Three zero-baseline rules are enforced from upstream `446268e`; twelve measured rules require repository-wide remediation; only validated `unknown` inputs may carry local exceptions |

#### `anti-slop` rule qualification (2026-08-15)

Source review and the vendored rule source are pinned to
`dmmulroy/anti-slop@446268e`. A Git dependency is not viable because Node refuses
to strip the package's exported TypeScript under `node_modules`; compiling a
private package fork would add needless ownership. The provenance-pinned vendor
therefore remains unmodified, while llame owns configuration outside it. Oxlint
and `@oxlint/plugins` are paired at mature 1.77.0, with type-aware
`oxlint-tsgolint` 7.0.2001; this avoids bypassing the seven-day release-age gate
for 1.78.0. A rule becomes an error only in the PR that removes every existing
owned finding; no baseline, allowlist, or file-level override is acceptable.

| State  | Upstream rule                               | llame disposition                                                                                                              |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| active | `no-chained-type-assertions`                | Zero across five owned scopes; replaces the two narrower bespoke ast-grep rules and remains enforced by standard Oxlint paths. |
| queued | `no-conditional-empty-object-spread`        | 147 diagnostics/50 files; preserve exact omission semantics rather than replacing omission with unconditional `undefined`.     |
| queued | `no-known-value-widening`                   | 47 diagnostics/30 files; repair with inference, `satisfies`, or named owner contracts.                                         |
| queued | `no-module-mocking`                         | 81 diagnostics/34 files; replace module mocks with real dependency seams or faithful implementations, never overrides.         |
| queued | `no-object-parameters`                      | Three diagnostics/three files; replace broad `object` inputs with owner types or boundary parsers.                             |
| queued | `no-reflect-apply`                          | Two diagnostics in one file; replace dynamic dispatch with typed calls/interfaces.                                             |
| queued | `no-reflect-get`                            | Four diagnostics/four files; parse boundaries or use typed property access.                                                    |
| queued | `no-runtime-typeof`                         | 202 diagnostics/77 files; replace ad hoc representation narrowing with boundary schemas and parsed domain values.              |
| queued | `no-shape-in-symbol-names`                  | Five diagnostics/three files; rename structural placeholders to their domain roles.                                            |
| queued | `no-unknown-parameters`                     | 142 diagnostics/64 files; only immediate validation may retain a local suppression with a specific explanation.                |
| queued | `no-unknown-returns`                        | 18 diagnostics/15 files; parse where the producing layer owns the contract instead of exporting raw `unknown`.                 |
| active | `no-unknown-type-aliases`                   | Zero across five owned scopes and enforced through root plus workspace Oxlint.                                                 |
| queued | `no-unsafe-dictionary-type`                 | 88 diagnostics/50 files; replace open top-type dictionaries with schema/owner-derived contracts, never `any`.                  |
| active | `no-widen-then-assert`                      | Zero across five owned scopes; blocks local evidence erasure before it becomes unsafe-assertion debt.                          |
| queued | `require-safety-comment-for-type-assertion` | 386 diagnostics/142 files; enable after unsafe assertions reach zero, documenting only rare unexpressible invariants.          |

The remaining 1,125 diagnostics are remediation inventory, not a tolerated
baseline. Adopt rules in reviewable layers rather than enabling the all-on preset
over unrepaired source; newness is not a rejection criterion.

### Complexity and structure

| State       | Finding                                                                                                                      | Evidence / exit condition                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| queued      | Lower-threshold debt remains: modified complexity over 20 is API 12, web 3, UI 1 (unchanged in the 2026-08-14 remeasurement) | Ratchet toward 30 and then 20 remains queued evidence-driven work                                                                               |
| active      | Four lint-owning workspaces enforce modified complexity 35 with Oxlint's native rule                                         | `apps/api/.oxlintrc.json`, `apps/web/.oxlintrc.json`, `packages/ui/.oxlintrc.json`, and `apps/storybook/.oxlintrc.json`; forced lint passes     |
| active      | `chat-loop.service.ts` accepted-turn callback measures 30 after 53 before; private `buildTurnContextAndParts` measures 24    | Context-builder + chat-loop units 83/83; real-Docker chat-loop integration 19/19; forced lint and API typecheck pass; active until remote merge |
| queued      | Next API values above 30: MCP client callback 34, prompt assertion 32                                                        | Lower the ceiling only after each is repaired in a separate evidence-backed slice                                                               |
| queued      | Files over 1,000 lines include production services/repositories and large test suites                                        | File length is triage only; split by responsibility, not arbitrary line count                                                                   |
| investigate | `run-execution.service.ts`, `mcp-server-client.ts`, and `chats-repository.ts` are production hotspots                        | Map responsibilities and dependency fan-in before proposing interfaces/modules                                                                  |
| investigate | Web `chat-page.tsx` and conversation tree are large UI orchestrators                                                         | Require render/interaction evidence and consult `DESIGN.md` before any UI split                                                                 |

### Test quality

| State       | Finding                                                                                          | Evidence / exit condition                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| done        | Unit, real-Postgres integration, Storybook browser, and product E2E are separate enforced layers | `docs/testing.md`, CI workflow                                                                                                                                                                                                    |
| done        | Bounded mutation-testing command and configuration                                               | `apps/api/stryker.config.json` limits mutation to three pure MCP utilities, uses pinned `@stryker-mutator/vitest-runner@9.6.1`, keeps Stryker and Vitest at one worker, and emits native reports; no broad CI gate initially      |
| active      | First pilot candidate: three pure MCP utilities with direct unit tests                           | PR #390: 33 tests and 425 mutants; the 2026-08-15 baseline is 69.41% with 101 survivors, 29 no-coverage mutants, and 6 timeouts; disposition inventory follows below                                                              |
| active      | Child layer 1: tool-id canonicalization/parser                                                   | PR #391: three behavior assertions cover invalid-format parsing, edge trimming, and the exact 64-character boundary; six baseline `U` gaps are repaired and 12 baseline survivors are reclassified `R` with exact manual evidence |
| active      | Child layer 2: protected-values normalization/propagation                                        | PR #392: 17 baseline `U` gaps are killed, marker `S169` is reclassified `R` with an exact manual failure, and comparator/tie mutants `S191`–`S195` plus `S255` are reclassified `E`; no useful protected-values gap remains       |
| active      | Child layer 3: bounded-fetch request parsing/body sizing/response byte-limit semantics           | PR #393: 39 baseline `U` gaps are killed and `S12`, `S16`, and `NC58` are reclassified `E` for the supported `BodyInit` domain; no useful layer-3 gap remains                                                                     |
| active      | Child layer 4: bounded-fetch SSE recognition/framing plus wrapper cancellation/metadata          | PR #394: eight behavior assertions kill all 16 queued `U` mutants; the native 169-mutant run kills 152 at 89.94%, and no useful layer-4 gap remains                                                                               |
| done        | API README command inventory                                                                     | The workspace README lists executable commands only; it does not document a nonexistent coverage script or invent coverage tooling                                                                                                |
| queued      | Source-regex tests and disabled Vitest rules remain known follow-ups                             | Existing `docs/testing.md` list; convert when owning files are touched                                                                                                                                                            |
| investigate | The committed OpenAPI contract has no generated property-based conformance run                   | Pilot Schemathesis against the throwaway API/Postgres environment; measure auth and tenant setup, status/schema findings, replayability, runtime, and false positives before gating                                               |
| investigate | The chat-message single-flight integration test flakes only under suite load                     | Timed out on PR #361 and locally in the full 329-test run; isolated rerun passes 1/1; diagnose scheduling/state coupling before changing timeouts                                                                                 |
| active      | Product E2E races dev compilation and actively streamed UI                                       | PR #402 reproduced prior #361/#367 auth debt and an MCP modal detach; run 31902894988 passed 21/21 without retries after owned production boot and post-settlement modal ordering                                                 |

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

| State  | Finding                                                                                                      | Evidence / exit condition                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| active | **No-go: trade reviewable delivery for local batching or further polish**                                    | Publish the ready current pilot without waiting for repairs, then submit the four queued child layers independently; do not batch the 100 useful gaps into one local-only repair commit |
| active | **No-go: run resource-unbounded aggregate builds on agent workstations**                                     | Build affected workspaces sequentially; if the aggregate is required, use Turbo `--concurrency=1` and keep it foreground/observable                                                     |
| active | **No-go: make flaky E2E green through timeout/retry inflation, forced actions, or rerun luck**               | Remove infrastructure work from assertion clocks and order interactions behind observable application readiness; retain `failOnFlakyTests` and diagnostic retries                       |
| active | Existing conventions are defaults, not immunity from architectural review                                    | Replace a convention when evidence shows material quality, readability, or architecture gains; document and migrate the owned scope, never create a silent one-off divergence           |
| active | Keep this tracker current in every quality stack layer                                                       | Layer changes state and adds PR/evidence before submission                                                                                                                              |
| active | Modified cyclomatic complexity must stay at `<= 35` and refactors must follow real responsibility boundaries | `AGENTS.md`; arbitrary helper extraction, inline disables, and other metric gaming are prohibited; active until remote merge                                                            |
| queued | Root convention must distinguish capability interfaces from interface ceremony                               | State the four valid boundary reasons and reject one-interface-per-service cargo culting                                                                                                |
| queued | Complexity exceptions need local rationale and owner                                                         | No directory-wide exemption; temporary exception names issue and measured value                                                                                                         |
| queued | Gate runtime budgets are unrecorded                                                                          | Record local and CI duration before making mutation or expensive analysis blocking                                                                                                      |
| queued | Quality work must update `CHANGELOG.md`; roadmap entries are removed only when shipped                       | Follow root documentation contract in implementation layers                                                                                                                             |

### Documentation, specification, and ownership drift

| State  | Finding                                                                    | Evidence / exit condition                                                                                                    |
| ------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| active | Runtime floor is consistently documented as Node 22.19+                    | `package.json`, `.npmrc`, `pnpm-workspace.yaml`, and runtime decision doc agree; `.node-version` pins 22.23.1                |
| active | Root migration policy matches the API's reviewed exception ledger          | Drizzle generation remains the default; security/data-transition exceptions require documented regeneration and verification |
| active | Test documentation matches uncached execution                              | `docs/testing.md` now reflects `turbo.json` for unit/Storybook and direct non-Turbo integration/eval/e2e gates               |
| active | Root formatting command documents its real owned surface                   | `pnpm format` is described as ignore-pruned repository-wide Prettier with cache, matching `package.json`                     |
| queued | `SPEC.md` links an archived OpenSpec change as if it were active authority | Retarget canonical behavior to `openspec/specs` and provenance to the archive; add link validation                           |
| queued | OpenSpec project rules and strict CI validation are absent                 | Define project context/rules, measure current validation failures, then add an authoritative check                           |
| queued | API and security-sensitive paths have no CODEOWNER                         | Assign explicit owners for backend, migrations, auth/security configuration, and workflows                                   |
| queued | Story provenance and documentation conventions are advisory only           | Add an AST/static metadata guard with an explicit exception manifest                                                         |
| active | Every workspace has focused child instructions                             | `packages/config-typescript/AGENTS.md` names preset consumers, config-only boundaries, and sequential verification           |

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
| active | Structural ast-grep enforcement is full-tree and shared by local/CI gates        | `pnpm lint:ast-grep` owns only API decorator placement; maintained anti-slop Oxlint replaces the two bespoke double-assertion rules (#287, #286) |
| active | Semantic Markdown enforcement is shared by local/CI gates                        | `pnpm lint:markdown` owns the explicit product-documentation scope with zero baseline, inline disable, or custom wrapper                         |
| active | Native Oxlint rejects unused disable directives in all four workspaces           | Existing Turbo, Lefthook, and CI lint paths share the workspace commands; 48 stale directives removed with no baseline                           |

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

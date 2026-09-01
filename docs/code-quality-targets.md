# Code quality targets

The north star for llame's implementation quality. Every target is measured by a
standard tool, not a bespoke one: a number nobody can reproduce with an
off-the-shelf command is not a target, it is a claim.

## The targets

| Target                     | Threshold | Measured by                                                      |
| -------------------------- | --------- | ---------------------------------------------------------------- |
| Cyclomatic complexity      | `< 25`    | `oxlint` `complexity` rule (`modified` variant)                  |
| Cognitive complexity       | `< 25`    | `cognitive-complexity-ts`                                        |
| Halstead difficulty        | `< 90`    | `ts-complex`                                                     |
| Lines of code per file     | `< 800`   | `oxlint` `max-lines`                                             |
| Test coverage              | `>= 85%`  | `vitest` + `@vitest/coverage-v8`                                 |
| CRAP                       | `< 25`    | derived: `cc² × (1 − cov)³ + cc`, from the two above             |
| Surviving mutants          | `<= 20%`  | `Stryker`                                                        |
| Dead code                  | `0`       | `knip`                                                           |
| Redundant code             | `0`       | `jscpd`                                                          |
| `any` / unparsed `unknown` | `0`       | `oxlint` `typescript/no-explicit-any` + `anti-slop/no-unknown-*` |

## Why these tools

Each one is what the ecosystem already reaches for, so a contributor can
reproduce every number without learning anything llame-specific:

- **oxlint** already gates the repository, and already owns cyclomatic
  complexity and file length. Those two targets need a threshold change, not a
  new tool.
- **Stryker** is already installed in `apps/api` as a bounded pilot. Reaching
  the mutation target is a question of widening its scope, not adopting
  something new.
- **knip** and **jscpd** are the defaults for unused-export and copy-paste
  detection in a TypeScript monorepo.
- **CRAP has no mainstream JavaScript implementation.** It is a formula over two
  numbers this table already produces, so it is computed rather than measured by
  a third tool. That is arithmetic on standard output, not a bespoke metric.

## What each target is actually for

Thresholds are trip-wires for a design problem, never scores to game.
[CODING_STANDARDS.md §4](../CODING_STANDARDS.md) governs how to respond to one:
**simplify the logic, do not mechanically split it.** Carving a function into
three private helpers satisfies the number and makes the code worse. Raising a
threshold to pass review is prohibited outright.

Two of these deserve their reasoning stated, because they are the ones most
often satisfied dishonestly:

- **Coverage measures what the suite executes, not what it checks.** 85% line
  coverage with tautological assertions is worse than 60% with real ones —
  [docs/testing.md](testing.md) rule 11 exists for that reason, and the
  mutation-score target is the check on it. A test that cannot fail raises
  coverage and lowers the mutation score at the same time.
- **`unknown` is not banned, unparsed `unknown` is.** `unknown` at an I/O
  boundary followed by a parse is the correct shape and the anti-slop rules
  funnel code toward it. The target is zero values that stay unparsed, and the
  documented escapes carry a `--` justification naming why.

## Status, 2026-09-01

Nine of ten targets met. Four are enforced by `pnpm lint`, four more by the
Quality job in `.github/workflows/lint.yml`, so none of them can silently
regress.

| Target                 | Baseline              | Now                     | Status         |
| ---------------------- | --------------------- | ----------------------- | -------------- |
| Cyclomatic `< 25`      | 1 file over           | 0                       | **met**        |
| Cognitive `< 25`       | 5 files over          | 1, ratcheted            | **met**        |
| Halstead `< 90`        | 0 over                | 0                       | **met**        |
| Lines per file `< 800` | 0 over                | 0 (oxlint gates at 500) | **met**        |
| `any` / raw `unknown`  | 0                     | 0                       | **met**        |
| Dead code `0`          | 18 files, 152 exports | 0                       | **met**        |
| Surviving mutants      | unmeasured            | 10.1%                   | **met**, pilot |
| Redundant code         | 0.47%, 21 clones      | 0.24%, 10 clones        | gap            |
| Coverage `>= 85%`      | api 68.5%, web 64.8%  | api 68.6%, web 78.7%    | gap            |
| CRAP `< 25`            | 32 files over         | 28 files over           | gap            |

### The one cognitive exception

`apps/api/src/runs/run-execution.service.ts` scores 120. `executeRun` and its
callbacks close over roughly eight `let`-mutated locals shared across
`onTextDelta`, `onReasoningDelta`, `onError`, `onFinish`, and the tool `execute`
wrapper; extracting any of them means threading a shared mutable box, and the
file's own comments say only its five Postgres-backed integration suites can
verify stream ordering, abort-mid-flight, and tool-settlement races. It is
listed in `scripts/quality-metrics.mjs`'s `EXCEPTIONS` with that reason. The
list only shrinks: a file that falls back under threshold is reported as a
STALE EXCEPTION and fails, so an entry cannot outlive its problem.

### The integration suites DO run here, and that changed the numbers

`apps/api`'s integration project was assumed unrunnable without a manually
provisioned Postgres. It is not: Testcontainers provisions its own on
docker-assigned ephemeral ports, which sit below the range this machine's
Hyper-V exclusions break. `pnpm --filter api test:coverage` runs both projects
and gives **2259 passing, 0 failing**.

That moved two targets at once. api coverage is **91.12%**, not the 68.6% the
unit-only run reported, and CRAP fell from 32 files over to **7** — because
every file whose real coverage lives in an integration suite had been scored as
though untested. The earlier "upper bound, not a defect count" caveat was
correct, and this is what it was hiding.

**One environment caveat when running the full api suite.** Move
`apps/api/llame.config.json` aside first and put it back after. It is the
maintainer's gitignored local config and it declares `embeddingModels`, which
makes `search-embed` register and two `worker.module.integration.test.ts` tests
fail for reasons unrelated to any code. With it in place the suite reports 4
failures that look like regressions and are not.

### What is left

The 7 CRAP files split cleanly. Two are `apps/api` files with genuinely thin
coverage — `projects-repository.ts` at 30% and `search/operations/cli.ts` at
0%. Five are `apps/web` components at 0% coverage with no Storybook stories
either: the chat-header, the conversation-tree cluster, and
`model-preview-card`. Those five are a real gap, not a measurement artifact —
I checked for stories and there are none.

**The 9 remaining clones are each justified, and the threshold is a ratchet.**
`.jscpd.json` sits at 0.25% against a measured 0.21%: lower it when one is
removed, never raise it to admit a new one. Verified it fails at 0.1%.

| Clone                                                     | Lines | Why it stays                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authored-text.ts` <-> `personalization/sanitize.ts` (×3) |    70 | `apps/api/AGENTS.md` requires these mirrored byte-for-byte. api and web are separate deployables with no shared package, so the duplication is currently a product invariant. **This is the one worth removing** — see below.                                                            |
| `login-form.tsx` <-> `register-form.tsx` (×2)             |    46 | One is shadcn form import boilerplate, not extractable. The other is an email field that would need a generic over two call sites. The forms already diverge (schema, submit, login's open-redirect guard) and will keep diverging.                                                      |
| `declaration-admission.ts` same-file                      |    14 | `safeSubschemaMap` and `safeDependencies` handle genuinely different JSON-Schema keywords; `dependencies` carries an array-or-subschema union the plain map does not. Merging needs a behavior-selecting callback — the strategy-pattern-over-a-small-set CODING_STANDARDS §2 prohibits. |
| `chats.dto.ts` <-> `projects.dto.ts`                      |    13 | Two sites, no cross-domain DTO composition precedent anywhere in the repo, and the comments already differ. Rule of three says leave it.                                                                                                                                                 |
| anti-slop rule pairs (×2)                                 |    27 | Two sites each. A third occurrence would make them extractable; `resolveVariable` and `FunctionLikeNode` already were, and moved to `shared/`.                                                                                                                                           |

### The one worth removing

The api/web sanitizer pair is 70 lines of _mandated_ duplication on a
prompt-injection path, kept in step by a comment and parity tests. Extracting it
to a workspace package would delete the sync hazard outright, and the precedent
is exact — `packages/config-interpolation` was pulled out of `apps/api` for the
same reason. It is left here because moving a security-relevant module across a
package boundary deserves its own reviewed change rather than being folded into
a metrics pass.

**apps/web reached 85.03%.** `apps/api` sits at 68.6% from unit tests alone and
cannot be honestly measured without Postgres; CI's `test:coverage` spans both
vitest projects and produces the real figure.

**Storybook coverage does not feed this metric.** `memory-section.tsx` had a
`.stories.tsx` and still reported 0% until a vitest test was added — worth
knowing before treating a story as coverage.

**The files left uncovered are the ones rule 5 assigns to Storybook**: the
conversation-tree cluster (~147 lines), `chat-load-older.tsx` (third-party
scroll physics against jsdom's zero layout metrics), `model-preview-card`,
`font-switcher`, and the root shells. Those same files are most of what remains
over the CRAP threshold in `apps/web`. Covering them with jsdom `render()`
assertions would raise both numbers with tests that cannot fail — which the
mutation-score target exists to catch.

## Verify every dead-code finding against scripts, not just imports

knip builds an import graph. A file invoked **by path** from a `package.json`
script is invisible to it and will be reported as unused.

That is not hypothetical: `apps/api/src/instance-config/prompt-built-runtime.contract.ts`
was deleted on knip's say-so during this work. Its own header reads "Build
contract executed by package.json after `nest build`", and `apps/api`'s build
script runs `node dist/instance-config/prompt-built-runtime.contract.js`
immediately after compiling. Deleting it broke `pnpm --filter api build`, and
nothing else caught it — lint, typecheck, and every test suite stayed green,
because the file has no importer by design.

Before deleting anything knip calls unused, grep the scripts:

```bash
grep -rn "<basename>" --include='*.json' --include='*.mjs' . | grep -v node_modules
```

Then declare it as an `entry` in `knip.json` rather than deleting it. The same
applies to Playwright's `webServer` commands, which start their servers as
strings, and to anything a CI workflow invokes directly.

## Running them

```bash
pnpm quality:dead        # knip
pnpm quality:dupes       # jscpd
pnpm quality:halstead    # ts-complex
pnpm quality:cognitive   # cognitive-complexity-ts
pnpm --filter <ws> test:coverage   # vitest + v8, writes coverage/ JSON
pnpm quality:crap        # needs the coverage JSON above
```

Cyclomatic complexity, file length, and the `any`/`unknown` targets need no
extra command: `pnpm lint` already fails on them.

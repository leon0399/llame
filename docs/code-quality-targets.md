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

## Baseline, 2026-09-01

Measured before any refactor. An unmeasured target is reported as unmeasured,
never as passing.

| Target                 | Baseline                                    | Status     |
| ---------------------- | ------------------------------------------- | ---------- |
| Cyclomatic `< 25`      | 1 file over (`e2e/support/model-server.ts`) | 1 gap      |
| Cognitive `< 25`       | 5 files over, worst 121                     | 5 gaps     |
| Halstead `< 90`        | 0 of 396 files over                         | **met**    |
| Lines per file `< 800` | 0 over (oxlint gates at 500, stricter)      | **met**    |
| `any` / raw `unknown`  | 0                                           | **met**    |
| Coverage `>= 85%`      | api 68.5%, web 64.8%, interpolation 85.0%   | 2 gaps     |
| CRAP `< 25`            | 32 files over, worst 453                    | 32 gaps    |
| Dead code `0`          | 5 files, 14 exports, 10 types, 6 deps       | in flight  |
| Redundant code `0`     | 21 production clones (0.47%)                | 21 gaps    |
| Surviving mutants      | unmeasured beyond the 3-file api pilot      | unmeasured |

Two caveats that change how these read:

- **`apps/api` coverage must span both vitest projects.** `test:coverage` runs
  unit and integration together, which is the only number that means anything:
  a large amount of API behavior is covered exclusively by Postgres-backed
  integration suites, and measuring units alone reports that code as untested.
  `test:coverage:unit` exists for hosts without Postgres, and its 68.5%
  baseline is "from unit tests alone", not "tested".
- **CRAP inherits that.** Every api file whose real coverage comes from an
  integration suite scores as though it were untested, so the 32 is an upper
  bound, not a defect count.

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

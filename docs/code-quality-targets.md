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

Seven of ten targets met. Four are enforced by `pnpm lint`, four more by the
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

### Why the last three gaps are partly unmeasurable here

**56 integration test files cannot run without Postgres**, and every one of the
worst CRAP files sits in a directory with several. `apps/api`'s 68.6% is
therefore "from unit tests alone", not "68.6% tested", and CRAP inherits the
same distortion: a file whose real coverage comes from an integration suite is
scored as though untested. Both numbers are upper bounds on the defect, not
counts of it. CI runs `test:coverage` across both vitest projects and gets the
true figure.

**The remaining 10 clones are each deliberate**, not a backlog. Three are the
api/web sanitizer pair that `apps/api/AGENTS.md` requires to stay mirrored
byte-for-byte across two deployables with no shared package. Two are
JSON-Schema helpers whose semantics genuinely differ, where merging would need
a behavior-selecting callback — the strategy-pattern-over-a-small-set
CODING_STANDARDS §2 prohibits. The rest are two-site pairs that the rule of
three says to leave, on surfaces already diverging.

**apps/web's remaining 6.4 points** are concentrated in component rendering,
which [docs/testing.md](testing.md) rule 5 places in Storybook play functions
rather than jsdom. Chasing them with `render()` assertions would raise the
number and lower the mutation score at once.

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

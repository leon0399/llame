# Mutation gate redesign: mutate the changed lines, gate on a level

Design and plan of record for replacing the pull-request mutation gate. When
this lands, the resulting contract belongs in [testing.md](testing.md) and the
gate row in [code-quality-targets.md](code-quality-targets.md); this note is the
rationale and is superseded by those.

## Why the current gate is being replaced

The current gate (issue #831) scopes pull requests to the diff and gates
**per-file growth in undetected mutants against a stored index**. A delta needs a prior measurement; a prior
measurement needs to be stored; storage needs a cache key; the key needs an
environment fingerprint; and only a trusted master run writes an index, so a
pull request whose tree changes any fingerprint input can never restore one. In
one day that chain stopped seven pull requests, each on a different file:

| symptom                                    | file                                                       |
| ------------------------------------------ | ---------------------------------------------------------- |
| global MSI 79.88% < 80%                    | whole corpus                                               |
| `Changed test coverage is not indexed`     | changed unit test, integration test                        |
| `Impact cannot be bounded`                 | migration, lint config, fixture, artifact, prompt markdown |
| `No compatible ancestor mutation baseline` | any fingerprint input                                      |

Each was patched separately (#839, #840, #841, #842): a test-credit rule, a
bypass, a migration exemption, a reader analysis, a fingerprint narrowing. That
is the signature of a design problem, not a bug list. Every one of those
mechanisms exists only to answer _“what did this diff affect, and did it make
things worse”_.

## The replacement

Ask the tool the question directly, at line granularity.

1. `git diff -U0 <base>` → hunk headers give the **changed line ranges** per file.
2. Pass them to Stryker as **mutation ranges** — `src/a.ts:12-18`,
   `src/a.ts:40-44` — through a generated configuration file rather than
   `--mutate`, because Linux caps one `argv` element at 131 072 bytes and a
   large refactor exceeds that.
3. Stryker mutates only those ranges. `coverageAnalysis: "perTest"` — already
   configured, and the equivalent of Infection's per-line test mapping — runs
   only the tests covering each mutant.
4. Gate: `killed / (killed + survived + noCoverage)` over the measured mutants
   `>= 80%`. `noCoverage` counts as undetected, so new code with no test fails.
5. No ranges, or none containing mutable code → nothing to run → **skip**.

Both mechanisms are documented in the installed `@stryker-mutator/core` schema:

- `coverageAnalysis` — _“During mutation testing, Stryker will try to only run
  the tests that cover a particular mutant.”_ Already set to `perTest`.
- `mutate` — _“It is possible to specify exactly which code blocks to mutate by
  means of a mutation range. This can be done postfixing your file with
  `:startLine[:startColumn]-endLine[:endColumn]`. Example: `src/index.js:1:3-1:5`.”_

## What this deletes

The baseline index and its merge/fold machinery, the environment fingerprint and
its cache keys, the ancestor-revision requirement, pull-request sharding, the
reader analysis, and every special case accumulated today: migrations, lint
configuration, fixtures, generated artifacts, prompt markdown, integration tests.
**The “unbounded impact” concept disappears**, and with it the approved-bypass
mechanism, because nothing remains that would need waiving. A pull request that
touches only such files has no mutants to measure and skips.

The weekly `mutation-baseline.yml` full sweep was kept at first as a
non-failing trend metric, then removed: eight API shards cost about 6.5
runner-hours a week for a score nobody consulted, and an unsharded run would
not fit GitHub's six-hour job limit.

## What it deliberately gives up

**Coverage removed without changing a source line.** A pull request that weakens
or deletes test cases changes no source line, so there are no mutants to measure
and the gate skips it. The current design catches this explicitly. The trade is
taken knowingly: it is the expensive part of the design, and review catches it.

The narrow mitigation if it is wanted later: when the diff touches a test file,
also mutate the changed source lines since the base. That catches _“removed a
test while changing the code it covered”_. Nothing cheap catches pure test
deletion.

Smaller edges to expect: a whitespace-only edit is a changed line whose mutants
still need killing; a newly added file is entirely changed, so a new untested
file fails — correct, and the reason `noCoverage` must count as undetected.

## Plan

- **B1** Prove the range syntax through the wrapper this repo invokes: `--mutate`
  takes a comma-separated list, and multiple ranges per file, plus the
  `progress-append-only` reporter and the shard arguments, all need checking.
  Everything else depends on this step.
- **B2** Choose the threshold’s shape: aggregate over changed lines, or per file.
  Aggregate is simpler; per file stops a well-covered file masking a poorly
  covered one in the same pull request.
- **B3** Decide whether to take the test-weakening hole described above, and
  whether to add its mitigation.
- **B4** Keep the weekly full sweep as a non-failing trend (later removed; see
  above).
- **B5** Retire #840 and #842, and remove the parts of #831 that exist only to
  serve the index.

---
name: resolve-mutation-gate
description: This skill should be used when the mutation gate fails, when a pull request reports survived or uncovered mutants, when asked to "kill mutants", "resolve mutation testing", "improve the mutation score", or when tests must be shown to detect changes on the lines a diff touched. Covers reading the changed-lines report and proving each new test detects its mutant without paying for repeated gate runs.
metadata:
  version: "1.0.0"
  scope: "llame-mutation-gate"
---

# Resolve the mutation gate

CI gates a pull request on the lines it changed: every mutant on those lines must be detected by a test. This skill covers reading the report and killing the mutants cheaply.

## The gate

```bash
node scripts/mutation-changed-lines.mjs run --workspace apps/api --base origin/master
```

Run from the repository root after `git fetch`. CI passes the pull request's base sha. The gate needs no stored index: a Stryker mutation range mutates only the code blocks the diff touched, and coverage analysis runs only the tests covering each mutant.

It is slow — roughly 7-15 minutes for `apps/api` — so never use it as the iteration loop. Run it once, at the end.

## Read the report first

The failing CI job's log lists every mutant with its status, its `file:line`, and the exact replacement it applied:

- `[NoCoverage]` — no test reached the line at all.
- `[Survived]` — a test reached the line and did not notice the change.

Read the whole log. The mutant list comes after a long per-test coverage dump, so a truncated view loses exactly what matters.

## Kill one mutant at a time

For each entry in the report:

1. Apply the mutation by hand to the production line, and mark the temporary edit with a `// todo` comment so it cannot be mistaken for intended code.
2. Write or adjust the test that should catch it.
3. Run only that file — `pnpm exec vitest run --project unit <file>` — and confirm it FAILS. That failure is the proof the test detects that mutant.
4. Revert the production edit and the marker, and confirm the test passes.
5. Move to the next mutant.

Then run the gate once to confirm the whole set.

## Rules

- Never weaken production code to satisfy the gate, and never add `// Stryker disable` or an equivalent. A disable is metric gaming, and the repository bans it.
- A mutant that no input can distinguish is genuinely equivalent. Report it with the argument instead of writing a test that pretends otherwise.
- Before finishing, `git diff` the production files to prove no `// todo` marker and no mutation survived, and say so in the result.
- Integration tests cannot kill mutants. The mutation runner's vitest config excludes `src/**/*.integration.test.ts`, so behaviour that only integration tests exercise reads as `[NoCoverage]`. Put the detecting test in a unit file, at the seam the mutant sits on: the guard, the error path, the branch.
- Assert observable behaviour. A test that only checks that nothing threw detects nothing.

## When the gate itself fails

- `spawnSync ... ENOBUFS` means the `--unified=0` diff exceeded a child process's stdout capture limit. The diff is large, not the mutants; raise that buffer in the script.
- `Mutation delta unavailable`, `fingerprint`, or `baseline` messages belong to the retired index-based gate. The current gate needs no stored index, so those messages mean an older revision of the script.

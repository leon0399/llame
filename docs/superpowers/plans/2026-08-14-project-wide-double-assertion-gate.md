# Project-Wide Double-Assertion Gate Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn issue #268's local API-only `as unknown as` ratchet into a
project-wide, TSX-aware, CI-enforced gate without forcing unrelated cleanup of the
113 existing application/test debt lines.

**Architecture:** Keep the current AST-based added-line check, but give it two
explicit inputs: staged files for Lefthook and a base commit for CI. Select the
ast-grep parser from each file extension so JSX cannot bypass the rule. Install the
CLI as a pinned root development tool so the CI job uses the same parser as local
tests, and exercise the shell gate in isolated temporary Git repositories.

**Tech Stack:** Bash, Git, ast-grep 0.44.x, jq, Lefthook, GitHub Actions, pnpm.

---

## Chunk 1: Preserve the baseline

### Task 1: Land the quality program tracker

**Files:**

- Create: `docs/code-quality-tracker.md`
- Create: `docs/superpowers/specs/2026-08-14-quality-taser-design.md`
- Create: `docs/superpowers/plans/2026-08-14-project-wide-double-assertion-gate.md`

- [ ] **Step 1: Verify the tracker measurements against `master`**

Run:

```bash
rg -n --glob '!node_modules' --glob '!*.md' 'as\s+unknown\s+as' .
```

Expected: 118 text lines total, 113 beneath `apps/`.

- [ ] **Step 2: Verify formatting and whitespace**

Run:

```bash
pnpm exec prettier --check docs/code-quality-tracker.md \
  docs/superpowers/specs/2026-08-14-quality-taser-design.md \
  docs/superpowers/plans/2026-08-14-project-wide-double-assertion-gate.md
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 3: Commit the bottom stack layer**

```bash
git add docs/code-quality-tracker.md \
  docs/superpowers/specs/2026-08-14-quality-taser-design.md \
  docs/superpowers/plans/2026-08-14-project-wide-double-assertion-gate.md
git commit -m "docs(quality): track the quality-taser program" \
  -m "Co-Authored-By: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

Expected: one documentation-only commit on `quality-taser/tracker`.

## Chunk 2: Prove the gap

### Task 2: Add executable regression coverage for the gate

**Files:**

- Create: `scripts/check-new-unknown-as-casts.test.sh`
- Modify: `package.json`

- [ ] **Step 1: Write an isolated shell test harness**

The test must create disposable Git repositories under `mktemp -d`, copy the gate
into each repository, and provide helpers that stage or commit fixture files. It
must cover these cases independently:

1. a new `.ts` double assertion fails in staged mode;
2. a new `.tsx` double assertion inside JSX fails in staged mode;
3. an untouched committed cast plus an unrelated added line passes;
4. a new `.tsx` double assertion fails when comparing `--diff-base <sha>`;
5. a clean diff-base comparison passes;
6. a missing or non-ancestor diff base fails loudly.

Use this assertion shape so a failure prints the captured output:

```bash
assert_status() {
  local expected="$1"
  shift
  set +e
  output="$("$@" 2>&1)"
  actual=$?
  set -e
  if [[ "$actual" -ne "$expected" ]]; then
    printf 'expected status %s, got %s\n%s\n' "$expected" "$actual" "$output" >&2
    return 1
  fi
}
```

Do not mutate the real index. Every invocation runs with `git -C "$fixture"` or
inside a subshell whose working directory is the fixture.

- [ ] **Step 2: Expose the harness through pnpm**

Add to root `package.json` scripts:

```json
"test:quality-gates": "bash scripts/check-new-unknown-as-casts.test.sh"
```

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm test:quality-gates
```

Expected: failure on the staged `.tsx` case because the current script forces
`--lang ts` and returns no AST match for JSX.

- [ ] **Step 4: Commit only after GREEN in Task 3**

Do not weaken or skip the TSX case to make RED disappear.

## Chunk 3: Make local enforcement project-wide

### Task 3: Support TSX and explicit diff-base mode

**Files:**

- Modify: `scripts/check-new-unknown-as-casts.sh`
- Modify: `lefthook.yml`
- Modify: `flake.nix`
- Modify: `AGENTS.md`
- Modify: `apps/api/AGENTS.md`

- [ ] **Step 1: Parse an optional base commit before the file list**

At script startup, accept only this optional form:

```bash
diff_base=""
if [[ "${1:-}" == "--diff-base" ]]; then
  [[ -n "${2:-}" ]] || {
    echo "check-new-unknown-as-casts.sh: --diff-base requires a commit" >&2
    exit 2
  }
  diff_base="$2"
  shift 2
  git merge-base --is-ancestor "$diff_base" HEAD || {
    echo "check-new-unknown-as-casts.sh: diff base '$diff_base' is not an ancestor of HEAD" >&2
    exit 2
  }
fi
```

When `diff_base` is set and no files are supplied, populate the file array from
`git diff --name-only --diff-filter=ACMR -z "$diff_base" HEAD --` restricted to
`*.ts`, `*.tsx`, `*.mts`, and `*.cts`. Keep the existing explicit-file mode for
Lefthook.

- [ ] **Step 2: Read the correct source for each mode**

- staged mode: retain `git diff --cached -U0` and `git show ":$file"`;
- diff-base mode: use `git diff "$diff_base" HEAD -U0 -- "$file"` and read the
  exact current commit blob with `git show "HEAD:$file"` into the parser temp file;
- deleted files remain ignored through `--diff-filter=ACMR` and explicit existence
  checks.

Never mix diff-derived line numbers with a working-tree file. Both modes parse an
immutable Git blob: the index in staged mode, `HEAD` in diff-base mode.

- [ ] **Step 3: Select the parser from the extension**

```bash
case "$file" in
  *.tsx) language=tsx ;;
  *.ts | *.mts | *.cts) language=ts ;;
  *) continue ;;
esac
```

Pass `--lang "$language"` to ast-grep. Update diagnostics to point at root
`AGENTS.md` for the global prohibition and at `apps/api/AGENTS.md` only for the
Nest-specific narrowing recipe.

- [ ] **Step 4: Expand Lefthook's staged surface**

Rename the job from `api no new unknown-as casts` to `no new unknown-as casts` and
use:

```yaml
glob: "{apps,packages}/**/*.{ts,tsx,mts,cts}"
```

Keep explicit `files: git diff --name-only --cached --diff-filter=ACMR` so the
script reads only real staged files.

- [ ] **Step 5: Document stable and specialized rules**

Root `AGENTS.md` gets the stable project-wide rule: double assertions through
`unknown` are banned; narrow the consumer or validate the boundary instead. The
API child guide retains the Nest `Pick<>` plus explicit `@Inject` recipe and says
the shared gate is project-wide. Update the `flake.nix` comment to stop calling the
gate API-only.

- [ ] **Step 6: Run GREEN**

Run:

```bash
pnpm test:quality-gates
```

Expected: all six cases pass, including staged and diff-base TSX.

- [ ] **Step 7: Run local gate integration**

In a disposable fixture, stage a TSX cast and run the gate through Lefthook's
command shape. Expected: exit 1 and a diagnostic naming the fixture file.

## Chunk 4: Make CI authoritative

### Task 4: Install the AST tool and run the PR/push diff gate

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/lint.yml`

- [ ] **Step 1: Pin the root CLI**

Add exact `@ast-grep/cli@0.44.0` to root dev dependencies. This matches the Nix
shell's measured ast-grep version and avoids different local/CI parsers.

Run:

```bash
pnpm add -Dw -E @ast-grep/cli@0.44.0
```

Expected: only `package.json` and `pnpm-lock.yaml` dependency metadata changes.

- [ ] **Step 2: Fetch enough history in the lint job**

Set `fetch-depth: 0` only on the lint job's checkout. The format job does not need
history and stays shallow.

- [ ] **Step 3: Run tests and the event diff**

After workspace setup and before Turbo lint, add:

```yaml
- run: pnpm test:quality-gates

- name: Reject new double assertions
  env:
    BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}
  run: ./scripts/check-new-unknown-as-casts.sh --diff-base "$BASE_SHA"
```

The script's ancestry validation must fail closed if checkout/event assumptions
drift.

- [ ] **Step 4: Verify workflow tooling**

Run:

```bash
actionlint
zizmor --pedantic .github/workflows
pinact run --check
```

Expected: actionlint and pinact exit 0. Zizmor must introduce no new finding; its
pre-existing findings remain tracked separately.

## Chunk 5: Close the layer

### Task 5: Update evidence, verify, review, and submit

**Files:**

- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update the tracker**

Mark the project-wide prevention layer `done` only after the local regression
harness, lint workflow, and full verification pass. Record the PR number after
submission. Leave the 113-site migration and issue #287 cleanup queued.

- [ ] **Step 2: Add the dated changelog entry**

State precisely that new double assertions are rejected in owned TypeScript/TSX by
local staged checks and CI diff checks. Do not claim the existing debt is removed.

- [ ] **Step 3: Run fresh verification**

```bash
pnpm test:quality-gates
pnpm lint
pnpm typecheck
pnpm format:check
actionlint
pinact run --check
git diff --check
```

Expected: all commands exit 0. If `zizmor --pedantic` remains nonzero on tracked
pre-existing findings, compare the exact finding set and prove this layer adds none.

- [ ] **Step 4: Independent review**

Dispatch specification-compliance review first, then code-quality/security review.
Repair every confirmed finding and rerun the relevant commands.

- [ ] **Step 5: Commit the implementation layer**

```bash
git add AGENTS.md apps/api/AGENTS.md CHANGELOG.md flake.nix lefthook.yml \
  package.json pnpm-lock.yaml scripts/check-new-unknown-as-casts.sh \
  scripts/check-new-unknown-as-casts.test.sh .github/workflows/lint.yml \
  docs/code-quality-tracker.md
git commit -m "chore(quality): enforce double assertions project-wide" \
  -m "Co-Authored-By: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

- [ ] **Step 6: Rebase, submit, and inspect live state**

Run `gh stack rebase --upstack`, `gh stack submit --auto --open`, then
`gh stack view --json`. Update PR titles/bodies without a `Test plan` section,
watch CI, and re-fetch reviews plus unresolved threads before moving to the next
quality layer.

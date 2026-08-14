# Cyclomatic Complexity Ceiling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce a project-wide modified-McCabe ceiling of 35 and bring the
sole current offender below it without changing chat-turn behavior.

**Architecture:** Use Oxlint's native `complexity` rule in each lint-owning
workspace; do not add a second metric script, baseline allowlist, or inline
disable. Prove the rule with disposable over/at-limit fixtures, then extract the
cohesive turn-context/message-part assembly from the 53-point transaction
callback into one private method. Preserve the transaction, lock order, tenant
identity, retry path, and public service surface.

**Tech Stack:** TypeScript, Oxlint 1.72.0, Bash, Vitest, Turborepo.

---

## Chunk 1: Prove and enable the ceiling

### Task 1: Add executable configuration coverage

**Files:**

- Create: `scripts/check-complexity-config.test.sh`
- Modify: `package.json`

- [ ] **Step 1: Write the failing fixture harness**

Create a Bash harness that uses `mktemp -d` and removes it on exit. Generate:

1. `over-limit.ts`: one exported function with 35 independent `if` branches,
   giving modified complexity 36;
2. `at-limit.ts`: one exported function with 34 independent `if` branches,
   giving modified complexity 35;
3. `modified-switch.ts`: one exported function with at least 40 `case` labels,
   proving the configured `modified` variant counts the switch as one branch
   instead of one branch per case.

For each of these checked-in configs:

```text
apps/api/.oxlintrc.json
apps/web/.oxlintrc.json
packages/ui/.oxlintrc.json
apps/storybook/.oxlintrc.json
```

run that workspace's installed Oxlint binary from the workspace root, with the
workspace-local config and each absolute fixture path. For example:

```bash
(cd apps/api && pnpm exec oxlint --config .oxlintrc.json "$fixture")
(cd apps/web && pnpm exec oxlint --config .oxlintrc.json "$fixture")
(cd packages/ui && pnpm exec oxlint --config .oxlintrc.json "$fixture")
(cd apps/storybook && pnpm exec oxlint --config .oxlintrc.json "$fixture")
```

The root workspace does not install Oxlint; do not rely on `pnpm exec oxlint`
from the repository root. Assert:

- `over-limit.ts` exits nonzero and its output contains both `complexity` and
  `Maximum allowed is 35`;
- `at-limit.ts` exits zero;
- `modified-switch.ts` exits zero.

Use the same output-capturing assertion style as
`scripts/check-new-unknown-as-casts.test.sh`; print captured output on failure.
Do not write fixture files into the worktree.

- [ ] **Step 2: Add the harness to the aggregate quality-gate command**

Change the root script to:

```json
"test:quality-gates": "bash scripts/check-new-unknown-as-casts.test.sh && bash scripts/check-complexity-config.test.sh"
```

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm test:quality-gates
```

Expected: the complexity harness fails because the four workspace configs do
not yet reject the 36-point fixture.

### Task 2: Configure the native rule consistently

**Files:**

- Modify: `apps/api/.oxlintrc.json`
- Modify: `apps/web/.oxlintrc.json`
- Modify: `packages/ui/.oxlintrc.json`
- Modify: `apps/storybook/.oxlintrc.json`

- [ ] **Step 1: Add the same rule to every workspace**

Add this entry to each top-level `rules` object:

```json
"complexity": ["error", { "max": 35, "variant": "modified" }]
```

Do not add overrides, inline disables, a root Oxlint config, or Turbo changes.
The existing workspace lint scripts already own the full app/package surface.

- [ ] **Step 2: Run the fixture harness GREEN**

Run:

```bash
pnpm test:quality-gates
```

Expected: both quality-gate harnesses pass for all four configs.

- [ ] **Step 3: Prove the production RED**

Run:

```bash
pnpm exec turbo run lint --force
```

Expected: exactly one complexity failure remains:
`apps/api/src/chats/chat-loop.service.ts`, the accepted-turn transaction
callback at complexity 53 versus maximum 35. Any additional failure invalidates
the measured baseline and must be investigated before extraction.

## Chunk 2: Reduce the measured hotspot

### Task 3: Extract one cohesive private responsibility

**Files:**

- Modify: `apps/api/src/chats/chat-loop.service.ts`
- Test: `apps/api/src/chats/chat-loop.service.test.ts`
- Test: `apps/api/src/chats/chat-loop.integration.test.ts`

- [ ] **Step 1: Establish characterization GREEN before refactoring**

Run:

```bash
pnpm --filter api exec vitest run --project unit src/chats/chat-loop.service.test.ts
```

Expected: 20 tests pass. Do not edit these tests merely to make the extraction
easier; they characterize snapshot binding, tool availability, model switching,
digest delta/supersession, rollback, and conflict paths.

- [ ] **Step 2: Name only the repeated input shape**

Move the current inline input type of `persistUserMessageAndRun` to a private
file-local `PersistUserMessageAndRunInput` alias. Import only existing concrete
types required by the extraction:

```ts
import { type Chat, type Message, type Run } from "../db/schema";
import {
  type Db,
  TenantDbService,
  type TenantRunner,
} from "../db/tenant-db.service";
import {
  MemoryService,
  type MemorySettingsBindingResolver,
  type MemorySettingsResolver,
  type ResolvedMemorySettings,
} from "../memory/memory.service";
import {
  deriveRecencyDigestDelta,
  RecencyDigestService,
  type RecencyDigestDelta,
  type RecencyDigestResolution,
  type RecencyDigestResolver,
} from "./recency-digest.service";
```

The alias is internal reuse, not a public interface or DI boundary.

- [ ] **Step 3: Extract context/message-part assembly**

Extract the current block from system-prompt rendering through `messageParts`
construction into one private method, for example:

```ts
private async buildTurnContextAndParts(input: {
  tx: Db;
  chat: Chat;
  turnInput: PersistUserMessageAndRunInput;
  shareRecentChats: ResolvedMemorySettings;
  digestDelta: RecencyDigestDelta | null;
}): Promise<{
  effectiveContext: EffectiveContextSnapshotInput;
  messageParts: MessagePart[];
}>;
```

The method owns exactly these existing responsibilities:

- render the system prompt and preserve the redacted digest-render error path;
- resolve the effective context;
- read the previous Run/snapshot and active compaction;
- derive the availability, model-switch, digest-delta, and digest-supersession
  parts;
- return the effective context and ordered message parts.

Keep `userMessage`, message insertion, digest told-state update, immutable
snapshot persistence, stuck-run recovery, Run creation/retry, events, and the
transaction callback in `persistUserMessageAndRun`. Do not add a new service,
public interface, injection token, configuration switch, or error wrapper.

- [ ] **Step 4: Run the focused unit characterization**

Run:

```bash
pnpm --filter api exec vitest run --project unit src/chats/chat-loop.service.test.ts
```

Expected: all 20 tests still pass.

- [ ] **Step 5: Run lint GREEN and inspect the exact metric**

Run:

```bash
pnpm exec turbo run lint --force
```

Expected: all workspaces pass with no disables. The transaction callback and
new private helper are both at or below 35.

- [ ] **Step 6: Measure the two functions, not just the ceiling**

Create a temporary Oxlint config outside the worktree containing only:

```json
{
  "rules": {
    "complexity": ["error", { "max": 0, "variant": "modified" }]
  }
}
```

Run the workspace-local binary and keep the expected nonzero result as
measurement output:

```bash
(cd apps/api && pnpm exec oxlint --config "$measurement_config" src/chats/chat-loop.service.ts)
```

Record the reported values for the accepted-turn transaction callback and
`buildTurnContextAndParts` in the tracker. Expected from the extraction shape:
approximately 30 and 24, respectively; the output is authoritative, and both
must be at or below 35. Remove the temporary config afterward.

- [ ] **Step 7: Run DB-backed characterization**

Run:

```bash
pnpm --filter api exec vitest run --project integration src/chats/chat-loop.integration.test.ts
```

Expected: the integration suite passes against the self-provisioned test
database. If Docker/database access is unavailable, record the environmental
blocker; do not convert the suite to a skip or weaken it.

## Chunk 3: Evidence, review, and stack layer

### Task 4: Update durable project guidance

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the stable rule**

Add a terse root convention: modified cyclomatic complexity must remain at or
below 35; extraction must follow a real responsibility boundary, and agents must
not game the metric with arbitrary helpers or disables.

- [ ] **Step 2: Update tracker evidence**

Keep the layer `active` until remote merge. Record the four configs, fixture
harness, final measured complexities of the extracted helper and transaction
callback, and leave the lower-threshold ratchet as queued evidence-driven work.

- [ ] **Step 3: Add a precise changelog entry**

State that the four TypeScript workspaces now enforce modified complexity 35
and that the measured chat-turn hotspot was split at the context/message-part
responsibility boundary. Do not claim global code simplification or broader
architecture cleanup.

### Task 5: Verify, review, and commit

**Files:** all files changed by Tasks 1-4.

- [ ] **Step 1: Run fresh verification**

```bash
pnpm test:quality-gates
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm exec prettier --check .
pnpm --filter api exec vitest run --project unit src/chats/chat-loop.service.test.ts
pnpm --filter api exec vitest run --project integration src/chats/chat-loop.integration.test.ts
git diff --check
```

Every command must exit zero. Do not use cached Turbo output as evidence.

- [ ] **Step 2: Run independent review**

Dispatch specification-compliance review first, then code-quality/security
review. Repair every confirmed finding and rerun affected checks.

- [ ] **Step 3: Commit the layer**

```bash
git add AGENTS.md CHANGELOG.md apps/api/.oxlintrc.json \
  apps/api/src/chats/chat-loop.service.ts apps/storybook/.oxlintrc.json \
  apps/web/.oxlintrc.json docs/code-quality-tracker.md package.json \
  packages/ui/.oxlintrc.json scripts/check-complexity-config.test.sh \
  docs/superpowers/plans/2026-08-14-complexity-ceiling.md
git commit -m "refactor(quality): enforce complexity ceiling" \
  -m "Co-Authored-By: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

- [ ] **Step 4: Rebase and inspect the local stack**

Run `gh stack rebase --upstack` and `gh stack view --json`. Remote submission
remains deferred until the execution policy permits the explicitly requested
external side effect; do not bypass the rejected submit.

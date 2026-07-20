# Local Storybook Visual Tests Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chromium-first, repository-local Storybook addon that runs, reviews, and approves source-adjacent visual tests inside Storybook, with the same core available to non-mutating CI automation.

**Architecture:** A JIT workspace package exposes Storybook manager, preview, and preset entrypoints. The preset hosts one typed server-channel protocol plus a read-only opaque artifact route; the core runner uses Playwright, Pixelmatch, and PNGJS, while storage resolves every operation from Storybook `importPath` and promotes only hash-verified reviewed candidates. Storybook is the developer control plane; the executable is CI-only.

**Tech Stack:** TypeScript, Storybook 10.5 manager/preview/preset APIs, React 19, Playwright Chromium 1.53.2, Pixelmatch, PNGJS, Vitest, Playwright Test, pnpm, Turborepo.

**Required skills during execution:** `@superpowers:test-driven-development`, `@superpowers:subagent-driven-development`, `@turborepo`, `@frontend-design`, `@vercel-react-best-practices`, `@superpowers:verification-before-completion`.

---

## File map

### New package

```text
packages/storybook-addon-visual-tests/
├── .oxlintrc.json                 mixed browser/Node lint environment
├── package.json                   JIT exports, scripts, peers, direct dependencies
├── playwright.config.ts           isolated real-Storybook smoke configuration
├── README.md                      addon registration, storage, local and CI workflows
├── tsconfig.json                  strict React-library config, no emit
├── turbo.json                     smoke-test outputs/cache policy only
├── src/
│   ├── automation.ts              CI-only non-mutating executable
│   ├── constants.ts               addon IDs, event names, artifact route
│   ├── index.ts                   public option/result/type exports
│   ├── manager.tsx                addon registration and compatibility boundary
│   ├── preset.ts                  manager/preview entries and dev hooks
│   ├── preview.ts                 pre-render STORY_FINISHED/disable bridge
│   ├── shared/
│   │   ├── protocol.ts            command/event unions and runtime parsing
│   │   └── results.ts             result/status/environment contracts
│   ├── manager/
│   │   ├── Panel.stories.tsx      functional panel states for Storybook verification
│   │   ├── Panel.tsx              thin channel container
│   │   ├── PanelView.tsx          presentational result/review UI
│   │   ├── TestProviderRow.tsx    sidebar test-widget run/stop row
│   │   └── state.ts               reducer and Storybook status projection
│   └── node/
│       ├── approval.ts             exact-candidate promotion and orphan removal
│       ├── artifacts.ts            hashes, committed metadata, transient registry
│       ├── capture.ts              deterministic Chromium capture/readiness
│       ├── compare.ts              PNG decode, Pixelmatch, dimension handling
│       ├── paths.ts                importPath mapping and root confinement
│       ├── runner.ts               bounded run lifecycle and incremental results
│       ├── server.ts               Storybook channel handlers and artifact middleware
│       └── story-index.ts          live preset index and HTTP index adapters
└── test/
    ├── approval.test.ts
    ├── capture.test.ts
    ├── compare.test.ts
    ├── package-exports.test.ts
    ├── paths.test.ts
    ├── protocol.test.ts
    ├── runner.test.ts
    ├── server.test.ts
    ├── status-projection.test.ts
    ├── fixture-global-setup.ts
    ├── fixtures/project/.storybook/{main.ts,preview.ts}
    ├── fixtures/project/src/visual-fixture.stories.tsx
    └── smoke/addon.spec.ts
```

### Existing files

- Modify `package.json`: catalog-backed root `test:visual` delegation.
- Modify `pnpm-workspace.yaml`: catalog the now-shared `@playwright/test` pin.
- Modify `pnpm-lock.yaml`: workspace/dependency resolution only.
- Modify `.gitignore`: ignore transient visual artifacts and fixture copies.
- Modify `.prettierignore`: ignore transient `result.json` files.
- Modify `apps/storybook/package.json`: consume the workspace addon.
- Modify `apps/storybook/.storybook/main.ts`: register the addon and its panel story.
- Modify `apps/storybook/turbo.json`: include the addon panel story through the workspace dependency; no production baselines in static-build hashes.
- Modify `packages/ui/turbo.json`: exclude screenshot artifacts from UI code tasks.
- Modify `turbo.json`: register `test:visual` as a browser task.
- Modify `.github/workflows/ci.yml`: run the isolated addon smoke in the existing Storybook job.
- Modify `apps/storybook/AGENTS.md`: document in-app visual-test workflow and artifact policy.
- Modify `README.md`: add the local Storybook visual-test workflow.
- Modify `CHANGELOG.md`: record the shipped addon; no ROADMAP item exists to remove.
- Modify `docs/superpowers/specs/2026-07-20-local-storybook-visual-tests-design.md`: retain the evidence-backed JIT and preview-disable corrections already made during planning.

## Chunk 1: Package core and integrity boundary

### Task 1: Scaffold the JIT package and prove Storybook entry loading

**Files:**

- Create: `packages/storybook-addon-visual-tests/package.json`
- Create: `packages/storybook-addon-visual-tests/tsconfig.json`
- Create: `packages/storybook-addon-visual-tests/.oxlintrc.json`
- Create: `packages/storybook-addon-visual-tests/src/index.ts`
- Create: `packages/storybook-addon-visual-tests/src/constants.ts`
- Create: `packages/storybook-addon-visual-tests/src/preset.ts`
- Create: `packages/storybook-addon-visual-tests/src/manager.tsx`
- Create: `packages/storybook-addon-visual-tests/src/preview.ts`
- Create: `packages/storybook-addon-visual-tests/test/package-exports.test.ts`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Create only package/test configuration and the failing export test**

Use the package name `@workspace/storybook-addon-visual-tests`. Export source entrypoints for `.`, `./preset`, `./manager`, and `./preview`. Declare every imported dependency directly; use peers for `react` and `storybook`.

The test must import the absent preset and assert entry preservation:

```ts
import { describe, expect, test } from "vitest";

import preset, { managerEntries, previewAnnotations } from "../src/preset.js";

describe("addon package entries", () => {
  test("appends manager and preview entries without discarding existing addons", () => {
    expect(managerEntries(["existing-manager"])).toEqual([
      "existing-manager",
      expect.stringMatching(/manager\.tsx$/),
    ]);
    expect(previewAnnotations(["existing-preview"])).toEqual([
      "existing-preview",
      expect.stringMatching(/preview\.ts$/),
    ]);
    expect(preset.experimental_serverChannel).toBeTypeOf("function");
    expect(preset.experimental_devServer).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: Install dependencies**

Run: `pnpm install`

Expected: lockfile contains direct workspace entries for Playwright, Pixelmatch, PNGJS, Storybook icons, and their types. Fixture-only dev dependencies (`@playwright/test`, the Storybook Next/Vite framework, Vitest/MCP addons, React DOM, Vite, and Vitest) must also be declared directly rather than relying on pnpm hoisting. If the registry is needed, request network approval; do not bypass `minimumReleaseAge`.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `pnpm --filter @workspace/storybook-addon-visual-tests test -- test/package-exports.test.ts`

Expected: FAIL because `src/preset.ts` does not exist.

- [ ] **Step 4: Implement the smallest source-exported preset**

`src/preset.ts` must append absolute source entry paths and export one compatibility object:

```ts
export function managerEntries(entries: string[] = []): string[] {
  return [...entries, fileURLToPath(new URL("./manager.tsx", import.meta.url))];
}

export function previewAnnotations(entries: string[] = []): string[] {
  return [...entries, fileURLToPath(new URL("./preview.ts", import.meta.url))];
}

export default {
  managerEntries,
  previewAnnotations,
  experimental_serverChannel,
  experimental_devServer,
};
```

Keep the initial manager and preview entries side-effect-safe. Do not add `tsup`, a sidecar server, GraphQL, or package-specific ports.

- [ ] **Step 5: Verify GREEN and package checks**

Run:

```bash
pnpm --filter @workspace/storybook-addon-visual-tests test -- test/package-exports.test.ts
pnpm --filter @workspace/storybook-addon-visual-tests typecheck
pnpm --filter @workspace/storybook-addon-visual-tests lint
```

Expected: all PASS with no warnings.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml packages/storybook-addon-visual-tests
git commit -m "feat(storybook): scaffold local visual test addon" -m "Co-Authored-By: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

### Task 2: Define the typed protocol, results, and status projection

**Files:**

- Create: `packages/storybook-addon-visual-tests/src/shared/protocol.ts`
- Create: `packages/storybook-addon-visual-tests/src/shared/results.ts`
- Create: `packages/storybook-addon-visual-tests/src/manager/state.ts`
- Create: `packages/storybook-addon-visual-tests/test/protocol.test.ts`
- Create: `packages/storybook-addon-visual-tests/test/status-projection.test.ts`

- [ ] **Step 1: Write failing protocol parsing tests**

Cover `get-state`, `run` current/all, `cancel`, exact `approve`, `approve-all`, and orphan `remove`. Reject missing IDs, unknown commands, malformed hashes, and surplus path fields. The desired approval shape is:

```ts
const approval = parseCommand({
  type: "approve",
  runId: "run-1",
  storyId: "button--primary",
  environmentKey: "chromium-1280x720@1x",
  candidateSha256: "a".repeat(64),
});

expect(approval).toEqual({
  type: "approve",
  runId: "run-1",
  storyId: "button--primary",
  environmentKey: "chromium-1280x720@1x",
  candidateSha256: "a".repeat(64),
});
```

- [ ] **Step 2: Write failing Storybook projection tests**

Assert the design mapping exactly:

```ts
expect(projectStatus(result("queued"))).toMatchObject({
  value: "status-value:pending",
});
expect(projectStatus(result("running"))).toMatchObject({
  value: "status-value:pending",
});
expect(projectStatus(result("passed"))).toMatchObject({
  value: "status-value:success",
});
expect(projectStatus(result("new"))).toMatchObject({
  value: "status-value:new",
});
expect(projectStatus(result("changed"))).toMatchObject({
  value: "status-value:modified",
});
expect(projectStatus(result("capture-error"))).toMatchObject({
  value: "status-value:error",
});
expect(projectStatus(result("cancelled"))).toMatchObject({
  value: "status-value:unknown",
});
expect(projectStatus(result("removed"))).toBeUndefined();
```

Every emitted `Status` must contain the scoped addon `typeId`, exact Storybook story ID, title, description, and result identity in `data`. A run with visual failures still leaves the test provider `succeeded`; only runner/transport infrastructure failure becomes `crashed`.

- [ ] **Step 3: Run both tests and verify RED**

Run: `pnpm --filter @workspace/storybook-addon-visual-tests test -- test/protocol.test.ts test/status-projection.test.ts`

Expected: FAIL because shared contracts and projection do not exist.

- [ ] **Step 4: Implement minimal discriminated unions and handwritten guards**

Do not add a runtime-schema dependency for this closed protocol. Parse `unknown` with small exhaustive type guards, freeze channel names in `constants.ts`, and keep all Storybook `Status` typing inside the manager compatibility boundary.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm --filter @workspace/storybook-addon-visual-tests test -- test/protocol.test.ts test/status-projection.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/storybook-addon-visual-tests/src/shared packages/storybook-addon-visual-tests/src/manager/state.ts packages/storybook-addon-visual-tests/test
git commit -m "feat(storybook): define visual test protocol" -m "Co-Authored-By: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

### Task 3: Implement confined source-adjacent storage and baseline metadata

**Files:**

- Create: `packages/storybook-addon-visual-tests/src/node/paths.ts`
- Create: `packages/storybook-addon-visual-tests/src/node/artifacts.ts`
- Create: `packages/storybook-addon-visual-tests/test/paths.test.ts`

- [ ] **Step 1: Write failing path and confinement tests**

Use `mkdtemp` and real files. Prove the exact mapping:

```text
src/button.stories.tsx
→ src/__screenshots__/button.stories.tsx/button--primary/chromium-1280x720@1x/
```

Cover Windows separators, title changes, duplicate titles from different source files, absolute/traversal input, sibling-prefix containment (`/root-a` must not contain `/root-ab`), a symlinked story escaping the root, and an artifact destination whose existing ancestor is a symlink outside the root. Separately attack every embedded component: reject or safely encode separators, dot segments, and absolute values in `importPath`, `storyId`, and `environmentKey`.

- [ ] **Step 2: Write failing metadata/hash tests**

The committed `baseline.json` shape must include:

```ts
{
  schemaVersion: 1,
  baselineSha256: "<64 lowercase hex>",
  browser: { name: "chromium", version: "...", playwrightVersion: "1.53.2" },
  platform: "linux",
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  comparator: { name: "pixelmatch", threshold: 0.1, includeAA: false },
}
```

Assert malformed metadata and a baseline PNG/hash mismatch become review-required incompatibility, never a silent pass.

- [ ] **Step 3: Verify RED**

Run: `pnpm --filter @workspace/storybook-addon-visual-tests test -- test/paths.test.ts`

Expected: FAIL because storage modules do not exist.

- [ ] **Step 4: Implement canonical path resolution and artifact primitives**

Resolve index `importPath` relative to Storybook's working directory, realpath both the story and configured roots, require containment with `path.relative` before appending `__screenshots__`, and validate every later read/write/delete against the confined artifact root. Never use string-prefix containment. Use display titles only as labels.

Expose SHA-256, strict metadata parsing, same-directory temporary filenames, fsync helpers, and an in-memory opaque artifact-ID registry. Never accept a filesystem path from the manager.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm --filter @workspace/storybook-addon-visual-tests test -- test/paths.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/storybook-addon-visual-tests/src/node/paths.ts packages/storybook-addon-visual-tests/src/node/artifacts.ts packages/storybook-addon-visual-tests/test/paths.test.ts
git commit -m "feat(storybook): add confined visual artifact storage" -m "Co-Authored-By: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

### Task 4: Implement PNG comparison and exact-candidate approval

**Files:**

- Create: `packages/storybook-addon-visual-tests/src/node/compare.ts`
- Create: `packages/storybook-addon-visual-tests/src/node/approval.ts`
- Create: `packages/storybook-addon-visual-tests/test/compare.test.ts`
- Create: `packages/storybook-addon-visual-tests/test/approval.test.ts`

- [ ] **Step 1: Write failing comparison tests with generated PNG buffers**

Cover missing baseline -> `new`, identical pixels and compatible metadata -> `passed`, changed pixels -> `changed` with count/ratio/diff, dimension changes -> `changed`, and identical pixels with incompatible metadata -> review-required `changed`.

Use Pixelmatch with one fixed policy: `threshold: 0.1`, `includeAA: false`; any remaining changed pixel fails. Do not add user-configurable tolerances.

- [ ] **Step 2: Write failing exact-approval tests**

Use candidate bytes `B`, a later candidate `C`, and a request naming `B`. Assert stale request/hash rejection cannot mutate baseline. Separately mismatch `runId`, `storyId`, `environmentKey`, candidate hash, and the current story `importPath`; none may mutate any baseline, even when candidate bytes happen to be identical across stories. Approval must resolve its destination exclusively from the server-owned result of the named completed run, never from request-supplied paths or reconstructed client state. Assert successful approval makes `baseline.png` byte-equal to the reviewed candidate and writes matching `baselineSha256`.

Simulate interruption states without test-only production hooks:

1. new PNG + old metadata;
2. old PNG + new metadata.

Both must be detected before comparison. Orphan removal must require a result from the same completed full run and remain confined.

- [ ] **Step 3: Verify RED**

Run: `pnpm --filter @workspace/storybook-addon-visual-tests test -- test/compare.test.ts test/approval.test.ts`

Expected: FAIL because compare/approval do not exist.

- [ ] **Step 4: Implement minimal compare and promotion logic**

Decode/encode with PNGJS and compare raw buffers with Pixelmatch. For dimension changes, render a deterministic max-dimension diff canvas instead of throwing. Approval must re-read and hash the current candidate, write PNG and metadata temp files beside their destinations, fsync, and rename each. It must not import or invoke capture.

- [ ] **Step 5: Verify GREEN and the entire package unit suite**

Run:

```bash
pnpm --filter @workspace/storybook-addon-visual-tests test -- test/compare.test.ts test/approval.test.ts
pnpm --filter @workspace/storybook-addon-visual-tests test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/storybook-addon-visual-tests/src/node packages/storybook-addon-visual-tests/test
git commit -m "feat(storybook): compare and approve visual candidates" -m "Co-Authored-By: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

## Chunk 2: Storybook integration, in-app UX, and verification

### Task 5: Capture canonical stories after the real Storybook terminal signal

**Files:**

- Modify: `packages/storybook-addon-visual-tests/src/preview.ts`
- Create: `packages/storybook-addon-visual-tests/src/node/capture.ts`
- Create: `packages/storybook-addon-visual-tests/test/capture.test.ts`

- [ ] **Step 1: Write failing readiness/capture tests**

Factor a small page adapter so unit tests can prove behavior without emulating a browser. Cover:

- bridge installed before navigation;
- immediate matching `STORY_FINISHED` cannot be missed;
- another story's terminal state is ignored;
- `status: error` becomes `capture-error`;
- `parameters.visualTests.disable` reported by preview skips screenshot;
- fonts and two animation frames complete before screenshot;
- timeout/cancel never writes a candidate;
- screenshot options are viewport-level, `fullPage: false`, animations disabled, carets hidden, and CSS-pixel scale.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @workspace/storybook-addon-visual-tests test -- test/capture.test.ts`

Expected: FAIL because capture does not exist.

- [ ] **Step 3: Implement the pre-navigation bridge and Chromium capture**

At preview-module evaluation, subscribe through `addons.getChannel()` to Storybook's `STORY_FINISHED`. Store `{ status, disabled }` by story ID in the global bridge installed by `page.addInitScript()`. Export a typed preview `beforeEach(context)` annotation that merges `context.parameters.visualTests?.disable === true` into that same story record before `STORY_FINISHED`; do not attempt to infer prepared parameters from the server index.

Launch one pinned Chromium per run and a fresh context per story with fixed locale `en-US`, timezone `UTC`, reduced motion, color scheme, viewport, and DPR. Assert `#storybook-root` exists, but call `page.screenshot()` so body portals remain visible. Treat same-origin required resource failures, page errors, Storybook errors, and readiness timeout as capture errors; exclude favicon/telemetry shell noise.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @workspace/storybook-addon-visual-tests test -- test/capture.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storybook-addon-visual-tests/src/preview.ts packages/storybook-addon-visual-tests/src/node/capture.ts packages/storybook-addon-visual-tests/test/capture.test.ts
git commit -m "feat(storybook): capture canonical story states" -m "Co-Authored-By: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

### Task 6: Add the bounded runner, Storybook server channel, and CI adapter

**Files:**

- Create: `packages/storybook-addon-visual-tests/src/node/story-index.ts`
- Create: `packages/storybook-addon-visual-tests/src/node/runner.ts`
- Create: `packages/storybook-addon-visual-tests/src/node/server.ts`
- Create: `packages/storybook-addon-visual-tests/src/automation.ts`
- Modify: `packages/storybook-addon-visual-tests/src/preset.ts`
- Create: `packages/storybook-addon-visual-tests/test/runner.test.ts`
- Create: `packages/storybook-addon-visual-tests/test/server.test.ts`

- [ ] **Step 1: Write failing runner lifecycle tests**

Use fake discovery and capture adapters but real storage/comparison. Prove:

- current/all scope uses exact Storybook IDs;
- concurrency never exceeds two contexts;
- results stream queued -> running -> terminal incrementally;
- starting a new run supersedes/cancels the prior run and late events are ignored;
- full runs detect removed baselines; targeted runs never prune unrelated data;
- disabled stories produce no screenshot/status;
- full runs emit an all-scope reset before queued results, while targeted runs reset only the selected story, so the manager can remove stale disabled/removed statuses without touching unrelated providers;
- changed/new/capture-error are completed test results, not runner crashes.

- [ ] **Step 2: Write failing server-channel and artifact-route tests**

Use an in-memory fake Storybook channel and `ServerApp`. Assert command runtime parsing, `get-state` replay after a terminal event, exact approval identity, opaque artifact GET with `image/png` and `Cache-Control: no-store`, unknown IDs as 404, non-GET/malformed requests rejected, and cleanup closes browser/run resources.

- [ ] **Step 3: Verify RED**

Run: `pnpm --filter @workspace/storybook-addon-visual-tests test -- test/runner.test.ts test/server.test.ts`

Expected: FAIL because runner/server do not exist.

- [ ] **Step 4: Implement one runner and two discovery adapters**

The dev-server adapter uses:

```ts
const generator = await options.presets.apply<StoryIndexGenerator>(
  "storyIndexGenerator",
);
const { entries } = await generator.getIndex();
```

The CI adapter fetches `/index.json`; both normalize into the same core `VisualStory` contract. Resolve `importPath` relative to the Storybook working directory and configured roots.

Use `experimental_serverChannel` for commands/results and `experimental_devServer` only for the read-only opaque artifact route. Use Storybook's test-provider `runWithState`: throw only for infrastructure failure; ordinary visual results complete successfully.

- [ ] **Step 5: Implement the CI-only executable**

Accept `--url` and repeatable `--story-root`; run the same core without approval/update commands. Exit non-zero for new, changed, removed, or capture-error. Never launch this path from the local Storybook panel and never mutate baselines.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm --filter @workspace/storybook-addon-visual-tests test -- test/runner.test.ts test/server.test.ts
pnpm --filter @workspace/storybook-addon-visual-tests test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/storybook-addon-visual-tests/src packages/storybook-addon-visual-tests/test
git commit -m "feat(storybook): run local visual tests" -m "Co-Authored-By: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

### Task 7: Build the functional Storybook-native manager experience

**Files:**

- Modify: `packages/storybook-addon-visual-tests/src/manager.tsx`
- Create: `packages/storybook-addon-visual-tests/src/manager/Panel.tsx`
- Create: `packages/storybook-addon-visual-tests/src/manager/PanelView.tsx`
- Create: `packages/storybook-addon-visual-tests/src/manager/TestProviderRow.tsx`
- Create: `packages/storybook-addon-visual-tests/src/manager/Panel.stories.tsx`
- Modify: `apps/storybook/package.json`
- Modify: `apps/storybook/.storybook/main.ts`

- [ ] **Step 1: Load Storybook's story-authoring instructions before touching the story**

Call the connected Storybook tool `get-storybook-story-instructions`. Then use `list-all-documentation` and `get-documentation` for every Storybook manager primitive whose props are not proven by installed types or the upstream example. Do not guess props.

- [ ] **Step 2: Extend failing status/registration tests before writing components**

Add fake manager API/store coverage for:

- panel always registered;
- static mode shows unavailable and registers no tool/test provider;
- dev mode registers Visual Tests panel, run-current tool, and experimental test provider;
- `onRunAll` emits run-all;
- `onClearAll` clears only this addon's statuses;
- selecting a visual status opens the Visual Tests panel;
- result events update scoped Storybook statuses incrementally.
- full-run reset calls the scoped store's `unset()`, while targeted reset calls `unset([storyId])`; neither can clear another test provider's statuses.

Run: `pnpm --filter @workspace/storybook-addon-visual-tests test -- test/status-projection.test.ts`

Expected: FAIL on missing registration behavior.

- [ ] **Step 3: Implement the minimal manager shell**

Use public `addons`, `types`, `experimental_getStatusStore`, and test-provider store exports from `storybook/manager-api`; keep the few required internal types in `manager.tsx` only.

The panel must provide run current/all, cancel, rerun failures, filters, baseline/candidate/diff switching, per-result approve/remove, and approve-all. Use Storybook internal components/theming and `@storybook/icons`, not `@workspace/ui`. Keep the visual direction restrained and native to Storybook; no custom brand treatment, motion system, or image-comparison gimmicks.

Use a reducer/external store with selector-level subscriptions; do not mirror derived counts in effects or attach duplicate global listeners. Present artifact IDs as same-origin URLs only at render time.

- [ ] **Step 4: Add one panel story with mocked states**

Story covers changed, new, capture-error, running, empty, and static-unavailable states through args. Set `parameters.visualTests.disable = true` so the addon does not capture its own review fixture.

- [ ] **Step 5: Wire the addon into `apps/storybook`**

Register:

```ts
{
  name: "@workspace/storybook-addon-visual-tests/preset",
  options: {
    storyRoots: ["../../../packages/ui/src"],
  },
}
```

Add the package's `Panel.stories.tsx` glob to Storybook's stories list and add the workspace dependency to the app. Do not make the addon depend on llame UI code.

- [ ] **Step 6: Verify focused UI behavior**

Run:

```bash
pnpm --filter @workspace/storybook-addon-visual-tests test
pnpm --filter @workspace/storybook-addon-visual-tests typecheck
pnpm --filter storybook typecheck
pnpm --filter storybook build
```

Then use Storybook MCP `run-story-tests` for the panel story and `preview-stories` to obtain its URL. Expected: all PASS; static build loads the panel in unavailable mode.

- [ ] **Step 7: Commit**

```bash
git add packages/storybook-addon-visual-tests apps/storybook/package.json apps/storybook/.storybook/main.ts pnpm-lock.yaml
git commit -m "feat(storybook): review visual changes in app" -m "Co-Authored-By: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

### Task 8: Prove the real integration, cache boundaries, and CI behavior

**Files:**

- Create: `packages/storybook-addon-visual-tests/playwright.config.ts`
- Create: `packages/storybook-addon-visual-tests/test/fixture-global-setup.ts`
- Create: `packages/storybook-addon-visual-tests/test/fixtures/project/.storybook/main.ts`
- Create: `packages/storybook-addon-visual-tests/test/fixtures/project/.storybook/preview.ts`
- Create: `packages/storybook-addon-visual-tests/test/fixtures/project/src/visual-fixture.stories.tsx`
- Create: `packages/storybook-addon-visual-tests/test/smoke/addon.spec.ts`
- Create: `packages/storybook-addon-visual-tests/README.md`
- Create: `packages/storybook-addon-visual-tests/turbo.json`
- Modify: `.gitignore`
- Modify: `.prettierignore`
- Modify: `package.json`
- Modify: `turbo.json`
- Modify: `apps/storybook/turbo.json`
- Modify: `packages/ui/turbo.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `apps/storybook/AGENTS.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the fixture smoke before wiring its runner**

The global setup copies the tiny fixture to `test/.tmp/project` and builds a static Storybook from that copy. The fixture story renders deterministic canvas content plus a body portal opened after a controlled `play` delay.

The single Playwright spec must assert in development mode:

1. addon, Vitest, and MCP routes coexist;
2. run-all starts from the Storybook testing widget;
3. run-current starts from Storybook;
4. candidate pixels include canvas and portal, and exclude pre-play state;
5. first result is new;
6. in-panel approval makes baseline bytes equal candidate bytes;
7. rerun passes;
8. a controlled visual mutation becomes changed with a diff;
9. stale approval fails without changing baseline;
10. sidebar status follows pending -> new/modified -> success.

Static assertions: manager and story load without page errors, panel is explicitly unavailable, controls are disabled, visual artifact route is absent, and no artifact directory is created.

- [ ] **Step 2: Run smoke and verify RED**

Run: `pnpm --filter @workspace/storybook-addon-visual-tests test:visual`

Expected: FAIL because Playwright config/fixture wiring is incomplete.

- [ ] **Step 3: Complete only the fixture/test harness required for GREEN**

Use two Playwright projects and a `webServer` array with fixed fixture-only ports and `reuseExistingServer: false`: one starts Storybook development mode from the copied fixture, and the other uses Vite preview to serve the already-built static output on a second port. Scope dev assertions to the dev project and unavailable assertions to the static project. Keep every generated baseline/candidate/diff under copied `test/.tmp`; never touch `packages/ui` baselines. Do not add a browser matrix or screenshot the panel UI itself.

- [ ] **Step 4: Add repository artifact and cache rules**

Commit only `baseline.png` and `baseline.json`. Globally ignore candidate, diff, result, atomic temp files, and package fixture copies.

Exclude `src/**/__screenshots__/**` from `packages/ui` build, transit, lint, and typecheck inputs. Do not add baselines to Storybook static-build inputs because static mode is explicitly unavailable and does not read them. Register package-local `test:visual` in root Turbo; do not attach visual capture to `test:storybook`.

Verify hashes with `turbo run ... --dry=json`: story edits affect Storybook not web; baseline edits affect no UI code task; addon source affects Storybook via its declared workspace dependency; component edits still affect both.

- [ ] **Step 5: Add CI and documentation**

The existing Storybook job already installs Chromium. Add only the isolated package smoke before its existing Storybook test/build command. Do not run the production story corpus in CI until humans have approved its initial baselines.

Document the primary workflow as: start Storybook, run from the testing widget or Visual Tests panel, review in the panel, approve exact candidate. Describe the executable only under CI automation. Add the 2026-07-20 changelog entry; ROADMAP stays unchanged.

- [ ] **Step 6: Verify GREEN locally**

Run:

```bash
pnpm --filter @workspace/storybook-addon-visual-tests test:visual
pnpm --filter @workspace/storybook-addon-visual-tests test
pnpm --filter @workspace/storybook-addon-visual-tests lint
pnpm --filter @workspace/storybook-addon-visual-tests typecheck
pnpm --filter storybook test
pnpm --filter storybook test:storybook
pnpm --filter storybook build
```

Expected: all PASS; only fixture `.tmp` artifacts are created and ignored.

- [ ] **Step 7: Run repository-wide gates**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test
pnpm test:storybook
pnpm build
pnpm test:visual
git diff --check
git status --short
```

Also run `actionlint` and `zizmor .github/workflows/` because CI changed. Expected: all PASS; status contains only intentional source/docs/config changes and no transient visual artifacts.

- [ ] **Step 8: Perform two-stage review**

Dispatch one requirements reviewer against the design/acceptance criteria and one code-quality/security reviewer against the branch diff. Fix only verified findings with a failing regression test first, then rerun focused and full gates.

- [ ] **Step 9: Commit**

```bash
git add .gitignore .prettierignore package.json turbo.json pnpm-lock.yaml packages/storybook-addon-visual-tests apps/storybook packages/ui/turbo.json .github/workflows/ci.yml README.md CHANGELOG.md docs/superpowers/specs/2026-07-20-local-storybook-visual-tests-design.md
git commit -m "feat(storybook): ship local visual testing" -m "Co-Authored-By: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

## Final acceptance

- Visual tests start from Storybook's testing widget, panel, or current-story tool; no terminal step is required locally.
- The panel receives incremental results, projects native Storybook statuses, reviews baseline/candidate/diff, and approves exact candidates.
- Only Chromium runs in v1, while environment identity remains schema-ready.
- Baseline PNG/metadata are committed source-adjacent; candidates/diffs/results are adjacent and ignored.
- Portal content and post-`play` state are captured; failed/incomplete renders never become candidates.
- All filesystem mutations are confined, hash-verified, and stale-safe.
- Static Storybook degrades cleanly; CI automation is non-mutating and the production corpus is not mass-bootstrapped.
- Focused, browser, cache, formatting, lint, type, build, action, security, and full-repo gates pass with recorded evidence.

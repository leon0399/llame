# Local Storybook Visual Tests Design

Status: proposed

Date: 2026-07-20

## Goal

Add a repo-local Storybook addon that launches visual tests from Storybook's
testing widget or Visual Tests panel, captures every canonical story state in a
pinned Chromium environment, compares it with a committed source-adjacent
baseline, reports visual status inside Storybook, and promotes the exact reviewed
candidate when a change is approved inside Storybook.

The addon must be a JIT workspace package with explicit exports and a boundary
clean enough to extract later. Storybook/Vite compiles the package source in this
repository; a publication build is deferred until extraction requires it. Dev and
static Storybook loading are acceptance gates. Integration correctness comes
before panel polish.

## Non-goals

- Chromatic authentication, cloud storage, sharing, billing, or branch baseline
  graphs.
- GraphQL compatibility with Chromatic.
- Firefox, WebKit, Safari, or a browser matrix in v1.
- A standalone review application.
- Automatic state exploration, action recording, or a visual-mode matrix DSL.
- Reimplementing browser capture, PNG parsing, or pixel comparison algorithms.

## Package boundary

Create `packages/storybook-addon-visual-tests`, published internally as
`@workspace/storybook-addon-visual-tests`.

The package has seven internal boundaries:

1. `manager`: Storybook panel, toolbar command, test-provider registration, and
   sidebar status projection.
2. `storybook`: the small compatibility layer around Storybook 10.5 manager and
   experimental test-provider/server-channel APIs.
3. `preview`: a preview annotation that records Storybook render/play completion
   and errors before a story is selected.
4. `node`: Storybook preset, command handling, artifact serving, and run
   lifecycle.
5. `core`: Storybook-index discovery, capture orchestration, result types, and
   approval rules. It has no React or Storybook manager dependencies.
6. `storage`: confined source-path resolution, artifact reads/writes, hashing,
   cleanup, and atomic promotion.
7. `automation`: a non-interactive CI entry point that calls the same `core`
   runner against an already-running Storybook URL. It is not the local developer
   launch path.

Storybook-specific imports must not leak into capture, comparison, or storage.
The experimental API surface is therefore replaceable in one module when
Storybook changes it.

## Existing primitives

- Playwright directly launches the repository-pinned Chromium and produces PNG
  screenshots.
- `pixelmatch` compares decoded pixel buffers and writes the diff buffer.
- `pngjs` decodes and encodes PNG files.
- Node's crypto and filesystem APIs provide SHA-256 candidate identity and
  atomic same-directory replacement.

Playwright's `toHaveScreenshot()` assertion is not used. It only operates inside
the Playwright test runner and owns snapshot update semantics, which conflicts
with a long-lived Storybook process and exact reviewed-candidate approval.

The package owns glue and policy, not image-processing algorithms.

## Canonical capture model

One CSF story is one visual test. Its exported args, globals, decorators,
loaders, and `play` function define the canonical state. Transient changes made
through Storybook controls do not silently create or overwrite baselines. A
state that deserves a durable baseline should be represented as another story.

V1 supports one environment:

- browser: repository-pinned Playwright Chromium;
- viewport: fixed `1280x720`;
- device scale factor: `1`;
- color scheme, locale, and timezone: fixed package defaults;
- reduced motion: enabled;
- screenshot scale: CSS pixels;
- full-page capture: disabled; normal component stories use a viewport-clamped
  union of visible story elements, including body-level portals, while
  fullscreen stories capture the complete viewport.

Every result still includes an `environmentKey`. The key contains browser,
viewport, and device scale factor, so adding more Playwright browsers later does
not change protocol or storage identity.

V1 does not reinterpret Storybook viewport, locale, timezone, or color-scheme
globals as browser-context configuration. Supporting capture modes later should
add explicit environment identities rather than silently changing one baseline's
meaning or double-rendering every story to discover its context.

Stories can opt out with `parameters.visualTests.disable = true`. They can also
override framing with `parameters.visualTests.capture = "content" | "viewport"`;
otherwise `layout: "fullscreen"` selects viewport framing and other layouts use
content framing. The server-side story index does not expose prepared
parameters, so the preview annotation reports these values after story
preparation.

## Render readiness

Before navigation, Playwright installs a small window bridge. The addon's preview
annotation initializes that bridge when the preview module loads, subscribes to
Storybook's `STORY_FINISHED`, render-error, and play-error events before story
selection, and records terminal state by story ID. Because terminal state is
stored rather than observed as a one-shot event, an immediate render cannot race
the runner's waiter.

For each story, the runner opens the isolated Storybook iframe URL and waits for:

1. Storybook's successful render signal for that story;
2. completion of the story's `play` function;
3. `document.fonts.ready`;
4. two animation frames;
5. absence of Storybook render or play errors.

The screenshot call disables animations and hides carets. Readiness timeout,
page error, failed Storybook render, missing root, or failed required same-origin
story resource becomes a `capture-error`; unrelated Storybook favicon, telemetry,
or other application-shell request noise is excluded. The runner never captures
a knowingly incomplete state.

Runs use one Chromium instance with fresh contexts and bounded concurrency. The
initial bound is small and fixed; configuration is deferred until measurements
justify it.

## Storage layout

The Storybook index entry's normalized `importPath` is authoritative. Display
titles never determine filesystem paths.

For:

```text
packages/ui/src/button.stories.tsx
story id: components-button--default
environment: chromium-1280x720@1x
```

artifacts live at:

```text
packages/ui/src/__screenshots__/
  button.stories.tsx.visual/
    components-button--default/
      chromium-1280x720@1x/
        baseline.png       # committed
        baseline.json      # committed compatibility metadata
        candidate.png      # ignored
        diff.png           # ignored
        result.json        # ignored
```

The repository commits `baseline.png` and `baseline.json`, and ignores
`candidate.png`, `diff.png`, and `result.json` beneath any `__screenshots__`
directory. Baseline metadata contains the baseline PNG's SHA-256, a format schema
version, browser name and revision, host platform, viewport, device scale factor,
and comparator policy. The stored baseline hash is verified before every
comparison. A passing run may retain its candidate so the panel can display the
exact latest capture; subsequent runs replace transient artifacts for the same
story and environment.

If candidate pixels match but committed compatibility metadata differs, the
result remains `changed` with an environment-change reason and requires review.
Approval replaces both the PNG and metadata. Missing or malformed metadata is
also reviewable rather than silently treated as compatible.

Every resolved read, write, rename, serve, or delete target is canonicalized and
must remain beneath a configured Storybook story root. Artifact HTTP requests
use opaque run-scoped identifiers rather than accepting filesystem paths.

## Result and status model

Stable result states are:

- `passed`: candidate matches the baseline;
- `new`: no baseline exists;
- `changed`: candidate differs from the baseline;
- `capture-error`: rendering or capture failed;
- `removed`: a baseline exists for a story absent from the current full index.

`queued`, `running`, and `cancelled` are transient run states.

Storybook status projection is explicit:

- `queued` and `running` -> `status-value:pending`;
- `passed` -> `status-value:success`;
- `new` -> `status-value:new`;
- `changed` -> `status-value:modified`;
- `capture-error` -> `status-value:error`;
- `cancelled` -> `status-value:unknown`.

`removed` is panel-only because no current Storybook index entry exists to
annotate.

Each completed result contains:

- run ID, story ID, import path, and display name;
- environment key;
- status and timestamps;
- baseline, candidate, and diff artifact IDs where applicable;
- baseline and candidate SHA-256 hashes;
- changed pixel count and ratio;
- image dimensions;
- a structured capture error when applicable.

The first comparator policy uses Pixelmatch's anti-alias detection and a fixed
per-pixel perceptual threshold. Any remaining changed pixel marks the story as
changed. Arbitrary ignore ratios are deferred because they can hide real small
regressions. Dimension changes are visual changes, not capture errors.

## Approval integrity

Approval never triggers capture.

The manager sends the run ID, story ID, environment key, and candidate hash from
the displayed result. The Node side verifies that:

1. the run and result are still current;
2. the candidate exists beneath the confined artifact root;
3. its current SHA-256 hash matches the requested hash;
4. the destination still maps to the same story import path and environment.

It then writes temporary PNG and metadata files beside the baseline, fsyncs them,
and atomically renames each over its destination. A process interruption between
the two renames is detectable as a metadata/hash mismatch on the next run and
requires review; it cannot be mistaken for a compatible baseline. Any request
mismatch fails closed and asks for a rerun. The result is recomputed as `passed`
without taking another screenshot.

Per-story and approve-all commands share this operation. Approve-all applies
only to the immutable result set of one completed run and stops/report failures
rather than recapturing. Removing an orphaned baseline is a separate explicit
approval action.

## Storybook interaction

The manager contributes:

- a Visual Tests panel;
- a visual-test provider in Storybook's expanded sidebar testing widget, with a
  run action for all visual tests;
- a toolbar action to run the current story;
- panel actions to run the selected story, cancel, and approve its current
  candidate;
- incremental test-provider and sidebar statuses;
- filters for changed, new, errors, removed, and passed;
- baseline, candidate, and diff images with basic switching;
- concise capture and stale-approval errors.

The UI uses Storybook manager primitives and tokens rather than
`@workspace/ui`, preserving addon extractability. Rich comparison modes are
deferred, but the protocol exposes all three artifact URLs so UI polish needs no
backend redesign.

Manager commands and incremental results use one typed Storybook server channel.
A small same-origin read-only middleware serves registered artifacts. There is
no sidecar process, SSE fallback, tRPC layer, or GraphQL service.

Interactive execution, artifact serving, and approval are available only from a
development Storybook with the Node preset active. A static Storybook build must
load without errors and render the panel in an explicit unavailable state with
all run and mutation controls disabled.

Running, reviewing, rerunning, and approving visual tests during development all
happen inside Storybook. There is no CLI-only local workflow and no second review
application.

## CI automation

The package exposes a non-interactive binary solely as an automation adapter. It
accepts a Storybook URL, runs the same core engine, exits non-zero for `new`,
`changed`, `capture-error`, or `removed`, and prints the corresponding
source-adjacent artifact paths. It never approves or updates baselines in CI
mode.

Storybook startup remains the owning application's responsibility. This avoids
embedding package-manager- or monorepo-specific process management in an
extractable addon.

V1 records browser revision and host platform in run output. Reproducible CI
requires the same Playwright version and system font set used to approve
baselines. Containerization is deliberately deferred until cross-host evidence
shows it is needed.

## Failure handling and cleanup

- A run is isolated by run ID; late events from an older run cannot overwrite
  current manager state.
- Starting a new run cancels or supersedes the prior run explicitly.
- Capture errors retain diagnostic text but never create a baseline candidate
  eligible for approval.
- Transient artifacts for the current result remain available for review. A new
  successful run for that story replaces them; startup cleanup removes stale
  temporary files left by interrupted atomic operations.
- Unknown commands, invalid story IDs, stale hashes, and out-of-root paths fail
  closed.

## Verification strategy

Unit tests cover:

- source-adjacent path derivation and traversal rejection;
- result classification, including new, changed, dimensions, and removed;
- baseline metadata compatibility and environment-change review;
- baseline hash verification and interruption after either approval rename;
- PNG diff output and metrics;
- candidate hashing and stale-approval rejection;
- exact candidate promotion and atomic replacement;
- protocol parsing and run supersession.

Integration tests use a minimal Storybook fixture to prove:

1. an unbaselined story becomes `new`;
2. approval promotes that exact candidate;
3. the unchanged rerun passes;
4. a visual mutation becomes `changed` with a diff;
5. approval does not recapture;
6. a render/play failure becomes `capture-error`;
7. immediate render and delayed `play` completion cannot race readiness;
8. a viewport candidate includes an opened body-level portal;
9. manager events project every defined Storybook status mapping;
10. static Storybook renders an unavailable panel with no live controls.

Repository verification includes package lint, type-check, tests and build;
Storybook build and story tests; and one Chromium smoke run. The implementation
must not bootstrap or approve baselines for the existing story corpus without a
human review pass.

## Risks

- Storybook's test-provider/server-channel APIs may change. Isolation in the
  compatibility module limits the blast radius.
- Host font and rasterization differences can cause churn. Pinned Chromium is
  necessary but not sufficient; the recorded environment makes drift visible,
  and a container can be introduced later if evidence warrants it.
- Animated or data-dependent stories remain nondeterministic. Existing Storybook
  stories should encode deterministic state in decorators, loaders, mocks, and
  `play` functions rather than accumulating addon-specific stabilization knobs.
- Adjacent artifacts create many directories. Their locality is intentional and
  preferable to an opaque central mapping; ignored transient files are cleaned
  opportunistically.

## Acceptance criteria

- The addon loads in `apps/storybook` from the workspace package.
- A developer can run all visual tests from Storybook's expanded testing widget
  and run the selected story from its Visual Tests panel.
- A developer can review, rerun, and approve results without leaving Storybook;
  no CLI step is required for the local workflow.
- Results appear incrementally in the panel and Storybook status surfaces.
- Baselines live beside the importing story and only baselines are committed.
- Each committed baseline includes compatibility metadata, and environment
  changes require review.
- Candidate and diff artifacts are reviewable but ignored by Git.
- Approval promotes the displayed candidate byte-for-byte and rejects stale
  approval.
- CI automation reports the same result states without mutating baselines.
- All artifact access is confined to story roots.
- Relevant lint, format, type, unit, integration, Storybook, build, and Chromium
  smoke checks pass.

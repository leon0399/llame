# Content-aware capture implementation plan

> **For agentic workers:** follow test-driven development and check off each
> step as it is verified.

**Goal:** Remove empty viewport space from normal component snapshots without
losing portals, while preserving viewport capture for fullscreen stories and
explicit overrides.

**Architecture:** The preview annotation resolves each story to `content` or
`viewport` capture and reports that choice through the existing readiness
bridge. The Node capture session uses the resolved mode after story readiness:
`content` computes one viewport-clamped union of visible story DOM rectangles;
`viewport` keeps Playwright's normal viewport screenshot. No browser or modes
matrix is introduced.

**Tech stack:** Storybook 10 preview annotations, Playwright Chromium, Vitest,
Playwright Test, PNGJS.

---

## Capture semantics

- [x] Add preview tests for the default, fullscreen fallback, and explicit
      `visualTests.capture` override.
- [x] Run the focused preview tests and confirm they fail because capture mode
      is not reported yet.
- [x] Add capture tests proving content mode passes a clip and viewport mode
      does not.
- [x] Run the focused capture tests and confirm they fail for the missing
      behavior.
- [x] Extend the readiness bridge with the resolved capture mode.
- [x] Compute a stable, integer, viewport-clamped union of visible story
      elements with a small margin.
- [x] Run the focused tests and confirm they pass.

## Browser integration

- [x] Make the fixture story compact with a body portal outside its root.
- [x] Assert that the captured PNG is smaller than `1280x720` and still
      contains both the story and portal pixels.
- [x] Run the isolated Storybook smoke test and confirm it passes.

## Extractable documentation

- [x] Add package-local configuration and capture-contract documentation.
- [x] Add a forward-only package `ROADMAP.md` for modes, browsers, CI, and
      extraction work.
- [x] Link package documentation from the README and update the root changelog
      entry to describe content-aware capture.

## Verification

- [x] Run package tests, typecheck, lint, and formatting checks.
- [x] Run the isolated visual integration smoke.
- [x] Run affected Storybook tests and a live compact-component capture.

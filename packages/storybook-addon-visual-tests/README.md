# `@workspace/storybook-addon-visual-tests`

Repo-local, Chromium-first visual testing for Storybook. The primary workflow
lives inside Storybook: run the current story or the full suite, inspect
baseline/candidate/diff images, and approve the exact captured candidate.

## Storage

Artifacts stay beside their story source:

```text
button.stories.tsx
__screenshots__/
  button.stories.tsx.visual/
    button--primary/
      chromium-1280x720@1x/
        baseline.png
        baseline.json
        candidate.png
        diff.png
        result.json
```

Commit `baseline.png` and `baseline.json`. Candidate, diff, result, and atomic
temporary files are gitignored. The `.visual` suffix prevents Storybook's story
glob from mistaking an artifact directory for a story file.

## Capture contract

The initial environment is fixed: bundled Playwright Chromium, `1280x720`, DPR
1, `en-US`, UTC, and reduced motion. Capture waits for Storybook's finished
event, including the story `play` function, then screenshots the viewport so
body portals are included.

The addon is development-only because approval writes repository files. Static
Storybook builds keep the panel visible but mark visual testing unavailable.

## Verification

```bash
pnpm --filter @workspace/storybook-addon-visual-tests test
pnpm --filter @workspace/storybook-addon-visual-tests typecheck
pnpm --filter @workspace/storybook-addon-visual-tests lint
pnpm test:visual
```

`pnpm test:visual` is the addon integration smoke test; normal visual test runs
start from the Storybook panel, not from a CLI runner.

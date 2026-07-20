# Roadmap

Forward-only work for `@workspace/storybook-addon-visual-tests`. Completed work
belongs in the consuming repository's changelog, not here.

## P1 — Automation and baseline modes

- [ ] Add a read-only CI runner against a built or already-running Storybook.
      It must use the same capture/comparison core, never approve baselines, and
      must not replace the in-Storybook local workflow.
- [ ] Add named per-project, component, and story modes for multiple viewport
      sizes. Each mode needs an independent environment key and baseline path.
- [ ] Project visual status back into machine-readable CI output and artifact
      uploads without introducing a second review model.

## P2 — Browser and state coverage

- [ ] Add an explicit required-resource contract before treating request
      failures as capture errors. Same-origin failures alone are not sufficient:
      stories can intentionally render failed API states.
- [ ] Add Firefox and WebKit only after viewport modes prove the environment
      identity and review UI can handle multiple candidates per story.
- [ ] Add explicit theme/global variants (e.g. light/dark) without
      automatically multiplying every story across every toolbar global. The
      plumbing is already shaped for it: `environmentKey` namespaces baselines,
      artifact paths, and the `completed` approval key, so a variant is just a
      new environment in the run matrix (e.g. `chromium-1280x720@1x-dark`),
      driven by setting `&globals=theme:<value>` on the capture iframe URL (the
      `apps/storybook` `theme` global toggles `.dark` on `<html>`). Needs the
      panel/testing UI to show and approve multiple candidates per story, and a
      check that `next-themes`-driven state in `apps/web` follows the URL global
      rather than `localStorage`/system preference.
- [ ] Add an opt-in per-story capture phase for stories whose `play` is
      destructive (navigates away, unmounts) or whose meaningful state is the
      initial render; the default stays capture-after-`play` (fires on
      `STORY_FINISHED`), matching Chromatic/the test-runner. e.g. a
      `parameters.visualTests.capturePhase` of `after-play` | `before-play`.
- [ ] Add narrowly scoped masking or ignored-region support for demonstrated
      nondeterministic content. Prefer deterministic stories and `play`
      functions first.

## P3 — Extraction readiness

- [ ] Replace workspace-only package metadata and TypeScript configuration with
      a publishable build and package-level release checks.
- [ ] Make addon IDs, artifact routes, and package naming generic while
      preserving backward-compatible defaults for this repository.
- [ ] Add an external-consumer fixture that installs the packed tarball rather
      than resolving workspace source.
- [ ] Document supported Storybook versions and isolate experimental Storybook
      APIs behind compatibility tests before publishing.

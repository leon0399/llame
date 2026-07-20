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
- [ ] Add explicit theme/global variants without automatically multiplying
      every story across every toolbar global.
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

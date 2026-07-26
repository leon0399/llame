# Roadmap

Forward-only work for the Storybook visual-tests addon. Completed work belongs
in the consuming repository's changelog, not here. The implementation sequence
and verification gates live in
[the public preview release plan](docs/2026-07-24-public-preview-release-plan.md).

Development stays inside the llame monorepo through the initial public preview.
Repository extraction is optional and last; the package boundary is tested
earlier by installing the packed tarball into an isolated temporary fixture.

## P0 — Publishable package boundary

- [ ] Finalize the deliberately narrow preview contract only after packed
      consumer evidence: Ubuntu 24.04 x64, Node `>=22.12 <23`, Storybook
      `>=10.5.0 <10.6.0`, React 19, React-Vite, bundled Chromium, and direct
      loopback HTTP.
- [ ] Add a strict npm `files` allowlist and a tarball inventory/size gate that
      rejects source, tests, stories, temporary builds, screenshots, logs, and
      internal agent/design files.
- [ ] Pack once, record the archive's npm-compatible SHA-512 SRI, and carry that
      same `.tgz` through inventory, consumer tests, workflow artifact upload,
      and publication without rebuilding or repacking.
- [ ] Add an in-repository consumer fixture that installs the exact packed
      tarball in a temporary non-workspace project and verifies Storybook dev,
      capture/review/approval/rerun, changed diffs, testing-widget run-all with
      aggregate mixed results, and static build.
- [ ] Make the packed-consumer fixture a required CI check.

## P1 — Consumer-visible confidence

- [ ] Run the reusable browser acceptance specification against the packed
      non-workspace consumer without copying the workspace-source scenarios.
- [ ] Add configurable HTTPS/proxy/container capture topology only when a
      demonstrated consumer requires it.

## P2 — Public prerelease

- [ ] Choose the final npm name and license; add the license grant, public
      metadata, engines, peer ranges, repository links, and public-access
      configuration.
- [ ] Rewrite README/configuration/troubleshooting around the verified packed
      consumer, including browser installation, artifact ignores, trust
      boundary, Ubuntu-only support, and Playwright upgrade policy.
- [ ] Add protected npm trusted publishing with provenance, package-scoped
      version/tag validation, least-privilege permissions, SHA-pinned actions,
      exact-artifact publication from the same protected tag workflow run, and
      post-publication smoke. Never consume pull-request workflow artifacts in
      the privileged publisher.
- [ ] Publish a prerelease such as `0.1.0-next.0`; promote to `0.1.0` only after
      the registry artifact succeeds in at least one clean external project.
      Publish under the `next` dist-tag and verify `latest` remains absent or
      unchanged.

## P3 — Optional repository extraction

- [ ] Extract only when the addon has a genuinely independent maintainer,
      contributor, issue, or release lifecycle. npm publication alone does not
      require a separate repository.
- [ ] Prefer `git subtree split`; use `git filter-repo` when precise history
      filtering is required. Do not use deprecated `git filter-branch`.
- [ ] Add standalone package-manager, lockfile, build, test, lint, CI, release,
      contribution, and security scaffolding that the extracted package
      previously inherited from the monorepo.
- [ ] Run the same build, pack, isolated-consumer, visual, type, lint, and format
      gates in the extracted checkout before moving publication authority.
- [ ] Move repository metadata, issue routing, security reporting, tags, and
      trusted-publisher configuration deliberately.

## P4 — Post-preview feature leverage

- [ ] Add a read-only CI runner against a built or already-running Storybook,
      reusing the capture/comparison core and never approving baselines.
- [ ] Project visual status into machine-readable CI output and artifact uploads
      without introducing a second review model.
- [ ] Add named viewport modes with independent environment keys and baseline
      paths.
- [ ] Add explicit theme/global variants after the UI can review and approve
      multiple candidates per story.
- [ ] Add component/directory sidebar-scoped runs after the public package
      contract stabilizes.
- [ ] Add an explicit required-resource contract before treating network
      failures as capture errors.
- [ ] Add an opt-in capture phase for stories whose `play` function destroys the
      state that needs capture.
- [ ] Add narrowly scoped masking only for demonstrated nondeterminism; prefer
      deterministic stories and `play` functions.
- [ ] Add another operating system or Linux distribution only after exact
      Ubuntu-approved baseline files transfer to it and pass the fixed comparator
      without approval. Per-platform environment identities require a separate
      design.
- [ ] Add Firefox and WebKit only after multi-environment identity and review
      semantics are proven by viewport/theme modes.

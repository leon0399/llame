# Capture contract

## Capture origin

Capture is zero-config because the origin is fixed, not discovered: the preset
builds it from the development server's own port as
`http://127.0.0.1:<port>`. Chromium therefore has to reach Storybook over
**direct loopback HTTP in the same network namespace** as the Storybook process.

The origin is not configurable, so the following are unsupported — not merely
untested. The current implementation cannot address them at all:

- **HTTPS origins.** The scheme is hard-coded to `http`.
- **Reverse-proxy path prefixes.** The story iframe is resolved against the
  server root, so a Storybook mounted under a path prefix is unreachable.
- **Split capture.** Running the browser in a separate container, VM, or host
  from the Storybook server breaks the loopback assumption; `127.0.0.1` in the
  browser's namespace is not the Storybook server.

Adding a configurable origin is deliberately deferred until a real consumer
needs one, because each of those topologies also changes the trust boundary
described in the [README](../README.md).

## Deterministic environment

Each story runs in a fresh context from one bundled Playwright Chromium process:

- viewport: `1280x720` CSS pixels;
- device scale factor: `1`;
- locale: `en-US`;
- timezone: UTC;
- reduced motion: enabled.

The environment key remains `chromium-1280x720@1x`. Screenshot framing changes
which pixels inside that environment become the candidate; it does not resize
the browser.

## Readiness

Capture navigates directly to the canonical story iframe and waits for
Storybook's terminal story event. The story render and `play` function must
finish before capture. Reporter failures such as accessibility findings are
reported by their own Storybook test provider and do not falsely turn a
successfully rendered story into a visual capture error.

After readiness, capture waits for fonts and two animation frames. The story is
then photographed once. Approval promotes those exact candidate bytes; it never
recaptures.

## Framing

`content` is the default for normal component stories. It computes the union of
visible element rectangles in the story document, including elements rendered
through portals under `document.body`. The union is expanded by eight CSS
pixels, rounded to integer coordinates, and clamped to the `1280x720` viewport.
If the document has no visible rectangle, capture falls back to the viewport.

This deliberately includes open dropdowns, dialogs, tooltips, and other portal
content. A full-screen overlay therefore expands the candidate to the viewport;
cropping only `#storybook-root` would silently omit the state under test.

`viewport` captures the complete browser viewport. It is the default when the
resolved Storybook layout is `fullscreen`, and it can be selected explicitly
with `parameters.visualTests.capture`.

Neither mode is Playwright `fullPage` capture. Content below the fixed viewport
is not included in the current implementation.

## Baseline consequences

Candidate dimensions are part of image comparison. A component or portal
geometry change can therefore change both pixels and candidate dimensions. The
diff engine pads both images to their maximum dimensions so the review remains
inspectable rather than failing comparison.

The current baseline metadata records browser, Playwright version, platform,
viewport, device scale factor, comparator policy, and the approved image hash.
Future browser or viewport modes must use independent environment identities;
they must not silently overwrite the existing baseline.

## Comparator policy

The comparator is fixed for the preview and is not configurable: `pixelmatch`
with `threshold: 0.1` and `includeAA: false`. That exact policy is written into
every `baseline.json`, and a baseline recording a different policy is treated as
incompatible rather than silently re-scored. Making the comparator configurable
would mean baselines could no longer be compared across repositories or
contributors, so it stays fixed until there is evidence a consumer needs
otherwise.

## Baseline compatibility

A baseline is only comparable to a candidate when the recorded schema version,
browser name, browser version, Playwright version, viewport, device scale
factor, and comparator policy all match exactly. A mismatch — or missing or
malformed metadata, or metadata whose hash does not match its image — is
surfaced as a reviewable result with an explanatory message, not as a silent
pass and not as a capture error.

Two consequences worth planning for:

- **Upgrading Playwright or Chromium invalidates every baseline.** Both versions
  are part of the compatibility check, so a Playwright bump makes existing
  baselines incompatible and every affected story needs review and
  re-approval. Treat a Playwright upgrade as a deliberate, reviewed rebaseline.
- **Platform is recorded but not compared.** `platform` is provenance only, so
  the shared `chromium-1280x720@1x` environment key could allow one baseline to
  serve multiple host platforms. The initial preview claims Ubuntu 24.04 x64
  only. Before adding another operating system or Linux distribution, transfer
  the exact Ubuntu-approved baseline files and prove they pass the fixed
  comparator there without reapproval; see the portability section in the
  [README](../README.md).

## Failure behavior

Story-level failures are isolated, so one broken story does not mask the rest of
a run:

- **A story renders with an error, or raises a page error** — that story reports
  a capture error naming it; other stories still run. Reporter findings from
  other Storybook test providers, such as accessibility results, do not turn a
  rendered story into a capture error.
- **A disabled story** reports a passing result with an explanatory message and
  writes no candidate.

Two failures are run-wide rather than per story:

- **Chromium cannot start** — for example, the Playwright browser binary was
  never installed. The browser is launched once per run, so every story in that
  run reports `Chromium could not start: <detail>`. Install the browser with
  `pnpm exec playwright install chromium`.
- **A cancelled run** reports cancelled results; a cancelled story has no
  approvable candidate.

Approval is rejected when the candidate hash no longer matches the result being
approved, so a stale panel cannot promote bytes that were never displayed.

# Capture contract

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

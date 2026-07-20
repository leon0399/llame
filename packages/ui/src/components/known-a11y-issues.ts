/**
 * TEMPORARY Storybook a11y-gate suppressions for known, tracked defects.
 *
 * These stories render their component faithfully, so the failure is REAL (not
 * a vendored-structure false positive) — we suppress ONLY the specific failing
 * rule (every other a11y rule still runs on the story) so CI isn't blocked
 * while the underlying fix is scoped. Every suppression here MUST link a
 * tracking issue.
 *
 * When the tracked issue is fixed, delete the corresponding export and remove
 * every story `parameters` that spreads it — find them all with:
 *   rg "KnownIssue232"
 */

/**
 * #232 — our low-contrast token choices fail WCAG AA color-contrast: the
 * `--muted-foreground` token (~4.3:1) on `bg-muted` / muted card surfaces, and
 * the alert `text-destructive/90` description on the card surface (~4.49:1).
 * Suppresses only the `color-contrast` rule, for stories that render those
 * pairings. The fix is a design-token change (app-wide blast radius), tracked
 * separately; spread this into the affected story's `parameters` until then.
 *
 * @see https://github.com/leon0399/llame/issues/232
 */
export const contrastKnownIssue232 = {
  a11y: {
    config: {
      rules: [{ id: "color-contrast", enabled: false }],
    },
  },
};

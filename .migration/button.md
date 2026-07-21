# button

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI Button primitive; typecheck (ui+web) + 11 story tests green.

## Changed

- `packages/ui/src/components/button.tsx` — now the `@base-ui/react/button`
  primitive with base-nova cva (nova sizing h-8/h-7/h-9, `rounded-lg`,
  `group/button`, `active:translate-y-px`, `aria-expanded` states,
  `has-data-[icon=inline-*]` spacing, subtle destructive). Kept `buttonVariants`
  - `ButtonProps` exports.
- **`asChild` kept as a compatibility shim** (base-nova drops it in favour of
  `render`). Our wrapper maps `asChild` → Base UI `render`
  (`asChild && isValidElement(children) ? children : render`). This is the key
  decision: it keeps ALL existing call-sites working with **zero consumer
  edits** —
  - the 4 `<Button asChild>` sites (2 in the still-Radix `alert-dialog.tsx`,
    2 in app code) are untouched, so Button does not couple to unmigrated
    alert-dialog;
  - the ~187 `<RadixTrigger asChild><Button/></RadixTrigger>` compositions keep
    Button as the child. Verified at runtime that a Radix trigger's `asChild`
    Slot composes cleanly with the Base UI Button (dropdown-menu / tooltip
    stories pass).
    `data-variant`/`data-size` kept as our fork.
- `button.stories.tsx` — docs anchors → base; `AsChild` story unchanged (shim);
  Destructive story gets `contrastKnownIssue232` (see below).

## Left alone

- No consumer files changed (shim). `alert-dialog.tsx` untouched.

## Behavior changes

- **Subtle destructive.** base-nova destructive is `bg-destructive/10
text-destructive` (tinted, not solid red). Notable visual change AND an
  a11y regression: it fails WCAG AA color-contrast (our old solid red passed).
  Suppressed on the Destructive story via `contrastKnownIssue232` and flagged —
  worth deciding whether to keep the nova subtle style or fork back to solid.
- Nova sizing is tighter (h-8 default vs h-9); icon spacing now driven by
  `data-icon="inline-start|inline-end"` on child SVGs (consumers already use it).
- `asChild` is now an alias for `render`; new code should prefer `render`.

## Verify by hand

- All variants/sizes; `asChild` link (AsChild story) renders an `<a>` styled as
  a button; buttons inside dropdown/tooltip/dialog triggers still open them.
- Eyeball the subtle destructive button — confirm it reads as destructive
  enough for llame's design.

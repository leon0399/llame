# collapsible

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI; typecheck (ui+web) + story/consumer tests green. Unblocked by Button + Tooltip shims.

## Changed

- `collapsible.tsx` — Radix → `@base-ui/react/collapsible`. Content → `Panel`.
  Both `Collapsible` (Root) and `CollapsibleTrigger` keep `asChild` as `render`
  shims (sidebar uses `<Collapsible asChild>` on the Root; other consumers use
  `<CollapsibleTrigger asChild>`).
- `collapsible.stories.tsx` — play `data-state="open|closed"` → `aria-expanded`;
  docs → base.
- `model-switch-boundary.tsx` (consumer) — its nested
  `Tooltip>Collapsible>Button` all-on-one-element trigger can't be expressed in
  Base UI (two render-based triggers don't compose, and a wrapper span breaks
  hover bubbling). Restructured: the Button is the tooltip trigger (single
  `asChild`) and toggles the collapsible via `onClick`/`aria-expanded` on the
  controlled `open` state (no `CollapsibleTrigger`). Tooltip is now uncontrolled
  with the content conditionally rendered when a model id truncates.
- `tool-call-part.test.tsx` — `stripRadixIds` broadened to also strip Base UI
  ids (`base-ui-…`) so the live-vs-history parity comparison stays stable.
- `model-switch-boundary.stories.tsx` — Base UI's tooltip popup has no
  `role="tooltip"`; query it by `[data-slot='tooltip-content']`.

## Left alone

chat-sidebar consumers of Collapsible typecheck unchanged (web green).

## Behavior changes

- `data-state` → `data-open/closed` (Panel) / `aria-expanded` (Trigger).
- Base UI has no `role="tooltip"` on tooltip content — tests query by data-slot.
- model-switch-boundary: the model-change button loses the Collapsible
  `aria-controls` linkage (uses `aria-expanded` + onClick instead) since one
  element can't be both triggers in Base UI.

## Verify by hand

Collapsible open/close; the chat model-switch boundary expands on click and
shows the full-id tooltip on hover when ids are truncated; tool-call chip
parity.

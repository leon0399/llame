# sheet

2026-07-21 · golden pair via URL (base-nova) · Sheet migrated to `@base-ui/react/dialog`; edge placement now driven by a `data-side` attribute + `data-[side=…]:` variant classes instead of JS `side` branches.

## Changed

- **`packages/ui/src/components/sheet.tsx`** — rewritten onto `@base-ui/react/dialog` (Sheet is a Dialog anchored to an edge):
  - `SheetOverlay` → `SheetPrimitive.Backdrop`; animation switches from Radix `data-[state=…]:animate-*` to Base UI's transition primitives (`data-ending-style:`/`data-starting-style:`) + `supports-backdrop-filter:backdrop-blur-xs`.
  - `SheetContent` → `Portal > Overlay > SheetPrimitive.Popup`, `data-side={side}` set on the Popup and edge placement expressed as `data-[side=…]:` variant classes (base-nova verbatim) rather than the old per-`side` JS className branches. `side`/`showCloseButton` props preserved.
  - Close button: `SheetPrimitive.Close` with `render={<Button variant="ghost" size="icon-sm" />}`, `IconPlaceholder` → lucide `XIcon`.
  - `SheetTrigger` + `SheetClose`: `asChild`→`render` compat shim (no consumer passes `asChild` today, but the documented API is preserved and matches the dialog family).
  - `SheetTitle` drops the undefined `cn-font-heading` class → `text-base font-medium text-foreground`; header gap `gap-1.5`→`gap-0.5` (base-nova).
  - Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder\|cn-font-heading\|data-\[state"` → none.
- **`packages/ui/src/components/sheet.stories.tsx`** — docs URLs retargeted `components/radix/sheet` → `components/base/sheet`. `Sides`/`LongContent` play tests asserted the old literal placement classes (`top-0`, `bottom-0`, …); those are now `data-[side=…]:` variants, so the assertions check `toHaveAttribute("data-side", side)` instead, and the now-unused `SHEET_SIDE_CLASSES` map was removed. Stories pass **4/4**.

Typecheck green: `@workspace/ui` and `web` both exit 0.

## Left alone

- **`sidebar.tsx`** (still Radix; migrates later) and **`effective-context-inspector.tsx`** consume Sheet through its unchanged public API — no edits; `effective-context-inspector.test.tsx` still passes.
- **Visual baselines** (`__screenshots__/sheet.stories.tsx.visual/*`) left as the stale radix-era "before"; appearance changed (background `bg-popover`, transition model). The visual-tests panel will report `changed` — re-baseline is Leo's interactive panel step. No headless baseline-write path exists.

## Behavior changes

- Slide-in/out animation is Base UI's transition model (`data-starting-style`/`data-ending-style`) rather than Radix `animate-in/out`; the visual motion differs slightly but the anchored-edge behavior is unchanged.
- Focus return, Escape, and outside-click dismissal are Base UI dialog defaults. No consumer API change.

## Verify by hand

- Open each side (`top`/`right`/`bottom`/`left`): the sheet anchors to the right edge, slides in, and `data-side` matches.
- Escape / outside click / the close X and a footer `SheetClose asChild` button all dismiss and return focus to the trigger.
- `showCloseButton={false}` renders no corner X; long-content sheet scrolls internally.
- **Visual: re-baseline the sheet stories in the visual-tests panel** — appearance/motion changed radix→base-nova.

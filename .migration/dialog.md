# dialog

2026-07-21 · golden pair via URL (base-nova) · Dialog wrapper migrated to `@base-ui/react/dialog`; overlay restructured to Portal > Backdrop > Popup, zero consumer sweep via the `asChild`→`render` shim.

## Changed

- **`packages/ui/src/components/dialog.tsx`** — rewritten onto `@base-ui/react/dialog`:
  - `Dialog` → `DialogPrimitive.Root`; `DialogPortal` → `DialogPrimitive.Portal`.
  - `DialogOverlay` → `DialogPrimitive.Backdrop` (Base UI's rename of Radix `Overlay`), base-nova class incl. `data-open:`/`data-closed:` state variants and `supports-backdrop-filter:backdrop-blur-xs`.
  - `DialogContent` → `Portal > Overlay > DialogPrimitive.Popup` (base-nova centers the `Popup` itself via `fixed top-1/2 left-1/2 -translate-*`; no Positioner, unlike tooltip/popover/select). `showCloseButton` prop kept; the close button is a `DialogPrimitive.Close` with `render={<Button variant="ghost" size="icon-sm" />}`, `IconPlaceholder` replaced with lucide `XIcon`.
  - `DialogTrigger` + `DialogClose`: `asChild`→`render` compat shim (`const resolvedRender = asChild && isValidElement(children) ? children : render`) so the three consumers passing `asChild` (and cmdk `command.tsx`) need no edit.
  - `DialogFooter` adopts base-nova's muted footer bar (`-mx-4 -mb-4 … border-t bg-muted/50`) and keeps its `showCloseButton` escape hatch (outline "Close" `DialogPrimitive.Close`).
  - `DialogTitle` drops the undefined `cn-font-heading` class (same as card/dialog upstream) → `text-base leading-none font-medium`.
  - Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder\|cn-font-heading\|data-\[state"` → none.
- **`packages/ui/src/components/dialog.stories.tsx`** — docs URL retargeted `components/radix/dialog` → `components/base/dialog`. No `data-state`/role assertions needed rewriting; interaction tests pass **11/11** (`vitest --project storybook dialog.stories`). Provenance tags untouched.
- **`packages/ui/src/components/command.tsx`** (cmdk, NOT migrated — see Left alone) — **type-only** fallout of the Dialog migration: Base UI's `Dialog.Root.Props.children` is a render-function union (`PayloadChildRenderFunction | ReactNode`), where Radix's was plain `ReactNode`. `CommandDialog` inherited that union via `React.ComponentProps<typeof Dialog>` and passed it to cmdk's `<Command>` (which wants `ReactNode`) → TS2322. Fixed by `Omit<…, "children">` on the inherited props and re-declaring `children?: React.ReactNode`. Zero runtime/behavior change to cmdk; the rule bars _migrating_ cmdk, not keeping a Dialog consumer compiling.

Typecheck green: `@workspace/ui` and `web` both exit 0. cmdk consumer `command.stories` passes 2/2.

## Left alone

- **`command.tsx`** as a component stays cmdk (vaul/cmdk are not Radix — skill hard rule). Only its Dialog-consumer prop types were touched (above).
- **Visual baselines** (`__screenshots__/dialog.stories.tsx.visual/*`) left as the stale radix-era "before". base-nova changes dialog appearance (muted footer bar, `ring-1 ring-foreground/10`, `rounded-xl`), so the visual-tests panel will report these stories as `changed` — that diff is exactly the review Leo approves interactively. No headless baseline-write path exists in the local addon; re-baseline is Leo's panel step.

## Behavior changes

- Close button is a real `DialogPrimitive.Close` (Base UI) rather than Radix's; focus-return and Escape/outside-click dismissal are Base UI defaults. No API change for consumers.
- Footer visual restyle (base-nova muted bar) is intentional, not a regression.

## Verify by hand

- Open a dialog (trigger + `asChild` trigger both): focus moves in, Escape closes, focus returns to the trigger.
- Tab through: focus is trapped inside the Popup; the close X is reachable and labelled ("Close").
- `showCloseButton={false}` (`command` palette path) renders no corner X; `DialogFooter showCloseButton` renders the outline Close.
- **Visual: re-baseline the 5 dialog stories in the visual-tests panel** — appearance changed radix→base-nova (footer bar, ring, rounding); approve the new look.
